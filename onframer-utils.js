if (typeof OnFramer === "undefined"){
    throw new Error ("onframer.js not loaded. Source this file: https://cdn.jsdelivr.net/gh/soft2help/onframer-js@v1.0.0-beta/onframer.js");
}

let ofScreens = {
    nScreens: null,
    infoScreens: null,
    minTop: 0,
    minLeft: 0,
    maxBottom: 0,
    maxRight: 0,
    widthAvailable: null,
    ratio: null,
    heightAvailable: null,
    mappedPoints: null,
    alreadyGetInfoScreen: false,
    infoMonitorsStarted: false,
    nCols: undefined,
    nRows: undefined,
    matrix: [],
    mappedMonitor: [],
    previousScale: null,
    onGrid: async (nScreen, col, row, adapteSize, nCols = undefined, nRows = undefined) => {
        let _this = ofScreens;

        nScreen = nScreen - 1;

        if (((nCols === undefined || nRows === undefined) && _this.nCols === undefined))
            throw new Error("You should set an initial value for columns and rows");

        if (Number.isInteger(nCols) && Number.isInteger(nRows))
            await _this.init(nCols, nRows);

        if (nScreen < 0 || nScreen > ofScreens.infoScreens.length || col < 0 || row < 0 || col > _this.nCols || row > _this.nRows)
            throw new Error("Invalid Paramenter");


        let monitorMatrix = _this.matrix[nScreen];
        if (!monitorMatrix)
            throw new Error("Monitor matrix not found for the specified screen");

        let cell = monitorMatrix.find(c => c.row === row - 1 && c.col === col - 1);

        let left = cell.left;
        let top = cell.top;
        let width = adapteSize ? parseInt(cell.width) : parseInt(window.innerWidth);
        let height = adapteSize ? parseInt(cell.height) : parseInt(window.innerHeight);

        // Grid cells are in physical (device) pixels — the same units as
        // MonitorInfo and the native Position handler (SetWindowPos), which does
        // not clamp to a display. A single send moves + resizes the window to the
        // target cell on any monitor.
        console.log(`onGrid screen ${nScreen}: ${left},${top} ${width}x${height}`);
        await OnFramer.sendMessage("Position", `${left},${top},${width},${height}`);
    },
    init: async (nCols, nRows) => {
        let _this = ofScreens;
        _this.setup.initTable(nCols, nRows);
        if (!_this.infoMonitorsStarted) {
            _this.infoMonitorsStarted = true;
            await _this.onFramer.getInfo();
            _this.setup.init();
            _this.url.fromUrl();
        } else {
            _this.setup.init();
        }
    },
    onFramer: {
        getInfo: () => {
            let _this = ofScreens;

            return new Promise((resolve, reject) => {
                OnFramer.sendMessage("MonitorInfo")
                    .then((monitors) => {
                        _this.nScreens = monitors.length;
                        _this.infoScreens = monitors;
                        resolve();
                    })
                    .catch((error) => {
                        console.error("Failed to send message:", error);
                        reject();
                    });
            });
        }
    },
    setup: {
        initTable: (nCols, nRows) => {
            if (Number.isNaN(nCols) || nCols < 1) nCols = 1;
            if (Number.isNaN(nRows) || nRows < 1) nRows = 1;

            if (nCols > 100) nCols = 100;
            if (nRows > 100) nRows = 100;

            ofScreens.nCols = nCols;
            ofScreens.nRows = nRows;
        },
        init: () => {
            let _this = ofScreens;
            _this.setup.getTopLeftBottomRight();
            _this.setup.getSizeMaxArea();
            _this.setup.getMappedPoints();
            _this.setup.drawScreens();
            _this.setup.makeGrid();
        },
        getTopLeftBottomRight: () => {
            let _this = ofScreens;
            _this.infoScreens.forEach(function (monitor) {
                let top = parseInt(monitor["rcWork.top"]);
                let left = parseInt(monitor["rcWork.left"]);
                let right = parseInt(monitor["rcWork.right"]);
                let bottom = parseInt(monitor["rcWork.bottom"]);

                if (_this.minTop > top) _this.minTop = top;

                if (_this.minLeft > left) _this.minLeft = left;

                if (_this.maxBottom < bottom) _this.maxBottom = bottom;

                if (_this.maxRight < right) _this.maxRight = right;
            });
        },
        getSizeMaxArea: (widthArea = 500) => {
            let _this = ofScreens;
            _this.widthAvailable = widthArea;

            let width = _this.maxRight - _this.minLeft;
            let height = _this.maxBottom - _this.minTop;

            _this.ratio = _this.widthAvailable / width;

            _this.heightAvailable = (height + 100) * _this.ratio;
        },
        getMappedPoints: () => {
            let _this = ofScreens;
            _this.mappedPoints = [];
            _this.infoScreens.forEach(function (monitor, index) {
                let top = parseInt(monitor["rcWork.top"]);
                let left = parseInt(monitor["rcWork.left"]);
                let right = parseInt(monitor["rcWork.right"]);
                let bottom = parseInt(monitor["rcWork.bottom"]);

                let pointWidth = (right - left) * _this.ratio - 2;
                let pointHeight = (bottom - top) * _this.ratio - 2;

                let mapTop = Math.abs(top - _this.minTop) * _this.ratio;
                let mapLeft = Math.abs(left - _this.minLeft) * _this.ratio;

                _this.mappedPoints.push({
                    top: mapTop,
                    left: mapLeft,
                    width: pointWidth,
                    height: pointHeight,
                });
            });
        },
        drawScreens: () => {
            let _this = ofScreens;
            _this.mappedMonitor = [];

            _this.mappedPoints.forEach((point, index) => {
                let originalTop = parseInt(_this.infoScreens[index]["rcWork.top"]);
                let originalLeft = parseInt(
                    _this.infoScreens[index]["rcWork.left"]
                );
                let originalRight = parseInt(
                    _this.infoScreens[index]["rcWork.right"]
                );
                let originalBottom = parseInt(
                    _this.infoScreens[index]["rcWork.bottom"]
                );

                let originalWidth = originalRight - originalLeft;
                let originalHeight = originalBottom - originalTop;

                let infoMonitor = {
                    originalTop,
                    originalLeft,
                    originalRight,
                    originalBottom,
                    originalWidth,
                    originalHeight,
                };

                _this.mappedMonitor.push(infoMonitor);
            });
        },
        makeGrid: () => {
            let _this = ofScreens;
            _this.matrix = [];
            _this.mappedMonitor.forEach(function (monitor, index) {
                let width = _this.mappedPoints[index].width;
                let height = _this.mappedPoints[index].height;

                let originalWidth = parseInt(monitor.originalWidth);
                let originalHeight = parseInt(monitor.originalHeight);

                let cellOriginalWidth = originalWidth / _this.nCols;
                let cellOriginalHeight = originalHeight / _this.nRows;

                let cellWidth = width / _this.nCols;
                let cellHeight = height / _this.nRows;

                let top = 0;
                let left = 0;

                let originalTopScreen = parseInt(monitor.originalTop);
                let originalLeftScreen = parseInt(monitor.originalLeft);
                let monitorMatrix = []
                for (var row = 0; row < _this.nRows; row++) {
                    top = row * cellHeight;
                    let originalTop = parseInt(
                        originalTopScreen + row * cellOriginalHeight
                    );
                    for (var col = 0; col < _this.nCols; col++) {
                        left = col * cellWidth;
                        let originalLeft = parseInt(
                            originalLeftScreen + col * cellOriginalWidth
                        );

                        monitorMatrix.push({
                            row: row,
                            col: col,
                            top: originalTop,
                            left: originalLeft,
                            width: cellOriginalWidth,
                            height: cellOriginalHeight
                        });
                    }
                }
                _this.matrix.push(monitorMatrix);
            });
        }
    },
    url: {
        getQueryParam(param) {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get(param);
        },
        parseDataParam(data) {
            try {
                // Split the data into the two main parts
                const [gridPart, screenPart] = data.split("_");
                if (!gridPart || !screenPart) throw new Error("Invalid format");

                // Extract cols and rows
                const [cols, rows] = gridPart.split("x").map(Number);
                if (isNaN(cols) || isNaN(rows))
                    throw new Error("Invalid cols or rows");

                // Extract nscreen, col, row, and adapteSize
                const [nscreen, col, row, adapteSize] = screenPart
                    .split("-")
                    .map(Number);
                if ([nscreen, col, row, adapteSize].some(isNaN))
                    throw new Error("Invalid screen/col/row/adapteSize");

                // Return an object with the parsed values
                return {
                    cols,
                    rows,
                    nscreen,
                    col,
                    row,
                    adapteSize,
                };
            } catch (error) {
                console.error("Error parsing data parameter:", error.message);
                return null; // or you can return a default object or handle it accordingly
            }
        },
        fromUrl: function () {
            // Example usage
            const dataParam = ofScreens.url.getQueryParam("ofpos");
            if (!dataParam) {
                return;
            }

            const positionInfo = ofScreens.url.parseDataParam(dataParam);
            if (!positionInfo) {
                console.error("Data parameter is not in the correct format");
                return;
            }
            let _this = this;
            console.log(positionInfo);
            // Access individual values
            console.log("Cols:", positionInfo.cols);
            console.log("Rows:", positionInfo.rows);
            console.log("Nscreen:", positionInfo.nscreen);
            console.log("Col:", positionInfo.col);
            console.log("Row:", positionInfo.row);
            console.log("AdapteSize:", positionInfo.adapteSize);
            ofScreens.onGrid(positionInfo.nscreen, positionInfo.col, positionInfo.row, positionInfo.adapteSize, positionInfo.cols, positionInfo.rows);
        }
    },
    position: {
        mapMonitorScales: async (adapteSize = true) => {

            const originalCols = ofScreens.nCols;
            const originalRows = ofScreens.nRows;

            const tempCols = 3;
            const tempRows = 3;
            await ofScreens.init(tempCols, tempRows);
            await ofScreens.onFramer.getInfo();

            const nScreens = ofScreens.infoScreens.length;

            for (let nscreen = 1; nscreen <= nScreens; nscreen++) {
                const row = 2
                const col = 2

                await ofScreens.onGrid(nscreen, col, row, adapteSize, tempCols, tempRows);
                ofScreens.infoScreens[nscreen - 1]["monitorScale"] = window.devicePixelRatio;
                ofScreens.infoScreens[nscreen - 1]["screen"] = window.screen;
            }

            await ofScreens.init(originalCols, originalRows);

        },
        getCellBounds: (scale, nscreen, col, row, adapteSize = false) => {
            let _this= ofScreens;
            let leftChanged = null;
            let topChanged = null;
            let widthChanged = null;
            let heightChanged = null;

            if (scale == 1) {
                return { leftChanged, topChanged, widthChanged, heightChanged };
            }

            let infoDesiredMonitor = ofScreens.infoScreens[nscreen];
            console.log(infoDesiredMonitor);

            // Define the monitor rectangle (logical pixels)
            let mLeft = window.screen.availLeft;
            let mTop = window.screen.availTop;
            let workW = window.screen.availWidth;
            let workH = window.screen.availHeight;

            // Determinate the cell size
            const cellW = (workW) / _this.nCols;
            const cellH = (workH) / _this.nRows;

            const contentW = adapteSize ? cellW : window.innerWidth;
            const contentH = adapteSize ? cellH : window.innerHeight;

            // Compute the top-left corner of the cell in device pixels
            leftChanged = parseInt(mLeft + (cellW * (col - 1)))
            topChanged = parseInt((mTop + (cellH * (row - 1))))

            // Adjust content size for device pixel scale
            widthChanged = Math.round(contentW);
            heightChanged = Math.round(contentH);

            return { leftChanged, topChanged, widthChanged, heightChanged };
        },
        sendAdjusted: async (bounds, nScreen) => {
            const { leftChanged, topChanged, widthChanged, heightChanged } = bounds;
            
            if (leftChanged != null) {
                await OnFramer.sendMessage("Position", `${leftChanged},${topChanged},${widthChanged},${heightChanged}`);
                console.log(`Readjusting position for screen ${nScreen}: left=${leftChanged}, top=${topChanged}, width=${widthChanged}, height=${heightChanged}`);
            }
        },
        current: () => {
            return {
                top: window.screenLeft,
                left: window.screenTop,
            };
        },
        currentSize() {
            return {
                width: window.innerWidth,
                height: window.innerHeight,
            };
        }
    }
};

