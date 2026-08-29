const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SyncService } = require("./sync-service.cjs");

let mainWindow;
let localServer;
let dataWatcher;
let pendingSync;
let syncService;
let activeSyncPromise;

function applicationRoot() {
  return app.getAppPath();
}

function seedDataDirectory() {
  return app.isPackaged ? path.join(process.resourcesPath, "seed-data") : path.join(applicationRoot(), "data");
}

function publishStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("budget:status-changed", payload);
}

async function startLocalServer() {
  await syncService.ensureWorkspace();
  process.env.BUDGET_DATA_DIR = path.join(syncService.workspaceDir, "data");
  const { createServer } = require(path.join(applicationRoot(), "server.js"));
  localServer = createServer();
  await new Promise(function(resolve, reject) {
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", function() {
      localServer.off("error", reject);
      resolve();
    });
  });
  return localServer.address().port;
}

async function reloadApplicationData() {
  if (!localServer) return;
  await new Promise(function(resolve) {
    const request = require("node:http").request({
      hostname: "127.0.0.1",
      port: localServer.address().port,
      path: "/api/reload",
      method: "POST"
    }, function(response) { response.resume(); response.on("end", resolve); });
    request.on("error", resolve);
    request.end();
  });
}

function runSync() {
  // Пользовательский запуск и отложенная автосинхронизация используют один
  // Promise: второй вызов ожидает первый, а не создаёт конкурирующий HTTP-запрос.
  if (activeSyncPromise) return activeSyncPromise;
  const task = (async function() {
    publishStatus({ phase: "syncing", message: "Синхронизация с GitHub…" });
    try {
      const result = await syncService.sync();
      await reloadApplicationData();
      publishStatus({ phase: "success", message: result.message, status: result });
      return result;
    } catch (error) {
      const message = error && error.message ? error.message : "Не удалось синхронизировать данные.";
      publishStatus({ phase: "error", message: message });
      throw new Error(message);
    }
  }());
  activeSyncPromise = task;
  task.finally(function() {
    if (activeSyncPromise === task) activeSyncPromise = undefined;
  }).catch(function() {});
  return task;
}

function watchDataDirectory() {
  const dataDirectory = path.join(syncService.workspaceDir, "data");
  try {
    dataWatcher = fs.watch(dataDirectory, { recursive: true }, function() {
      syncService.markWorkspaceChanged().catch(function() {});
      clearTimeout(pendingSync);
      pendingSync = setTimeout(async function() {
        const status = await syncService.getStatus();
        if (!status.configured) return;
        try { await runSync(); } catch (error) { /* The visible status contains the actionable error. */ }
      }, 1800);
    });
  } catch (error) {
    publishStatus({ phase: "error", message: "Автосинхронизация недоступна: " + error.message });
  }
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once("ready-to-show", function() { mainWindow.show(); });
  mainWindow.loadURL("http://127.0.0.1:" + port);
}

function configureService() {
  const appData = app.getPath("userData");
  syncService = new SyncService({
    workspaceDir: path.join(appData, "repository"),
    seedDataDir: seedDataDirectory(),
    configPath: path.join(appData, "sync.json"),
    deviceName: os.hostname(),
    encrypt: function(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно.");
      return safeStorage.encryptString(value).toString("base64");
    },
    decrypt: function(value) { return safeStorage.decryptString(Buffer.from(value, "base64")); },
    onStatus: publishStatus
  });
}

ipcMain.handle("budget:status", function() { return syncService.getStatus(); });
ipcMain.handle("budget:configure", async function(_event, settings) {
  publishStatus({ phase: "connecting", message: "Сохраняем параметры подключения…" });
  try {
    const status = await syncService.configure(settings || {});
    publishStatus({ phase: "configured", message: "Репозиторий GitHub подключён.", status: status });
    return status;
  } catch (error) {
    const message = error && error.message ? error.message : "Не удалось подключить GitHub.";
    publishStatus({ phase: "error", message: message });
    throw new Error(message);
  }
});
ipcMain.handle("budget:sync", function() { return runSync(); });

app.setAppUserModelId("ru.budget.desktop");
app.whenReady().then(async function() {
  configureService();
  const port = await startLocalServer();
  watchDataDirectory();
  createWindow(port);
}).catch(function(error) {
  // Electron will show the error in its standard console if the local service cannot start.
  console.error(error);
  app.quit();
});

app.on("window-all-closed", function() { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", function() {
  clearTimeout(pendingSync);
  if (dataWatcher) dataWatcher.close();
  if (localServer) localServer.close();
});
