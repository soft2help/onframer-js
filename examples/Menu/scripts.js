function setAlwaysOnTop() {
    OnFramer.sendMessage("AlwaysOnTop");
}

const scrollContainer = document.querySelector(".scroll-container");

let isDragging = false;
let startX = 0;
let dragThreshold = 5;

function setAppRegion(element, value) {
element.style.webkitAppRegion = value;
Array.from(element.children).forEach(child => setAppRegion(child, value));
}

function beginDrag() {
isDragging = true;
scrollContainer.style.animationPlayState = 'paused';
setAppRegion(scrollContainer, 'drag');
console.log("Begin dragging")
}

function endDrag() {
if (!isDragging) return;
isDragging = false;
scrollContainer.style.animationPlayState = 'running';
setAppRegion(scrollContainer, 'no-drag');
console.log("End dragging")
}

function onMouseMove(e) {
if (!isDragging && Math.abs(e.clientX - startX) > dragThreshold) {
    beginDrag();
}
}

function onMouseUp() {
endDrag();
window.removeEventListener('mousemove', onMouseMove);
window.removeEventListener('mouseup', onMouseUp);
window.removeEventListener('mouseleave', onMouseUp);
window.removeEventListener('blur', onMouseUp);
}

scrollContainer.addEventListener('mousedown', e => {
startX = e.clientX;
isDragging = false;
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);
window.addEventListener('mouseleave', onMouseUp);
window.addEventListener('blur', onMouseUp);
});


document.addEventListener("DOMContentLoaded", function () {
setAlwaysOnTop();
setAppRegion(scrollContainer, 'no-drag');
scrollContainer.style.animationPlayState = 'running';

app
    .getInfo()
    .then(() => {
    const targetScreenIndex = 1;
    const screen = app.infoScreens[targetScreenIndex];

    if (!screen || screen["rcMonitor.left"] === undefined) {
        throw new Error(
        `Screen index ${targetScreenIndex} is invalid or missing rcMonitor fields`
        );
    }

    const left = screen["rcMonitor.left"];
    const width = screen["rcMonitor.right"] - screen["rcMonitor.left"];
    const screenHeight =
        screen["rcMonitor.bottom"] - screen["rcMonitor.top"];
    const height = 400;
    const top = screen["rcMonitor.top"] + (screenHeight - height) / 2;

    OnFramer.sendMessage("Position", `${left},${top},${width},${height}`);

    const container = document.querySelector(".scroll-container");
    const totalWidth = container.scrollWidth;

    container.style.setProperty("--scroll-distance", `-${totalWidth}px`);
    container.style.setProperty("--scroll-duration", `${Math.max(10, totalWidth / 50)}s`);

    // Now clone images enough times to fill the scroll container
    const photoItems = Array.from(scrollContainer.children);

    const singleSetWidth = photoItems.length * (120 + 20); // 120px image height/width + 20px margin (10px each side)
    const clonesNeeded = Math.ceil(width / singleSetWidth + 2);

    while (scrollContainer.children.length > photoItems.length) {
        scrollContainer.removeChild(scrollContainer.lastChild);
    }

    for (let i = 1; i <= clonesNeeded; i++) {
        photoItems.forEach((item) => {
        const clone = item.cloneNode(true);
        scrollContainer.appendChild(clone);
        });
    }
    })
    .catch((error) => {
    console.error("Could not load monitor info:", error);
    });
});