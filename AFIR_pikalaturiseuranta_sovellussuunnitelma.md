# AFIR-pikalaturiseurannan PWA-sovellus – suunnitelma tekoälylle / kehittäjälle

Päivitetty: 18.6.2026  
Käyttötarkoitus: yksityinen oma käyttö, ei kaupallinen palvelu  
Pikalaturin raja: **50 kW**

---

## 1. Projektin tavoite

Toteuta yksityiseen käyttöön tarkoitettu PWA-sovellus, joka hyödyntää Fintrafficin / Digitrafficin AFIR-latausdataa.

Sovelluksen kaksi päätavoitetta:

1. **Valtakunnallinen tilastoseuranta**
   - Kerää 5 minuutin välein tieto siitä, kuinka monta lataajaa Suomessa on sillä hetkellä pikalatureilla.
   - Laskennan perusluku on pikalaturi-EVSE:t, joiden status on `CHARGING`.
   - Tallenna myös vapaat, varatut, blokatut, epäkunnossa olevat ja tuntemattomat pikalaturit.

2. **Valittujen latausasemien seuranta**
   - Käyttäjä voi valita seurattavia latausasemia.
   - Sovellus näyttää reaaliaikaisesti tai lähes reaaliaikaisesti, montako pikalaturia valitulla asemalla on vapaana, latauksessa, varattuna, epäkunnossa tai tuntemattomassa tilassa.
   - Käyttötilanne: käyttäjä suunnittelee latauspysähdyksen tietylle paikkakunnalle ja haluaa seurata alueen latureiden varaustilannetta etukäteen.

Toteutuksessa ei tehdä julkista kaupallista palvelua. Sovelluksen tulee kuitenkin olla teknisesti siisti ja noudattaa Digitrafficin käyttöehtoja ja lähdeviittausta.

---

## 2. Käytettävät tietolähteet

### 2.1 Digitraffic AFIR

Digitraffic julkaisee AFIR-dataa avoimena datana. Data sisältää sähköautojen latauspisteiden sijainteja sekä niihin liittyvää staattista ja reaaliaikaista tietoa.

Päädokumentaatio:

```text
https://www.digitraffic.fi/tieliikenne/afir/
```

Swagger:

```text
https://afir.digitraffic.fi/swagger-ui/
```

Keskeiset REST-rajapinnat:

```text
https://afir.digitraffic.fi/api/charging-network/v1/operators
https://afir.digitraffic.fi/api/charging-network/v1/locations
https://afir.digitraffic.fi/api/charging-network/v1/locations/all
https://afir.digitraffic.fi/api/charging-network/v1/locations/statuses
https://afir.digitraffic.fi/api/charging-network/v1/locations/statuses/all
https://afir.digitraffic.fi/api/charging-network/v1/tariffs
```

Lisäksi saatavilla on Datex II -rajapintoja, mutta tässä projektissa käytetään ensisijaisesti JSON/GeoJSON-muotoisia rajapintoja.

### 2.2 Koosteet ja päivitystiheys

Digitrafficin dokumentaation mukaan sivutettavista rajapinnoista on saatavana minuutin välein muodostettavat koosteet. Koosteen voi hakea lisäämällä URL:n loppuun `/all` tai käyttämällä `limit=ALL`.

Tässä projektissa käytetään suoraan snapshot-endpointteja, esimerkiksi:

```text
https://afir.digitraffic.fi/api/charging-network/v1/locations/statuses/all
```

Koska snapshot muodostetaan minuutin välein, 5 minuutin keruuväli on riittävän kevyt ja teknisesti järkevä.

### 2.3 MQTT reaaliaikaisiin statuksiin

Digitraffic tarjoaa AFIR-statukset myös MQTT over WebSocket -rajapintana.

Tuotanto:

```text
wss://afir.digitraffic.fi:443/mqtt
```

Testi:

```text
wss://afir-test.digitraffic.fi:443/mqtt
```

Topic-muoto:

```text
status-v1/<operatorCountryCode>/<operatorPartyId>/<locationId>/<evseId>
```

Esimerkki:

```text
status-v1/FI/NYT/FINYT00001/FI*NYT*E12345
```

Jos halutaan kuunnella kaikki tietyn operaattorin statukset:

```text
status-v1/FI/NYT/#
```

Jos halutaan kuunnella kaikki tietyn aseman EVSE-statukset:

```text
status-v1/FI/<operatorPartyId>/<locationId>/#
```

MVP-vaiheessa MQTT:tä ei tarvitse vielä toteuttaa. Aloita REST-pollauksella ja lisää MQTT toisessa vaiheessa.

---

## 3. Lisenssi, käyttöehdot ja lähdeviittaus

