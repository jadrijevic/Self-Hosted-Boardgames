# Syna – regler

Syna är lagutmaningar live i vardagsrummet med hemliga bud och synande. Det här är reglerna som koden ska följa. Ronderna är byggda, men inget är provspelat med människor.

## Förutsättningar

- 12–16 personer i tre generationer, varav några barn på 6–9 år. Den yngsta läser inte säkert.
- 25–30 minuter. Svenska. Ingen ska behöva läsa regler: husets röst läser upp.
- En mobil per lag. En storbild (tv eller projektor) visar scenen för alla. Mobilerna visar samma sak och räcker om storbilden saknas.
- De som inte tävlar är publik eller kontrollant.
- Spelet ska fungera utan jultema och med minimalt med material.

## En rond

1. Huset läser upp uppdraget.
2. De två lag som duellerar lägger hemliga bud. Buden visas samtidigt.
3. Lagen som tittar får syna ett av buden eller stå över.
4. Lagen gör uppdraget, 45–90 sekunder. Kontrollanten räknar eller stoppar tiden.
5. Kontrollanten bekräftar resultatet och poängen visas.

Vissa uppdrag görs av båda lagen samtidigt. I andra turas lagen om: då går det djärvaste budet sist, och lag två får inte upprepa något som lag ett har sagt.

## Övningsronden

- Kvällen börjar med en övningsrond: Masken, med två lag som duellerar och de andra som synar. Den går som en vanlig rond.
- Den ger inga poäng och inga rekord. Poängen visas som de hade blivit, så att alla ser hur bud, djärvast bud och syn räknas.
- I övningen duellerar två lag som inte möts i rond 1. Efter rond 1 har då alla lag både budat och synat.
- Värden kan hoppa över övningen när som helst, eller slå av den i lobbyn. Masken spelas inte igen senare samma kväll.

## Poäng

- Klarat bud ger 1 poäng. Det djärvaste klarade budet i duellen ger 2 till. Missat bud ger 0.
- Klarar båda lagen samma bud delar de på bonusen och får 2 poäng var.
- När uppdraget mäts i tid och kortast tid är bäst är det lägsta budet djärvast. Ett lag som inte kommer i mål har missat sitt bud.
- Syna betyder "ni klarar inte ert bud". Rätt syn ger 2 poäng. Vid fel syn får det synade laget 1 poäng. Den som synade förlorar inget. Högst en syn per lag och rond.
- Resultat över budet ger inga poäng men skrivs i rekordboken. Rekord avgör vid lika poäng.
- Sista varvet ger dubbla poäng när antalet lag är jämnt. Det gäller allt i ronden, även syn.
- Ingen ställning sjunker någonsin. Det finns inga avdrag.
- Ställningen döljs under sista varvet och vinnaren avslöjas efter finalen.
- Publiken satsar från egna mobiler, åt båda håll, på en egen poängtavla. Kontrollanten satsar inte.

## Final

Ett gemensamt uppdrag för alla, utan insats. Lyckas det öppnas lådan med något till alla, och sedan avslöjas vinnaren. Misslyckas det får släkten försöka igen.

Finalen är Räkna till tjugo: hela släkten räknar högt, en person i taget, utan att bestämma vem som står på tur. Säger två personer samma tal samtidigt börjar man om från ett.

## Schema och skalning

Servern räknar ut vilka lag som möts så att alla får lika många dueller (`schedule.js`).

| Lag | Ronder | Dueller per lag | Samma par möts | Dubbla poäng i sista varvet |
|---|---|---|---|---|
| 2 | 6 | 6 | 6 gånger | ja |
| 3 | 6 | 4 | 2 gånger | nej |
| 4 | 6 | 3 | 1 gång | ja |
| 5 | 5 | 2 | högst 1 gång | nej |
| 6 | 6 | 2 | högst 1 gång | ja |

