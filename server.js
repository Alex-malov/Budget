const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
// В десктопной сборке этот каталог указывает на локальную копию Git-репозитория.
// В обычном веб-запуске переменная не задана, поэтому используется data рядом с кодом.
const DATA_DIR = path.resolve(process.env.BUDGET_DATA_DIR || path.join(ROOT, "data"));
const SNAPSHOT_PATH = path.join(DATA_DIR, "model-snapshot.json");
const SUBCONTRACT_OVERRIDES_PATH = path.join(DATA_DIR, "subcontract-overrides.json");
const REFERENCE_OVERRIDES_PATH = path.join(DATA_DIR, "reference-overrides.json");
const TEAM_OVERRIDES_PATH = path.join(DATA_DIR, "team-overrides.json");
const STAFF_OVERRIDES_PATH = path.join(DATA_DIR, "staff-overrides.json");
const OTHER_SUBCONTRACT_OVERRIDES_PATH = path.join(DATA_DIR, "other-subcontract-overrides.json");
const CHANGE_LOG_PATH = path.join(DATA_DIR, "change-log.json");
const VAT_RATES = [0, 5, 7, 10, 22];
const EXCHANGE_WORKBOOK_PARSER = path.join(ROOT, "scripts", "parse_data_exchange_workbook.mjs");
const EXCHANGE_WORKBOOK_BUILDER = path.join(ROOT, "scripts", "build_data_exchange_template.mjs");
const MAX_EXCHANGE_FILE_SIZE = 12 * 1024 * 1024;
const snapshotCache = new Map();
const snapshotReads = new Map();
const REFERENCE_DIRECTORIES = {
  roles: { title: "Проектные роли", fields: ["name"] },
  projects: { title: "Контракты / проекты", fields: ["name"] },
  vendors: { title: "Поставщики", fields: ["name"] },
  providers: { title: "Тип поставщика", fields: ["name"] },
  resources: { title: "Сотрудник / ресурс", fields: ["name", "vendor"] },
  otherSubcontracts: { title: "Прочий подряд", fields: ["name", "category"] }
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sum(values) {
  return values.reduce(function(total, value) { return total + Number(value || 0); }, 0);
}

function createCashSeries(records, year, project) {
  const monthly = {};
  records.forEach(function(record) {
    if (project && record.project !== project) return;
    record.monthly.forEach(function(item) {
      if (year && !item.period.startsWith(String(year) + "-")) return;
      monthly[item.period] = (monthly[item.period] || 0) + Number(item.amount || 0);
    });
  });
  return Object.keys(monthly).sort().map(function(period) {
    return { period: period, amount: monthly[period] };
  });
}

function buildOverview(snapshot) {
  const finance = snapshot.finance || { years: [], lines: [], operating: {} };
  const latestYear = Math.max.apply(Math, finance.years || [0]);
  const lookup = (finance.lines || []).reduce(function(result, item) {
    result[item.label] = item.values || {};
    return result;
  }, {});
  const workWithVat = Number((lookup["Объем работ в т.ч. НДС"] || {})[latestYear] || 0);
  const vat = Number((lookup["НДС"] || {})[latestYear] || 0);
  const revenueWithoutVat = workWithVat - vat;
  const cost = Number((lookup["Себестоимость работ всего"] || {})[latestYear] || 0);
  const operating = Number((finance.operating || {})[latestYear] || 0);
  return {
    latestYear: latestYear,
    revenueWithoutVat: revenueWithoutVat,
    cost: cost,
    operating: operating,
    operatingRate: revenueWithoutVat ? operating / revenueWithoutVat : null,
    cashSeries: createCashSeries(snapshot.cashReceipts || [], latestYear)
  };
}

async function readSnapshot(snapshotPath) {
  const filename = snapshotPath || SNAPSHOT_PATH;
  if (snapshotCache.has(filename)) return snapshotCache.get(filename);
  if (snapshotReads.has(filename)) return snapshotReads.get(filename);
  const pending = fs.readFile(filename, "utf8").then(function(raw) {
    const snapshot = JSON.parse(raw);
    snapshotCache.set(filename, snapshot);
    return snapshot;
  }).finally(function() {
    snapshotReads.delete(filename);
  });
  snapshotReads.set(filename, pending);
  return pending;
}

function flattenSubcontracts(records) {
  return (records || []).flatMap(function(record) {
    return (record.monthly || []).map(function(item) {
      const amount = Number(item.amount || 0);
      const rate = Number(record.rate || 0);
      return {
        id: "source-" + record.id + "-" + item.period,
        source: "model",
        project: record.project || "Не указан",
        vendor: record.vendor || "Не указан",
        article: record.subject || record.resource || "Без статьи",
        period: item.period,
        amount: amount,
        rate: rate,
      estimatedHours: rate ? amount / rate : null,
      actualHours: 0,
      archived: false
      };
    });
  });
}

function normalizeHoursPlan(hoursPlan) {
  const source = hoursPlan && typeof hoursPlan === "object" ? hoursPlan : {};
  const years = new Set(["2024", "2025", "2026"].concat(Object.keys(source)));
  return Array.from(years).sort().reduce(function(result, year) {
    const months = source[year] && typeof source[year] === "object" ? source[year] : {};
    result[year] = Array.from({ length: 12 }, function(_, index) {
      const value = Number(months[String(index + 1)]);
      return [String(index + 1), Number.isFinite(value) && value >= 0 ? value : 0];
    }).reduce(function(values, entry) { values[entry[0]] = entry[1]; return values; }, {});
    return result;
  }, {});
}

function normalizeAnnualHours(hours) {
  const source = hours && typeof hours === "object" ? hours : {};
  const years = new Set(["2024", "2025", "2026"].concat(Object.keys(source)));
  return Array.from(years).sort().reduce(function(result, year) {
    const value = Number(source[year]);
    result[year] = Number.isFinite(value) && value >= 0 ? value : 0;
    return result;
  }, {});
}

function normalizeCostPlan(costPlan, fallbackRate, fallbackAttraction) {
  const source = costPlan && typeof costPlan === "object" ? costPlan : {};
  const rate = Number(fallbackRate);
  const attraction = Number(fallbackAttraction);
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : 0;
  const safeAttraction = Number.isFinite(attraction) && attraction >= 0 ? attraction : 0;
  const years = new Set(["2024", "2025", "2026"].concat(Object.keys(source)));
  return Array.from(years).sort().reduce(function(result, year) {
    const months = source[year] && typeof source[year] === "object" ? source[year] : {};
    result[year] = Array.from({ length: 12 }, function(_, index) {
      const value = months[String(index + 1)] && typeof months[String(index + 1)] === "object" ? months[String(index + 1)] : {};
      const monthRate = Number(value.rate);
      const monthAttraction = Number(value.attraction);
      return [String(index + 1), {
        rate: Number.isFinite(monthRate) && monthRate >= 0 ? monthRate : safeRate,
        attraction: Number.isFinite(monthAttraction) && monthAttraction >= 0 ? monthAttraction : safeAttraction
      }];
    }).reduce(function(values, entry) { values[entry[0]] = entry[1]; return values; }, {});
    return result;
  }, {});
}

function normalizeVatPlan(vatPlan) {
  const source = vatPlan && typeof vatPlan === "object" ? vatPlan : {};
  const years = new Set(["2024", "2025", "2026"].concat(Object.keys(source)));
  return Array.from(years).sort().reduce(function(result, year) {
    const months = source[year] && typeof source[year] === "object" ? source[year] : {};
    result[year] = Array.from({ length: 12 }, function(_, index) {
      const value = Number(months[String(index + 1)]);
      return [String(index + 1), Number.isFinite(value) && VAT_RATES.includes(value) ? value : 0];
    }).reduce(function(values, entry) { values[entry[0]] = entry[1]; return values; }, {});
    return result;
  }, {});
}

function normalizeAmountPlan(amountPlan) {
  const source = amountPlan && typeof amountPlan === "object" ? amountPlan : {};
  const years = new Set(["2024", "2025", "2026"].concat(Object.keys(source)));
  return Array.from(years).sort().reduce(function(result, year) {
    const months = source[year] && typeof source[year] === "object" ? source[year] : {};
    result[year] = Array.from({ length: 12 }, function(_, index) {
      const value = Number(months[String(index + 1)]);
      return [String(index + 1), Number.isFinite(value) && value >= 0 ? value : 0];
    }).reduce(function(values, entry) { values[entry[0]] = entry[1]; return values; }, {});
    return result;
  }, {});
}

function normalizeOtherSubcontractRecord(record, id, source) {
  return {
    id: String(id || record.id),
    otherSubcontract: String(record.otherSubcontract || record.name || "").trim(),
    project: String(record.project || "").trim(),
    plan: normalizeAmountPlan(record.plan),
    fact: normalizeAmountPlan(record.fact),
    source: source || record.source || "local",
    archived: Boolean(record.archived)
  };
}

function normalizeTeamRecord(record, id, origin) {
  const rate = Number(record.rate);
  const attraction = Number(record.attraction);
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : 0;
  const safeAttraction = Number.isFinite(attraction) && attraction >= 0 ? attraction : 0;
  return {
    id: String(id || record.id),
    employee: String(record.employee || "").trim(),
    project: String(record.project || "").trim(),
    role: String(record.role || "").trim(),
    vendor: String(record.vendor || "").trim(),
    provider: String(record.provider || "").trim(),
    source: record.source === "Подряд" ? "Подряд" : "Штат",
    origin: origin || record.origin || "local",
    archived: Boolean(record.archived),
    hoursPlan: normalizeHoursPlan(record.hoursPlan),
    hoursPlanAnnual: normalizeAnnualHours(record.hoursPlanAnnual),
    costPlan: normalizeCostPlan(record.costPlan, safeRate, safeAttraction),
    rate: safeRate,
    attraction: safeAttraction,
    cost: safeRate + safeAttraction
  };
}

function normalizeStaffRecord(record, id, origin) {
  const cost = Number(record.cost);
  return {
    id: String(id || record.id),
    employee: String(record.employee || "").trim(),
    project: String(record.project || "").trim(),
    role: String(record.role || "").trim(),
    group: String(record.group || "Внутренние ресурсы").trim(),
    cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
    origin: origin || record.origin || "local",
    archived: Boolean(record.archived),
    hoursPlan: normalizeHoursPlan(record.hoursPlan),
    hoursPlanAnnual: normalizeAnnualHours(record.hoursPlanAnnual),
    hoursActual: normalizeHoursPlan(record.hoursActual),
    hoursActualAnnual: normalizeAnnualHours(record.hoursActualAnnual)
  };
}

function sourceStaffRecords(snapshot) {
  return (snapshot.staffResources || []).map(function(record, index) {
    return normalizeStaffRecord(record, record.id || "model-staff-" + (index + 1), "model");
  });
}

async function readStaffRecords(snapshotPath, overridesPath) {
  try {
    const saved = JSON.parse(await fs.readFile(overridesPath || STAFF_OVERRIDES_PATH, "utf8"));
    if (Array.isArray(saved.records)) return saved.records.map(function(record) { return normalizeStaffRecord(record); });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const snapshot = await readSnapshot(snapshotPath || SNAPSHOT_PATH);
  return sourceStaffRecords(snapshot);
}

async function saveStaffRecords(records, overridesPath) {
  const target = overridesPath || STAFF_OVERRIDES_PATH;
  const temporary = target + ".tmp";
  await fs.writeFile(temporary, JSON.stringify({ records: records, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await fs.rename(temporary, target);
}

function changeLogValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return "Изменены значения";
  return String(value);
}

function flattenChangeValue(value, prefix, result) {
  const target = result || {};
  const pathPart = prefix || [];
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    target[pathPart.join(" / ")] = value;
    return target;
  }
  const keys = Object.keys(value);
  if (!keys.length) {
    target[pathPart.join(" / ")] = value;
    return target;
  }
  keys.forEach(function(key) {
    flattenChangeValue(value[key], pathPart.concat(key), target);
  });
  return target;
}

function fieldChanges(label, beforeValue, afterValue) {
  if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return [];
  const hasNestedValues = beforeValue && afterValue && typeof beforeValue === "object" && typeof afterValue === "object";
  if (!hasNestedValues) {
    return [{ field: label, before: changeLogValue(beforeValue), after: changeLogValue(afterValue) }];
  }
  const beforeLeaves = flattenChangeValue(beforeValue);
  const afterLeaves = flattenChangeValue(afterValue);
  return Array.from(new Set(Object.keys(beforeLeaves).concat(Object.keys(afterLeaves))))
    .filter(function(key) { return JSON.stringify(beforeLeaves[key]) !== JSON.stringify(afterLeaves[key]); })
    .map(function(key) {
      return {
        field: key ? label + " · " + key : label,
        before: changeLogValue(beforeLeaves[key]),
        after: changeLogValue(afterLeaves[key])
      };
    });
}

function recordChanges(before, after, fields) {
  return Object.keys(fields).reduce(function(result, field) {
    const beforeValue = before && before[field];
    const afterValue = after && after[field];
    return result.concat(fieldChanges(fields[field], beforeValue, afterValue));
  }, []);
}

async function readChangeLog(changeLogPath) {
  try {
    const saved = JSON.parse(await fs.readFile(changeLogPath || CHANGE_LOG_PATH, "utf8"));
    return Array.isArray(saved.entries) ? saved.entries : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function appendChangeLog(entry, changeLogPath) {
  const target = changeLogPath || CHANGE_LOG_PATH;
  const entries = await readChangeLog(target);
  entries.unshift(Object.assign({
    id: "change-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    changedAt: new Date().toISOString()
  }, entry));
  const temporary = target + ".tmp";
  await fs.writeFile(temporary, JSON.stringify({ entries: entries.slice(0, 3000) }, null, 2), "utf8");
  await fs.rename(temporary, target);
}

function logRecordChange(entity, record, action, changes, directory, changeLogPath) {
  if (action === "updated" && !changes.length) return Promise.resolve();
  return appendChangeLog({
    entity: entity,
    directory: directory || "",
    recordId: String(record.id),
    recordLabel: String(record.name || record.employee || record.resource || record.article || record.id),
    action: action,
    changes: changes || []
  }, changeLogPath);
}

function validateStaffRecord(body, directories) {
  const errors = {};
  if (!String(body.employee || "").trim()) errors.employee = "Укажите сотрудника";
  if (!String(body.project || "").trim()) errors.project = "Укажите проект";
  else if (!isActiveReference(directories, "projects", body.project)) errors.project = "Выберите активный проект из НСИ";
  if (!String(body.role || "").trim()) errors.role = "Укажите роль";
  else if (!isActiveReference(directories, "roles", body.role)) errors.role = "Выберите активную роль из НСИ";
  if (String(body.provider || "").trim() && !isActiveReference(directories, "providers", body.provider)) errors.provider = "Выберите активного поставщика из НСИ";
  const actual = body.hoursActual && typeof body.hoursActual === "object" ? body.hoursActual : {};
  Object.keys(actual).forEach(function(year) {
    const months = actual[year] && typeof actual[year] === "object" ? actual[year] : {};
    Object.keys(months).forEach(function(month) {
      const value = Number(months[month]);
      if (!Number.isFinite(value) || value < 0) errors.hoursActual = "Фактические часы по месяцам должны быть неотрицательными числами";
    });
  });
  return errors;
}

function validateStaffPlanAssignment(body, directories, teamRecords) {
  const errors = {};
  const employeeKey = normalizeReferenceKey(body.employee);
  const projectKey = normalizeReferenceKey(body.project);
  const roleKey = normalizeReferenceKey(body.role);
  if (!employeeKey || !projectKey || !roleKey) return errors;
  const assignments = applyReferencesToTeamRecords(teamRecords, directories).filter(function(record) {
    return !record.archived && record.source === "Штат" && normalizeReferenceKey(record.employee) === employeeKey;
  });
  if (!assignments.length) {
    errors.employee = "Выберите сотрудника из активного плана «Штат» на вкладке 06";
    return errors;
  }
  const projectAssignments = assignments.filter(function(record) { return normalizeReferenceKey(record.project) === projectKey; });
  if (!projectAssignments.length) {
    errors.project = "Проект должен соответствовать выбранному сотруднику на вкладке 06";
  } else if (!projectAssignments.some(function(record) { return normalizeReferenceKey(record.role) === roleKey; })) {
    errors.role = "Роль должна соответствовать выбранному сотруднику и проекту на вкладке 06";
  }
  return errors;
}

function sourceTeamRecords(snapshot) {
  return (((snapshot.team || {}).resourcePlan) || []).map(function(record, index) {
    return normalizeTeamRecord(record, record.id || "model-" + (index + 1), "model");
  });
}

async function readTeamRecords(snapshotPath, overridesPath) {
  try {
    const saved = JSON.parse(await fs.readFile(overridesPath || TEAM_OVERRIDES_PATH, "utf8"));
    if (Array.isArray(saved.records)) return saved.records.map(function(record) { return normalizeTeamRecord(record); });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const snapshot = await readSnapshot(snapshotPath || SNAPSHOT_PATH);
  return sourceTeamRecords(snapshot);
}

async function saveTeamRecords(records, overridesPath) {
  const target = overridesPath || TEAM_OVERRIDES_PATH;
  const temporary = target + ".tmp";
  await fs.writeFile(temporary, JSON.stringify({ records: records, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await fs.rename(temporary, target);
}

function validateTeamRecord(body, directories, allowLegacyVendor) {
  const errors = {};
  if (!String(body.employee || "").trim()) errors.employee = "Укажите сотрудника / ресурс";
  if (!String(body.project || "").trim()) errors.project = "Укажите проект";
  else if (!isActiveReference(directories, "projects", body.project)) errors.project = "Выберите активный проект из НСИ";
  if (!String(body.role || "").trim()) errors.role = "Укажите роль";
  else if (!isActiveReference(directories, "roles", body.role)) errors.role = "Выберите активную роль из НСИ";
  const hasVendor = Boolean(String(body.vendor || "").trim());
  if (!hasVendor && !allowLegacyVendor) errors.vendor = "Выберите поставщика";
  else if (hasVendor && !isActiveReference(directories, "vendors", body.vendor)) errors.vendor = "Выберите активного поставщика из НСИ";
  const resource = findReferenceRecord(directories, "resources", body.employee);
  if (!resource) errors.employee = "Выберите сотрудника / ресурс из НСИ";
  else if (resource.archived) errors.employee = "Выберите активного сотрудника / ресурс из НСИ";
  else if (hasVendor && resource.vendor !== body.vendor) errors.employee = "Сотрудник / ресурс должен быть связан с выбранным поставщиком";
  if (!["Штат", "Подряд"].includes(body.source)) errors.vendor = "У выбранного поставщика не указан корректный тип";
  ["rate", "attraction"].forEach(function(field) {
    if (body[field] === undefined) return;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) errors[field] = "Укажите неотрицательное число";
  });
  const plan = body.hoursPlan && typeof body.hoursPlan === "object" ? body.hoursPlan : {};
  Object.keys(plan).forEach(function(year) {
    const months = plan[year] && typeof plan[year] === "object" ? plan[year] : {};
    Object.keys(months).forEach(function(month) {
      const value = Number(months[month]);
      if (!Number.isFinite(value) || value < 0) errors.hoursPlan = "Часы по месяцам должны быть неотрицательными числами";
    });
  });
  const costPlan = body.costPlan && typeof body.costPlan === "object" ? body.costPlan : {};
  Object.keys(costPlan).forEach(function(year) {
    const months = costPlan[year] && typeof costPlan[year] === "object" ? costPlan[year] : {};
    Object.keys(months).forEach(function(month) {
      const value = months[month] && typeof months[month] === "object" ? months[month] : {};
      ["rate", "attraction"].forEach(function(field) {
        const amount = Number(value[field]);
        if (!Number.isFinite(amount) || amount < 0) errors.costPlan = "Ставка и привлечение по месяцам должны быть неотрицательными числами";
      });
    });
  });
  return errors;
}

function teamSourceForVendor(vendor, directories) {
  const record = findReferenceRecord(directories, "vendors", vendor);
  return record && ["Штат", "Подряд"].includes(record.providerType) ? record.providerType : "";
}

function normalizeReferenceKey(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter(function(value) {
    const key = normalizeReferenceKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceReferenceRecord(directory, value, index, extra) {
  const sourceValue = String(value == null ? "" : value).trim();
  return Object.assign({
    id: "source-" + directory + "-" + index,
    name: sourceValue,
    value: "",
    sourceKey: normalizeReferenceKey(sourceValue),
    sourceValues: [sourceValue],
    archived: false,
    deleted: false
  }, extra || {});
}

function buildReferenceDirectories(snapshot, subcontracts) {
  const reference = snapshot.reference || {};
  const projectValues = uniqueValues((reference.projects || []).concat(snapshot.projects || []).concat((snapshot.cashReceipts || []).map(function(item) { return item.project; })).concat((snapshot.staffResources || []).map(function(item) { return item.project; })).concat((snapshot.team && snapshot.team.roster || []).map(function(item) { return item.project; })).concat((snapshot.team && snapshot.team.resourcePlan || []).map(function(item) { return item.project; })).concat((subcontracts || []).map(function(item) { return item.project; })));
  const roleValues = uniqueValues((reference.roles || []).concat((snapshot.staffResources || []).map(function(item) { return item.role; })).concat((snapshot.team && snapshot.team.roles || []).map(function(item) { return item.role; })).concat((snapshot.team && snapshot.team.roster || []).map(function(item) { return item.role; })).concat((snapshot.team && snapshot.team.resourcePlan || []).map(function(item) { return item.role; })));
  const vendorValues = uniqueValues((subcontracts || []).map(function(item) { return item.vendor; }));
  const resourceValues = uniqueValues((snapshot.staffResources || []).map(function(item) { return item.employee; }).concat((snapshot.team && snapshot.team.roster || []).map(function(item) { return item.employee; })).concat((snapshot.team && snapshot.team.resourcePlan || []).map(function(item) { return item.employee; })));
  return {
    roles: uniqueValues(roleValues).map(function(value, index) { return sourceReferenceRecord("roles", value, index); }),
    projects: projectValues.map(function(value, index) { return sourceReferenceRecord("projects", value, index); }),
    vendors: vendorValues.map(function(value, index) { return sourceReferenceRecord("vendors", value, index, { providerType: "Подряд" }); }),
    providers: [
      sourceReferenceRecord("providers", "Штат", 0, { parent: "" }),
      sourceReferenceRecord("providers", "Подряд", 1, { parent: "" })
    ],
    resources: resourceValues.map(function(value, index) { return sourceReferenceRecord("resources", value, index, { vendor: "" }); })
  };
}

function normalizeReferenceRecord(directory, record) {
  const sourceValues = Array.isArray(record.sourceValues) ? record.sourceValues.map(function(item) { return String(item); }) : [];
  const name = String(record.name == null ? "" : record.name).trim();
  return {
    id: String(record.id),
    name: name,
    value: "",
    parent: "",
    providerType: directory === "vendors" ? String(record.providerType == null ? "" : record.providerType).trim() : (directory === "otherSubcontracts" ? "Подряд" : ""),
    vendor: directory === "resources" ? String(record.vendor == null ? "" : record.vendor).trim() : "",
    costPlan: directory === "resources" ? normalizeCostPlan(record.costPlan, record.rate, record.attraction) : undefined,
    vatPlan: directory === "vendors" || directory === "otherSubcontracts" ? normalizeVatPlan(record.vatPlan) : undefined,
    category: directory === "otherSubcontracts" ? String(record.category == null ? "" : record.category).trim() : "",
    sourceKey: String(record.sourceKey || normalizeReferenceKey(name)),
    sourceValues: sourceValues.length ? sourceValues : (name ? [name] : []),
    archived: Boolean(record.archived),
    deleted: Boolean(record.deleted)
  };
}

function mergeReferenceDirectories(base, saved) {
  const savedDirectories = saved && saved.directories || {};
  return Object.keys(REFERENCE_DIRECTORIES).reduce(function(result, directory) {
    const rawRecords = savedDirectories[directory] || [];
    const savedRecords = (directory === "providers" ? rawRecords.filter(function(item) { return !item.parent; }) : rawRecords).map(function(item) { return normalizeReferenceRecord(directory, item); });
    const records = savedRecords;
    const knownSourceKeys = new Set(records.map(function(item) { return item.sourceKey; }));
    (base[directory] || []).forEach(function(item) {
      if (!knownSourceKeys.has(item.sourceKey)) records.push(item);
    });
    if (directory === "vendors") {
      records.forEach(function(record) {
        if (record.providerType) return;
        const sourceRecord = (base.vendors || []).find(function(item) { return item.sourceKey === record.sourceKey; });
        record.providerType = sourceRecord ? sourceRecord.providerType : "Подряд";
      });
    }
    if (directory === "resources") {
      records.forEach(function(record) {
        if (!record.vendor) record.vendor = "";
      });
    }
    result[directory] = records;
    return result;
  }, {});
}

async function readReferenceDirectories(snapshotPath, subcontractOverridesPath, referenceOverridesPath) {
  const snapshot = await readSnapshot(snapshotPath || SNAPSHOT_PATH);
  const subcontracts = await readSubcontractRecords(snapshotPath || SNAPSHOT_PATH, subcontractOverridesPath || SUBCONTRACT_OVERRIDES_PATH);
  let saved = null;
  try {
    saved = JSON.parse(await fs.readFile(referenceOverridesPath || REFERENCE_OVERRIDES_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return mergeReferenceDirectories(buildReferenceDirectories(snapshot, subcontracts), saved);
}

async function saveReferenceDirectories(directories, referenceOverridesPath) {
  const target = referenceOverridesPath || REFERENCE_OVERRIDES_PATH;
  const temporary = target + ".tmp";
  await fs.writeFile(temporary, JSON.stringify({ directories: directories, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await fs.rename(temporary, target);
}

function referenceValues(record) {
  const values = [record.name].concat(record.sourceValues || []);
  return values.map(normalizeReferenceKey).filter(Boolean);
}

function findReferenceRecord(directories, directory, value) {
  const key = normalizeReferenceKey(value);
  return (directories[directory] || []).find(function(record) {
    return !record.deleted && referenceValues(record).includes(key);
  });
}

function isActiveReference(directories, directory, value) {
  const record = findReferenceRecord(directories, directory, value);
  return record && !record.archived;
}

function referenceUsage(snapshot, subcontracts, directory, record, teamRecords, directories, otherSubcontractRecords) {
  const values = new Set(referenceValues(record));
  const matches = function(value) { return values.has(normalizeReferenceKey(value)); };
  if (directory === "vendors") return (subcontracts || []).some(function(item) { return matches(item.vendor); }) || (teamRecords || []).some(function(item) { return matches(item.vendor); }) || ((directories && directories.resources) || []).some(function(item) { return !item.deleted && matches(item.vendor); });
  if (directory === "providers") return (teamRecords || []).some(function(item) { return matches(item.provider); }) || ((directories && directories.vendors) || []).some(function(item) { return !item.deleted && matches(item.providerType); });
  if (directory === "resources") return (teamRecords || []).some(function(item) { return matches(item.employee); }) || (subcontracts || []).some(function(item) { return matches(item.resource); });
  if (directory === "projects") return (snapshot.cashReceipts || []).some(function(item) { return matches(item.project); }) || (snapshot.staffResources || []).some(function(item) { return matches(item.project); }) || ((snapshot.team && snapshot.team.roster) || []).some(function(item) { return matches(item.project); }) || ((snapshot.team && snapshot.team.resourcePlan) || []).some(function(item) { return matches(item.project); }) || (subcontracts || []).some(function(item) { return matches(item.project); }) || (otherSubcontractRecords || []).some(function(item) { return matches(item.project); });
  if (directory === "roles") return (snapshot.staffResources || []).some(function(item) { return matches(item.role); }) || ((snapshot.team && snapshot.team.roles) || []).some(function(item) { return matches(item.role); }) || ((snapshot.team && snapshot.team.roster) || []).some(function(item) { return matches(item.role); }) || ((snapshot.team && snapshot.team.resourcePlan) || []).some(function(item) { return matches(item.role); });
  if (directory === "otherSubcontracts") return (otherSubcontractRecords || []).some(function(item) { return matches(item.otherSubcontract); });
  return false;
}

function validateReference(directory, body, records, editingId, directories) {
  const errors = {};
  const name = String(body.name || "").trim();
  const providerType = String(body.providerType == null ? "" : body.providerType).trim();
  const vendor = String(body.vendor == null ? "" : body.vendor).trim();
  if (!name) errors.name = "Укажите наименование";
  const duplicate = (records || []).some(function(record) {
    return !record.deleted && record.id !== editingId && normalizeReferenceKey(record.name) === normalizeReferenceKey(name);
  });
  if (!errors.name && duplicate) errors.name = "Такая запись уже есть в справочнике";
  if (directory === "vendors") {
    if (!providerType) errors.providerType = "Выберите тип поставщика";
    else if (!isActiveReference(directories || {}, "providers", providerType)) errors.providerType = "Выберите активный тип поставщика";
  }
  if (directory === "resources") {
    if (!vendor) errors.vendor = "Выберите поставщика";
    else if (!isActiveReference(directories || {}, "vendors", vendor)) errors.vendor = "Выберите активного поставщика из НСИ";
    const costPlan = body.costPlan && typeof body.costPlan === "object" ? body.costPlan : {};
    Object.keys(costPlan).forEach(function(year) {
      Object.keys(costPlan[year] || {}).forEach(function(month) {
        const item = costPlan[year][month] || {};
        if (Number(item.rate) < 0 || Number(item.attraction) < 0 || !Number.isFinite(Number(item.rate)) || !Number.isFinite(Number(item.attraction))) errors.costPlan = "Ставка и привлечение должны быть неотрицательными числами";
      });
    });
  }
  if ((directory === "vendors" && providerType === "Подряд") || directory === "otherSubcontracts") {
    const vatPlan = body.vatPlan && typeof body.vatPlan === "object" ? body.vatPlan : {};
    Object.keys(vatPlan).forEach(function(year) {
      Object.keys(vatPlan[year] || {}).forEach(function(month) {
        const value = Number(vatPlan[year][month]);
        if (!Number.isFinite(value) || !VAT_RATES.includes(value)) errors.vatPlan = "Допустимые ставки НДС: 0, 5, 7, 10 или 22%";
      });
    });
  }
  if (directory === "otherSubcontracts" && !["Основные", "Косвенные", "Прочие"].includes(String(body.category || "").trim())) {
    errors.category = "Выберите категорию: «Основные», «Косвенные» или «Прочие»";
  }
  return errors;
}

function publicReferenceDirectories(directories) {
  return Object.keys(REFERENCE_DIRECTORIES).reduce(function(result, directory) {
    result[directory] = {
      title: REFERENCE_DIRECTORIES[directory].title,
      records: (directories[directory] || []).filter(function(record) { return !record.deleted; }).map(function(record) {
        if (directory !== "resources") return record;
        const supplier = findReferenceRecord(directories, "vendors", record.vendor);
        return Object.assign({}, record, { providerType: supplier ? supplier.providerType : "" });
      })
    };
    return result;
  }, {});
}

function resolvedReferenceName(directories, directory, value) {
  const record = findReferenceRecord(directories, directory, value);
  return record ? record.name : value;
}

function applyReferencesToSubcontracts(records, directories) {
  return (records || []).map(function(record) {
    return Object.assign({}, record, {
      project: resolvedReferenceName(directories, "projects", record.project),
      vendor: resolvedReferenceName(directories, "vendors", record.vendor),
      resource: resolvedReferenceName(directories, "resources", record.resource)
    });
  });
}

function applyReferencesToTeamRecords(records, directories) {
  return (records || []).map(function(record) {
    const resource = findReferenceRecord(directories, "resources", record.employee);
    const costPlan = resource && resource.costPlan ? resource.costPlan : record.costPlan;
    const vendor = resource && resource.vendor ? resource.vendor : record.vendor;
    const firstCost = costPlan && costPlan["2026"] && costPlan["2026"]["1"];
    return Object.assign({}, record, {
      project: resolvedReferenceName(directories, "projects", record.project),
      role: resolvedReferenceName(directories, "roles", record.role),
      vendor: resolvedReferenceName(directories, "vendors", vendor),
      provider: resolvedReferenceName(directories, "providers", record.provider),
      costPlan: costPlan,
      rate: firstCost ? Number(firstCost.rate) : record.rate,
      attraction: firstCost ? Number(firstCost.attraction) : record.attraction,
      cost: firstCost ? Number(firstCost.rate) + Number(firstCost.attraction) : record.cost
    });
  });
}

function applyReferencesToStaffRecords(records, directories) {
  return (records || []).map(function(record) {
    return Object.assign({}, record, {
      project: resolvedReferenceName(directories, "projects", record.project),
      role: resolvedReferenceName(directories, "roles", record.role)
    });
  });
}

function applyReferencesToSnapshot(snapshot, directories) {
  const result = JSON.parse(JSON.stringify(snapshot));
  result.projects = (result.projects || []).map(function(value) { return resolvedReferenceName(directories, "projects", value); });
  if (result.reference) {
    result.reference.projects = (result.reference.projects || []).map(function(value) { return resolvedReferenceName(directories, "projects", value); });
    result.reference.roles = (result.reference.roles || []).map(function(value) { return resolvedReferenceName(directories, "roles", value); });
  }
  (result.cashReceipts || []).forEach(function(item) { item.project = resolvedReferenceName(directories, "projects", item.project); });
  (result.staffResources || []).forEach(function(item) {
    item.project = resolvedReferenceName(directories, "projects", item.project);
    item.role = resolvedReferenceName(directories, "roles", item.role);
  });
  if (result.team) {
    (result.team.roles || []).forEach(function(item) { item.role = resolvedReferenceName(directories, "roles", item.role); });
    (result.team.roster || []).forEach(function(item) {
      item.project = resolvedReferenceName(directories, "projects", item.project);
      item.role = resolvedReferenceName(directories, "roles", item.role);
    });
    result.team.resourcePlan = applyReferencesToTeamRecords(result.team.resourcePlan || [], directories);
  }
  return result;
}

async function readSubcontractRecords(snapshotPath, overridesPath) {
  try {
    const raw = await fs.readFile(overridesPath || SUBCONTRACT_OVERRIDES_PATH, "utf8");
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.records)) return saved.records.map(function(record) { return normalizeSubcontract(record, record.id, record.source); });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const snapshot = await readSnapshot(snapshotPath || SNAPSHOT_PATH);
  return flattenSubcontracts(snapshot.subcontracts);
}

async function saveSubcontractRecords(records, overridesPath) {
  const target = overridesPath || SUBCONTRACT_OVERRIDES_PATH;
  const temporary = target + ".tmp";
  await fs.writeFile(temporary, JSON.stringify({ records: records, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await fs.rename(temporary, target);
}

async function readOtherSubcontractRecords(overridesPath) {
  const target = overridesPath || OTHER_SUBCONTRACT_OVERRIDES_PATH;
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = parseOtherSubcontractStorage(raw);
    const saved = parsed.value;
    if (parsed.recovered) {
      const backupDirectory = path.join(path.dirname(target), "backups");
      await fs.mkdir(backupDirectory, { recursive: true });
      const backup = path.join(backupDirectory, path.basename(target) + ".corrupt-" + Date.now() + ".json");
      await fs.writeFile(backup, raw, "utf8");
      await saveOtherSubcontractRecords(saved.records || [], target);
    }
    if (Array.isArray(saved.records)) return saved.records.map(function(record) {
      return normalizeOtherSubcontractRecord(record, record.id, record.source);
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return [];
}

function parseOtherSubcontractStorage(raw) {
  try {
    return { value: JSON.parse(raw), recovered: false };
  } catch (error) {
    const start = String(raw || "").search(/\S/);
    if (start < 0 || raw[start] !== "{") throw error;
    let depth = 0;
    let quote = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quote = false;
        continue;
      }
      if (character === '"') quote = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const value = JSON.parse(raw.slice(start, index + 1));
          if (value && Array.isArray(value.records)) return { value: value, recovered: true };
          break;
        }
      }
    }
    throw error;
  }
}

async function saveOtherSubcontractRecords(records, overridesPath) {
  const target = overridesPath || OTHER_SUBCONTRACT_OVERRIDES_PATH;
  const temporary = target + "." + process.pid + "." + Date.now() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify({ records: records, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await fs.rename(temporary, target);
}

function validateAmountPlan(amountPlan, field, errors) {
  const source = amountPlan && typeof amountPlan === "object" ? amountPlan : {};
  Object.keys(source).forEach(function(year) {
    Object.keys(source[year] || {}).forEach(function(month) {
      const value = Number(source[year][month]);
      if (!Number.isFinite(value) || value < 0) errors[field] = "Суммы по месяцам должны быть неотрицательными числами";
    });
  });
}

function validateOtherSubcontractRecord(body, directories) {
  const errors = {};
  if (!String(body.otherSubcontract || "").trim()) errors.otherSubcontract = "Выберите статью или подрядчика";
  else if (!isActiveReference(directories, "otherSubcontracts", body.otherSubcontract)) errors.otherSubcontract = "Выберите активную статью или подрядчика из НСИ";
  if (!String(body.project || "").trim()) errors.project = "Выберите проект";
  else if (!isActiveReference(directories, "projects", body.project)) errors.project = "Выберите активный проект из НСИ";
  validateAmountPlan(body.plan, "plan", errors);
  validateAmountPlan(body.fact, "fact", errors);
  return errors;
}

function otherSubcontractVatRate(directories, otherSubcontract, year, month) {
  const reference = findReferenceRecord(directories, "otherSubcontracts", otherSubcontract);
  const value = Number(reference && reference.vatPlan && reference.vatPlan[String(year)] && reference.vatPlan[String(year)][String(month)]);
  return VAT_RATES.includes(value) ? value : 0;
}

function calculateOtherSubcontractRecord(record, directories) {
  return ["plan", "fact"].reduce(function(result, kind) {
    const plan = record[kind] && typeof record[kind] === "object" ? record[kind] : {};
    result[kind] = Object.keys(plan).reduce(function(years, year) {
      const months = plan[year] && typeof plan[year] === "object" ? plan[year] : {};
      years[String(year)] = Array.from({ length: 12 }, function(_, index) {
        const month = String(index + 1);
        const sum = Number(months[month]) || 0;
        const vatRate = otherSubcontractVatRate(directories, record.otherSubcontract, year, month);
        const vat = sum * vatRate / 100;
        return [month, { sum: sum, vatRate: vatRate, vat: vat, cost: sum + vat }];
      }).reduce(function(values, entry) { values[entry[0]] = entry[1]; return values; }, {});
      return years;
    }, {});
    return result;
  }, {});
}

function applyReferencesToOtherSubcontractRecords(records, directories) {
  return (records || []).map(function(record) {
    return Object.assign({}, record, {
      otherSubcontract: resolvedReferenceName(directories, "otherSubcontracts", record.otherSubcontract),
      project: resolvedReferenceName(directories, "projects", record.project),
      calculated: calculateOtherSubcontractRecord(record, directories)
    });
  });
}

function validateSubcontract(body) {
  const errors = {};
  if (!String(body.resource || "").trim()) errors.resource = "Выберите ресурс подрядчика";
  if (!String(body.project || "").trim()) errors.project = "Укажите проект";
  if (!String(body.article || "").trim()) errors.article = "Укажите статью";
  if (!/^\d{4}-\d{2}$/.test(String(body.period || ""))) errors.period = "Выберите месяц";
  ["amount", "rate"].forEach(function(field) {
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) errors[field] = "Укажите неотрицательное число";
  });
  if (body.actualHours !== undefined) {
    const actualHours = Number(body.actualHours);
    if (!Number.isFinite(actualHours) || actualHours < 0) errors.actualHours = "Укажите неотрицательное число";
  }
  return errors;
}

function validateSubcontractResource(body, directories, teamRecords) {
  const errors = {};
  const resourceKey = normalizeReferenceKey(body.resource);
  const projectKey = normalizeReferenceKey(body.project);
  if (!resourceKey || !projectKey) return errors;
  const resource = findReferenceRecord(directories, "resources", body.resource);
  if (!resource || resource.archived) {
    errors.resource = "Выберите активный ресурс подрядчика из НСИ";
    return errors;
  }
  const supplier = findReferenceRecord(directories, "vendors", resource.vendor);
  if (!supplier || supplier.archived || supplier.providerType !== "Подряд") {
    errors.resource = "У выбранного ресурса поставщик должен иметь активный тип «Подряд»";
    return errors;
  }
  const assignments = applyReferencesToTeamRecords(teamRecords || [], directories).filter(function(record) {
    return !record.archived && normalizeReferenceKey(record.employee) === resourceKey;
  });
  if (!assignments.length) {
    errors.resource = "Выберите ресурс подрядчика из активного плана команды на вкладке 06";
  } else if (!assignments.some(function(record) { return normalizeReferenceKey(record.project) === projectKey; })) {
    errors.project = "Проект должен соответствовать выбранному ресурсу подрядчика на вкладке 06";
  }
  return errors;
}

function validateSubcontractReferences(body, directories, teamRecords) {
  const errors = validateSubcontract(body);
  if (!errors.project && !isActiveReference(directories, "projects", body.project)) errors.project = "Выберите активный проект из НСИ";
  if (String(body.vendor || "").trim() && !isActiveReference(directories, "vendors", body.vendor)) errors.vendor = "Выберите активного поставщика из НСИ";
  return Object.assign(errors, validateSubcontractResource(body, directories, teamRecords));
}

function normalizeSubcontract(body, id, source) {
  const amount = Number(body.amount);
  const rate = Number(body.rate);
  const actualHours = Number(body.actualHours);
  return {
    id: id,
    source: source || "local",
    resource: String(body.resource || "").trim(),
    project: String(body.project).trim(),
    vendor: String(body.vendor || "").trim(),
    article: String(body.article).trim(),
    period: String(body.period),
    amount: amount,
    rate: rate,
    estimatedHours: rate ? amount / rate : null,
    actualHours: Number.isFinite(actualHours) && actualHours >= 0 ? actualHours : 0,
    annualActualHours: normalizeAnnualHours(body.annualActualHours),
    archived: Boolean(body.archived)
  };
}

const EXCHANGE_DIRECTORY_LABELS = {
  "проектные роли": "roles",
  "роли": "roles",
  "контракты / проекты": "projects",
  "проекты": "projects",
  "тип поставщика": "providers",
  "поставщики": "vendors",
  "сотрудник / ресурс": "resources",
  "прочий подряд": "otherSubcontracts"
};
const EXCHANGE_DIRECTORY_ORDER = { roles: 1, projects: 2, providers: 3, vendors: 4, resources: 5, otherSubcontracts: 6 };
const EXCHANGE_MONTHS = Array.from({ length: 12 }, function(_, index) { return String(index + 1); });

function exchangeText(value) {
  return String(value == null ? "" : value).trim();
}

function exchangeHasValue(value) {
  return exchangeText(value) !== "";
}

function exchangeNumber(value) {
  if (!exchangeHasValue(value)) return null;
  const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function exchangeYear(value) {
  const year = exchangeText(value);
  return /^\d{4}$/.test(year) ? year : "";
}

function exchangeMonth(value) {
  const month = Number(exchangeText(value));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? String(month) : "";
}

function exchangeKey() {
  return Array.from(arguments).map(normalizeReferenceKey).join("|");
}

function exchangeRecord(records, fields, values) {
  const key = exchangeKey.apply(null, values);
  return (records || []).find(function(record) {
    return !record.deleted && exchangeKey.apply(null, fields.map(function(field) { return record[field]; })) === key;
  });
}

function exchangeActiveReference(directories, directory, value) {
  const record = findReferenceRecord(directories, directory, value);
  return record && !record.archived ? record : null;
}

function exchangeErrorsMessage(errors) {
  return errors.slice(0, 40).join("\n") + (errors.length > 40 ? "\n… всего ошибок: " + errors.length : "");
}

function exchangePushErrors(errors, sheet, rowNumber, validation) {
  Object.keys(validation || {}).forEach(function(field) {
    errors.push("Лист «" + sheet + "», строка " + rowNumber + ": " + validation[field]);
  });
}

function exchangeMonthHours(row, startIndex, errors, sheet, rowNumber) {
  const values = {};
  EXCHANGE_MONTHS.forEach(function(month, index) {
    const source = row[startIndex + index];
    const value = exchangeNumber(source);
    if (value == null) {
      if (exchangeHasValue(source)) errors.push("Лист «" + sheet + "», строка " + rowNumber + ": часы за месяц " + month + " должны быть неотрицательным числом.");
      values[month] = 0;
    } else if (value < 0) {
      errors.push("Лист «" + sheet + "», строка " + rowNumber + ": часы за месяц " + month + " должны быть неотрицательным числом.");
      values[month] = 0;
    } else {
      values[month] = value;
    }
  });
  return values;
}

function exchangeDirectory(value) {
  return EXCHANGE_DIRECTORY_LABELS[normalizeReferenceKey(value)] || "";
}

function exchangeRows(parsed, sheet) {
  return parsed && parsed.sheets && Array.isArray(parsed.sheets[sheet]) ? parsed.sheets[sheet] : [];
}

function exchangeNsiExportRows(directories) {
  const rows = [];
  const activeRecords = function(directory) {
    return (directories[directory] || []).filter(function(record) { return !record.deleted && !record.archived; });
  };
  activeRecords("roles").forEach(function(record) { rows.push(["Проектные роли", record.name, "", "", "", "", "", ""]); });
  activeRecords("projects").forEach(function(record) { rows.push(["Контракты / проекты", record.name, "", "", "", "", "", ""]); });
  activeRecords("providers").forEach(function(record) { rows.push(["Тип поставщика", record.name, "", "", "", "", "", ""]); });
  activeRecords("vendors").forEach(function(record) { rows.push(["Поставщики", record.name, "", record.providerType || "", "", "", "", ""]); });
  activeRecords("resources").forEach(function(record) {
    rows.push(["Сотрудник / ресурс", record.name, record.vendor || "", "", "", "", "", ""]);
    Object.keys(record.costPlan || {}).sort().forEach(function(year) {
      Object.keys(record.costPlan[year] || {}).sort(function(left, right) { return Number(left) - Number(right); }).forEach(function(month) {
        const cost = record.costPlan[year][month] || {};
        const rate = Number(cost.rate || 0);
        const attraction = Number(cost.attraction || 0);
        if (rate || attraction) rows.push(["Сотрудник / ресурс", record.name, record.vendor || "", "", Number(year), Number(month), rate, attraction]);
      });
    });
  });
  return rows;
}

async function buildNsiExportWorkbook(directories) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-nsi-export-"));
  const dataPath = path.join(directory, "nsi.json");
  const outputPath = path.join(directory, "nsi.xlsx");
  try {
    await fs.writeFile(dataPath, JSON.stringify({ rows: exchangeNsiExportRows(directories) }), "utf8");
    await new Promise(function(resolve, reject) {
      const child = spawn(process.execPath, [EXCHANGE_WORKBOOK_BUILDER, outputPath, "--nsi-data", dataPath], {
        cwd: ROOT,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: Object.assign({}, process.env, process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {})
      });
      let errors = "";
      child.stderr.on("data", function(chunk) { errors += chunk.toString(); });
      child.on("error", reject);
      child.on("close", function(code) { code === 0 ? resolve() : reject(new Error(errors.trim() || "Не удалось сформировать Excel-файл НСИ.")); });
    });
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function sendExcel(response, filename, content) {
  response.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
    "Cache-Control": "no-store",
    "Content-Length": content.length
  });
  response.end(content);
}

function exchangeImportReferences(rows, directories, errors, summary) {
  rows.slice().sort(function(left, right) {
    return (EXCHANGE_DIRECTORY_ORDER[exchangeDirectory(left.values[0])] || 99) - (EXCHANGE_DIRECTORY_ORDER[exchangeDirectory(right.values[0])] || 99);
  }).forEach(function(source) {
    const errorCount = errors.length;
    const row = source.values;
    const directory = exchangeDirectory(row[0]);
    const name = exchangeText(row[1]);
    const vendor = exchangeText(row[2]);
    const providerType = exchangeText(row[3]);
    const hasCost = [row[6], row[7]].some(exchangeHasValue);
    if (!directory) errors.push("Лист «НСИ», строка " + source.rowNumber + ": укажите справочник из выпадающего списка.");
    if (!name) errors.push("Лист «НСИ», строка " + source.rowNumber + ": укажите наименование.");
    if (!directory || !name) return;
    if (directory === "providers" && !["Штат", "Подряд"].includes(name)) errors.push("Лист «НСИ», строка " + source.rowNumber + ": тип поставщика может быть только «Штат» или «Подряд».");
    if (directory === "vendors") {
      const provider = exchangeActiveReference(directories, "providers", providerType);
      if (!provider) errors.push("Лист «НСИ», строка " + source.rowNumber + ": для поставщика выберите активный тип «Штат» или «Подряд».");
    }
    if (directory === "resources") {
      const supplier = exchangeActiveReference(directories, "vendors", vendor);
      if (!supplier) errors.push("Лист «НСИ», строка " + source.rowNumber + ": для сотрудника / ресурса укажите активного поставщика.");
    }
    if (hasCost && directory !== "resources") errors.push("Лист «НСИ», строка " + source.rowNumber + ": ставку и привлечение можно указывать только для «Сотрудник / ресурс».");
    const year = exchangeYear(row[4]);
    const month = exchangeMonth(row[5]);
    const rate = exchangeNumber(row[6]);
    const attraction = exchangeNumber(row[7]);
    if (hasCost && (!year || !month)) errors.push("Лист «НСИ», строка " + source.rowNumber + ": для стоимости укажите год и месяц.");
    if (hasCost && ((rate != null && rate < 0) || (attraction != null && attraction < 0) || (exchangeHasValue(row[6]) && rate == null) || (exchangeHasValue(row[7]) && attraction == null))) errors.push("Лист «НСИ», строка " + source.rowNumber + ": ставка и привлечение должны быть неотрицательными числами.");
    if (errors.length > errorCount) return;
    let record = findReferenceRecord(directories, directory, name);
    if (record && record.archived) {
      errors.push("Лист «НСИ», строка " + source.rowNumber + ": значение «" + name + "» находится в архиве и недоступно для изменения.");
      return;
    }
    if (!record) {
      const id = "import-" + directory + "-" + Date.now() + "-" + source.rowNumber;
      record = normalizeReferenceRecord(directory, { id: id, name: name, providerType: providerType, vendor: vendor, sourceKey: id, sourceValues: [name], archived: false, deleted: false });
      directories[directory].push(record);
    }
    if (directory === "vendors") record.providerType = exchangeActiveReference(directories, "providers", providerType).name;
    if (directory === "resources") record.vendor = exchangeActiveReference(directories, "vendors", vendor).name;
    if (hasCost && year && month) {
      record.costPlan = normalizeCostPlan(record.costPlan, 0, 0);
      record.costPlan[year] = record.costPlan[year] || {};
      record.costPlan[year][month] = { rate: rate == null ? 0 : rate, attraction: attraction == null ? 0 : attraction };
    }
    summary.references += 1;
  });
}

function exchangeImportTeam(rows, directories, records, errors, summary) {
  rows.forEach(function(source) {
    const row = source.values;
    const employee = exchangeText(row[0]);
    const vendor = exchangeText(row[1]);
    const project = exchangeText(row[2]);
    const role = exchangeText(row[3]);
    const year = exchangeYear(row[4]);
    if (!employee || !vendor || !project || !role || !year) {
      errors.push("Лист «Команда», строка " + source.rowNumber + ": заполните сотрудника / ресурс, поставщика, проект, роль и год.");
      return;
    }
    const months = exchangeMonthHours(row, 5, errors, "Команда", source.rowNumber);
    const resource = exchangeActiveReference(directories, "resources", employee);
    const supplier = exchangeActiveReference(directories, "vendors", vendor);
    const activeProject = exchangeActiveReference(directories, "projects", project);
    const activeRole = exchangeActiveReference(directories, "roles", role);
    if (!resource || !supplier || !activeProject || !activeRole) {
      errors.push("Лист «Команда», строка " + source.rowNumber + ": сотрудник / ресурс, поставщик, проект и роль должны быть активны в НСИ.");
      return;
    }
    const existing = exchangeRecord(records, ["employee", "project", "role"], [resource.name, activeProject.name, activeRole.name]);
    const body = Object.assign({}, existing || {}, { employee: resource.name, vendor: supplier.name, project: activeProject.name, role: activeRole.name, source: supplier.providerType, hoursPlan: Object.assign({}, existing && existing.hoursPlan || {}, { [year]: months }) });
    const validation = validateTeamRecord(body, directories);
    if (Object.keys(validation).length) {
      exchangePushErrors(errors, "Команда", source.rowNumber, validation);
      return;
    }
    const record = normalizeTeamRecord(body, existing ? existing.id : "import-team-" + Date.now() + "-" + source.rowNumber, existing ? existing.origin : "local");
    if (existing) records[records.indexOf(existing)] = record;
    else records.push(record);
    summary.team += 1;
  });
}

function exchangeImportStaff(rows, directories, teamRecords, records, errors, summary) {
  rows.forEach(function(source) {
    const row = source.values;
    const employee = exchangeText(row[0]);
    const project = exchangeText(row[1]);
    const role = exchangeText(row[2]);
    const year = exchangeYear(row[3]);
    if (!employee || !project || !role || !year) {
      errors.push("Лист «Суммы и часы штат», строка " + source.rowNumber + ": заполните сотрудника / ресурс, проект, роль и год.");
      return;
    }
    const months = exchangeMonthHours(row, 4, errors, "Суммы и часы штат", source.rowNumber);
    const activeProject = exchangeActiveReference(directories, "projects", project);
    const activeRole = exchangeActiveReference(directories, "roles", role);
    if (!activeProject || !activeRole) {
      errors.push("Лист «Суммы и часы штат», строка " + source.rowNumber + ": проект и роль должны быть активны в НСИ.");
      return;
    }
    const existing = exchangeRecord(records, ["employee", "project", "role"], [employee, activeProject.name, activeRole.name]);
    const body = Object.assign({}, existing || {}, { employee: employee, project: activeProject.name, role: activeRole.name, hoursActual: Object.assign({}, existing && existing.hoursActual || {}, { [year]: months }) });
    const validation = Object.assign({}, validateStaffRecord(body, directories), validateStaffPlanAssignment(body, directories, teamRecords));
    if (Object.keys(validation).length) {
      exchangePushErrors(errors, "Суммы и часы штат", source.rowNumber, validation);
      return;
    }
    const record = normalizeStaffRecord(body, existing ? existing.id : "import-staff-" + Date.now() + "-" + source.rowNumber, existing ? existing.origin : "local");
    if (existing) records[records.indexOf(existing)] = record;
    else records.push(record);
    summary.staff += 1;
  });
}

function exchangeImportSubcontracts(rows, directories, teamRecords, records, errors, summary) {
  rows.forEach(function(source) {
    const row = source.values;
    const resourceName = exchangeText(row[0]);
    const project = exchangeText(row[1]);
    const article = exchangeText(row[2]);
    const period = exchangeText(row[3]);
    const amount = exchangeNumber(row[4]);
    const rate = exchangeNumber(row[5]);
    const actualHours = exchangeNumber(row[6]);
    if (!resourceName || !project || !article || !/^\d{4}-\d{2}$/.test(period) || amount == null || rate == null) {
      errors.push("Лист «Суммы и часы подряд», строка " + source.rowNumber + ": заполните ресурс, проект, статью, период ГГГГ-ММ, затраты и ставку.");
      return;
    }
    if (amount < 0 || rate < 0 || (actualHours != null && actualHours < 0)) {
      errors.push("Лист «Суммы и часы подряд», строка " + source.rowNumber + ": затраты, ставка и фактические часы должны быть неотрицательными числами.");
      return;
    }
    const resource = exchangeActiveReference(directories, "resources", resourceName);
    const activeProject = exchangeActiveReference(directories, "projects", project);
    if (!resource || !activeProject) {
      errors.push("Лист «Суммы и часы подряд», строка " + source.rowNumber + ": ресурс и проект должны быть активны в НСИ.");
      return;
    }
    const existing = exchangeRecord(records, ["resource", "project", "article", "period"], [resource.name, activeProject.name, article, period]);
    const body = Object.assign({}, existing || {}, { resource: resource.name, vendor: resource.vendor, project: activeProject.name, article: article, period: period, amount: amount, rate: rate, actualHours: actualHours == null ? 0 : actualHours });
    const validation = validateSubcontractReferences(body, directories, teamRecords);
    if (Object.keys(validation).length) {
      exchangePushErrors(errors, "Суммы и часы подряд", source.rowNumber, validation);
      return;
    }
    const record = normalizeSubcontract(body, existing ? existing.id : "import-subcontract-" + Date.now() + "-" + source.rowNumber, existing ? existing.source : "local");
    if (existing) records[records.indexOf(existing)] = record;
    else records.push(record);
    summary.subcontracts += 1;
  });
}

async function parseExchangeWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString("utf8") !== "PK") throw new Error("Загрузите файл Excel в формате .xlsx.");
  if (buffer.length > MAX_EXCHANGE_FILE_SIZE) throw new Error("Размер Excel-файла не должен превышать 12 МБ.");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-exchange-"));
  const input = path.join(directory, "import.xlsx");
  const output = path.join(directory, "import.json");
  try {
    await fs.writeFile(input, buffer);
    const result = await new Promise(function(resolve, reject) {
      const child = spawn(process.execPath, [EXCHANGE_WORKBOOK_PARSER, input, output], {
        cwd: ROOT,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: Object.assign({}, process.env, process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {})
      });
      let errors = "";
      child.stderr.on("data", function(chunk) { errors += chunk.toString(); });
      child.on("error", reject);
      child.on("close", function(code) { code === 0 ? resolve() : reject(new Error(errors.trim() || "Не удалось прочитать Excel-файл.")); });
    });
    return JSON.parse(await fs.readFile(output, "utf8"));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function importDataExchange(parsed, snapshotPath, subcontractOverridesPath, referenceOverridesPath, teamOverridesPath, staffOverridesPath) {
  const source = snapshotPath || SNAPSHOT_PATH;
  const subcontractOverrides = subcontractOverridesPath || SUBCONTRACT_OVERRIDES_PATH;
  const referenceOverrides = referenceOverridesPath || REFERENCE_OVERRIDES_PATH;
  const teamOverrides = teamOverridesPath || TEAM_OVERRIDES_PATH;
  const staffOverrides = staffOverridesPath || STAFF_OVERRIDES_PATH;
  const directories = JSON.parse(JSON.stringify(await readReferenceDirectories(source, subcontractOverrides, referenceOverrides)));
  const teamRecords = JSON.parse(JSON.stringify(await readTeamRecords(source, teamOverrides)));
  const staffRecords = JSON.parse(JSON.stringify(await readStaffRecords(source, staffOverrides)));
  const subcontractRecords = JSON.parse(JSON.stringify(await readSubcontractRecords(source, subcontractOverrides)));
  const errors = [];
  const summary = { references: 0, team: 0, staff: 0, subcontracts: 0 };
  exchangeImportReferences(exchangeRows(parsed, "НСИ"), directories, errors, summary);
  exchangeImportTeam(exchangeRows(parsed, "Команда"), directories, teamRecords, errors, summary);
  exchangeImportStaff(exchangeRows(parsed, "Суммы и часы штат"), directories, teamRecords, staffRecords, errors, summary);
  exchangeImportSubcontracts(exchangeRows(parsed, "Суммы и часы подряд"), directories, teamRecords, subcontractRecords, errors, summary);
  const total = summary.references + summary.team + summary.staff + summary.subcontracts;
  if (!total && !errors.length) errors.push("В файле нет заполненных строк для импорта.");
  if (errors.length) {
    const error = new Error(exchangeErrorsMessage(errors));
    error.statusCode = 422;
    error.details = errors;
    throw error;
  }
  if (summary.references) await saveReferenceDirectories(directories, referenceOverrides);
  if (summary.team) await saveTeamRecords(teamRecords, teamOverrides);
  if (summary.staff) await saveStaffRecords(staffRecords, staffOverrides);
  if (summary.subcontracts) await saveSubcontractRecords(subcontractRecords, subcontractOverrides);
  return summary;
}

function readBody(request) {
  return new Promise(function(resolve, reject) {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", function(chunk) {
      raw += chunk;
      if (raw.length > 18 * 1024 * 1024) {
        reject(new Error("Слишком большой запрос"));
        request.destroy();
      }
    });
    request.on("end", function() {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(new Error("Некорректный JSON")); }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filename = path.resolve(PUBLIC_DIR, "." + requested);
  if (!filename.startsWith(PUBLIC_DIR + path.sep) && filename !== path.join(PUBLIC_DIR, "index.html")) {
    sendError(response, 403, "Доступ запрещён");
    return;
  }
  try {
    const content = await fs.readFile(filename);
    response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filename)] || "application/octet-stream" });
    response.end(content);
  } catch (error) {
    sendError(response, 404, "Страница не найдена");
  }
}

function createServer(snapshotPath, overridesPath, referenceOverridesPath, teamOverridesPath, staffOverridesPath, changeLogPath, otherSubcontractOverridesPath) {
  const source = snapshotPath || SNAPSHOT_PATH;
  const overrides = overridesPath || SUBCONTRACT_OVERRIDES_PATH;
  const referenceOverrides = referenceOverridesPath || REFERENCE_OVERRIDES_PATH;
  const teamOverrides = teamOverridesPath || TEAM_OVERRIDES_PATH;
  const staffOverrides = staffOverridesPath || STAFF_OVERRIDES_PATH;
  const changeLog = changeLogPath || CHANGE_LOG_PATH;
  const otherSubcontractOverrides = otherSubcontractOverridesPath || OTHER_SUBCONTRACT_OVERRIDES_PATH;
  return http.createServer(async function(request, response) {
    const url = new URL(request.url, "http://localhost:" + PORT);
    try {
      if (request.method === "GET" && url.pathname === "/api/change-log") {
        const entity = String(url.searchParams.get("entity") || "");
        const directory = String(url.searchParams.get("directory") || "");
        const recordId = String(url.searchParams.get("recordId") || "");
        const entries = (await readChangeLog(changeLog)).filter(function(entry) {
          return (!entity || entry.entity === entity) && (!directory || entry.directory === directory) && (!recordId || entry.recordId === recordId);
        }).slice(0, 100);
        sendJson(response, 200, { entries: entries });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/data-exchange/export/nsi") {
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const workbook = await buildNsiExportWorkbook(directories);
        sendExcel(response, "Выгрузка_НСИ_бюджетирования.xlsx", workbook);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/model") {
        const snapshot = await readSnapshot(source);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const resolvedSnapshot = applyReferencesToSnapshot(snapshot, directories);
        sendJson(response, 200, { snapshot: resolvedSnapshot, overview: buildOverview(resolvedSnapshot) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/data-exchange/import") {
        try {
          const body = await readBody(request);
          const content = exchangeText(body.content);
          if (!content) throw new Error("Выберите заполненный Excel-файл.");
          const parsed = await parseExchangeWorkbook(Buffer.from(content, "base64"));
          const summary = await importDataExchange(parsed, source, overrides, referenceOverrides, teamOverrides, staffOverrides);
          sendJson(response, 200, { summary: summary, message: "Данные из Excel загружены." });
        } catch (error) {
          sendJson(response, error.statusCode || 400, { error: error.message || "Не удалось загрузить Excel-файл.", details: error.details || [] });
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/subcontracts") {
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readSubcontractRecords(source, overrides);
        sendJson(response, 200, { records: applyReferencesToSubcontracts(records, directories) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/other-subcontracts") {
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readOtherSubcontractRecords(otherSubcontractOverrides);
        sendJson(response, 200, { records: applyReferencesToOtherSubcontractRecords(records, directories) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/references") {
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        sendJson(response, 200, { directories: publicReferenceDirectories(directories) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/team") {
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readTeamRecords(source, teamOverrides);
        sendJson(response, 200, { records: applyReferencesToTeamRecords(records, directories) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/staff") {
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readStaffRecords(source, staffOverrides);
        sendJson(response, 200, { records: applyReferencesToStaffRecords(records, directories) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/staff") {
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const teamRecords = await readTeamRecords(source, teamOverrides);
        const errors = Object.assign({}, validateStaffRecord(body, directories), validateStaffPlanAssignment(body, directories, teamRecords));
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля штатной записи", fields: errors });
          return;
        }
        const records = await readStaffRecords(source, staffOverrides);
        const record = normalizeStaffRecord(body, "local-staff-" + Date.now(), "local");
        records.push(record);
        await saveStaffRecords(records, staffOverrides);
        sendJson(response, 201, { record: applyReferencesToStaffRecords([record], directories)[0] });
        return;
      }
      if (request.method === "PUT" && url.pathname.startsWith("/api/staff/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/staff/".length));
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readStaffRecords(source, staffOverrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Штатная запись не найдена");
          return;
        }
        const existing = records[index];
        const staffBody = Object.assign({}, existing, body);
        const teamRecords = await readTeamRecords(source, teamOverrides);
        const errors = Object.assign({}, validateStaffRecord(staffBody, directories), validateStaffPlanAssignment(staffBody, directories, teamRecords));
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля штатной записи", fields: errors });
          return;
        }
        const record = normalizeStaffRecord(staffBody, id, existing.origin);
        records[index] = record;
        await saveStaffRecords(records, staffOverrides);
        await logRecordChange("staff", record, existing.archived && !record.archived ? "restored" : "updated", recordChanges(existing, record, { employee: "Сотрудник / ресурс", project: "Проект", role: "Роль", hoursActual: "Часы (факт)" }), "", changeLog);
        sendJson(response, 200, { record: applyReferencesToStaffRecords([record], directories)[0] });
        return;
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/staff/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/staff/".length));
        const records = await readStaffRecords(source, staffOverrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Штатная запись не найдена");
          return;
        }
        const record = records[index];
        const used = record.origin === "model";
        if (used) record.archived = true;
        else records.splice(index, 1);
        await saveStaffRecords(records, staffOverrides);
        await logRecordChange("staff", record, used ? "archived" : "deleted", [], "", changeLog);
        sendJson(response, 200, { action: used ? "archived" : "deleted", record: record });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/team") {
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const teamBody = Object.assign({}, body, { source: teamSourceForVendor(body.vendor, directories) });
        const errors = validateTeamRecord(teamBody, directories);
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля записи команды", fields: errors });
          return;
        }
        const records = await readTeamRecords(source, teamOverrides);
        const record = normalizeTeamRecord(teamBody, "local-team-" + Date.now(), "local");
        records.push(record);
        await saveTeamRecords(records, teamOverrides);
        sendJson(response, 201, { record: applyReferencesToTeamRecords([record], directories)[0] });
        return;
      }
      if (request.method === "PUT" && url.pathname.startsWith("/api/team/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/team/".length));
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readTeamRecords(source, teamOverrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Запись команды не найдена");
          return;
        }
        const existing = records[index];
        const combinedBody = Object.assign({}, existing, body, { archived: body.archived === undefined ? existing.archived : Boolean(body.archived) });
        const restoringLegacyRecord = body.archived === false && existing.archived && !combinedBody.vendor;
        combinedBody.source = teamSourceForVendor(combinedBody.vendor, directories) || (restoringLegacyRecord ? existing.source : "");
        const errors = validateTeamRecord(combinedBody, directories, restoringLegacyRecord);
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля записи команды", fields: errors });
          return;
        }
        const record = normalizeTeamRecord(combinedBody, id, existing.origin);
        records[index] = record;
        await saveTeamRecords(records, teamOverrides);
        await logRecordChange("team", record, existing.archived && !record.archived ? "restored" : "updated", recordChanges(existing, record, { employee: "Сотрудник / ресурс", vendor: "Поставщик", project: "Проект", role: "Роль", hoursPlan: "Часы (план)" }), "", changeLog);
        sendJson(response, 200, { record: applyReferencesToTeamRecords([record], directories)[0] });
        return;
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/team/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/team/".length));
        const records = await readTeamRecords(source, teamOverrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Запись команды не найдена");
          return;
        }
        const record = records[index];
        const used = record.origin === "model";
        if (used) record.archived = true;
        else records.splice(index, 1);
        await saveTeamRecords(records, teamOverrides);
        await logRecordChange("team", record, used ? "archived" : "deleted", [], "", changeLog);
        sendJson(response, 200, { action: used ? "archived" : "deleted", record: record });
        return;
      }
      if (url.pathname.startsWith("/api/references/")) {
        const parts = url.pathname.slice("/api/references/".length).split("/").map(decodeURIComponent);
        const directory = parts[0];
        if (!REFERENCE_DIRECTORIES[directory]) {
          sendError(response, 404, "Справочник не найден");
          return;
        }
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = directories[directory];
        if (request.method === "POST" && parts.length === 1) {
          const body = await readBody(request);
          const errors = validateReference(directory, body, records, undefined, directories);
          if (Object.keys(errors).length) {
            sendJson(response, 422, { error: "Проверьте поля справочника", fields: errors });
            return;
          }
          const id = "local-" + directory + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
          const record = normalizeReferenceRecord(directory, {
            id: id,
            name: body.name,
            providerType: body.providerType,
            vendor: body.vendor,
            costPlan: body.costPlan,
            vatPlan: body.vatPlan,
            category: body.category,
            sourceKey: id,
            sourceValues: [String(body.name).trim()],
            archived: false,
            deleted: false
          });
          records.push(record);
          await saveReferenceDirectories(directories, referenceOverrides);
          sendJson(response, 201, { record: record });
          return;
        }
        if (request.method === "PUT" && parts.length === 2) {
          const id = parts[1];
          const index = records.findIndex(function(item) { return item.id === id && !item.deleted; });
          if (index < 0) {
            sendError(response, 404, "Запись справочника не найдена");
            return;
          }
          const body = await readBody(request);
          const errors = validateReference(directory, body, records, id, directories);
          if (Object.keys(errors).length) {
            sendJson(response, 422, { error: "Проверьте поля справочника", fields: errors });
            return;
          }
          const existing = records[index];
          const record = normalizeReferenceRecord(directory, Object.assign({}, existing, {
            name: body.name,
            value: "",
            providerType: directory === "vendors" ? body.providerType : "",
            vendor: directory === "resources" ? body.vendor : "",
            costPlan: directory === "resources" ? body.costPlan : existing.costPlan,
            vatPlan: directory === "vendors" || directory === "otherSubcontracts" ? body.vatPlan : existing.vatPlan,
            category: directory === "otherSubcontracts" ? body.category : existing.category,
            archived: body.archived === undefined ? existing.archived : Boolean(body.archived)
          }));
          records[index] = record;
          await saveReferenceDirectories(directories, referenceOverrides);
          await logRecordChange("reference", record, existing.archived && !record.archived ? "restored" : "updated", recordChanges(existing, record, { name: "Наименование", providerType: "Тип поставщика", vendor: "Поставщик", category: "Категория", costPlan: "Стоимость по месяцам", vatPlan: "НДС по месяцам" }), directory, changeLog);
          sendJson(response, 200, { record: record });
          return;
        }
        if (request.method === "DELETE" && parts.length === 2) {
          const id = parts[1];
          const index = records.findIndex(function(item) { return item.id === id && !item.deleted; });
          if (index < 0) {
            sendError(response, 404, "Запись справочника не найдена");
            return;
          }
          const snapshot = await readSnapshot(source);
          const subcontractRecords = await readSubcontractRecords(source, overrides);
          const teamRecords = await readTeamRecords(source, teamOverrides);
          const otherSubcontractRecords = await readOtherSubcontractRecords(otherSubcontractOverrides);
          const record = records[index];
          const used = referenceUsage(snapshot, subcontractRecords, directory, record, teamRecords, directories, otherSubcontractRecords);
          if (used) record.archived = true;
          else record.deleted = true;
          await saveReferenceDirectories(directories, referenceOverrides);
          await logRecordChange("reference", record, used ? "archived" : "deleted", [], directory, changeLog);
          sendJson(response, 200, { action: used ? "archived" : "deleted", record: record });
          return;
        }
      }
      if (request.method === "POST" && url.pathname === "/api/subcontracts") {
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const teamRecords = await readTeamRecords(source, teamOverrides);
        const errors = validateSubcontractReferences(body, directories, teamRecords);
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля записи", fields: errors });
          return;
        }
        const records = await readSubcontractRecords(source, overrides);
        const record = normalizeSubcontract(body, "local-" + Date.now(), "local");
        records.push(record);
        await saveSubcontractRecords(records, overrides);
        sendJson(response, 201, { record: applyReferencesToSubcontracts([record], directories)[0] });
        return;
      }
      if (request.method === "PUT" && url.pathname.startsWith("/api/subcontracts/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/subcontracts/".length));
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readSubcontractRecords(source, overrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Запись не найдена");
          return;
        }
        const existing = records[index];
        const merged = Object.assign({}, existing, body);
        const teamRecords = await readTeamRecords(source, teamOverrides);
        const errors = validateSubcontractReferences(merged, directories, teamRecords);
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля записи", fields: errors });
          return;
        }
        const record = normalizeSubcontract(merged, id, existing.source);
        records[index] = record;
        await saveSubcontractRecords(records, overrides);
        await logRecordChange("subcontract", record, existing.archived && !record.archived ? "restored" : "updated", recordChanges(existing, record, { resource: "Ресурс подрядчика", vendor: "Поставщик", project: "Проект", article: "Статья", period: "Период", amount: "Затраты, ₽", rate: "Ставка, ₽/ч", actualHours: "Часы (факт)" }), "", changeLog);
        sendJson(response, 200, { record: applyReferencesToSubcontracts([record], directories)[0] });
        return;
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/subcontracts/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/subcontracts/".length));
        const records = await readSubcontractRecords(source, overrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Подрядная запись не найдена");
          return;
        }
        const record = records[index];
        const used = record.source === "model";
        if (used) record.archived = true;
        else records.splice(index, 1);
        await saveSubcontractRecords(records, overrides);
        await logRecordChange("subcontract", record, used ? "archived" : "deleted", [], "", changeLog);
        sendJson(response, 200, { action: used ? "archived" : "deleted", record: record });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/other-subcontracts") {
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const errors = validateOtherSubcontractRecord(body, directories);
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля прочего подряда", fields: errors });
          return;
        }
        const records = await readOtherSubcontractRecords(otherSubcontractOverrides);
        const record = normalizeOtherSubcontractRecord(body, "local-other-subcontract-" + Date.now(), "local");
        records.push(record);
        await saveOtherSubcontractRecords(records, otherSubcontractOverrides);
        await logRecordChange("other-subcontract", record, "created", [], "", changeLog);
        sendJson(response, 201, { record: applyReferencesToOtherSubcontractRecords([record], directories)[0] });
        return;
      }
      if (request.method === "PUT" && url.pathname.startsWith("/api/other-subcontracts/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/other-subcontracts/".length));
        const body = await readBody(request);
        const directories = await readReferenceDirectories(source, overrides, referenceOverrides);
        const records = await readOtherSubcontractRecords(otherSubcontractOverrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Запись прочего подряда не найдена");
          return;
        }
        const existing = records[index];
        const merged = Object.assign({}, existing, body, { archived: body.archived === undefined ? existing.archived : Boolean(body.archived) });
        const errors = validateOtherSubcontractRecord(merged, directories);
        if (Object.keys(errors).length) {
          sendJson(response, 422, { error: "Проверьте поля прочего подряда", fields: errors });
          return;
        }
        const record = normalizeOtherSubcontractRecord(merged, id, existing.source);
        records[index] = record;
        await saveOtherSubcontractRecords(records, otherSubcontractOverrides);
        await logRecordChange("other-subcontract", record, existing.archived && !record.archived ? "restored" : "updated", recordChanges(existing, record, { otherSubcontract: "Статья/Подрядчик", project: "Проект", plan: "План · сумма", fact: "Факт · сумма" }), "", changeLog);
        sendJson(response, 200, { record: applyReferencesToOtherSubcontractRecords([record], directories)[0] });
        return;
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/other-subcontracts/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/other-subcontracts/".length));
        const records = await readOtherSubcontractRecords(otherSubcontractOverrides);
        const index = records.findIndex(function(item) { return item.id === id; });
        if (index < 0) {
          sendError(response, 404, "Запись прочего подряда не найдена");
          return;
        }
        const record = records[index];
        const used = record.source === "model";
        if (used) record.archived = true;
        else records.splice(index, 1);
        await saveOtherSubcontractRecords(records, otherSubcontractOverrides);
        await logRecordChange("other-subcontract", record, used ? "archived" : "deleted", [], "", changeLog);
        sendJson(response, 200, { action: used ? "archived" : "deleted", record: record });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/reload") {
        snapshotCache.clear();
        snapshotReads.clear();
        return sendJson(response, 200, { ok: true });
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      await serveStatic(response, url.pathname);
    } catch (error) {
      console.error(error);
      sendError(response, 500, "Не удалось загрузить локальный снимок модели.");
    }
  });
}

function start(port) {
  const server = createServer();
  server.listen(port || PORT, function() {
    console.log("Бюджетирование доступно: http://localhost:" + (port || PORT));
  });
  return server;
}

if (require.main === module) start();

module.exports = { buildOverview, createCashSeries, createServer, exchangeNsiExportRows, flattenSubcontracts, normalizeSubcontract, normalizeOtherSubcontractRecord, validateSubcontract, validateOtherSubcontractRecord, readSnapshot, start };