Digitrafficin avoin data on lisensoitu **Creative Commons 4.0 BY** -lisenssillä. Se sallii datan jakelun, muokkaamisen ja hyödyntämisen myös kaupallisesti, kun alkuperäinen lähde mainitaan asianmukaisesti.

Tämän projektin käyttö on vain yksityistä, mutta lähdeviittaus kannattaa silti lisätä sovellukseen.

Lisenssi- ja käyttöehtosivu:

```text
https://www.digitraffic.fi/en/terms-of-service/
```

Sovellukseen lisättävä lähdemerkintä esimerkiksi:

```text
Lähde: Fintraffic / Digitraffic, CC BY 4.0. Dataa on aggregoitu ja käsitelty sovelluksessa.
```

Jos sovellus näyttää lähdetiedot englanniksi:

```text
Source: Fintraffic / Digitraffic, CC BY 4.0. Data has been aggregated and processed by this application.
```

---

## 4. Rajapintojen käyttöohjeet ja rajoitukset

Digitraffic suosittelee HTTP-kutsuihin `Digitraffic-User`-headeria. Headeriin ei saa laittaa henkilötietoja, kuten omaa nimeä tai sähköpostiosoitetta.

Esimerkki:

```http
Digitraffic-User: PrivateAFIRTracker/1.0
Accept-Encoding: gzip
```

Tärkeää:

- Älä lähetä henkilötietoja `Digitraffic-User`-headerissa.
- Käytä gzip-pakkausta.
- Huomioi mahdolliset `429 Too Many Requests` -vastaukset.
- Ilman `Digitraffic-User`-headeria yleinen rajoitus on 60 pyyntöä minuutissa per IP.
- MQTT:ssä yleinen rajoitus ilman tunnisteita on 5 per IP.
- 5 minuutin välein tehtävä yksi statuskutsu ja harvempi metadatahaku ovat selvästi maltillisia.

Käyttöohjeet:

```text
https://www.digitraffic.fi/en/support/instructions/
```

---

## 5. Tekninen päälinja

Toteuta sovellus mallilla:

```text
Digitraffic AFIR
   |
   | 5 minuutin välein
   v
Collector / ajastettu taustatehtävä
   |
   v
Supabase PostgreSQL
   |
   v
PWA-sovellus
```

Pelkkä PWA ei riitä jatkuvaan 5 minuutin välein tapahtuvaan tilastokeruuseen, koska selain ei voi luotettavasti ajaa taustalla ympäri vuorokauden. Siksi tarvitaan erillinen ajastettu collector.

---

## 6. Suositeltu teknologiavalinta

### Frontend

```text
Vite + React + TypeScript
PWA-tuki
Leaflet tai MapLibre karttaan
Chart.js, ECharts tai Recharts kuvaajiin
```

### Backend / tietokanta

```text
Supabase PostgreSQL
Supabase Auth tai muu kevyt pääsynrajaus
Row Level Security käyttöön
```

### Collector

Ensisijainen vaihtoehto:

```text
GitHub Actions cron + Node.js/TypeScript-scripti
```

Vaihtoehtoisesti:

```text
Supabase Edge Function + Scheduled Trigger
```

GitHub Actions on ensimmäiseen yksityiseen MVP-versioon todennäköisesti yksinkertaisin ja maksuton tai lähes maksuton vaihtoehto. Supabase Edge Functions on siistimpi, jos ajastettu käyttö mahtuu Supabasen ilmaistason rajoihin.

### Supabasen maksuttomuus

Tavoitteena on pysyä **Supabase Free** -tasolla.

Supabasen oma dokumentaatio kertoo, että Free Plan on olemassa ja että siihen sisältyy kaksi ilmaista projektia. Dokumentaatiossa mainitaan myös käyttökiintiöitä, kuten 500 MB tietokantakoko per projekti, 5 GB egress, 1 GB storage ja 500 000 Edge Function -kutsua. Nämä voivat muuttua, joten toteutusvaiheessa tarkista ajantasainen tilanne:

```text
https://supabase.com/docs/guides/platform/billing-on-supabase
https://supabase.com/pricing
```

Toteutus pitää suunnitella niin, ettei kaikkien Suomen latausasemien 5 minuutin historiadataa tallenneta pysyvästi. Muuten ilmaistason tietokantaraja voi tulla nopeasti vastaan.

---

## 7. Pikalaturin määritelmä

Käytä tässä sovelluksessa pikalaturin rajana:

```text
fastChargerMinPowerKw = 50
```

Pikalaturi lasketaan mukaan, jos:

```text
EVSE tai latauslaite sisältää DC-liittimen
JA
maksimiteho on vähintään 50 kW
```

Jos tehotieto puuttuu:

```text
power_unknown = true
```

