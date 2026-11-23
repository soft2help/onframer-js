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
HUDs, streamer overlays, kiosks. It runs the **latest stable Chromium** (158), so every
modern web API works (WebGPU, WebRTC, getUserMedia, File System Access, Notifications…).

## JavaScript SDK

Load it, then call `OnFramer.*`. **Every method returns a Promise.** Always wrap calls in
`try/catch` so the page still works when opened in a normal browser.

```html
<script src="https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.8-beta/onframer.js"></script>
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
| `setIgnoreMouseEvents(ignore, {forward})` | **Whole-window click-through** — when `ignore` is true, clicks pass to the window behind |
| `clickThroughRegions(selector)` / `stopClickThroughRegions()` | **Per-region click-through** — only matching elements' bounding boxes catch clicks; transparent areas pass through automatically |
| `clickThroughMask(selector, {cell})` / `stopClickThroughMask()` | **Per-pixel click-through** — rasterises each widget's `border-radius` + CSS `clip-path` shape, so rounded/circular widgets pass clicks through their transparent corners (build 148+) |

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
- `--widevine-cdm-path=<dir>` override the bundled Widevine CDM (DRM works without it)
- `--user-data-dir=<path>` / `--cache-path=<path>` profile + cache

## Key patterns

- **Transparency**: launch with `--widget` AND set `html, body { background: transparent }`
  (or `rgba(…, 0)`). No API call. Transparency is preserved during fullscreen.
- **Click-through overlay**: three levels. `setIgnoreMouseEvents(true)` = whole window passes
  clicks. `clickThroughRegions(".ct-interactive")` = only the marked widgets' rectangles catch
  clicks, the transparent rest passes — automatic, no toggling. `clickThroughMask(".ct-interactive")`
  = **per-pixel**: rounded/circular/clip-path widgets pass clicks through their transparent corners
  too. Mark interactive elements with `class="ct-interactive"`.
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

**desktopBridge** (`ws://127.0.0.1:9093`) gives a widget desktop powers through request/reply
messages: Windows notifications, clipboard, media keys, what's playing now (any app that reports to
Windows: Spotify, browsers), idle time, opening links. Use the ready client:

```html
<script src="https://examples.onframer.io/assets/js/desktop-bridge.js"></script>
```
```javascript
const db = DesktopBridge.connect();                       // reconnects by itself
db.onStatus((up) => banner.hidden = up);                  // show "enable the plugin" when down
await db.call("notify", { title: "Done", body: "Export finished" });
const { text } = await db.call("clipboard.read");
await db.call("media", { action: "playpause" });          // next | prev | volup | voldown | mute
const { seconds } = await db.call("idle");                // since the last input anywhere
const { hex, ctrl } = await db.call("cursorColor");       // pixel under the mouse (EyeDropper is unavailable in CEF)
const { png } = await db.call("capture", { x, y, w, h }); // screen region, physical px → base64 PNG
await db.call("keepAwake", { on: true });                 // released automatically when the page disconnects
const { files } = await db.call("recentFiles", { folder: "downloads", n: 10, icons: true }); // + openPath {path}
await db.call("launch", { id: "notepad" });                // only ids listed in the plugin config ("launchers")
const { monitors } = await db.call("monitors");            // physical px rects + brightness (DDC/CI / WMI)
await db.call("setBrightness", { index: 1, value: 40, via: monitors[1].brightness.via });
const { windows } = await db.call("windows");              // other apps, front first → moveWindow {hwnd,x,y,w,h}
await db.call("dim", { monitors: [{ ...monitors[1], opacity: 0.7 }] }); // click-through overlay; undim to remove
const { processes } = await db.call("processes", { n: 10 }); // CPU %/RAM grouped by app; endProcess {name}
const info = await db.call("sysinfo", {}, 25000);         // hardware + speed settings + startup apps (3rd arg: timeout ms)
const w = await db.call("wsl");
const { devices } = await db.call("audio");               // outputs; audioSet {id} makes one the default
const { ports } = await db.call("ports");                 // who listens on which TCP port
await db.call("warmth", { monitors: [{ ...monitors[0], kelvin: 3400 }] }); // night colours; restored on disconnect                            // Linux processes, memory {used, cache}, docker containers
db.on("nowPlaying", (t) => show(t.title, t.artist, t.playing));
```
Only origins listed in the plugin's `config.json` (`allowedOrigins`) may connect; add yours.

**Auto-pause** (`onframer-power.js`, load it after `onframer.js`): stop animation loops when nobody
can see them. OnFramer does NOT set `document.hidden` for a minimized widget, so don't rely on it.
```html
<script src="https://examples.onframer.io/assets/js/onframer-power.js"></script>
```
```javascript
OnFramer.onPause(({ paused, reasons }) => paused ? stopLoop() : startLoop());
// reasons: minimized, covered, fullscreen (other app on this monitor), battery, remote, locked, hidden
// <html data-of-paused="..."> is set while paused. A HUD over games: { ignore: ["fullscreen"] }
```

