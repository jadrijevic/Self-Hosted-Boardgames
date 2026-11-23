// Installations- och uppdateringsskripten körs här på riktigt, mot en låtsas-docker (test/stubs).
// "docker compose up -d" startar den riktiga servern, så kontrollerna i skripten går mot en riktig server.
// Det som inte provas här är Docker och Unraid själva: avbilden, rättigheterna 99:100 och Compose Manager.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';

const run = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(REPO, 'deploy/boardgames-installera-v1.sh');
const UPDATE = path.join(REPO, 'deploy/boardgames-uppdatera-v1.sh');
const OLD = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (file) => readFile(file, 'utf8');
const readOr = (file) => read(file).catch(() => '');

// En låtsas-Unraid i en tillfällig katalog: projektmapp, pool, skriptmapp och cron.
async function unraid() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'boardgames-'));
  const port = await freePort();
  const dirs = { STUB: `${root}/stub`, PROJ: `${root}/projects/boardgames`, POOL_APPDATA: `${root}/pool/appdata`, SKRIPTKATALOG: `${root}/scripts` };
  await mkdir(dirs.STUB, { recursive: true });
  await mkdir(dirs.POOL_APPDATA, { recursive: true });
  await writeFile(`${dirs.STUB}/avbild-id`, OLD);
  const env = {
    ...process.env,
    ...dirs,
    REPO,
    PATH: `${REPO}/test/stubs:${process.env.PATH}`,
    CRONFIL: `${root}/boardgames.cron`,
    CRONROT: `${root}/cron.d-root`,
    MOONRAKER: 'http://127.0.0.1:9', // ingen skrivare svarar
    PORT: String(port),
  };
  const sh = async (script, extra = {}) => {
    try {
      const { stdout } = await run('bash', [script], { env: { ...env, ...extra } });
      return { code: 0, out: stdout };
    } catch (e) {
      return { code: e.code, out: `${e.stdout}${e.stderr}` };
    }
  };
  const stop = async () => {
    const pid = Number(await readOr(`${dirs.STUB}/pid`));
    if (pid) { try { process.kill(pid); } catch { /* redan stoppad */ } }
  };
  return {
    root, port, env, sh, stop, ...dirs,
    calls: () => readOr(`${dirs.STUB}/anrop.log`),
    syslog: () => readOr(`${dirs.STUB}/syslog`),
    lage: async () => (await fetch(`http://127.0.0.1:${port}/lage`)).json(),
    cleanup: async () => { await stop(); await rm(root, { recursive: true, force: true }); },
  };
}

const count = (text, needle) => text.split(needle).length - 1;

test('torrkörning och körning utan terminal ändrar ingenting', async (t) => {
  const u = await unraid();
  t.after(u.cleanup);
  const dry = await u.sh(INSTALL, { DRYRUN: 'true' });
  assert.equal(dry.code, 0);
  assert.match(dry.out, /=== 2\. DET HÄR GÖRS ===/);
  assert.match(dry.out, new RegExp(`port: ${u.port} mot LAN`));
  assert.match(dry.out, /Torrkörning: inget är ändrat\./);
  const noTty = await u.sh(INSTALL);
  assert.equal(noTty.code, 0);
  assert.match(noTty.out, /Ingen terminal: kör med DRYRUN=false för att utföra\./);
  assert.equal(existsSync(u.PROJ), false);
  assert.equal(existsSync(`${u.POOL_APPDATA}/boardgames`), false);
  assert.doesNotMatch(await u.calls(), /pull|up -d/);
});

test('upptagen port och trasig adress avbryter innan något ändras', async (t) => {
  const u = await unraid();
  const blocker = net.createServer().listen(u.port, '127.0.0.1');
  t.after(async () => { blocker.close(); await u.cleanup(); });
  const busy = await u.sh(INSTALL, { DRYRUN: 'false' });
  assert.equal(busy.code, 1);
  assert.match(busy.out, new RegExp(`FEL     port ${u.port} är upptagen`));
  assert.match(busy.out, /Inget är ändrat\./);
  const bad = await u.sh(INSTALL, { DRYRUN: 'false', PORT: String(await freePort()), ADRESS: 'syna.example.org' });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /ADRESS ska börja med http/);
  assert.equal(existsSync(u.PROJ), false);
});