MVP:ssä puuttuvan tehotiedon EVSE:tä ei lasketa oletuksena pikalaturiksi. Myöhemmin asetuksiin voidaan lisätä valinta:

```text
Sisällytä tuntemattoman tehon DC-laturit pikalaturitilastoon: kyllä/ei
```

---

## 8. Statusluokittelu

Luo keskitetty statusluokittelufunktio. Älä käytä statusarvoja hajautetusti ympäri koodia.

Suositeltu luokittelu:

| Raw status | Sovelluksen luokka | Selite |
|---|---|---|
| `AVAILABLE` | `available` | Vapaa |
| `CHARGING` | `charging` | Latauksessa / aktiivinen lataaja |
| `RESERVED` | `reserved` | Varattu |
| `BLOCKED` | `blocked` | Ei käytettävissä / blokattu |
| `INOPERATIVE` | `out_of_order` | Epäkunnossa |
| `OUTOFORDER` | `out_of_order` | Epäkunnossa |
| `UNKNOWN` | `unknown` | Tuntematon |
| puuttuva status | `unknown` | Tuntematon |
| `PLANNED` | `excluded` | Ei lasketa käytettävissä olevaan kapasiteettiin |
| `REMOVED` | `excluded` | Ei lasketa käytettävissä olevaan kapasiteettiin |
| muu status | `other_status` | Tallenna raw-muodossa ja käsittele myöhemmin |

Pääluku:

```text
active_charging_count = pikalaturi-EVSE:t, joiden status on CHARGING
```

Lisäluku käyttäjän kannalta:

```text
not_available_count = CHARGING + RESERVED + BLOCKED + OUTOFORDER + INOPERATIVE + UNKNOWN
```

Käyttöaste:

```text
occupancy_percent = fast_charging / fast_total * 100
```

Käytännön saatavuusprosentti:

```text
unavailable_percent = not_available_count / fast_total * 100
```

Huomio:

- `charging` kertoo tiukasti, montako lataajaa on latauksessa.
- `not_available` kertoo käyttäjän kannalta, montako paikkaa ei ole vapaana.
- Näytä nämä erillisinä lukuina, älä sekoita niitä.

---

## 9. Tietokantamalli

Käytä PostgreSQL-tietokantaa Supabasessa.

### 9.1 `locations`

Latausasemien ja pikalaturikapasiteetin perustiedot.

```sql
locations
- id text primary key
- name text
- operator_name text
- operator_country_code text
- operator_party_id text
- latitude double precision
- longitude double precision
- address text
- city text
- country text
- max_power_kw numeric
- fast_evse_count integer
- total_evse_count integer
- raw_updated_at timestamptz
- synced_at timestamptz not null default now()
```

MVP:ssä `locations` voi olla asematasoinen. Jos EVSE- ja connector-tason tarkkuutta tarvitaan, lisää erilliset taulut `evses` ja `connectors`.

### 9.2 `evses`

Suositeltava erillinen taulu, jotta pikalaturisuodatus voidaan tehdä oikein.

```sql
evses
- id text primary key
- location_id text references locations(id)
- evse_uid text
- evse_id text
- operator_country_code text
- operator_party_id text
- max_power_kw numeric
- has_dc_connector boolean
- is_fast_charger boolean
- power_unknown boolean
- raw_updated_at timestamptz
- synced_at timestamptz not null default now()
```

### 9.3 `connectors`

Liitinkohtaiset tiedot.

```sql
connectors
- id text primary key
- evse_id text references evses(id)
- connector_uid text
- standard text
- format text
- power_type text
- max_voltage integer
- max_amperage integer
- max_electric_power integer
- max_power_kw numeric
```

### 9.4 `latest_station_status`

Kaikkien asemien viimeisin aggregoitu tilanne. Tätä päivitetään jokaisella collector-ajolla.

```sql
latest_station_status
- location_id text primary key references locations(id)
- fast_total integer
- fast_available integer
- fast_charging integer
- fast_reserved integer
- fast_blocked integer
- fast_out_of_order integer
- fast_unknown integer
- fast_other integer
- occupancy_percent numeric
- unavailable_percent numeric
- updated_at timestamptz
- data_age_seconds integer
```

Tätä taulua käytetään kartalla ja paikkakuntahaussa. Tallenna vain viimeisin status, älä historiadataa kaikista asemista.

### 9.5 `national_snapshots`

Suomen valtakunnallinen 5 minuutin aikasarja. Tämä kannattaa säilyttää pitkään.

