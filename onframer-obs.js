// onframer-obs.js — OBS (obs-websocket v5, built into OBS 28+) for OnFramer widgets. No dependencies.
// Works in the browser and in Node 22+ (globalThis.WebSocket and globalThis.crypto.subtle).
// Load it after onframer.js (optional). Two layers in one file:
//
//  1. ObsClient: the low-level client (auth handshake, requests, events, reconnect). The OBS Deck widget uses it.
//       const obs = new ObsClient({ url: "ws://127.0.0.1:4455", password: "secret" });
//       obs.on("identified", () => obs.call("GetSceneList").then(console.log));
//       obs.on("CurrentProgramSceneChanged", (d) => console.log(d.sceneName));
//       obs.connect();
//     Options: reconnectMs (first retry delay, default 3000), maxReconnectMs (backoff cap; default = reconnectMs,
//     i.e. no backoff), pauseWhenHidden (close the socket while document.hidden, reopen when visible).
//
//  2. OnFramer.obs: the friendly provider (also exported as OnFramerObs).
//       const obs = OnFramer.obs.connect({ host: "127.0.0.1", port: 4455, password: "" });
//       obs.on("state", (s) => ...);          // {connected, status, scene, scenes, streaming, recording, error}
//       obs.on("scene", (name) => ...);       // current program scene changed
//       obs.on("streaming" | "recording", (active) => ...);
//       await obs.setScene("Gaming"); await obs.startStream(); await obs.stopRecord(); await obs.call("GetStats");
//       obs.close();
//     Reconnects by itself with backoff (1 s up to 30 s) and sleeps while the page is hidden or auto-paused.
//
// Protocol: Hello (op 0) -> Identify (op 1) -> Identified (op 2); Event (op 5);
// Request (op 6) -> RequestResponse (op 7). See github.com/obsproject/obs-websocket docs.
(function (root) {
  "use strict";

  const OP = { HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, REIDENTIFY: 3, EVENT: 5, REQUEST: 6, RESPONSE: 7 };
  // All non-high-volume event categories (General … Ui). High-volume ones (volume meters) are left out on purpose.
  const EVENTS_ALL = 0x7ff;

  function b64(bytes) {
    let s = "";
    const a = new Uint8Array(bytes);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }
  async function sha256b64(text) {
    return b64(await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  }
  // authentication = base64(sha256(base64(sha256(password + salt)) + challenge))
  async function authString(password, salt, challenge) {
    return sha256b64((await sha256b64(password + salt)) + challenge);
  }

  class ObsClient {
    constructor(o = {}) {
      this.url = o.url || "ws://127.0.0.1:4455";
      this.password = o.password || "";
      this.eventSubscriptions = o.eventSubscriptions ?? EVENTS_ALL;
      this.reconnect = o.reconnect !== false;
      this.reconnectMs = o.reconnectMs || 3000;
      this.maxReconnectMs = o.maxReconnectMs || this.reconnectMs;
      this.pauseWhenHidden = !!o.pauseWhenHidden;
      this._delay = 0;
      this._hiddenHook = null;
      this.timeoutMs = o.timeoutMs || 8000;
      this.ws = null;
      this.identified = false;
      this.lastError = "";
      this._handlers = {};
      this._pending = new Map();
      this._seq = 0;
      this._retry = null;
      this._stopped = true;
    }

    on(name, fn) { (this._handlers[name] ||= []).push(fn); return this; }
    off(name, fn) { this._handlers[name] = (this._handlers[name] || []).filter((f) => f !== fn); return this; }
    _emit(name, data) { for (const f of this._handlers[name] || []) { try { f(data); } catch (e) { console.error(e); } } }
    _status(s) { this.status = s; this._emit("status", s); }

    connect(opts) {
      if (opts) Object.assign(this, opts);
      this._stopped = false;
      clearTimeout(this._retry);
      this._delay = 0;
      this._watchHidden();
      if (this._isHidden()) { this._sleeping = true; return; }
      this._open();
    }

    _isHidden() { return !!(this.pauseWhenHidden && root.document && root.document.hidden); }
    _watchHidden() {
      if (!this.pauseWhenHidden || this._hiddenHook || !root.document || !root.document.addEventListener) return;
      this._hiddenHook = () => {
        if (this._stopped) return;
        if (root.document.hidden) {
          this._sleeping = true; clearTimeout(this._retry);
          if (this.ws) { try { this.ws.onclose = null; this.ws.close(1000); } catch (e) {} this.ws = null; this.identified = false; this._failAll(); this._status("closed"); }
        } else if (this._sleeping) { this._sleeping = false; this._delay = 0; this._open(); }
      };
      root.document.addEventListener("visibilitychange", this._hiddenHook);
    }

    disconnect() {
      this._stopped = true;
      clearTimeout(this._retry);
      if (this._hiddenHook && root.document) { root.document.removeEventListener("visibilitychange", this._hiddenHook); this._hiddenHook = null; }
      if (this.ws) { try { this.ws.close(1000); } catch (e) {} }
    }

    _open() {
      if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) {} }
      this.identified = false;
      this._status("connecting");
      let ws;
      try { ws = new root.WebSocket(this.url); }
      catch (e) { this.lastError = String(e.message || e); this._closed(); return; }
      this.ws = ws;
      ws.onmessage = (m) => this._onMessage(m.data);
      ws.onerror = () => {
        this.lastError = this.lastError || "Can't reach " + this.url;
        // Browsers follow an error with a close event; Node's WebSocket may not when the connect fails.
        if (ws.readyState !== 1) setTimeout(() => ws.onclose && ws.onclose({ code: 1006 }), 50);
      };
      ws.onclose = (e) => {
        if (ws !== this.ws) return;
        ws.onclose = null; // run once, whichever of error/close arrives first
        // 4009 = AuthenticationFailed, 4010 = UnsupportedRpcVersion (obs-websocket close codes).
        if (e.code === 4009) { this.lastError = "Wrong password"; this._failAll(); this._status("auth-failed"); this.ws = null; return; }
        if (e.code >= 4000 && e.reason) this.lastError = e.reason;
        this._closed();
      };
    }

    _closed() {
      this.ws = null;
      this.identified = false;
      this._failAll();
      this._status("closed");
      // Auto-reconnect so the deck comes back by itself when OBS is (re)started.
      if (this.reconnect && !this._stopped && !this._isHidden()) {
        // Backoff: reconnectMs, x1.6 each failure, up to maxReconnectMs (equal by default = fixed delay).
        const ms = Math.min(this.maxReconnectMs, Math.round(this.reconnectMs * Math.pow(1.6, this._delay++)));
        this._retry = setTimeout(() => this._open(), ms);
      }
    }

    _failAll() {
      for (const [, p] of this._pending) { clearTimeout(p.t); p.reject(new Error("Disconnected")); }
      this._pending.clear();
    }

    async _onMessage(raw) {
      let msg;
      try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch (e) { return; }
      const d = msg.d || {};
      switch (msg.op) {
        case OP.HELLO: {
          const ident = { rpcVersion: 1, eventSubscriptions: this.eventSubscriptions };
          if (d.authentication) {
            if (!this.password) { this.lastError = "OBS asks for a password"; }
            ident.authentication = await authString(this.password || "", d.authentication.salt, d.authentication.challenge);
          }
          this._send(OP.IDENTIFY, ident);
          break;
        }
        case OP.IDENTIFIED:
          this.identified = true;
          this._delay = 0;
          this.lastError = "";
          this.negotiatedRpcVersion = d.negotiatedRpcVersion;
          this._status("identified");
          this._emit("identified", d);
          break;
        case OP.EVENT:
          this._emit("event", d);
          this._emit(d.eventType, d.eventData || {});
          break;
        case OP.RESPONSE: {
          const p = this._pending.get(d.requestId);
          if (!p) break;
          this._pending.delete(d.requestId);
          clearTimeout(p.t);
          const st = d.requestStatus || {};
          if (st.result) p.resolve(d.responseData || {});
          else {
            const err = new Error(st.comment || ("OBS error " + st.code));
            err.code = st.code; err.requestType = d.requestType;
            p.reject(err);
          }
          break;
        }
      }
    }

    _send(op, d) { this.ws.send(JSON.stringify({ op, d })); }

    // Sends one request and resolves with responseData; rejects with an Error carrying .code on failure.
    call(requestType, requestData) {
      return new Promise((resolve, reject) => {
        if (!this.ws || !this.identified) return reject(new Error("Not connected to OBS"));
        const requestId = "r" + (++this._seq);
        const t = setTimeout(() => { this._pending.delete(requestId); reject(new Error(requestType + " timed out")); }, this.timeoutMs);
        this._pending.set(requestId, { resolve, reject, t });
        const d = { requestType, requestId };
        if (requestData !== undefined) d.requestData = requestData;
        this._send(OP.REQUEST, d);
      });
    }
  }


  // ---------------- OnFramer.obs: the friendly layer ----------------
  function connect(opts = {}) {
    const url = opts.url || "ws://" + (opts.host || "127.0.0.1") + ":" + (opts.port || 4455);
    const client = new ObsClient({
      url, password: opts.password || "", reconnectMs: opts.reconnectMs || 1000, maxReconnectMs: opts.maxReconnectMs || 30000,
      pauseWhenHidden: opts.pauseWhenHidden !== false, eventSubscriptions: opts.eventSubscriptions,
    });
    const handlers = {};
    const st = { connected: false, status: "closed", scene: "", scenes: [], streaming: false, recording: false, error: "" };
    const emit = (n, d) => { for (const f of handlers[n] || []) { try { f(d); } catch (e) { console.error(e); } } };
    const changed = () => emit("state", Object.assign({}, st, { scenes: st.scenes.slice() }));

    async function refresh() {
      const [sc, ss, rs] = await Promise.all([client.call("GetSceneList"), client.call("GetStreamStatus"), client.call("GetRecordStatus")]);
      st.scenes = (sc.scenes || []).map((s) => s.sceneName).reverse();   // OBS lists bottom-up
      st.scene = sc.currentProgramSceneName || "";
      st.streaming = !!ss.outputActive; st.recording = !!rs.outputActive;
      changed();
    }
    client.on("status", (s) => {
      st.status = s; st.connected = s === "identified";
      st.error = s === "identified" ? "" : client.lastError || "";
      if (s !== "identified") changed();
    });
    client.on("identified", () => { refresh().catch((e) => { st.error = e.message; changed(); }); });
    client.on("CurrentProgramSceneChanged", (d) => { st.scene = d.sceneName; emit("scene", d.sceneName); changed(); });
    for (const ev of ["SceneListChanged", "SceneCreated", "SceneRemoved", "SceneNameChanged"]) client.on(ev, () => refresh().catch(() => {}));
    client.on("StreamStateChanged", (d) => {
      if (/STARTING|STOPPING/.test(d.outputState)) return;
      st.streaming = !!d.outputActive; emit("streaming", st.streaming); changed();
    });
    client.on("RecordStateChanged", (d) => {
      if (/STARTING|STOPPING/.test(d.outputState)) return;
      st.recording = !!d.outputActive; emit("recording", st.recording); changed();
    });
    client.on("event", (d) => emit("event", d));

    // Also stop while OnFramer says the widget is paused (fullscreen game, battery...), if onframer-power.js is loaded.
    let offPause = null;
    const OF = root.OnFramer;
    if (opts.pauseWhenHidden !== false && OF && typeof OF.onPause === "function") {
      let paused = false;
      offPause = OF.onPause((s) => {
        if (s.paused === paused) return; paused = s.paused;
        if (paused) client.disconnect(); else client.connect();
      });
    }

    const api = {
      client,
      get state() { return Object.assign({}, st); },
      on(n, f) { (handlers[n] ||= []).push(f); return api; },
      off(n, f) { handlers[n] = (handlers[n] || []).filter((x) => x !== f); return api; },
      call: (type, data) => client.call(type, data),
      setScene: (name) => client.call("SetCurrentProgramScene", { sceneName: name }),
      startStream: () => client.call("StartStream"),
      stopStream: () => client.call("StopStream"),
      startRecord: () => client.call("StartRecord"),
      stopRecord: () => client.call("StopRecord"),
      refresh,
      close() { if (offPause) offPause(); client.disconnect(); },
    };
    client.connect();
    return api;
  }

  const OnFramerObs = { connect, ObsClient };
  root.OnFramerObs = OnFramerObs;
  if (root.OnFramer && typeof root.OnFramer === "object") root.OnFramer.obs = OnFramerObs;

  ObsClient.authString = authString;
  ObsClient.EVENTS_ALL = EVENTS_ALL;
  root.ObsClient = ObsClient;
  if (typeof module === "object" && module.exports) { module.exports = ObsClient; module.exports.OnFramerObs = OnFramerObs; }
})(typeof globalThis !== "undefined" ? globalThis : window);
