/*!
 * Project Name: OnFramer
 * Description: This file serves as a bridge between JavaScript and Onframer (CEF), enabling control over window behavior.
 *
 * @version 1.0.16-beta
 * @date 2026-11-26
 * @license MIT
 * @author Luis Fernandes
 *
 * Changelog:
 * - v1.0.0-beta: Initial release.
 * - v1.0.1-beta: setIgnoreMouseEvents (whole-window click-through).
 * - v1.0.2-beta: tray() / minimizeToTray() (OnframerManager tray API).
 * - v1.0.3-beta: clickThroughRegions() / clickThroughAuto() (per-region click-through).
 * - v1.0.4-beta: clickThroughMask() per-PIXEL click-through (border-radius + CSS clip-path).
 * - v1.0.5-beta: clickThroughMask de-dups identical pushes (no re-arm flicker on the
 *                resize/scroll/1s tick when the layout hasn't changed).
 * - v1.0.6-beta: clickThroughRegions de-dups identical pushes too (same anti-flicker).
 * - v1.0.7-beta: clickThroughMask Tier 2 — opts.mode "canvas" rasterises the real alpha of
 *                img/canvas widgets (PNG cut-outs) into the mask; falls back to geometry.
 * - v1.0.8-beta: click-through region/mask refresh skips its 1 s tick while the page is hidden,
 *                and calls made outside OnFramer no longer log "Uncaught (in promise)" when the
 *                caller doesn't catch (awaiting callers still get the rejection).
 *                Also exposed as window.OnFramer (a top-level `let` is not a window property, so
 *                pages checking `window.OnFramer` saw undefined even inside OnFramer).
 * - v1.0.9-beta: OnFramer.storage — inside OnFramer, a widget page (/standalone/<Name>/) keeps a copy
 *                of the localStorage keys it writes in the user folder (desktopBridge storageSave) and
 *                gets them back on a fresh Chromium profile (one reload). get/set/remove/flush/ready.
 * - v1.0.10-beta: monitorInfo() also returns rcMonitor / rcWork objects ({left, top, right, bottom})
 *                next to the flat "rcWork.left" keys, as the docs always showed.
 * - v1.0.16-beta: windowState() gives the window's rect (physical px) and whether it is minimized,
 *   maximized, fullscreen, always on top and visible (build 31+; older builds get an estimate from
 *   screenX/outerWidth). isMaximized() / isAlwaysOnTop() resolve booleans. setIgnoreMouseEvents(true)
 *   pauses a running clickThroughMask/clickThroughRegions (they would undo it on the next mouse
 *   move) and setIgnoreMouseEvents(false) turns them back on.
 * - v1.0.15-beta: tray() shows the page favicon (or opts.icon) as the tray icon instead of the generic
 *   Windows one (needs OnFramer build 29+; older Managers ignore it).
 * - v1.0.14-beta: monitorInfo() marks the primary monitor (primary: true; it is the one at 0,0).
 * - v1.0.13-beta: isMinimized() resolves a boolean (it used to give {isMinimized: true|false},
 *   so `if (await OnFramer.isMinimized())` was always true).
 * - v1.0.12-beta: desktop-bridge.js adds db.saveFile() (Windows Save as dialog through the
 *   desktopBridge plugin). No change in onframer.js itself.
 * - v1.0.11-beta: tray reconnects and sets its icon again after the Manager restarts (it used to
 *                stay dead until a reload); minimizeToTray / restoreFromTray send the page title so
 *                the Manager hides THIS window, not the first OnFramer window it finds; tray errors
 *                say the Manager isn't running instead of rejecting with a bare Event.
 *
 * Usage:
 * Place it in your web project in javascript files section.
 */

