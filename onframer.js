/*!
 * Project Name: OnFramer
 * Description: This file serves as a bridge between JavaScript and Onframer (CEF), enabling control over window behavior.
 *
 * @version 1.0.7-beta
 * @date 2026-06-12
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

    return new Promise((resolve, reject) => {
      try {
        window.cefQuery({
          request: message,
          onSuccess: function (response) {
            if (response !== "") {
              response = JSON.parse(response);
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
  monitorInfo: () => {
    return OnFramer.sendMessage("MonitorInfo");
  },
  maximize: () => {
    return OnFramer.sendMessage("Maximize");
  },
  minimize: () => {
    return OnFramer.sendMessage("Minimize");
  },
  isMinimized: () => {
    return OnFramer.sendMessage("IsMinimized");
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
  setIgnoreMouseEvents: (ignore, opts) => {
    var forward = opts && opts.forward ? 1 : 0;
    return OnFramer.sendMessage(
      "SetIgnoreMouseEvents",
      `${ignore ? 1 : 0},${forward}`
    );
  },

  // --- Tray API + minimize-to-tray (via OnframerManager bridge, ws://localhost:9099) ---
  // Requires OnframerManager to be running (it owns the system tray).
  _trayWs: null,
  _trayCbs: {},
  _trayClickCb: null,
  _trayConnect: function () {
    if (OnFramer._trayWs && OnFramer._trayWs.readyState <= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        var ws = new WebSocket("ws://localhost:9099");
        OnFramer._trayWs = ws;
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(e);
        ws.onmessage = (ev) => {
          try {
            var m = JSON.parse(ev.data);
            if (m.event === "tray.click" && OnFramer._trayClickCb) OnFramer._trayClickCb();
            if (m.event === "menu" && OnFramer._trayCbs[m.id]) OnFramer._trayCbs[m.id]();
          } catch (_) {}
        };
      } catch (e) { reject(e); }
    });
  },
  // tray({ tooltip, menu:[{id,label,onClick}], onClick }) — set the app's tray icon + menu.
  tray: function (opts) {
    opts = opts || {};
    return OnFramer._trayConnect().then(() => {
      OnFramer._trayCbs = {};
      var menu = (opts.menu || []).map((it) => {
        if (it.onClick) OnFramer._trayCbs[it.id] = it.onClick;
        return { id: it.id, label: it.label };
      });
      OnFramer._trayClickCb = opts.onClick || null;
      OnFramer._trayWs.send(JSON.stringify({ cmd: "tray.set", tooltip: opts.tooltip || "", menu: menu }));
    });
  },
  removeTray: function () {
    if (OnFramer._trayWs && OnFramer._trayWs.readyState === 1)
      OnFramer._trayWs.send(JSON.stringify({ cmd: "tray.remove" }));
  },
  // Minimize-to-tray: hide the window (a tray icon brings it back).
  minimizeToTray: function () {
    return OnFramer._trayConnect().then(() => OnFramer._trayWs.send(JSON.stringify({ cmd: "hide" })));
  },
  restoreFromTray: function () {
    return OnFramer._trayConnect().then(() => OnFramer._trayWs.send(JSON.stringify({ cmd: "show" })));
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
    if (!OnFramer._ctrSelector) return;
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
    OnFramer.sendMessage("SetClickThroughRegions", payload);
  },
  _ctrLast: null,
  clickThroughRegions: function (selector) {
    OnFramer._ctrSelector = selector || ".ct-interactive";
    OnFramer._ctrLast = null; // force the first push to send
    OnFramer._pushClickThroughRegions();
    if (!OnFramer._ctrTimer) {
      window.addEventListener("resize", OnFramer._pushClickThroughRegions);
      window.addEventListener("scroll", OnFramer._pushClickThroughRegions, true);
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
    if (!OnFramer._ctmSelector) return;
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
    OnFramer.sendMessage("SetClickThroughMask", payload);
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
    OnFramer._ctmSelector = selector || ".ct-interactive";
    OnFramer._ctmCell = (opts && opts.cell) || 6;
    OnFramer._ctmMode = (opts && opts.mode) === "canvas" ? "canvas" : "geometry";
    OnFramer._ctmLast = null; // force the first push to send
    OnFramer._pushClickThroughMask();
    if (!OnFramer._ctmTimer) {
      window.addEventListener("resize", OnFramer._pushClickThroughMask);
      window.addEventListener("scroll", OnFramer._pushClickThroughMask, true);
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
    }
    return OnFramer.sendMessage("SetClickThroughMask", "");
  },
};
