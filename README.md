# Self-Hosted-Boardgames

Egna sällskapsspel som körs på en server hemma och spelas i mobilens webbläsare. Man skannar en QR-kod och är med, utan app och utan konto. Första spelet är Syna.

## Läget just nu

Syna går att spela från start till slut: lobby, sex ronder, final och resultat. Inget är provspelat med människor ännu, och inget är kört på Unraid.

Det här fungerar:

- Storbild med QR-kod och lagens status (`/scen`), för tv eller projektor.
- Mobilvy där man väljer lag, publik eller kontrollant (`/`).
- Värdvy bakom pinkod: antal lag (2–6), lagnamn, ta bort mobiler, nollställ (`/admin`).
- En mobil som tappar kontakten eller laddas om får tillbaka sin plats.
- Läget sparas på disk och överlever en omstart.
- Schemaläggaren för Syna: vilka lag som möts vid 2–6 lag.
- Ronderna: uppdrag, hemliga bud, syn, nedräkning, resultat och poäng.
- Kontrollanten räknar godkända eller stoppar tiden från sin mobil.
- Värden går vidare mellan stegen, kan byta uppdrag och kan lägga bud eller syna åt ett lag som saknar mobil.
- Dubbla poäng och dold ställning i sista varvet, gemensam final och slutresultat.
- Rekordboken: bästa resultat per uppdrag sparas mellan kvällarna.
- Husets röst på storbilden läser upp uppdraget med webbläsarens talsyntes. Den slås på med knappen i lobbyn.
- Mobilen visar allt som storbilden visar: uppdrag, ämne, bud, syn, klocka, rondens poäng och ställning. Spelet går att spela utan storbild, och då läser värden upp uppdraget från sin sida.

- Installation på Unraid med en rad, och uppdatering varje timme som aldrig startar om mitt i ett spel.

Inte byggt ännu: publikens satsningar, omplanering när ett lag hoppar av mitt i spelet, uppdragen Baklänges, Minnet och Gubben, en egen vy för rekordboken och https. Reglerna står i [games/syna/REGLER.md](games/syna/REGLER.md).

## Så hänger det ihop

Servern äger hela spelläget. Mobilerna skickar avsikter över en WebSocket ("vi väljer lag Röd") och får tillbaka hela läget, filtrerat efter sin roll. Eftersom hela läget skickas varje gång, och inte bara ändringar, är en mobil som varit borta ikapp så fort den ansluter igen.

| Mapp | Innehåll |
|---|---|
| `server/` | Webbserver, WebSocket-synk och spelläget för kvällen (`room.js`). Delas av alla spel. |
| `games/syna/` | Det som bara gäller Syna: regler, spelmotor, uppdrag, schemaläggare, simuleringar. |
| `public/` | Sidorna för mobil, storbild och värd. Ren HTML och JavaScript, inget byggsteg. |
| `deploy/` | Det som behövs på Unraid: compose-filen, installations- och uppdateringsskriptet och kontrollen. Följer med avbilden. |
| `test/` | Tester som körs med `npm test`. `test/stubs/` är en låtsas-docker för skripten. |
| `tools/` | Layoutkontroll i webbläsare. Används inte när spelet körs. |

Nya spel får en egen mapp under `games/` och återanvänder servern och lobbyn.

## Köra lokalt

```
npm install
npm start
```

Öppna sedan `http://localhost:8080/scen` för storbilden och `http://localhost:8080/` för mobilvyn. Värdens pinkod skrivs ut när servern startar.

## Storbilden

Storbilden är en vanlig webbsida. Den visas från en dator med webbläsaren i helskärm, kopplad till en tv eller projektor.

- Minsta text är 3,5 % av bildhöjden. Den går att läsa när bilden är minst 15 tum per meter till den som sitter längst bort: 61 tum på 4 meter, 76 tum på 5 meter.
- Layouten är provad i 16:9 och 16:10, med upp till sex lag och lagnamn på 14 tecken.
- Typsnittet (Inter, `public/inter.woff2`) följer med appen. Sidorna ser därför likadana ut på alla skärmar, och layouten som provas är den som visas.
- Saknas storbild räcker mobilerna. Husets röst finns bara på storbilden.

## Köra på Unraid

Varje merge till `main` bygger avbilden `ghcr.io/jadrijevic/self-hosted-boardgames:latest` när testerna är gröna. Installationen följer med avbilden och är en rad i Unraids terminal:

```
docker run --rm --pull always --entrypoint cat ghcr.io/jadrijevic/self-hosted-boardgames:latest \
  /app/deploy/boardgames-installera-v1.sh > /boot/config/scripts/boardgames-installera-v1.sh \
  && bash /boot/config/scripts/boardgames-installera-v1.sh
```

