# Self-Hosted-Boardgames

Egna sällskapsspel som körs på en server hemma och spelas i mobilens webbläsare. Man skannar en QR-kod och är med, utan app och utan konto. Första spelet är Syna.

## Läget just nu

Syna går att spela från start till slut: lobby, sex ronder, final och resultat. Inget är provspelat med människor ännu.

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

Inte byggt ännu: publikens satsningar, omplanering när ett lag hoppar av mitt i spelet, uppdragen Baklänges, Minnet och Gubben, en egen vy för rekordboken och ett installationsskript för Unraid. Reglerna står i [games/syna/REGLER.md](games/syna/REGLER.md).

## Så hänger det ihop

Servern äger hela spelläget. Mobilerna skickar avsikter över en WebSocket ("vi väljer lag Röd") och får tillbaka hela läget, filtrerat efter sin roll. Eftersom hela läget skickas varje gång, och inte bara ändringar, är en mobil som varit borta ikapp så fort den ansluter igen.

| Mapp | Innehåll |
|---|---|
| `server/` | Webbserver, WebSocket-synk och spelläget för kvällen (`room.js`). Delas av alla spel. |
| `games/syna/` | Det som bara gäller Syna: regler, spelmotor, uppdrag, schemaläggare, simuleringar. |
| `public/` | Sidorna för mobil, storbild och värd. Ren HTML och JavaScript, inget byggsteg. |
| `test/` | Tester som körs med `npm test`. |
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
- Saknas storbild räcker mobilerna. Husets röst finns bara på storbilden.

## Köra i Docker

```
docker build -t boardgames .
docker run -d --name boardgames --restart unless-stopped \
  -p 8087:8080 \
  -v /mnt/user/appdata/boardgames:/data \
  --user 99:100 \
  -e ADMIN_PIN=1234 \
  boardgames
```

Porten 8087 är ett exempel. Avbilden är ännu inte provbyggd, och ett installationsskript för Unraid kommer i ett senare steg.

| Variabel | Standard | Betydelse |
|---|---|---|
| `PORT` | `8080` | Porten servern lyssnar på i containern. |
| `DATA_DIR` | `./data` (`/data` i Docker) | Där läget sparas. |
| `ADMIN_PIN` | slumpas vid start | Pinkoden till `/admin`. Utan fast kod står den i loggen. |
| `PUBLIC_URL` | adressen i anropet | Adressen som QR-koden pekar på, till exempel `https://syna.example.org`. |

Mikrofon och skärmlås i mobilen kräver https. Det löses med en omvänd proxy framför containern.

## Tester

```
npm test
```

Testerna täcker spelläget, schemaläggaren, spelmotorn för Syna (poäng, hemliga bud, en hel kväll), vad mobilen och värden ser i varje steg och prov med riktiga WebSocket-klienter mot en riktig server.

Layouten provas för sig i en riktig webbläsare. Kontrollen ritar varje uppdrag i varje steg, plus de trängsta fallen med sex lag, och mäter att inget hamnar utanför bilden och att ingen text på storbilden är för liten. Den kräver Python med Playwright och Chrome eller Chromium:

```
python3 tools/layoutcheck/check.py
```

Kör den när ett uppdrag läggs till eller en text ändras.
