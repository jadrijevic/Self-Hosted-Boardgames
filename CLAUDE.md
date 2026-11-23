# Arbetssätt i det här repot

Egna sällskapsspel för Boris familj, körda på hans Unraid-server och spelade i mobilens webbläsare. Första spelet är Syna, med julafton 2026 som första tillfälle. Reglerna står i `games/syna/REGLER.md` och är källan för vad koden ska göra.

## Principer

- Servern äger hela spelläget. Klienter skickar avsikter och ritar om sig från hela läget.
- Allt en klient får se går genom `viewFor` i `server/room.js`. Hemligheter (token, hemliga bud) filtreras där.
- Spellogik hålls ren och utan nätverk, så att den går att testa för sig.
- Inget byggsteg och så få beroenden som möjligt. Sidorna är ren HTML och JavaScript.
- Spelet ska tåla att en mobil somnar, laddas om eller byts ut mitt i en rond.
- Mobilen visar allt som storbilden visar. Spelet ska gå att spela utan storbild.
- Minsta text på storbilden är 3,5 % av bildhöjden. Nya uppdrag och texter provas med `tools/layoutcheck/check.py`.
- En merge är i drift inom en timme (`deploy/boardgames-uppdatera-v1.sh`), men aldrig mitt i ett spel. Nästa version måste därför kunna läsa det sparade läget (`room.json`), där rekordboken ligger.
- Ett fel i spellogiken får inte fälla servern. Nya meddelandetyper läggs till i slumpprovet i `test/fuzz.test.js`.

## Språk

- Text som användaren ser, dokument, kommentarer och testnamn skrivs på svenska.
- Identifierare och meddelandetyper i protokollet skrivs på engelska.
- Dokument har enkla rubriker och rak text, utan utfyllnad och utan ändringslogg-ton.

## Arbetsgång

- Alla ändringar går via en gren och en pull request som Boris mergar. Inget pushas direkt till `main`.
- `npm test` ska gå igenom före varje pull request. Ny logik får tester.
- Påståenden om att något fungerar ska backas av körda tester eller utdata. Säg tydligt vad som inte är provat.
- Skript som Boris ska köra på servern får versionsnummer i filnamnet (`-v1`, `-v2`). Kroppen står i `( )`, inget ändras utan bekräftelse, radsluten är LF, och rättigheter sätts via `/mnt/system_apps` och aldrig via `/mnt/user`. Unraid har ingen python3: skripten använder bash, curl och docker.
- `shellcheck -x deploy/*.sh test/stubs/*` ska gå igenom. Ändras ett skript i `deploy/` utökas testerna i `test/deploy.test.js`.
