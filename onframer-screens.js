const app = {
    nScreens: 0,
    infoScreens: [],
    minTop: Infinity,
    minLeft: Infinity,
    maxRight: -Infinity,
    maxBottom: -Infinity,

    getInfo: function () {
        let _this = this;

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
    },
    getTopLeftBottomRight: function () {
        let _this = this;
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
};

var infoMonitorsStarted = false;

let infoMonitors = {
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
    mappedMonitor: [],
    init: function () {
        let _this = this;
        if (!infoMonitorsStarted) {
        infoMonitorsStarted = true;
        _this.events();
        _this.getInfo().then(() => {
            _this.getTopLeftBottomRight();
            _this.draw();
            _this.fromUrl();
        });
        } else {
        _this.getTopLeftBottomRight();
        _this.draw();
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
    },
    fromUrl: function () {
        // Example usage
        const dataParam = infoMonitors.url.getQueryParam("ofpos");
        if (!dataParam) {
        return;
        }

        const positionInfo = infoMonitors.url.parseDataParam(dataParam);
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

        toolbar.controls.setGridPosition(positionInfo.cols, positionInfo.rows, positionInfo.nscreen, positionInfo.col, positionInfo.row, positionInfo.adapteSize);
    },
    actualPosition() {
        return {
        top: window.screenLeft,
        left: window.screenTop,
        };
    },
    actualSize() {
        return {
        width: window.innerWidth,
        height: window.innerHeight,
        };
    },

    events: function () {
        let _this = this;

        const nColsInput = document.querySelector(".settings #nCols");
        const nRowsInput = document.querySelector(".settings #nRows");

        function onSizeChange() {
        let nCols = parseInt(nColsInput.value);
        let nRows = parseInt(nRowsInput.value);

        if (Number.isNaN(nCols) || nCols < 1) nCols = 1;
        if (Number.isNaN(nRows) || nRows < 1) nRows = 1;

        if (nCols > 100) nCols = 100;
        if (nRows > 100) nRows = 100;

        nColsInput.value = nCols;
        nRowsInput.value = nRows;

        _this.draw();
        }

        nColsInput.addEventListener("change", onSizeChange);
        nRowsInput.addEventListener("change", onSizeChange);

        document.addEventListener("click", function (event) {
        const target = event.target.closest(".monitor .cell");
        if (!target) return;

        const top = target.dataset.originalTop;
        const left = target.dataset.originalLeft;

        let width = window.innerWidth;
        let height = window.innerHeight;

        const changeSizeCheckbox = document.querySelector(
            ".settings #changeSizeWindow"
        );
        if (changeSizeCheckbox && changeSizeCheckbox.checked) {
            width = target.dataset.originalWidth;
            height = target.dataset.originalHeight;
        }

        width = parseInt(width);
        height = parseInt(height);

        OnFramer.sendMessage(
            "Position",
            `${left},${top},${width},${height}`
        );
        });
    },

    draw: function (nCols, nRows) {
        let _this = this;
        _this.getSizeMaxArea();
        _this.getMappedPoints();
        _this.drawScreens();

        if (Number.isNaN(nCols) || nCols < 1) nCols = 1;

        if (Number.isNaN(nRows) || nRows < 1) nCols = 1;

        if (nCols > 100) nCols = 100;

        if (nRows > 100) nRows = 100;

        _this.makeGrid(nCols, nRows);
    },
    drawScreens: function () {
        const container = document.querySelector(".monitorInfo");
        container.innerHTML = "&nbsp;";

        let _this = this;
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
    makeGrid: function (nCols, nRows) {
        let _this = this;
        document
        .querySelectorAll(".monitorInfo .monitor")
        .forEach((monitor, index) => {
            let rect = monitor.getBoundingClientRect();
            let width = rect.width;
            let height = rect.height;

            let original = _this.mappedMonitor[index];
            let originalWidth = original.originalWidth;
            let originalHeight = original.originalHeight;
            let originalTopScreen = original.originalTop;
            let originalLeftScreen = original.originalLeft;

            let cellOriginalWidth = originalWidth / nCols;
            let cellOriginalHeight = originalHeight / nRows;
            let cellWidth = width / nCols - nCols * 0.1;
            let cellHeight = height / nRows - nRows * 0.1;

            let grid = "";

            for (let row = 0; row < nRows; row++) {
            let top = row * cellHeight;
            let originalTop = Math.round(
                originalTopScreen + row * cellOriginalHeight
            );

            for (let col = 0; col < nCols; col++) {
                let left = col * cellWidth;
                let originalLeft = Math.round(
                originalLeftScreen + col * cellOriginalWidth
                );

                let border = "";
                if (row !== nRows - 1)
                border += `border-bottom: 1px dashed white;`;
                if (col !== nCols - 1)
                border += `border-right: 1px dashed white;`;

                grid += `
                    <div class="cell screen-${index + 1} pos-${col + 1}-${
                row + 1
                }"
                        data-original-top="${originalTop}" 
                        data-original-left="${originalLeft}"
                        data-original-width="${cellOriginalWidth}" 
                        data-original-height="${cellOriginalHeight}" 
                        style="
                            top: ${top}px;
                            left: ${left}px;
                            width: ${cellWidth}px;
                            height: ${cellHeight}px;
                            ${border}
                        ">&nbsp;${col + 1}-${row + 1}</div>
                `;
            }
            }

            const gridWrapper = document.createElement("div");
            gridWrapper.className = "grid";
            gridWrapper.innerHTML = grid;

            monitor.innerHTML = "";
            monitor.appendChild(gridWrapper);
        });
    },
    getMappedPoints: function () {
        let _this = this;
        _this.mappedPoints = [];
        $.each(_this.infoScreens, function (index, monitor) {
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
    getSizeMaxArea: function () {
        let _this = this;
        const monitorInfoElem = document.querySelector(".monitorInfo");

        _this.widthAvailable =
        monitorInfoElem.getBoundingClientRect().width - 10;

        let width = _this.maxRight - _this.minLeft;
        let height = _this.maxBottom - _this.minTop;

        _this.ratio = _this.widthAvailable / width;

        _this.heightAvailable = (height + 100) * _this.ratio;
    },
    getTopLeftBottomRight: function () {
        let _this = this;
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
    getInfo: function () {
        let _this = this;

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
    },
};