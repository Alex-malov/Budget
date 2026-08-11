import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Укажите путь к исходному документу.");

const file = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(file);
const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 16000,
  tableMaxRows: 12,
  tableMaxCols: 18,
  tableMaxCellChars: 120
});
console.log(summary.ndjson);
