// TEMPORARY: remove this route after the Supabase connectivity check.
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { connection } from "next/server";

const noStoreHeaders = { "Cache-Control": "no-store" };

function unavailable(category: string) {
  console.error(`Temporary Supabase probe failure category: ${category}`);
  return Response.json(
    { status: "unavailable" },
    { status: 503, headers: noStoreHeaders },
  );
}

export async function GET() {
  await connection();

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return unavailable("missing_public_configuration");
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return unavailable("server_client_setup_failure");
  }

  try {
    const { error } = await supabase.from("profiles").select("id").limit(0);

    if (error) {
      return unavailable("query_rejected");
    }

    return Response.json({ status: "ok" }, { headers: noStoreHeaders });
  } catch (error) {
    return unavailable(
      error instanceof TypeError
        ? "transport_failure"
        : "query_execution_failure",
    );
  }
}
