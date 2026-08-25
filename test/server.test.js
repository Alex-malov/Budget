const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildOverview, createCashSeries, createServer, exchangeNsiExportRows, flattenSubcontracts, validateSubcontract } = require("../server.js");
const { summary: financialSummary } = require("../public/financial-formulas.js");

const snapshot = {
  finance: {
    years: [2024, 2025, 2026],
    lines: [
      { label: "Объем работ в т.ч. НДС", values: { 2026: 120 } },
      { label: "НДС", values: { 2026: 20 } },
      { label: "Себестоимость работ всего", values: { 2026: 70 } }
    ],
    operating: { 2026: 30 }
  },
  cashReceipts: [
    { project: "A", monthly: [{ period: "2026-01", amount: 10 }, { period: "2026-02", amount: 5 }] },
    { project: "B", monthly: [{ period: "2026-01", amount: 7 }, { period: "2025-12", amount: 99 }] }
  ]
};

test("строит свод по последнему году исходной модели", function() {
  const overview = buildOverview(snapshot);
  assert.equal(overview.latestYear, 2026);
  assert.equal(overview.revenueWithoutVat, 100);
  assert.equal(overview.cost, 70);
  assert.equal(overview.operating, 30);
  assert.equal(overview.operatingRate, 0.3);
});

test("группирует поступления по периоду и проекту", function() {
  assert.deepEqual(createCashSeries(snapshot.cashReceipts, 2026), [
    { period: "2026-01", amount: 17 },
    { period: "2026-02", amount: 5 }
  ]);
  assert.deepEqual(createCashSeries(snapshot.cashReceipts, 2026, "A"), [
    { period: "2026-01", amount: 10 },
    { period: "2026-02", amount: 5 }
  ]);
});

test("преобразует подрядную строку в редактируемые месячные записи", function() {
  assert.deepEqual(flattenSubcontracts([{
    id: 7, project: "Проект", vendor: "Поставщик", subject: "Разработка", rate: 2000,
    monthly: [{ period: "2026-01", amount: 40000 }, { period: "2026-02", amount: 10000 }]
  }]), [
    { id: "source-7-2026-01", source: "model", project: "Проект", vendor: "Поставщик", article: "Разработка", period: "2026-01", amount: 40000, rate: 2000, estimatedHours: 20, actualHours: 0, archived: false },
    { id: "source-7-2026-02", source: "model", project: "Проект", vendor: "Поставщик", article: "Разработка", period: "2026-02", amount: 10000, rate: 2000, estimatedHours: 5, actualHours: 0, archived: false }
  ]);
  assert.ok(validateSubcontract({ project: "", vendor: "", article: "", period: "2026", amount: -1, rate: -1 }).project);
});

test("готовит выгрузку НСИ с активными связями и ненулевой стоимостью", function() {
  const rows = exchangeNsiExportRows({
    roles: [{ name: "Роль", archived: false, deleted: false }],
    projects: [{ name: "Проект", archived: false, deleted: false }],
    providers: [{ name: "Подряд", archived: false, deleted: false }],
    vendors: [{ name: "Поставщик", providerType: "Подряд", archived: false, deleted: false }],
    resources: [{ name: "Ресурс", vendor: "Поставщик", archived: false, deleted: false, costPlan: { 2026: { 1: { rate: 2000, attraction: 300 }, 2: { rate: 0, attraction: 0 } } } }]
  });
  assert.deepEqual(rows, [
    ["Проектные роли", "Роль", "", "", "", "", "", ""],
    ["Контракты / проекты", "Проект", "", "", "", "", "", ""],
    ["Тип поставщика", "Подряд", "", "", "", "", "", ""],
    ["Поставщики", "Поставщик", "", "Подряд", "", "", "", ""],
    ["Сотрудник / ресурс", "Ресурс", "Поставщик", "", "", "", "", ""],
    ["Сотрудник / ресурс", "Ресурс", "Поставщик", "", 2026, 1, 2000, 300]
  ]);
});

