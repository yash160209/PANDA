import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: NextRequest, context: RouteContext<"/api/stories/[storyId]/viewers">) {
  const { storyId } = await context.params;
  if (!idPattern.test(storyId)) return NextResponse.json({ error: "The story is unavailable." }, { status: 404, headers });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in to view story viewers." }, { status: 401, headers });
    const { data: story, error: storyError } = await supabase
      .from("stories")
      .select("id")
      .eq("id", storyId)
      .eq("owner_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (storyError || !story) return NextResponse.json({ error: "The story is unavailable." }, { status: 404, headers });

    const { data: views, error: viewsError } = await supabase
      .from("story_views")
      .select("viewer_id, viewed_at")
      .eq("story_id", storyId)
      .order("viewed_at", { ascending: false });
    if (viewsError) throw viewsError;
    const viewerIds = [...new Set((views ?? []).map((view) => view.viewer_id))];
    const profilesResult = viewerIds.length
      ? await supabase.from("profiles").select("id, username, display_name, avatar_path").in("id", viewerIds)
      : { data: [], error: null };
    if (profilesResult.error) throw profilesResult.error;
    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));

    const viewers = await Promise.all((views ?? []).map(async (view) => {
      const profile = profiles.get(view.viewer_id);
      let avatarUrl: string | null = null;
      if (profile?.avatar_path) {
        const { data } = await supabase.storage.from("profile-avatars").createSignedUrl(profile.avatar_path, 300);
        avatarUrl = data?.signedUrl ?? null;
      }
      return {
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? "Private PANDA member",
        avatarUrl,
        viewedAt: view.viewed_at,
      };
    }));
    return NextResponse.json({ viewers }, { headers });
  } catch (error) {
    console.error("Story viewers request failed:", error);
    return NextResponse.json({ error: "The viewer list is temporarily unavailable." }, { status: 503, headers });
  }
}