```sql
national_snapshots
- id bigint generated always as identity primary key
- measured_at timestamptz not null
- fast_total integer not null
- fast_available integer not null
- fast_charging integer not null
- fast_reserved integer not null
- fast_blocked integer not null
- fast_out_of_order integer not null
- fast_unknown integer not null
- fast_other integer not null default 0
- occupancy_percent numeric
- unavailable_percent numeric
- data_source_updated_at timestamptz
- created_at timestamptz not null default now()
```

Indeksi:

```sql
create index national_snapshots_measured_at_idx
on national_snapshots (measured_at desc);
```

### 9.6 `watchlist`

Käyttäjän valitsemat seurattavat asemat.

```sql
watchlist
- id bigint generated always as identity primary key
- user_id uuid
- location_id text references locations(id)
- display_name text
- sort_order integer
- created_at timestamptz not null default now()
```

Jos sovellus on aidosti vain yhdelle käyttäjälle, `user_id` voi olla aluksi vapaaehtoinen, mutta lisää se silti jatkokehitystä varten.

### 9.7 `watchlist_station_snapshots`

Vain watchlist-asemien 5 minuutin historia.

```sql
watchlist_station_snapshots
- id bigint generated always as identity primary key
- location_id text references locations(id)
- measured_at timestamptz not null
- fast_total integer not null
- fast_available integer not null
- fast_charging integer not null
- fast_reserved integer not null
- fast_blocked integer not null
- fast_out_of_order integer not null
- fast_unknown integer not null
- fast_other integer not null default 0
- occupancy_percent numeric
- unavailable_percent numeric
- created_at timestamptz not null default now()
```

Indeksi:

```sql
create index watchlist_station_snapshots_location_time_idx
on watchlist_station_snapshots (location_id, measured_at desc);
```

Säilytysaika:

```text
MVP: 180 päivää
```

Lisää siivousajo, joka poistaa yli 180 päivää vanhat watchlist-rivit.

### 9.8 `collector_runs`

Collectorin ajoloki.

```sql
collector_runs
- id bigint generated always as identity primary key
- started_at timestamptz not null
- finished_at timestamptz
- success boolean not null
- error_message text
- status_count integer
- location_count integer
- duration_ms integer
- created_at timestamptz not null default now()
```

---

## 10. Datan määrän arviointi

5 minuutin keruuväli:

```text
12 mittausta / tunti
288 mittausta / vuorokausi
105 120 mittausta / vuosi
```

Valtakunnallinen aikasarja:

```text
noin 105 120 riviä / vuosi
```

Tämä on PostgreSQL:lle pieni määrä.

Watchlist-asemat:

```text
20 asemaa × 105 120 mittausta/vuosi = noin 2,1 miljoonaa riviä/vuosi
```

Tämäkin on PostgreSQL:lle teknisesti hallittavissa, mutta Supabase Free -tason tallennustila voi tulla vastaan. Siksi:

- Säilytä valtakunnallinen aikasarja pitkään.
- Säilytä watchlist-asemien historia esimerkiksi 180 päivää.
- Säilytä kaikista Suomen asemista vain viimeisin aggregoitu tilanne.
- Älä tallenna koko AFIR-raakadataa pysyvästi.

---

## 11. Collectorin toiminta

Collector on ajastettu taustaprosessi, joka ajaa 5 minuutin välein.

### 11.1 Metadata-synkronointi

Aja esimerkiksi kerran vuorokaudessa:

```text
GET /api/charging-network/v1/locations/all
GET /api/charging-network/v1/operators
GET /api/charging-network/v1/tariffs
```

Tehtävät:

1. Hae latausasemien metadata.
2. Parsii location-, EVSE- ja connector-rakenteet.
3. Laske, mitkä EVSE:t ovat pikalatureita.
4. Päivitä `locations`, `evses` ja `connectors`.
5. Älä poista heti asemia, jotka puuttuvat yksittäisestä hausta; merkitse ne ensin vanhentuneiksi.

### 11.2 Statuskeruu 5 minuutin välein

Aja 5 minuutin välein:

```text
GET /api/charging-network/v1/locations/statuses/all
```

Pseudologiikka:

```text
start collector run

fetch statuses/all
parse status records
join statuses to evses and locations
filter evses where is_fast_charger = true
classify statuses

calculate national aggregate:
  fast_total
  fast_available
  fast_charging
  fast_reserved
  fast_blocked
  fast_out_of_order
  fast_unknown
  fast_other
  occupancy_percent
  unavailable_percent

upsert latest_station_status for all stations

insert national_snapshots row

read watchlist
for each watchlist location:
  insert watchlist_station_snapshots row

mark collector run success

on error:
  mark collector run failed
  keep previous latest_station_status
  do not insert misleading zero snapshot
```

### 11.3 Virheenkäsittely

Jos AFIR-kutsu epäonnistuu:

