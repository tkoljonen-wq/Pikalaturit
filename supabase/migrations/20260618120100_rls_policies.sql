-- Row Level Security (suunnitelma §14)
--
-- Uhkamalli: PWA lukee suoraan Supabasesta, ja anon-avain päätyy julkiseen
-- GitHub Pages -bundleen. RLS on siksi ainoa todellinen pääsynrajaus.
--
--   * anon-rooli: EI pääsyä mihinkään (ei luku- eikä kirjoituspolitiikkoja).
--     Sovellukseen pääsee vain kirjautumalla (Supabase Auth, vain oma tili sallittu).
--   * authenticated-rooli: lukee avoimen datan taulut ja oman watchlistinsä.
--   * service_role (collector, GitHub Actions): ohittaa RLS:n automaattisesti,
--     joten kirjoituspolitiikkoja ei tarvita — kirjoitus on vain collectorilla.

alter table public.locations                   enable row level security;
alter table public.evses                        enable row level security;
alter table public.connectors                   enable row level security;
alter table public.latest_station_status        enable row level security;
alter table public.national_snapshots           enable row level security;
alter table public.watchlist                    enable row level security;
alter table public.watchlist_station_snapshots  enable row level security;
alter table public.collector_runs               enable row level security;

-- ── Avoin data: luku kirjautuneelle, kirjoitus vain collectorille ──────────

create policy "auth read locations"
  on public.locations for select to authenticated using (true);

create policy "auth read evses"
  on public.evses for select to authenticated using (true);

create policy "auth read connectors"
  on public.connectors for select to authenticated using (true);

create policy "auth read latest_station_status"
  on public.latest_station_status for select to authenticated using (true);

create policy "auth read national_snapshots"
  on public.national_snapshots for select to authenticated using (true);

create policy "auth read collector_runs"
  on public.collector_runs for select to authenticated using (true);

-- watchlist_station_snapshots ei sisällä user_id:tä eikä henkilötietoa.
-- Yhden käyttäjän sovelluksessa luku kaikille kirjautuneille on riittävä.
create policy "auth read watchlist_snapshots"
  on public.watchlist_station_snapshots for select to authenticated using (true);

-- ── Watchlist: vain omistaja näkee ja muokkaa ─────────────────────────────

create policy "owner select watchlist"
  on public.watchlist for select to authenticated
  using (user_id = (select auth.uid()));

create policy "owner insert watchlist"
  on public.watchlist for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner update watchlist"
  on public.watchlist for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner delete watchlist"
  on public.watchlist for delete to authenticated
  using (user_id = (select auth.uid()));
