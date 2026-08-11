const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");

const DATA_FILE_PATTERN = /\.(json|sqlite)$/i;
const HTTP_TIMEOUT_MS = 60000;
const HTTP_MAX_ATTEMPTS = 3;

function exists(filename) {
  return fsPromises.access(filename).then(function() { return true; }).catch(function() { return false; });
}

function normaliseRemoteUrl(value) {
  const url = String(value || "").trim().replace(/\/$/, "");
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(url)) {
    throw new Error("Укажите HTTPS-адрес репозитория GitHub, например https://github.com/owner/Budget.git.");
  }
  return url.endsWith(".git") ? url : url + ".git";
}

async function listFiles(root, relative) {
  const directory = path.join(root, relative || "");
  const entries = await fsPromises.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative || "", entry.name);
    if (entry.isDirectory()) files.push.apply(files, await listFiles(root, child));
    else if (DATA_FILE_PATTERN.test(entry.name)) files.push(child.split(path.sep).join("/"));
  }
  return files;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class SyncService {
  constructor(options) {
    this.workspaceDir = options.workspaceDir;
    this.seedDataDir = options.seedDataDir;
    this.configPath = options.configPath;
    this.deviceName = options.deviceName || "Windows";
    this.encrypt = options.encrypt;
    this.decrypt = options.decrypt;
    this.onStatus = options.onStatus || function() {};
    this.syncing = false;
    this.httpAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
  }

  notify(phase, message) {
    this.onStatus({ phase: phase, message: message });
  }

  async loadConfig() {
    try {
      const raw = await fsPromises.readFile(this.configPath, "utf8");
      return Object.assign({ remoteUrl: "", token: "", lastSyncAt: "", branch: "main", seeded: true }, JSON.parse(raw));
    } catch (error) {
      if (error.code === "ENOENT") return { remoteUrl: "", token: "", lastSyncAt: "", branch: "main", seeded: true };
      throw new Error("Не удалось прочитать параметры синхронизации: " + error.message);
    }
  }

  async saveConfig(config) {
    await fsPromises.mkdir(path.dirname(this.configPath), { recursive: true });
    const filename = this.configPath + ".tmp";
    await fsPromises.writeFile(filename, JSON.stringify(config, null, 2), "utf8");
    await fsPromises.rename(filename, this.configPath);
  }

  async ensureWorkspace() {
    const dataDir = path.join(this.workspaceDir, "data");
    if (await exists(path.join(dataDir, "model-snapshot.json"))) return;
    await fsPromises.mkdir(this.workspaceDir, { recursive: true });
    await fsPromises.cp(this.seedDataDir, dataDir, { recursive: true, force: false });
    await fsPromises.writeFile(path.join(this.workspaceDir, ".budget-seed.json"), JSON.stringify({ createdAt: new Date().toISOString() }), "utf8");
  }

  async loadGit() {
    try {
      const nodeHttp = require("isomorphic-git/http/node");
      const requestWithRetry = async (request, attempt) => {
        const currentAttempt = attempt || 1;
        try {
          return await nodeHttp.request(Object.assign({}, request, {
            agent: this.httpAgent,
            fetchOptions: Object.assign({}, request.fetchOptions || {}, { timeout: HTTP_TIMEOUT_MS })
          }));
        } catch (error) {
          const code = String(error && error.code || "");
          const transient = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH/.test(code)
            || /timed out|socket hang up/i.test(String(error && error.message || ""));
          if (!transient || currentAttempt >= HTTP_MAX_ATTEMPTS) {
            if (transient) throw new Error("Не удалось установить соединение с GitHub после " + HTTP_MAX_ATTEMPTS + " попыток: " + error.message);
            throw error;
          }
          this.notify("retrying", "Соединение с GitHub прервано. Повторяем попытку " + (currentAttempt + 1) + " из " + HTTP_MAX_ATTEMPTS + "…");
          await new Promise(function(resolve) { setTimeout(resolve, currentAttempt * 1000); });
          return requestWithRetry(request, currentAttempt + 1);
        }
      };
      return {
        git: require("isomorphic-git"),
        http: {
          request: requestWithRetry
        }
      };
    } catch (error) {
      throw new Error("Компонент синхронизации не установлен. Переустановите приложение Budget.");
    }
  }

  async authentication(config) {
    if (!config.token) throw new Error("Для синхронизации укажите персональный токен GitHub с правами записи в репозиторий.");
    let token;
    try {
      token = this.decrypt(config.token);
    } catch (error) {
      throw new Error("Не удалось расшифровать токен GitHub. Введите его заново.");
    }
    return function() { return { username: "x-access-token", password: token }; };
  }

  async getStatus() {
    const config = await this.loadConfig();
    return {
      configured: Boolean(config.remoteUrl && config.token),
      remoteUrl: config.remoteUrl ? config.remoteUrl.replace(/\.git$/, "") : "",
      workspace: this.workspaceDir,
      lastSyncAt: config.lastSyncAt || "",
      syncing: this.syncing
    };
  }

  async configure(settings) {
    const remoteUrl = normaliseRemoteUrl(settings.remoteUrl);
    const token = String(settings.token || "").trim();
    if (!token) throw new Error("Введите персональный токен GitHub. Токен хранится только в зашифрованном профиле Windows.");
    const config = await this.loadConfig();
    config.remoteUrl = remoteUrl;
    config.token = this.encrypt(token);
    config.branch = "main";
    await this.saveConfig(config);
    await this.ensureWorkspace();
    if (!await exists(path.join(this.workspaceDir, ".git"))) {
      this.notify("connecting", "Подключаемся к GitHub и проверяем репозиторий…");
      await this.cloneInitialRepository(config);
    }
    return this.getStatus();
  }

  async cloneInitialRepository(config) {
    const seedMarker = path.join(this.workspaceDir, ".budget-seed.json");
    if (!await exists(seedMarker)) {
      throw new Error("В локальной копии уже есть изменения. Подключите GitHub до начала редактирования либо перенесите изменения отдельно.");
    }
    const tools = await this.loadGit();
    const onAuth = await this.authentication(config);
    const temporary = this.workspaceDir + ".clone-" + Date.now();
    try {
      this.notify("downloading", "Получаем начальную версию данных из GitHub…");
      await tools.git.clone({
        fs: fs,
        http: tools.http,
        dir: temporary,
        url: config.remoteUrl,
        ref: config.branch,
        singleBranch: true,
        depth: 1,
        onAuth: onAuth
      });
      if (!await exists(path.join(temporary, "data", "model-snapshot.json"))) {
        // GitHub нередко создаёт новый репозиторий с README. Это не рабочая
        // копия Budget, но её нельзя перезаписывать: добавляем data отдельным
        // коммитом и сохраняем все уже созданные файлы.
        await fsPromises.cp(path.join(this.workspaceDir, "data"), path.join(temporary, "data"), { recursive: true, force: false });
        const committed = await this.createDataCommit(tools.git, "Первичная загрузка данных Budget", temporary);
        if (!committed) throw new Error("Не удалось подготовить данные для первичной загрузки в GitHub.");
        this.notify("uploading", "Репозиторий подготовлен. Загружаем исходные данные в GitHub…");
        await tools.git.push({
          fs: fs,
          http: tools.http,
          dir: temporary,
          remote: "origin",
          ref: config.branch,
          remoteRef: config.branch,
          onAuth: onAuth,
          force: false
        });
      }
      await fsPromises.rm(this.workspaceDir, { recursive: true, force: true });
      await fsPromises.rename(temporary, this.workspaceDir);
    } catch (error) {
      await fsPromises.rm(temporary, { recursive: true, force: true });
      if (this.isEmptyRemoteError(error)) {
        await this.initialiseEmptyRepository(tools.git, tools.http, config, onAuth);
        return;
      }
      throw new Error("Не удалось получить начальную копию репозитория: " + error.message);
    }
  }

  isEmptyRemoteError(error) {
    const message = String(error && error.message || error || "");
    return /could not find remote ref|remote branch .* not found|no default branch|empty repository/i.test(message);
  }

  async initialiseEmptyRepository(git, http, config, onAuth) {
    await git.init({ fs: fs, dir: this.workspaceDir, defaultBranch: config.branch });
    await git.addRemote({ fs: fs, dir: this.workspaceDir, remote: "origin", url: config.remoteUrl });
    const committed = await this.createDataCommit(git, "Первичная загрузка данных Budget");
    if (!committed) throw new Error("Не удалось подготовить данные для первичной загрузки в GitHub.");
    this.notify("uploading", "Загружаем исходные данные в пустой репозиторий GitHub…");
    await git.push({
      fs: fs,
      http: http,
      dir: this.workspaceDir,
      remote: "origin",
      ref: config.branch,
      remoteRef: config.branch,
      onAuth: onAuth,
      force: false
    });
    await fsPromises.rm(path.join(this.workspaceDir, ".budget-seed.json"), { force: true });
  }

  async createDataCommit(git, message, directory) {
    const workingDirectory = directory || this.workspaceDir;
    const files = await listFiles(workingDirectory, "data");
    if (!files.length) return false;
    const matrix = await git.statusMatrix({ fs: fs, dir: workingDirectory, filepaths: files });
    const changed = matrix.filter(function(row) { return row[1] !== row[2] || row[2] !== row[3]; });
    for (const row of changed) {
      if (row[2] === 0) await git.remove({ fs: fs, dir: workingDirectory, filepath: row[0] });
      else await git.add({ fs: fs, dir: workingDirectory, filepath: row[0] });
    }
    if (!changed.length) return false;
    await git.commit({
      fs: fs,
      dir: workingDirectory,
      message: message,
      author: { name: "Budget Desktop (" + this.deviceName + ")", email: "budget-desktop@local" }
    });
    return true;
  }

  async ensureRepository(git, http, config, onAuth) {
    const gitDir = path.join(this.workspaceDir, ".git");
    if (await exists(gitDir)) return;
    await this.cloneInitialRepository(config);
  }

  async sync() {
    if (this.syncing) throw new Error("Синхронизация уже выполняется.");
    this.syncing = true;
    try {
      await this.ensureWorkspace();
      const config = await this.loadConfig();
      if (!config.remoteUrl) throw new Error("Сначала подключите репозиторий GitHub.");
      const tools = await this.loadGit();
      const onAuth = await this.authentication(config);
      await this.ensureRepository(tools.git, tools.http, config, onAuth);
      this.notify("preparing", "Проверяем локальные изменения…");
      await this.createDataCommit(tools.git, "Изменение данных Budget с " + this.deviceName);
      this.notify("downloading", "Получаем изменения из GitHub…");
      await tools.git.fetch({ fs: fs, http: tools.http, dir: this.workspaceDir, remote: "origin", onAuth: onAuth, singleBranch: true, ref: config.branch, tags: false });
      try {
        this.notify("merging", "Сверяем изменения с GitHub…");
        await tools.git.merge({
          fs: fs,
          dir: this.workspaceDir,
          ours: config.branch,
          theirs: "origin/" + config.branch,
          fastForwardOnly: true,
          author: { name: "Budget Desktop (" + this.deviceName + ")", email: "budget-desktop@local" }
        });
      } catch (error) {
        if (!/not found|Could not resolve|does not exist/i.test(String(error.message || error))) {
          throw new Error("Обнаружены расходящиеся изменения. Обновите данные до редактирования либо разрешите конфликт в GitHub: " + error.message);
        }
      }
      this.notify("uploading", "Отправляем изменения в GitHub…");
      await tools.git.push({ fs: fs, http: tools.http, dir: this.workspaceDir, remote: "origin", ref: config.branch, remoteRef: config.branch, onAuth: onAuth, force: false });
      config.lastSyncAt = new Date().toISOString();
      await this.saveConfig(config);
      return Object.assign({ message: "Изменения синхронизированы с GitHub." }, await this.getStatus());
    } finally {
      this.syncing = false;
    }
  }

  async markWorkspaceChanged() {
    const marker = path.join(this.workspaceDir, ".budget-seed.json");
    if (await exists(marker)) await fsPromises.rm(marker, { force: true });
  }
}

module.exports = { SyncService, normaliseRemoteUrl, sha256 };
