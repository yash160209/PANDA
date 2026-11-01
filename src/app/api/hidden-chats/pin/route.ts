import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseAdminClient,
  isSameOriginAuthRequest,
} from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  hashPin,
  isPinAttemptAllowed,
  isValidPin,
  verifyPin,
  type PinCredential,
} from "@/lib/hidden-chats/security";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const invalidPinMessage = "The PIN could not be verified.";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

async function getAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function consumeAttempt(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const { data, error } = await admin.rpc("consume_hidden_chat_pin_attempt", {
    p_user_id: userId,
  });
  if (error) throw new Error("PIN rate limiting is unavailable.");
  return isPinAttemptAllowed(data);
}

async function loadCredential(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const { data, error } = await admin
    .from("hidden_chat_pin_credentials")
    .select("salt,pin_hash,iterations")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("PIN verification is unavailable.");
  return data as PinCredential | null;
}

async function resetAttempts(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const { error } = await admin.rpc("reset_hidden_chat_pin_attempts", {
    p_user_id: userId,
  });
  if (error) throw new Error("PIN verification is unavailable.");
}

export async function GET() {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    console.error("Hidden Chats PIN status could not initialize the Supabase server client.");
    return respond(
      { error: "PIN settings are unavailable because Supabase server configuration could not be loaded." },
      503,
    );
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return respond({ error: "Your session could not be verified. Sign in again." }, 401);
    }

    const { data: hasPin, error } = await supabase.rpc("has_hidden_chat_pin");
    if (error) {
      const code = typeof error.code === "string" ? error.code : "unknown";
      console.error("Hidden Chats PIN status RPC failed.", { code });
      if (code === "PGRST202" || code === "42883") {
        return respond(
          { error: "PIN settings are not initialized. Verify that the Hidden Chats database migration is applied." },
          503,
        );
      }
      return respond({ error: "PIN settings could not be loaded. Try again later." }, 503);
    }
    if (typeof hasPin !== "boolean") {
      console.error("Hidden Chats PIN status RPC returned an invalid response.");
      return respond({ error: "PIN settings could not be loaded. Try again later." }, 503);
    }

    return respond({ hasPin });
  } catch {
    console.error("Hidden Chats PIN status request failed.");
    return respond({ error: "PIN settings could not be loaded. Try again later." }, 503);
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
    return respond({ error: invalidPinMessage }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ error: invalidPinMessage }, 400);
  }

  const { action, pin, currentPin, newPin, conversationId } = body as Record<string, unknown>;
  if (action !== "setup" && action !== "change" && action !== "verify") {
    return respond({ error: invalidPinMessage }, 400);
  }
  if (
    action === "verify"
    && conversationId !== undefined
    && (typeof conversationId !== "string" || !uuidPattern.test(conversationId))
  ) {
    return respond({ error: invalidPinMessage }, 400);
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) return respond({ error: "Sign in to use Hidden Chats." }, 401);
    const admin = createSupabaseAdminClient();
    const credential = await loadCredential(admin, user.id);

    if (action === "setup" || action === "change") {
      if (!isValidPin(newPin)) {
        return respond({ error: invalidPinMessage }, 400);
      }
      if (action === "setup" && credential) {
        return respond({ error: "The PIN could not be saved." }, 409);
      }
      if (action === "change" && !credential) {
        return respond({ error: invalidPinMessage }, 401);
      }
      if (action === "change") {
        if (!isValidPin(currentPin) || !credential) {
          return respond({ error: invalidPinMessage }, 401);
        }
        if (!(await consumeAttempt(admin, user.id))) {
          return respond({ error: invalidPinMessage }, 429);
        }
        if (!(await verifyPin(currentPin, credential))) {
          return respond({ error: invalidPinMessage }, 401);
        }
        await resetAttempts(admin, user.id);
      }

      const hashed = await hashPin(newPin);
      const { error: saveError } = await admin.rpc("save_hidden_chat_pin_credential", {
        p_user_id: user.id,
        p_salt: hashed.salt,
        p_pin_hash: hashed.pin_hash,
        p_iterations: hashed.iterations,
        p_is_setup: action === "setup",
      });
      if (saveError) {
        if (saveError.code === "23505") {
          return respond({ error: "The PIN could not be saved." }, 409);
        }
        throw new Error("PIN credential save failed.");
      }

      return respond({ success: true });
    }

    if (!isValidPin(pin)) {
      return respond({ error: invalidPinMessage }, 400);
    }
    if (!credential || !(await consumeAttempt(admin, user.id))) {
      return respond({ error: invalidPinMessage }, credential ? 429 : 401);
    }
    if (!(await verifyPin(pin, credential))) {
      return respond({ error: invalidPinMessage }, 401);
    }

    await resetAttempts(admin, user.id);
    const grant = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(Buffer.from(grant, "hex")).digest("hex");
    const { data: expiresAt, error } = await admin.rpc("create_hidden_chat_access_grant", {
      p_user_id: user.id,
      p_conversation_id: typeof conversationId === "string" ? conversationId : null,
      p_token_hash: tokenHash,
    });
    if (error || typeof expiresAt !== "string") {
      throw new Error("Hidden Chats access could not be created.");
    }

    return respond({ success: true, grant, expiresAt });
  } catch {
    return respond({ error: "Hidden Chats PIN is unavailable. Try again later." }, 503);
  }
}
