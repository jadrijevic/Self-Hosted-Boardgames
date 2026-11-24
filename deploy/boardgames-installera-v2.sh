#!/bin/bash
# =============================================================================
#  boardgames-installera-v2.sh
# -----------------------------------------------------------------------------
#  Installerar eller uppdaterar sällskapsspelen på Unraid. Skriptet följer med
#  avbilden, så hela installationen är en rad i Unraids terminal:
#
#    docker run --rm --pull always --entrypoint cat ghcr.io/jadrijevic/self-hosted-boardgames:latest \
#      /app/deploy/boardgames-installera-v2.sh > /boot/config/scripts/boardgames-installera-v2.sh \
#      && bash /boot/config/scripts/boardgames-installera-v2.sh
#
#  --pull always behövs: utan det används en äldre avbild som redan finns lokalt.
#  Skriptet visar vad det ska göra och frågar innan något ändras (j/N). Utan
#  terminal krävs DRYRUN=false; DRYRUN=true visar bara. En ny körning är säker:
#  det som redan stämmer lämnas som det är.
#
#  Första gången frågar skriptet efter gästnätet: namnet och lösenordet som
#  wifi-koden på storbilden ska bära. Enter hoppar över. Lösenordet syns inte
#  när det skrivs och hamnar bara i projektets .env. Senare:
#    WIFI_NAMN=<nätets namn> bash <skriptet>   byter nät; lösenordet frågas efter
#    WIFI=av bash <skriptet>                   tar bort wifi-koden
#    PIN=<4–8 siffror> bash <skriptet>         byter värdens pinkod
#
#  Gör:
#    1. kontrollerar root, docker compose, poolen, nätet och porten
#    2. Compose Manager-projektet: compose.yaml (en ändrad sparas som .bak-<tid>),
#       compose.override.yaml (services: {}), name, autostart och .env (0600).
#       En befintlig .env får bara nycklar som saknas; avbild och port skrivs om.
#       Värdens pinkod slumpas första gången och ligger sedan kvar, om du inte
#       väljer en egen med PIN=<siffror>.
#    3. katalogen för läget via poolen och aldrig via /mnt/user: 99:100, 0770
#    4. uppdatering varje timme från GHCR, inte under 3D-utskrift och inte
#       medan ett spel pågår
#    5. startar containern
#    6. kontrollerar att sidorna svarar genom porten, att WebSocket går fram och
#       att läget hamnar på disk (docker exec boardgames node deploy/kontroll.js)
#
#  Variabler: IMAGE (standard ghcr.io/jadrijevic/self-hosted-boardgames:latest),
#  KALLA (katalog med källkod att bygga i stället), PORT (8090), ADRESS (adressen
#  som QR-koden ska peka på; tomt betyder adressen som storbilden öppnades med),
#  PIN (egen pinkod för värden, 4–8 siffror), WIFI_NAMN och WIFI_LOSEN (gästnätet
#  till wifi-koden; utan WIFI_LOSEN frågar skriptet efter lösenordet, och då
#  hamnar det inte i terminalens historik), WIFI=av, DRYRUN.
#  Kontrollera radslut först: grep -c $'\r' <filen> ska ge 0.
# =============================================================================
(
set -uo pipefail

IMAGE="${IMAGE:-ghcr.io/jadrijevic/self-hosted-boardgames:latest}"
KALLA="${KALLA:-}"
PORT="${PORT:-}"
ADRESS="${ADRESS:-}"
DRYRUN="${DRYRUN:-}"
PIN="${PIN:-}"
WIFI="${WIFI:-}"
WIFI_NAMN="${WIFI_NAMN:-}"
WIFI_LOSEN="${WIFI_LOSEN:-}"
WIFI_NEJ=""   # 1 = frågan om gästnätet är ställd och överhoppad
PROJ="${PROJ:-/boot/config/plugins/compose.manager/projects/boardgames}"
POOL_APPDATA="${POOL_APPDATA:-/mnt/system_apps/appdata}"
SKRIPTKATALOG="${SKRIPTKATALOG:-/boot/config/scripts}"
CRONFIL="${CRONFIL:-/boot/config/plugins/dynamix/boardgames.cron}"
CRONROT="${CRONROT:-/etc/cron.d/root}"
UPPDATERA="$SKRIPTKATALOG/boardgames-uppdatera-v1.sh"
APPDIR="$POOL_APPDATA/boardgames"
ENVF="$PROJ/.env"
NAT=docker_network
TS="$(date +%Y%m%d-%H%M%S)"
FEL=0
VARN=0
SVAR=""   # sätts av fraga()

hr()    { echo; echo "=== $* ==="; }
ok()    { echo "  OK      $*"; }
info()  { echo "  ..      $*"; }
fel()   { echo "  FEL     $*"; FEL=$((FEL + 1)); }
varn()  { echo "  VARNING $*"; VARN=$((VARN + 1)); }
krav()  { # krav <ok-text> <fel-text> <kommando ...>
  local okt="$1" felt="$2"; shift 2
  if "$@" >/dev/null 2>&1; then ok "$okt"; else fel "$felt"; fi
}
terminal() { { : < /dev/tty; } 2>/dev/null; }
fraga() { # fraga <variabel> <text> [dold]: svar från terminalen, tomt utan terminal
  local svar=""
  if terminal; then
    if [ "${3:-}" = "dold" ]; then
      IFS= read -r -s -p "  ?       $2" svar < /dev/tty; echo
    else
      IFS= read -r -p "  ?       $2" svar < /dev/tty
    fi
  fi
  printf -v "$1" '%s' "$svar"
}
# Värden med andra tecken än dessa skrivs inom enkla citattecken i .env, så att
# Compose inte tolkar $, # eller mellanslag
envrad() { # envrad <nyckel> <värde>
  case "$2" in
    *[!A-Za-z0-9._~+/:=@,-]*) printf "%s='%s'" "$1" "$2" ;;
    *) printf '%s=%s' "$1" "$2" ;;
  esac
}
envvarde() { [ -f "$ENVF" ] && grep -m1 "^$1=" "$ENVF" | cut -d= -f2- | sed "s/^'\(.*\)'\$/\1/" ; }
dc()       { docker compose --project-directory "$PROJ" -p boardgames \
               -f "$PROJ/compose.yaml" -f "$PROJ/compose.override.yaml" "$@"; }