- Älä nollaa statuksia.
- Älä tallenna valtakunnalliseksi luvuksi nollaa.
- Tallenna epäonnistunut `collector_runs`-rivi.
- Näytä PWA:ssa viimeisin onnistunut päivitysaika.
- Tee retry maltillisesti, esimerkiksi seuraavassa normaalissa 5 minuutin ajossa.

Jos status ei täsmää metadataan:

- Tallenna varoitus lokiin.
- Älä kaada koko collector-ajoa.
- Laske tuntemattomat tapaukset `unknown`- tai `other_status`-luokkaan.

---

## 12. PWA:n näkymät

### 12.1 Etusivu: Suomen tilanne nyt

Näytä:

```text
Suomessa pikalatureilla latauksessa nyt: X
Vapaana olevia pikalaturi-EVSEjä: Y
Pikalaturi-EVSEjä yhteensä: Z
Käyttöaste: X / Z %
Ei vapaana käyttäjän kannalta: A %
Viimeisin päivitys: HH:MM
Datan ikä: N minuuttia
```

Lisäksi pieni status:

```text
Data OK
Data vanhaa
Collector-virhe
```

### 12.2 Kuvaajat

Näytä ainakin:

- Viimeiset 24 h: `fast_charging`
- Viimeiset 7 vrk: `fast_charging`
- Käyttöaste %
- Vapaat pikalaturit
- Epäkunnossa/tuntematon määrä

Jatkokehityksenä:

- keskimääräinen käyttöaste kellonajan mukaan
- arkipäivä vs viikonloppu
- minimi, maksimi ja mediaani valitulla aikavälillä

### 12.3 Paikkakuntahaku

Käyttäjä voi hakea esimerkiksi:

```text
Joutsa
Jyväskylä
Lahti
Oulu
Vierumäki
```

Toteutustapa MVP:ssä:

1. Käytä geokoodausta tai staattista Suomen kuntien koordinaattilistaa.
2. Hae asemat valitun paikkakunnan ympäriltä.
3. Anna käyttäjän valita säde:

```text
5 km
10 km
20 km
50 km
100 km
```

Asemien järjestysvaihtoehdot:

- lähin ensin
- eniten vapaita pikalatureita ensin
- suurin maksimiteho ensin
- operaattorin mukaan
- käyttöasteen mukaan

### 12.4 Karttanäkymä

Näytä kartalla pikalatausasemat.

Karttamerkin väri:

```text
vihreä = vähintään 2 vapaana
keltainen = 1 vapaana
punainen = 0 vapaana
harmaa = data vanhaa / tuntematon
```

Karttamerkkiä painamalla näytetään aseman kortti.

### 12.5 Aseman kortti

Näytä:

```text
Aseman nimi
Operaattori
Osoite
Paikkakunta
Etäisyys haetusta paikasta
Pikalatureita yhteensä
Vapaana
Latauksessa
Varattu
Blokattu
Epäkunnossa
Tuntematon
Maksimiteho
Liitintyypit
Hinta, jos saatavilla
Viimeisin päivitys
Datan ikä
```

Painikkeet:

```text
Lisää seurantaan
Poista seurannasta
Avaa navigointiin
Näytä historia
```

Navigointi voi MVP:ssä avata Google Maps -linkin:

```text
https://www.google.com/maps/search/?api=1&query=<lat>,<lon>
```

### 12.6 Watchlist-näkymä

Tämä on tärkein näkymä ajomatkaa varten.

Näytä käyttäjän valitsemat asemat isoina kortteina:

```text
ABC Joutsa
4 / 8 vapaana
3 latauksessa
1 epäkunnossa
Päivitetty 12:35
```

Kortin statusväri:

```text
vihreä = vähintään 2 vapaana
keltainen = 1 vapaana
punainen = 0 vapaana
harmaa = data vanhaa tai epävarmaa
```

PWA päivittää watchlist-näkymää sovelluksen ollessa auki esimerkiksi 30–60 sekunnin välein kysymällä omalta backendiltä uusimmat tiedot.

MVP endpoint:

```text
GET /api/watchlist/latest
```

Tai jos frontend lukee suoraan Supabasesta:

```text
select latest_station_status
where location_id in user's watchlist
```

### 12.7 Asetukset

Asetuksiin:

```text
Pikalaturin minimiteho: 50 kW
Sisällytä tuntemattoman tehon DC-laturit: kyllä/ei
Watchlist-historian säilytysaika: 180 päivää
Karttasäde oletuksena: 20 km
Päivitä watchlist-näkymä: 30 / 60 / 120 s
```

MVP:ssä minimiteho voi olla kiinteä 50 kW, mutta rakenna se koodissa konfiguraatioksi.

---

## 13. Reaaliaikaisuus

