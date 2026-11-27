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
<script src="https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.18-beta/onframer.js"></script>
```

| Method | Does |
|---|---|
| `setPosition(left, top, width, height)` | Move + resize (pixels, virtual desktop coords). Keeps the size when the move lands on a monitor with another scale (1.0.18+) |
| `monitorInfo()` → `object[]` | Monitors with `rcMonitor`/`rcWork` rects in physical pixels (`setPosition` too): multiply CSS sizes by `devicePixelRatio`; `primary: true` on the main one (1.0.14+) |
| `maximize()` / `restore()` / `minimize()` | Window state |
| `isMinimized()` / `isMaximized()` / `isAlwaysOnTop()` → `bool` | Query the window state (`isMaximized`/`isAlwaysOnTop` 1.0.16+) |
| `windowState()` → `{x, y, width, height, minimized, maximized, fullscreen, alwaysOnTop, visible}` | Where the window is now, in physical pixels like `setPosition` (1.0.16+, exact on build 31+; older builds get an estimate from `screenX`). Use it for "move to the next monitor" or to save and restore the position |
| `fullscreen()` / `exitFullscreen()` | Fullscreen (transparency preserved in `--widget`) |
| `alwaysOnTop()` / `notAlwaysOnTop()` | Keep above other windows |
| `mute()` / `unmute()` | Window audio (note: `unmute`, not `unMute`) |
| `setIgnoreMouseEvents(ignore, {forward})` | **Whole-window click-through** — when `ignore` is true, clicks pass to the window behind. It pauses a running `clickThroughMask`/`clickThroughRegions` and `false` turns it back on (1.0.16+) |
| `clickThroughRegions(selector)` / `stopClickThroughRegions()` | **Per-region click-through** — only matching elements' bounding boxes catch clicks; transparent areas pass through automatically |
| `clickThroughMask(selector, {cell})` / `stopClickThroughMask()` | **Per-pixel click-through** — rasterises each widget's `border-radius` + CSS `clip-path` shape, so rounded/circular widgets pass clicks through their transparent corners (build 148+) |
| `storage.get(key, fallback)` / `storage.set(key, value)` / `storage.remove(key)` | JSON values in localStorage that **survive a new Chromium profile** (1.0.9+). On a widget page (`/standalone/<Name>/`) with the desktopBridge plugin, the keys a widget writes (also plain `localStorage.setItem`) are copied to the user folder and put back on a fresh profile (one automatic reload). `storage.ready` resolves when the copy is loaded |

```javascript
// Place a half-width panel on the active monitor's work area
const [m] = await OnFramer.monitorInfo();
// SDK 1.0.10+ adds m.rcWork; older versions only send flat keys ("rcWork.left").
const w = m.rcWork ?? { left: m["rcWork.left"], top: m["rcWork.top"], right: m["rcWork.right"], bottom: m["rcWork.bottom"] };
await OnFramer.setPosition(w.left, w.top, (w.right - w.left) / 2, w.bottom - w.top);
```

Multi-monitor grid helpers live in `onframer-utils.js` (`ofScreens.onGrid(...)` + the
`?ofpos=CxR_S-C-R-A` URL — columns×rows _ screen-col-row-adaptSize).

## Run it while you build

```
onframer-cli dev <folder>
```
Serves the folder on `http://127.0.0.1:5178/`, opens it as a `--widget` with DevTools and reloads on
every save (installed with the Manager). Use it instead of `file://`: a `file://` page has no origin,
so the plugins (desktopBridge, tray, notifications) refuse it — desktopBridge closes with code 4003.

## Launch arguments

```
onframer.exe --widget --dev --url=https://your.app/
```
- `--url=<url>` page to load · `--dev` DevTools
- `--widget` frameless **+ transparent** (the see-through widget mode)
- `?ofpos=3x2_1-2-1-1` (URL query) pre-position on a monitor grid cell; the page must load
  `onframer-utils.js` and call `ofScreens.init(1, 1)` on load (that reads it)