kod()      { curl -s -o /dev/null -w '%{http_code}' -m 5 "$@"; }

# Porten: den som redan är vald i .env gäller, om inget annat anges
[ -n "$PORT" ] || PORT="$(envvarde BOARDGAMES_PORT)"
PORT="${PORT:-8090}"

hr "1. FÖRUTSÄTTNINGAR"
krav "root" "kör som root" test "$(id -u)" = 0
krav "docker compose" "docker compose saknas (Compose Manager-pluginet)" docker compose version
krav "curl" "curl saknas" command -v curl
krav "$POOL_APPDATA finns" "$POOL_APPDATA finns inte" test -d "$POOL_APPDATA"
krav "nätet $NAT" "nätet $NAT finns inte" docker network inspect "$NAT"
case "$PORT" in
  ''|*[!0-9]*) fel "PORT ska vara ett tal, inte \"$PORT\"" ;;
  *)
    # Lyssnar något på porten? /dev/tcp finns i bash, oberoende av ss och netstat
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
      ok "port $PORT är ledig"
    elif docker port boardgames 2>/dev/null | grep -q ":$PORT\$"; then
      ok "port $PORT används av boardgames (uppdatering)"
    else
      fel "port $PORT är upptagen; välj en annan med PORT=<nr>"
    fi ;;
esac
case "$ADRESS" in
  ''|http://*|https://*) ;;
  *) fel "ADRESS ska börja med http:// eller https://" ;;
esac
case "$ADRESS" in *"'"*) fel "ADRESS får inte innehålla enkla citattecken" ;; esac
case "$PIN" in
  '') ;;
  *[!0-9]*) fel "PIN ska bara innehålla siffror" ;;
  ????|?????|??????|???????|????????) ;;
  *) fel "PIN ska vara 4–8 siffror" ;;
esac
if [ -n "$KALLA" ]; then
  krav "källkod i $KALLA" "ingen källkod i $KALLA" test -f "$KALLA/Dockerfile" -a -f "$KALLA/deploy/compose.yaml"
fi
if [ "$FEL" -gt 0 ]; then echo; echo "Avbryter: rätta felen ovan. Inget är ändrat."; exit 1; fi