- Tre eller fyra lag är grundläget. Fler spelare ger större lag (2–5 per lag), inte fler lag.
- Syn mellan lag kräver minst tre lag. Med två lag synar bara publiken.
- Lika många på golvet: i en duell ställer båda lagen upp lika många, det mindre lagets antal. Övriga coachar.
- Specialrollen går till lagets yngsta, oavsett ålder. Ett lag utan barn fungerar.
- Hoppar ett lag av räknas resten av schemat om så att kvarvarande lag slutar på lika många dueller. Går det inte räknas poängen som snitt per duell.
- Uppdragen delas ut i tre sorter (kropp, röst, huvud) så att varje lag får så olika sorter som möjligt.

## När något blir fel

- Värden kan ångra det senaste steget. Läget före steget läggs tillbaka: bud, syn, resultat, poäng och rekord. Det går att ångra upp till sex steg i rad.
- Under ett försök betyder det att försöket börjar om. Det får också kontrollanten göra, om tiden startades av misstag.
- Direkt efter ett försök betyder det att försöket görs om. När lagen turas om gäller det bara laget som just tävlade.
- Ett bytt uppdrag går att ångra. Ett avslutat spel går inte att ångra.
- Medan buden är hemliga kan de två lagens mobiler inte byta lag eller roll, och detsamma gäller lagen som synar tills alla har synat. En mobil utan plats får alltid gå med.
- Under spelet kan ingen ny bli kontrollant så länge det finns en. Värden kan ta bort den som sitter.
- En tid kan inte bli längre än uppdragets tid. Stoppas klockan efter att tiden gått ut räknas det som att tiden gick ut.

## Uppdrag

- Standardurvalet kräver inget material. Uppdrag med material är märkta och väljs aktivt.
- Väskan och Ryggen tar över fem minuter per rond och är avslagna tills värden slår på långa uppdrag i lobbyn.
- Den minsta ser, väljer eller bestämmer, men är aldrig ensam utförare under tidspress. Den står inte först i ett led, säger inte första svaret och är aldrig den enda som får göra något. I Kedjan och Rimmet är den joker och får svara när som helst.
- Cirka 20 uppdrag ska finnas, 6 spelas. Värden kan byta uppdrag med en knapp före budgivningen.
- Uppdragen står i `tasks.js`. Utan material finns fem av varje sort:
  - röst: Djuren, Nynna, Viskningen, Tungvrickaren, Sången
  - huvud: Släkten, Kedjan, Alfabetet, Rimmet, Väskan
  - kropp: Balansen, Tystnaden, Masken, Bokstäverna, Ryggen
- En kväll spelar två uppdrag av varje sort. Med fem lag blir det fem ronder, och då ett av den ena sorten. Med fem att välja på blir kvällarna olika.
- Ett uppdrag kan ha ämnen som lottas per rond och visas för alla (rimordet, tungvrickaren, ordningen i Tystnaden), eller lappar som bara kontrollanten ser (meningen i Viskningen, figurerna i Ryggen).
- Byggda med material: Tornet (muggar), Ballongen, Blindparet (sockor och ögonbindlar).
- Inte byggda, kräver mer av mobilen: Baklänges (ljud), Minnet (bilder), Gubben (var och en ritar en kroppsdel, mobilen syr ihop).

## Simuleringar

Reglerna är avstämda mot simuleringar i `sim/` (Python, används inte när spelet körs).

Antaganden: utfallet sprider 10–35 % kring lagets medel, lagets egen bedömning har 10 % brus och åskådarnas 15 %.

- Poäng per duell blir 1,55–1,85 beroende på hur förutsägbart uppdraget är, oberoende av enhet.
- Ett lag som är 25 % bättre på ett uppdrag får i snitt 2,25 mot 1,25.
- Kloka budgivare budar cirka 85 % av vad de tror sig klara och missar 13–34 % av buden.
- Syn lönar sig om laget missar oftare än en gång på tre.
