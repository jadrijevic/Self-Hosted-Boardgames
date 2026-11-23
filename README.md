# Self-Hosted-Boardgames

Egna sällskapsspel som körs på en server hemma och spelas i mobilens webbläsare. Man skannar en QR-kod på tv:n och är med, utan app och utan konto. Första spelet är Syna.

## Läget just nu

Syna går att spela från start till slut: lobby, sex ronder, final och resultat. Inget är provspelat med människor ännu.

Det här fungerar:

- Tv-vy med QR-kod och lagens status (`/scen`).
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
- Husets röst på tv-sidan läser upp uppdraget med webbläsarens talsyntes. Den slås på med knappen i lobbyn.

Inte byggt ännu: publikens satsningar, omplanering när ett lag hoppar av mitt i spelet, uppdragen Baklänges, Minnet och Gubben, en egen vy för rekordboken och ett installationsskript för Unraid. Reglerna står i [games/syna/REGLER.md](games/syna/REGLER.md).

## Så hänger det ihop

Servern äger hela spelläget. Mobilerna skickar avsikter över en WebSocket ("vi väljer lag Röd") och får tillbaka hela läget, filtrerat efter sin roll. Eftersom hela läget skickas varje gång, och inte bara ändringar, är en mobil som varit borta ikapp så fort den ansluter igen.

| Mapp | Innehåll |
|---|---|
| `server/` | Webbserver, WebSocket-synk och spelläget för kvällen (`room.js`). Delas av alla spel. |
| `games/syna/` | Det som bara gäller Syna: regler, spelmotor, uppdrag, schemaläggare, simuleringar. |
| `public/` | Sidorna för mobil, tv och värd. Ren HTML och JavaScript, inget byggsteg. |
| `test/` | Tester som körs med `npm test`. |

Nya spel får en egen mapp under `games/` och återanvänder servern och lobbyn.

## Köra lokalt

```
npm install
npm start
```

Öppna sedan `http://localhost:8080/scen` för tv-vyn och `http://localhost:8080/` för mobilvyn. Värdens pinkod skrivs ut när servern startar.

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

Testerna täcker spelläget, schemaläggaren, spelmotorn för Syna (poäng, hemliga bud, en hel kväll) och prov med riktiga WebSocket-klienter mot en riktig server.
