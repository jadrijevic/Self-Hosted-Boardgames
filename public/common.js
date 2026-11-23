// Gemensam klient: håller förbindelsen mot servern vid liv och lämnar över varje nytt spelläge.
// Sidorna ritar alltid om sig från hela läget, så en mobil som varit borta är ikapp direkt.

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privat läge: klarar sig utan */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* samma */ } },
};

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);

export function connect(kind, handlers = {}) {
  let ws = null;
  let tries = 0;
  let timer = null;
  let offset = 0; // serverns klocka minus mobilens, i millisekunder
  let token = store.get('token');

  function open() {
    clearTimeout(timer);
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      tries = 0;
      ws.send(JSON.stringify({ t: 'hello', kind, token, pin: store.get('pin') }));
      ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'welcome') {
        if (m.token) { token = m.token; store.set('token', token); }
        handlers.onStatus?.(true);
      } else if (m.t === 'pong') offset = m.s - (m.c + Date.now()) / 2;
      else if (m.t === 'state') handlers.onState?.(m.state);
      else if (m.t === 'denied') handlers.onDenied?.();
      else if (m.t === 'error') handlers.onError?.(m.error);
    };
    ws.onclose = () => {
      handlers.onStatus?.(false);
      timer = setTimeout(open, Math.min(5000, 300 * 2 ** tries++));
    };
  }

  // En mobil som vaknar ska inte vänta ut återförsökstiden.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!ws || ws.readyState > 1)) open();
  });
  open();

  return {
    send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); },
    now: () => Date.now() + offset,
    reconnect() { tries = 0; try { ws?.close(); } catch { /* redan stängd */ } },
  };
}

// Nedräkningar: element med data-ends räknar ner mot serverns sluttid.
export function runClocks(now) {
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-ends]')) {
      el.textContent = Math.max(0, Math.ceil((Number(el.dataset.ends) - now()) / 1000));
    }
  }, 200);
}

// Håller skärmen tänd på lagmobilen. Låset släpps när man byter app, så det begärs igen.
let awake = false;
export function keepAwake() {
  if (awake || !('wakeLock' in navigator)) return;
  awake = true;
  const ask = () => navigator.wakeLock.request('screen').catch(() => {});
  ask();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ask(); });
}
