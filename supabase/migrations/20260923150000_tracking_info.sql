-- Milloin uusien pikalaturien kirjaus todella alkoi.
--
-- "Uudet pikalaturit" -lista näytti aloituspäivänä vanhimman
-- locations.first_seen_at -arvon (18.6.2026). Se on väärä: se on aineiston
-- keruun alku, ei uusien laturien tunnistuksen alku. Ensiesiintyminen alettiin
-- kirjata vasta migraatiossa 20260923120000_first_seen.sql, ja sen takautuva
-- täyttö antoi KAIKILLE siihen asti kertyneille asemille saman aikaleiman —
-- myös niille, jotka olivat ilmestyneet vasta heinä- tai elokuussa. Niitä ei
-- siis voi erottaa toisistaan, eikä lista voi näyttää niitä.
--
-- Oikea aloitushetki on tuon migraation ajohetki, joka on tallessa
-- schema_migrations-taulussa.
--
-- OIKEUDET
-- Näkymä ajetaan omistajan oikeuksilla (EI security_invoker), koska
-- schema_migrations on RLS:n takana ilman yhtään politiikkaa eikä sinne haluta
-- avata suoraa lukuoikeutta. Näkymä palauttaa vain yhden aikaleiman, ja
-- select-oikeus annetaan vain kirjautuneelle.
create or replace view public.tracking_info as
select
  (select applied_at
     from public.schema_migrations
    where name = '20260923120000_first_seen.sql') as new_chargers_since;

comment on view public.tracking_info is
  'new_chargers_since = milloin laturien ensiesiintymisen kirjaus otettiin
   käyttöön. Sitä vanhempia uusia asemia tai laajennuksia ei voi tunnistaa.';

revoke all on public.tracking_info from anon;
grant select on public.tracking_info to authenticated;

notify pgrst, 'reload schema';
