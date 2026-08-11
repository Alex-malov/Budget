import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Укажите путь для Excel-шаблона.");
const previewDirectory = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "";
const nsiDataArgument = process.argv.indexOf("--nsi-data");
const nsiDataPath = nsiDataArgument >= 0 ? process.argv[nsiDataArgument + 1] : "";
if (nsiDataArgument >= 0 && !nsiDataPath) throw new Error("Укажите путь к данным НСИ для выгрузки.");
const nsiExportRows = nsiDataPath ? JSON.parse(await fs.readFile(nsiDataPath, "utf8")).rows || [] : [];
const isNsiExport = nsiDataPath !== "";

const palette = {
  navy: "#24282E",
  blue: "#003099",
  bluePale: "#DEEDFF",
  gray: "#F5F6F7",
  line: "#D1D8E0",
  text: "#13151A",
  muted: "#5D6570",
  white: "#FFFFFF"
};

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

function styleTitle(sheet, endColumn, title, subtitle) {
  sheet.getRange("A1:" + endColumn + "1").merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A1:" + endColumn + "1").format = {
    fill: palette.navy,
    font: { bold: true, color: palette.white, size: 16 },
    horizontalAlignment: "left",
    verticalAlignment: "center"
  };
  sheet.getRange("A1:" + endColumn + "1").format.rowHeight = 28;
  sheet.getRange("A2:" + endColumn + "2").merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange("A2:" + endColumn + "2").format = {
    fill: palette.bluePale,
    font: { color: palette.text, size: 10 },
    wrapText: true,
    verticalAlignment: "center"
  };
  sheet.getRange("A2:" + endColumn + "2").format.rowHeight = 34;
}

function buildDataSheet(workbook, config) {
  const sheet = workbook.worksheets.add(config.name);
  const endColumn = columnLetter(config.headers.length);
  const rows = Array.isArray(config.rows) ? config.rows : [];
  const lastDataRow = Math.max(5, 4 + rows.length);
  const editableLastRow = Math.max(104, lastDataRow + 50);
  styleTitle(sheet, endColumn, config.title, config.subtitle);
  sheet.getRange("A4:" + endColumn + "4").values = [config.headers];
  sheet.getRange("A4:" + endColumn + "4").format = {
    fill: palette.blue,
    font: { bold: true, color: palette.white, size: 10 },
    wrapText: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: palette.blue }
  };
  sheet.getRange("A4:" + endColumn + "4").format.rowHeight = 35;
  if (rows.length) sheet.getRange("A5:" + endColumn + lastDataRow).values = rows;
  sheet.getRange("A5:" + endColumn + editableLastRow).format = {
    borders: { preset: "insideHorizontal", style: "thin", color: palette.line },
    verticalAlignment: "center"
  };
  sheet.getRange("A5:" + endColumn + "104").format.rowHeight = 20;
  (config.widths || []).forEach(function(width, index) {
    sheet.getRange(columnLetter(index + 1) + ":" + columnLetter(index + 1)).format.columnWidth = width;
  });
  (config.numberColumns || []).forEach(function(letter) {
    sheet.getRange(letter + "5:" + letter + editableLastRow).format.numberFormat = "#,##0.00;(#,##0.00);-";
  });
  (config.integerColumns || []).forEach(function(letter) {
    sheet.getRange(letter + "5:" + letter + editableLastRow).format.numberFormat = "#,##0.0;(#,##0.0);-";
  });
  if (config.validation) {
    Object.keys(config.validation).forEach(function(letter) {
      sheet.getRange(letter + "5:" + letter + editableLastRow).dataValidation = { rule: { type: "list", values: config.validation[letter] } };
    });
  }
  sheet.tables.add("A4:" + endColumn + lastDataRow, true, config.tableName);
  sheet.freezePanes.freezeRows(4);
  return sheet;
}

const workbook = Workbook.create();

