import { createSupabaseServerClient } from "@/lib/supabase/server";
import { connection } from "next/server";

const noStoreHeaders = { "Cache-Control": "no-store" };

function respond(status: "available" | "missing_or_inaccessible" | "configuration_unavailable") {
  return Response.json({ status }, { headers: noStoreHeaders });
}

export async function GET() {
  await connection();

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return respond("configuration_unavailable");
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return respond("configuration_unavailable");
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return respond("configuration_unavailable");
    }

    const { error } = await supabase
      .from("hidden_chat_preferences")
      .select("user_id,conversation_id,is_hidden,muted_until,hide_notification_preview,updated_at")
      .limit(0);

    return respond(error ? "missing_or_inaccessible" : "available");
  } catch {
    return respond("missing_or_inaccessible");
  }
}
