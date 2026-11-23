// Uppdragen i Syna.
//
// kind      kropp | röst | huvud – styr spridningen mellan lagen
// mode      together: båda lagen gör uppdraget samtidigt
//           turns:    ett lag i taget, det djärvaste budet sist. Lag två får inte upprepa lag ett.
// measure   count: kontrollanten räknar godkända   time: kontrollanten stoppar en klocka
// direction high: fler eller längre är bättre      low: kortare tid är bättre
// bid       gränser för budet, i uppdragets enhet
// text      läses upp av husets röst
// role      vad lagets yngsta gör. Den yngsta ser, väljer eller bestämmer,
//           men är aldrig ensam utförare under tidspress.

export const TASKS = [
  {
    id: 'djuren', name: 'Djuren', kind: 'röst', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 45, unit: 'läten', bid: { min: 2, max: 20, step: 1, start: 6 },
    text: 'Gör djurläten, ett djur i taget. Hur många känner kontrollanten igen på 45 sekunder?',
    role: 'Lagets yngsta bestämmer vilket djur som står på tur.',
  },
  {
    id: 'nynna', name: 'Nynna', kind: 'röst', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 60, unit: 'låtar', bid: { min: 1, max: 12, step: 1, start: 4 },
    text: 'Nynna låtar utan ord. Hur många känner kontrollanten igen på en minut?',
    role: 'Lagets yngsta väljer första låten.',
  },
  {
    id: 'viskningen', name: 'Viskningen', kind: 'röst', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 60, unit: 'ord', bid: { min: 1, max: 10, step: 1, start: 6 },
    text: 'Kontrollanten viskar en mening på tio ord till lagets yngsta. Meningen viskas vidare genom hela laget. Den sista säger den högt. Hur många ord blir rätt?',
    role: 'Lagets yngsta får meningen först.',
    prompts: [
      'Farfars gröna cykel rullade själv nerför backen till förvånade grannen',
      'Tre trötta älgar åt upp alla äpplen i mormors trädgård',
      'Katten gömde sju strumpor under soffan innan gästerna kom hem',
      'En sjungande brevbärare tappade paketet i den djupa vattenpölen igår',
      'Lilla hunden skällde ilsket på månen tills hela byn vaknade',
      'Moster bakade tjugo bullar men åt själv upp nästan alla',
    ],
  },
  {
    id: 'slakten', name: 'Släkten', kind: 'huvud', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 45, unit: 'namn', bid: { min: 2, max: 25, step: 1, start: 8 },
    text: 'Säg namn på släktingar som inte är i rummet. Den äldsta i rummet godkänner. Hur många hinner ni på 45 sekunder?',
    role: 'Lagets yngsta säger första namnet.',
  },
  {
    id: 'kedjan', name: 'Kedjan', kind: 'huvud', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 45, unit: 'ord', bid: { min: 3, max: 30, step: 1, start: 10 },
    text: 'Säg saker som hör till ämnet på tv:n, en person i taget, utan att upprepa. Hur många hinner ni på 45 sekunder?',
    role: 'Lagets yngsta säger första ordet.',
    topics: ['Saker i ett kök', 'Djur', 'Länder', 'Saker som är röda', 'Mat på ett kalas', 'Saker i en verktygslåda', 'Idrotter', 'Saker man tar med till stranden'],
  },
  {
    id: 'alfabetet', name: 'Alfabetet', kind: 'huvud', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 60, unit: 'bokstäver', bid: { min: 3, max: 28, step: 1, start: 10 },
    text: 'Säg ett ord på varje bokstav i alfabetet, i ordning, inom ämnet på tv:n. Hur många bokstäver hinner ni på en minut?',
    role: 'Lagets yngsta pekar ut vem som tar nästa bokstav.',
    topics: ['Djur', 'Mat och dryck', 'Förnamn', 'Länder och städer'],
  },
  {
    id: 'balansen', name: 'Balansen', kind: 'kropp', material: false, mode: 'together', measure: 'time', direction: 'high',
    seconds: 60, unit: 'sekunder', bid: { min: 5, max: 60, step: 5, start: 20 },
    text: 'Alla som tävlar står på ett ben. Tiden stannar när första foten nuddar golvet. Hur många sekunder klarar ni?',
    role: 'Lagets yngsta väljer ben och säger kör.',
  },
  {
    id: 'tystnaden', name: 'Tystnaden', kind: 'kropp', material: false, mode: 'together', measure: 'time', direction: 'low',
    seconds: 90, unit: 'sekunder', bid: { min: 10, max: 90, step: 5, start: 45 },
    text: 'Ställ er i ordning efter födelsedag, januari först, utan att prata. Kontrollanten stoppar tiden när ni står rätt. Hur snabbt klarar ni det?',
    role: 'Lagets yngsta är den enda som får prata.',
  },
  {
    id: 'tornet', name: 'Tornet', kind: 'kropp', material: true, mode: 'together', measure: 'count', direction: 'high',
    seconds: 60, unit: 'muggar', bid: { min: 3, max: 30, step: 1, start: 10 },
    text: 'Stapla muggar på höjden. Hur många står kvar när en minut har gått?',
    role: 'Lagets yngsta bestämmer vem som staplar.', needs: 'Muggar',
  },
  {
    id: 'ballongen', name: 'Ballongen', kind: 'kropp', material: true, mode: 'together', measure: 'time', direction: 'high',
    seconds: 60, unit: 'sekunder', bid: { min: 5, max: 60, step: 5, start: 20 },
    text: 'Håll ballongen i luften utan händer. Tiden stannar när den nuddar golvet. Hur många sekunder klarar ni?',
    role: 'Lagets yngsta får använda händerna en gång.', needs: 'En ballong per lag',
  },
  {
    id: 'blindparet', name: 'Blindparet', kind: 'kropp', material: true, mode: 'together', measure: 'count', direction: 'high',
    seconds: 60, unit: 'par', bid: { min: 1, max: 15, step: 1, start: 5 },
    text: 'Para ihop sockor med förbundna ögon. Hur många par hinner ni på en minut?',
    role: 'Bara lagets yngsta ser, och säger vad de andra ska göra.', needs: 'Sockor och ögonbindlar',
  },
];

export const FINALS = [
  {
    id: 'tjugo', name: 'Räkna till tjugo', seconds: 180,
    text: 'Hela släkten räknar högt till tjugo, en person i taget, utan att bestämma vem som står på tur. Säger två personer samma tal samtidigt börjar ni om från ett.',
  },
];

export const taskById = (id) => TASKS.find((t) => t.id === id);
export const finalById = (id) => FINALS.find((t) => t.id === id);