hr "2. GÄSTNÄTET"
# Wifi-koden på storbilden bär gästnätets namn och lösenord. Frågan ställs en gång, i en terminal.
case "$WIFI" in ''|av) ;; *) fel "WIFI kan bara vara av (WIFI=av tar bort wifi-koden)" ;; esac
if [ "$WIFI" = "av" ]; then
  if [ -n "$WIFI_NAMN" ]; then fel "WIFI=av och WIFI_NAMN går inte ihop"; else info "wifi-koden tas bort"; fi
elif [ -z "$WIFI_NAMN" ]; then
  if [ -n "$(envvarde WIFI_SSID)" ]; then
    ok "wifi-koden visar nätet $(envvarde WIFI_SSID) (ur .env)"
  elif [ -f "$ENVF" ] && grep -q '^WIFI_SSID=' "$ENVF"; then
    info "ingen wifi-kod. Slå på den med WIFI_NAMN=<nätets namn> framför bash"
  elif [ "$DRYRUN" = "true" ]; then
    info "frågan om gästnätet ställs vid en riktig körning"
  elif terminal; then
    fraga WIFI_NAMN "Gästnätets namn till wifi-koden på storbilden (Enter hoppar över): "
    if [ -z "$WIFI_NAMN" ]; then WIFI_NEJ=1; info "ingen wifi-kod. Slå på den senare med WIFI_NAMN=<nätets namn> framför bash"; fi
  else
    info "ingen terminal: frågan om gästnätet ställs nästa gång, eller ange WIFI_NAMN och WIFI_LOSEN"
  fi
fi
if [ -n "$WIFI_NAMN" ] && [ "$WIFI" != "av" ]; then
  if [ -z "$WIFI_LOSEN" ] && [ "$DRYRUN" != "true" ]; then
    fraga WIFI_LOSEN "Lösenordet till $WIFI_NAMN (syns inte när du skriver): " dold
  fi
  # Enkla citattecken och bakstreck går inte att skriva entydigt i .env
  case "$WIFI_NAMN$WIFI_LOSEN" in
    *"'"*|*"\\"*) fel "nätets namn och lösenord får inte innehålla enkla citattecken eller bakstreck" ;;
  esac
  if [ "${#WIFI_NAMN}" -gt 32 ]; then fel "nätets namn är längre än 32 tecken"; fi
  if [ -z "$WIFI_LOSEN" ] && [ "$DRYRUN" = "true" ]; then
    info "lösenordet frågas efter vid en riktig körning"
  elif [ "${#WIFI_LOSEN}" -lt 8 ] || [ "${#WIFI_LOSEN}" -gt 63 ]; then
    fel "lösenordet ska vara 8–63 tecken (skriv det när skriptet frågar, eller ange WIFI_LOSEN)"
  fi
  if [ "$FEL" -eq 0 ]; then ok "wifi-koden kommer att visa nätet $WIFI_NAMN"; fi
fi
if [ "$FEL" -gt 0 ]; then echo; echo "Avbryter: rätta felen ovan. Inget är ändrat."; exit 1; fi

hr "3. DET HÄR GÖRS"
if [ -n "$KALLA" ]; then info "avbild: byggs från $KALLA till boardgames:lokal"; else info "avbild: $IMAGE"; fi
info "projekt: $PROJ (compose.yaml, compose.override.yaml, name, autostart, .env 0600)"
info "port: $PORT mot LAN"
if [ -n "$ADRESS" ]; then info "QR-koden pekar på $ADRESS"; fi
if [ "$WIFI" = "av" ]; then info "wifi-kod: tas bort ur .env"; fi
if [ -n "$WIFI_NAMN" ]; then info "wifi-kod: nätet $WIFI_NAMN, med lösenordet i .env"; fi
if [ -n "$PIN" ]; then info "värdens pinkod: den du har valt"; fi
info "katalog: $APPDIR/data (99:100, 0770)"
info "uppdatering: $UPPDATERA varje timme, via $CRONFIL"
info "start: docker compose up -d (boardgames)"
LAGE="$(curl -fsS -m 3 "http://127.0.0.1:$PORT/lage" 2>/dev/null)"
case "$LAGE" in
  *'"phase":"game"'*) varn "ett spel pågår just nu. Omstarten avbryter det i några sekunder; läget finns kvar" ;;
