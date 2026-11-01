import { NextResponse, type NextRequest } from "next/server";
import {
  consumeAuthAttempt,
  createSupabaseAdminClient,
  createSupabaseCookieClient,
  getClientAddress,
  isSameOriginAuthRequest,
  usernameAuthEmail,
} from "@/lib/auth/server";
import { signUpSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json({ error: "This registration request is not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Check the registration details and try again." }, { status: 400 });
  }

  const result = signUpSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0]?.message ?? "Check the registration details and try again." },
      { status: 400 },
    );
  }

  try {
    const allowed = await consumeAuthAttempt(result.data.username, getClientAddress(request));
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Wait 15 minutes and try again." },
        { status: 429 },
      );
    }

    const email = usernameAuthEmail(result.data.username);
    const admin = createSupabaseAdminClient();
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: result.data.password,
      user_metadata: {
        username: result.data.username,
        display_name: result.data.displayName,
        is_private: result.data.isPrivate,
      },
    });

    if (createError) {
      console.error("Username registration failed:", createError.message);
      return NextResponse.json(
        { error: "That username is already taken. Choose another username." },
        { status: 409 },
      );
    }

    const auth = await createSupabaseCookieClient();
    const { error: signInError } = await auth.auth.signInWithPassword({
      email,
      password: result.data.password,
    });

    if (signInError) {
      console.error("New account sign-in failed:", signInError.message);
      return NextResponse.json(
        { error: "Your account was created. Sign in with your username and password to continue." },
        { status: 503 },
      );
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Username registration is unavailable:", error instanceof Error ? error.message : "Unknown server error");
    return NextResponse.json(
      { error: "Username registration is not configured. Check the server environment and PANDA auth migration." },
      { status: 503 },
    );
  }
}