test('installation och uppdatering från början till slut', async (t) => {
  const u = await unraid();
  t.after(u.cleanup);
  let pin;

  await t.test('installationen skapar projektet, startar servern och kontrollerar den', async () => {
    const r = await u.sh(INSTALL, { DRYRUN: 'false' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Klart: 0 fel, 0 varningar\./);

    assert.equal(await read(`${u.PROJ}/compose.yaml`), await read(`${REPO}/deploy/compose.yaml`));
    assert.equal(await read(`${u.PROJ}/compose.override.yaml`), 'services: {}');
    assert.equal(await read(`${u.PROJ}/name`), 'boardgames');
    assert.equal(await read(`${u.PROJ}/autostart`), 'true');
    const envFile = await read(`${u.PROJ}/.env`);
    assert.equal((await stat(`${u.PROJ}/.env`)).mode & 0o777, 0o600);
    assert.match(envFile, /^BOARDGAMES_IMAGE=ghcr\.io\/jadrijevic\/self-hosted-boardgames:latest$/m);
    assert.match(envFile, new RegExp(`^BOARDGAMES_PORT=${u.port}$`, 'm'));
    assert.match(envFile, /^PUBLIC_URL=$/m);
    pin = /^ADMIN_PIN=(\d{4})$/m.exec(envFile)?.[1];
    assert.ok(pin, 'pinkoden är fyra siffror');
    assert.doesNotMatch(r.out.split('Klart:')[0], new RegExp(`ADMIN_PIN=${pin}`), 'pinkoden skrivs inte ut under installationen');
    assert.match(r.out, new RegExp(`pinkod: ${pin}`));

    assert.equal((await stat(`${u.POOL_APPDATA}/boardgames/data`)).mode & 0o777, 0o770);
    assert.match(await u.calls(), new RegExp(`chown 99:100 ${u.POOL_APPDATA}/boardgames ${u.POOL_APPDATA}/boardgames/data`));
    assert.equal(await read(`${u.SKRIPTKATALOG}/boardgames-uppdatera-v1.sh`), await read(UPDATE));
    assert.match(await read(u.env.CRONFIL), new RegExp(`^40 \\* \\* \\* \\* /bin/bash ${u.SKRIPTKATALOG}/boardgames-uppdatera-v1\\.sh > /dev/null 2>&1$`, 'm'));

    for (const line of ['servern svarar på port', 'sidan /scen svarar genom porten', 'WebSocket går fram genom porten', 'containern kör som 99:100', 'WebSocket: läget kom fram (4 lag, lobby)', `läget sparas i ${u.POOL_APPDATA}/boardgames/data`, 'värdens pinkod är fast']) {
      assert.ok(r.out.includes(`  OK      ${line}`), `saknar: ${line}\n${r.out}`);
    }
    assert.equal((await u.lage()).phase, 'lobby');
  });

  await t.test('en ny körning lämnar pinkoden och det som stämmer orört, och ADRESS styr QR-koden', async () => {
    const r = await u.sh(INSTALL, { DRYRUN: 'false', ADRESS: 'https://syna.example.org/' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /port \d+ används av boardgames \(uppdatering\)/);
    assert.match(r.out, /compose\.yaml oförändrad/);
    assert.match(r.out, /Klart: 0 fel, 0 varningar\./);
    const envFile = await read(`${u.PROJ}/.env`);
    assert.match(envFile, new RegExp(`^ADMIN_PIN=${pin}$`, 'm'));
    assert.match(envFile, /^PUBLIC_URL=https:\/\/syna\.example\.org$/m);
    assert.equal(count(envFile, 'BOARDGAMES_PORT='), 1);
    assert.equal(await (await fetch(`http://127.0.0.1:${u.port}/adress`)).text(), 'https://syna.example.org');
  });

  await t.test('uppdateringen: samma avbild ger ingen omstart', async () => {
    const before = count(await u.calls(), ' up -d');
    const r = await u.sh(UPDATE, { VILA_SEK: '0' });
    assert.equal(r.code, 0);
    assert.equal(count(await u.calls(), ' up -d'), before);
    assert.equal(await u.syslog(), '');
  });

  await t.test('uppdateringen väntar när någon nyss har varit inne', async () => {
    await writeFile(`${u.STUB}/ny-avbild`, NEW);
    const before = count(await u.calls(), ' up -d');
    const r = await u.sh(UPDATE);
    assert.equal(r.code, 0);
    assert.equal(count(await u.calls(), ' up -d'), before);
    assert.match(await u.syslog(), /någon har nyss varit inne, väntar till nästa timme/);
  });

  await t.test('uppdateringen väntar medan ett spel pågår, och spelet överlever omstarten när den väl görs', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${u.port}/ws`);
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ t: 'hello', kind: 'admin', pin }));
    ws.send(JSON.stringify({ t: 'start' }));
    for (let i = 0; i < 40 && (await u.lage()).phase !== 'game'; i++) await sleep(50);
    ws.close();
    assert.equal((await u.lage()).phase, 'game');
    await sleep(300); // servern sparar strax efter ändringen

    const before = count(await u.calls(), ' up -d');
    const waiting = await u.sh(UPDATE, { VILA_SEK: '0' });
    assert.equal(waiting.code, 0);
    assert.equal(count(await u.calls(), ' up -d'), before, 'ingen omstart mitt i spelet');
    assert.match(await u.syslog(), /ett spel pågår, väntar till nästa timme/);
    assert.equal(await read(`${u.STUB}/container-avbild`), OLD);

    // Ett spel som legat orört längre än gränsen hindrar inte uppdateringen. Avbilden hämtades förra
    // gången, och uppdateringen görs ändå, eftersom containern fortfarande kör den gamla.
    const done = await u.sh(UPDATE, { VILA_SEK: '0', SPEL_SEK: '0' });
    assert.equal(done.code, 0, await u.syslog());
    assert.equal(count(await u.calls(), ' up -d'), before + 1);
    assert.equal(await read(`${u.STUB}/container-avbild`), NEW);
    assert.match(await u.syslog(), /uppdaterad till b{12}$/m);
    assert.match(await u.calls(), new RegExp(`docker image rm ${OLD}`));
    const copy = JSON.parse(await read(`${u.POOL_APPDATA}/boardgames/data/room.json.fore-uppdatering`));
    assert.equal(copy.phase, 'game');
    assert.equal((await u.lage()).phase, 'game', 'spelet finns kvar efter omstarten');
  });

  await t.test('uppdateringen gör ingenting under en utskrift', async () => {
    const printer = http.createServer((req, res) => res.end('{"result": {"status": {"print_stats": {"state": "printing"}}}}'));
    await new Promise((resolve) => printer.listen(0, '127.0.0.1', resolve));
    await writeFile(`${u.STUB}/ny-avbild`, OLD);
    const pulls = count(await u.calls(), 'docker pull');
    const r = await u.sh(UPDATE, { VILA_SEK: '0', SPEL_SEK: '0', MOONRAKER: `http://127.0.0.1:${printer.address().port}` });
    printer.close();
    assert.equal(r.code, 0);
    assert.equal(count(await u.calls(), 'docker pull'), pulls, 'avbilden hämtas inte ens');
    assert.match(await u.syslog(), /utskrift pågår, väntar till nästa timme/);
  });

  await t.test('uppdateringen startar inte en stoppad container', async () => {
    await u.stop();
    for (let i = 0; i < 40; i++) {
      try { await u.lage(); await sleep(50); } catch { break; }
    }
    const before = count(await u.calls(), ' up -d');
    const r = await u.sh(UPDATE, { VILA_SEK: '0', SPEL_SEK: '0' });
    assert.equal(r.code, 0);
    assert.equal(count(await u.calls(), ' up -d'), before);
    assert.match(await u.syslog(), /är hämtad, men containern är stoppad och startas inte/);
  });

  await t.test('en avbild som inte går att hämta loggas som ett fel', async () => {
    await writeFile(`${u.STUB}/pull-misslyckas`, '');
    const r = await u.sh(UPDATE);
    assert.equal(r.code, 1);
    assert.match(await u.syslog(), /kunde inte hämta ghcr\.io\/jadrijevic\/self-hosted-boardgames:latest/);
    const install = await u.sh(INSTALL, { DRYRUN: 'false' });
    assert.equal(install.code, 1);
    assert.match(install.out, /Är paketet publikt i GHCR\?/);
  });
});

test('kontrollen godkänner en fungerande server och underkänner en som inte svarar', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'kontroll-'));
  const app = await startServer({ port: 0, dataDir, adminPin: '1234' });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const kontroll = async (env) => {
    try {
      const { stdout } = await run('node', ['deploy/kontroll.js'], { cwd: REPO, env: { ...process.env, ADMIN_PIN: '', ...env } });
      return { code: 0, out: stdout };
    } catch (e) {
      return { code: e.code, out: e.stdout };
    }
  };
  const good = await kontroll({ PORT: String(app.port), DATA_DIR: dataDir, ADMIN_PIN: '1234' });
  assert.equal(good.code, 0, good.out);
  assert.equal(count(good.out, '  OK      '), 10);
  assert.doesNotMatch(good.out, /FEL|VARNING/);

  // Rätt server men fel katalog: läget hamnar inte där kontrollen letar.
  const wrongDir = await kontroll({ PORT: String(app.port), DATA_DIR: path.join(dataDir, 'finns-inte') });
  assert.equal(wrongDir.code, 1);
  assert.match(wrongDir.out, /FEL     läget sparas inte i/);
  assert.match(wrongDir.out, /VARNING ADMIN_PIN saknas/);

  const dead = await kontroll({ PORT: String(await freePort()), DATA_DIR: dataDir });
  assert.equal(dead.code, 1);
  assert.match(dead.out, /FEL     servern svarar: \/halsa svarar inte/);
  assert.match(dead.out, /FEL     WebSocket: ECONNREFUSED/);
});
