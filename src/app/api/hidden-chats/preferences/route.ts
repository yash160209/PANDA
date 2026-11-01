import { NextRequest, NextResponse } from "next/server";
import { isSameOriginAuthRequest } from "@/lib/auth/server";
import { hiddenChatGrantHeaders, isHiddenChatGrant } from "@/lib/hidden-chats/grant";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return respond({ error: "This request is not allowed." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "The chat preference could not be updated." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ error: "The chat preference could not be updated." }, 400);
  }

  const { conversationId, isHidden } = body as Record<string, unknown>;
  if (typeof conversationId !== "string" || !uuidPattern.test(conversationId) || typeof isHidden !== "boolean") {
    return respond({ error: "The chat preference could not be updated." }, 400);
  }

  const grant = request.headers.get("x-panda-hidden-chat-grant");
  if (!isHidden && !isHiddenChatGrant(grant)) {
    return respond({ error: "Verify your PIN to unhide this conversation." }, 401);
  }

  try {
    const supabase = await createSupabaseServerClient(
      !isHidden && grant ? hiddenChatGrantHeaders(grant) : undefined,
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return respond({ error: "Sign in to update Hidden Chats." }, 401);
    }

    const { error } = await supabase
      .from("hidden_chat_preferences")
      .upsert(
        { user_id: user.id, conversation_id: conversationId, is_hidden: isHidden },
        { onConflict: "user_id,conversation_id" },
      );
    if (error) {
      return respond({ error: "The chat preference could not be updated." }, 403);
    }

    return respond({ success: true });
  } catch {
    return respond({ error: "Hidden Chats is unavailable. Try again later." }, 503);
  }
}