esac
if [ "$DRYRUN" = "true" ]; then echo; echo "Torrkörning: inget är ändrat."; exit 0; fi
if [ "$DRYRUN" != "false" ]; then
  if ! terminal; then echo; echo "Ingen terminal: kör med DRYRUN=false för att utföra."; exit 0; fi
  fraga SVAR "Kör? [j/N] "
  case "$SVAR" in j|J|ja|Ja) ;; *) echo "Inget är ändrat."; exit 0 ;; esac
fi

hr "4. AVBILD"
if [ -n "$KALLA" ]; then
  IMAGE="boardgames:lokal"
  docker build -t "$IMAGE" "$KALLA" || { echo "Bygget misslyckades."; exit 1; }
else
  docker pull -q "$IMAGE" || { echo "Kunde inte hämta $IMAGE. Är paketet publikt i GHCR?"; exit 1; }
fi
ok "$IMAGE"

hr "5. PROJEKTET"
NY="$(mktemp)"; NYUPP="$(mktemp)"
trap 'rm -f "$NY" "$NYUPP"' EXIT
if [ -n "$KALLA" ]; then
  cp "$KALLA/deploy/compose.yaml" "$NY" && cp "$KALLA/deploy/boardgames-uppdatera-v1.sh" "$NYUPP"
else
  docker run --rm --entrypoint cat "$IMAGE" /app/deploy/compose.yaml > "$NY" \
    && docker run --rm --entrypoint cat "$IMAGE" /app/deploy/boardgames-uppdatera-v1.sh > "$NYUPP"
fi
[ -s "$NY" ] && [ -s "$NYUPP" ] || { echo "compose.yaml eller uppdateringsskriptet saknas i avbilden."; exit 1; }
mkdir -p "$PROJ"
if [ -f "$PROJ/compose.yaml" ] && cmp -s "$NY" "$PROJ/compose.yaml"; then
  ok "compose.yaml oförändrad"
else
  if [ -f "$PROJ/compose.yaml" ]; then
    diff -u "$PROJ/compose.yaml" "$NY" | sed 's/^/    /'
    cp -p "$PROJ/compose.yaml" "$PROJ/compose.yaml.bak-$TS"
  fi
  cp "$NY" "$PROJ/compose.yaml" && ok "compose.yaml skriven"
fi
for par in "compose.override.yaml:services: {}" "name:boardgames" "autostart:true"; do
  fil="${par%%:*}"; innehall="${par#*:}"
  if [ -f "$PROJ/$fil" ]; then ok "$fil finns"; else printf '%s' "$innehall" > "$PROJ/$fil" && ok "$fil skapad"; fi
done

satt() { # satt <nyckel> <värde> [ja]: lägger till en saknad nyckel; med "ja" skrivs värdet om
  local nyckel="$1" varde="$2" visas="$2" rad tmp
  case "$nyckel" in *PIN*|*PASSWORD*) [ -n "$varde" ] && visas="<dold>" ;; esac
  rad="$(envrad "$nyckel" "$varde")"
  if [ -f "$ENVF" ] && grep -q "^$nyckel=" "$ENVF"; then
    if [ "${3:-}" = "ja" ] && [ "$(envvarde "$nyckel")" != "$varde" ]; then
      # Värdet går via miljön till awk, så att inga tecken i det tolkas
      tmp="$(mktemp)"
      RAD="$rad" NYCKEL="$nyckel" awk 'index($0, ENVIRON["NYCKEL"] "=") == 1 { print ENVIRON["RAD"]; next } { print }' \
        "$ENVF" > "$tmp" && cat "$tmp" > "$ENVF" && ok "$nyckel=$visas (uppdaterad)"
      rm -f "$tmp"
    fi
  else
    (umask 077; printf '%s\n' "$rad" >> "$ENVF") && ok "$nyckel=$visas"
  fi
}
satt BOARDGAMES_IMAGE "$IMAGE" ja
satt BOARDGAMES_PORT "$PORT" ja
# Fyra siffror om inget annat valts: koden skrivs in på värdens mobil en gång och sparas där
if [ -n "$PIN" ]; then
  satt ADMIN_PIN "$PIN" ja
else
  satt ADMIN_PIN "$(printf '%04d' $(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' \n') % 10000 )))"
fi
# Tomma nycklar betyder att frågan om gästnätet är besvarad med nej. Då ställs den inte igen.
if [ -n "$WIFI_NAMN" ]; then
  satt WIFI_SSID "$WIFI_NAMN" ja
  satt WIFI_PASSWORD "$WIFI_LOSEN" ja