let OnFramer = {
  sendMessage: function (name, params) {
    //console.log(`send message: ${name}`);
    var message = "Window." + name;
    if (typeof params !== "undefined") {
      message += ":" + params;
    }

    // Outside OnFramer (a normal browser) every call rejects. Callers that await/catch still get
    // the rejection, but it is marked handled so fire-and-forget calls (e.g. a bare
    // OnFramer.setIgnoreMouseEvents(true)) don't log "Uncaught (in promise)" on every page.
    if (typeof window === "undefined" || typeof window.cefQuery !== "function") {
      var na = Promise.reject(
        "Onframer is not available. Load current page with onframer application. More info in https://onframer.io"
      );
      na.catch(function () {});
      return na;
    }

    return new Promise((resolve, reject) => {
      try {
        window.cefQuery({
          request: message,
          onSuccess: function (response) {
            // Guard the parse: a non-JSON / malformed response must NOT throw
            // here (this runs in the native cefQuery callback, outside the
            // try below — an uncaught throw would leave the Promise pending
            // forever). Fall back to the raw string instead of hanging.
            if (response !== "") {
              try {
                response = JSON.parse(response);
              } catch (e) {
                /* keep raw string */
              }
            }
            resolve(response);
          },
          onFailure: function (error_code, error_message) {
            let fail = {
              error_code: error_code,
              error_message: error_message,
            };
            reject(fail);
          },
        });
      } catch (err) {
        reject(
          "Onframer is not available. Load current page with onframer application. More info in https://onframer.io"
        );
      }
    });
  },
  setPosition: (left, top, width, height) => {
    return OnFramer.sendMessage(
      "Position",
      `${left},${top},${width},${height}`
    );
  },
  // The native side sends flat keys ("rcWork.left"). Each monitor also gets rcMonitor / rcWork
  // objects ({left, top, right, bottom}), so m.rcWork.left works as documented.
  monitorInfo: () => {
    return OnFramer.sendMessage("MonitorInfo").then(function (list) {
      if (!Array.isArray(list)) return list;
      return list.map(function (m) {
        if (!m || typeof m !== "object") return m;
        ["rcMonitor", "rcWork"].forEach(function (r) {
          if (m[r] && typeof m[r] === "object") return;
          m[r] = { left: m[r + ".left"], top: m[r + ".top"], right: m[r + ".right"], bottom: m[r + ".bottom"] };
        });
        // Windows always puts the primary monitor's top-left corner at 0,0.
        if (typeof m.primary !== "boolean") m.primary = m.rcMonitor.left === 0 && m.rcMonitor.top === 0;
        return m;
      });
    });
  },
  maximize: () => {
    return OnFramer.sendMessage("Maximize");
  },
  minimize: () => {
    return OnFramer.sendMessage("Minimize");
  },
  // Resolves true/false. The native side answers {"isMinimized": true}; before 1.0.13 the SDK passed
  // that object on, so `if (await isMinimized())` was always true.
  isMinimized: () => {
    return OnFramer.sendMessage("IsMinimized").then((r) =>
      r && typeof r === "object" ? r.isMinimized === true : r === true || r === "true");
  },
  isMaximized: () => {
    return OnFramer.sendMessage("IsMaximized").then((r) =>
      r && typeof r === "object" ? r.isMaximized === true : r === true || r === "true");
  },
  isAlwaysOnTop: () => {
    return OnFramer.sendMessage("IsAlwaysOnTop").then((r) =>
      r && typeof r === "object" ? r.isAlwaysOnTop === true : r === true || r === "true");
  },
  // {x, y, width, height, minimized, maximized, fullscreen, alwaysOnTop, visible}. The rect is in
  // physical pixels, the same units as setPosition() and monitorInfo(), so
  // setPosition(s.x, s.y, s.width, s.height) puts the window back where it was.
  // OnFramer builds before 31 don't know Window.GetState: the SDK then works it out from
  // screenX/outerWidth × devicePixelRatio and the IsMinimized/IsMaximized/IsAlwaysOnTop calls.
  windowState: () => {
    return OnFramer.sendMessage("GetState").then(function (s) {
      if (s && typeof s === "object" && typeof s.x === "number") return s;
      var dpr = window.devicePixelRatio || 1;
      var no = function () { return false; };
      return Promise.all([
        OnFramer.isMinimized().catch(no),
        OnFramer.isMaximized().catch(no),
        OnFramer.isAlwaysOnTop().catch(no),
      ]).then(function (f) {
        var w = Math.round(window.outerWidth * dpr), h = Math.round(window.outerHeight * dpr);
        return {
          x: Math.round(window.screenX * dpr), y: Math.round(window.screenY * dpr), width: w, height: h,
          minimized: f[0], maximized: f[1], alwaysOnTop: f[2], visible: !document.hidden,
          fullscreen: !f[1] && w >= Math.round(screen.width * dpr) && h >= Math.round(screen.height * dpr),
        };
      });
    });
  },
  restore: () => {
    return OnFramer.sendMessage("Restore");
  },
  fullscreen: () => {
    return OnFramer.sendMessage("Fullscreen");
  },
  exitFullscreen: () => {
    return OnFramer.sendMessage("ExitFullscreen");
  },
  alwaysOnTop: () => {
    return OnFramer.sendMessage("AlwaysOnTop");
  },
  notAlwaysOnTop: () => {
    return OnFramer.sendMessage("NotAlwaysOnTop");
  },
  mute: () => {
    return OnFramer.sendMessage("Mute");
  },
  unmute: () => {
    return OnFramer.sendMessage("UnMute");
  },
  // Click-through: when ignore=true, mouse events pass to the window behind.
  // opts.forward is reserved for mouse-move forwarding (not yet active).
  // Toggle per element (mouseenter -> false on opaque, mouseleave -> true) to
  // make a transparent overlay interactive only over its opaque parts.
  //
  // A running clickThroughMask / clickThroughRegions decides click-through on every mouse move, so
  // it would undo ignore=true at once. ignore=true pauses them; ignore=false turns them back on.
  _ctPaused: null,
  setIgnoreMouseEvents: (ignore, opts) => {
    var forward = opts && opts.forward ? 1 : 0;
    var send = function () {
      return OnFramer.sendMessage("SetIgnoreMouseEvents", `${ignore ? 1 : 0},${forward}`);
    };
    if (ignore) {
      var paused = null;
      if (OnFramer._ctmSelector) paused = { mask: OnFramer._ctmSelector, cell: OnFramer._ctmCell, mode: OnFramer._ctmMode };
      else if (OnFramer._ctrSelector) paused = { regions: OnFramer._ctrSelector };
      if (!paused) return send();
      var stop = paused.mask ? OnFramer.stopClickThroughMask() : OnFramer.stopClickThroughRegions();
      OnFramer._ctPaused = paused;
      return stop.catch(function () {}).then(send);
    }
    var back = OnFramer._ctPaused;
    OnFramer._ctPaused = null;
    return send().then(function (r) {
      if (back && back.mask) OnFramer.clickThroughMask(back.mask, { cell: back.cell, mode: back.mode });
      else if (back && back.regions) OnFramer.clickThroughRegions(back.regions);
      return r;
    });
  },

  // --- Tray API + minimize-to-tray (via OnframerManager bridge, ws://localhost:9099) ---
  // Requires OnframerManager to be running (it owns the system tray).
  _trayWs: null,
  _trayCbs: {},
  _trayClickCb: null,
  // The tray belongs to the OnframerManager (TrayBridge, ws://127.0.0.1:9099). If the Manager
  // restarts, the socket closes: reconnect (5 s, then up to 30 s) and set the icon again, so the
  // page doesn't need a reload. removeTray() stops that.
  _trayLast: null,
  _trayRetry: 0,
  _trayTimer: null,
  _trayConnect: function () {
    if (OnFramer._trayWs && OnFramer._trayWs.readyState <= 1 && OnFramer._trayOpening) return OnFramer._trayOpening;
    OnFramer._trayOpening = new Promise((resolve, reject) => {
      try {
        var ws = new WebSocket("ws://127.0.0.1:9099");
        OnFramer._trayWs = ws;
        ws.onopen = () => {
          OnFramer._trayRetry = 0;
          if (OnFramer._trayLast) ws.send(JSON.stringify(OnFramer._trayLast));   // back after a restart
          resolve();
        };
        ws.onerror = () => reject(new Error("OnFramer Manager not running (tray bridge ws://127.0.0.1:9099)"));
        ws.onclose = () => {
          if (OnFramer._trayWs !== ws) return;
          OnFramer._trayWs = null; OnFramer._trayOpening = null;
          if (!OnFramer._trayLast) return;
          var wait = Math.min(30000, 5000 * Math.pow(2, OnFramer._trayRetry++));
          OnFramer._trayTimer = setTimeout(() => {
            OnFramer._trayTimer = null;
            if (OnFramer._trayLast) OnFramer._trayConnect().catch(() => {});
          }, wait);
        };
        ws.onmessage = (ev) => {
          try {
            var m = JSON.parse(ev.data);
            if (m.event === "tray.click" && OnFramer._trayClickCb) OnFramer._trayClickCb();
            if (m.event === "menu" && OnFramer._trayCbs[m.id]) OnFramer._trayCbs[m.id]();
          } catch (_) {}
        };
      } catch (e) { reject(e); }
    });
    OnFramer._trayOpening.catch(() => { OnFramer._trayOpening = null; });
    return OnFramer._trayOpening;
  },
  // tray({ tooltip, menu:[{id,label,onClick}], onClick }) — set the app's tray icon + menu.
  // The tray icon: opts.icon (any image URL, a data URL) or the page favicon, drawn into a 32x32 PNG.
  // SVG favicons work. Resolves null when there is none or it can't be read (cross-origin).
  _trayIcon: function (src) {
    return new Promise(function (resolve) {
      try {
        if (!src && typeof document !== "undefined" && document.querySelector) {
          var l = document.querySelector('link[rel~="icon"]');
          src = l && l.href;
        }
        if (!src || typeof Image === "undefined") return resolve(null);
        var t = setTimeout(function () { resolve(null); }, 3000);
        var img = new Image();
        if (!/^data:/.test(src)) img.crossOrigin = "anonymous";
        img.onload = function () {
          clearTimeout(t);
          try {
            var c = document.createElement("canvas");
            c.width = c.height = 32;
            c.getContext("2d").drawImage(img, 0, 0, 32, 32);
            resolve(c.toDataURL("image/png"));
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { clearTimeout(t); resolve(null); };
        img.src = src;
      } catch (e) { resolve(null); }
    });
  },
  tray: function (opts) {
    opts = opts || {};
    OnFramer._trayCbs = {};
    var menu = (opts.menu || []).map((it) => {
      if (it.onClick) OnFramer._trayCbs[it.id] = it.onClick;
      return { id: it.id, label: it.label };
    });
    OnFramer._trayClickCb = opts.onClick || null;
    var msg = { cmd: "tray.set", tooltip: opts.tooltip || "", menu: menu };
    return OnFramer._trayIcon(opts.icon).then(function (icon) {
      if (icon) msg.icon = icon;
      var wasOpen = OnFramer._trayWs && OnFramer._trayWs.readyState === 1;
      OnFramer._trayLast = msg;
      return OnFramer._trayConnect().then(() => {
        if (wasOpen) OnFramer._trayWs.send(JSON.stringify(msg));   // a fresh socket already sent it on open
      });
    });
  },
  removeTray: function () {
    OnFramer._trayLast = null;
    if (OnFramer._trayTimer) { clearTimeout(OnFramer._trayTimer); OnFramer._trayTimer = null; }
    if (OnFramer._trayWs && OnFramer._trayWs.readyState === 1)
      OnFramer._trayWs.send(JSON.stringify({ cmd: "tray.remove" }));
  },
  // Minimize-to-tray: hide the window (a tray icon brings it back).
  // The page's title tells the Manager which OnFramer window to hide or show (the window title is
  // the page title); without it the Manager took the first OnFramer window it found.
  minimizeToTray: function () {
    return OnFramer._trayConnect().then(() => OnFramer._trayWs.send(JSON.stringify({ cmd: "hide", title: (window.document && document.title) || "" })));
  },
  restoreFromTray: function () {
    return OnFramer._trayConnect().then(() => OnFramer._trayWs.send(JSON.stringify({ cmd: "show", title: (window.document && document.title) || "" })));
  },

  // --- Per-region click-through (auto) ---
  // Deprecated aliases — clickThroughAuto/stopClickThroughAuto now forward to the native
  // clickThroughRegions (onframer's own hit-test, no OnframerManager mouse hook). Kept so
  // existing pages keep working.
  clickThroughAuto: function (selector) {
    return OnFramer.clickThroughRegions(selector);
  },
  stopClickThroughAuto: function () {
    return OnFramer.stopClickThroughRegions();
  },

  // --- Per-region click-through (native, no OnframerManager) ---
  // Makes the window interactive ONLY over elements matching `selector`; clicks
  // anywhere else pass through to the window behind. onframer's native
  // SetClickThroughRegions toggles WS_EX_TRANSPARENT in-process per cursor position
  // (race-free, cross-process). Re-pushes the regions on resize/scroll/DOM changes.
  // Requires --widget. Pass no selector to use ".ct-interactive".
  _ctrSelector: null,
  _ctrTimer: null,
  _pushClickThroughRegions: function () {
    // Hidden (minimised / tray): nothing to hit-test; visibilitychange pushes as soon as it shows.
    if (!OnFramer._ctrSelector || document.hidden) return;
    // Send rects as NORMALIZED fractions of the viewport (x/w * 10000). onframer maps
    // the cursor into the same 0..10000 space via its client rect, so the hit-test is
    // exact regardless of DPI / CSS-vs-device-px scaling.
    var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
    var segs = [];
    document.querySelectorAll(OnFramer._ctrSelector).forEach(function (el) {
      var b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      segs.push(
        Math.round((b.x / vw) * 10000) + "," + Math.round((b.y / vh) * 10000) + "," +
        Math.round((b.width / vw) * 10000) + "," + Math.round((b.height / vh) * 10000)
      );
    });
    var payload = segs.join("|");
    // Skip the send when unchanged: the native side re-arms (briefly makes the whole window
    // click-through until the next cursor move) on every SetClickThroughRegions, so re-sending
    // identical rects on the resize/scroll/1s tick would flicker.
    if (payload === OnFramer._ctrLast) return;
    OnFramer._ctrLast = payload;
    // Internal push: nobody awaits it, so swallow the rejection (no OnFramer = normal browser).
    OnFramer.sendMessage("SetClickThroughRegions", payload).catch(function () {});
  },
  _ctrLast: null,
  clickThroughRegions: function (selector) {
    OnFramer._ctPaused = null; // started by hand: nothing left to resume
    OnFramer._ctrSelector = selector || ".ct-interactive";
    OnFramer._ctrLast = null; // force the first push to send
    OnFramer._pushClickThroughRegions();
    if (!OnFramer._ctrTimer) {
      window.addEventListener("resize", OnFramer._pushClickThroughRegions);
      window.addEventListener("scroll", OnFramer._pushClickThroughRegions, true);
      document.addEventListener("visibilitychange", OnFramer._pushClickThroughRegions);
      // periodic refresh catches layout/DOM changes that don't fire resize/scroll
      OnFramer._ctrTimer = setInterval(OnFramer._pushClickThroughRegions, 1000);
    }
    return Promise.resolve();
  },
  stopClickThroughRegions: function () {
    OnFramer._ctrSelector = null;
    OnFramer._ctrLast = null;
    if (OnFramer._ctrTimer) {
      clearInterval(OnFramer._ctrTimer);
      OnFramer._ctrTimer = null;
      window.removeEventListener("resize", OnFramer._pushClickThroughRegions);
      window.removeEventListener("scroll", OnFramer._pushClickThroughRegions, true);
      document.removeEventListener("visibilitychange", OnFramer._pushClickThroughRegions);
    }
    return OnFramer.sendMessage("SetClickThroughRegions", ""); // disable
  },

  // --- Per-pixel (alpha) click-through — geometry tier ---
  // Like clickThroughRegions, but instead of each widget's rectangle it sends a downsampled
  // COVERAGE MASK (rect minus border-radius corner arcs) so rounded/circular widgets pass
  // clicks through their transparent corners. onframer hit-tests the cursor against the mask
  // in its native hook (race-free). Needs onframer's Window.SetClickThroughMask support
  // (LCBF build) + launch with --widget. opts.cell = device px per mask cell (default 6).
  _ctmSelector: null,
  _ctmCell: 6,
  _ctmTimer: null,
  _ctmRadius: function (el, w, h) {
    var cs = getComputedStyle(el);
    function r(v) {
      if (!v) return 0;
      if (v.indexOf("%") >= 0) return (parseFloat(v) / 100) * Math.min(w, h);
      return Math.min(parseFloat(v) || 0, Math.min(w, h) / 2);
    }
    return {
      tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius),
      br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius),
    };
  },
  // Tier 2: parse a CSS clip-path into a point-in-shape test (px,py in element-local px),
  // so arbitrary clipped widgets (circles, ellipses, polygons — hexagons, stars, bubbles)
  // pass clicks through outside their real outline. Returns a function (px,py)=>bool, or
  // null when there is no clip-path we understand (then only border-radius geometry applies).
  // Pixel-perfect raster alpha (e.g. PNG cut-outs) is out of scope — that needs DOM→canvas.
  _ctmClip: function (el, w, h) {
    var cs = getComputedStyle(el);
    var cp = cs.clipPath || cs.webkitClipPath || "";
    if (!cp || cp === "none") return null;
    // length resolver: % of a reference, px, or "center"
    function L(tok, ref) {
      if (tok == null) return null;
      tok = ("" + tok).trim();
      if (tok === "center") return ref / 2;
      if (tok.indexOf("%") >= 0) return (parseFloat(tok) / 100) * ref;
      var n = parseFloat(tok);
      return isNaN(n) ? null : n;
    }
    var m;
    if ((m = cp.match(/circle\(([^)]*)\)/))) {
      var p = m[1].split(/\s+at\s+/);
      var rTok = (p[0] || "").trim();
      var cxy = (p[1] || "center center").trim().split(/\s+/);
      var cx = L(cxy[0], w), cy = L(cxy[1] != null ? cxy[1] : cxy[0], h);
      if (cx == null) cx = w / 2;
      if (cy == null) cy = h / 2;
      var rad;
      if (rTok === "" || rTok === "closest-side") rad = Math.min(cx, w - cx, cy, h - cy);
      else if (rTok === "farthest-side") rad = Math.max(cx, w - cx, cy, h - cy);
      else { rad = L(rTok, Math.sqrt((w * w + h * h) / 2)); if (rad == null) rad = Math.min(w, h) / 2; }
      return function (px, py) { var dx = px - cx, dy = py - cy; return dx * dx + dy * dy <= rad * rad; };
    }
    if ((m = cp.match(/ellipse\(([^)]*)\)/))) {
      var pp = m[1].split(/\s+at\s+/);
      var rr = (pp[0] || "").trim().split(/\s+/);
      var ee = (pp[1] || "center center").trim().split(/\s+/);
      var rx = L(rr[0], w), ry = L(rr[1] != null ? rr[1] : rr[0], h);
      var ex = L(ee[0], w), ey = L(ee[1] != null ? ee[1] : ee[0], h);
      if (rx == null) rx = w / 2; if (ry == null) ry = h / 2;
      if (ex == null) ex = w / 2; if (ey == null) ey = h / 2;
      return function (px, py) { var dx = (px - ex) / rx, dy = (py - ey) / ry; return dx * dx + dy * dy <= 1; };
    }
    if ((m = cp.match(/inset\(([^)]*)\)/))) {
      var ins = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/).map(function (v) { return v; });
      // CSS shorthand: 1=all, 2=TB LR, 3=T LR B, 4=T R B L
      var t = L(ins[0], h), r = L(ins[1] != null ? ins[1] : ins[0], w);
      var b = L(ins[2] != null ? ins[2] : ins[0], h), l = L(ins[3] != null ? ins[3] : (ins[1] != null ? ins[1] : ins[0]), w);
      if (t == null) t = 0; if (r == null) r = 0; if (b == null) b = 0; if (l == null) l = 0;
      return function (px, py) { return px >= l && px <= w - r && py >= t && py <= h - b; };
    }
    if ((m = cp.match(/polygon\(([^)]*)\)/))) {
      var pts = m[1].replace(/evenodd|nonzero/g, "").split(",").map(function (pair) {
        var xy = pair.trim().split(/\s+/);
        return [L(xy[0], w), L(xy[1], h)];
      }).filter(function (q) { return q[0] != null && q[1] != null; });
      if (pts.length < 3) return null;
      return function (px, py) {
        var inside = false;
        for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
          if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      };
    }
    return null;
  },
  _ctmInside: function (px, py, w, h, rad) {
    if (px < 0 || py < 0 || px > w || py > h) return false;
    var corners = [
      { cx: rad.tl, cy: rad.tl, r: rad.tl, t: px < rad.tl && py < rad.tl },
      { cx: w - rad.tr, cy: rad.tr, r: rad.tr, t: px > w - rad.tr && py < rad.tr },
      { cx: w - rad.br, cy: h - rad.br, r: rad.br, t: px > w - rad.br && py > h - rad.br },
      { cx: rad.bl, cy: h - rad.bl, r: rad.bl, t: px < rad.bl && py > h - rad.bl },
    ];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      if (c.r > 0 && c.t) {
        var dx = px - c.cx, dy = py - c.cy;
        if (dx * dx + dy * dy > c.r * c.r) return false;
      }
    }
    return true;
  },
  _pushClickThroughMask: function () {
    if (!OnFramer._ctmSelector || document.hidden) return;
    var cell = OnFramer._ctmCell || 6;
    var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
    var cols = Math.ceil(vw / cell), rows = Math.ceil(vh / cell);
    var bits = new Uint8Array(cols * rows);
    var canvasMode = OnFramer._ctmMode === "canvas";
    document.querySelectorAll(OnFramer._ctmSelector).forEach(function (el) {
      var b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      // Tier 2 (opt-in): rasterise the real alpha of image/canvas widgets (e.g. a PNG cut-out
      // shape) so only its opaque pixels catch clicks. Falls back to geometry if there's no
      // drawable source or the pixels are tainted (cross-origin).
      if (canvasMode && OnFramer._ctmCanvasFill(el, b, cell, cols, rows, bits)) {
        return;
      }
      var rad = OnFramer._ctmRadius(el, b.width, b.height);
      var clip = OnFramer._ctmClip(el, b.width, b.height); // Tier 2: arbitrary CSS shapes
      var c0 = Math.floor(b.left / cell), c1 = Math.ceil(b.right / cell);
      var r0 = Math.floor(b.top / cell), r1 = Math.ceil(b.bottom / cell);
      for (var r = r0; r < r1; r++) {
        for (var c = c0; c < c1; c++) {
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          var cx = c * cell + cell / 2, cy = r * cell + cell / 2;
          var lx = cx - b.left, ly = cy - b.top;
          if (OnFramer._ctmInside(lx, ly, b.width, b.height, rad) && (!clip || clip(lx, ly))) {
            bits[r * cols + c] = 1;
          }
        }
      }
    });
    // pack 1bpp + base64
    var bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (var i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= (0x80 >> (i & 7));
    var bin = "";
    for (var j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
    var payload = cols + "," + rows + ";" + btoa(bin);
    // Skip the send when the mask is unchanged: the native side re-arms (briefly makes the
    // whole window click-through until the next cursor move) on every SetClickThroughMask, so
    // re-sending an identical mask on the resize/scroll/1s-interval tick would flicker.
    if (payload === OnFramer._ctmLast) return;
    OnFramer._ctmLast = payload;
    OnFramer.sendMessage("SetClickThroughMask", payload).catch(function () {});
  },
  _ctmLast: null,
  _ctmMode: "geometry",
  _ctmCv: null,
  // Tier 2 canvas rasteriser: draw an image/canvas widget's real pixels into the mask grid and
  // keep the cells whose alpha is above threshold. Returns true if it filled (so the caller
  // skips geometry), false to fall back. Cross-origin images taint the canvas -> caught -> false.
  _ctmCanvasFill: function (el, b, cell, cols, rows, bits) {
    var tag = el.tagName;
    var src = (tag === "IMG" || tag === "CANVAS") ? el : el.querySelector("img,canvas");
    if (!src) return false;
    if (src.tagName === "IMG" && (!src.complete || !src.naturalWidth)) return false;
    var c0 = Math.max(0, Math.floor(b.left / cell)), c1 = Math.min(cols, Math.ceil(b.right / cell));
    var r0 = Math.max(0, Math.floor(b.top / cell)), r1 = Math.min(rows, Math.ceil(b.bottom / cell));
    var gw = c1 - c0, gh = r1 - r0;
    if (gw < 1 || gh < 1) return false;
    var cv = OnFramer._ctmCv || (OnFramer._ctmCv = document.createElement("canvas"));
    cv.width = gw; cv.height = gh;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, gw, gh);
    // Map the element's box into the grid cells it covers (1 canvas px = 1 mask cell).
    var dx = (b.left - c0 * cell) / cell, dy = (b.top - r0 * cell) / cell;
    var data;
    try {
      ctx.drawImage(src, dx, dy, b.width / cell, b.height / cell);
      data = ctx.getImageData(0, 0, gw, gh).data;
    } catch (e) {
      return false; // taint / not drawable -> geometry fallback
    }
    for (var y = 0; y < gh; y++) {
      for (var x = 0; x < gw; x++) {
        if (data[(y * gw + x) * 4 + 3] > 16) bits[(r0 + y) * cols + (c0 + x)] = 1;
      }
    }
    return true;
  },
  clickThroughMask: function (selector, opts) {
    OnFramer._ctPaused = null; // started by hand: nothing left to resume
    OnFramer._ctmSelector = selector || ".ct-interactive";
    OnFramer._ctmCell = (opts && opts.cell) || 6;
    OnFramer._ctmMode = (opts && opts.mode) === "canvas" ? "canvas" : "geometry";
    OnFramer._ctmLast = null; // force the first push to send
    OnFramer._pushClickThroughMask();
    if (!OnFramer._ctmTimer) {
      window.addEventListener("resize", OnFramer._pushClickThroughMask);
      window.addEventListener("scroll", OnFramer._pushClickThroughMask, true);
      // Set up while hidden: push the moment the page shows, not on the next 1 s tick.
      document.addEventListener("visibilitychange", OnFramer._pushClickThroughMask);
      OnFramer._ctmTimer = setInterval(OnFramer._pushClickThroughMask, 1000);
    }
    return Promise.resolve();
  },
  stopClickThroughMask: function () {
    OnFramer._ctmSelector = null;
    OnFramer._ctmLast = null;
    if (OnFramer._ctmTimer) {
      clearInterval(OnFramer._ctmTimer);
      OnFramer._ctmTimer = null;
      window.removeEventListener("resize", OnFramer._pushClickThroughMask);
      window.removeEventListener("scroll", OnFramer._pushClickThroughMask, true);
      document.removeEventListener("visibilitychange", OnFramer._pushClickThroughMask);
    }
    return OnFramer.sendMessage("SetClickThroughMask", "");
  },
};

