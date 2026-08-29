import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error("Укажите пути к исходному Excel-файлу и JSON-результату.");

const sheetDefinitions = [
  { name: "НСИ", columns: 8 },
  { name: "Команда", columns: 17 },
  { name: "Суммы и часы штат", columns: 16 },
  { name: "Суммы и часы подряд", columns: 7 }
];

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function columnLetter(index) {
  let value = index;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

const source = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(source);
const sheets = {};

for (const definition of sheetDefinitions) {
  let sheet;
  try {
    sheet = workbook.worksheets.getItem(definition.name);
  } catch (error) {
    throw new Error("В файле отсутствует лист «" + definition.name + "».");
  }
  const lastColumn = columnLetter(definition.columns);
  const values = sheet.getRange("A5:" + lastColumn + "5000").values;
  sheets[definition.name] = values.map(function(row, index) {
    return { rowNumber: index + 5, values: row };
  }).filter(function(row) {
    return row.values.some(hasValue);
  });
}

await fs.writeFile(outputPath, JSON.stringify({ version: 1, sheets: sheets }), "utf8");
