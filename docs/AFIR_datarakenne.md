# AFIR-datan rakenne — dataselvitys (vaihe 1)

Selvitetty oikeasta Digitraffic AFIR -datasta 18.6.2026. Tämä dokumentti on parserin
ja domain-mallin lähtötieto. **Älä oleta kenttänimiä OCPI-muistin perusteella — käytä
näitä todennettuja polkuja.**

Fixturet (`fixtures/`):
- `operators.json` — kaikki operaattorit (701 B)
- `locations-sample.json` — 5 edustavaa asemaa (kattaa DC≥50, DC 40–49, AC-only, CHAdeMO, null-teho, multi-EVSE)
- `statuses-sample.json` — 18 statusriviä, kattaa kaikki 7 statusarvoa
- `statuses-all.json` — koko Suomen statussnapshot (2,4 MB, viiteaineisto; ei gittiin)

> Koot tuotannossa: `locations/all` ≈ **23 MB**, `statuses/all` ≈ **2,4 MB**, ~3694 asemaa,
> ~19 500 EVSE:tä, ~19 700 liitintä. Vastaukset **eivät tule gzipattuina** (S3 ei pakkaa näitä),
> joten 23 MB latautuu sellaisenaan — collectorissa merkitsevää vain metadatahaussa (1×/vrk).

---

## 1. `GET /locations/all` — GeoJSON FeatureCollection

Top-level **EI ole lista** vaan objekti:

```
{ "type": "FeatureCollection",
  "modifiedAt": "2026-06-18T10:42:38.301Z",
  "pagination": { "limit": 3694 },
  "features": [ Feature, ... ] }
```

### Feature → asema (location)

| Tieto | Polku | Huom |
|---|---|---|
| location id | `properties.id` | UUID, esim. `70d5121e-0308-11f0-...` |
| nimi | `properties.name` | |
| longitude | `geometry.coordinates[0]` | **[lon, lat] -järjestys!** |
| latitude | `geometry.coordinates[1]` | |
| operaattori id | `properties.operator.id` | esim. `FI*911` |
| operator partyId | `properties.operator.partyId` | `911` |
| operator countryCode | `properties.operator.countryCode` | `FI` (2-kirjaiminen) |
| operaattorin nimi | `properties.operator.details.name` | |
| katuosoite | `properties.address.street` | UTF-8, skandit ok (ä/ö/å) |
| kaupunki | `properties.address.city` | **paikkakuntahaun kenttä** |
| postinumero | `properties.address.postalCode` | |
| maa | `properties.address.countryCode` | **`FIN` (3-kirjaiminen!)** ≠ operator `FI` |
| 24/7 | `properties.openingTimes.twentyFourSeven` | |
| muokattu | `properties.modifiedAt` | |
| EVSE-lista | `properties.evses[]` | |

### EVSE (`properties.evses[]`)

| Tieto | Polku | Huom |
|---|---|---|
| **EVSE id** | `evses[].id` | esim. `FI*911*E*PDC*FI1000244*0000001` — **liitoskenttä statuksiin** |
| capabilities | `evses[].capabilities[]` | esim. `CREDIT_CARD_PAYABLE` |
| liittimet | `evses[].connectors[]` | |

### Connector (`evses[].connectors[]`)

| Tieto | Polku | Arvot / huom |
|---|---|---|
| tehotyyppi | `powerType` | `DC` · `AC_3_PHASE` · `AC_1_PHASE` |
| standardi | `standard` | `IEC_62196_T2_COMBO` (CCS) · `CHADEMO` · `IEC_62196_T2` · `DOMESTIC_F/H` |
| muoto | `format` | `CABLE` · `SOCKET` |
| maksimiteho | `maxElectricPower` | **YKSIKKÖ = WATTI** (esim. `50000` = 50 kW). Voi olla `null` |
| jännite | `maxVoltage` | V |
| virta | `maxAmperage` | A |
| tariffit | `tariffIds[]` | viittaa `/tariffs`-dataan |

---

## 2. `GET /locations/statuses/all` — JSON

```
{ "pagination": { "limit": 3694 },
  "modifiedAt": "2026-06-18T10:38:17.525Z",
  "statuses": [ { "evseId": "...", "modifiedAt": "...", "status": "..." }, ... ] }
```

