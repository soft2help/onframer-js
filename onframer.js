/*!
 * Project Name: OnFramer
 * Description: This file serves as a bridge between JavaScript and Onframer (CEF), enabling control over window behavior.
 *
 * @version 1.0.0-beta
 * @date 2024-08-01
 * @license MIT
 * @author Luis Fernandes
 *
 * Changelog:
 * - v1.0.0-beta: Initial release.
 *
 * Usage:
 * Place it in your web project in javascript files section.
 */

let OnFramer = {
  sendMessage: function (name, params) {
    //console.log(`send message: ${name}`);
    var message = "Window." + name;
    if (typeof params !== "undefined") {
      message += ":" + params;
    }

    return new Promise((resolve, reject) => {
      try {
        window.cefQuery({
          request: message,
          onSuccess: function (response) {
            if (response !== "") {
              response = JSON.parse(response);
            }
            resolve(response);
          },
          onFailure: function (error_code, error_message) {
            let fail = {
              error_code: error_code,
              error_message: error_message,
            };
            reject(fail);
          },
        });
      } catch (err) {
        reject(
          "Onframer is not available. Load current page with onframer application. More info in https://onframer.io"
        );
      }
    });
  },
  setPosition: (left, top, width, height) => {
    return OnFramer.sendMessage(
      "Position",
      `${left},${top},${width},${height}`
    );
  },
  monitorInfo: () => {
    return OnFramer.sendMessage("MonitorInfo");
  },
  maximize: () => {
    return OnFramer.sendMessage("Maximize");
  },
  minimize: () => {
    return OnFramer.sendMessage("Minimize");
  },
  isMinimized: () => {
    return OnFramer.sendMessage("IsMinimized");
  },
  restore: () => {
    return OnFramer.sendMessage("Restore");
  },
  fullscreen: () => {
    return OnFramer.sendMessage("Fullscreen");
  },
  exitFullscreen: () => {
    return OnFramer.sendMessage("ExitFullscreen");
  },
  alwaysOnTop: () => {
    return OnFramer.sendMessage("AlwaysOnTop");
  },
  notAlwaysOnTop: () => {
    return OnFramer.sendMessage("NotAlwaysOnTop");
  },
  mute: () => {
    return OnFramer.sendMessage("Mute");
  },
  unmute: () => {
    return OnFramer.sendMessage("UnMute");
  },
};
