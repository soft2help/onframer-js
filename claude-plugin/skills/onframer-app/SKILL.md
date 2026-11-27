---
name: onframer-app
description: Use when the user wants to build, run, fix or extend a desktop app, widget, overlay, HUD or kiosk page with OnFramer (onframer.io, onframer.exe, onframer-cli, window.OnFramer, desktop-bridge.js), or asks for a transparent, always-on-top or click-through window made from HTML on Windows.
---

# Building an OnFramer app

OnFramer runs a web page (HTML/CSS/JS) as a Windows desktop window, on Chromium 158. The page gets
window powers through the JavaScript SDK (`window.OnFramer`) and desktop powers (files, tray,
notifications, hotkeys, storage) through the Manager's plugins (`desktop-bridge.js`).

**Never guess an OnFramer flag or API.** Everything that exists is in this file or in
[reference.md](reference.md) (the full guide: every SDK method, launch argument, plugin and gotcha).
If something is not there, say so and point to https://docs.onframer.io.

## 1. Check that OnFramer is installed

In PowerShell (not cmd):

```powershell
onframer-cli version
```

- Prints a build number: installed. Go on.
- `onframer-cli : The term ... is not recognized`: either it isn't installed, or the window was open
  before the install. Try a new PowerShell window first. To install (per user, no admin, ~1 minute,
  press Enter to every question):

  ```powershell
  iwr -useb https://onframer.io/installer | iex
  ```

  It installs `onframer` + `onframer-cli` (`%USERPROFILE%\Onframer`), the OnFramer Manager (tray app that
  runs the plugins) and a starter at `%USERPROFILE%\OnFramerApps\my-onframer-app`. Old windows reload
  PATH with:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

## 2. One folder per app

Put each app in its own folder under `%USERPROFILE%\OnFramerApps\<app-name>\` with `index.html` at the
top. Always give the user the full path and the lines that create and enter it; beginners get lost on
"which folder":

```powershell
mkdir $env:USERPROFILE\OnFramerApps\my-widget    # "already exists" is fine
cd $env:USERPROFILE\OnFramerApps\my-widget
```

## 3. Start from this page

A transparent widget: one panel in the bottom-right corner, above every window, and clicks anywhere
else pass through to the desktop. Adapt it; keep the structure.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>My widget</title>                 <!-- tray tooltip and taskbar name -->
  <link rel="icon" href="data:,">           <!-- window/tray icon = favicon; data:, avoids a 404 -->
  <style>
    html, body { margin: 0; background: transparent; }        /* see-through window */
    .panel { position: fixed; bottom: 24px; right: 24px; padding: 16px 22px;
      background: rgba(20,22,30,.9); color: #fff; border-radius: 14px; font: 15px system-ui; }
  </style>
</head>
<body>
  <div class="panel ct-interactive">Hello from OnFramer</div>
  <script src="https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.18-beta/onframer.js"></script>
  <script>
    (async () => {
      try {                                   // OnFramer is missing in a normal browser
        const [m] = await OnFramer.monitorInfo();
        const r = m.rcWork;                   // work area (no taskbar), physical pixels
        await OnFramer.setPosition(r.left, r.top, r.right - r.left, r.bottom - r.top);
        await OnFramer.alwaysOnTop();
        await OnFramer.clickThroughRegions(".ct-interactive");  // only .ct-interactive catches clicks
      } catch (e) { console.warn("OnFramer:", e); }
    })();
  </script>
</body>
</html>
```

Why each piece is there:

| Piece | Reason |
|---|---|
| `background: transparent` | Transparency = this CSS + the window opened as `--widget` (`onframer-cli dev` does that). There is no transparency API or `--transparent` flag. |
| `setPosition` to `rcWork` | The window opens at 800×600 in the screen centre. A full-work-area window lets CSS place things in screen corners. |
| `clickThroughRegions` | Everything outside the `.ct-interactive` rectangles passes clicks to whatever is behind (desktop, other apps, taskbar), so a full-screen widget doesn't block the screen. Three levels: `setIgnoreMouseEvents(true)` (whole window), `clickThroughRegions(sel)` (rectangles of `sel` catch clicks), `clickThroughMask(sel)` (per pixel, for round shapes). |
| `try/catch` | Every `OnFramer.*` returns a Promise and throws outside OnFramer. |
| No close API | Close with `window.close()` from a button. |

## 4. Run it

```powershell
cd $env:USERPROFILE\OnFramerApps\my-widget
onframer-cli dev .
```

It serves the folder on `http://127.0.0.1:5178/`, opens it as a transparent `--widget` with DevTools
available, and reloads on every save. Keys in that PowerShell window: `r` reload, `d` DevTools (in the
browser), `q` quit. Closing that window stops the app, so the user edits files from a second window or
the editor. Options: `--framed` (normal window with a title bar), `--port N`, `--query "a=1"`,
`--keep-open` (keep serving after the window closes). All: `onframer-cli help`.

**A normal (non-transparent) app window:** give the page an opaque background and run it with
`onframer-cli dev . --framed`. Skip `setPosition`/`clickThroughRegions` unless you need them.

