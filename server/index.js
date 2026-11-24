// Startpunkt: läser inställningar ur miljövariabler och startar servern.
import { startServer } from './server.js';

const app = await startServer({
  port: Number(process.env.PORT) || 8080,
  dataDir: process.env.DATA_DIR || './data',
  adminPin: process.env.ADMIN_PIN || undefined,
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  wifi: process.env.WIFI_SSID ? { ssid: process.env.WIFI_SSID, password: process.env.WIFI_PASSWORD || '' } : null,
});

console.log(`Lyssnar på port ${app.port}. Start: /start  Storbild: /scen  Värd: /admin  Mobiler: /`);
if (!process.env.ADMIN_PIN) console.log(`Värdens pinkod för /admin: ${app.pin} (sätt ADMIN_PIN för en fast kod)`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