- `--proxy-server=127.0.0.1:9000` route through the Proxy plugin (HTML injection)
- `--user-data-dir=<path>` / `--cache-path=<path>` profile + cache

## Key patterns

- **Transparency**: launch with `--widget` AND set `html, body { background: transparent }`
  (or `rgba(…, 0)`). No API call. Transparency is preserved during fullscreen.
- **Click-through overlay**: three levels. `setIgnoreMouseEvents(true)` = whole window passes
  clicks. `clickThroughRegions(".ct-interactive")` = only the marked widgets' rectangles catch
  clicks, the transparent rest passes — automatic, no toggling. `clickThroughMask(".ct-interactive")`
  = **per-pixel**: rounded/circular/clip-path widgets pass clicks through their transparent corners
  too. Mark interactive elements with `class="ct-interactive"`. A "ghost mode" (whole widget
  click-through on top of a mask) is `setIgnoreMouseEvents(true)`; give it a way back that needs no
  mouse (global hotkey or tray menu item) that calls `setIgnoreMouseEvents(false)`.
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
ws.onmessage = (e) => render(JSON.parse(e.data)); // { type: "system", cpuPercent, memUsedPercent, ... }
```
systemBridge sleeps until needed: in a page the Manager did not open, call `db.wake("systemBridge")`
first, or use the `cpu`/`memory` providers (they wake it).
Extend systemBridge with `serialport`, `@abandonware/noble` (BLE), or `node-hid`.

**desktopBridge** (`ws://127.0.0.1:9093`) gives a widget desktop powers through request/reply
messages: Windows notifications, clipboard, media keys, what's playing now (any app that reports to
Windows: Spotify, browsers), idle time, opening links. Use the ready client:

