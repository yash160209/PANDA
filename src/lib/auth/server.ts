import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !publishableKey || !serviceRoleKey) {
    throw new Error("Username authentication is not configured on the server.");
  }

  return { url, publishableKey, serviceRoleKey };
}

export function isSameOriginAuthRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const parsedOrigin = new URL(origin);
    const requestHosts = new Set([
      request.nextUrl.host,
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
      request.headers.get("host"),
    ]);
    const requestProtocols = new Set([
      request.nextUrl.protocol,
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
        ? `${request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()}:`
        : undefined,
    ]);

    return requestHosts.has(parsedOrigin.host) && requestProtocols.has(parsedOrigin.protocol);
  } catch {
    return false;
  }
}

export async function createSupabaseCookieClient() {
  const { url, publishableKey } = getSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });
}

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function createSupabaseAuthClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function getClientAddress(request: NextRequest) {
  const address =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";

  return address.slice(0, 64);
}

export async function consumeAuthAttempt(
  username: string,
  clientAddress: string,
) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("consume_username_auth_attempt", {
    p_username: username,
    p_client_address: clientAddress,
  });

  if (error) {
    console.error("Username authentication rate limit failed:", error.message);
    throw new Error("Username authentication is not ready. Apply the PANDA auth migration.");
  }

  return data === true;
}

export function usernameAuthEmail(username: string) {
  return `${username}@users.panda.invalid`;
}
