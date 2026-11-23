/**
 * onframer-power.js — auto-pause for widgets and live wallpapers. Load it AFTER onframer.js.
 *
 *   const off = OnFramer.onPause(({ paused, reasons }) => paused ? stopLoop() : startLoop(), opts);
 *
 * Your callback runs once with the current state, then on every change. While paused,
 * <html data-of-paused="fullscreen battery"> is set (removed when running), so CSS can stop
 * animations too:  html[data-of-paused] * { animation-play-state: paused !important; }
 *
 * Reasons:
 *   hidden      document.hidden (no plugin needed). NOTE: OnFramer does not hide a minimized widget
 *               today, so don't rely on this one; "minimized" below comes from the plugin.
 *   minimized   this widget window is minimized
 *   fullscreen  another app is fullscreen on this page's monitor (game, video, presentation)
 *   battery     the PC runs on battery
 *   remote      Remote Desktop session
 *   locked      the session is locked
 *   covered     this widget window is fully covered by other windows or on another virtual desktop;
 *               for a wallpaper: windows (e.g. a maximized browser) cover the whole work area of its monitor
 * All but "hidden" come from the desktopBridge plugin (ws://127.0.0.1:9093, topic "pause"); the user
 * turns each one on or off in the OnFramer Hub (Settings → Auto-pause). Without the plugin, or in a
 * normal browser, only "hidden" applies.
 *
 * opts (all optional):
 *   ignore: ["fullscreen"]    reasons this callback doesn't care about (e.g. a HUD drawn over games)
 *   wallpaper: true           the page is a live wallpaper (automatic when the URL has #ofmon=x,y,
 *                             which the desktopBridge adds when it starts a wallpaper)
 *   monitor: {x, y}           the monitor's top-left in physical px, if you know it better
 *   covered: false            don't look up this window to check if it is covered
 * Inside an iframe nothing connects (the parent page decides); only "hidden" applies.
 */
