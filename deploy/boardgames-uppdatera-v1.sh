#!/bin/bash
# =============================================================================
#  boardgames-uppdatera-v1.sh
# -----------------------------------------------------------------------------
#  Körs varje timme av cron (installeras av boardgames-installera-v1.sh).
#  Hämtar avbilden från GHCR. Kör containern en äldre avbild tas en kopia av
#  läget, och sedan startas containern om med den nya.
#  Väntar till nästa timme
#    - medan 3D-skrivaren skriver ut
#    - medan ett spel pågår (ändrat de senaste tre timmarna)
#    - när någon har varit inne de senaste tio minuterna
#  En stoppad container startas inte. En merge i GitHub är alltså i drift inom
#  ungefär en timme, men aldrig mitt i en spelkväll.
#  Loggar till syslog med taggen boardgames-uppdatera.
# =============================================================================
(
set -uo pipefail
PROJ="${PROJ:-/boot/config/plugins/compose.manager/projects/boardgames}"
POOL_APPDATA="${POOL_APPDATA:-/mnt/system_apps/appdata}"
MOONRAKER="${MOONRAKER:-http://127.0.0.1:7125}"
SPEL_SEK="${SPEL_SEK:-10800}"
VILA_SEK="${VILA_SEK:-600}"
ENVF="$PROJ/.env"
DATA="$POOL_APPDATA/boardgames/data"
logg() { logger -t boardgames-uppdatera "$*"; }
envvarde() { grep -m1 "^$1=" "$ENVF" 2>/dev/null | cut -d= -f2- | sed "s/^'\(.*\)'\$/\1/"; }

if curl -fsS -m 3 "$MOONRAKER/printer/objects/query?print_stats=state" 2>/dev/null \
  | grep -q '"state": *"printing"'; then
  logg "utskrift pågår, väntar till nästa timme"
  exit 0
fi

IMAGE="$(envvarde BOARDGAMES_IMAGE)"
case "$IMAGE" in ghcr.io/*) ;; *) exit 0 ;; esac  # lokalt byggd avbild uppdateras inte här

docker pull -q "$IMAGE" > /dev/null 2>&1 || { logg "kunde inte hämta $IMAGE"; exit 1; }
ny="$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)"
# Jämför med avbilden som containern faktiskt kör. Då görs en uppdatering som fick vänta
# en timme, eller som misslyckades, om vid nästa körning.
kor="$(docker inspect -f '{{.Image}}' boardgames 2>/dev/null)"
[ -n "$kor" ] || exit 0                    # ingen container: installationsskriptet skapar den
[ -n "$ny" ] && [ "$ny" != "$kor" ] || exit 0

if [ "$(docker inspect -f '{{.State.Running}}' boardgames 2>/dev/null)" != "true" ]; then
  logg "ny avbild ${ny:7:12} är hämtad, men containern är stoppad och startas inte"
  exit 0
fi

PORT="$(envvarde BOARDGAMES_PORT)"
PORT="${PORT:-8090}"
lage="$(curl -fsS -m 3 "http://127.0.0.1:$PORT/lage" 2>/dev/null)"
if [ -n "$lage" ]; then
  vila="$(printf '%s' "$lage" | grep -o '"idleSec":[0-9]*' | cut -d: -f2)"
  vila="${vila:-0}"
  if printf '%s' "$lage" | grep -q '"phase":"game"' && [ "$vila" -lt "$SPEL_SEK" ]; then
    logg "ett spel pågår, väntar till nästa timme"
    exit 0
  fi
  if [ "$vila" -lt "$VILA_SEK" ]; then
    logg "någon har nyss varit inne, väntar till nästa timme"
    exit 0
  fi
fi

if [ -f "$DATA/room.json" ]; then
  cp -p "$DATA/room.json" "$DATA/room.json.fore-uppdatering" 2>/dev/null \
    || logg "kopian av läget före uppdateringen misslyckades"
fi

if ! docker compose --project-directory "$PROJ" -p boardgames \
  -f "$PROJ/compose.yaml" -f "$PROJ/compose.override.yaml" up -d > /dev/null 2>&1; then
  logg "omstarten med ny avbild misslyckades"
  exit 1
fi
for _ in $(seq 1 15); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/halsa" > /dev/null 2>&1; then
    logg "uppdaterad till ${ny:7:12}"
    docker image rm "$kor" > /dev/null 2>&1
    exit 0
  fi
  sleep 2
done
logg "uppdaterad till ${ny:7:12}, men servern svarar inte på /halsa"
exit 1
)
