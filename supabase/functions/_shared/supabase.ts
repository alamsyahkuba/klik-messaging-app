import { createClient } from "npm:@supabase/supabase-js@2";

/** Client dengan SERVICE ROLE - hanya untuk Edge Functions (bypass RLS). */
export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum tersedia di secret");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