### 13.1 MVP: REST-pollaus

MVP:ssä riittää, että:

- collector hakee koko Suomen statukset 5 minuutin välein
- PWA hakee watchlistin uusimman tilanteen 30–60 sekunnin välein sovelluksen ollessa auki
- käyttäjä näkee aina datan iän

Tämä ei ole täysin reaaliaikainen, mutta käytännössä riittävän hyvä latauspysähdyksen suunnitteluun.

### 13.2 Vaihe 2: MQTT aktiivisille asemille

Toisessa vaiheessa lisää MQTT watchlist-asemille.

Periaate:

```text
Kun käyttäjä avaa aseman tai watchlist-näkymän:
  muodosta MQTT WebSocket -yhteys
  tilaa aktiivisten asemien topicit
  päivitä kortti heti statusmuutoksesta
  säilytä REST-snapshot fallbackina
```

Esimerkki topic:

```text
status-v1/FI/<operatorPartyId>/<locationId>/#
```

Vaatimukset:

- reconnect-logiikka
- yhteyden tilan näyttäminen
- fallback REST-dataan
- älä tee laajoja MQTT-tilauksia koko Suomen dataan selaimesta
- älä tallenna MQTT:n kautta saatua statusvirtaa loputtomasti ilman aggregointia

---

## 14. Tietosuoja ja pääsynrajaus

Vaikka lähdedata on avointa, käyttäjän watchlist ja käyttölogiikka ovat yksityistä tietoa. Älä jätä sovellusta avoimeksi internetiin ilman pääsynrajausta.

Suositeltu ratkaisu:

```text
Supabase Auth
Salli vain yksi oma Google-tili
Row Level Security päälle
```

MVP:n vaihtoehto:

```text
Yksinkertainen salasanasuojaus
```

Älä tallenna tarpeettomia henkilötietoja.

Tallenna watchlistiin vain:

```text
user_id
location_id
display_name
sort_order
created_at
```

---

## 15. Datan laadun näyttäminen

Sovelluksen pitää aina näyttää datan ikä.

Esimerkkejä:

```text
Päivitetty 2 min sitten
Viimeisin onnistunut päivitys 12:35
Data vanhaa: viimeisin onnistunut päivitys 18 min sitten
```

Jos data on yli 10 minuuttia vanhaa:

- älä näytä asemaa vihreänä
- merkitse tila epävarmaksi
- näytä selvä varoitus

Jos data on yli 30 minuuttia vanhaa:

- näytä valtakunnallinen lukema harmaana
- älä kutsu sitä reaaliaikaiseksi
- näytä “viimeisin onnistunut päivitys”

---

## 16. Testit

Tee testit ennen varsinaista käyttöliittymän viimeistelyä.

### 16.1 Parseritestit

Testaa:

- location id löytyy oikein
- EVSE id löytyy oikein
- operator party id löytyy oikein
- koordinaatit löytyvät oikein
- connector-tehot lasketaan oikein
- DC-liitin tunnistetaan
- puuttuva teho käsitellään oikein

### 16.2 Statusluokittelutestit

Testaa:

```text
AVAILABLE -> available
CHARGING -> charging
RESERVED -> reserved
BLOCKED -> blocked
INOPERATIVE -> out_of_order
OUTOFORDER -> out_of_order
UNKNOWN -> unknown
puuttuva -> unknown
PLANNED -> excluded
REMOVED -> excluded
muu -> other_status
```

### 16.3 Aggregaattitestit

Testaa:

- `CHARGING` lasketaan aktiiviseksi lataajaksi
- `AVAILABLE` lasketaan vapaaksi
- `RESERVED` ei ole vapaa
- `OUTOFORDER` ei ole vapaa eikä aktiivinen lataaja
- alle 50 kW ei kuulu pikalaturitilastoon
- AC-lataus ei kuulu pikalaturitilastoon
- DC 50 kW kuuluu mukaan
- DC 49 kW ei kuulu mukaan
- puuttuvan tehon DC-laturi käsitellään `power_unknown`-tapauksena

---

## 17. MVP:n toteutusvaiheet

### Vaihe 1: Dataselvitys

Älä aloita käyttöliittymästä.

Tee ensin:

```text
1. Hae sample /locations/all
2. Hae sample /locations/statuses/all
3. Hae sample /tariffs
4. Tallenna fixture-tiedostot testeihin
5. Dokumentoi todellinen JSON-rakenne
6. Varmista kenttäpolut:
   - location id
   - EVSE id
   - operator country code
   - operator party id
   - latitude
   - longitude
   - connector standard
   - power type
   - max power
   - status
   - status timestamp
```

Tärkeää: älä oleta kenttien nimiä OCPI-muistin perusteella, vaan tarkista todellinen AFIR JSON.

