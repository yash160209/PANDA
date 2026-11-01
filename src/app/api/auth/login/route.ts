import { NextResponse, type NextRequest } from "next/server";
import {
  consumeAuthAttempt,
  createSupabaseAdminClient,
  createSupabaseCookieClient,
  getClientAddress,
  isSameOriginAuthRequest,
} from "@/lib/auth/server";
import { signInSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json({ error: "This sign-in request is not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const result = signInSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0]?.message ?? "Check your username and password." },
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

    const admin = createSupabaseAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("username", result.data.username)
      .maybeSingle();

    if (profileError) {
      console.error("Username sign-in profile lookup failed:", profileError.message);
      return NextResponse.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 503 });
    }
    if (!profile) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.id);
    const email = userResult.user?.email;
    if (userError || !email) {
      if (userError) console.error("Username sign-in identity lookup failed:", userError.message);
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    const auth = await createSupabaseCookieClient();
    const { error: signInError } = await auth.auth.signInWithPassword({
      email,
      password: result.data.password,
    });

    if (signInError) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Username sign-in failed:", error instanceof Error ? error.message : "Unknown server error");
    return NextResponse.json(
      { error: "Username sign-in is not configured. Check the server environment and PANDA auth migration." },
      { status: 503 },
    );
  }
}
