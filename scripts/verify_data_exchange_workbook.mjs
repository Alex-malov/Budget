import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = process.argv[2];
const previewDirectory = process.argv[3];
if (!inputPath || !previewDirectory) throw new Error("Укажите путь к Excel-файлу и папке для предпросмотра.");

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheetNames = ["Инструкция", "НСИ", "Команда", "Суммы и часы штат", "Суммы и часы подряд"];
const overview = await workbook.inspect({ kind: "table", range: "НСИ!A1:H25", include: "values,formulas", tableMaxRows: 25, tableMaxCols: 8 });
const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, summary: "Проверка ошибок формул" });

await fs.mkdir(previewDirectory, { recursive: true });
for (const sheetName of sheetNames) {
  const preview = await workbook.render({ sheetName: sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDirectory, sheetName + ".png"), new Uint8Array(await preview.arrayBuffer()));
}

const nsiRows = workbook.worksheets.getItem("НСИ").getRange("A5:H5000").values.filter(function(row) {
  return row.some(function(value) { return value !== null && value !== undefined && String(value).trim() !== ""; });
}).length;
console.log(JSON.stringify({ sheets: sheetNames.length, nsiRows: nsiRows, inspected: Boolean(overview), formulaErrors: formulaErrors.ndjson || "" }));