Do **not** run it as `file:///…/index.html` or by double-clicking: a `file://` page has no origin, and
the plugins (desktop-bridge, tray, notifications, storage) refuse it (WebSocket close code 4003).

## 5. Desktop features: desktop-bridge.js

Files, notifications, tray, global hotkeys, clipboard and app storage come from the Manager's
Desktop Bridge plugin. Load it after `onframer.js`:

```html
<script src="https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.18-beta/desktop-bridge.js"></script>
```

Pages served by `onframer-cli dev` (`http://127.0.0.1:…`) may connect by default. Calls reject with
"desktopBridge plugin not running" until the socket is up, so wait for it once:

```javascript
const db = DesktopBridge.connect();                       // reconnects by itself
const bridgeUp = new Promise((ok) => db.onStatus((up) => up && ok()));

// Settings that survive closing the app: the app's own JSON file in the user folder.
// widget: letters, digits, - and _ (max 64). data: an object of STRING values (JSON.stringify
// arrays/objects), up to 5 MB. Nothing saved yet → { savedAt: 0, data: {} }.
async function loadSettings() {
  try { await bridgeUp; return (await db.call("storageLoad", { widget: "Reloj" })).data; }
  catch (e) { return JSON.parse(localStorage.getItem("settings") || "{}"); }   // plain browser
}
async function saveSettings(data) {                       // saves the whole object each time
  localStorage.setItem("settings", JSON.stringify(data));
  try { await bridgeUp; await db.call("storageSave", { widget: "Reloj", data }); } catch (e) {}
}
// e.g. const s = await loadSettings(); const h24 = s.h24 !== "0"; … saveSettings({ h24: h24 ? "1" : "0" });

await db.call("notify", { app: "Reloj", title: "Done", body: "Saved" }).catch(() => {});
```

Tray icon plus a global hotkey that shows/hides the app (both need the OnFramer Manager running; the
installer starts it, it lives in the tray):

```javascript
try {
  await OnFramer.tray({                                   // icon = the page favicon
    tooltip: "Notas",
    onClick: () => OnFramer.restoreFromTray(),
    menu: [
      { id: "show", label: "Show", onClick: () => OnFramer.restoreFromTray() },
      { id: "hide", label: "Hide", onClick: () => OnFramer.minimizeToTray() },
      { id: "quit", label: "Quit", onClick: () => window.close() },
    ],
  });
} catch (e) { console.warn("no tray icon:", e); }

db.onStatus(async (up) => {                               // register again after every reconnect
  if (!up) return;
  const { failed } = await db.hotkeys(["ctrl+alt+n"]);    // ctrl/alt/shift/win + a-z, 0-9, f1-f24, space
  if (failed.length) console.warn("taken by another app:", failed);
});
let hidden = false;
db.on("hotkey", () => {
  hidden = !hidden;
  hidden ? OnFramer.minimizeToTray() : OnFramer.restoreFromTray();
});
```

Hotkeys work only while the page is open (released when it closes).

Use this desktopBridge storage for apps you build. `OnFramer.storage` is for widgets published in the
OnFramer gallery; don't use it for a user's own app. For everything else (`db.saveFile`, tray,
`db.hotkeys`, clipboard, media keys…) read the desktopBridge part of [reference.md](reference.md)
before writing the call: the exact names and arguments are there. Catch every call.

## 6. Running it every day (without `onframer-cli dev`)

`dev` is for building. For daily use, serve the folder with the Manager's webServer plugin and open
it from a shortcut:

1. Manager tray → Configuration → Open plugins folder → `webServer` → create `settings.json`:
   `{ "root": "C:\\Users\\<user>\\OnFramerApps\\notas", "port": 8088 }`
2. `onframer-cli plugins enable webServer` (if it was already on: `plugins disable webServer`, then
   `enable` again, so it reads the settings).
3. Open it: `onframer --url="http://127.0.0.1:8088/"` (add `--widget` for a transparent widget).
   Put that line in a shortcut, or in the Startup folder (`shell:startup`) to start with Windows.

One webServer serves one folder. There is no one-click installer for your own app yet; to share it,
zip the folder (OnFramer's custom build service makes branded installers).

## Gotchas that cost real users time

- Notepad can save `index.html.txt`. Check with `dir`; the file must be `index.html`.
- Save app data with desktopBridge storage, not only `localStorage`.
- Save files with `db.saveFile` (a Save-as dialog). Chromium's `showSaveFilePicker` can abort in a
  small widget.
- `monitorInfo()` and `setPosition()` use physical pixels on the virtual desktop. On a 150% screen
  CSS pixels differ; read the rects, don't hard-code sizes.
- A transparent page with nothing visible looks like "nothing happened". It is running; add a
  visible element or use `--framed` to see the window.
- `unmute` is lower-case (`unMute` doesn't exist).
- Tray icons appear under Windows 11's `^` hidden-icons arrow.
- Two `onframer.exe` with the same `--user-data-dir` share one process; give each its own folder.

## What to hand back to the user

1. The files written, with their full paths.
2. The exact PowerShell lines to run, starting with the `cd`.
3. What they should see, and how to stop it (`q` in the PowerShell window).
4. Anything you could not verify.
