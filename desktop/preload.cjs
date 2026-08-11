const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("budgetDesktop", {
  getStatus: function() { return ipcRenderer.invoke("budget:status"); },
  configure: function(settings) { return ipcRenderer.invoke("budget:configure", settings); },
  sync: function() { return ipcRenderer.invoke("budget:sync"); },
  onStatus: function(callback) {
    const listener = function(_event, payload) { callback(payload); };
    ipcRenderer.on("budget:status-changed", listener);
    return function() { ipcRenderer.removeListener("budget:status-changed", listener); };
  }
});
