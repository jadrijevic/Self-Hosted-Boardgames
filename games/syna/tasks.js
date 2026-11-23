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
// topics    ett av dem lottas per rond och visas för alla, med rubriken topicLabel (annars Ämne)
// prompts   lagen får var sitt, och bara kontrollanten ser dem
// needs     materialet, för uppdrag med material: true

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
    id: 'tungvrickaren', name: 'Tungvrickaren', kind: 'röst', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 45, unit: 'gånger', bid: { min: 2, max: 25, step: 1, start: 8 },
    text: 'Säg rondens tungvrickare felfritt, en person i taget. Kontrollanten räknar varje gång det blir rätt. Hur många gånger hinner ni på 45 sekunder?',
    role: 'Lagets yngsta pekar ut vem som står på tur.',
    topicLabel: 'Tungvrickare',
    topics: ['Sex laxar i en laxask', 'Packa pappas kappsäck', 'Flyg, fula fluga, flyg', 'Sju sjösjuka sjömän', 'Kvistfritt kvastskaft', 'Typiskt västkustskt'],
  },
  {
    id: 'sangen', name: 'Sången', kind: 'röst', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 60, unit: 'sånger', bid: { min: 1, max: 10, step: 1, start: 3 },
    text: 'Sjung en rad ur en sång där rondens ord finns med. Kontrollanten godkänner varje ny sång. Hur många sånger hinner ni på en minut?',
    role: 'Lagets yngsta bestämmer vem som sjunger först.',
    topicLabel: 'Ord',
    topics: ['Sol', 'Hjärta', 'Natt', 'Sommar', 'Regn', 'Vän', 'Dans', 'Stjärna'],
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
    text: 'Säg saker som hör till rondens ämne, en person i taget, utan att upprepa. Hur många hinner ni på 45 sekunder?',
    role: 'Lagets yngsta säger första ordet.',
    topics: ['Saker i ett kök', 'Djur', 'Länder', 'Saker som är röda', 'Mat på ett kalas', 'Saker i en verktygslåda', 'Idrotter', 'Saker man tar med till stranden'],
  },
  {
    id: 'alfabetet', name: 'Alfabetet', kind: 'huvud', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 60, unit: 'bokstäver', bid: { min: 3, max: 28, step: 1, start: 10 },
    text: 'Säg ett ord på varje bokstav i alfabetet, i ordning, inom rondens ämne. Hur många bokstäver hinner ni på en minut?',
    role: 'Lagets yngsta pekar ut vem som tar nästa bokstav.',
    topics: ['Djur', 'Mat och dryck', 'Förnamn', 'Länder och städer'],
  },
  {
    id: 'rimmet', name: 'Rimmet', kind: 'huvud', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 45, unit: 'rim', bid: { min: 1, max: 15, step: 1, start: 5 },
    text: 'Säg ord som rimmar på rondens ord, en person i taget, utan att upprepa. Hur många rim hinner ni på 45 sekunder?',
    role: 'Lagets yngsta säger första rimmet.',
    topicLabel: 'Rimord',
    topics: ['Hatt', 'Mus', 'Sko', 'Bil', 'Sol', 'Kväll', 'Gran', 'Hand'],
  },
  {
    id: 'vaskan', name: 'Väskan', kind: 'huvud', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 90, unit: 'saker', bid: { min: 2, max: 12, step: 1, start: 5 },
    text: 'Packa en väska i huvudet. Varje person räknar upp allt som ligger i väskan och lägger till en sak. Kontrollanten avbryter när någon glömmer. Hur många saker får ni med på 90 sekunder?',
    role: 'Lagets yngsta lägger första saken i väskan.',
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
    text: 'Ställ er i rondens ordning utan att prata. Kontrollanten stoppar tiden när ni står rätt. Hur snabbt klarar ni det?',
    role: 'Lagets yngsta är den enda som får prata.',
    topicLabel: 'Ordning',
    topics: ['Födelsedag, januari först', 'Skostorlek, minst först', 'Förnamn i bokstavsordning', 'Handens storlek, minst först'],
  },
  {
    id: 'masken', name: 'Masken', kind: 'kropp', material: false, mode: 'together', measure: 'time', direction: 'high',
    seconds: 60, unit: 'sekunder', bid: { min: 5, max: 60, step: 5, start: 20 },
    text: 'Lagen står mitt emot varandra och håller masken. Miner och ljud är tillåtna, men ingen rör någon. Tiden stannar när första i laget ler eller skrattar. Hur många sekunder klarar ni?',
    role: 'Lagets yngsta får skratta fritt och gör miner mot motståndarna.',
  },
  {
    id: 'bokstaverna', name: 'Bokstäverna', kind: 'kropp', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 60, unit: 'bokstäver', bid: { min: 1, max: 15, step: 1, start: 5 },
    text: 'Forma bokstäver med kropparna, en bokstav i taget och minst två personer per bokstav. Kontrollanten godkänner varje bokstav som går att läsa. Hur många hinner ni på en minut?',
    role: 'Lagets yngsta väljer bokstav och bestämmer vem som gör vad.',
  },
  {
    id: 'ryggen', name: 'Ryggen', kind: 'kropp', material: false, mode: 'turns', measure: 'count', direction: 'high',
    seconds: 90, unit: 'figurer', bid: { min: 1, max: 6, step: 1, start: 2 },
    text: 'Kontrollanten viskar en figur till lagets yngsta. Figuren ritas vidare med fingret på ryggen genom hela laget, och den sista säger vad det är. Hur många figurer kommer rätt fram på 90 sekunder?',
    role: 'Lagets yngsta får figuren först.',
    prompts: [
      'Hjärta · Sol · Hus · Fisk · Stjärna · Båt',
      'Blomma · Måne · Träd · Kopp · Nyckel · Bil',
      'Äpple · Moln · Stol · Orm · Krona · Flagga',
      'Glass · Paraply · Kors · Ballong · Katt · Trappa',
    ],
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