const instructions = workbook.worksheets.add("Инструкция");
instructions.showGridLines = false;
styleTitle(instructions, "F", isNsiExport ? "Выгрузка НСИ бюджетирования" : "Обмен данными бюджетирования", isNsiExport ? "Лист «НСИ» заполнен актуальными активными значениями из приложения. При необходимости внесите изменения и загрузите файл обратно через основную навигацию. Поддерживается формат Excel .xlsx." : "Заполните нужные листы шаблона и загрузите файл в приложении через основную навигацию. Поддерживается формат Excel .xlsx.");
instructions.getRange("A4:F4").values = [["Лист", "Что загружается", "Ключ записи", "Обязательные поля", "Правила", "Результат"]];
instructions.getRange("A5:F8").values = [
  ["НСИ", "Роли, проекты, типы поставщика, поставщики, сотрудники / ресурсы и помесячная стоимость ресурсов.", "Справочник + Наименование; для стоимости: ресурс + Год + Месяц.", "Справочник, Наименование. Для ресурса — Поставщик. Для ставки/привлечения — Год и Месяц.", "Сначала заполните типы поставщика, затем поставщиков, затем ресурсы. Типы: «Штат» или «Подряд». Пустые стоимость и часы не изменяют существующие значения.", "Создание или обновление НСИ и стоимости ресурсов."],
  ["Команда", "Плановые часы ресурса по проекту и роли.", "Сотрудник / ресурс + Проект + Роль + Год.", "Сотрудник / ресурс, Поставщик, Проект, Роль, Год.", "Ресурс, поставщик, роль и проект должны быть активны в НСИ. Тип источника определяется по поставщику.", "Создание или обновление плана команды (раздел 06)."],
  ["Суммы и часы штат", "Фактические часы штатного ресурса по месяцам.", "Сотрудник / ресурс + Проект + Роль + Год.", "Сотрудник / ресурс, Проект, Роль, Год.", "Сотрудник, проект и роль должны существовать в «Команде» с типом поставщика «Штат». План часов берётся из раздела 06.", "Создание или обновление факта часов в разделе 05."],
  ["Суммы и часы подряд", "Затраты и фактические часы подрядчика за месяц.", "Ресурс подрядчика + Проект + Статья + Период.", "Ресурс подрядчика, Проект, Статья, Период, Затраты, Ставка.", "Ресурс должен быть в «Команде» и иметь поставщика типа «Подряд». Период указывается как ГГГГ-ММ.", "Создание или обновление строк раздела 04."]
];
instructions.getRange("A4:F4").format = { fill: palette.blue, font: { bold: true, color: palette.white }, wrapText: true, horizontalAlignment: "center", borders: { preset: "all", style: "thin", color: palette.blue } };
instructions.getRange("A5:F8").format = { wrapText: true, verticalAlignment: "top", borders: { preset: "insideHorizontal", style: "thin", color: palette.line } };
instructions.getRange("A5:A8").format.font = { bold: true, color: palette.blue };
[18, 35, 33, 38, 62, 42].forEach(function(width, index) { instructions.getRange(columnLetter(index + 1) + ":" + columnLetter(index + 1)).format.columnWidth = width; });
instructions.getRange("A5:F8").format.rowHeight = 66;
instructions.getRange("A10:F10").merge();
instructions.getRange("A10").values = [["Важно: файл проверяется целиком до сохранения. Если найдены ошибки, данные в приложении не меняются, а в сообщении указываются лист и строка."]];
instructions.getRange("A10:F10").format = { fill: palette.gray, font: { bold: true, color: palette.muted }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: palette.line } };
instructions.getRange("A10:F10").format.rowHeight = 32;
instructions.freezePanes.freezeRows(4);

buildDataSheet(workbook, {
  name: "НСИ",
  title: isNsiExport ? "НСИ — актуальные справочники и стоимость ресурсов" : "НСИ — справочники и стоимость ресурсов",
  subtitle: isNsiExport ? "Выгружены активные значения НСИ. Стоимость выгружается только для месяцев, где ставка или привлечение отличаются от нуля. Добавляйте новые строки ниже таблицы при необходимости." : "Одна строка — одно значение справочника или стоимость сотрудника / ресурса за указанный месяц. Для ролей, проектов и типов поставщика заполните только «Справочник» и «Наименование».",
  headers: ["Справочник", "Наименование", "Поставщик", "Тип поставщика", "Год", "Месяц", "Ставка, ₽/ч", "Привлечение, ₽/ч"],
  rows: nsiExportRows,
  widths: [21, 38, 31, 20, 12, 12, 18, 20],
  numberColumns: ["G", "H"],
  validation: { A: ["Проектные роли", "Контракты / проекты", "Тип поставщика", "Поставщики", "Сотрудник / ресурс"], D: ["Штат", "Подряд"], F: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] },
  tableName: "ReferenceImport"
});