```html
<script src="https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.18-beta/desktop-bridge.js"></script>
```
```javascript
const db = DesktopBridge.connect();                       // reconnects by itself
db.onStatus((up) => banner.hidden = up);                  // show "enable the plugin" when down
await db.call("notify", { app: "MyApp", title: "Done", body: "Export finished" }); // app = sender name
// The app's own JSON file on disk (user folder, survives updates). Values are strings.
const { data } = await db.call("storageLoad", { widget: "MyApp" });
await db.call("storageSave", { widget: "MyApp", data: { tasks: JSON.stringify(tasks) } });
// Global hotkey (only this page gets it; released when the page closes). Re-register on reconnect.
await db.hotkeys(["ctrl+alt+t"]);
db.on("hotkey", ({ combo }) => toggle());
const { path } = await db.saveFile({ name: "tasks.json", content: json }); // Save as dialog → file ({canceled:true} if closed)
await db.wake("systemBridge");                           // start a sleeping on-demand plugin (pages the Manager did not open)
const { text } = await db.call("clipboard.read");
const stopClip = db.onClipboard((text) => history.unshift(text)); // new text copied anywhere (polls every 1 s; 1.0.17+)
await db.call("media", { action: "playpause" });          // next | prev | volup | voldown | mute
const { seconds } = await db.call("idle");                // since the last input anywhere
const { hex, ctrl } = await db.call("cursorColor");       // pixel under the mouse (EyeDropper is unavailable in CEF)
const { png } = await db.call("capture", { x, y, w, h }); // screen region, physical px → base64 PNG
await db.call("keepAwake", { on: true });                 // released automatically when the page disconnects
const { files } = await db.call("recentFiles", { folder: "downloads", n: 10, icons: true }); // Downloads/Desktop/Documents
await db.call("openPath", { path: files[0].path });       // opens a file or folder inside the user's folder only
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
folder next to `onframer.exe` (same layout; there is no switch for another path). Netflix/Disney+ also need a
commercial VMP-signed license (a contractual gate, not a flag).

## Gotchas (read these)

- Wrap every `OnFramer.*` call in `try/catch` — it throws in a plain browser.
- The unmute method is `unmute`, not `unMute`.
- Transparency needs `--widget` AND a transparent CSS background.
- `setPosition` is pixels on the virtual desktop; use `monitorInfo()` for HiDPI/multi-monitor.
- There is no `close()` API — use `window.close()`. No transparency API — it's `--widget` + CSS.
- Plugins refuse `file://` pages: serve the folder (`onframer-cli dev <folder>`, or your own plugin).
- Tray (`OnFramer.tray`, `minimizeToTray`) and desktopBridge need the Manager running. The tray icon is
  the page favicon (or `tray({ icon })`).
  In Windows' tray settings every app's icon is listed as "OnFramer Manager" with the page `<title>` as
  its tooltip. `onframer-cli manager restart` restarts it (run it in the user's session, not over SSH): windows
  the Manager opened are reopened from scratch (keep state on disk), windows you started (`dev`, your own
  onframer.exe) keep running and reconnect through desktop-bridge.js and `tray()`.
  `onframer-cli plugins list` / `plugins enable <name>` manage plugins from a terminal; `plugins wake <name>`
  starts a sleeping plugin for a script with no page open; `onframer-cli version` shows the installed build.
- Several windows in one app: one page per window (each its own `<title>`), talking through webSocketServer;
  open extra windows with `onframer-cli widgets open "<url>"`. Each page gets its own tray icon and
  `restoreFromTray()` brings back that page's window (build 35+). https://docs.onframer.io/#complete-app-multi
- Plugin settings (port, `"host": "0.0.0.0"` to open one to the LAN) go in `settings.json` in the plugin's data
  folder (`%APPDATA%\OnFramer\<install id>\plugins\<name>\`), never in its `config.json` (updates replace it).
- To show a third-party site that refuses iframes, or restyle it: Proxy `settings.json`
  `"sites": [{ "host": "bbc.com", "allowFraming": true, "css": "header{display:none}", "js": "..." }]`
  (https://docs.onframer.io/#use-proxy). Don't tell users to install the Proxy certificate in Windows:
  widgets the Manager opens already trust it.
- Two `onframer.exe` with the same `--cache-path` share one process (without it they all use the `cache` folder
  next to the exe), and the second window ignores its own flags: give each its own `--user-data-dir` AND
  `--cache-path`.
- clickThroughRegions/Mask switch mode on mouse movement: in test scripts, move the pointer with real
  input (SendInput/mouse_event, Playwright) before clicking; SetCursorPos is not seen. Hover ~1 s before
  a click, and drag a `-webkit-app-region: drag` grip slowly (press, wait ~0.5 s, move in small steps):
  a jump-then-click or a fast synthetic drag can be lost.
- Your own Node plugin: a folder in the user plugins folder (Manager → Configuration → Open plugins
  folder) with `config.json` (`port`, `onDemand`), `index.js`, `start.bat`, `kill.bat`; full example:
  https://docs.onframer.io/#complete-app-plugin

## Rules for the assistant

When building an OnFramer app:
1. Load the SDK from the jsDelivr CDN; prefer `@v1.0.18-beta` (`windowState()`, ghost mode over a mask, click-through, `OnFramer.storage`, `monitorInfo().rcWork`/`primary`, tray that survives Manager restarts, `db.saveFile`, `db.wake`, `db.onClipboard`).
2. Wrap all `OnFramer.*` calls in `try/catch`; the page must not break in a browser.
3. Add a favicon `<link>` (it becomes the window icon).
4. For see-through widgets, set transparent CSS background and tell the user to run with `--widget`.
5. Prefer real web APIs (WebGPU, WebRTC, File System Access) over native shims when possible.
6. For hardware/OS access, design a Node plugin that bridges to the page over WebSocket.
7. Save app data with desktopBridge `storageSave`/`storageLoad` (or `OnFramer.storage` on a gallery
   widget page), not only localStorage. Export with `db.saveFile` (Save as dialog); Chromium's
   `showSaveFilePicker` can abort in small widgets.
8. Tell the user to run the app with `onframer-cli dev <folder>`, never as `file://`.

## Links

- Docs: https://docs.onframer.io · Examples: https://examples.onframer.io · Releases: https://onframer.io/releases
- API Playground (try every method): https://examples.onframer.io/standalone/Playground/
- Starter template: https://examples.onframer.io/standalone/StarterTemplate/
