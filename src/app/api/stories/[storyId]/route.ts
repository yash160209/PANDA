import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, isSameOriginAuthRequest } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const noStore = { "Cache-Control": "private, no-store" };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/stories/[storyId]">,
) {
  if (!isSameOriginAuthRequest(request)) return respond({ error: "This request is not allowed." }, 403);
  const { storyId } = await context.params;
  if (!idPattern.test(storyId)) return respond({ error: "The story could not be deleted." }, 404);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to delete a story." }, 401);

    const { data: objectPath, error } = await supabase.rpc("delete_story", { p_story_id: storyId });
    if (error || typeof objectPath !== "string") return respond({ error: "The story could not be deleted." }, 404);
    const { error: cleanupError } = await supabase.storage.from("story-media").remove([objectPath]);
    if (cleanupError) {
      console.error("Deleted story media cleanup failed:", cleanupError.message);
      const admin = createSupabaseAdminClient();
      const { error: queueError } = await admin.from("story_media_cleanup_queue").upsert({ media_path: objectPath }, { onConflict: "media_path" });
      if (queueError) console.error("Deleted story media could not be queued for cleanup:", queueError.message);
      return respond({ deleted: true, storageCleanupPending: true });
    }
    return respond({ deleted: true, storageCleanupPending: false });
  } catch (error) {
    console.error("Story deletion request failed:", error);
    return respond({ error: "The story could not be deleted. Try again." }, 503);
  }
}