buildDataSheet(workbook, {
  name: "Команда",
  title: "Команда — плановые часы",
  subtitle: "Одна строка — назначение сотрудника / ресурса на проект и роль за год. Заполните часы по месяцам; пустые месяцы считаются нулём.",
  headers: ["Сотрудник / ресурс", "Поставщик", "Проект", "Роль", "Год", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  widths: [34, 28, 32, 22, 11, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13],
  integerColumns: ["F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q"],
  tableName: "TeamImport"
});

buildDataSheet(workbook, {
  name: "Суммы и часы штат",
  title: "Суммы и часы штат — фактические часы",
  subtitle: "Одна строка — фактические часы штатного сотрудника / ресурса по проекту и роли за год. План и стоимость в этом листе не вводятся: они берутся из «Команды» и НСИ.",
  headers: ["Сотрудник / ресурс", "Проект", "Роль", "Год", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  widths: [34, 32, 22, 11, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13],
  integerColumns: ["E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"],
  tableName: "StaffImport"
});

buildDataSheet(workbook, {
  name: "Суммы и часы подряд",
  title: "Суммы и часы подряд — затраты и факт",
  subtitle: "Одна строка — затраты и фактические часы подрядчика за месяц. Поставщик, роль, план часов и стоимость подставляются из НСИ и «Команды».",
  headers: ["Ресурс подрядчика", "Проект", "Статья", "Период", "Затраты, ₽", "Ставка, ₽/ч", "Часы (факт)"],
  widths: [34, 32, 30, 14, 18, 18, 16],
  numberColumns: ["E", "F"],
  integerColumns: ["G"],
  tableName: "SubcontractImport"
});

if (process.argv.includes("--sample")) {
  workbook.worksheets.getItem("НСИ").getRange("A5:H12").values = [
    ["Проектные роли", "Тестовая роль", "", "", "", "", "", ""],
    ["Контракты / проекты", "Тестовый проект", "", "", "", "", "", ""],
    ["Тип поставщика", "Штат", "", "", "", "", "", ""],
    ["Тип поставщика", "Подряд", "", "", "", "", "", ""],
    ["Поставщики", "Тестовый штат", "", "Штат", "", "", "", ""],
    ["Поставщики", "Тестовый подрядчик", "", "Подряд", "", "", "", ""],
    ["Сотрудник / ресурс", "Тестовый штатный ресурс", "Тестовый штат", "", 2026, 1, 1500, 200],
    ["Сотрудник / ресурс", "Тестовый подрядный ресурс", "Тестовый подрядчик", "", 2026, 1, 2000, 400]
  ];
  workbook.worksheets.getItem("Команда").getRange("A5:Q6").values = [
    ["Тестовый штатный ресурс", "Тестовый штат", "Тестовый проект", "Тестовая роль", 2026, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160],
    ["Тестовый подрядный ресурс", "Тестовый подрядчик", "Тестовый проект", "Тестовая роль", 2026, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160]
  ];
  workbook.worksheets.getItem("Суммы и часы штат").getRange("A5:P5").values = [["Тестовый штатный ресурс", "Тестовый проект", "Тестовая роль", 2026, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80]];
  workbook.worksheets.getItem("Суммы и часы подряд").getRange("A5:G5").values = [["Тестовый подрядный ресурс", "Тестовый проект", "Тестовая статья", "2026-01", 100000, 2000, 50]];
}

await workbook.inspect({ kind: "table", range: "Инструкция!A1:F10", include: "values,formulas", tableMaxRows: 10, tableMaxCols: 6 });
await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, summary: "Проверка ошибок формул" });

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

if (previewDirectory) {
  await fs.mkdir(previewDirectory, { recursive: true });
  for (const sheetName of ["Инструкция", "НСИ", "Команда", "Суммы и часы штат", "Суммы и часы подряд"]) {
    const preview = await workbook.render({ sheetName: sheetName, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(path.join(previewDirectory, sheetName + ".png"), new Uint8Array(await preview.arrayBuffer()));
  }
}
