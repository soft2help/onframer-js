# Building a desktop app with OnFramer

Drop this file into your project root so your AI assistant (Claude Code, Cursor, etc.)
knows how to build OnFramer desktop apps without you explaining anything.

## What OnFramer is

OnFramer wraps your **web app (HTML/CSS/JS) in a Chromium (CEF) desktop shell** with
native window control exposed through `window.OnFramer`. Build the UI as a normal web
page; OnFramer gives it desktop powers: positioning, transparency, click-through,
multi-monitor, fullscreen, always-on-top, audio mute, plus Node plugins for hardware.

**Use it when** you want a desktop app from web tech AND need things Electron makes hard:
transparent/see-through widgets, click-through overlays, multi-monitor grid placement,
HUDs, streamer overlays, kiosks. It runs the **latest stable Chromium** (148), so every
modern web API works (WebGPU, WebRTC, getUserMedia, File System Access, Notifications…).

## JavaScript SDK

Load it, then call `OnFramer.*`. **Every method returns a Promise.** Always wrap calls in
`try/catch` so the page still works when opened in a normal browser.

```html
<script src="https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.1-beta/onframer.js"></script>
```

| Method | Does |
|---|---|
| `setPosition(left, top, width, height)` | Move + resize (pixels, virtual desktop coords) |
| `monitorInfo()` → `object[]` | Monitors with `rcMonitor`/`rcWork` rects + scale |
| `maximize()` / `restore()` / `minimize()` | Window state |
| `isMinimized()` → `bool` | Query minimized |
| `fullscreen()` / `exitFullscreen()` | Fullscreen (transparency preserved in `--widget`) |
| `alwaysOnTop()` / `notAlwaysOnTop()` | Keep above other windows |
| `mute()` / `unmute()` | Window audio (note: `unmute`, not `unMute`) |
| `setIgnoreMouseEvents(ignore, {forward})` | **Click-through** — when `ignore` is true, clicks pass to the window behind (needs `@v1.0.1-beta`) |

```javascript
// Place a half-width panel on the active monitor's work area
const [m] = await OnFramer.monitorInfo();
const w = m.rcWork ?? m;
await OnFramer.setPosition(w.left, w.top, (w.right - w.left) / 2, w.bottom - w.top);
```

Multi-monitor grid helpers live in `onframer-utils.js` (`ofScreens.onGrid(...)` + the
`?ofpos=CxR_S-C-R-A` URL — columns×rows _ screen-col-row-adaptSize).

## Launch arguments

```
onframer.exe --widget --dev --url=https://your.app/
```
- `--url=<url>` page to load · `--dev` DevTools
- `--widget` frameless **+ transparent** (the see-through widget mode)
- `?ofpos=3x2_1-2-1-1` (URL query) pre-position on a monitor grid cell
- `--proxy-server=localhost:9000` route through the Proxy plugin (HTML injection)
- `--widevine-cdm-path=<dir>` Widevine DRM (BYO CDM)
- `--user-data-dir=<path>` / `--cache-path=<path>` profile + cache

## Key patterns

- **Transparency**: launch with `--widget` AND set `html, body { background: transparent }`
  (or `rgba(…, 0)`). No API call. Transparency is preserved during fullscreen.
- **Click-through overlay**: `setIgnoreMouseEvents(true, {forward:true})` makes the whole
  window pass clicks to the desktop/app behind; `false` makes it interactive again.
  (Per-pixel auto mode — opaque parts interactive, transparent parts pass — is roadmap.)
- **Always-on-top widget**: `--widget` + `OnFramer.alwaysOnTop()` for HUDs/tickers.
- **Window icon = the page favicon**, NOT the exe. Add `<link rel="icon" href="/favicon.ico">`.
- **Multi-monitor**: read geometry from `monitorInfo()`; coords are pixels on the virtual
  desktop, so account for DPI scale.

## Node plugins (hardware / system, via WebSocket)

Node plugins reach what the browser can't (serial, BLE, USB, full OS) and talk to your
page over WebSocket. Bundled plugins: **Proxy** (HTML injection), **webSocketServer**
(window↔window messaging), **webServer** (static host), **systemBridge** (live CPU/RAM/
network on `ws://localhost:9092`). The hardware-bridge pattern:

```javascript
const ws = new WebSocket("ws://localhost:9092");
ws.onmessage = (e) => render(JSON.parse(e.data)); // { cpuPercent, memUsedPercent, ... }
```
Extend systemBridge with `serialport`, `@abandonware/noble` (BLE), or `node-hid`.

## On-device AI

Use **WebLLM** (`@mlc-ai/web-llm`) over **WebGPU** for local LLM inference — works in
OnFramer. (Chrome's Prompt API / Gemini Nano does NOT work in CEF; needs Google-internal
code.)

## DRM

Widevine works via **BYO-CDM**: ship a matching `widevinecdm.dll` and launch with
`--widevine-cdm-path`. Without it, EME content fails — show a clear message.

## Gotchas (read these)

- Wrap every `OnFramer.*` call in `try/catch` — it throws in a plain browser.
- The unmute method is `unmute`, not `unMute`.
- Transparency needs `--widget` AND a transparent CSS background.
- `setPosition` is pixels on the virtual desktop; use `monitorInfo()` for HiDPI/multi-monitor.
- There is no `close()` API — use `window.close()`. No transparency API — it's `--widget` + CSS.

## Rules for the assistant

When building an OnFramer app:
1. Load the SDK from the jsDelivr CDN; prefer `@v1.0.1-beta` (has `setIgnoreMouseEvents`).
2. Wrap all `OnFramer.*` calls in `try/catch`; the page must not break in a browser.
3. Add a favicon `<link>` (it becomes the window icon).
4. For see-through widgets, set transparent CSS background and tell the user to run with `--widget`.
5. Prefer real web APIs (WebGPU, WebRTC, File System Access) over native shims when possible.
6. For hardware/OS access, design a Node plugin that bridges to the page over WebSocket.

## Links

- Docs: https://docs.onframer.io · Examples: https://examples.onframer.io · Releases: https://onframer.io/releases
- API Playground (try every method): https://examples.onframer.io/standalone/Playground/
- Starter template: https://examples.onframer.io/standalone/StarterTemplate/