test("справочники архивируют используемые записи и исключают их из выбора", async function() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "planning-reference-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  const subcontractPath = path.join(directory, "subcontracts.json");
  const referencePath = path.join(directory, "references.json");
  const teamPath = path.join(directory, "team.json");
  const staffPath = path.join(directory, "staff.json");
  const changeLogPath = path.join(directory, "change-log.json");
  const source = {
    finance: { years: [2026], lines: [], operating: {} },
    reference: { roles: ["Роль"], projects: ["Проект"] },
    projects: ["Проект"], cashReceipts: [], staffResources: [{ employee: "Сотрудник", project: "Проект", role: "Роль", group: "Команда", cost: 1000, hoursPlan: { 2026: { 1: 160 } } }], team: { roles: [], roster: [], resourcePlan: [{ id: "model-1", employee: "Сотрудник", project: "Проект", role: "Роль", source: "Штат", origin: "model", hoursPlan: { 2026: { 1: 160 } } }] },
    subcontracts: [{ id: 1, project: "Проект", vendor: "Поставщик", subject: "Работа", rate: 1000, monthly: [{ period: "2026-01", amount: 1000 }] }]
  };
  await fs.writeFile(snapshotPath, JSON.stringify(source), "utf8");
  const server = createServer(snapshotPath, subcontractPath, referencePath, teamPath, staffPath, changeLogPath);
  await new Promise(function(resolve) { server.listen(0, "127.0.0.1", resolve); });
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  const request = async function(url, options) {
    const response = await fetch(baseUrl + url, options);
    return { status: response.status, body: await response.json() };
  };
  try {
    const references = await request("/api/references");
    const supplier = references.body.directories.vendors.records.find(function(item) { return item.name === "Поставщик"; });
    assert.ok(supplier);
    assert.equal(supplier.providerType, "Подряд");

    const created = await request("/api/references/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Новый поставщик", providerType: "Подряд" }) });
    assert.equal(created.status, 201);

    const invalidVat = await request("/api/references/vendors/" + encodeURIComponent(created.body.record.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Новый поставщик", providerType: "Подряд", vatPlan: { 2027: { 1: 20 } } }) });
    assert.equal(invalidVat.status, 422);
    assert.equal(invalidVat.body.fields.vatPlan, "Допустимые ставки НДС: 0, 5, 7, 10 или 22%");

    const vatUpdated = await request("/api/references/vendors/" + encodeURIComponent(created.body.record.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Новый поставщик", providerType: "Подряд", vatPlan: { 2027: { 1: 22, 2: 10 } } }) });
    assert.equal(vatUpdated.status, 200);
    assert.equal(vatUpdated.body.record.vatPlan["2027"]["1"], 22);
    assert.equal(vatUpdated.body.record.vatPlan["2027"]["2"], 10);

    const otherSubcontract = await request("/api/references/otherSubcontracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Серверы", category: "Прочие" }) });
    assert.equal(otherSubcontract.status, 201);
    assert.equal(otherSubcontract.body.record.providerType, "Подряд");
    assert.equal(otherSubcontract.body.record.category, "Прочие");
    const deletedOtherSubcontract = await request("/api/references/otherSubcontracts/" + encodeURIComponent(otherSubcontract.body.record.id), { method: "DELETE" });
    assert.equal(deletedOtherSubcontract.status, 200);
    assert.equal(deletedOtherSubcontract.body.action, "deleted");

    const archived = await request("/api/references/vendors/" + encodeURIComponent(supplier.id), { method: "DELETE" });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.action, "archived");

    const blocked = await request("/api/subcontracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: "Проект", vendor: "Поставщик", article: "Работа", period: "2026-02", amount: 1000, rate: 1000 }) });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.fields.vendor, "Выберите активного поставщика из НСИ");

    const deleted = await request("/api/references/vendors/" + encodeURIComponent(created.body.record.id), { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.action, "deleted");

    const team = await request("/api/team");
    assert.equal(team.status, 200);
    assert.equal(team.body.records[0].hoursPlan["2026"]["1"], 160);
    assert.equal(team.body.records[0].cost, 0);

    const staff = await request("/api/staff");
    assert.equal(staff.status, 200);
    assert.equal(staff.body.records[0].hoursActual["2026"]["1"], 0);
    const changedStaff = await request("/api/staff/model-staff-1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hoursActual: { 2026: { 1: 128 } } }) });
    assert.equal(changedStaff.status, 200);
    assert.equal(changedStaff.body.record.hoursActual["2026"]["1"], 128);

    const staffHistory = await request("/api/change-log?entity=staff&recordId=model-staff-1");
    assert.equal(staffHistory.status, 200);
    assert.equal(staffHistory.body.entries[0].action, "updated");
    assert.equal(staffHistory.body.entries[0].changes[0].field, "Часы (факт) · 2026 / 1");

    const archivedStaff = await request("/api/staff/model-staff-1", { method: "DELETE" });
    assert.equal(archivedStaff.status, 200);
    assert.equal(archivedStaff.body.action, "archived");
    const restoredStaff = await request("/api/staff/model-staff-1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: false }) });
    assert.equal(restoredStaff.status, 200);
    assert.equal(restoredStaff.body.record.archived, false);

    const teamVendor = await request("/api/references/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Поставщик команды", providerType: "Подряд" }) });
    assert.equal(teamVendor.status, 201);
    const teamResource = await request("/api/references/resources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Новый сотрудник", vendor: "Поставщик команды", costPlan: { 2026: { 1: { rate: 150000, attraction: 30000 }, 2: { rate: 200000, attraction: 50000 } } } }) });
    assert.equal(teamResource.status, 201);
    const newTeamRecord = await request("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee: "Новый сотрудник", vendor: "Поставщик команды", project: "Проект", role: "Роль", rate: 150000, attraction: 30000, costPlan: { 2026: { 1: { rate: 150000, attraction: 30000 }, 2: { rate: 200000, attraction: 50000 } } }, hoursPlan: { 2026: { 1: 80 } } }) });
    assert.equal(newTeamRecord.status, 201);
    assert.equal(newTeamRecord.body.record.cost, 180000);
    assert.equal(newTeamRecord.body.record.costPlan["2026"]["1"].rate, 150000);
    assert.equal(newTeamRecord.body.record.costPlan["2026"]["1"].attraction, 30000);
    assert.equal(newTeamRecord.body.record.costPlan["2026"]["2"].rate, 200000);
    assert.equal(newTeamRecord.body.record.costPlan["2026"]["2"].attraction, 50000);
    assert.equal(newTeamRecord.body.record.source, "Подряд");

    const archivedTeamRecord = await request("/api/team/model-1", { method: "DELETE" });
    assert.equal(archivedTeamRecord.status, 200);
    assert.equal(archivedTeamRecord.body.action, "archived");

    const deletedTeamRecord = await request("/api/team/" + encodeURIComponent(newTeamRecord.body.record.id), { method: "DELETE" });
    assert.equal(deletedTeamRecord.status, 200);
    assert.equal(deletedTeamRecord.body.action, "deleted");
  } finally {
    await new Promise(function(resolve) { server.close(resolve); });
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("хранит план и факт прочего подряда по месяцам и архивирует используемую статью", async function() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "planning-other-subcontract-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  const subcontractPath = path.join(directory, "subcontracts.json");
  const referencePath = path.join(directory, "references.json");
  const teamPath = path.join(directory, "team.json");
  const staffPath = path.join(directory, "staff.json");
  const changeLogPath = path.join(directory, "change-log.json");
  const otherPath = path.join(directory, "other-subcontracts.json");
  await fs.writeFile(snapshotPath, JSON.stringify({
    finance: { years: [2026], lines: [], operating: {} }, reference: { projects: ["Проект"] }, projects: ["Проект"], cashReceipts: [], staffResources: [], team: { roles: [], roster: [], resourcePlan: [] }, subcontracts: []
  }), "utf8");
  const server = createServer(snapshotPath, subcontractPath, referencePath, teamPath, staffPath, changeLogPath, otherPath);
  await new Promise(function(resolve) { server.listen(0, "127.0.0.1", resolve); });
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  const request = async function(url, options) {
    const response = await fetch(baseUrl + url, options);
    return { status: response.status, body: await response.json() };
  };
  try {
    const reference = await request("/api/references/otherSubcontracts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Лицензии", category: "Основные", vatPlan: { 2026: { 1: 22, 2: 10 } } })
    });
    assert.equal(reference.status, 201);
    assert.equal(reference.body.record.vatPlan["2026"]["1"], 22);

    const created = await request("/api/other-subcontracts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ otherSubcontract: "Лицензии", project: "Проект", plan: { 2026: { 1: 1000 } }, fact: { 2026: { 1: 750 } } })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.record.plan["2026"]["1"], 1000);
    assert.equal(created.body.record.fact["2026"]["1"], 750);

    const inlineUpdated = await request("/api/other-subcontracts/" + encodeURIComponent(created.body.record.id), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: { 2026: { 1: 1500 } } })
    });
    assert.equal(inlineUpdated.status, 200);
    assert.deepEqual(inlineUpdated.body.record.calculated.plan["2026"]["1"], { sum: 1500, vatRate: 22, vat: 330, cost: 1830 });
    assert.deepEqual(inlineUpdated.body.record.calculated.fact["2026"]["1"], { sum: 750, vatRate: 22, vat: 165, cost: 915 });

    const records = await request("/api/other-subcontracts");
    assert.equal(records.status, 200);
    assert.equal(records.body.records.length, 1);
    assert.equal(records.body.records[0].plan["2026"]["1"], 1500);
    assert.equal(records.body.records[0].fact["2026"]["1"], 750);
    assert.equal(records.body.records[0].otherSubcontract, "Лицензии");
    assert.deepEqual(records.body.records[0].calculated.plan["2026"]["1"], { sum: 1500, vatRate: 22, vat: 330, cost: 1830 });
    assert.deepEqual(records.body.records[0].calculated.fact["2026"]["1"], { sum: 750, vatRate: 22, vat: 165, cost: 915 });

    const validStorage = await fs.readFile(otherPath, "utf8");
    await fs.writeFile(otherPath, validStorage + '\n{"unfinished":', "utf8");
    const recovered = await request("/api/other-subcontracts");
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.records[0].plan["2026"]["1"], 1500);
    const repairedStorage = JSON.parse(await fs.readFile(otherPath, "utf8"));
    assert.equal(repairedStorage.records[0].fact["2026"]["1"], 750);
    assert.ok((await fs.readdir(path.join(directory, "backups"))).some(function(file) { return file.startsWith("other-subcontracts.json.corrupt-"); }));

    const archivedReference = await request("/api/references/otherSubcontracts/" + encodeURIComponent(reference.body.record.id), { method: "DELETE" });
    assert.equal(archivedReference.status, 200);
    assert.equal(archivedReference.body.action, "archived");
  } finally {
    await new Promise(function(resolve) { server.close(resolve); });
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("считает контрольный финансовый пример BUD-13 по единому контракту формул", function() {
  const result = financialSummary({ income: 6100, outputVat: 1100, otherGross: 610, contractorGross: 1464, staffCost: 800, staffAttraction: 200, inputVat: 374, taxRate: 0.05, directorateRate: 0.05, overdraftCost: 0 });
  assert.equal(result.expenses, 2874);
  assert.equal(result.profitGross, 3226);
  assert.equal(result.vatTotal, 726);
  assert.equal(result.beforeTax, 2500);
  assert.equal(result.profitTax, 125);
  assert.equal(result.net, 2375);
  assert.equal(result.investment, 549);
  assert.equal(result.directorate, 247.05);
  assert.equal(result.dks, 1378.95);
  assert.equal(result.profitability, 0.475);
  assert.equal(Number(result.taxBurden.toFixed(3)), 0.14);
});

test("хранит независимые доходы и оплаты с НДС-снимком и контролем распределения", async function() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "planning-financial-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  const subcontractPath = path.join(directory, "subcontracts.json");
  const referencePath = path.join(directory, "references.json");
  const teamPath = path.join(directory, "team.json");
  const staffPath = path.join(directory, "staff.json");
  const changeLogPath = path.join(directory, "change-log.json");
  const otherPath = path.join(directory, "other-subcontracts.json");
  const financialPath = path.join(directory, "financial-events.json");
  await fs.writeFile(snapshotPath, JSON.stringify({
    finance: { years: [2026], lines: [], operating: {} }, reference: { projects: ["Проект"] }, projects: ["Проект"], cashReceipts: [], staffResources: [], team: { roles: [], roster: [], resourcePlan: [] }, subcontracts: []
  }), "utf8");
  const server = createServer(snapshotPath, subcontractPath, referencePath, teamPath, staffPath, changeLogPath, otherPath, financialPath);
  await new Promise(function(resolve) { server.listen(0, "127.0.0.1", resolve); });
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  const request = async function(url, options) {
    const response = await fetch(baseUrl + url, options);
    return { status: response.status, body: await response.json() };
  };
  try {
    const references = await request("/api/references");
    const project = references.body.directories.projects.records[0];
    assert.match(project.code, /^PRJ-\d{3}$/);
    assert.ok(references.body.directories.financialRates.records.length > 0);

    const overlappingRate = await request("/api/references/financialRates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Пересекающаяся ставка", financialKind: "profitTax", project: "", year: "2026", rate: 5 }) });
    assert.equal(overlappingRate.status, 422);
    assert.ok(overlappingRate.body.fields.year);

    const income = await request("/api/financial/incomes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectCode: project.code, scenario: "fact", period: "2026-01", gross: 1220, vatRate: 22, comment: "Оплата этапа" }) });
    assert.equal(income.status, 201);
    assert.equal(income.body.record.vat, 220);
    assert.equal(income.body.record.gross - income.body.record.vat, 1000);

    const lockedProject = await request("/api/references/projects/" + encodeURIComponent(project.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: project.name, code: "PRJ-999" }) });
    assert.equal(lockedProject.status, 422);
    assert.ok(lockedProject.body.fields.code);

    const invalidPayment = await request("/api/financial/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectCode: project.code, scenario: "fact", period: "2026-02", gross: 100, vatRate: 22, source: "resource", contractor: "Нет такого", allocations: [] }) });
    assert.equal(invalidPayment.status, 422);
    assert.ok(invalidPayment.body.fields.contractor);

    const saved = await request("/api/financial");
    assert.equal(saved.status, 200);
    assert.equal(saved.body.incomes.length, 1);

    const archived = await request("/api/financial/incomes/" + encodeURIComponent(income.body.record.id), { method: "DELETE" });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.record.archived, true);
  } finally {
    await new Promise(function(resolve) { server.close(resolve); });
    await fs.rm(directory, { recursive: true, force: true });
  }
});
