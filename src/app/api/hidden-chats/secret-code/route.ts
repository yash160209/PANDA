import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, isSameOriginAuthRequest } from "@/lib/auth/server";
import { hashSecretCode, isValidSecretCode, verifyPin, type PinCredential } from "@/lib/hidden-chats/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const invalidSettingsMessage = "Secret Code settings could not be updated.";

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to manage your Secret Code." }, 401);

    const { data, error } = await supabase.rpc("has_hidden_chat_entry_code");
    if (error || typeof data !== "boolean") {
      return respond({ error: "Secret Code settings could not be loaded." }, 503);
    }
    return respond({ hasSecretCode: data });
  } catch {
    return respond({ error: "Secret Code settings could not be loaded." }, 503);
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
    return respond({ error: invalidSettingsMessage }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ error: invalidSettingsMessage }, 400);
  }

  const { currentPin, newCode, confirmCode } = body as Record<string, unknown>;
  if (
    typeof currentPin !== "string"
    || !isValidSecretCode(newCode)
    || newCode !== confirmCode
  ) {
    return respond({ error: invalidSettingsMessage }, 400);
  }

  try {
    const authenticatedClient = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await authenticatedClient.auth.getUser();
    if (authError || !user) return respond({ error: "Sign in to manage your Secret Code." }, 401);

    const admin = createSupabaseAdminClient();
    const { data: pinData, error: pinLoadError } = await admin
      .from("hidden_chat_pin_credentials")
      .select("salt,pin_hash,iterations")
      .eq("user_id", user.id)
      .maybeSingle();
    if (pinLoadError) return respond({ error: invalidSettingsMessage }, 503);
    if (!pinData) {
      return respond({ error: "Set up your Hidden Chats PIN before choosing a Secret Code." }, 409);
    }

    const { data: attemptCount, error: attemptError } = await admin.rpc(
      "consume_hidden_chat_pin_attempt",
      { p_user_id: user.id },
    );
    if (attemptError || typeof attemptCount !== "number") {
      return respond({ error: invalidSettingsMessage }, 503);
    }
    if (attemptCount > 5) {
      return respond({ error: "PIN verification is temporarily unavailable. Try again later." }, 429);
    }

    const pinCredential: PinCredential = {
      salt: pinData.salt,
      pin_hash: pinData.pin_hash,
      iterations: pinData.iterations,
    };
    if (!(await verifyPin(currentPin, pinCredential))) {
      return respond({ error: "The PIN could not be verified." }, 401);
    }

    const { error: resetError } = await admin.rpc("reset_hidden_chat_pin_attempts", {
      p_user_id: user.id,
    });
    if (resetError) return respond({ error: invalidSettingsMessage }, 503);

    const hashed = await hashSecretCode(newCode);
    const { error: saveError } = await admin.rpc("save_hidden_chat_entry_credential", {
      p_user_id: user.id,
      p_salt: hashed.salt,
      p_code_hash: hashed.pin_hash,
      p_iterations: hashed.iterations,
    });
    if (saveError) return respond({ error: invalidSettingsMessage }, 503);

    return respond({ success: true });
  } catch {
    return respond({ error: invalidSettingsMessage }, 503);
  }
}
