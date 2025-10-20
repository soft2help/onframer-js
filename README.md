# 🎬 OnFramer-JS

Welcome to the **OnFramer-JS** repository!

This repository contains the essential JavaScript files and examples to help developers control and enhance their OnFramer desktop applications using familiar web technologies.

---

## 📘 About

**OnFramer-JS** provides a set of JavaScript tools and utilities specifically designed for use with the OnFramer framework. With these scripts, you can manage window behavior, control transparency, and take advantage of multi-monitor setups—all directly from your web project.

---

## ✨ Features

- **🪟 Window Management:** Easily open, close, minimize, maximize, and move windows using JavaScript.
- **🔍 Transparency Control:** Adjust window opacity dynamically to create sleek, modern interfaces.
- **🖥️ Multi-Monitor Support:** Seamlessly manage and position windows across multiple monitors.
- **🌐 Remote Control via WebSockets:** Interact with and control your application remotely in real-time.

---

## 📥 Install

More information available at: [https://onframer.io/releases](https://onframer.io/releases)

---

## 📦 onframer-utils

Onframer-utils.js is an utility module designed to work with OnFramer, adding functions for mapping, positioning among others.

> **Important**: This module requires [onframer.js](https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.0-beta/onframer.js).
> Make sure to include it in your file before using `onframer-utils`:
>
> ```js
> <script src="https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.0-beta/onframer.js"></script>
> ```

All utilities are accessible via the **ofScreens** global object:

```
ofScreens.onGrid(...);
ofScreens.position.mapMonitorScales();
...
```

---

## 🔧 Main Utilities

### 📐 onGrid(nScreen, col, row, adapteSize, nCols?, nRows?)

Positions the current window on a specific grid cell on a selected monitor.

Parameters (nScreen, col, row, adapteSize, nCols?, nRows?)

- `nScreen` (Number): Monitor index (1-based).
- `col`, `row` (Number): Grid cell position.
- `adapteSize` (Boolean): Whether to resize the window to the cell size.
- `nCols`, `nRows` (Number, optional): Number of columns/rows to initialize the grid (optional if previously initialized).

**Example**:

```
ofScreens.onGrid(1, 2, 2, true, 3, 3);
```

---

### 🖥️ mapMonitorScales()

Maps scale factors and screen info for all monitors.

- Measures each monitor using a temporary 3x3 grid.
- Populates **ofScreens.infoScreens** with:
  - monitorScale (device pixel ratio)
  - Native screen object
- Restores original grid after scanning.

Used to improve positioning accuracy on screens with different scale factors.

---

### 🔗 fromUrl()

Parses window positioning from the URL query string.

- Reads the `ofpos` parameter in the following format:

  `3x3_1-2-2-1` → (Cols x Rows)\_(Screen-Col-Row-AdapteSize)

- Calls `onGrid(...)` with parsed values.

**Example**:

```
onframer --url="http://localhost:8383/examples/Menu?ofpos=3x3_1-2-2-1" --widget --dev
```

Parses to:

- Grid: 3 columns × 3 rows

- Monitor: 1

- Cell: Column 2, Row 2

- Resize: true

---

## 🧭 Function Map

```
ofScreens
├─ onGrid()
├─ init()
├─ infoScreens
├─ mappedPoints
├─ position
│   ├─ mapMonitorScales()
│   ├─ getCellBounds()
│   ├─ sendAdjusted()
│   ├─ current()
│   └─ currentSize()
├─ onFramer
│   └─ getInfo()
├─ setup
│   ├─ initTable()
│   ├─ init()
│   ├─ getTopLeftBottomRight()
│   ├─ getSizeMaxArea()
│   ├─ getMappedPoints()
│   ├─ drawScreens()
│   └─ makeGrid()
└─ url
    ├─ getQueryParam()
    ├─ parseDataParam()
    └─ fromUrl()
```
