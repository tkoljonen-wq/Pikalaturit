import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Näkyy konsolissa jos .env.local puuttuu kehityksessä.
  console.error("Puuttuu VITE_SUPABASE_URL tai VITE_SUPABASE_ANON_KEY (.env.local).");
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
