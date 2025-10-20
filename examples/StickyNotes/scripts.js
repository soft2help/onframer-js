var createBox = document.getElementsByClassName("createBox")[0];
var notes = document.getElementsByClassName("notes")[0];
var input = document.getElementById("user-input");
var i = 0;


function color(){
    var random_colors = ["#c2ff3d","#ff3de8","#3dc2ff","#04e022","#bc83e6","#ebb328"];
    if(i > random_colors.length - 1){
        i = 0;
    }
    return random_colors[i++];
}

createBox.addEventListener('keydown', content);

function content(e){
    if(e.keyCode == '13'){
        divStyle(input.value);
        input.value="";
        createBox.style.display = "none";
    }
}

document.getElementById("create").addEventListener("click", function(){
    createBox.style.display = "block";
});

function divStyle(text){
    var div = document.createElement("div");
    div.className = 'note';
    div.innerHTML = '<div class="details">' +
        '<div>' + text.replace(/\n/g, "<br>") + '</div>' +
        '</div>';

    div.setAttribute('style', 'background:' + color());

    notes.appendChild(div);

    div.addEventListener("dblclick", function(){
        div.remove();
    });
}


function fullScreenTransparent(){
    OnFramer.sendMessage("Fullscreen").then(function () {
        document.body.style.backgroundColor = "transparent";
    });
}

function setAlwaysOnTop(){
    OnFramer.sendMessage("AlwaysOnTop");
}

document.addEventListener("DOMContentLoaded", function () {
    // fullScreenTransparent();
    // setAlwaysOnTop();

    OnFramer.sendMessage("MonitorInfo")
        .then((monitors) => {
            const targetScreenIndex = 1;
            // If there's no more than one monitor
            if (!monitors[targetScreenIndex]) {
                console.warn(`Monitor ${targetScreenIndex} not found. Defaulting to monitor 0.`);
                targetScreenIndex = 0;
			}
            
            const screen = monitors[targetScreenIndex];

            if (!screen || screen["rcWork.left"] === undefined) {
                throw new Error(`Screen index ${targetScreenIndex} is invalid or missing rcWork fields`);
            }

            const left = screen["rcWork.left"];
            const top = screen["rcWork.top"];
            const width = screen["rcWork.right"] - screen["rcWork.left"];
            const height = screen["rcWork.bottom"] - screen["rcWork.top"];

            OnFramer.sendMessage("Position", `${left},${top},${width},${height}`);
        })
        .catch((error) => {
            console.error("Could not load monitor info:", error);
        });
});