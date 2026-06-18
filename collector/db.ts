import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase-asiakas service_role-avaimella. Ohittaa RLS:n → vain collector
 * kirjoittaa. Avain luetaan ympäristömuuttujasta (GitHub Actions secret),
 * EI koskaan frontendiin.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Puuttuvat ympäristömuuttujat: SUPABASE_URL ja SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Heittää, jos Supabase-vastaus sisältää virheen. */
export function unwrap<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(`Supabase: ${JSON.stringify(res.error)}`);
  return res.data;
}
