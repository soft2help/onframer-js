/**
 * onframer-providers.js — live data for status bars and widgets, one call per kind of data.
 * Load it AFTER onframer.js (it also works alone, or in a normal browser with the plugins running).
 *
 *   const off = OnFramer.providers.subscribe("cpu", (d) => el.textContent = d.percent + " %", { interval: 2000 });
 *   off();   // stop
 *
 * Providers (what the callback gets):
 *   cpu      {percent, cores, model, loadAvg}                    systemBridge (ws://localhost:9092)
 *   memory   {total, free, used, percent}  bytes                  systemBridge
 *   network  {rxPerSec, txPerSec, interfaces:[{name, address}]}   systemBridge ("network" topic)
 *   disk     {drives:[{name, label, size, free, used, percent}]}  desktopBridge "drives", every interval (default 60 s)
 *   battery  {supported, level 0-1, charging, chargingTime, dischargingTime}   the browser's Battery API, no plugin
 *   media    {hasSession, app, title, artist, album, playing, positionS, durationS}   desktopBridge "nowPlaying" topic
 *   audio    {peak, left, right} 0-1, ~30/s while sound plays     desktopBridge "audio" topic
 *   windows  {foreground:{hwnd, pid, process, title}, windows?}   desktopBridge, every interval (default 1 s);
 *                                                                 {list:true} adds every app window
 *   desktop  {current, index, name, project, wallpaper}           desktopBridge "vdesk" topic (virtual desktops)
 *   tiling   {wm:"glazewm"|"komorebi"|null, workspace, monitors:[{name, focused, workspaces:[{name, focused, displayed, windows}]}]}
 *                                                                 desktopBridge "tiling" topic
 *   weather  {tempC, code, isDay, windKph, place}                 open-meteo.com; opts {lat, lon} or {city}; default every 15 min
 *
 * opts: interval (ms; for pushed data it is the minimum time between two callbacks), onError(err)
 * (the source is down; it keeps retrying and the callback resumes by itself), plus the provider's own.
 * Nothing runs for a provider nobody subscribed to. While the page is hidden, or paused by
 * onframer-power.js (load it to get that), every source stops and resumes afterwards.
 *
 *   const rect = await OnFramer.appbar({ edge: "top", size: 32 });   // reserve a screen edge (CSS px)
 *   await OnFramer.appbar(null);                                     // give it back
 * The window becomes a bar like the taskbar: maximized windows stop at it. Released by itself when
 * the page closes or the plugin stops. Needs OnFramer + desktopBridge.
 */
