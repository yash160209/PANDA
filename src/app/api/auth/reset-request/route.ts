import { NextResponse, type NextRequest } from "next/server";
import {
  consumeAuthAttempt,
  createSupabaseAdminClient,
  createSupabaseAuthClient,
  getClientAddress,
  isSameOriginAuthRequest,
} from "@/lib/auth/server";
import { resetRequestSchema } from "@/lib/validation/auth";

const responseMessage =
  "If this account has a recovery method, a password reset link will be sent.";

export async function POST(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json({ error: "This request is not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your username." }, { status: 400 });
  }

  const result = resetRequestSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0]?.message ?? "Enter a valid username." },
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
      console.error("Password recovery profile lookup failed:", profileError.message);
      return NextResponse.json({ error: "Password recovery is temporarily unavailable." }, { status: 503 });
    }

    if (profile) {
      const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.id);
      if (userError) {
        console.error("Password recovery identity lookup failed:", userError.message);
        return NextResponse.json({ error: "Password recovery is temporarily unavailable." }, { status: 503 });
      }

      const email = userResult.user?.email;
      if (email && !email.endsWith("@users.panda.invalid")) {
        const auth = createSupabaseAuthClient();
        const { error: resetError } = await auth.auth.resetPasswordForEmail(email, {
          redirectTo: `${request.nextUrl.origin}/auth/callback?next=/reset-password`,
        });
        if (resetError) {
          console.error("Password reset email could not be sent:", resetError.message);
          return NextResponse.json({ error: "Password recovery is temporarily unavailable." }, { status: 503 });
        }
      }
    }

    return NextResponse.json({ message: responseMessage });
  } catch (error) {
    console.error("Password recovery is unavailable:", error instanceof Error ? error.message : "Unknown server error");
    return NextResponse.json(
      { error: "Password recovery is not configured. Check the server environment and PANDA auth migration." },
      { status: 503 },
    );
  }
}
