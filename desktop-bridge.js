// Tiny client for the OnFramer desktopBridge plugin (ws://127.0.0.1:9093).
//
//   const db = DesktopBridge.connect();
//   db.onStatus((up) => ...);                  // true when the plugin is reachable
//   await db.call('notify', { title, body });  // rejects if the plugin is not running
//   db.on('nowPlaying', (np) => ...);          // push events (subscribed automatically)
//   db.on('key', (k) => ...);                  // global key hook (event "key", topic "keys")
//   await db.hotkeys(['ctrl+alt+t']);          // global hotkeys, then:
//   db.on('hotkey', ({ combo }) => ...);       // fires only for this page's combos
//   await db.saveFile({ name, content });       // Windows "Save as" dialog, writes the file
//   db.up                                      // true while connected
//
// Reconnects on its own (4 s, then backing off to 30 s; every 30 s while hidden; at once when the
// page is shown or focused),
// so a widget can start before the plugin and pick it up later.
(function (global) {
  // Pages the Manager launches get #k=<secret>; it unlocks project commands. Keep it out of the visible URL.
  let secret = '';
  try {
    const m = /(?:^#|&)k=([0-9a-f]+)/i.exec(global.location.hash);
    if (m) {
      secret = m[1];
      global.history.replaceState(null, '', global.location.pathname + global.location.search);
    }
  } catch (e) {}
  // Some events arrive under another name than the topic that turns them on. on() takes either.
  const TOPIC = { key: 'keys', click: 'mouse' };
  const EVENTS = { keys: ['key'] };   // on('mouse') stays mouse-only; on('click') turns the mouse topic on
  const NO_TOPIC = { hotkey: true };   // sent after a hotkeys call, no subscription needed

  function connect(url) {
    url = url || 'ws://127.0.0.1:9093';
    let ws = null, n = 0, up = false, parked = false, warned = false;
    const wait = new Map(), handlers = {}, status = [];
    const setUp = (v) => { if (v !== up) { up = v; status.forEach((f) => { try { f(up); } catch (e) {} }); } };

    // Retry delay while the plugin is down: 4 s, 8 s, 16 s, then every 30 s (dozens of widgets
    // retrying every 4 s all day add up). While the page is hidden it keeps retrying at the 30 s
    // cap, so a minimized widget still reconnects after a plugin restart; showing it, or focusing
    // it, retries at once.
    let fails = 0, retry = null;
    const delay = () => Math.min(30000, 4000 * Math.pow(2, Math.max(0, fails - 1)));
    function later() {
      clearTimeout(retry); retry = null;
      if (parked) return;   // pageshow resumes
      const hidden = global.document && global.document.hidden;
      retry = setTimeout(open, hidden ? 30000 : delay());
    }
    function open() {
      clearTimeout(retry); retry = null;
      if (parked || (ws && ws.readyState <= 1)) return;   // already connecting/connected
      let sock;
      try { sock = ws = new WebSocket(url); } catch (e) { fails++; later(); return; }
      sock.onopen = () => {
        fails = 0;
        setUp(true);
        const topics = topicsOf();
        if (topics.length) sock.send(JSON.stringify({ id: ++n, cmd: 'subscribe', args: { topics } }));
      };
      sock.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.event) { (handlers[m.event] || []).forEach((f) => { try { f(m.data); } catch (err) {} }); return; }
        const w = wait.get(m.id); if (!w) return;
        wait.delete(m.id); clearTimeout(w.timer); m.ok ? w.ok(m.result) : w.ko(new Error(m.error));
      };
      sock.onclose = (e) => {
        if (sock !== ws) return;   // an old socket closing late
        // 4003 = the bridge refused this page and says why (e.g. a file:// page: serve it over http).
        if (e && e.code === 4003 && !warned) { warned = true; console.warn('desktopBridge: ' + e.reason); }
        if (!up) fails++;          // never opened: the plugin is not there
        setUp(false);
        wait.forEach((w) => { clearTimeout(w.timer); w.ko(new Error('desktopBridge disconnected')); }); wait.clear();
        later();
      };
      sock.onerror = () => {};
    }
    function topicsOf() {
      const s = new Set();
      Object.keys(handlers).forEach((ev) => { if (!NO_TOPIC[ev]) s.add(TOPIC[ev] || ev); });
      return Array.from(s);
    }
    open();
    const wake = () => { if (!up && !parked && !(global.document && global.document.hidden)) { fails = 0; open(); } };
    if (global.document) global.document.addEventListener('visibilitychange', wake);
    global.addEventListener('focus', wake);
    // Leaving the page (navigation, close) may keep it frozen in Chromium's back/forward cache with
    // the socket still open, so the plugin never learns the page is gone and keeps its PiPs, hooks,
    // dimming… Close it explicitly, and reconnect if the page comes back from the cache.
    global.addEventListener('pagehide', () => { parked = true; clearTimeout(retry); retry = null; try { ws && ws.close(); } catch (e) {} });
    global.addEventListener('pageshow', (e) => { if (parked && e.persisted) { parked = false; fails = 0; open(); } });

    return {
      get up() { return up; },
      onStatus(f) { status.push(f); f(up); },
      // on('keys') and on('key') are the same thing: both get the "key" events.
      on(name, f) {
        (EVENTS[name] || [name]).forEach((ev) => { (handlers[ev] = handlers[ev] || []).push(f); });
        const topics = topicsOf();
        if (up && topics.length) ws.send(JSON.stringify({ id: ++n, cmd: 'subscribe', args: { topics } }));
      },
      // Global hotkeys for this page ("ctrl+alt+t", "ctrl+shift+f9"...). Replaces the page's list;
      // [] removes them. Resolves {registered, failed}; a combo another app holds lands in failed.
      // They are released when the page closes.
      hotkeys(combos) { return this.call('hotkeys', { combos: combos || [] }); },
      // Windows "Save as" dialog, then the plugin writes the file the user picked. opts: {name,
      // content (text) | base64, types: [{description, extensions: ['.json']}]}. Resolves {path, bytes}
      // or {canceled: true}; waits for the user up to 15 minutes. Use it from a click handler.
      saveFile(opts) { return this.call('saveFile', opts || {}, 15 * 60 * 1000); },
      call(cmd, args, timeoutMs) {
        return new Promise((ok, ko) => {
          if (!up) return ko(new Error('desktopBridge plugin not running'));
          const id = ++n;
          const timer = setTimeout(() => { if (wait.has(id)) { wait.delete(id); ko(new Error('timeout')); } }, timeoutMs || 10000);
          wait.set(id, { ok, ko, timer });
          const a = Object.assign({}, args || {});
          if (secret) a.secret = secret;
          ws.send(JSON.stringify({ id, cmd, args: a }));
        });
      },
    };
  }
  global.DesktopBridge = { connect };
})(window);