### Vaihe 2: Domain-malli ja parseri

Luo sisäinen malli:

```text
Location
Evse
Connector
EvseStatus
StationAggregate
NationalAggregate
```

Luo parseri, joka muuntaa AFIR-raakadatan tähän malliin.

Älä ripottele AFIR JSON -kenttäpolkuja ympäri sovellusta.

### Vaihe 3: Supabase-tietokanta

Tee:

```text
- taulut
- indeksit
- Row Level Security
- migration-tiedostot
- seed/test-fixturet
```

### Vaihe 4: Collector

Tee collector, joka:

```text
- hakee metadataa kerran päivässä
- hakee statuksia 5 minuutin välein
- laskee aggregaatit
- tallentaa national_snapshots
- päivittää latest_station_status
- tallentaa watchlist_station_snapshots vain watchlist-asemista
- kirjaa collector_runs-rivin
```

### Vaihe 5: PWA

Tee käyttöliittymä:

```text
- etusivu
- Suomen tilanne nyt
- 24 h kuvaaja
- 7 vrk kuvaaja
- paikkakuntahaku
- kartta
- aseman kortti
- watchlist
- asetukset
- lähde/lisenssi-näkymä
```

### Vaihe 6: Ensimmäinen oma käyttö

Kun MVP toimii:

```text
- lisää muutama vakioasema watchlistiin
- tarkista, että statukset vastaavat todellisuutta
- seuraa collector_runs-lokia
- varmista, että tietokannan koko ei kasva liian nopeasti
- tarkista Supabasen usage-näkymä
```

### Vaihe 7: MQTT ja ennusteet myöhemmin

Lisää vasta myöhemmin:

```text
- MQTT aktiivisille asemille
- käyttöaste-ennuste kellonajan ja viikonpäivän mukaan
- push-ilmoitus, jos valitulla asemalla vapautuu pikalaturi
- reittisuunnittelun tuki
```

---

## 18. Mitä ei tehdä MVP:ssä

Älä tee ensimmäiseen versioon:

```text
- reittisuunnittelua
- maksukortti- tai operaattorisopimusten logiikkaa
- julkisia käyttäjätilejä
- käyttäjäarvioita
- kaikkien asemien pysyvää 5 minuutin historiatallennusta
- kaikkien raakastatusten pysyvää tallennusta
- monen käyttäjän hallintaa
- monimutkaista ennustemallia
```

Pidä MVP rajattuna:

```text
keruu -> aggregointi -> tallennus -> näyttäminen
```

---

## 19. Kehittäjän / koodaavan tekoälyn lopullinen ohje

Käytä tätä kohtaa varsinaisena toteutuspromptina:

