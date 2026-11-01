import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginAuthRequest } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountPrivacySchema } from "@/lib/validation/profile";

export async function PATCH(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json({ error: "This profile update is not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose a valid account privacy setting." }, { status: 400 });
  }

  const parsed = accountPrivacySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid account privacy setting." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Sign in to update account privacy." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ is_private: parsed.data.isPrivate })
      .eq("id", user.id)
      .select("is_private")
      .single();
    if (error) {
      console.error("Server-side account privacy update failed:", error.message);
      return NextResponse.json({ error: "We couldn't save your account privacy setting." }, { status: 500 });
    }

    return NextResponse.json({ isPrivate: data.is_private });
  } catch (error) {
    console.error("Account privacy service is unavailable:", error instanceof Error ? error.message : "Unknown server error");
    return NextResponse.json({ error: "Account privacy is unavailable. Please try again." }, { status: 503 });
  }
}