(function (global) {
  "use strict";
  const DESKTOP_URL = "ws://127.0.0.1:9093", SYSTEM_URL = "ws://127.0.0.1:9092";
  const doc = global.document;
  const later = (fn) => setTimeout(fn, 0);
  const err = (m) => new Error(m);

  // ---- a socket that is open only while something needs it, and reconnects by itself ----
  function makeSource(url, hooks) {
    const s = { ws: null, up: false, need: 0, timer: null, fails: 0, seq: 0, waiting: new Map(), ready: [] };
    function open() {
      clearTimeout(s.timer); s.timer = null;
      if (!s.need || s.ws) return;
      let ws;
      try { ws = new global.WebSocket(url); } catch (e) { return retry(); }
      s.ws = ws;
      ws.onopen = () => {
        s.up = true; s.fails = 0;
        hooks.open && hooks.open();
        s.ready.splice(0).forEach((r) => r.ok());
      };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m && m.id !== undefined && s.waiting.has(m.id)) {
          const w = s.waiting.get(m.id); s.waiting.delete(m.id); clearTimeout(w.t);
          return m.ok ? w.ok(m.result) : w.ko(err(m.error || "failed"));
        }
        hooks.message && hooks.message(m);
      };
      ws.onclose = () => {
        if (s.ws !== ws) return;
        const was = s.up;
        s.ws = null; s.up = false;
        s.waiting.forEach((w) => { clearTimeout(w.t); w.ko(err("plugin disconnected")); }); s.waiting.clear();
        hooks.down && hooks.down(was);
        retry();
      };
      ws.onerror = () => {};
    }
    function retry() {
      s.fails++;
      s.ready.splice(0).forEach((r) => r.ko(err("plugin not running (" + url + ")")));
      if (s.need) s.timer = setTimeout(open, Math.min(30000, 2000 * Math.pow(2, Math.min(4, s.fails - 1))));
    }
    function close() {
      clearTimeout(s.timer); s.timer = null;
      const ws = s.ws; s.ws = null; s.up = false;
      if (ws) { try { ws.close(); } catch (e) {} }
    }
    return {
      hold() { s.need++; open(); },
      release() { s.need = Math.max(0, s.need - 1); if (!s.need) close(); },
      get up() { return s.up; },
      send(o) { if (s.up) { try { s.ws.send(JSON.stringify(o)); } catch (e) {} } },
      // Request/reply; waits for the socket (held by the caller) up to `ms`.
      call(cmd, args, ms) {
        const go = () => new Promise((ok, ko) => {
          const id = ++s.seq, t = setTimeout(() => { s.waiting.delete(id); ko(err("timeout")); }, ms || 8000);
          s.waiting.set(id, { ok, ko, t });
          s.ws.send(JSON.stringify({ id, cmd, args: args || {} }));
        });
        if (s.up) return go();
        return new Promise((ok, ko) => { s.ready.push({ ok, ko }); open(); }).then(go);
      },
      _s: s,
    };
  }

  // ---- state ----
  const subs = new Set();           // {name, cb, opts, last, lastAt, timer, down}
  const cache = {};                 // provider → last value
  let paused = false;
  const topicCount = {};            // desktopBridge topic → active subscribers

  const desktop = makeSource(DESKTOP_URL, {
    open() {
      const topics = Object.keys(topicCount).filter((t) => topicCount[t] > 0);
      if (topics.length) desktop.send({ id: 0, cmd: "subscribe", args: { topics } });
      for (const s of subs) if (DEF[s.name].poll && s.active) poll(s);
      if (bar.want && bar.lost) { bar.lost = false; applyBar().catch(() => {}); }   // plugin restarted: reserve again
    },
    message(m) {
      if (!m || !m.event) return;
      const name = EVENT_TO[m.event];
      if (name) deliver(name, DEF[name].map ? DEF[name].map(m.data) : m.data);
    },
    down() { fail(["desktop"], "desktopBridge plugin not running"); if (bar.rect) bar.lost = true; bar.rect = null; },
  });
  const system = makeSource(SYSTEM_URL, {
    open() { if (anyActive("network")) system.send({ cmd: "subscribe", args: { topics: ["network"] } }); },
    message(m) {
      if (!m || m.type !== "system") return;
      deliver("cpu", { percent: m.cpuPercent, cores: m.cores, model: m.cpuModel, loadAvg: m.loadAvg });
      if (m.memTotal) deliver("memory", { total: m.memTotal, free: m.memFree, used: m.memTotal - m.memFree, percent: m.memUsedPercent });
      if (m.network) deliver("network", { rxPerSec: m.network.rxPerSec, txPerSec: m.network.txPerSec, interfaces: m.networks || [] });
    },
    down() { fail(["system"], "systemBridge plugin not running"); },
  });

  // ---- provider definitions ----
  const pct = (used, size) => (size > 0 ? Math.round((used / size) * 100) : 0);
  const DEF = {
    cpu: { source: "system", interval: 1000 },
    memory: { source: "system", interval: 1000 },
    network: { source: "system", interval: 1000 },
    disk: { source: "desktop", interval: 60000, minInterval: 5000, poll: async () => {
      const r = await desktop.call("drives", {}, 15000);
      return { drives: (r.drives || []).map((d) => ({ name: d.name, label: d.label || "", size: d.size, free: d.free, used: d.size - d.free, percent: pct(d.size - d.free, d.size) })) };
    } },
    windows: { source: "desktop", interval: 1000, minInterval: 250, poll: async (o) => {
      const foreground = await desktop.call("foreground", {}, 5000);
      const out = { foreground };
      if (o.list) out.windows = (await desktop.call("windows", {}, 8000)).windows || [];
      return out;
    } },
    media: { source: "desktop", topic: "nowPlaying", interval: 0 },
    audio: { source: "desktop", topic: "audio", interval: 0 },
    desktop: { source: "desktop", topic: "vdesk", interval: 0 },
    tiling: { source: "desktop", topic: "tiling", interval: 0 },
    battery: { source: "battery", interval: 0 },
    weather: { source: "web", interval: 15 * 60000, minInterval: 5 * 60000, poll: (o) => weather(o) },
  };
  const EVENT_TO = { nowPlaying: "media", audio: "audio", vdesk: "desktop", tiling: "tiling" };

  const anyActive = (name) => [...subs].some((s) => s.name === name && s.active);

  function deliver(name, value, only) {
    if (value === undefined || value === null) return;
    cache[name] = value;
    const now = Date.now();
    for (const s of subs) {
      if (s.name !== name || !s.active || (only && s !== only)) continue;
      if (s.interval && s.lastAt && now - s.lastAt < s.interval - 50) continue;
      s.lastAt = now; s.down = false;
      try { s.cb(value); } catch (e) { later(() => { throw e; }); }
    }
  }
  function fail(sources, message) {
    for (const s of subs) {
      if (!s.active || !sources.includes(DEF[s.name].source) || s.down) continue;
      s.down = true;
      if (s.opts.onError) { try { s.opts.onError(err(message)); } catch (e) {} }
    }
  }

  // ---- polled providers ----
  async function poll(s) {
    clearTimeout(s.timer); s.timer = null;
    if (!s.active) return;
    try {
      const v = await DEF[s.name].poll(s.opts);
      if (!s.active) return;
      s.lastAt = 0;                       // polled: every result is delivered
      deliver(s.name, v, s);
    } catch (e) {
      if (!s.active) return;
      if (!s.down) { s.down = true; if (s.opts.onError) { try { s.opts.onError(e); } catch (x) {} } }
    }
    if (s.active) s.timer = setTimeout(() => poll(s), s.interval);
  }

  // ---- battery: the browser API (Chromium on Windows reads the real battery) ----
  let batt = null, battUsers = 0;
  function battValue(b) {
    return { supported: true, level: b.level, charging: b.charging, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime };
  }
  function battStart() {
    if (battUsers++) { if (cache.battery) later(() => deliver("battery", cache.battery)); return; }
    const nav = global.navigator;
    if (!nav || typeof nav.getBattery !== "function") { later(() => deliver("battery", { supported: false })); return; }
    nav.getBattery().then((b) => {
      if (!battUsers) return;
      batt = b;
      const on = () => deliver("battery", battValue(b));
      b.onchargingchange = b.onlevelchange = b.onchargingtimechange = b.ondischargingtimechange = on;
      on();
    }).catch(() => deliver("battery", { supported: false }));
  }
  function battStop() {
    if (--battUsers > 0) return;
    battUsers = 0;
    if (batt) { batt.onchargingchange = batt.onlevelchange = batt.onchargingtimechange = batt.ondischargingtimechange = null; batt = null; }
  }

  // ---- weather (open-meteo.com: free, no key) ----
  const places = {};
  async function weather(o) {
    let lat = Number(o.lat), lon = Number(o.lon), place = o.place || "";
    if (!(Number.isFinite(lat) && Number.isFinite(lon))) {
      if (!o.city) throw err("weather needs {lat, lon} or {city}");
      if (!places[o.city]) {
        const g = await (await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&name=" + encodeURIComponent(o.city))).json();
        const r = g && g.results && g.results[0];
        if (!r) throw err("city not found: " + o.city);
        places[o.city] = { lat: r.latitude, lon: r.longitude, place: r.name + (r.country_code ? ", " + r.country_code : "") };
      }
      ({ lat, lon, place } = places[o.city]);
    }
    const j = await (await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + "&current=temperature_2m,weather_code,is_day,wind_speed_10m&timezone=auto")).json();
    const c = (j && j.current) || {};
    return { tempC: c.temperature_2m, code: c.weather_code, isDay: c.is_day === 1, windKph: c.wind_speed_10m, place };
  }

  // ---- start/stop one subscription's source ----
  function activate(s) {
    if (s.active) return;
    s.active = true; s.down = false; s.lastAt = 0;
    const d = DEF[s.name];
    if (d.source === "battery") return battStart();
    if (d.source === "system") {
      system.hold();
      if (s.name === "network") system.send({ cmd: "subscribe", args: { topics: ["network"] } });
    }
    if (d.source === "desktop") {
      desktop.hold();
      if (d.topic && (topicCount[d.topic] = (topicCount[d.topic] || 0) + 1) === 1) desktop.send({ id: 0, cmd: "subscribe", args: { topics: [d.topic] } });
    }
    if (d.poll) { if (d.source !== "desktop" || desktop.up) poll(s); }      // desktop polls start on open
    else if (cache[s.name] !== undefined && s.name !== "audio") later(() => deliver(s.name, cache[s.name], s));
  }
  function deactivate(s) {
    if (!s.active) return;
    s.active = false; clearTimeout(s.timer); s.timer = null;
    const d = DEF[s.name];
    if (d.source === "battery") return battStop();
    if (d.source === "system") {
      if (s.name === "network" && !anyActive("network")) system.send({ cmd: "unsubscribe", args: { topics: ["network"] } });
      system.release();
    }
    if (d.source === "desktop") {
      if (d.topic && --topicCount[d.topic] === 0) desktop.send({ id: 0, cmd: "unsubscribe", args: { topics: [d.topic] } });
      desktop.release();
    }
  }

  function subscribe(name, cb, opts) {
    const d = DEF[name];
    if (!d) throw new TypeError("unknown provider \"" + name + "\" (" + Object.keys(DEF).join(", ") + ")");
    if (typeof cb !== "function") throw new TypeError("subscribe needs a callback");
    const o = opts || {};
    let interval = Number(o.interval) > 0 ? Number(o.interval) : d.interval;
    if (d.minInterval) interval = Math.max(d.minInterval, interval);
    const s = { name, cb, opts: o, interval, active: false, lastAt: 0, timer: null, down: false };
    subs.add(s);
    watchPause();
    if (!paused) activate(s);
    return function unsubscribe() { if (subs.delete(s)) deactivate(s); };
  }

  // ---- pause while hidden (and with onframer-power.js, while auto-paused) ----
  let pauseWatched = false, powerPaused = false;
  function setPaused() {
    const p = !!((doc && doc.hidden) || powerPaused);
    if (p === paused) return;
    paused = p;
    for (const s of subs) p ? deactivate(s) : activate(s);
  }
  function watchPause() {
    if (pauseWatched) return;
    pauseWatched = true;
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", setPaused);
    const of = global.OnFramer;
    if (of && typeof of.onPause === "function") {
      try { of.onPause((st) => { powerPaused = !!st.paused; setPaused(); }); } catch (e) {}
    }
    setPaused();
  }

  // ---- AppBar: reserve a screen edge for this window ----
  const bar = { want: null, hwnd: 0, rect: null, held: false, lost: false };
  async function findSelf() {
    if (bar.hwnd) return bar.hwnd;
    const token = "of" + Math.random().toString(36).slice(2, 10), before = doc.title;
    doc.title = (before ? before + " " : "") + token;
    try {
      for (let i = 0; i < 4 && !bar.hwnd; i++) {
        const r = await desktop.call("windowFind", { contains: token }, 4000).catch(() => null);
        const w = r && (r.windows || []).find((x) => String(x.title || "").includes(token));
        if (w) bar.hwnd = w.hwnd; else await new Promise((res) => setTimeout(res, 300));
      }
    } finally { if (doc.title.endsWith(token)) doc.title = before; }
    if (!bar.hwnd) throw err("could not find this window (is it running in OnFramer?)");
    return bar.hwnd;
  }
  async function applyBar() {
    const w = bar.want; if (!w) return null;
    const hwnd = await findSelf();
    const size = Math.round(w.size * (w.physical ? 1 : (global.devicePixelRatio || 1)));
    bar.rect = await desktop.call("appBarSet", { hwnd, edge: w.edge, size }, 8000);
    return bar.rect;
  }
  async function appbar(o) {
    if (!o || o.edge === "none") {
      bar.want = null;
      if (bar.hwnd && desktop.up && bar.rect) await desktop.call("appBarRemove", { hwnd: bar.hwnd }, 5000).catch(() => {});
      bar.rect = null;
      if (bar.held) { bar.held = false; desktop.release(); }
      return null;
    }
    if (!["top", "bottom", "left", "right"].includes(o.edge)) throw new TypeError("edge must be top, bottom, left, right or none");
    const size = Number(o.size);
    if (!(size >= 1 && size <= 1200)) throw new TypeError("size must be 1-1200");
    bar.want = { edge: o.edge, size, physical: !!o.physical };
    if (!bar.held) { bar.held = true; desktop.hold(); }       // the socket stays open while the bar exists
    return applyBar();
  }

  const api = { subscribe, list: () => Object.keys(DEF), _test: { subs, cache, DEF, desktop, system, bar, setPaused } };
  global.OnFramerProviders = api;
  const of = global.OnFramer || (global.OnFramer = {});
  of.providers = api;
  of.appbar = appbar;
})(typeof window !== "undefined" ? window : globalThis);
