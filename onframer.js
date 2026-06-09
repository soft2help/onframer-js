/*!
 * Project Name: OnFramer
 * Description: This file serves as a bridge between JavaScript and Onframer (CEF), enabling control over window behavior.
 *
 * @version 1.0.0-beta
 * @date 2024-08-01
 * @license MIT
 * @author Luis Fernandes
 *
 * Changelog:
 * - v1.0.0-beta: Initial release.
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
            if (m.event === "mousemove" && OnFramer._ctaSelector) OnFramer._ctaHandle(m.x, m.y);
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

  // --- Per-pixel click-through (auto) ---
  // Make a transparent overlay interactive ONLY over elements matching `selector`;
  // clicks elsewhere pass through to the window behind. Uses the Manager's low-level
  // mouse hook (forwarded moves) to hit-test the DOM and toggle click-through.
  // Needs OnframerManager + launch with --widget.
  _ctaSelector: null,
  _ctaState: null,
  _ctaHandle: function (screenX, screenY) {
    // screen -> client coords using the window's screen origin
    var cx = screenX - (window.screenX || 0);
    var cy = screenY - (window.screenY || 0);
    var el = document.elementFromPoint(cx, cy);
    var interactive = !!(el && el.closest(OnFramer._ctaSelector));
    var ignore = !interactive; // pass through when NOT over an interactive element
    if (ignore !== OnFramer._ctaState) {
      OnFramer._ctaState = ignore;
      OnFramer.setIgnoreMouseEvents(ignore);
    }
  },
  clickThroughAuto: function (selector) {
    OnFramer._ctaSelector = selector || ".ct-interactive";
    OnFramer._ctaState = null;
    return OnFramer._trayConnect().then(() => {
      OnFramer._trayWs.send(JSON.stringify({ cmd: "hook.start" }));
      return OnFramer.setIgnoreMouseEvents(true); // start passing through
    });
  },
  stopClickThroughAuto: function () {
    OnFramer._ctaSelector = null;
    if (OnFramer._trayWs && OnFramer._trayWs.readyState === 1)
      OnFramer._trayWs.send(JSON.stringify({ cmd: "hook.stop" }));
    return OnFramer.setIgnoreMouseEvents(false);
  },
};