```text
Rakenna yksityiseen käyttöön tarkoitettu PWA-sovellus, joka hyödyntää Fintraffic/Digitraffic AFIR -latausdataa.

Käyttötarkoitus:
- Sovellus on vain yhden käyttäjän omaan käyttöön.
- Se ei ole kaupallinen julkinen palvelu.
- Sovellus seuraa Suomen pikalatureiden käyttöastetta ja valittujen latausasemien reaaliaikaista tai lähes reaaliaikaista statusta.

Teknologiat:
- Frontend: Vite + React + TypeScript + PWA
- Kartta: Leaflet tai MapLibre
- Kuvaajat: Chart.js, ECharts tai Recharts
- Tietokanta: Supabase PostgreSQL
- Auth: Supabase Auth, vain oma käyttäjä sallittu
- Collector: GitHub Actions cron tai Supabase Edge Function
- Data: Digitraffic AFIR REST, myöhemmin MQTT

Tärkein sääntö:
Älä aloita suoraan käyttöliittymästä. Tee ensin dataselvitys oikeasta AFIR JSON -datasta.

Dataselvitysvaihe:
1. Hae sample-data:
   - /api/charging-network/v1/locations/all
   - /api/charging-network/v1/locations/statuses/all
   - /api/charging-network/v1/tariffs
2. Dokumentoi todellinen JSON-rakenne.
3. Tee fixture-tiedostot testeihin.
4. Tee parseri, joka muuntaa AFIR-raakadatan sisäiseen domain-malliin.
5. Tee testit parserille, pikalaturisuodatukselle ja statusluokittelulle.

Pikalaturin määritelmä:
- Pikalaturi = DC-lataukseen kykenevä EVSE, jonka maksimiteho on vähintään 50 kW.
- Käytä konfiguraatiota fastChargerMinPowerKw = 50.
- Jos tehotieto puuttuu, älä laske sitä oletuksena pikalaturiksi. Merkitse power_unknown.

Statusluokittelu:
- AVAILABLE = vapaa
- CHARGING = latauksessa / aktiivinen lataaja
- RESERVED = varattu
- BLOCKED = blokattu / ei käytettävissä
- INOPERATIVE + OUTOFORDER = epäkunnossa
- UNKNOWN tai puuttuva = tuntematon
- PLANNED ja REMOVED jätetään käytettävissä olevasta kapasiteetista pois
- muut statusarvot tallennetaan raw-muodossa other_status-luokkaan

Pääluku:
- Laske “Suomessa pikalatureilla latauksessa nyt” = pikalaturi-EVSE:t, joiden status on CHARGING.

Lisäluvut:
- fast_available
- fast_reserved
- fast_blocked
- fast_out_of_order
- fast_unknown
- occupancy_percent = fast_charging / fast_total * 100
- unavailable_percent = (charging + reserved + blocked + out_of_order + unknown) / fast_total * 100

Tietokanta:
- Käytä Supabase PostgreSQL:ää.
- Tavoite on pysyä Supabase Free -tasolla.
- Älä tallenna kaikkien Suomen asemien 5 minuutin historiaa pysyvästi.
- Tallenna pysyvästi valtakunnallinen 5 minuutin aggregaattihistoria.
- Tallenna kaikista asemista vain viimeisin status latest_station_status-tauluun.
- Tallenna watchlist-asemien historia vain rajatuksi ajaksi, esimerkiksi 180 päivää.
- Älä tallenna raakaa AFIR JSON -dataa pysyvästi, paitsi fixture/debug-näytteet.

Collector:
- Metadatahaku kerran päivässä.
- Statushaku 5 minuutin välein.
- Käytä Digitraffic-User-headeria, mutta älä lisää siihen henkilötietoja.
- Käytä gzip-pakkausta.
- Käsittele 429- ja verkkovirheet.
- Älä nollaa statuksia virhetilanteessa.
- Näytä sovelluksessa viimeisin onnistunut päivitysaika.

PWA:
- Etusivu: Suomen pikalaturitilanne nyt.
- Kuvaajat: 24 h ja 7 vrk.
- Paikkakuntahaku.
- Karttanäkymä.
- Asemakortti.
- Watchlist.
- Asetukset.
- Lähde- ja lisenssinäkymä.

Watchlist:
- Käyttäjä voi lisätä valittuja asemia seurantaan.
- Näytä jokaisesta asemasta:
  - vapaana
  - latauksessa
  - varattu
  - blokattu
  - epäkunnossa
  - tuntematon
  - pikalatureita yhteensä
  - viimeisin päivitys
  - datan ikä
- Päivitä näkymä sovelluksen ollessa auki 30–60 sekunnin välein backendistä/Supabasesta.

Datan laadun näyttö:
- Näytä aina datan ikä.
- Jos data on yli 10 minuuttia vanhaa, merkitse se epävarmaksi.
- Jos data on yli 30 minuuttia vanhaa, älä kutsu sitä reaaliaikaiseksi.
- Älä näytä vanhaa dataa vihreänä/vapaana ilman varoitusta.

Lisenssi:
Lisää sovellukseen lähdeviittaus:
"Lähde: Fintraffic / Digitraffic, CC BY 4.0. Dataa on aggregoitu ja käsitelty sovelluksessa."

Älä toteuta MVP:ssä:
- reittisuunnittelua
- monen käyttäjän tukea
- julkista palvelua
- kaikkien asemien historiatallennusta
- raakastatusten pysyvää tallennusta
- MQTT:tä ennen kuin REST-pohjainen MVP toimii
```

---

## 20. Jatkokehitysideat

Kun dataa on kertynyt 2–4 viikkoa:

```text
- käyttöaste keskimäärin viikonpäivän ja kellonajan mukaan
- aseman ruuhkaennuste
- “tällä asemalla on perjantaisin klo 16–18 keskimäärin 80 % käyttöaste”
- push-ilmoitus, kun watchlist-asemalle vapautuu pikalaturi
- suosikkireittien latauspaikkojen seuranta
- operaattorikohtainen luotettavuus / epäkunnossaoloaste
```

---

## 21. Lähteet

Digitraffic AFIR -dokumentaatio:

```text
https://www.digitraffic.fi/tieliikenne/afir/
```

Digitraffic käyttöehdot ja CC BY 4.0:

```text
https://www.digitraffic.fi/en/terms-of-service/
```

Digitraffic rajapintojen käyttöohjeet, headerit ja rajoitukset:

```text
https://www.digitraffic.fi/en/support/instructions/
```

Supabase laskutus ja ilmaistason käyttökiintiöt:

```text
https://supabase.com/docs/guides/platform/billing-on-supabase
https://supabase.com/pricing
```

