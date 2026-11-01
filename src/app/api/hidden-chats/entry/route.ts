import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, isSameOriginAuthRequest } from "@/lib/auth/server";
import { isHiddenChatGrant } from "@/lib/hidden-chats/grant";
import { isSecretCodeAttemptAllowed } from "@/lib/hidden-chats/entry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isValidSecretCode,
  verifySecretCode,
  type PinCredential,
} from "@/lib/hidden-chats/security";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const maxCodeAttempts = 5;

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
    return respond({ matched: false }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ matched: false }, 400);
  }

  const query = (body as Record<string, unknown>).query;
  if (typeof query !== "string" || query.length > 200) {
    return respond({ matched: false });
  }

  try {
    const authenticatedClient = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await authenticatedClient.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to open the Hidden Inbox." }, 401);

    const code = query.trim();
    if (!isValidSecretCode(code)) return respond({ matched: false });

    const admin = createSupabaseAdminClient();
    const { data: credentialData, error: credentialError } = await admin
      .from("hidden_chat_entry_credentials")
      .select("salt,code_hash,iterations")
      .eq("user_id", user.id)
      .maybeSingle();
    if (credentialError) {
      return respond({ error: "The Hidden Inbox is unavailable. Try again later." }, 503);
    }
    if (!credentialData) return respond({ matched: false });

    const { data: attemptCount, error: attemptError } = await admin.rpc(
      "consume_hidden_chat_entry_attempt",
      { p_user_id: user.id },
    );
    if (attemptError || typeof attemptCount !== "number") {
      return respond({ error: "The Hidden Inbox is unavailable. Try again later." }, 503);
    }
    if (!isSecretCodeAttemptAllowed(attemptCount, maxCodeAttempts)) {
      return respond({ error: "Search verification is temporarily unavailable. Try again later." }, 429);
    }

    const credential: PinCredential = {
      salt: credentialData.salt,
      pin_hash: credentialData.code_hash,
      iterations: credentialData.iterations,
    };
    if (!(await verifySecretCode(code, credential))) {
      return respond({ matched: false });
    }

    const { error: resetError } = await admin.rpc("reset_hidden_chat_entry_attempts", {
      p_user_id: user.id,
    });
    if (resetError) {
      return respond({ error: "The Hidden Inbox is unavailable. Try again later." }, 503);
    }

    const grant = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(Buffer.from(grant, "hex")).digest("hex");
    const { data: expiresAt, error: grantError } = await admin.rpc("create_hidden_chat_access_grant", {
      p_user_id: user.id,
      p_conversation_id: null,
      p_token_hash: tokenHash,
    });
    if (grantError || typeof expiresAt !== "string") {
      return respond({ error: "The Hidden Inbox is unavailable. Try again later." }, 503);
    }

    return respond({ matched: true, grant, expiresAt });
  } catch {
    return respond({ error: "The Hidden Inbox is unavailable. Try again later." }, 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return respond({ error: "This request is not allowed." }, 403);
  }

  const grant = request.headers.get("x-panda-hidden-chat-grant");
  if (!isHiddenChatGrant(grant)) {
    return respond({ error: "The Hidden Inbox session is unavailable." }, 401);
  }

  try {
    const authenticatedClient = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await authenticatedClient.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to close the Hidden Inbox." }, 401);

    const admin = createSupabaseAdminClient();
    const tokenHash = createHash("sha256").update(Buffer.from(grant, "hex")).digest("hex");
    const { data: listingGrant, error: grantError } = await admin
      .from("hidden_chat_access_grants")
      .select("token_hash")
      .eq("token_hash", tokenHash)
      .eq("user_id", user.id)
      .eq("grant_scope", "listing")
      .is("conversation_id", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (grantError) return respond({ error: "The Hidden Inbox session could not be closed." }, 503);
    if (!listingGrant) return respond({ success: true });

    const { error: revokeError } = await admin
      .from("hidden_chat_access_grants")
      .delete()
      .eq("user_id", user.id);
    if (revokeError) return respond({ error: "The Hidden Inbox session could not be closed." }, 503);
    return respond({ success: true });
  } catch {
    return respond({ error: "The Hidden Inbox session could not be closed." }, 503);
  }
}