| Tieto | Polku | Huom |
|---|---|---|
| EVSE id | `statuses[].evseId` | **= `locations.evses[].id`** (1:1, 19503 = 19503) |
| status | `statuses[].status` | ks. alla |
| aseman ajantasaisuus | `statuses[].modifiedAt` | **per EVSE** — käytä tätä datan iän laskentaan, ei pelkkää collector-ajon kelloa |
| koko feedin aika | top-level `modifiedAt` | snapshotin muodostusaika |

**Todelliset statusarvot** (koko Suomi, 18.6.2026):
`AVAILABLE` 14548 · `CHARGING` 3424 · `OUTOFORDER` 888 · `UNKNOWN` 302 ·
`INOPERATIVE` 219 · `BLOCKED` 88 · `RESERVED` 34.

→ Kaikki 7 suunnitelman §8:n statusarvoa esiintyvät. `PLANNED`/`REMOVED` **eivät** näy
statusfeedissä → `excluded`-luokka koskee käytännössä vain metadataa, ei statuksia.

---

## 3. `GET /operators` — JSON-lista

```
[ { "id": "FI*001", "partyId": "001", "countryCode": "FI",
    "details": { "name": "Liikennevirta", "website": "...", "logo": {...} } }, ... ]
```

18 operaattoria. Huom: osa autoista on `NO*`-maakoodilla (Recharge, St1, Aimo) vaikka toimivat Suomessa.

---

## 4. Pikalaturin tunnistus — todennettu logiikka

```
DC-liitin       = connector.powerType == "DC"
teho watteina   = connector.maxElectricPower            // null => power_unknown
fastChargerMinPowerKw = 50  => kynnys 50000 W

EVSE on pikalaturi  ⇔  jollakin sen liittimellä  powerType == "DC"
                                            JA  maxElectricPower != null
                                            JA  maxElectricPower >= 50000
```

Datalla vahvistetut reunatapaukset (testattava parserissa):
- DC-tehoja löytyy **49000 (49 kW, EI mukaan)** ja **50000 (50 kW, mukaan)** → §16:n rajatesti on aitoa dataa.
- DC-tehojen kirjo: 10 kW … **1,2 MW** (1200000).
- `maxElectricPower == null`: 5 liitintä koko Suomessa, kaikki AC. **0 DC-liitintä on null-tehoisia**
  → `power_unknown` on käytännössä AC-ilmiö, mutta käsittele silti.
- EVSE:n max-teho = `max(connectors.maxElectricPower)`; pikalaturius ratkaistaan liitintasolla.

---

## 5. Huomioita parseriin / myöhempiin vaiheisiin

- **Koordinaatit GeoJSONissa [lon, lat]** — helppo mennä väärinpäin.
- **Maakoodien epäsymmetria:** `operator.countryCode = "FI"`, `address.countryCode = "FIN"`.
- **Datan ikä per EVSE:** `statuses[].modifiedAt` voi olla päiviä vanha (esim. OUTOFORDER
  8.6. → snapshot 18.6.). §15:n "datan ikä" kannattaa laskea EVSE:n omasta `modifiedAt`:sta,
  ei vain collector-ajon ajasta — muuten vanha status näyttää tuoreelta.
- **MQTT-topicia varten (vaihe 2):** topic on `status-v1/FI/<partyId>/<locationId>/<evseId>`.
  `partyId` löytyy operatorista, `evseId` suoraan. `locationId` topicissa ei ole sama kuin
  GeoJSONin UUID — se on EVSE-id:hen upotettu viite (esim. `FI1000244`). Selvitä tarkka muoto
  vaihe 2:ssa MQTT-dokumentaatiosta ennen tilauksia (rate-limit 5/IP ilman tunnistetta).
- **Tariffit** linkittyvät `connector.tariffIds` → `/tariffs`. MVP:ssä hinta on "jos saatavilla".
- **Duplikaatti-id:t (tärkeä):** AFIR `locations/all` sisältää duplikaatteja — todettu
  ~29 toistuvaa location-id:tä ja ~6 EVSE-id:tä (sama EVSE kahden eri aseman alla, esim.
  `FI*001*E237812` asemilla `FI001L1FRSLEXX` ja `FIVIRLSL1EUGRA`). Collector deduplikoi
  ennen upserttia (säilytä viimeisin), muuten Postgres kaatuu virheeseen 21000
  "ON CONFLICT DO UPDATE cannot affect row a second time".
```
