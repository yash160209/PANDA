import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/auth/server";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const secret = process.env.STORIES_CLEANUP_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401, headers });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: queued, error: queueQueryError } = await admin
      .from("story_media_cleanup_queue")
      .select("id, media_path")
      .order("created_at")
      .limit(100);
    if (queueQueryError) throw queueQueryError;

    let removed = 0;
    let deferred = 0;
    for (const queuedObject of queued ?? []) {
      const { error: storageError } = await admin.storage.from("story-media").remove([queuedObject.media_path]);
      if (storageError) {
        deferred += 1;
        console.error("Queued story media cleanup deferred:", storageError.message);
        continue;
      }
      const { error: queueDeleteError } = await admin
        .from("story_media_cleanup_queue")
        .delete()
        .eq("id", queuedObject.id);
      if (queueDeleteError) {
        deferred += 1;
        console.error("Story media cleanup queue deletion deferred:", queueDeleteError.message);
        continue;
      }
      removed += 1;
    }

    const { data: expired, error: queryError } = await admin
      .from("stories")
      .select("id, media_path")
      .lte("expires_at", new Date().toISOString())
      .order("expires_at")
      .limit(Math.max(0, 100 - (queued?.length ?? 0)));
    if (queryError) throw queryError;

    for (const story of expired ?? []) {
      const { error: storageError } = await admin.storage.from("story-media").remove([story.media_path]);
      if (storageError) {
        deferred += 1;
        console.error("Expired story media cleanup deferred:", storageError.message);
        continue;
      }
      const { error: deleteError } = await admin.from("stories").delete().eq("id", story.id).lte("expires_at", new Date().toISOString());
      if (deleteError) {
        deferred += 1;
        console.error("Expired story record cleanup deferred:", deleteError.message);
        continue;
      }
      removed += 1;
    }
    return NextResponse.json({ removed, deferred }, { headers });
  } catch (error) {
    console.error("Expired story cleanup failed:", error);
    return NextResponse.json({ error: "Expired stories could not be cleaned up." }, { status: 503, headers });
  }
}
