import { NextRequest, NextResponse } from "next/server";
import { isSameOriginAuthRequest } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedReactions = new Set(["heart", "fire", "laugh", "clap"]);
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest, context: RouteContext<"/api/stories/[storyId]/reaction">) {
  if (!isSameOriginAuthRequest(request)) return NextResponse.json({ error: "This request is not allowed." }, { status: 403, headers });
  const { storyId } = await context.params;
  if (!idPattern.test(storyId)) return NextResponse.json({ error: "The story is unavailable." }, { status: 404, headers });

  let reaction: unknown;
  try {
    const body: unknown = await request.json();
    reaction = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).reaction
      : undefined;
  } catch {
    return NextResponse.json({ error: "Choose a valid reaction." }, { status: 400, headers });
  }
  if (reaction !== null && (typeof reaction !== "string" || !allowedReactions.has(reaction))) {
    return NextResponse.json({ error: "Choose a valid reaction." }, { status: 400, headers });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in to react to a story." }, { status: 401, headers });
    const { error } = await supabase.rpc("set_story_reaction", {
      p_story_id: storyId,
      p_reaction: reaction,
    });
    if (error) return NextResponse.json({ error: "The story is unavailable." }, { status: 404, headers });
    return NextResponse.json({ saved: true }, { headers });
  } catch (error) {
    console.error("Story reaction request failed:", error);
    return NextResponse.json({ error: "Your reaction could not be saved." }, { status: 503, headers });
  }
}