elif [ "$WIFI" = "av" ]; then
  satt WIFI_SSID "" ja
  satt WIFI_PASSWORD "" ja
elif [ -n "$WIFI_NEJ" ]; then
  satt WIFI_SSID ""
  satt WIFI_PASSWORD ""
fi
if [ -n "$ADRESS" ]; then satt PUBLIC_URL "${ADRESS%/}" ja; else satt PUBLIC_URL ""; fi
chmod 0600 "$ENVF"

hr "6. KATALOG"
if mkdir -p "$APPDIR/data" && chown 99:100 "$APPDIR" "$APPDIR/data" && chmod 0770 "$APPDIR" "$APPDIR/data"; then
  ok "$APPDIR/data"
else
  fel "kunde inte förbereda $APPDIR/data"
fi

hr "7. UPPDATERING VARJE TIMME"
mkdir -p "$SKRIPTKATALOG" && cp "$NYUPP" "$UPPDATERA" && ok "$UPPDATERA"
printf '%s\n' "# Sällskapsspelen: ny avbild från GHCR varje timme, inte under 3D-utskrift och inte mitt i ett spel" \
  "40 * * * * /bin/bash $UPPDATERA > /dev/null 2>&1" > "$CRONFIL" && ok "$CRONFIL"
if command -v update_cron >/dev/null 2>&1; then update_cron; fi
if grep -qs "boardgames-uppdatera" "$CRONROT"; then ok "schemat är aktivt"; else varn "schemat syns inte i $CRONROT"; fi

hr "8. START"
dc up -d || { echo "docker compose up misslyckades."; exit 1; }
halsa=""
for _ in $(seq 1 30); do
  halsa="$(curl -fsS -m 2 "http://127.0.0.1:$PORT/halsa" 2>/dev/null)" && break
  sleep 2
done
if [ "$halsa" = "ok" ]; then ok "servern svarar på port $PORT"; else fel "svarar inte på /halsa"; docker logs --tail 30 boardgames; fi

hr "9. KONTROLL"
if [ "$halsa" = "ok" ]; then
  for sida in / /start /scen /admin /qr.svg /lage; do
    svar="$(kod "http://127.0.0.1:$PORT$sida")"
    if [ "$svar" = "200" ]; then ok "sidan $sida svarar genom porten"; else fel "sidan $sida svarade $svar genom porten"; fi
  done
  # WebSocket genom den publicerade porten: servern ska svara 101 på en uppgradering
  # Förbindelsen står öppen efter svaret, så curl får två sekunder på sig och avbryts sedan
  svar="$(kod -m 2 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "http://127.0.0.1:$PORT/ws")"
  if [ "$svar" = "101" ]; then ok "WebSocket går fram genom porten"; else fel "WebSocket svarade $svar genom porten, väntat 101"; fi
  anv="$(docker inspect -f '{{.Config.User}}' boardgames 2>/dev/null)"
  if [ "$anv" = "99:100" ]; then ok "containern kör som 99:100"; else varn "containern kör som \"$anv\", väntat 99:100"; fi
  info "kontroll inifrån containern:"
  kontroll="$(docker exec boardgames node deploy/kontroll.js 2>&1)"; rc=$?
  printf '%s\n' "$kontroll"
  FEL=$((FEL + $(grep -c '^  FEL ' <<< "$kontroll")))
  VARN=$((VARN + $(grep -c '^  VARNING ' <<< "$kontroll")))
  if [ "$rc" -gt 1 ]; then fel "kontrollen kunde inte köras (kod $rc)"; fi
fi

echo
echo "Klart: $FEL fel, $VARN varningar."
IP="$(ip -4 -o route get 1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
BAS="http://${IP:-<serverns adress>}:$PORT"
echo "Start:    $BAS/start   (länkar till allt, och hur kvällen startas)"
echo "Storbild: $BAS/scen"
echo "Värd:     $BAS/admin   pinkod: $(envvarde ADMIN_PIN)"
if [ -n "$(envvarde WIFI_SSID)" ]; then
  echo "Mobiler:  skannar wifi-koden till $(envvarde WIFI_SSID) på storbilden, och sedan spelets kod"
else
  echo "Mobiler:  skannar QR-koden på storbilden"
fi
echo "Samma kontroll när du vill: docker exec boardgames node deploy/kontroll.js"
[ "$FEL" -eq 0 ]
)
