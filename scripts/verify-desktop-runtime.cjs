const path = require("node:path");

const releaseDirectory = process.argv[2];
if (!releaseDirectory) throw new Error("Укажите путь к каталогу распакованного Windows-релиза.");

const applicationDirectory = path.join(path.resolve(releaseDirectory), "resources", "app");
const syncService = path.join(applicationDirectory, "desktop", "sync-service.cjs");

try {
  require(syncService);
  require(require.resolve("isomorphic-git", { paths: [applicationDirectory] }));
  require(require.resolve("isomorphic-git/http/node", { paths: [applicationDirectory] }));
} catch (error) {
  throw new Error("Компонент синхронизации в релизе недоступен: " + error.message);
}

console.log("Компонент синхронизации доступен в " + applicationDirectory);
