import { NextRequest, NextResponse } from "next/server";
import { isSameOriginAuthRequest } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest, context: RouteContext<"/api/stories/[storyId]/view">) {
  if (!isSameOriginAuthRequest(request)) return NextResponse.json({ error: "This request is not allowed." }, { status: 403, headers });
  const { storyId } = await context.params;
  if (!idPattern.test(storyId)) return NextResponse.json({ error: "The story is unavailable." }, { status: 404, headers });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in to view stories." }, { status: 401, headers });
    const { error } = await supabase.rpc("record_story_view", { p_story_id: storyId });
    if (error) return NextResponse.json({ error: "The story is unavailable." }, { status: 404, headers });
    return NextResponse.json({ recorded: true }, { headers });
  } catch (error) {
    console.error("Story view request failed:", error);
    return NextResponse.json({ error: "The story view could not be recorded." }, { status: 503, headers });
  }
}
