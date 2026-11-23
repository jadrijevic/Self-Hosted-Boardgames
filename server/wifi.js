// Texten i en wifi-kod: nätets namn och lösenord i det format som mobilkameror förstår.
// Koden är lösenordet i klartext. Den ska därför bara visas för dem som ändå ska in på nätet.

// Bakstreck, semikolon, komma, citattecken och kolon har en betydelse i formatet och föregås av ett bakstreck.
const SPECIAL = new Set(['\\', ';', ',', '"', ':']);
const esc = (s) => [...String(s)].map((c) => (SPECIAL.has(c) ? `\\${c}` : c)).join('');

export function wifiPayload({ ssid, password }) {
  return password
    ? `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;`
    : `WIFI:T:nopass;S:${esc(ssid)};;`;
}