**Providers** (`onframer-providers.js`, load it after `onframer.js` and `onframer-power.js`): live data
for status bars and dashboards without writing any socket code. Each `subscribe` returns its
unsubscribe function; nothing runs for a provider nobody subscribed to, and everything stops while
the page is hidden or auto-paused.
```html
<script src="https://examples.onframer.io/assets/js/onframer-providers.js"></script>
```
```javascript
const off = OnFramer.providers.subscribe("cpu", (d) => cpu.textContent = d.percent + "%", {
  interval: 2000,                                  // ms between callbacks (polled ones: between reads)
  onError: (e) => cpu.textContent = "–",           // plugin down; it keeps retrying by itself
});
off();
```
| Provider | Callback gets | Source |
|---|---|---|
| `cpu` | `{percent, cores, model, loadAvg}` | systemBridge |
| `memory` | `{total, free, used, percent}` (bytes) | systemBridge |
| `network` | `{rxPerSec, txPerSec, interfaces}` (bytes/s) | systemBridge |
| `disk` | `{drives:[{name, label, size, free, used, percent}]}` (every 60 s) | desktopBridge |
| `battery` | `{supported, level 0-1, charging, chargingTime, dischargingTime}` | browser Battery API |
| `media` | `{hasSession, app, title, artist, playing, positionS, durationS}` | desktopBridge |
| `audio` | `{peak, left, right}` 0-1, ~30/s while sound plays | desktopBridge |
| `windows` | `{foreground:{hwnd, process, title}}`; `{list:true}` adds `windows` | desktopBridge |
| `desktop` | `{current, index, name, project, wallpaper}` virtual desktop | desktopBridge |
| `tiling` | `{wm:"glazewm"\|"komorebi"\|null, workspace, monitors:[{name, focused, workspaces:[{name, focused, displayed, windows}]}]}` | desktopBridge (reads GlazeWM / Komorebi) |
| `weather` | `{tempC, code, isDay, windKph, place}`; opts `{lat, lon}` or `{city}` | open-meteo.com |

**Status bars / docks**: `await OnFramer.appbar({ edge: "top", size: 32 })` reserves that screen edge
like the taskbar (size in CSS px; maximized windows stop at it) and moves the window onto it;
`OnFramer.appbar(null)` gives it back (also automatic when the page closes or the plugin stops).
Needs OnFramer + desktopBridge. Example: `standalone/TopBar/`.

## On-device AI

Use **WebLLM** (`@mlc-ai/web-llm`) over **WebGPU** for local LLM inference — works in
OnFramer. (Chrome's Prompt API / Gemini Nano does NOT work in CEF; needs Google-internal
code.)


**In widgets, use `onframer-ai.js`** (`https://examples.onframer.io/assets/js/onframer-ai.js`): one
`OnFramerAI.create()` → `ready()` → `chat(messages, {onToken})` that uses the **aiBridge** plugin
(`ws://127.0.0.1:9094`, any OpenAI-compatible server, key kept on the PC) when running, else WebLLM
on the GPU. Put the task AFTER the text in the user message (small models ignore system prompts),
cap inputs (~4000 chars), and prefer aiBridge on integrated-GPU laptops (local models can hang them).
## DRM

Widevine works **out of the box** — the plug-and-play bundles the CDM, so Widevine/EME content
decrypts and plays like in Chrome. Serve your EME page over `https://` or `http://localhost`
(EME is blocked on `file://` — opaque origin). To pin/replace the CDM, swap the `WidevineCdm`
folder next to `onframer.exe` or launch with `--widevine-cdm-path`. Netflix/Disney+ also need a
commercial VMP-signed license (a contractual gate, not a flag).

## Gotchas (read these)

- Wrap every `OnFramer.*` call in `try/catch` — it throws in a plain browser.
- The unmute method is `unmute`, not `unMute`.
- Transparency needs `--widget` AND a transparent CSS background.
- `setPosition` is pixels on the virtual desktop; use `monitorInfo()` for HiDPI/multi-monitor.
- There is no `close()` API — use `window.close()`. No transparency API — it's `--widget` + CSS.

## Rules for the assistant

When building an OnFramer app:
1. Load the SDK from the jsDelivr CDN; prefer `@v1.0.8-beta` (has `clickThroughMask` + all click-through APIs).
2. Wrap all `OnFramer.*` calls in `try/catch`; the page must not break in a browser.
3. Add a favicon `<link>` (it becomes the window icon).
4. For see-through widgets, set transparent CSS background and tell the user to run with `--widget`.
5. Prefer real web APIs (WebGPU, WebRTC, File System Access) over native shims when possible.
6. For hardware/OS access, design a Node plugin that bridges to the page over WebSocket.

## Links

- Docs: https://docs.onframer.io · Examples: https://examples.onframer.io · Releases: https://onframer.io/releases
- API Playground (try every method): https://examples.onframer.io/standalone/Playground/
- Starter template: https://examples.onframer.io/standalone/StarterTemplate/