Skriptet visar vad det ska göra och frågar innan något ändras. En ny körning är säker: det som redan stämmer lämnas som det är.

- **Projektet** är Compose Manager-projektet `boardgames` i `/boot/config/plugins/compose.manager/projects/boardgames/`, med värdena i `.env` (0600).
- **Containern** kör som 99:100 med skrivskyddat filsystem, på nätet `docker_network` och port 8090 mot LAN. Välj en annan port med `PORT=<nr>` framför `bash`.
- **Läget** ligger i `/mnt/system_apps/appdata/boardgames/data/room.json`: kvällens spel och rekordboken.
- **Värdens pinkod** slumpas vid första installationen, står i `.env` och skrivs ut när skriptet är klart.
- **Kontrollen** i slutet provar sidorna och WebSocket genom porten och att läget hamnar på disk. Samma kontroll när som helst: `docker exec boardgames node deploy/kontroll.js`.

Paketet i GHCR måste vara publikt för att servern ska kunna hämta avbilden utan inloggning. Det ställs in en gång: GitHub → Packages → self-hosted-boardgames → Package settings → Change visibility. Avbilden innehåller bara kod.

### Uppdateringar

`/boot/config/scripts/boardgames-uppdatera-v1.sh` körs varje timme (minut 40) och startar om containern när en ny avbild finns. En merge är alltså i drift inom ungefär en timme. Skriptet väntar till nästa timme

- medan ett spel pågår (ändrat de senaste tre timmarna)
- när någon har varit inne de senaste tio minuterna
- medan 3D-skrivaren skriver ut.

Före omstarten kopieras läget till `room.json.fore-uppdatering`. En stoppad container startas inte. Det som händer loggas i syslog med taggen `boardgames-uppdatera`. Ändras `compose.yaml` krävs installationsskriptet igen.

Containern startar om av sig själv högst tre gånger efter en krasch (`restart: on-failure:3`). Det avviker med flit från övriga containrar: en krasch mitt i en spelkväll ska läka på några sekunder, medan ett bestående fel fortfarande stannar och syns i containerlarmet.

### Inställningar

| Variabel | Standard | Betydelse |
|---|---|---|
| `PORT` | `8080` | Porten servern lyssnar på i containern. Låst i `compose.yaml`. |
| `DATA_DIR` | `./data` (`/data` i Docker) | Där läget sparas. Låst i `compose.yaml`. |
| `ADMIN_PIN` | slumpas vid start | Pinkoden till `/admin`. Installationsskriptet sätter en fast kod. |
| `PUBLIC_URL` | adressen i anropet | Adressen som QR-koden pekar på, till exempel `https://syna.example.org`. Sätts med `ADRESS=<adress>` framför `bash`. |
| `BOARDGAMES_IMAGE`, `BOARDGAMES_PORT` | – | Avbilden och porten mot LAN. Skrivs av installationsskriptet. |

`/halsa` svarar `ok` när servern är uppe. `/lage` visar fas, antal anslutna och tid sedan senaste ändring, utan hemligheter.

Skärmlåset i mobilen kräver https. Det löses med en omvänd proxy framför containern och är inte uppsatt än. Utan https kan en mobil somna mitt i en rond; den är ikapp när den vaknar.

## Tester

```
npm test
```

Testerna täcker spelläget, schemaläggaren, spelmotorn för Syna (poäng, hemliga bud, en hel kväll), vad mobilen och värden ser i varje steg och prov med riktiga WebSocket-klienter mot en riktig server. Ett slumpprov skickar 30 000 trasiga och giltiga meddelanden genom alla steg och kräver att spellogiken aldrig kastar ett undantag.

Installations- och uppdateringsskripten körs i testerna mot en låtsas-docker som startar den riktiga servern. Docker och Unraid själva provas inte där. Avbilden byggs och provas som i drift av CI på varje pull request: 99:100, skrivskyddat filsystem, sidorna, WebSocket, läget på disk och att ett startat spel finns kvar efter en omstart.

Layouten provas för sig i en riktig webbläsare, och av CI på varje pull request. Kontrollen ritar varje uppdrag i varje steg, plus de trängsta fallen med sex lag, och mäter att inget hamnar utanför bilden, att ingen text på storbilden är för liten och att typsnittet som följer med appen är laddat. Lokalt kräver den Python med Playwright och Chrome eller Chromium:

```
python3 tools/layoutcheck/check.py
```

Kör den när ett uppdrag läggs till eller en text ändras.
