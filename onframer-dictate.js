/*!
 * OnFramer dictation — OnFramer.dictate(): record the microphone, get the text back.
 *
 * @version 1.0.0
 * @license MIT
 *
 * Why not the Web Speech API: Chromium's webkitSpeechRecognition sends audio to a Google service that
 * needs Google's own API keys, which CEF builds (OnFramer included) do not have, so it fails with
 * "network" / "not-allowed". Instead this records with MediaRecorder and sends the clip to the
 * aiBridge plugin (ws://127.0.0.1:9094, "transcribe"), which forwards it to the speech-to-text server
 * the person configured (OpenAI whisper-1, Groq, or a local whisper server). The key stays on the PC.
 *
 *   if (await OnFramer.dictate.available()) {
 *     const text = await OnFramer.dictate({ language: "es", onState: (s) => label.textContent = s });
 *   }
 *   OnFramer.dictate.stop();             // stop now (otherwise: after 1.5 s of silence or maxSeconds)
 *
 * Options: language ("es", "en"...; omit to auto-detect), maxSeconds (default 30), silenceMs (default 1500,
 * 0 = never stop on silence), bridgeUrl, signal (AbortSignal: cancel, rejects with AbortError),
 * onState("listening" | "transcribing" | "done").
 * Load after onframer.js (or alone: it then creates window.OnFramer with only dictate()).
 */
(function (global) {
  const OF = (typeof OnFramer !== "undefined" && OnFramer) || global.OnFramer || (global.OnFramer = {});
  const BRIDGE = "ws://127.0.0.1:9094";
  let current = null;   // the recording in progress: { stop() }

  function bridge(url, cmd, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      let ws; try { ws = new WebSocket(url); } catch (e) { return reject(new Error("aiBridge is not running")); }
      const t = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("aiBridge did not answer")); }, timeoutMs);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, cmd, args }));
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.id !== 1 || m.token !== undefined) return;
        clearTimeout(t); try { ws.close(); } catch (x) {}
        m.ok ? resolve(m.result) : reject(new Error(m.error));
      };
      ws.onerror = () => { clearTimeout(t); reject(new Error("aiBridge is not running (enable it in OnFramer Manager → Plugins)")); };
    });
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function dictate(opts = {}) {
    if (current) throw new Error("already dictating");
    const url = opts.bridgeUrl || BRIDGE;
    const onState = typeof opts.onState === "function" ? opts.onState : () => {};
    const maxMs = Math.min(300, Math.max(1, Number(opts.maxSeconds) || 30)) * 1000;
    const silenceMs = opts.silenceMs === 0 ? 0 : Math.max(300, Number(opts.silenceMs) || 1500);
    if (opts.signal && opts.signal.aborted) throw new DOMException("cancelled", "AbortError");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => global.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    let cancelled = false, ctx = null, timer = null, maxTimer = null;

    const recorded = new Promise((resolve) => {
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve();
    });
    const finish = () => {
      clearInterval(timer); clearTimeout(maxTimer);
      if (rec.state !== "inactive") rec.stop();
      stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
    };
    current = { stop: finish };
    const onAbort = () => { cancelled = true; finish(); };
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });

    // Silence detection: stop after silenceMs of quiet once someone has spoken. Checked 10 times a
    // second only while recording.
    if (silenceMs && (global.AudioContext || global.webkitAudioContext)) {
      ctx = new (global.AudioContext || global.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let spoke = false, quietSince = 0;
      timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        const now = Date.now();
        if (peak > 12) { spoke = true; quietSince = 0; } else if (spoke) { quietSince = quietSince || now; if (now - quietSince > silenceMs) finish(); }
      }, 100);
    }
    maxTimer = setTimeout(finish, maxMs);
    rec.start(250);
    onState("listening");

    try {
      await recorded;
      if (cancelled) throw new DOMException("cancelled", "AbortError");
      const blob = new Blob(chunks, { type: (rec.mimeType || mime || "audio/webm").split(";")[0] });
      if (!blob.size) return "";
      onState("transcribing");
      const args = { audio: await toBase64(blob), mime: blob.type };
      if (opts.language) args.language = String(opts.language).slice(0, 3).toLowerCase();
      const r = await bridge(url, "transcribe", args, 120000);
      onState("done");
      return (r && r.text) || "";
    } finally {
      current = null;
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    }
  }

  // true when aiBridge runs and has speech to text set up ("transcribeModel" in its config.json).
  dictate.available = async function (opts = {}) {
    try { const i = await bridge(opts.bridgeUrl || BRIDGE, "info", {}, 1500); return !!(i && i.transcribe); } catch (e) { return false; }
  };
  dictate.stop = function () { if (current) current.stop(); };

  OF.dictate = dictate;
})(typeof window !== "undefined" ? window : globalThis);