// The docs and many widgets use window.OnFramer; `let` alone does not create it.
if (typeof window !== "undefined") window.OnFramer = OnFramer;

// --- Widget data that survives a new Chromium profile (OnFramer.storage) ---
// Widgets keep their options in localStorage, which lives in the Chromium profile. When the profile
// changes (shared engine on/off, a new cache folder, a reinstall) the widget would start empty. Inside
// OnFramer, on a widget page (/standalone/<Name>/), this keeps a copy of the keys THIS widget writes in
// the user folder through the desktopBridge plugin (storageSave -> <UserRoot>\widgets\<Name>\storage.json)
// and puts them back on a fresh profile (storageLoad), reloading the page once so the widget reads them.
// Existing widgets need no change: localStorage.setItem/removeItem/clear are watched. All widgets on
// localhost:8383 share one origin, so only keys this widget wrote (or restored) are copied.
// No polling: one save at most every SAVE_MS after a change, and a last one when the page goes away.
// Without the plugin, or outside OnFramer, everything stays plain localStorage.
(function () {
  var NAME_RE = /^\/standalone\/([A-Za-z0-9_-]{1,64})(?:\/|$)/;
  var PREFIX = "__onframer.";
  var BRIDGE_URL = "ws://127.0.0.1:9093";
  var SAVE_MS = 1500;

  function widgetName(pathname) {
    var m = NAME_RE.exec(String(pathname || ""));
    return m ? m[1] : null;
  }

  // backup = {savedAt, data} from storageLoad; get(key) reads this profile's localStorage; seenAt = the
  // backup savedAt this profile last matched (0 = never, e.g. a fresh profile or after clear()).
  // A key missing here always comes back. A key with another value comes back only when the backup is
  // newer than what this profile has seen (a profile that sat unused while another one was in use).
  function planRestore(backup, get, seenAt) {
    var set = {}, data = (backup && backup.data) || {}, newer = ((backup && backup.savedAt) || 0) > (seenAt || 0);
    Object.keys(data).forEach(function (k) {
      if (k.indexOf(PREFIX) === 0 || typeof data[k] !== "string") return;
      var v = get(k);
      if (v === null || (newer && v !== data[k])) set[k] = data[k];
    });
    return set;
  }

  // { key: value } for the tracked keys that still exist.
  function snapshot(keys, get) {
    var out = {};
    Object.keys(keys).forEach(function (k) { var v = get(k); if (v !== null) out[k] = v; });
    return out;
  }

  var w = typeof window !== "undefined" ? window : null;
  var name = w && w.location ? widgetName(w.location.pathname) : null;
  var ls = null;
  try { ls = w && w.localStorage; } catch (e) { ls = null; }   // blocked storage throws
  var Proto = w && w.Storage && w.Storage.prototype;
  var active = !!(name && ls && Proto && typeof w.cefQuery === "function" && typeof w.WebSocket === "function" &&
    !Proto.__onframerWatched);

  var readyDone, ready = new Promise(function (r) { readyDone = r; });
  var lsGet = function (k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } };

  var api = {
    widget: active ? name : null,
    active: active,
    ready: ready,   // resolves once the backup is loaded (at once when inactive)
    get: function (key, fallback) {
      return ready.then(function () {
        var v = lsGet(key);
        if (v === null) return fallback;
        try { return JSON.parse(v); } catch (e) { return v; }
      });
    },
    set: function (key, value) {
      try { ls.setItem(key, JSON.stringify(value)); } catch (e) { return Promise.reject(e); }
      return Promise.resolve();
    },
    remove: function (key) { try { ls.removeItem(key); } catch (e) {} return Promise.resolve(); },
    flush: function () { return Promise.resolve(); },
    _: { widgetName: widgetName, planRestore: planRestore, snapshot: snapshot },
  };
  if (typeof OnFramer !== "undefined") OnFramer.storage = api;
  if (!active) { readyDone(); return; }

  var META = PREFIX + "storage." + name;    // backup savedAt this profile last matched
  var GUARD = PREFIX + "restored." + name;  // sessionStorage: the reload already happened once
  var origSet = Proto.setItem, origRemove = Proto.removeItem, origClear = Proto.clear;
  var keys = {}, loaded = false, dirty = false, timer = null, reloading = false, guardKeys = {}, lastSent = null;

  function changed() {
    if (reloading) return;
    dirty = true;
    if (loaded && !timer) timer = setTimeout(save, SAVE_MS);
  }
  Proto.__onframerWatched = true;
  var origGet = Proto.getItem;
  Proto.setItem = function (k, v) {
    if (this === ls && reloading && guardKeys[k]) return;   // keep the restored value for the reload
    var mine = this === ls && String(k).indexOf(PREFIX) !== 0;
    // Widgets often write the same value again on every tick: that is not a change.
    var same = mine && keys[String(k)] && origGet.call(this, k) === String(v);
    var r = origSet.apply(this, arguments);
    if (mine && !same) { keys[String(k)] = 1; changed(); }
    return r;
  };
  Proto.removeItem = function (k) {
    if (this === ls && reloading && guardKeys[k]) return;
    var r = origRemove.apply(this, arguments);
    k = String(k);
    if (this === ls && k.indexOf(PREFIX) !== 0) { delete keys[k]; changed(); }
    return r;
  };
  Proto.clear = function () {
    if (this === ls && reloading) return;
    var r = origClear.apply(this, arguments);
    if (this === ls) { keys = {}; changed(); }
    return r;
  };

  // Small request/reply client for the bridge; one socket, opened on the first call.
  var ws = null, opening = null, seq = 0, waits = {};
  function connect() {
    if (ws && ws.readyState === 1) return Promise.resolve(ws);
    if (opening) return opening;
    opening = new Promise(function (resolve, reject) {
      var s;
      try { s = new w.WebSocket(BRIDGE_URL); } catch (e) { opening = null; reject(e); return; }
      s.onopen = function () { ws = s; opening = null; resolve(s); };
      s.onerror = function () {};
      s.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        var wt = m && waits[m.id];
        if (!wt) return;
        delete waits[m.id]; clearTimeout(wt.t);
        if (m.ok) wt.ok(m.result); else wt.ko(new Error(m.error || "failed"));
      };
      s.onclose = function () {
        if (ws === s) ws = null;
        if (opening) { opening = null; reject(new Error("desktopBridge not running")); }
        Object.keys(waits).forEach(function (id) { clearTimeout(waits[id].t); waits[id].ko(new Error("desktopBridge disconnected")); });
        waits = {};
      };
    });
    return opening;
  }
  function request(sock, cmd, args, ms) {
    return new Promise(function (ok, ko) {
      var id = "ofstorage-" + (++seq);
      waits[id] = { ok: ok, ko: ko, t: setTimeout(function () { delete waits[id]; ko(new Error("timeout")); }, ms || 8000) };
      sock.send(JSON.stringify({ id: id, cmd: cmd, args: args }));
    });
  }
  function call(cmd, args, ms) { return connect().then(function (s) { return request(s, cmd, args, ms); }); }

  function save() {
    clearTimeout(timer); timer = null;
    if (!loaded || !dirty || reloading) return Promise.resolve();
    dirty = false;
    var data = snapshot(keys, lsGet), text = JSON.stringify(data);
    if (text === lastSent) return Promise.resolve();
    return call("storageSave", { widget: name, data: data }).then(function (r) {
      lastSent = text;
      try { origSet.call(ls, META, String(r.savedAt)); } catch (e) {}
    }, function () { dirty = true; });   // plugin down: the next change (or pagehide) tries again
  }
  api.flush = save;

  // Page going away: send what is pending without waiting for the answer, then close the socket
  // (a page kept in the back/forward cache must not hold it). The next load sees the newer backup
  // with the same values as this profile, so nothing is restored and nothing reloads.
  function leave() {
    clearTimeout(timer); timer = null;
    if (loaded && dirty && !reloading && ws && ws.readyState === 1) {
      dirty = false;
      var data = snapshot(keys, lsGet), text = JSON.stringify(data);
      if (text === lastSent) return;
      lastSent = text;
      try { ws.send(JSON.stringify({ id: "ofstorage-last", cmd: "storageSave", args: { widget: name, data: data } })); } catch (e) {}
    }
  }
  if (w.document) w.document.addEventListener("visibilitychange", function () { if (w.document.hidden) leave(); });
  w.addEventListener("pagehide", function () { leave(); try { ws && ws.close(); } catch (e) {} });

  call("storageLoad", { widget: name }).then(function (backup) {
    var seenAt = Number(lsGet(META)) || 0;
    var set = planRestore(backup, lsGet, seenAt);
    Object.keys((backup && backup.data) || {}).forEach(function (k) { if (k.indexOf(PREFIX) !== 0) keys[k] = 1; });
    var n = 0;
    Object.keys(set).forEach(function (k) { try { origSet.call(ls, k, set[k]); n++; } catch (e) {} });
    if (backup && backup.savedAt) { try { origSet.call(ls, META, String(backup.savedAt)); } catch (e) {} }
    var ss = null;
    try { ss = w.sessionStorage; } catch (e) {}
    var already = false;
    try { already = !!(ss && ss.getItem(GUARD)); if (ss) ss.removeItem(GUARD); } catch (e) {}
    if (n > 0 && !already && ss) {
      // The widget already read the empty values: reload once so it starts with its data. Until the
      // reload, writes to the restored keys are ignored (a beforeunload handler saving defaults).
      try { ss.setItem(GUARD, "1"); } catch (e) {}
      reloading = true;
      guardKeys = set;
      w.location.reload();
      return;
    }
    loaded = true;
    if (dirty) timer = setTimeout(save, SAVE_MS);
    readyDone();
  }, function () {
    // No plugin: plain localStorage for this page. Nothing is saved, so a backup is never
    // overwritten by a fresh profile's defaults.
    readyDone();
  });
})();