(function (global) {
  "use strict";
  const URL_ = "ws://127.0.0.1:9093";
  const doc = global.document;
  const listeners = [];
  const ctx = { wallpaper: false, monitor: null, covered: true };
  let bridge = null;         // last "pause" data from the plugin (null while not connected)
  let hwnd = 0, ws = null, started = false, retry = null, fails = 0, parked = false, findingSelf = false;

  // #ofmon=x,y → this is a wallpaper on the monitor whose top-left is x,y.
  try {
    const m = /[#&]ofmon=(-?\d+),(-?\d+)/.exec(global.location.hash || "");
    if (m) { ctx.wallpaper = true; ctx.monitor = { x: +m[1], y: +m[2] }; }
  } catch (e) {}

  // ---- pure helpers (exported for tests) ----
  // Monitor for this page: the one at `mon` (top-left), else the one containing `pt`, else the closest.
  function pickMonitor(monitors, mon, pt) {
    if (!Array.isArray(monitors) || !monitors.length) return null;
    if (mon) { const m = monitors.find((x) => x.x === mon.x && x.y === mon.y); if (m) return m; }
    if (monitors.length === 1) return monitors[0];
    if (!pt) return null;
    const inside = monitors.find((m) => pt.x >= m.x && pt.x < m.x + m.w && pt.y >= m.y && pt.y < m.y + m.h);
    if (inside) return inside;
    let best = null, bd = Infinity;
    for (const m of monitors) { const d = Math.hypot(m.x + m.w / 2 - pt.x, m.y + m.h / 2 - pt.y); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  // All the reasons that apply to this page right now.
  function reasonsFor(state, c) {
    const r = [];
    const add = (x) => { if (!r.includes(x)) r.push(x); };
    if (state) {
      (state.reasons || []).forEach(add);
      const m = pickMonitor(state.monitors, c.monitor, c.point);
      if (m) { (m.reasons || []).forEach(add); if (c.wallpaper && m.covered) add("covered"); }
      if (c.hwnd && !c.wallpaper) {
        const w = (state.windows || []).find((x) => x.hwnd === c.hwnd);
        if (w && w.minimized) add("minimized"); else if (w && w.covered) add("covered");
      }
    }
    if (c.hidden) add("hidden");
    return r;
  }

  // Centre of this window in physical px (good enough to pick a monitor; exact for one DPI).
  function centre() {
    try {
      const d = global.devicePixelRatio || 1;
      return { x: Math.round((global.screenX + global.outerWidth / 2) * d), y: Math.round((global.screenY + global.outerHeight / 2) * d) };
    } catch (e) { return null; }
  }

  let lastKey = null;
  function update(force) {
    const all = reasonsFor(bridge, { monitor: ctx.monitor, point: centre(), wallpaper: ctx.wallpaper, hwnd, hidden: !!(doc && doc.hidden) });
    try {
      const el = doc && doc.documentElement;
      if (el && el.dataset) { if (all.length) el.dataset.ofPaused = all.join(" "); else delete el.dataset.ofPaused; }
    } catch (e) {}
    const key = all.join(",");
    if (key === lastKey && !force) return;
    lastKey = key;
    for (const l of listeners.slice()) notify(l, all);
  }
  function notify(l, all) {
    const reasons = all.filter((x) => !l.ignore.includes(x));
    const k = reasons.join(",");
    if (k === l.last) return;
    l.last = k;
    try { l.cb({ paused: reasons.length > 0, reasons }); } catch (e) { setTimeout(() => { throw e; }); }
  }

  // ---- connection to the desktopBridge ----
  const inOnFramer = () => typeof global.cefQuery === "function";
  const framed = () => { try { return global.top !== global; } catch (e) { return true; } };
  function later() {
    clearTimeout(retry); retry = null;
    if (parked) return;
    const hidden = doc && doc.hidden;
    retry = setTimeout(open, hidden ? 30000 : Math.min(30000, 4000 * Math.pow(2, Math.max(0, fails - 1))));
  }
  let seq = 0;
  const waiting = new Map();
  function call(cmd, args, ms) {
    return new Promise((ok, ko) => {
      if (!ws || ws.readyState !== 1) return ko(new Error("desktopBridge not connected"));
      const id = ++seq, t = setTimeout(() => { waiting.delete(id); ko(new Error("timeout")); }, ms || 8000);
      waiting.set(id, { ok, ko, t });
      ws.send(JSON.stringify({ id, cmd, args: args || {} }));
    });
  }
  function open() {
    clearTimeout(retry); retry = null;
    if (parked || (ws && ws.readyState <= 1)) return;
    let s;
    try { s = ws = new global.WebSocket(URL_); } catch (e) { fails++; later(); return; }
    let up = false;
    s.onopen = () => {
      up = true; fails = 0;
      s.send(JSON.stringify({ id: ++seq, cmd: "subscribe", args: { topics: ["pause"] } }));
      watchSelf();
    };
    s.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.event === "pause") { bridge = m.data; update(); return; }
      const w = waiting.get(m.id); if (!w) return;
      waiting.delete(m.id); clearTimeout(w.t); m.ok ? w.ok(m.result) : w.ko(new Error(m.error));
    };
    s.onclose = () => {
      if (s !== ws) return;
      if (!up) fails++;
      waiting.forEach((w) => { clearTimeout(w.t); w.ko(new Error("desktopBridge disconnected")); }); waiting.clear();
      if (bridge) { bridge = null; update(); }
      later();
    };
    s.onerror = () => {};
  }

  // Find this window's handle (a short unique suffix on the title, then windowFind), so the plugin can
  // tell when it is fully covered. Not for wallpapers (they sit under the desktop icons).
  async function watchSelf() {
    if (!ctx.covered || ctx.wallpaper || findingSelf || !doc) return;
    findingSelf = true;
    try {
      if (!hwnd) {
        const token = "of" + Math.random().toString(36).slice(2, 10), before = doc.title;
        doc.title = (before ? before + " " : "") + token;
        try {
          for (let i = 0; i < 3 && !hwnd; i++) {
            const r = await call("windowFind", { contains: token }, 4000).catch(() => null);
            const w = r && (r.windows || []).find((x) => String(x.title || "").includes(token));
            if (w) hwnd = w.hwnd; else await new Promise((res) => setTimeout(res, 300));
          }
        } finally { if (doc.title.endsWith(token)) doc.title = before; }
      }
      if (hwnd) await call("pauseWatch", { hwnd }).catch(() => { hwnd = 0; });
    } finally { findingSelf = false; }
  }

  function start() {
    if (started) return;
    started = true;
    if (doc) doc.addEventListener("visibilitychange", () => {
      update();
      if (!doc.hidden && !parked && !(ws && ws.readyState <= 1) && inOnFramer() && !framed()) { fails = 0; open(); }
    });
    if (global.addEventListener) {
      global.addEventListener("pagehide", () => { parked = true; clearTimeout(retry); retry = null; try { ws && ws.close(); } catch (e) {} });
      global.addEventListener("pageshow", (e) => { if (parked && e.persisted) { parked = false; fails = 0; open(); } });
    }
    if (inOnFramer() && !framed()) open();
  }

  /** Calls cb({paused, reasons}) now and whenever the state changes. Returns a function that stops it. */
  function onPause(cb, opts) {
    if (typeof cb !== "function") throw new TypeError("onPause needs a callback");
    const o = opts || {};
    if (o.wallpaper) ctx.wallpaper = true;
    if (o.monitor && Number.isFinite(o.monitor.x) && Number.isFinite(o.monitor.y)) ctx.monitor = { x: o.monitor.x, y: o.monitor.y };
    if (o.covered === false) ctx.covered = false;
    const l = { cb, ignore: Array.isArray(o.ignore) ? o.ignore.map(String) : [], last: null };
    listeners.push(l);
    start();
    // Asynchronously, so the caller's code after onPause() has run before its callback does.
    setTimeout(() => { update(); if (listeners.includes(l)) notify(l, state().reasons); }, 0);
    return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  }

  function state() {
    const r = reasonsFor(bridge, { monitor: ctx.monitor, point: centre(), wallpaper: ctx.wallpaper, hwnd, hidden: !!(doc && doc.hidden) });
    return { paused: r.length > 0, reasons: r };
  }

  const api = { onPause, state, _pickMonitor: pickMonitor, _reasonsFor: reasonsFor };
  global.OnFramerPower = api;
  // onframer.js defines window.OnFramer; add to it (or start it, if this file is loaded alone).
  const of = global.OnFramer || (global.OnFramer = {});
  of.onPause = onPause;
})(typeof window !== "undefined" ? window : globalThis);
