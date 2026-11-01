import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, isSameOriginAuthRequest } from "@/lib/auth/server";
import { matchesStoryFileSignature, validateStoryMedia } from "@/lib/stories/media";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const noStore = { "Cache-Control": "private, no-store" };
const pageSize = 500;
const signBatchSize = 100;
const signedUrlLifetimeSeconds = 300;
const maxRequestBytes = 51 * 1024 * 1024;

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to view stories." }, 401);

    const activeStories = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.rpc("get_story_feed", { p_offset: offset, p_limit: pageSize });
      if (error) throw error;
      activeStories.push(...(data ?? []));
      if ((data ?? []).length < pageSize) break;
    }
    if (!activeStories.length) return respond({ groups: [] });
    const storyIds = activeStories.map((story) => story.id);
    const visibleOwnerIds = [...new Set(activeStories.map((story) => story.owner_id))];
    const idBatches = <T,>(values: T[]) => Array.from(
      { length: Math.ceil(values.length / signBatchSize) },
      (_, index) => values.slice(index * signBatchSize, (index + 1) * signBatchSize),
    );
    const [profileResults, viewResults, reactionResults] = await Promise.all([
      Promise.all(idBatches(visibleOwnerIds).map((ids) => supabase.from("profiles").select("id, username, display_name, avatar_path").in("id", ids))),
      Promise.all(idBatches(storyIds).map((ids) => supabase.from("story_views").select("story_id").eq("viewer_id", user.id).in("story_id", ids))),
      Promise.all(idBatches(storyIds).map((ids) => supabase.from("story_reactions").select("story_id, reaction").eq("user_id", user.id).in("story_id", ids))),
    ]);
    for (const result of [...profileResults, ...viewResults, ...reactionResults]) {
      if (result.error) throw result.error;
    }
    const profileRows = profileResults.flatMap((result) => result.data ?? []);
    const viewRows = viewResults.flatMap((result) => result.data ?? []);
    const reactionRows = reactionResults.flatMap((result) => result.data ?? []);
    const seenIds = new Set(viewRows.map((view) => view.story_id));
    const reactions = new Map(reactionRows.map((reaction) => [reaction.story_id, reaction.reaction]));
    const profiles = new Map(profileRows.map((profile) => [profile.id, profile]));
    const grouped = new Map<string, { owner: Record<string, unknown>; stories: Array<Record<string, unknown>> }>();

    const mediaLifetime = Math.min(
      signedUrlLifetimeSeconds,
      ...activeStories.map((story) => Math.floor((new Date(story.expires_at).getTime() - Date.now()) / 1000)),
    );
    if (mediaLifetime <= 0) return respond({ groups: [] });
    const signedMedia = new Map<string, string>();
    const mediaBatches = idBatches(activeStories);
    const mediaResults = await Promise.all(mediaBatches.map((batch) => (
      supabase.storage.from("story-media").createSignedUrls(batch.map((story) => story.media_path), mediaLifetime)
    )));
    for (const result of mediaResults) {
      if (result.error) throw result.error;
      for (const signed of result.data ?? []) {
        if (!signed.path || !signed.signedUrl || signed.error) {
          console.error("Could not authorize story media:", signed.error);
          continue;
        }
        signedMedia.set(signed.path, signed.signedUrl);
      }
    }

    const avatarPaths = [...new Set(profileRows.flatMap((profile) => profile.avatar_path ? [profile.avatar_path] : []))];
    const avatarUrls = new Map<string, string>();
    const avatarResults = await Promise.all(idBatches(avatarPaths).map((paths) => (
      supabase.storage.from("profile-avatars").createSignedUrls(paths, signedUrlLifetimeSeconds)
    )));
    for (const result of avatarResults) {
      if (result.error) {
        console.error("Story profile avatars could not be authorized:", result.error.message);
        continue;
      }
      for (const avatar of result.data ?? []) {
        if (avatar.path && avatar.signedUrl && !avatar.error) avatarUrls.set(avatar.path, avatar.signedUrl);
      }
    }

    for (const story of activeStories) {
      const owner = profiles.get(story.owner_id);
      if (!owner) continue;
      const signedUrl = signedMedia.get(story.media_path);
      if (!signedUrl) throw new Error("Story media could not be authorized.");

      let group = grouped.get(owner.id);
      if (!group) {
        group = {
          owner: {
            id: owner.id,
            username: owner.username,
            displayName: owner.display_name,
            avatarUrl: owner.avatar_path ? avatarUrls.get(owner.avatar_path) ?? null : null,
            isOwn: owner.id === user.id,
          },
          stories: [],
        };
        grouped.set(owner.id, group);
      }
      group.stories.push({
        id: story.id,
        mediaType: story.media_type,
        mediaUrl: signedUrl,
        caption: story.caption,
        createdAt: story.created_at,
        expiresAt: story.expires_at,
        viewed: seenIds.has(story.id),
        myReaction: reactions.get(story.id) ?? null,
      });
    }

    const groups = [...grouped.values()].sort((left, right) => {
      if (left.owner.isOwn) return -1;
      if (right.owner.isOwn) return 1;
      const leftLatest = new Date(String(left.stories.at(-1)?.createdAt)).getTime();
      const rightLatest = new Date(String(right.stories.at(-1)?.createdAt)).getTime();
      return rightLatest - leftLatest;
    });
    return respond({ groups });
  } catch (error) {
    console.error("Stories feed request failed:", error);
    return respond({ error: "Stories are temporarily unavailable. Try again." }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) return respond({ error: "This request is not allowed." }, 403);
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxRequestBytes)) {
    return respond({ error: "Story uploads must be 50 MB or smaller." }, 413);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to post a story." }, 401);

    const form = await request.formData();
    const file = form.get("file");
    const caption = form.get("caption");
    if (!(file instanceof File) || typeof caption !== "string" || caption.length > 500) {
      return respond({ error: "Choose a photo or video and use a caption under 500 characters." }, 400);
    }
    const validation = validateStoryMedia(file);
    if ("error" in validation) return respond({ error: validation.error }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesStoryFileSignature(file.type, bytes)) {
      return respond({ error: "That file does not match its selected media type." }, 400);
    }

    const extension = file.name.toLowerCase().split(".").at(-1);
    if (!extension) return respond({ error: "Choose a supported photo or video file." }, 400);
    const objectPath = `${user.id}/${crypto.randomUUID().replaceAll("-", "")}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("story-media")
      .upload(objectPath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error("Story media upload failed:", uploadError.message);
      return respond({ error: "The story media could not be uploaded." }, 400);
    }

    const admin = createSupabaseAdminClient();
    const { data: storyId, error: createError } = await admin.rpc("create_story", {
      p_owner_id: user.id,
      p_media_path: objectPath,
      p_media_type: validation.mediaType,
      p_caption: caption.trim(),
    });
    if (createError || !storyId) {
      const { error: recordCleanupError } = await admin.from("stories").delete().eq("owner_id", user.id).eq("media_path", objectPath);
      if (recordCleanupError) console.error("Failed story record cleanup failed:", recordCleanupError.message);
      const { error: cleanupError } = await supabase.storage.from("story-media").remove([objectPath]);
      if (cleanupError) {
        console.error("Orphan story upload cleanup failed:", cleanupError.message);
        const { error: queueError } = await admin.from("story_media_cleanup_queue").upsert({ media_path: objectPath }, { onConflict: "media_path" });
        if (queueError) console.error("Orphan story media could not be queued for cleanup:", queueError.message);
      }
      console.error("Story record creation failed:", createError?.message);
      return respond({ error: "Your story could not be published." }, 403);
    }
    return respond({ storyId }, 201);
  } catch (error) {
    console.error("Story creation request failed:", error);
    return respond({ error: "Your story could not be published. Try again." }, 503);
  }
}
