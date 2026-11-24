#!/usr/bin/env python3
"""Layoutkontroll i en riktig webbläsare.

Ritar varje läge från states.js på storbilden, mobilen och värdsidan och mäter:
- storbilden: inget hamnar utanför bilden, inget innehåll är bredare än sin ruta och
  ingen text är mindre än 3,5 % av bildhöjden (i 16:9 och 16:10)
- lobbyn på storbilden: samma mått med wifi-kod och utan, med sex lag och med fyra, och hur breda koderna blir
- mobilen, värdsidan och startsidan: ingenting sticker ut i sidled
- länkarna mellan sidorna: storbilden och startsidan öppnar värdsidan i ett eget fönster
- värdsidans knappar: att ångra kräver två tryck, och ett tryck på något annat avbryter
- alla sidor: typsnittet som följer med appen är laddat, så att måtten gäller på alla skärmar

Kräver Python med Playwright och en Chrome eller Chromium. Körs från repots rot:

    python3 tools/layoutcheck/check.py

Miljövariabler: CHROME (sökväg till webbläsaren), SHOTS (mapp för skärmbilder), PORT.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT = os.environ.get("PORT", "8097")
URL = f"http://127.0.0.1:{PORT}"
SHOTS = pathlib.Path(os.environ["SHOTS"]) if os.environ.get("SHOTS") else None
STAGE_SIZES = [(1920, 1080), (1280, 720), (1280, 800)]
PHONE_SIZES = [(390, 844), (360, 640)]

MEASURE = """
(root, big) => {
  const vw = innerWidth, vh = innerHeight, min = 0.035 * vh - 0.01;
  const bad = new Set();
  let margin = Infinity;
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const name = '.' + String(el.className || el.tagName).trim().split(' ').join('.');
    if (r.left < -0.5 || r.right > vw + 0.5) bad.add(name + ': sticker ut i sidled');
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') bad.add(name + ': innehållet är bredare än rutan');
    if (!big) continue;
    margin = Math.min(margin, r.top, vh - r.bottom);
    if (r.top < -0.5 || r.bottom > vh + 0.5) bad.add(name + ': utanför bilden i höjdled');
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // Värdens egna knappar på storbilden får vara mindre.
    if (text && !el.classList.contains('ctl') && parseFloat(getComputedStyle(el).fontSize) < min) bad.add(name + ': text under 3,5 % av bildhöjden');
  }
  // Måtten gäller bara om sidan ritas med typsnittet som följer med appen, inte med ett som råkar finnas här.
  const own = [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Syna' && f.status === 'loaded');
  if (!own || !getComputedStyle(document.body).fontFamily.startsWith('Syna')) bad.add('typsnittet som följer med appen är inte laddat');
  return { bad: [...bad], margin: big ? Math.round((margin / vh) * 1000) / 10 : null, height: document.documentElement.scrollHeight };
}
"""

STAGE = """
async ({ state, now }) => {
  const m = await import('/syna.js');
  document.body.classList.add('ingame');
  const game = document.getElementById('game');
  game.hidden = false;
  game.innerHTML = m.stage(state, now);
  game.querySelectorAll('[data-ends]').forEach((el) => el.removeAttribute('data-ends'));
  await document.fonts.ready;
  return (%s)(game, true);
}
""" % MEASURE

PHONE = """
async ({ state, now, host }) => {
  const m = await import('/syna.js');
  const app = document.getElementById('app');
  app.innerHTML = host
    ? '<h1>Värd</h1>' + m.admin(state, now, false)
    : m.player(state, now) + '<button class="link" data-do="leave">Byt lag eller roll</button>';
  app.querySelectorAll('[data-ends]').forEach((el) => el.removeAttribute('data-ends'));
  await document.fonts.ready;
  return (%s)(app, false);
}
""" % MEASURE

LOBBY = """
() => {
  const res = (%s)(document.body, true);
  // Kodernas bredd avgör hur långt ifrån de går att skanna.
  res.codes = [...document.querySelectorAll('.join img')].filter((i) => i.offsetWidth).map((i) => Math.round((i.offsetWidth / innerWidth) * 1000) / 10);
  return res;
}
""" % MEASURE

PAGE = "() => (%s)(document.body, false)" % MEASURE

# Ett nätnamn på 32 tecken, det längsta som finns, och ett långt lösenord: den tätaste koden och den längsta texten.
WIFI = {"WIFI_SSID": "Gästnätet på övervåningen jul 26", "WIFI_PASSWORD": "ett-langt-losenord-for-provet-0123456789"}


def main():
    data = json.loads(subprocess.check_output(["node", "tools/layoutcheck/states.js"], cwd=ROOT))
    cases = data["cases"]
    tmp = tempfile.mkdtemp(prefix="layout-")
    pathlib.Path(tmp, "room.json").write_text(json.dumps(data["lobby"]))
    env = dict(os.environ, PORT=PORT, DATA_DIR=tmp, ADMIN_PIN="1234", **WIFI)
    server = subprocess.Popen(["node", "server/index.js"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL)
    failures, lobby, codes, tightest, tall = [], {}, {}, {}, {}
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(URL + "/halsa", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        if SHOTS:
            SHOTS.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("CHROME") or None, args=["--no-sandbox"])
            errors = []

            # Servern har ett gästnät inställt. Med wifi=False får sidan svaret att inget är inställt.
            def open_page(path, w, h, wait, wifi=True):
                page = browser.new_context(viewport={"width": w, "height": h}).new_page()
                page.on("pageerror", lambda e: errors.append(f"{path}: {e}"))
                if not wifi:
                    page.route("**/wifi", lambda route: route.fulfill(json={"ssid": None}))
                page.goto(URL + path)
                page.wait_for_selector(wait)
                page.wait_for_function("[...document.images].filter((i) => i.getAttribute('src')).every((i) => i.complete && i.naturalWidth)")
                page.wait_for_timeout(300)
                return page

            def check_lobby(w, h, teams, wifi):
                size, label = f"{w}x{h}", f"lobbyn med {teams} lag" + (" och wifi-kod" if wifi else "")
                page = open_page("/scen", w, h, "body.wifi #wificode:not([hidden])" if wifi else ".tile", wifi)
                page.wait_for_function(f"document.querySelectorAll('.tile').length === {teams}")
                res = page.evaluate(LOBBY)
                lobby[size, wifi] = min(res["margin"], lobby.get((size, wifi), 100))
                codes[size, teams, wifi] = res["codes"]
                failures.extend(f"storbild {size}, {label}: {b}" for b in res["bad"])
                if len(res["codes"]) != (2 if wifi else 1):
                    failures.append(f"storbild {size}, {label}: {len(res['codes'])} koder visas")
                if SHOTS:
                    page.screenshot(path=str(SHOTS / f"scen-{label.replace(' ', '-')}-{size}.png"))
                return page

            for w, h in STAGE_SIZES:
                size = f"{w}x{h}"
                check_lobby(w, h, 6, True).context.close()
                page = check_lobby(w, h, 6, False)
                for c in cases:
                    res = page.evaluate(STAGE, {"state": c["stage"], "now": c["now"]})
                    failures += [f"storbild {size}, {c['name']}: {b}" for b in res["bad"]]
                    if size not in tightest or res["margin"] < tightest[size][1]:
                        tightest[size] = (c["name"], res["margin"])
                    if SHOTS and w == 1920:
                        page.screenshot(path=str(SHOTS / f"scen-{c['name']}.png"))
                page.context.close()

            for w, h in PHONE_SIZES:
                size = f"{w}x{h}"
                page = open_page("/", w, h, "button.big")
                host = open_page("/admin", w, h, "#pinform")
                for c in cases:
                    views = [(f"mobil {role}", page, s, False) for role, s in c["phones"].items()] + [("värd", host, c["admin"], True)]
                    for label, pg, state, is_host in views:
                        res = pg.evaluate(PHONE, {"state": state, "now": c["now"], "host": is_host})
                        failures += [f"{label} {size}, {c['name']}: {b}" for b in res["bad"]]
                        if not is_host and res["height"] > h:
                            key = (size, label)
                            if res["height"] > tall.get(key, ("", 0))[1]:
                                tall[key] = (c["name"], res["height"])
                        if SHOTS and w == 390:
                            pg.screenshot(path=str(SHOTS / f"{label.replace(' ', '-')}-{c['name']}.png"), full_page=True)
                page.context.close()
                host.context.close()

            # Värden loggar in och minskar till fyra lag, som en riktig värd gör. Då får koderna mer plats.
            host = open_page("/admin", 390, 844, "#pinform")
            host.fill("#pinform input", "1234")
            host.click("#pinform button")
            for left in (5, 4):
                host.click("button[data-do=teams] >> nth=0")
                host.wait_for_function(f"document.querySelector('.step span')?.textContent === '{left}'")
            host.context.close()
            for w, h in STAGE_SIZES:
                check_lobby(w, h, 4, True).context.close()
                check_lobby(w, h, 4, False).context.close()

            # Länkarna som gör att bara startsidans adress behöver kommas ihåg.
            for path, link, target in (("/scen", "a[href='/admin']", "/admin"), ("/scen", "a[href='/start']", "/start"),
                                       ("/start", "a[href='/admin']", "/admin"), ("/start", "a[href='/scen']", "/scen")):
                page = open_page(path, 1280, 720, link)
                with page.expect_popup() as opened:
                    page.click(link)
                if not opened.value.url.endswith(target):
                    failures.append(f"länken {link} på {path} öppnade {opened.value.url}")
                page.context.close()

            for w, h in PHONE_SIZES + [(1280, 720)]:
                for label, wifi in (("startsidan med gästnät", True), ("startsidan", False)):
                    page = open_page("/start", w, h, "#wifistep:not([hidden])" if wifi else "h1", wifi)
                    failures += [f"{label} {w}x{h}: {b}" for b in page.evaluate(PAGE)["bad"]]
                    if SHOTS and w != 360:
                        page.screenshot(path=str(SHOTS / f"{label.replace(' ', '-')}-{w}x{h}.png"), full_page=True)
                    page.context.close()

            # Sist, eftersom det startar ett spel: värden ångrar ett steg med två tryck på riktiga knappar.
            host = open_page("/admin", 390, 844, "#pinform")
            host.fill("#pinform input", "1234")
            host.click("#pinform button")
            host.click("button[data-do=start]")
            host.wait_for_selector("button[data-do=swapTask]")
            undo = "button[data-do=undo]"
            if host.query_selector(undo):
                failures.append("värdsidan: ångra visas i spelets första steg")
            host.click("button[data-do=next]")
            host.wait_for_selector(undo)
            want = "Ångra: tillbaka till uppdraget"
            if host.inner_text(undo) != want:
                failures.append(f"värdsidan: knappen säger {host.inner_text(undo)!r}")
            host.click(undo)
            if host.inner_text(undo) != "Säker? Tryck igen":
                failures.append("värdsidan: första trycket på ångra ber inte om ett till")
            host.click("button[data-do=bid] >> nth=0")
            host.wait_for_function(f"document.querySelector('{undo}')?.textContent === '{want}'")
            if host.query_selector("button[data-do=swapTask]"):
                failures.append("värdsidan: ett tryck på ångra räckte")
            host.click(undo)
            host.click(undo)
            host.wait_for_selector("button[data-do=swapTask]")
            if host.query_selector(undo):
                failures.append("värdsidan: ångra finns kvar efter att steget är ångrat")
            host.context.close()
            browser.close()
            failures += [f"fel i sidan: {e}" for e in errors]
    finally:
        server.terminate()

    print(f"{len(cases)} lägen provade på storbild ({', '.join(f'{w}x{h}' for w, h in STAGE_SIZES)}) och mobil ({', '.join(f'{w}x{h}' for w, h in PHONE_SIZES)})")
    for size, (name, margin) in tightest.items():
        print(f"storbild {size}: minsta luft över och under innehållet är {margin} % av bildhöjden i spelet ({name}), {lobby[size, False]} % i lobbyn och {lobby[size, True]} % i lobbyn med wifi-kod")
        print(f"storbild {size}: koden är {codes[size, 6, False][0]} % av bildbredden. Med wifi-kod är de två koderna {codes[size, 4, True][0]} % var med fyra lag och {codes[size, 6, True][0]} % med sex")
    for (size, label), (name, height) in sorted(tall.items()):
        print(f"{label} {size}: högsta sidan är {height} px och kräver rullning ({name})")
    if failures:
        print(f"\n{len(failures)} fel:")
        for f in sorted(set(failures)):
            print("  " + f)
        sys.exit(1)
    print("Inga fel.")


if __name__ == "__main__":
    main()
