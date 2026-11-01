import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, isSameOriginAuthRequest } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

async function authorizeListing(request: NextRequest) {
  const grant = request.headers.get("x-panda-hidden-chat-grant");
  if (!grant || !/^[a-f0-9]{64}$/.test(grant)) {
    return { error: respond({ error: "Verify your Secret Code to open the Hidden Inbox." }, 401) };
  }

  const authenticatedClient = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await authenticatedClient.auth.getUser();
  if (authError || !user) {
    return { error: respond({ error: "Sign in to open the Hidden Inbox." }, 401) };
  }

  const admin = createSupabaseAdminClient();
  const tokenHash = createHash("sha256").update(Buffer.from(grant, "hex")).digest("hex");
  const { data: listingGrant, error: grantError } = await admin
    .from("hidden_chat_access_grants")
    .select("token_hash,expires_at")
    .eq("token_hash", tokenHash)
    .eq("user_id", user.id)
    .eq("grant_scope", "listing")
    .is("conversation_id", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (grantError) {
    return { error: respond({ error: "The Hidden Inbox could not be loaded." }, 503) };
  }
  if (!listingGrant) {
    return { error: respond({ error: "Verify your Secret Code to open the Hidden Inbox." }, 401) };
  }

  return { user, admin };
}

export async function GET(request: NextRequest) {
  try {
    const authorization = await authorizeListing(request);
    if ("error" in authorization) return authorization.error;

    const { user, admin } = authorization;
    const { data: summaries, error: summariesError } = await admin.rpc(
      "list_hidden_conversation_summaries",
      { p_user_id: user.id },
    );
    if (summariesError) {
      return respond({ error: "The Hidden Inbox could not be loaded." }, 503);
    }

    const ids = (summaries ?? []).map((summary: { id: string }) => summary.id);
    const { data: conversations, error: conversationsError } = ids.length
      ? await admin
          .from("conversations")
          .select("id,updated_at,conversation_participants(user_id,profiles(username,display_name,avatar_path))")
          .in("id", ids)
          .order("updated_at", { ascending: false })
      : { data: [], error: null };
    if (conversationsError) {
      return respond({ error: "The Hidden Inbox could not be loaded." }, 503);
    }

    return respond({ conversations: conversations ?? [], summaries: summaries ?? [] });
  } catch {
    return respond({ error: "The Hidden Inbox could not be loaded." }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return respond({ error: "This request is not allowed." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "This conversation is unavailable." }, 404);
  }
  const conversationId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).conversationId
    : null;
  if (typeof conversationId !== "string" || !uuidPattern.test(conversationId)) {
    return respond({ error: "This conversation is unavailable." }, 404);
  }

  try {
    const authorization = await authorizeListing(request);
    if ("error" in authorization) return authorization.error;
    const { user, admin } = authorization;

    const { data: hiddenPreference, error: preferenceError } = await admin
      .from("hidden_chat_preferences")
      .select("conversation_id")
      .eq("user_id", user.id)
      .eq("conversation_id", conversationId)
      .eq("is_hidden", true)
      .maybeSingle();
    if (preferenceError) return respond({ error: "This conversation is unavailable." }, 404);
    if (!hiddenPreference) return respond({ error: "This conversation is unavailable." }, 404);

    const { data: canAccess, error: accessError } = await admin.rpc(
      "can_user_access_conversation_messaging",
      { p_user_id: user.id, p_conversation_id: conversationId },
    );
    if (accessError) return respond({ error: "This conversation is unavailable." }, 404);
    if (canAccess !== true) return respond({ error: "This conversation is unavailable." }, 404);

    const grant = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(Buffer.from(grant, "hex")).digest("hex");
    const { data: expiresAt, error: grantError } = await admin.rpc(
      "create_hidden_chat_access_grant",
      {
        p_user_id: user.id,
        p_conversation_id: conversationId,
        p_token_hash: tokenHash,
      },
    );
    if (grantError || typeof expiresAt !== "string") {
      return respond({ error: "This conversation is unavailable." }, 404);
    }

    return respond({ grant, expiresAt });
  } catch {
    return respond({ error: "This conversation is unavailable." }, 404);
  }
}
