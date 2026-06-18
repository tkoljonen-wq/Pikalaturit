// Luo sovelluksen ainoan käyttäjän Supabase Admin API:lla (service_role).
// Ajetaan: node --env-file=.env scripts/create-user.mjs
//
// Lukee .env:stä: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_USER_EMAIL, APP_USER_PASSWORD.
// Idempotentti: jos käyttäjä on jo olemassa, päivittää salasanan.

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_USER_EMAIL, APP_USER_PASSWORD } =
  process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Puuttuu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env).");
  process.exit(1);
}
if (!APP_USER_EMAIL || !APP_USER_PASSWORD) {
  console.error("Puuttuu APP_USER_EMAIL / APP_USER_PASSWORD (.env).");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Onko käyttäjä jo olemassa?
const { data: list, error: listErr } = await admin.auth.admin.listUsers();
if (listErr) {
  console.error("Käyttäjälistan haku epäonnistui:", listErr.message);
  process.exit(1);
}
const existing = list.users.find(
  (u) => u.email?.toLowerCase() === APP_USER_EMAIL.toLowerCase(),
);

if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password: APP_USER_PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error("Salasanan päivitys epäonnistui:", error.message);
    process.exit(1);
  }
  console.log(`Käyttäjä oli jo olemassa (${APP_USER_EMAIL}) — salasana päivitetty.`);
} else {
  const { error } = await admin.auth.admin.createUser({
    email: APP_USER_EMAIL,
    password: APP_USER_PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error("Käyttäjän luonti epäonnistui:", error.message);
    process.exit(1);
  }
  console.log(`Käyttäjä luotu: ${APP_USER_EMAIL}`);
}
