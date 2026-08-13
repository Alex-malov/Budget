(function () {
  "use strict";

  const state = {
    snapshot: null, overview: null, subcontracts: [], otherSubcontractRecords: [], staffRecords: [], teamRecords: [], references: {}, incomeEvents: [], contractorPayments: [], financialRates: [], activeTab: 0,
    year: "all", project: "all", subcontractViewMonth: "all", subcontractVendor: "all", subcontractResource: "all", staffVendor: "all", staffEmployee: "all", staffMonth: "all", teamRole: "all", teamEmployee: "all", referenceDirectory: "roles", subcontractContextInitialized: false, staffContextInitialized: false, otherSubcontractContextInitialized: false,
    expandedSubcontractYears: {}, expandedOtherSubcontractYears: {}, expandedStaffYears: {}, expandedTeamYears: {}, expandedTeamEmployees: {},
    otherSubcontractView: "compact", costPeriod: "year", costSource: "all", costSearch: "", costOnlyDeviations: false, financeContextInitialized: false,
    subcontractPage: 1, subcontractPageSize: 80, tableSorts: Object.create(null), staffPlanIndex: Object.create(null), contractorPlanIndex: Object.create(null), staffTeamIndex: Object.create(null), contractorTeamIndex: Object.create(null)
  };
  const app = document.getElementById("app");
  const nav = document.getElementById("tab-nav");
  const yearFilter = document.getElementById("filter-year");
  const projectFilter = document.getElementById("filter-project");
  const globalTableScroll = document.getElementById("global-table-scroll");
  const globalTableScrollTrack = document.getElementById("global-table-scroll-track");
  const contextTabFilters = document.getElementById("context-tab-filters");
  const filterPanel = contextTabFilters.closest(".filter-panel");
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const exchangeButton = document.getElementById("import-excel-button");
  const exchangeFileInput = document.getElementById("import-excel-file");
  const exchangeStatus = document.getElementById("exchange-status");
  const desktopSyncPanel = document.getElementById("desktop-sync-panel");
  const desktopSyncButton = document.getElementById("desktop-sync-button");
  const desktopConfigureButton = document.getElementById("desktop-configure-button");
  const desktopSyncStatus = document.getElementById("desktop-sync-status");
  const desktopSyncModal = document.getElementById("desktop-sync-modal");
  const desktopSyncForm = document.getElementById("desktop-sync-form");
  const desktopRepositoryUrl = document.getElementById("desktop-repository-url");
    const desktopGithubToken = document.getElementById("desktop-github-token");
    const desktopSyncError = document.getElementById("desktop-sync-error");
    let desktopOperationInProgress = false;
  let activeTableWrap = null;
  let globalTableScrollSyncing = false;
  let tableScrollRefreshQueued = false;
  const formatters = {
    money: new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0, notation: "standard" }),
    compactMoney: new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 1, notation: "compact", compactDisplay: "short" }),
    integer: new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }),
    percent: new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 }),
    month: new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit" })
  };

  const subtitles = [
    "Сводная финансовая картина по годам исходной модели.",
    "Поступления по проектам и периодам контрактов.",
    "Единая финансовая сводка проектных расходов: прочий подряд, подрядные и штатные ресурсы.",
    "Детализация затрат подрядчиков: план из ресурсного плана и введённый факт.",
    "Учёт плановых и фактических часов штатных ресурсов.",
    "Состав команды, роли и распределение по проектам.",
    "Роли, контракты, поставщики, ресурсы и прочий подряд бюджетирования.",
    "Расходы на субподрядные задачи без привлечения специалистов и ресурсов.",
    "Аналитический контур: доходы, начисления, оплаты и план-факт.",
    "Плановые и фактические оплаты подрядчикам и их сверка с начислениями."
  ];
  const referenceDirectoryKeys = ["roles", "projects", "providers", "vendors", "resources", "otherSubcontracts", "financialRates"];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function num(value) { return Number(value || 0); }

  function money(value, compact) {
    return (compact ? formatters.compactMoney : formatters.money).format(num(value));
  }

  function integer(value) {
    return formatters.integer.format(num(value));
  }

  function percent(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return formatters.percent.format(Number(value));
  }

  function monthName(period) {
    const parts = String(period).split("-");
    if (parts.length !== 2) return period;
    return formatters.month
      .format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1)).replace(".", "");
  }

  const fullMonthLabels = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

  function sum(rows, field) { return rows.reduce(function(total, row) { return total + num(row[field]); }, 0); }

  function selectedYear(fallback) {
    return state.year === "all" ? fallback : Number(state.year);
  }

  function currentHoursYear() {
    const years = (state.snapshot && state.snapshot.finance && state.snapshot.finance.years || []).map(String);
    const current = String(new Date().getFullYear());
    return years.includes(current) ? current : (years.length ? years[years.length - 1] : current);
  }

  function currentHoursMonth() {
    return String(new Date().getMonth() + 1);
  }

  function applyHoursContextDefaults() {
    if (state.activeTab === 3 && !state.subcontractContextInitialized) {
      state.year = currentHoursYear();
      state.subcontractViewMonth = currentHoursMonth();
      state.subcontractContextInitialized = true;
    }
    if (state.activeTab === 4 && !state.staffContextInitialized) {
      state.year = currentHoursYear();
      state.staffMonth = currentHoursMonth();
      state.staffContextInitialized = true;
    }
    if (state.activeTab === 7 && !state.otherSubcontractContextInitialized) {
      state.year = currentHoursYear();
      state.otherSubcontractContextInitialized = true;
    }
    if ((state.activeTab === 1 || state.activeTab === 8 || state.activeTab === 9) && !state.financeContextInitialized) {
      state.year = currentHoursYear();
      state.financeContextInitialized = true;
    }
  }

  function filterProject(rows) {
    return state.project === "all" ? rows : rows.filter(function(row) { return row.project === state.project; });
  }

  function referenceRecords(directory, includeArchived) {
    if (directory === "financialRates") return (state.financialRates || []).filter(function(record) { return includeArchived || !record.archived; });
    const source = state.references[directory] && state.references[directory].records || [];
    return source.filter(function(record) { return includeArchived || !record.archived; });
  }

  function activeReferenceNames(directory) {
    return referenceRecords(directory).map(function(record) { return record.name; });
  }

  async function refreshFinancialData() {
    const response = await fetch("/api/financial");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить финансовые данные.");
    state.incomeEvents = payload.incomes || [];
    state.contractorPayments = payload.payments || [];
    state.financialRates = payload.rates || [];
    state.references.financialRates = { title: "Финансовые ставки", records: state.financialRates };
  }

  function projectDisplay(project) {
    if (!project) return "Код не назначен";
    return project.code ? project.code + " — " + project.name : "Код не назначен — " + project.name;
  }

  function activeCodedProjects() {
    return referenceRecords("projects").filter(function(project) { return Boolean(project.code); });
  }

  function projectCodeByName(name) {
    const project = referenceRecords("projects", true).find(function(item) { return item.name === name; });
    return project ? project.code : "";
  }

  function providerOptions(selected) {
    return referenceOptions("providers", selected, "Не указан");
  }

  function referenceOptions(directory, selected, emptyLabel) {
    const records = referenceRecords(directory);
    const hasSelected = records.some(function(record) { return record.name === selected; });
    const start = '<option value="">' + escapeHtml(emptyLabel || "Выберите значение") + '</option>';
    const unavailable = selected && !hasSelected ? '<option value="" selected>Архивная запись: выберите активную</option>' : "";
    return start + unavailable + records.map(function(record) {
      const label = directory === "projects" ? projectDisplay(record) : record.name;
      return '<option value="' + escapeHtml(record.name) + '"' + (record.name === selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join("");
  }

  function resourceOptions(vendor, selected) {
    const records = referenceRecords("resources").filter(function(record) { return record.vendor === vendor; });
    const hasSelected = records.some(function(record) { return record.name === selected; });
    const unavailable = selected && !hasSelected
      ? '<option value="" selected>Выберите ресурс из НСИ</option>'
      : "";
    return '<option value="">Выберите сотрудника / ресурс</option>' + unavailable + records.map(function(record) {
      return '<option value="' + escapeHtml(record.name) + '"' + (record.name === selected ? " selected" : "") + '>' + escapeHtml(record.name) + '</option>';
    }).join("");
  }

  function resourceReferenceForEmployee(employee, includeArchived) {
    return referenceRecords("resources", includeArchived).find(function(record) { return record.name === employee; }) || null;
  }

  function isContractorResource(record) {
    const resource = resourceReferenceForEmployee(record && record.employee, true);
    return Boolean(resource && resource.providerType === "Подряд");
  }

  function isStaffResource(record) {
    const resource = referenceRecords("resources", true).find(function(item) { return item.name === (record && record.employee); });
    if (resource && resource.providerType) return resource.providerType === "Штат";
    return Boolean(record && record.teamRecord && record.teamRecord.source === "Штат");
  }

  function resourceIsInactive(employee) {
    const resource = resourceReferenceForEmployee(employee, true);
    return Boolean(resource && resource.archived);
  }

  function inactiveResourceRowClass(employee) {
    return resourceIsInactive(employee) ? " inactive-resource-row" : "";
  }

  function subcontractResourceSupplier(record) {
    const resource = resourceReferenceForEmployee(record && record.employee, true);
    return String(resource && resource.vendor || "").trim() || "Не указан";
  }

  function subcontractContext() {
    const resources = state.teamRecords.filter(function(record) {
      return !record.archived && isContractorResource(record) && (state.project === "all" || record.project === state.project);
    });
    const availableVendors = Array.from(new Set(resources.map(function(record) {
      return subcontractResourceSupplier(record);
    }))).sort(function(left, right) { return left.localeCompare(right, "ru-RU"); });
    if (state.subcontractVendor !== "all" && !availableVendors.includes(state.subcontractVendor)) state.subcontractVendor = "all";
    const availableResources = resources.filter(function(record) {
      return state.subcontractVendor === "all" || subcontractResourceSupplier(record) === state.subcontractVendor;
    }).sort(function(left, right) {
      return (left.employee + "|" + left.project + "|" + left.role).localeCompare(right.employee + "|" + right.project + "|" + right.role, "ru-RU");
    });
    if (state.subcontractResource !== "all" && !availableResources.some(function(record) { return record.id === state.subcontractResource; })) state.subcontractResource = "all";
    if (state.subcontractViewMonth !== "all" && !teamMonthLabels[Number(state.subcontractViewMonth) - 1]) state.subcontractViewMonth = "all";
    return { resources: availableResources, availableVendors: availableVendors };
  }

  function staffVendorForTeamRecord(record) {
    return String(record && record.vendor || "").trim() || "Не указан";
  }

  function staffContext() {
    const records = filterProject(state.staffRecords).map(function(record) {
      return { employee: record.employee, teamRecord: staffTeamRecord(record) };
    }).filter(function(record) { return record.teamRecord; });
    const availableVendors = Array.from(new Set(records.map(function(record) {
      return staffVendorForTeamRecord(record.teamRecord);
    }).filter(Boolean))).sort(function(left, right) {
      return left.localeCompare(right, "ru-RU");
    });
    if (state.staffVendor !== "all" && !availableVendors.includes(state.staffVendor)) state.staffVendor = "all";
    const availableEmployees = Array.from(new Set(records.filter(function(record) {
      return state.staffVendor === "all" || staffVendorForTeamRecord(record.teamRecord) === state.staffVendor;
    }).map(function(record) {
      return record.employee;
    }).filter(Boolean))).sort(function(left, right) {
      return left.localeCompare(right, "ru-RU");
    });
    if (state.staffEmployee !== "all" && !availableEmployees.includes(state.staffEmployee)) state.staffEmployee = "all";
    if (state.staffMonth !== "all" && !teamMonthLabels[Number(state.staffMonth) - 1]) state.staffMonth = "all";
    return { availableVendors: availableVendors, availableEmployees: availableEmployees };
  }

  function teamContext() {
    const byProject = state.teamRecords.filter(function(record) {
      return !record.archived && (state.project === "all" || record.project === state.project);
    });
    const availableRoles = Array.from(new Set(byProject.map(function(record) { return record.role; }))).sort();
    if (state.teamRole !== "all" && !availableRoles.includes(state.teamRole)) state.teamRole = "all";
    const availableEmployees = Array.from(new Set(byProject.filter(function(record) {
      return state.teamRole === "all" || record.role === state.teamRole;
    }).map(function(record) { return record.employee; }))).sort();
    if (state.teamEmployee !== "all" && !availableEmployees.includes(state.teamEmployee)) state.teamEmployee = "all";
    return { availableRoles: availableRoles, availableEmployees: availableEmployees };
  }

  function referenceContext() {
    if (!referenceDirectoryKeys.includes(state.referenceDirectory)) state.referenceDirectory = "roles";
    return { directories: referenceDirectoryKeys };
  }

  function selectedReferenceDirectory() {
    return referenceContext().directories.find(function(directory) { return directory === state.referenceDirectory; }) || "roles";
  }

  function updateContextControlsVisibility() {
    const nsiOnly = state.activeTab === 6;
    filterPanel.hidden = nsiOnly;
    projectFilter.closest("label").hidden = nsiOnly;
    yearFilter.closest("label").hidden = nsiOnly;
    projectFilter.closest(".filters").classList.toggle("staff-context-order", state.activeTab === 4);
    projectFilter.closest(".filters").classList.toggle("subcontract-context-order", state.activeTab === 3);
    document.getElementById("reset-filters").hidden = nsiOnly;
  }

  function renderContextTabFilters() {
    updateContextControlsVisibility();
    contextTabFilters.innerHTML = "";
    if (state.activeTab === 3) {
      const context = subcontractContext();
      contextTabFilters.innerHTML = '<label class="subcontract-context-vendor">Поставщик<select id="subcontract-vendor"><option value="all">Все поставщики</option>' +
        context.availableVendors.map(function(item) { return '<option value="' + escapeHtml(item) + '"' + (item === state.subcontractVendor ? ' selected' : '') + '>' + escapeHtml(item) + '</option>'; }).join("") +
        '</select></label><label class="subcontract-context-resource">Сотрудник<select id="subcontract-resource"><option value="all">Все сотрудники</option>' +
        context.resources.map(function(record) { return '<option value="' + escapeHtml(record.id) + '"' + (record.id === state.subcontractResource ? ' selected' : '') + '>' + escapeHtml(record.employee + " · " + record.project + " · " + record.role) + '</option>'; }).join("") +
        '</select></label><label class="subcontract-context-month">Месяц<select id="subcontract-month"><option value="all">Все месяцы</option>' +
        fullMonthLabels.map(function(label, index) { const value = String(index + 1); return '<option value="' + value + '"' + (value === state.subcontractViewMonth ? ' selected' : '') + '>' + label + '</option>'; }).join("") +
        '</select></label>';
      document.getElementById("subcontract-vendor").addEventListener("change", function(event) { state.subcontractVendor = event.target.value; state.subcontractResource = "all"; state.subcontractPage = 1; render(); });
      document.getElementById("subcontract-resource").addEventListener("change", function(event) { state.subcontractResource = event.target.value; state.subcontractPage = 1; render(); });
      document.getElementById("subcontract-month").addEventListener("change", function(event) { state.subcontractViewMonth = event.target.value; state.subcontractPage = 1; render(); });
      return;
    }
    if (state.activeTab === 4) {
      const context = staffContext();
      contextTabFilters.innerHTML = '<label class="staff-context-vendor">Поставщик<select id="staff-vendor"><option value="all">Все поставщики</option>' +
        context.availableVendors.map(function(item) { return '<option value="' + escapeHtml(item) + '"' + (item === state.staffVendor ? ' selected' : '') + '>' + escapeHtml(item) + '</option>'; }).join("") +
        '</select></label><label class="staff-context-employee">Сотрудник<select id="staff-employee"><option value="all">Все сотрудники</option>' +
        context.availableEmployees.map(function(item) { return '<option value="' + escapeHtml(item) + '"' + (item === state.staffEmployee ? ' selected' : '') + '>' + escapeHtml(item) + '</option>'; }).join("") +
        '</select></label><label class="staff-context-month">Месяц<select id="staff-month"><option value="all">Все месяцы</option>' +
        fullMonthLabels.map(function(label, index) { const value = String(index + 1); return '<option value="' + value + '"' + (value === state.staffMonth ? ' selected' : '') + '>' + label + '</option>'; }).join("") +
        '</select></label>';
      document.getElementById("staff-vendor").addEventListener("change", function(event) { state.staffVendor = event.target.value; state.staffEmployee = "all"; render(); });
      document.getElementById("staff-employee").addEventListener("change", function(event) { state.staffEmployee = event.target.value; render(); });
      document.getElementById("staff-month").addEventListener("change", function(event) { state.staffMonth = event.target.value; render(); });
      return;
    }
    if (state.activeTab === 5) {
      const context = teamContext();
      contextTabFilters.innerHTML = '<label>Роль<select id="team-role"><option value="all">Все роли</option>' +
        context.availableRoles.map(function(item) { return '<option value="' + escapeHtml(item) + '"' + (item === state.teamRole ? ' selected' : '') + '>' + escapeHtml(item) + '</option>'; }).join("") +
        '</select></label><label>Сотрудник<select id="team-employee"><option value="all">Все сотрудники</option>' +
        context.availableEmployees.map(function(item) { return '<option value="' + escapeHtml(item) + '"' + (item === state.teamEmployee ? ' selected' : '') + '>' + escapeHtml(item) + '</option>'; }).join("") +
        '</select></label>';
      document.getElementById("team-role").addEventListener("change", function(event) { state.teamRole = event.target.value; state.teamEmployee = "all"; render(); });
      document.getElementById("team-employee").addEventListener("change", function(event) { state.teamEmployee = event.target.value; render(); });
      return;
    }
    if (state.activeTab === 2) {
      const periodOptions = [
        ["year", "Год"], ["quarter-1", "I квартал"], ["quarter-2", "II квартал"], ["quarter-3", "III квартал"], ["quarter-4", "IV квартал"]
      ].concat(fullMonthLabels.map(function(label, index) { return ["month-" + (index + 1), label]; }));
      contextTabFilters.innerHTML = '<label class="cost-context-period">Период<select id="cost-period">' + periodOptions.map(function(item) {
        return '<option value="' + item[0] + '"' + (item[0] === state.costPeriod ? ' selected' : '') + '>' + item[1] + '</option>';
      }).join("") + '</select></label>';
      document.getElementById("cost-period").addEventListener("change", function(event) { state.costPeriod = event.target.value; render(); });
      return;
    }
    if (state.activeTab === 6) return;
  }

  function line(label) {
    return state.snapshot.finance.lines.find(function(item) { return item.label === label; }) || { values: {} };
  }

  function valueFor(label, year) {
    return num(line(label).values[String(year)]);
  }

  function card(label, value, caption, tone) {
    return '<article class="metric-card ' + (tone || "") + '"><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong><small>' + escapeHtml(caption || "") + '</small></article>';
  }

  function sectionTitle(title, note, badge) {
    return '<div class="section-heading"><div><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(note || "") + '</p></div>' + (badge ? '<span class="badge">' + escapeHtml(badge) + '</span>' : "") + '</div>';
  }

  function empty(message) {
    return '<div class="empty-state">' + escapeHtml(message) + '</div>';
  }

  function barChart(items, valueKey, labelKey, formatter, className) {
    const max = Math.max.apply(Math, items.map(function(item) { return Math.abs(num(item[valueKey])); }).concat([1]));
    return '<div class="bar-chart ' + (className || "") + '">' + items.map(function(item) {
      const value = num(item[valueKey]);
      const width = Math.max(2, Math.round(Math.abs(value) / max * 100));
      return '<div class="bar-row"><div class="bar-label" title="' + escapeHtml(item[labelKey]) + '">' + escapeHtml(item[labelKey]) + '</div><div class="bar-track"><i class="' + (value < 0 ? "negative" : "") + '" style="width:' + width + '%"></i></div><strong>' + formatter(value) + '</strong></div>';
    }).join("") + '</div>';
  }

  function table(headers, rows, body) {
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(function(header) { return '<th>' + escapeHtml(header) + '</th>'; }).join("") + '</tr></thead><tbody>' + (rows.length ? rows.map(body).join("") : '<tr><td colspan="' + headers.length + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>') + '</tbody></table></div>';
  }

  function normalizeHeaderLabel(value) {
    return String(value || "").replace(/По месяцам|Свернуть/g, "").replace(/\s+/g, " ").trim();
  }

  function tableHeaderHelp(label, header) {
    const title = normalizeHeaderLabel(label);
    const lower = title.toLocaleLowerCase("ru-RU");
    const monthNames = teamMonthLabels || [];
    const monthAndFact = title.match(/^(.+) · (план|факт)$/i);
    const otherSubcontractTable = Boolean(header && header.closest(".other-subcontract-table"));
    if (!title) return null;
    if (otherSubcontractTable && lower === "план") return { title: title, meaning: "Плановый блок расходов прочего подряда.", formula: "Стоимость = Сумма + НДС; НДС = Сумма × ставка НДС за месяц.", source: "Сумма — введённый план; ставка НДС — НСИ «Прочий подряд»." };
    if (otherSubcontractTable && lower === "факт") return { title: title, meaning: "Фактический блок расходов прочего подряда.", formula: "Стоимость = Сумма + НДС; НДС = Сумма × ставка НДС за месяц.", source: "Сумма — введённый факт; ставка НДС — НСИ «Прочий подряд»." };
    if (otherSubcontractTable && (lower === "стоимость" || /· стоимость$/.test(lower))) return { title: title, meaning: "Полная стоимость расхода прочего подряда за отображаемый период.", formula: "Стоимость = Сумма + НДС.", source: "Сумма — план или факт записи; НДС — месячная ставка из НСИ «Прочий подряд»." };
    if (otherSubcontractTable && lower === "стоимость / сумма / ндс") return { title: title, meaning: "Компактная финансовая ячейка: сверху полная стоимость, ниже — составляющие суммы и НДС.", formula: "Стоимость = Сумма + НДС; НДС = Сумма × ставка НДС за месяц.", source: "Сумма — введённый план или факт; ставка НДС — НСИ «Прочий подряд»." };
    if (otherSubcontractTable && (lower === "сумма" || /· сумма$/.test(lower))) return { title: title, meaning: "Сумма расхода без НДС за отображаемый период.", formula: "Вводится пользователем для плана или факта; НДС рассчитывается отдельно.", source: "Источник: запись раздела «Прочий подряд»." };
    if (otherSubcontractTable && (lower === "ндс" || /· ндс$/.test(lower))) return { title: title, meaning: "НДС расхода прочего подряда за отображаемый период.", formula: "НДС = Сумма × ставка НДС за месяц.", source: "Ставка НДС — НСИ «Прочий подряд»." };
    if (/^20\d{2}$/.test(title)) return { title: title, meaning: "Календарный год, к которому относится блок показателей.", formula: "Значения сгруппированы по периоду " + title + ".", source: "Источник зависит от строки: финансовая модель, ресурсный план или введённый факт." };
    if (monthAndFact && monthNames.includes(monthAndFact[1])) return { title: title, meaning: "Часы за " + monthAndFact[1] + ", разрез «" + monthAndFact[2].toLocaleLowerCase("ru-RU") + "».", formula: monthAndFact[2].toLocaleLowerCase("ru-RU") === "план" ? "Плановые часы из вкладки 06 «Команда»." : "Фактические часы, введённые в реестре текущей страницы.", source: monthAndFact[2].toLocaleLowerCase("ru-RU") === "план" ? "Источник: ресурсный план на странице 06." : "Источник: пользовательские записи факта на страницах 04 или 05." };
    if (monthNames.includes(title)) return { title: title, meaning: "Плановые часы ресурса за " + title + ".", formula: "Значение равно количеству часов в ресурсном плане за соответствующий месяц.", source: "Источник: страница 06 «Команда»." };
    if (/^итого/.test(lower)) return { title: title, meaning: "Итог по всем отображаемым месяцам или годам строки.", formula: lower.includes("факт") ? "Сумма фактических часов по отображаемому периоду." : (lower.includes("план") ? "Сумма плановых часов по отображаемому периоду." : "Сумма значений всех отображаемых периодов."), source: "Источник — данные соответствующих периодов таблицы." };
    if (lower === "план" || lower === "часы (план)") return { title: title, meaning: "Плановая трудоёмкость ресурса.", formula: "Количество часов, запланированное на выбранный период.", source: "Источник: страница 06 «Команда»." };
    if (lower === "факт") return { title: title, meaning: "Фактически учтённая трудоёмкость ресурса.", formula: "Сумма часов, введённых пользователем за выбранный период.", source: "Источник: реестры «Суммы и часы подряд» и «Суммы и часы штат»." };
    if (lower === "статья") return { title: title, meaning: "Наименование финансового показателя или статьи затрат.", formula: "Для итоговых строк используются расчёты исходной финансовой модели.", source: "Источник: лист «Свод» исходной модели либо введённая статья затрат." };
    if (lower === "показатель") return { title: title, meaning: "Строка сравнительного информера по выбранной составляющей расходов.", formula: "Отклонение = Факт − План.", source: "Источник: расчёт текущего выбранного контекста." };
    if (lower === "источник / объект") return { title: title, meaning: "Иерархия источника затрат и объекта детализации: группа, поставщик или категория.", formula: "Итоговая строка равна сумме дочерних объектов в выбранном периоде.", source: "Прочий подряд, подрядные и штатные ресурсы." };
    if (lower === "источник") return { title: title, meaning: "Класс источника затрат: прочий подряд, подрядные или штатные ресурсы.", formula: "Значение определяется типом записи и связью с НСИ.", source: "НСИ, «Команда», «Суммы и часы штат/подряд», «Прочий подряд»." };
    if (lower === "расходы без ндс") return { title: title, meaning: "Сумма затрат до начисления НДС.", formula: "Прочий подряд: введённая сумма; ресурсы: себестоимость ресурсов + привлечение ресурсов.", source: "Введённые расходы и помесячные ставки/часы из НСИ и реестров." };
    if (lower === "расходы с ндс") return { title: title, meaning: "Полные расходы с учётом НДС.", formula: "Расходы с НДС = Расходы без НДС + НДС.", source: "Расчёт по данным выбранного периода." };
    if (lower === "отклонение") return { title: title, meaning: "Разница между фактом и планом для показателя.", formula: "Отклонение = Факт − План; процент = Отклонение / План. При нулевом плане процент не рассчитывается.", source: "План и факт текущего среза." };
    if (lower === "проект") return { title: title, meaning: "Проект, к которому относится доход, расход или ресурс.", formula: "Значение является атрибутом записи и не рассчитывается.", source: "Источник: финансовая модель и НСИ «Контракты / проекты»." };
    if (lower === "период гк") return { title: title, meaning: "Период действия государственного контракта или договорного обязательства.", formula: "Отображается как период, заданный для проекта.", source: "Источник: лист «поступления» исходной модели." };
    if (lower === "поступления") return { title: title, meaning: "Денежные поступления по проекту за выбранный срез.", formula: "Сумма поступлений по месяцам, попавшим в выбранный год и проект.", source: "Источник: лист «поступления» исходной модели." };
    if (lower === "активные месяцы") return { title: title, meaning: "Месяцы, в которых по проекту есть отражённые поступления.", formula: "Список месяцев с ненулевыми строками поступлений.", source: "Источник: лист «поступления» исходной модели." };
    if (lower === "ресурс подрядчика") return { title: title, meaning: "Ресурс с типом поставщика «Подряд», для которого отражаются часы и затраты.", formula: "Значение выбирается из активных записей НСИ.", source: "Источник: НСИ «Сотрудник / ресурс» и страница 06 «Команда»." };
    if (lower === "сотрудник" || lower === "сотрудник / ресурс") return { title: title, meaning: "Штатный сотрудник или ресурс, участвующий в проекте.", formula: "Значение является атрибутом ресурсной записи.", source: "Источник: НСИ «Сотрудник / ресурс» и страница 06 «Команда»." };
    if (lower === "поставщик") return { title: title, meaning: "Организация или источник, с которым связан ресурс.", formula: "Подставляется по связи ресурса с поставщиком.", source: "Источник: НСИ «Поставщики»." };
    if (lower === "ндс") return { title: title, meaning: "Признак наличия или ставка налога на добавленную стоимость для подрядной организации или статьи.", formula: "В расходах: НДС = Сумма × ставка НДС за соответствующий месяц. В НСИ «Да» означает, что заполнено хотя бы одно месячное значение.", source: "Источник: помесячные значения НДС в НСИ «Поставщики» или «Прочий подряд»." };
    if (lower.includes("план") && lower.includes("стоимость")) return { title: title, meaning: "Полная плановая стоимость прочего подряда за отображаемый период.", formula: "Стоимость = Сумма + НДС.", source: "Сумма — план записи «Прочий подряд»; НДС — ставка НСИ «Прочий подряд»." };
    if (lower.includes("факт") && lower.includes("стоимость")) return { title: title, meaning: "Полная фактическая стоимость прочего подряда за отображаемый период.", formula: "Стоимость = Сумма + НДС.", source: "Сумма — факт записи «Прочий подряд»; НДС — ставка НСИ «Прочий подряд»." };
    if (lower.includes("план") && lower.includes("сумма")) return { title: title, meaning: "Плановая сумма расхода без НДС.", formula: "Вводится пользователем по месяцам; НДС рассчитывается отдельно.", source: "Источник: запись раздела «Прочий подряд»." };
    if (lower.includes("факт") && lower.includes("сумма")) return { title: title, meaning: "Фактическая сумма расхода без НДС.", formula: "Вводится пользователем по месяцам; НДС рассчитывается отдельно.", source: "Источник: запись раздела «Прочий подряд»." };
    if (lower.includes("план") && lower.includes("ндс")) return { title: title, meaning: "Плановый НДС расхода.", formula: "НДС = Плановая сумма × ставка НДС за месяц.", source: "Ставка НДС — НСИ «Прочий подряд»." };
    if (lower.includes("факт") && lower.includes("ндс")) return { title: title, meaning: "Фактический НДС расхода.", formula: "НДС = Фактическая сумма × ставка НДС за месяц.", source: "Ставка НДС — НСИ «Прочий подряд»." };
    if (lower === "категория") return { title: title, meaning: "Классификация прочего подряда по характеру затрат.", formula: "«Основные» — обеспечивающие достижения затраты на вычислительные мощности, покупку лицензий и т.д.; «Косвенные» — сопутствующие затраты для достижения результата, такие как оплата БГ на ГК, печать ОД, подарки; «Прочие» — навязанный субподряд.", source: "Источник: НСИ «Прочий подряд»." };
    if (lower === "статья/подрядчик") return { title: title, meaning: "Статья затрат или подрядная организация, не связанная с привлечением специалиста или ресурса.", formula: "Значение выбирается из НСИ; для каждого месяца НДС рассчитывается по ставке этой записи.", source: "Источник: НСИ «Прочий подряд»." };
    if (lower === "роль" || lower === "проектные роли") return { title: title, meaning: "Функциональная роль ресурса в проекте.", formula: "Значение является атрибутом ресурсной записи.", source: "Источник: НСИ «Проектные роли» и страница 06 «Команда»." };
    if (lower === "тип поставщика") return { title: title, meaning: "Классификация поставщика как «Штат» или «Подряд».", formula: "Значение определяется связью поставщика с типом.", source: "Источник: НСИ «Тип поставщика»." };
    if (lower.startsWith("стоимость")) return { title: title, meaning: "Полная часовая стоимость ресурса.", formula: "Стоимость = ставка + привлечение.", source: "Источник: помесячная стоимость в НСИ «Сотрудник / ресурс»." };
    if (lower.startsWith("себестоимость")) return { title: title, meaning: "Затраты на оплату труда или подрядного ресурса без привлечения.", formula: "Σ(ставка за месяц × плановые часы за месяц) за отображаемый период.", source: "Ставка — НСИ «Сотрудник / ресурс»; часы — страница 06 «Команда»." };
    if (lower.startsWith("привлечение")) return { title: title, meaning: "Затраты на привлечение ресурса сверх ставки.", formula: "Σ(привлечение за месяц × плановые часы за месяц) за отображаемый период.", source: "Привлечение — НСИ «Сотрудник / ресурс»; часы — страница 06 «Команда»." };
    if (lower === "наименование") return { title: title, meaning: "Наименование элемента выбранного справочника.", formula: "Значение не рассчитывается.", source: "Источник: соответствующий справочник НСИ." };
    if (lower === "статус") return { title: title, meaning: "Статус доступности записи для выбора в формах.", formula: "«Активна» — доступна; «Архив» — сохранена для истории и недоступна для выбора.", source: "Источник: состояние записи НСИ." };
    return { title: title, meaning: "Содержимое колонки «" + title + "» в выбранном разрезе.", formula: "Способ расчёта определяется типом строки и периодом отображения.", source: "Источник: данные текущего раздела приложения." };
  }

  function ensureColumnTooltip() {
    let tooltip = document.getElementById("column-header-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "column-header-tooltip";
      tooltip.className = "column-header-tooltip";
      tooltip.setAttribute("role", "tooltip");
      tooltip.hidden = true;
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function showColumnTooltip(header, help) {
    const tooltip = ensureColumnTooltip();
    tooltip.innerHTML = '<strong>' + escapeHtml(help.title) + '</strong><span><b>Содержание:</b> ' + escapeHtml(help.meaning) + '</span><span><b>Расчёт:</b> ' + escapeHtml(help.formula) + '</span><span><b>Источник:</b> ' + escapeHtml(help.source) + '</span>';
    tooltip.hidden = false;
    const rect = header.getBoundingClientRect();
    const padding = 12;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding));
    const top = rect.bottom + 8 + height <= window.innerHeight - padding ? rect.bottom + 8 : Math.max(padding, rect.top - height - 8);
    tooltip.style.left = Math.round(left) + "px";
    tooltip.style.top = Math.round(top) + "px";
  }

  function hideColumnTooltip() {
    const tooltip = document.getElementById("column-header-tooltip");
    if (tooltip) tooltip.hidden = true;
  }

  function setupTableHeaderTooltips() {
    app.querySelectorAll("table th").forEach(function(header) {
      if (header.dataset.headerHelpAttached) return;
      const help = tableHeaderHelp(header.textContent, header);
      if (!help) return;
      header.dataset.headerHelpAttached = "true";
      header.classList.add("has-column-help");
      const trigger = document.createElement("button");
      trigger.className = "column-help-trigger";
      trigger.type = "button";
      trigger.textContent = "i";
      trigger.setAttribute("aria-label", "Пояснение колонки «" + help.title + "»");
      trigger.setAttribute("aria-describedby", "column-header-tooltip");
      header.appendChild(trigger);
      header.addEventListener("pointerenter", function() { showColumnTooltip(header, help); });
      header.addEventListener("pointerleave", hideColumnTooltip);
      header.addEventListener("mouseenter", function() { showColumnTooltip(header, help); });
      header.addEventListener("mouseleave", hideColumnTooltip);
      trigger.addEventListener("focus", function() { showColumnTooltip(header, help); });
      trigger.addEventListener("blur", hideColumnTooltip);
      trigger.addEventListener("click", function(event) { event.preventDefault(); showColumnTooltip(header, help); });
    });
  }

  function tableOverflows(wrap) {
    return wrap && wrap.scrollWidth - wrap.clientWidth > 1;
  }

  function tableIsVisible(wrap) {
    const box = wrap.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  }

  function syncGlobalTableScroll() {
    if (!tableOverflows(activeTableWrap)) {
      globalTableScroll.hidden = true;
      return;
    }
    globalTableScroll.hidden = false;
    const horizontalRange = activeTableWrap.scrollWidth - activeTableWrap.clientWidth;
    globalTableScrollTrack.style.width = (globalTableScroll.clientWidth + horizontalRange) + "px";
    globalTableScrollSyncing = true;
    globalTableScroll.scrollLeft = activeTableWrap.scrollLeft;
    window.requestAnimationFrame(function() { globalTableScrollSyncing = false; });
  }

  function chooseActiveTable(preferred) {
    const tables = Array.from(document.querySelectorAll(".table-wrap")).filter(tableOverflows);
    if (!tables.length) {
      activeTableWrap = null;
      globalTableScroll.hidden = true;
      return;
    }
    if (preferred && tables.includes(preferred)) activeTableWrap = preferred;
    else if (!activeTableWrap || !tables.includes(activeTableWrap) || !tableIsVisible(activeTableWrap)) {
      const visible = tables.filter(tableIsVisible);
      const candidates = visible.length ? visible : tables;
      const center = window.innerHeight / 2;
      activeTableWrap = candidates.sort(function(first, second) {
        const firstBox = first.getBoundingClientRect();
        const secondBox = second.getBoundingClientRect();
        return Math.abs((firstBox.top + firstBox.bottom) / 2 - center) - Math.abs((secondBox.top + secondBox.bottom) / 2 - center);
      })[0];
    }
    syncGlobalTableScroll();
  }

  function scheduleTableScrollRefresh() {
    if (tableScrollRefreshQueued) return;
    tableScrollRefreshQueued = true;
    window.requestAnimationFrame(function() {
      tableScrollRefreshQueued = false;
      chooseActiveTable();
    });
  }

  function setupGlobalTableScroll() {
    document.querySelectorAll(".table-wrap").forEach(function(wrap) {
      wrap.addEventListener("pointerenter", function() { chooseActiveTable(wrap); });
      wrap.addEventListener("focusin", function() { chooseActiveTable(wrap); });
      wrap.addEventListener("scroll", function() {
        activeTableWrap = wrap;
        syncGlobalTableScroll();
      });
    });
    document.querySelectorAll("details").forEach(function(details) { details.addEventListener("toggle", scheduleTableScrollRefresh); });
    scheduleTableScrollRefresh();
  }

  globalTableScroll.addEventListener("scroll", function() {
    if (globalTableScrollSyncing || !tableOverflows(activeTableWrap)) return;
    activeTableWrap.scrollLeft = globalTableScroll.scrollLeft;
  });
  window.addEventListener("scroll", scheduleTableScrollRefresh, { passive: true });
  window.addEventListener("resize", scheduleTableScrollRefresh);

  const columnWidthsPrefix = "budgeting:column-widths:v1:";

  function tableLeafHeaders(table) {
    const grid = [];
    const leaves = [];
    Array.from(table.tHead ? table.tHead.rows : []).forEach(function(row, rowIndex) {
      if (!grid[rowIndex]) grid[rowIndex] = [];
      let column = 0;
      Array.from(row.cells).forEach(function(header) {
        while (grid[rowIndex][column]) column += 1;
        const colSpan = header.colSpan || 1;
        const rowSpan = header.rowSpan || 1;
        if (colSpan === 1) leaves.push({ header: header, index: column });
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          if (!grid[rowIndex + rowOffset]) grid[rowIndex + rowOffset] = [];
          for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) grid[rowIndex + rowOffset][column + columnOffset] = true;
        }
        column += colSpan;
      });
    });
    return leaves.sort(function(left, right) { return left.index - right.index; });
  }

  function ensureTableColumns(table, count) {
    let colgroup = Array.from(table.children).find(function(child) { return child.tagName === "COLGROUP"; });
    if (colgroup && colgroup.children.length !== count) {
      colgroup.remove();
      colgroup = null;
    }
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      for (let index = 0; index < count; index += 1) colgroup.appendChild(document.createElement("col"));
      table.insertBefore(colgroup, table.firstChild);
    }
    return Array.from(colgroup.children);
  }

  function tableColumnWidths(leaves) {
    return leaves.map(function(item) { return Math.round(item.header.getBoundingClientRect().width); });
  }

  function tableWidthKey(tableIndex, leaves) {
    const signature = leaves.map(function(item) { return item.index + ":" + item.header.textContent.trim(); }).join("|");
    return columnWidthsPrefix + state.activeTab + ":" + tableIndex + ":" + signature;
  }

  function readSavedColumnWidths(key, count) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(key));
      return Array.isArray(saved) && saved.length === count && saved.every(function(value) { return Number.isFinite(value) && value >= 56; }) ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function saveColumnWidths(key, widths) {
    try { window.localStorage.setItem(key, JSON.stringify(widths.map(function(width) { return Math.round(width); }))); } catch (error) { /* Local storage may be unavailable. */ }
  }

  function applyColumnWidths(table, columns, widths) {
    columns.forEach(function(column, index) { column.style.width = Math.max(56, widths[index]) + "px"; });
    const minimum = Number.parseFloat(window.getComputedStyle(table).minWidth) || 0;
    table.style.tableLayout = "fixed";
    table.style.width = Math.max(minimum, widths.reduce(function(total, width) { return total + width; }, 0)) + "px";
  }

  function makeTableResizable(table, tableIndex) {
    const leaves = tableLeafHeaders(table);
    if (!leaves.length || leaves.some(function(item, index) { return item.index !== index; })) return;
    const columns = ensureTableColumns(table, leaves.length);
    const key = tableWidthKey(tableIndex, leaves);
    const applySavedWidths = function() {
      if (!table.getClientRects().length) return;
      const saved = readSavedColumnWidths(key, leaves.length);
      if (saved) applyColumnWidths(table, columns, saved);
    };
    applySavedWidths();
    const details = table.closest("details");
    if (details) details.addEventListener("toggle", function() { if (details.open) applySavedWidths(); });
    leaves.forEach(function(item) {
      item.header.classList.add("resizable-header");
      const handle = document.createElement("span");
      handle.className = "column-resizer";
      handle.title = "Перетащите, чтобы изменить ширину";
      handle.addEventListener("pointerdown", function(event) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const initial = tableColumnWidths(leaves);
        if (initial.some(function(width) { return width < 1; })) return;
        const startX = event.clientX;
        const widths = initial.slice();
        const move = function(moveEvent) {
          widths[item.index] = Math.max(56, initial[item.index] + moveEvent.clientX - startX);
          applyColumnWidths(table, columns, widths);
        };
        const finish = function() {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", finish);
          handle.removeEventListener("pointercancel", finish);
          document.body.classList.remove("column-resizing");
          saveColumnWidths(key, widths);
          scheduleTableScrollRefresh();
        };
        event.preventDefault();
        document.body.classList.add("column-resizing");
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", finish);
      });
      item.header.appendChild(handle);
    });
  }

  function setupResizableTables() {
    Array.from(app.querySelectorAll("table")).forEach(makeTableResizable);
  }

  function sortableTableHeaders(table) {
    const rows = Array.from(table.tHead ? table.tHead.rows : []);
    const grid = [];
    rows.forEach(function(row, rowIndex) {
      if (!grid[rowIndex]) grid[rowIndex] = [];
      let column = 0;
      Array.from(row.cells).forEach(function(header) {
        while (grid[rowIndex][column]) column += 1;
        const colSpan = header.colSpan || 1;
        const rowSpan = header.rowSpan || 1;
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          if (!grid[rowIndex + rowOffset]) grid[rowIndex + rowOffset] = [];
          for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) grid[rowIndex + rowOffset][column + columnOffset] = header;
        }
        column += colSpan;
      });
    });
    const finalRow = grid[Math.max(0, rows.length - 1)] || [];
    const seen = new Set();
    return finalRow.map(function(header, index) { return { header: header, index: index }; }).filter(function(item) {
      if (!item.header || item.header.colSpan > 1 || !normalizeHeaderLabel(item.header.textContent) || seen.has(item.header)) return false;
      seen.add(item.header);
      return true;
    });
  }

  function tableSortKey(tableIndex, headers) {
    return state.activeTab + ":" + tableIndex + ":" + headers.map(function(item) {
      return item.index + "=" + normalizeHeaderLabel(item.header.textContent);
    }).join("|");
  }

  function sortableCellValue(cell) {
    const text = String(cell && cell.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text === "—") return { empty: true, text: "", number: null };
    const candidate = text.replace(/\s/g, "").replace(/[^0-9,.-]/g, "").replace(",", ".");
    return { empty: false, text: text.toLocaleLowerCase("ru-RU"), number: /^[+-]?\d+(?:\.\d+)?$/.test(candidate) ? Number(candidate) : null };
  }

  function updateTableOrdinalNumbers(table) {
    const rows = Array.from(table.tBodies && table.tBodies[0] ? table.tBodies[0].rows : []);
    let number = 0;
    rows.forEach(function(row) {
      const cell = row.querySelector("td.row-number-cell");
      if (!cell) return;
      if (row.querySelector(".empty-state")) {
        cell.textContent = "";
        return;
      }
      number += 1;
      cell.textContent = String(number);
    });
  }

  function setupTableRowNumbering() {
    Array.from(app.querySelectorAll("table")).forEach(function(table) {
      const headerRows = Array.from(table.tHead ? table.tHead.rows : []);
      if (!headerRows.length || table.dataset.ordinalNumbers === "true") return;
      const header = document.createElement("th");
      header.className = "row-number-header";
      header.textContent = "№";
      header.title = "Порядковый номер строки";
      header.rowSpan = headerRows.length;
      headerRows[0].insertBefore(header, headerRows[0].firstChild);
      Array.from(table.tBodies || []).forEach(function(body) {
        Array.from(body.rows).forEach(function(row) {
          const cell = document.createElement("td");
          cell.className = "row-number-cell";
          row.insertBefore(cell, row.firstChild);
          if (row.querySelector(".empty-state")) {
            const content = row.cells[1];
            if (content) content.colSpan = Number(content.colSpan || 1) + 1;
          }
        });
      });
      table.dataset.ordinalNumbers = "true";
      updateTableOrdinalNumbers(table);
    });
  }

  function sortTableRows(table, column, direction) {
    const body = table.tBodies[0];
    if (!body) return;
    const rows = Array.from(body.rows).filter(function(row) { return row.cells.length > column && !row.querySelector(".empty-state"); });
    const groups = [];
    rows.forEach(function(row) {
      const groupKey = row.dataset.teamGroup;
      let group = groupKey && groups.find(function(item) { return item.key === groupKey; });
      if (!group) {
        group = { key: groupKey || "row-" + groups.length, rows: [], anchor: row };
        groups.push(group);
      }
      group.rows.push(row);
    });
    const compareText = new Intl.Collator("ru-RU", { numeric: true, sensitivity: "base" });
    groups.map(function(group, index) {
      return { group: group, index: index, value: sortableCellValue(group.anchor.cells[column]) };
    }).sort(function(left, right) {
      if (left.value.empty !== right.value.empty) return left.value.empty ? 1 : -1;
      let result = 0;
      if (left.value.number !== null && right.value.number !== null) result = left.value.number - right.value.number;
      else result = compareText.compare(left.value.text, right.value.text);
      return result === 0 ? left.index - right.index : result * direction;
    }).forEach(function(item) { item.group.rows.forEach(function(row) { body.appendChild(row); }); });
    updateTableOrdinalNumbers(table);
  }

  function updateSortableHeaders(headers, sort) {
    headers.forEach(function(item) {
      const selected = sort && item.index === sort.column;
      item.header.dataset.sortDirection = selected ? sort.direction : "";
      item.header.setAttribute("aria-sort", selected ? (sort.direction === 1 ? "ascending" : "descending") : "none");
    });
  }

  function setupSortableTables() {
    Array.from(app.querySelectorAll("table")).forEach(function(table, tableIndex) {
      const headers = sortableTableHeaders(table);
      if (!headers.length) return;
      const eligibleHeaders = headers.filter(function(item) { return normalizeHeaderLabel(item.header.textContent) !== "№"; });
      if (!eligibleHeaders.length) return;
      const key = tableSortKey(tableIndex, eligibleHeaders);
      const stored = state.tableSorts[key];
      if (stored) sortTableRows(table, stored.column, stored.direction);
      updateSortableHeaders(eligibleHeaders, stored);
      eligibleHeaders.forEach(function(item) {
        const header = item.header;
        header.classList.add("sortable-header");
        header.tabIndex = 0;
        header.title = "Нажмите, чтобы отсортировать";
        const applySort = function() {
          const current = state.tableSorts[key];
          const direction = current && current.column === item.index && current.direction === 1 ? -1 : 1;
          const sort = { column: item.index, direction: direction };
          state.tableSorts[key] = sort;
          sortTableRows(table, sort.column, sort.direction);
          updateSortableHeaders(eligibleHeaders, sort);
          scheduleTableScrollRefresh();
        };
        header.addEventListener("click", function(event) {
          if (event.target.closest(".column-resizer, .column-help-trigger")) return;
          applySort();
        });
        header.addEventListener("keydown", function(event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            applySort();
          }
        });
      });
    });
  }

  function currentCashRecords() {
    return filterProject(state.snapshot.cashReceipts).map(function(record) {
      const monthly = record.monthly.filter(function(item) {
        return state.year === "all" || item.period.startsWith(state.year + "-");
      });
      return Object.assign({}, record, { visibleTotal: sum(monthly, "amount"), visibleMonthly: monthly });
    }).filter(function(record) { return record.visibleTotal; });
  }

  function cashSeries() {
    const grouped = {};
    currentCashRecords().forEach(function(record) {
      record.visibleMonthly.forEach(function(item) { grouped[item.period] = (grouped[item.period] || 0) + num(item.amount); });
    });
    return Object.keys(grouped).sort().map(function(period) { return { period: period, amount: grouped[period] }; });
  }

  function renderPipeline() {
    const year = selectedYear(state.overview.latestYear);
    const work = valueFor("Объем работ в т.ч. НДС", year);
    const vat = valueFor("НДС", year);
    const cost = valueFor("Себестоимость работ всего", year);
    const subcontract = valueFor("Подрядчики", year);
    const payroll = valueFor("Затраты на оплату труда всего", year);
    const operating = valueFor("Операционная разница без НДС", year);
    const revenue = work - vat;
    const financeRows = state.snapshot.finance.lines;
    const cash = cashSeries();
    return '<section class="metric-grid">' +
      card("Выручка без НДС", money(revenue, true), "объём работ минус НДС · " + year, "blue") +
      card("Себестоимость", money(cost, true), "по сводному бюджету", "violet") +
      card("Операционная разница", money(operating, true), percent(revenue ? operating / revenue : null) + " от выручки", operating < 0 ? "red" : "green") +
      card("Подрядчики", money(subcontract, true), "в составе себестоимости", "amber") +
      card("ФОТ", money(payroll, true), "затраты на оплату труда", "cyan") +
      '</section>' +
      '<section class="grid two"><article class="panel">' + sectionTitle("Динамика сводных показателей", "Значения взяты из листа «Свод» исходной модели.", "руб.") +
      barChart(financeRows.map(function(item) { return { label: item.label, amount: num(item.values[String(year)]) }; }), "amount", "label", function(value) { return money(value, true); }, "financial-bars") +
      '</article><article class="panel">' + sectionTitle("Поступления по месяцам", "Денежные поступления по данным листа «поступления».", state.year === "all" ? "все годы" : state.year) +
      (cash.length ? barChart(cash, "amount", "period", function(value) { return money(value, true); }, "cash-bars") : empty("Для выбранного периода поступления не найдены.")) +
      '</article></section>' +
      '<section class="panel">' + sectionTitle("Сводная финансовая таблица", "Расчётная строка «Операционная разница без НДС» выделена знаком Σ.") +
      table(["Статья", "2024", "2025", "2026"], financeRows, function(item) {
        return '<tr' + (item.derived ? ' class="derived-row"' : "") + '><td>' + (item.derived ? '<span class="sigma">Σ</span>' : "") + escapeHtml(item.label) + '</td><td>' + money(item.values["2024"]) + '</td><td>' + money(item.values["2025"]) + '</td><td>' + money(item.values["2026"]) + '</td></tr>';
      }) + '</section>';
  }

  function financialRecordsForContext(records) {
    return (records || []).filter(function(record) {
      return !record.archived && (state.year === "all" || record.period.indexOf(String(state.year) + "-") === 0) && (state.project === "all" || record.project === state.project);
    });
  }

  function incomeScenarioSummary(records, scenario) {
    const filtered = (records || []).filter(function(record) { return record.scenario === scenario; });
    return filtered.reduce(function(total, record) {
      total.gross += num(record.gross);
      total.vat += num(record.vat);
      total.net += num(record.net);
      total.count += 1;
      return total;
    }, { gross: 0, vat: 0, net: 0, count: 0 });
  }

  function financeDeviation(plan, fact) {
    const delta = num(fact) - num(plan);
    return { value: delta, rate: num(plan) ? delta / num(plan) : null };
  }

  function incomeScenarioCell(records, scenario, label, projectId, period) {
    const relevant = (records || []).filter(function(record) { return record.scenario === scenario; });
    const values = incomeScenarioSummary(relevant, scenario);
    const comments = relevant.filter(function(record) { return record.comment; }).length;
    const action = relevant.length ? '<button class="income-cell-trigger" type="button" data-income-detail="' + escapeHtml(projectId || "all") + '" data-income-scenario="' + scenario + '" data-income-period="' + escapeHtml(period || "") + '" aria-label="Открыть события: ' + label + '">' + money(values.gross) + '</button>' : "—";
    return '<td class="income-financial-cell ' + scenario + '"><strong>' + action + '</strong><span>НДС ' + (relevant.length ? money(values.vat) : "—") + ' · ×' + values.count + (comments ? " · 💬" : "") + '</span></td>';
  }

  function incomeTable(records) {
    const projects = Array.from(new Set(records.map(function(record) { return record.projectId; }))).map(function(id) {
      const project = referenceRecords("projects", true).find(function(item) { return item.id === id; });
      const projectRecords = records.filter(function(record) { return record.projectId === id; });
      return { id: id, project: project, records: projectRecords };
    }).sort(function(left, right) { return projectDisplay(left.project).localeCompare(projectDisplay(right.project), "ru-RU"); });
    const totalPlan = incomeScenarioSummary(records, "plan");
    const totalFact = incomeScenarioSummary(records, "fact");
    const totalDelta = financeDeviation(totalPlan.gross, totalFact.gross);
    const totalRow = '<tr class="income-total-row"><td><strong>Итого по фильтру</strong></td>' + incomeScenarioCell(records, "plan", "План") + incomeScenarioCell(records, "fact", "Факт") + '<td class="income-deviation ' + (totalDelta.value > 0 ? "positive" : (totalDelta.value < 0 ? "negative" : "")) + '"><strong>' + (totalDelta.value > 0 ? "+" : "") + money(totalDelta.value) + '</strong><span>' + percent(totalDelta.rate) + '</span></td></tr>';
    const rows = projects.map(function(item) {
      const plan = incomeScenarioSummary(item.records, "plan");
      const fact = incomeScenarioSummary(item.records, "fact");
      const delta = financeDeviation(plan.gross, fact.gross);
      const expanded = Boolean(state.expandedIncomeProjects && state.expandedIncomeProjects[item.id]);
      const months = Array.from(new Set(item.records.map(function(record) { return record.period; }))).sort();
      const parent = '<tr><td><button class="year-expand-button income-project-expand" data-income-project-expand="' + escapeHtml(item.id) + '" type="button" aria-expanded="' + expanded + '">' + escapeHtml(projectDisplay(item.project)) + '<span>' + (expanded ? "Свернуть" : "По месяцам") + '</span></button></td>' + incomeScenarioCell(item.records, "plan", "План", item.id) + incomeScenarioCell(item.records, "fact", "Факт", item.id) + '<td class="income-deviation ' + (delta.value > 0 ? "positive" : (delta.value < 0 ? "negative" : "")) + '"><strong>' + (delta.value > 0 ? "+" : "") + money(delta.value) + '</strong><span>' + percent(delta.rate) + '</span></td></tr>';
      const details = expanded ? months.map(function(period) {
        const monthRecords = item.records.filter(function(record) { return record.period === period; });
        const monthPlan = incomeScenarioSummary(monthRecords, "plan");
        const monthFact = incomeScenarioSummary(monthRecords, "fact");
        const monthDelta = financeDeviation(monthPlan.gross, monthFact.gross);
        return '<tr class="income-month-row"><td>' + escapeHtml(monthName(period)) + '</td>' + incomeScenarioCell(monthRecords, "plan", "План", item.id, period) + incomeScenarioCell(monthRecords, "fact", "Факт", item.id, period) + '<td class="income-deviation ' + (monthDelta.value > 0 ? "positive" : (monthDelta.value < 0 ? "negative" : "")) + '"><strong>' + (monthDelta.value > 0 ? "+" : "") + money(monthDelta.value) + '</strong><span>' + percent(monthDelta.rate) + '</span></td></tr>';
      }).join("") : "";
      return parent + details;
    }).join("");
    return '<div class="table-wrap income-table-wrap"><table class="income-table"><thead><tr><th>Проект / период</th><th>План</th><th>Факт</th><th>Отклонение</th></tr></thead><tbody>' + totalRow + (rows || '<tr><td colspan="4">' + empty("Первичные события поступлений не найдены. Создайте план или факт.") + '</td></tr>') + '</tbody></table></div>';
  }

  function renderIncome() {
    const records = financialRecordsForContext(state.incomeEvents);
    const plan = incomeScenarioSummary(records, "plan");
    const fact = incomeScenarioSummary(records, "fact");
    const delta = financeDeviation(plan.gross, fact.gross);
    const projects = new Set(records.map(function(record) { return record.projectId; })).size;
    return '<section class="metric-grid compact financial-income-metrics">' +
      card("Поступления · план", money(plan.gross, true), "с НДС · " + plan.count + " событий", "blue") +
      card("Поступления · факт", money(fact.gross, true), "с НДС · " + fact.count + " событий", "violet") +
      card("Отклонение", (delta.value > 0 ? "+" : "") + money(delta.value, true), percent(delta.rate) + " · " + projects + " проектов", delta.value < 0 ? "red" : "green") +
      '</section><section class="panel income-register">' + sectionTitle("Доходы", "Первичные события поступлений. План и факт независимы; каждое событие хранит собственную ставку НДС и комментарий.", state.year === "all" ? "все годы" : state.year) +
      '<div class="table-toolbar"><span class="table-edit-hint">Сумма указана с НДС. НДС = Поступление с НДС × ставка / (100 + ставка). Нажмите значение, чтобы увидеть события и комментарии.</span><button id="add-income-event" class="primary-button" type="button">+ Поступление</button></div>' + incomeTable(records) + '</section>';
  }

  function closeIncomeModal() {
    const modal = document.getElementById("income-modal");
    if (modal) modal.remove();
  }

  function incomeProjectOptions(selected) {
    return '<option value="">Выберите проект</option>' + activeCodedProjects().map(function(project) {
      return '<option value="' + escapeHtml(project.id) + '"' + (project.id === selected ? " selected" : "") + '>' + escapeHtml(projectDisplay(project)) + '</option>';
    }).join("");
  }

  function vatRateOptions(selected) {
    return [0, 5, 7, 10, 22].map(function(rate) { return '<option value="' + rate + '"' + (Number(selected) === rate ? " selected" : "") + '>' + rate + '%</option>'; }).join("");
  }

  function showIncomeModal(record, copyAsFact) {
    const editing = Boolean(record) && !copyAsFact;
    const item = Object.assign({ projectId: "", scenario: "plan", period: (state.year === "all" ? currentHoursYear() : state.year) + "-" + String(currentHoursMonth()).padStart(2, "0"), gross: "", vatRate: 22, comment: "" }, record || {});
    if (copyAsFact) { item.scenario = "fact"; item.id = ""; }
    const modal = document.createElement("div");
    modal.id = "income-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal financial-event-modal" role="dialog" aria-modal="true" aria-labelledby="income-modal-title"><div class="modal-header"><div><p class="eyebrow">Доходы</p><h2 id="income-modal-title">' + (editing ? "Редактировать поступление" : (copyAsFact ? "Создать факт из плана" : "Новое поступление")) + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="income-form"><div class="form-grid"><label>Проект <b>*</b><select name="projectId">' + incomeProjectOptions(item.projectId) + '</select><small data-error="projectId"></small></label><label>Сценарий <b>*</b><select name="scenario"><option value="plan"' + (item.scenario === "plan" ? " selected" : "") + '>План</option><option value="fact"' + (item.scenario === "fact" ? " selected" : "") + '>Факт</option></select><small data-error="scenario"></small></label><label>Месяц <b>*</b><input name="period" type="month" value="' + escapeHtml(item.period) + '"><small data-error="period"></small></label><label>Поступление с НДС, ₽ <b>*</b><input name="gross" type="number" min="0" step="0.01" value="' + escapeHtml(item.gross) + '"><small data-error="gross"></small></label><label>Ставка НДС <b>*</b><select name="vatRate">' + vatRateOptions(item.vatRate) + '</select><small data-error="vatRate"></small></label><label>НДС, ₽<input name="vat" class="calculated-field" type="text" readonly></label><label class="form-span-two">Комментарий<textarea name="comment" rows="3" placeholder="Необязательно">' + escapeHtml(item.comment) + '</textarea><small data-error="comment"></small></label></div><p class="form-note" data-income-formula></p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    const close = closeIncomeModal;
    modal.querySelector(".close-button").addEventListener("click", close);
    modal.querySelector("[data-close]").addEventListener("click", close);
    modal.addEventListener("click", function(event) { if (event.target === modal) close(); });
    const form = modal.querySelector("form");
    const showFormula = function() {
      const gross = num(form.elements.gross.value); const rate = num(form.elements.vatRate.value); const vat = gross * rate / (100 + rate);
      form.elements.vat.value = money(vat);
      form.querySelector("[data-income-formula]").textContent = "НДС = " + money(gross) + " × " + rate + " / " + (100 + rate) + " = " + money(vat) + "; поступление без НДС = " + money(gross - vat) + ".";
    };
    form.elements.gross.addEventListener("input", showFormula); form.elements.vatRate.addEventListener("change", showFormula); showFormula();
    form.addEventListener("submit", async function(event) {
      event.preventDefault(); ["projectId", "scenario", "period", "gross", "vatRate", "comment"].forEach(function(field) { formError(field, ""); });
      const body = Object.fromEntries(new FormData(form).entries()); body.gross = Number(body.gross); body.vatRate = Number(body.vatRate);
      try {
        const response = await fetch(editing ? "/api/financial/incomes/" + encodeURIComponent(record.id) : "/api/financial/incomes", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (!response.ok) { Object.keys(payload.fields || {}).forEach(function(field) { formError(field, payload.fields[field]); }); if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить поступление."); return; }
        await refreshFinancialData(); close(); render();
      } catch (error) { formError("gross", error.message || "Не удалось сохранить поступление."); }
    });
    form.elements.projectId.focus();
  }

  function showIncomeDetail(projectId, scenario, period, trigger) {
    const records = financialRecordsForContext(state.incomeEvents).filter(function(record) { return (projectId === "all" || record.projectId === projectId) && record.scenario === scenario && (!period || record.period === period); });
    const modal = document.createElement("div"); modal.id = "income-detail"; modal.className = "cost-detail-backdrop"; modal._returnFocus = trigger;
    modal.innerHTML = '<aside class="cost-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="income-detail-title"><div class="modal-header"><div><p class="eyebrow">Доходы · ' + (scenario === "plan" ? "План" : "Факт") + '</p><h2 id="income-detail-title">События поступлений</h2></div><button class="close-button" data-income-detail-close type="button" aria-label="Закрыть">×</button></div><div class="cost-detail-content">' + (records.length ? '<div class="table-wrap"><table><thead><tr><th>Проект</th><th>Месяц</th><th>С НДС</th><th>НДС</th><th>Комментарий</th><th></th></tr></thead><tbody>' + records.map(function(record) { return '<tr><td>' + escapeHtml(record.projectCode + " — " + record.project) + '</td><td>' + escapeHtml(monthName(record.period)) + '</td><td>' + money(record.gross) + '</td><td>' + money(record.vat) + '</td><td>' + escapeHtml(record.comment || "—") + '</td><td><button class="edit-button" data-income-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-income-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button>' + (record.scenario === "plan" ? '<button class="secondary-button compact-button" data-income-copy="' + escapeHtml(record.id) + '" type="button">Создать факт</button>' : "") + '</td></tr>'; }).join("") + '</tbody></table></div>' : empty("Событий этого сценария нет.")) + '</div></aside>';
    document.body.appendChild(modal);
    const close = function() { const restore = modal._returnFocus; modal.remove(); if (restore && document.body.contains(restore)) restore.focus(); };
    modal.querySelector("[data-income-detail-close]").addEventListener("click", close); modal.addEventListener("click", function(event) { if (event.target === modal) close(); });
    modal.querySelectorAll("[data-income-edit]").forEach(function(button) { button.addEventListener("click", function() { close(); const item = state.incomeEvents.find(function(record) { return record.id === button.dataset.incomeEdit; }); if (item) showIncomeModal(item); }); });
    modal.querySelectorAll("[data-income-copy]").forEach(function(button) { button.addEventListener("click", function() { close(); const item = state.incomeEvents.find(function(record) { return record.id === button.dataset.incomeCopy; }); if (item) showIncomeModal(item, true); }); });
    modal.querySelectorAll("[data-income-delete]").forEach(function(button) { button.addEventListener("click", async function() { if (!window.confirm("Удалить поступление?")) return; const response = await fetch("/api/financial/incomes/" + encodeURIComponent(button.dataset.incomeDelete), { method: "DELETE" }); if (!response.ok) { window.alert("Не удалось удалить поступление."); return; } await refreshFinancialData(); close(); render(); }); });
    const escape = function(event) { if (event.key === "Escape") { close(); document.removeEventListener("keydown", escape); } }; document.addEventListener("keydown", escape); modal.querySelector("[data-income-detail-close]").focus();
  }

  function bindIncomeControls() {
    const add = document.getElementById("add-income-event"); if (add) add.addEventListener("click", function() { showIncomeModal(null); });
    document.querySelectorAll("[data-income-project-expand]").forEach(function(button) { button.addEventListener("click", function() { state.expandedIncomeProjects = {}; state.expandedIncomeProjects[button.dataset.incomeProjectExpand] = button.getAttribute("aria-expanded") !== "true"; render(); }); });
    document.querySelectorAll("[data-income-detail]").forEach(function(button) { button.addEventListener("click", function() { showIncomeDetail(button.dataset.incomeDetail, button.dataset.incomeScenario, button.dataset.incomePeriod, button); }); });
  }

  function paymentRecordsForContext() {
    return financialRecordsForContext(state.contractorPayments);
  }

  function paymentSummary(records, scenario) {
    return (records || []).filter(function(record) { return record.scenario === scenario; }).reduce(function(result, record) {
      result.gross += num(record.gross);
      result.vat += num(record.vat);
      result.allocated += (record.allocations || []).reduce(function(total, item) { return total + num(item.amount); }, 0);
      result.count += 1;
      return result;
    }, { gross: 0, vat: 0, allocated: 0, count: 0 });
  }

  function paymentContractorOptions(source, selected) {
    const records = source === "other" ? referenceRecords("otherSubcontracts") : referenceRecords("vendors").filter(function(item) { return item.providerType === "Подряд"; });
    return '<option value="">Выберите подрядчика</option>' + records.map(function(record) { return '<option value="' + escapeHtml(record.name) + '"' + (record.name === selected ? " selected" : "") + '>' + escapeHtml(record.name) + '</option>'; }).join("");
  }

  function paymentAllocationRows(allocations) {
    const values = allocations && allocations.length ? allocations : [{ accrualKey: "", amount: "" }];
    return '<div class="payment-allocation-list" data-payment-allocations>' + values.map(function(item) {
      return '<div class="payment-allocation-row"><input data-allocation-key placeholder="Начисление / период" value="' + escapeHtml(item.accrualKey) + '"><input data-allocation-amount type="number" min="0" step="0.01" placeholder="Сумма, ₽" value="' + escapeHtml(item.amount) + '"><button class="secondary-button compact-button" type="button" data-remove-allocation aria-label="Удалить распределение">×</button></div>';
    }).join("") + '</div><button class="text-button" type="button" data-add-allocation>+ Добавить распределение</button><small data-error="allocations"></small>';
  }

  function paymentAllocationValue(record) {
    return (record.allocations || []).reduce(function(total, item) { return total + num(item.amount); }, 0);
  }

  function paymentStatusMarkup(record) {
    const rest = num(record.gross) - paymentAllocationValue(record);
    if (rest > 0.005) return '<span class="comparison-status amber">Аванс ' + money(rest) + '</span>';
    return '<span class="comparison-status green">Распределено</span>';
  }

  function paymentsTable(records) {
    const rows = records.slice().sort(function(left, right) { return (right.period + right.id).localeCompare(left.period + left.id); });
    return '<div class="table-wrap payments-table-wrap"><table class="payments-table"><thead><tr><th>Проект</th><th>Вид</th><th>Источник</th><th>Подрядчик</th><th>Месяц оплаты</th><th>Оплачено с НДС</th><th>НДС</th><th>Распределение</th><th>Статус</th><th></th></tr></thead><tbody>' + (rows.length ? rows.map(function(record) {
      return '<tr><td><strong>' + escapeHtml(record.projectCode + " — " + record.project) + '</strong></td><td>' + (record.scenario === "plan" ? "План оплаты" : "Факт оплаты") + '</td><td>' + (record.source === "other" ? "Прочий подряд" : "Ресурсный подряд") + '</td><td>' + escapeHtml(record.contractor) + '</td><td>' + escapeHtml(monthName(record.period)) + '</td><td>' + money(record.gross) + '</td><td>' + money(record.vat) + '</td><td>' + money(paymentAllocationValue(record)) + '</td><td>' + paymentStatusMarkup(record) + '</td><td><button class="edit-button" data-payment-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-payment-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button></td></tr>';
    }).join("") : '<tr><td colspan="10">' + empty("Плановые и фактические оплаты не заведены.") + '</td></tr>') + '</tbody></table></div>';
  }

  function paymentReconciliation(records) {
    const scenarios = ["plan", "fact"].map(function(scenario) { return { scenario: scenario, values: paymentSummary(records, scenario) }; });
    return '<section class="panel payment-reconciliation">' + sectionTitle("Сверка оплат", "Оплата участвует только в денежном потоке. Нераспределённая часть является авансом; это неблокирующее расхождение.", state.year === "all" ? "все годы" : state.year) + '<div class="payment-reconciliation-grid">' + scenarios.map(function(item) {
      const advance = item.values.gross - item.values.allocated;
      return '<article><span>' + (item.scenario === "plan" ? "План оплат" : "Факт оплат") + '</span><strong>' + money(item.values.gross) + '</strong><small>Распределено ' + money(item.values.allocated) + ' · ' + (advance > 0.005 ? "аванс " + money(advance) : "сверено") + '</small></article>';
    }).join("") + '</div><p class="table-note">Баланс начисления ведётся накопительно при распределении оплат. Частичная оплата и оплата до начисления сохраняются; распределение больше суммы оплаты блокируется на форме.</p></section>';
  }

  function renderPayments() {
    const records = paymentRecordsForContext();
    const plan = paymentSummary(records, "plan"); const fact = paymentSummary(records, "fact");
    return '<section class="metric-grid compact financial-income-metrics">' + card("Плановые оплаты", money(plan.gross, true), plan.count + " событий", "blue") + card("Фактические оплаты", money(fact.gross, true), fact.count + " событий", "violet") + card("Нераспределено", money((plan.gross - plan.allocated) + (fact.gross - fact.allocated), true), "авансы и будущие распределения", "amber") + '</section>' + paymentReconciliation(records) + '<section class="panel payments-register">' + sectionTitle("Оплаты подрядчикам", "Месяц оплаты — самостоятельное измерение денежного потока и не изменяет начисления в месяце работ.", state.year === "all" ? "все годы" : state.year) + '<div class="table-toolbar"><span class="table-edit-hint">Одна оплата может содержать несколько распределений. Сумма распределений не может быть больше суммы оплаты.</span><button id="add-payment" class="primary-button" type="button">+ Оплата</button></div>' + paymentsTable(records) + '</section>';
  }

  function financialRate(type, projectId) {
    const year = state.year === "all" ? null : Number(state.year);
    if (!year) return null;
    const active = referenceRecords("financialRates");
    const exact = active.find(function(item) { return item.type === type && Number(item.year) === year && String(item.projectId || "") === String(projectId || ""); });
    if (exact) return num(exact.rate) / 100;
    if (projectId && type !== "directorate") {
      const global = active.find(function(item) { return item.type === type && Number(item.year) === year && !item.projectId; });
      return global ? num(global.rate) / 100 : null;
    }
    return null;
  }

  function financialIncome(scenario) {
    return financialRecordsForContext(state.incomeEvents).filter(function(record) { return record.scenario === scenario; }).reduce(function(result, record) {
      result.gross += num(record.gross); result.vat += num(record.vat); result.net += num(record.net); result.count += 1;
      return result;
    }, { gross: 0, vat: 0, net: 0, count: 0 });
  }

  function financialPayments(scenario) {
    return paymentRecordsForContext().filter(function(record) { return record.scenario === scenario; }).reduce(function(total, record) { return total + num(record.gross); }, 0);
  }

  function financialSummary(scenario) {
    const income = financialIncome(scenario);
    const costs = projectCostRows();
    const values = costs.total[scenario];
    const staffGroup = costs.sources.find(function(group) { return group.parent.source === "Штат"; });
    const otherGroup = costs.sources.find(function(group) { return group.parent.source === "Прочий подряд"; });
    const staffAttraction = num(staffGroup && staffGroup.parent[scenario].attraction);
    const otherGross = num(otherGroup && otherGroup.parent[scenario].total);
    const expensesGross = num(values.total) - staffAttraction;
    const expensesVat = num(values.vat);
    const grossProfit = income.gross - expensesGross;
    const vatTotal = income.vat - expensesVat;
    const beforeTax = grossProfit - vatTotal;
    const projectRecord = state.project === "all" ? null : referenceRecords("projects", true).find(function(item) { return item.name === state.project; });
    const profitTaxRate = financialRate("profitTax", projectRecord && projectRecord.id);
    const investmentRate = financialRate("investment", projectRecord && projectRecord.id);
    const overdraftRate = financialRate("overdraft", projectRecord && projectRecord.id);
    const directorateRate = projectRecord ? financialRate("directorate", projectRecord.id) : null;
    const profitTax = profitTaxRate == null ? null : Math.max(0, beforeTax) * profitTaxRate;
    const cleanProfit = profitTax == null ? null : beforeTax - profitTax;
    const investment = investmentRate == null ? null : Math.max(0, income.gross - otherGross) * investmentRate;
    const directorate = directorateRate == null ? null : Math.max(0, income.gross - otherGross - (investment || 0)) * directorateRate;
    const ltDistribution = staffAttraction;
    const paid = financialPayments(scenario);
    const overdraft = overdraftRate == null ? null : Math.max(0, paid - income.gross) * overdraftRate;
    const dks = [cleanProfit, investment, directorate, ltDistribution, overdraft].some(function(value) { return value == null; }) ? null : cleanProfit - investment - directorate - ltDistribution - overdraft;
    return { income: income, expensesGross: expensesGross, expensesVat: expensesVat, grossProfit: grossProfit, vatTotal: vatTotal, beforeTax: beforeTax, profitTax: profitTax, cleanProfit: cleanProfit, profitability: income.net ? cleanProfit / income.net : null, taxBurden: income.gross ? ((vatTotal || 0) + (profitTax || 0)) / income.gross : null, investment: investment, directorate: directorate, ltDistribution: ltDistribution, paid: paid, overdraft: overdraft, dks: dks, rates: { profitTax: profitTaxRate, investment: investmentRate, overdraft: overdraftRate, directorate: directorateRate } };
  }

  function financeResult(value) { return value == null || !Number.isFinite(value) ? "Не рассчитано" : money(value); }

  function financeKpi(label, key, plan, fact, caption) {
    const planValue = key === "income" ? plan.income.gross : plan[key]; const factValue = key === "income" ? fact.income.gross : fact[key];
    const numeric = factValue != null && Number.isFinite(factValue) ? factValue : null;
    const delta = numeric == null || planValue == null ? null : numeric - planValue;
    return '<button class="finance-kpi" data-finance-formula="' + escapeHtml(key) + '" type="button"><span>' + escapeHtml(label) + '</span><strong>' + financeResult(factValue) + '</strong><small>План ' + financeResult(planValue) + (delta == null ? "" : " · Δ " + (delta > 0 ? "+" : "") + money(delta)) + '</small><em>' + escapeHtml(caption) + '</em></button>';
  }

  function financialFormulaText(key) {
    const formulas = {
      income: "Доход с НДС — сумма событий поступлений выбранного сценария за отфильтрованные проект и год.",
      expensesGross: "Расходы с НДС — прочий подряд + подрядные ресурсы + стоимость штатных ресурсов. «Привлечение» штатных ресурсов в расход не включается.",
      grossProfit: "Валовая прибыль = доход с НДС − расходы с НДС.",
      vatTotal: "Итого НДС = НДС с поступлений − НДС по расходам.",
      beforeTax: "Прибыль до налога = валовая прибыль − итоговый НДС.",
      profitTax: "Налог на прибыль = max(0; прибыль до налога) × ставка налога на прибыль из НСИ.",
      cleanProfit: "Чистая прибыль = прибыль до налога − налог на прибыль.",
      investment: "Инвестиции = (доход с НДС − прочий подряд с НДС) × ставка инвестиций из НСИ.",
      directorate: "Дирекция = (доход с НДС − прочий подряд − инвестиции) × проектная ставка дирекции из НСИ.",
      ltDistribution: "Распределение ЛТ — сумма «Привлечение» штатных ресурсов × плановые либо фактические часы; это распределение, а не расход.",
      paid: "Оплаты подрядчикам — самостоятельные плановые либо фактические денежные события. Они не добавляются к расходам повторно.",
      overdraft: "Стоимость овердрафта = max(0; оплаты − поступления) × годовая ставка овердрафта из НСИ.",
      dks: "Остаток ДКС = чистая прибыль − инвестиции − дирекция − распределение ЛТ − стоимость овердрафта."
    };
    return formulas[key] || "Расчётный показатель финансового контура.";
  }

  function showFinancialFormulaModal(key, trigger) {
    const plan = financialSummary("plan"); const fact = financialSummary("fact");
    const modal = document.createElement("div"); modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal financial-formula-modal" role="dialog" aria-modal="true" aria-labelledby="financial-formula-title"><div class="modal-header"><div><p class="eyebrow">Формула и источник</p><h2 id="financial-formula-title">' + escapeHtml(key === "income" ? "Доход с НДС" : key) + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><p>' + escapeHtml(financialFormulaText(key)) + '</p><div class="formula-comparison"><div><span>План</span><strong>' + financeResult(key === "income" ? plan.income.gross : plan[key]) + '</strong></div><div><span>Факт</span><strong>' + financeResult(key === "income" ? fact.income.gross : fact[key]) + '</strong></div></div><p class="form-note">Источник: регистры поступлений, оплат, проектных расходов и финансовых ставок НСИ. Ставки и НДС фиксируются в самих операциях.</p><div class="form-actions"><button class="primary-button" data-close type="button">Закрыть</button></div></section>';
    document.body.appendChild(modal);
    const close = function() { modal.remove(); if (trigger) trigger.focus(); };
    modal.querySelector(".close-button").addEventListener("click", close); modal.querySelector("[data-close]").addEventListener("click", close); modal.addEventListener("click", function(event) { if (event.target === modal) close(); }); modal.querySelector(".close-button").focus();
  }

  function renderFinancialPlanFact() {
    const plan = financialSummary("plan"); const fact = financialSummary("fact");
    const ratesCaption = state.year === "all" ? "Для расчёта выберите один год" : "Ставки берутся из НСИ «Финансовые ставки»";
    const cards = [
      ["Доход с НДС", "income", plan, fact, plan.income.count + " плановых / " + fact.income.count + " фактических событий"],
      ["Расходы с НДС", "expensesGross", plan, fact, "начисления без повторного учёта оплат"],
      ["Валовая прибыль", "grossProfit", plan, fact, "до налога и распределений"],
      ["Итого НДС", "vatTotal", plan, fact, "выходной − входной"],
      ["Прибыль до налога", "beforeTax", plan, fact, ratesCaption],
      ["Налог на прибыль", "profitTax", plan, fact, ratesCaption],
      ["Чистая прибыль", "cleanProfit", plan, fact, ratesCaption],
      ["Инвестиции", "investment", plan, fact, ratesCaption],
      ["Дирекция", "directorate", plan, fact, state.project === "all" ? "Выберите проект для проектной ставки" : ratesCaption],
      ["Распределение ЛТ", "ltDistribution", plan, fact, "информер, не расход"],
      ["Оплаты подрядчикам", "paid", plan, fact, "денежный поток"],
      ["Остаток ДКС", "dks", plan, fact, ratesCaption]
    ];
    const profitability = '<section class="panel financial-ratio-panel">' + sectionTitle("Ключевые коэффициенты", "Показатели строятся только при наличии обязательных ставок и единственного года.", state.year === "all" ? "выберите год" : state.year) + '<div class="financial-ratio-grid"><div><span>Рентабельность</span><strong>' + percent(fact.profitability) + '</strong><small>План ' + percent(plan.profitability) + '</small></div><div><span>Налоговая нагрузка</span><strong>' + percent(fact.taxBurden) + '</strong><small>План ' + percent(plan.taxBurden) + '</small></div><div><span>Стоимость овердрафта</span><strong>' + financeResult(fact.overdraft) + '</strong><small>План ' + financeResult(plan.overdraft) + '</small></div></div></section>';
    return '<section class="financial-intro panel">' + sectionTitle("Финансовый план‑факт", "Сквозная аналитика: поступления, начисления, оплаты и распределения. Нажмите показатель, чтобы увидеть формулу и источники.", state.project === "all" ? "все проекты" : state.project) + '<p class="table-note">Оплата — денежный поток; начисление — расход. Эти сущности учитываются раздельно, поэтому двойной учёт исключён.</p></section><section class="financial-kpi-grid">' + cards.map(function(item) { return financeKpi(item[0], item[1], item[2], item[3], item[4]); }).join("") + '</section>' + profitability + '<section class="panel financial-comparison-table">' + sectionTitle("Сверка сценариев", "Положительное отклонение по прибыли — улучшение, по расходам — увеличение затрат.", "план / факт") + '<div class="table-wrap"><table><thead><tr><th>Показатель</th><th>План</th><th>Факт</th><th>Отклонение</th></tr></thead><tbody>' + cards.map(function(item) { const key = item[1]; const planValue = key === "income" ? plan.income.gross : plan[key]; const factValue = key === "income" ? fact.income.gross : fact[key]; const delta = planValue == null || factValue == null ? null : factValue - planValue; return '<tr><td>' + escapeHtml(item[0]) + '</td><td>' + financeResult(planValue) + '</td><td>' + financeResult(factValue) + '</td><td>' + (delta == null ? "—" : (delta > 0 ? "+" : "") + money(delta)) + '</td></tr>'; }).join("") + '</tbody></table></div></section>';
  }

  function bindFinancialPlanFactControls() {
    document.querySelectorAll("[data-finance-formula]").forEach(function(button) { button.addEventListener("click", function() { showFinancialFormulaModal(button.dataset.financeFormula, button); }); });
  }

  function closePaymentModal() { const modal = document.getElementById("payment-modal"); if (modal) modal.remove(); }

  function showPaymentModal(record) {
    const editing = Boolean(record);
    const item = Object.assign({ projectId: "", scenario: "plan", source: "resource", contractor: "", period: (state.year === "all" ? currentHoursYear() : state.year) + "-" + String(currentHoursMonth()).padStart(2, "0"), gross: "", vatRate: 22, allocations: [], documentDate: "", documentNumber: "", comment: "" }, record || {});
    const modal = document.createElement("div"); modal.id = "payment-modal"; modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal financial-event-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><div class="modal-header"><div><p class="eyebrow">Денежный поток</p><h2 id="payment-modal-title">' + (editing ? "Редактировать оплату" : "Новая оплата подрядчику") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="payment-form"><div class="form-grid"><label>Проект <b>*</b><select name="projectId">' + incomeProjectOptions(item.projectId) + '</select><small data-error="projectId"></small></label><label>Вид <b>*</b><select name="scenario"><option value="plan"' + (item.scenario === "plan" ? " selected" : "") + '>План оплаты</option><option value="fact"' + (item.scenario === "fact" ? " selected" : "") + '>Факт оплаты</option></select><small data-error="scenario"></small></label><label>Источник <b>*</b><select name="source"><option value="resource"' + (item.source === "resource" ? " selected" : "") + '>Ресурсный подряд</option><option value="other"' + (item.source === "other" ? " selected" : "") + '>Прочий подряд</option></select><small data-error="source"></small></label><label>Подрядчик <b>*</b><select name="contractor">' + paymentContractorOptions(item.source, item.contractor) + '</select><small data-error="contractor"></small></label><label>Месяц оплаты <b>*</b><input name="period" type="month" value="' + escapeHtml(item.period) + '"><small data-error="period"></small></label><label>Оплачено с НДС, ₽ <b>*</b><input name="gross" type="number" min="0" step="0.01" value="' + escapeHtml(item.gross) + '"><small data-error="gross"></small></label><label>Ставка НДС <b>*</b><select name="vatRate">' + vatRateOptions(item.vatRate) + '</select><small data-error="vatRate"></small></label><label>НДС, ₽<input name="vat" class="calculated-field" type="text" readonly></label><label>Дата документа<input name="documentDate" type="date" value="' + escapeHtml(item.documentDate) + '"></label><label>№ документа<input name="documentNumber" value="' + escapeHtml(item.documentNumber) + '"></label><label class="form-span-two">Комментарий<textarea name="comment" rows="2" placeholder="Необязательно">' + escapeHtml(item.comment) + '</textarea></label></div><section class="payment-allocation-section"><div><strong>Распределение по начислениям</strong><span>Можно оставить пустым: остаток будет авансом</span></div>' + paymentAllocationRows(item.allocations) + '</section><p class="form-note" data-payment-formula></p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal); modal.querySelector(".close-button").addEventListener("click", closePaymentModal); modal.querySelector("[data-close]").addEventListener("click", closePaymentModal); modal.addEventListener("click", function(event) { if (event.target === modal) closePaymentModal(); });
    const form = modal.querySelector("form");
    const updateContractors = function() { const value = form.elements.contractor.value; form.elements.contractor.innerHTML = paymentContractorOptions(form.elements.source.value, value); };
    form.elements.source.addEventListener("change", updateContractors);
    const updateFormula = function() { const gross = num(form.elements.gross.value); const rate = num(form.elements.vatRate.value); const vat = gross * rate / (100 + rate); form.elements.vat.value = money(vat); form.querySelector("[data-payment-formula]").textContent = "НДС = " + money(gross) + " × " + rate + " / " + (100 + rate) + " = " + money(vat) + ". Оплата участвует в денежном потоке, но не добавляется к расходам повторно."; };
    form.elements.gross.addEventListener("input", updateFormula); form.elements.vatRate.addEventListener("change", updateFormula); updateFormula();
    const bindAllocations = function() { form.querySelectorAll("[data-remove-allocation]").forEach(function(button) { button.onclick = function() { const rows = form.querySelectorAll(".payment-allocation-row"); if (rows.length > 1) button.closest(".payment-allocation-row").remove(); else { button.closest(".payment-allocation-row").querySelectorAll("input").forEach(function(input) { input.value = ""; }); } }; }); };
    form.querySelector("[data-add-allocation]").addEventListener("click", function() { form.querySelector("[data-payment-allocations]").insertAdjacentHTML("beforeend", '<div class="payment-allocation-row"><input data-allocation-key placeholder="Начисление / период"><input data-allocation-amount type="number" min="0" step="0.01" placeholder="Сумма, ₽"><button class="secondary-button compact-button" type="button" data-remove-allocation aria-label="Удалить распределение">×</button></div>'); bindAllocations(); }); bindAllocations();
    form.addEventListener("submit", async function(event) { event.preventDefault(); ["projectId", "scenario", "source", "contractor", "period", "gross", "vatRate", "allocations"].forEach(function(field) { formError(field, ""); }); const body = Object.fromEntries(new FormData(form).entries()); body.gross = Number(body.gross); body.vatRate = Number(body.vatRate); body.allocations = Array.from(form.querySelectorAll(".payment-allocation-row")).map(function(row) { return { accrualKey: row.querySelector("[data-allocation-key]").value, amount: Number(row.querySelector("[data-allocation-amount]").value || 0) }; }).filter(function(item) { return item.amount > 0; }); try { const response = await fetch(editing ? "/api/financial/payments/" + encodeURIComponent(record.id) : "/api/financial/payments", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) { Object.keys(payload.fields || {}).forEach(function(field) { formError(field, payload.fields[field]); }); if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить оплату."); return; } await refreshFinancialData(); closePaymentModal(); render(); } catch (error) { formError("gross", error.message || "Не удалось сохранить оплату."); } });
  }

  function bindPaymentControls() {
    const add = document.getElementById("add-payment"); if (add) add.addEventListener("click", function() { showPaymentModal(null); });
    document.querySelectorAll("[data-payment-edit]").forEach(function(button) { button.addEventListener("click", function() { const item = state.contractorPayments.find(function(record) { return record.id === button.dataset.paymentEdit; }); if (item) showPaymentModal(item); }); });
    document.querySelectorAll("[data-payment-delete]").forEach(function(button) { button.addEventListener("click", async function() { if (!window.confirm("Удалить оплату?")) return; const response = await fetch("/api/financial/payments/" + encodeURIComponent(button.dataset.paymentDelete), { method: "DELETE" }); if (!response.ok) { window.alert("Не удалось удалить оплату."); return; } await refreshFinancialData(); render(); }); });
  }

  function blankFinancial() {
    return { base: 0, resourceCost: 0, attraction: 0, vat: 0, total: 0, known: false };
  }

  function addFinancial(target, value) {
    target.base += num(value.base);
    target.resourceCost += num(value.resourceCost);
    target.attraction += num(value.attraction);
    target.vat += num(value.vat);
    target.total += num(value.total);
    target.known = target.known || Boolean(value.known);
    return target;
  }

  function financialForHours(rate, hours, vatRate, known) {
    const resourceCost = num(rate.rate) * num(hours);
    const attraction = num(rate.attraction) * num(hours);
    const base = resourceCost + attraction;
    const vat = base * num(vatRate);
    return { base: base, resourceCost: resourceCost, attraction: attraction, vat: vat, total: base + vat, known: Boolean(known || hours) };
  }

  function costPeriodMonths() {
    if (state.costPeriod === "year") return Array.from({ length: 12 }, function(_, index) { return index + 1; });
    if (state.costPeriod.indexOf("quarter-") === 0) {
      const quarter = Number(state.costPeriod.split("-")[1]);
      return [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
    }
    if (state.costPeriod.indexOf("month-") === 0) return [Number(state.costPeriod.split("-")[1])];
    return Array.from({ length: 12 }, function(_, index) { return index + 1; });
  }

  function costPeriods() {
    const years = state.year === "all" ? teamPlanYears() : [String(state.year)];
    const months = costPeriodMonths();
    return years.flatMap(function(year) {
      return months.map(function(month) { return { year: String(year), month: month }; });
    });
  }

  function costPeriodLabel() {
    const period = state.costPeriod === "year" ? "год" : (state.costPeriod.indexOf("quarter-") === 0
      ? ["I квартал", "II квартал", "III квартал", "IV квартал"][Number(state.costPeriod.split("-")[1]) - 1]
      : fullMonthLabels[Number(state.costPeriod.split("-")[1]) - 1]);
    return (state.year === "all" ? "все годы" : state.year + " год") + " · " + period;
  }

  function vendorVatRate(vendor, year, month) {
    const item = referenceRecords("vendors", true).find(function(record) { return record.name === vendor; });
    const months = item && item.vatPlan && item.vatPlan[String(year)];
    const hasValue = Boolean(months && Object.prototype.hasOwnProperty.call(months, String(month)));
    return { value: num(hasValue ? months[String(month)] : 0) / 100, known: hasValue };
  }

  function costRow(id, source, name, level, project) {
    return { id: id, source: source, name: name, level: level, project: project || "", plan: blankFinancial(), fact: blankFinancial(), monthly: [], resources: [] };
  }

  function costAddPeriod(row, period, plan, fact) {
    addFinancial(row.plan, plan);
    addFinancial(row.fact, fact);
    const existing = row.monthly.find(function(value) { return value.year === period.year && value.month === period.month; });
    if (existing) {
      addFinancial(existing.plan, plan);
      addFinancial(existing.fact, fact);
    } else {
      row.monthly.push({ year: period.year, month: period.month, plan: Object.assign(blankFinancial(), plan), fact: Object.assign(blankFinancial(), fact) });
    }
    return row;
  }

  function costContractorActualHours(resource, year, month) {
    return state.subcontracts.filter(function(record) {
      return !record.archived && record.period === String(year) + "-" + String(month).padStart(2, "0") && subcontractRecordMatchesResource(record, resource);
    }).reduce(function(total, record) { return total + num(record.actualHours); }, 0);
  }

  function costStaffActualHours(resource, year, month) {
    return state.staffRecords.filter(function(record) {
      return !record.archived && record.project === resource.project && record.employee === resource.employee && record.role === resource.role;
    }).reduce(function(total, record) { return total + staffActualHours(record, year, month); }, 0);
  }

  function otherSubcontractAmountKnown(record, kind, year, month) {
    return Boolean(record[kind] && record[kind][String(year)] && Object.prototype.hasOwnProperty.call(record[kind][String(year)], String(month)));
  }

  function projectCostRows() {
    const periods = costPeriods();
    const rows = [];
    const contractorByVendor = Object.create(null);
    const otherByCategory = Object.create(null);
    const staff = costRow("cost-staff", "Штат", "Штатные ресурсы", 1);

    state.teamRecords.filter(function(resource) {
      return !resource.archived && isContractorResource(resource) && (state.project === "all" || resource.project === state.project);
    }).forEach(function(resource) {
      const vendor = subcontractResourceSupplier(resource);
      const key = "cost-contractor-" + vendor;
      const row = contractorByVendor[key] || (contractorByVendor[key] = costRow(key, "Подряд", vendor, 2));
      row.resources.push(resource.employee);
      periods.forEach(function(period) {
        const rate = teamCostValues(resource, period.year, period.month);
        const vat = vendorVatRate(vendor, period.year, period.month);
        const planHours = teamHours(resource, period.year, period.month);
        const factHours = costContractorActualHours(resource, period.year, period.month);
        const plan = financialForHours(rate, planHours, vat.value, vat.known || planHours);
        const fact = financialForHours(rate, factHours, vat.value, vat.known || factHours);
        costAddPeriod(row, period, plan, fact);
      });
    });

    state.teamRecords.filter(function(resource) {
      return !resource.archived && isStaffResource(resource) && (state.project === "all" || resource.project === state.project);
    }).forEach(function(resource) {
      staff.resources.push(resource.employee);
      periods.forEach(function(period) {
        const rate = teamCostValues(resource, period.year, period.month);
        const planHours = teamHours(resource, period.year, period.month);
        const factHours = costStaffActualHours(resource, period.year, period.month);
        costAddPeriod(staff, period, financialForHours(rate, planHours, 0, planHours), financialForHours(rate, factHours, 0, factHours));
      });
    });

    otherSubcontractRows().forEach(function(record) {
      const reference = otherSubcontractReference(record);
      const category = reference && reference.category || "Без категории";
      const key = "cost-other-" + category;
      const row = otherByCategory[key] || (otherByCategory[key] = costRow(key, "Прочий подряд", category, 2, record.project));
      periods.forEach(function(period) {
        const planValues = otherSubcontractAmounts(record, "plan", period.year, [period.month]);
        const factValues = otherSubcontractAmounts(record, "fact", period.year, [period.month]);
        const planKnown = otherSubcontractAmountKnown(record, "plan", period.year, period.month);
        const factKnown = otherSubcontractAmountKnown(record, "fact", period.year, period.month);
        costAddPeriod(row, period,
          { base: planValues.sum, resourceCost: 0, attraction: 0, vat: planValues.vat, total: planValues.cost, known: planKnown },
          { base: factValues.sum, resourceCost: 0, attraction: 0, vat: factValues.vat, total: factValues.cost, known: factKnown });
      });
    });

    const contractorChildren = Object.keys(contractorByVendor).sort().map(function(key) { return contractorByVendor[key]; });
    const otherChildren = Object.keys(otherByCategory).sort().map(function(key) { return otherByCategory[key]; });
    const sources = [
      { id: "cost-other", source: "Прочий подряд", name: "Прочий подряд", children: otherChildren },
      { id: "cost-contractor", source: "Подряд", name: "Привлечение специалистов и ресурсов", children: contractorChildren },
      { id: "cost-staff-parent", source: "Штат", name: "Штат", children: staff.resources.length ? [staff] : [] }
    ].map(function(group) {
      const parent = costRow(group.id, group.source, group.name, 1);
      group.children.forEach(function(child) {
        addFinancial(parent.plan, child.plan);
        addFinancial(parent.fact, child.fact);
        parent.resources = parent.resources.concat(child.resources);
        child.monthly.forEach(function(item) {
          const existing = parent.monthly.find(function(value) { return value.year === item.year && value.month === item.month; });
          if (existing) { addFinancial(existing.plan, item.plan); addFinancial(existing.fact, item.fact); }
          else parent.monthly.push({ year: item.year, month: item.month, plan: Object.assign(blankFinancial(), item.plan), fact: Object.assign(blankFinancial(), item.fact) });
        });
      });
      return { parent: parent, children: group.children };
    });
    const total = costRow("cost-total", "Итого", state.project === "all" ? "Все проекты" : state.project, 0);
    sources.forEach(function(group) {
      addFinancial(total.plan, group.parent.plan);
      addFinancial(total.fact, group.parent.fact);
      group.parent.monthly.forEach(function(item) {
        const existing = total.monthly.find(function(value) { return value.year === item.year && value.month === item.month; });
        if (existing) { addFinancial(existing.plan, item.plan); addFinancial(existing.fact, item.fact); }
        else total.monthly.push({ year: item.year, month: item.month, plan: Object.assign(blankFinancial(), item.plan), fact: Object.assign(blankFinancial(), item.fact) });
      });
    });
    return { total: total, sources: sources, rows: [total].concat(sources.flatMap(function(group) { return [group.parent].concat(group.children); })) };
  }

  function financialDelta(plan, fact) {
    const delta = num(fact) - num(plan);
    return { value: delta, percent: num(plan) ? delta / num(plan) : null };
  }

  function costStatus(plan, fact) {
    if (!plan && !fact) return { label: "Недостаточно данных", tone: "neutral" };
    if (!plan && fact) return { label: "Расходы без плана", tone: "red" };
    if (fact > plan) return { label: "Перерасход", tone: "red" };
    if (fact < plan) return { label: "Экономия", tone: "green" };
    return { label: "По плану", tone: "neutral" };
  }

  function projectCostCell(plan, fact, metric) {
    const planValue = num(plan[metric]);
    const factValue = num(fact[metric]);
    const delta = financialDelta(planValue, factValue);
    const stateClass = delta.value > 0 ? " is-over" : (delta.value < 0 ? " is-saving" : "");
    return '<td class="project-financial-cell' + stateClass + '"><strong>' + money(factValue) + '</strong><span>План ' + money(planValue) + '</span><small>Δ ' + (delta.value > 0 ? "+" : "") + money(delta.value) + ' · ' + percent(delta.percent) + '</small></td>';
  }

  function projectCostMetricsTable(total) {
    const metrics = [["total", "Расходы с НДС"], ["base", "Расходы без НДС"], ["vat", "НДС"], ["resourceCost", "Себестоимость ресурсов"], ["attraction", "Привлечение ресурсов"]];
    return '<div class="project-cost-secondary"><table><thead><tr><th>Показатель</th><th>План</th><th>Факт</th><th>Отклонение</th></tr></thead><tbody>' + metrics.map(function(item) {
      const delta = financialDelta(total.plan[item[0]], total.fact[item[0]]);
      return '<tr><td>' + item[1] + '</td><td>' + money(total.plan[item[0]]) + '</td><td>' + money(total.fact[item[0]]) + '</td><td class="' + (delta.value > 0 ? "negative" : (delta.value < 0 ? "positive" : "")) + '">' + (delta.value > 0 ? "+" : "") + money(delta.value) + ' · ' + percent(delta.percent) + '</td></tr>';
    }).join("") + '</tbody></table></div>';
  }

  function projectCostInformer(model) {
    const total = model.total;
    const delta = financialDelta(total.plan.total, total.fact.total);
    const execution = total.plan.total ? total.fact.total / total.plan.total : null;
    const status = costStatus(total.plan.total, total.fact.total);
    return '<section class="panel project-cost-informer"><div class="project-cost-informer-head"><div><p class="eyebrow">Сводка расходов</p><h2>' + escapeHtml(total.name) + '</h2><p>' + escapeHtml(costPeriodLabel()) + '</p></div><span class="comparison-status ' + status.tone + '">' + status.label + '</span></div><div class="project-cost-main-metric"><span>Расходы с НДС · факт</span><strong>' + money(total.fact.total) + '</strong><div><span>План ' + money(total.plan.total) + '</span><span>Отклонение ' + (delta.value > 0 ? "+" : "") + money(delta.value) + ' · ' + percent(delta.percent) + '</span><span>Исполнение ' + percent(execution) + '</span></div></div>' + projectCostMetricsTable(total) + '</section>';
  }

  function sourceMixPanel(model) {
    const values = model.sources.map(function(group) { return { label: group.parent.name, plan: group.parent.plan.total, fact: group.parent.fact.total }; });
    const max = Math.max.apply(Math, values.flatMap(function(item) { return [item.plan, item.fact]; }).concat([1]));
    const bars = function(kind, title) {
      return '<div class="source-mix-row"><strong>' + title + '</strong><div>' + values.map(function(item) {
        const width = Math.max(0, Math.round(num(item[kind]) / max * 100));
        return '<span class="source-mix-segment" style="width:' + width + '%" title="' + escapeHtml(item.label + ": " + money(item[kind])) + '">' + (width > 16 ? escapeHtml(item.label) : "") + '</span>';
      }).join("") + '</div></div>';
    };
    return '<section class="panel source-mix-panel">' + sectionTitle("Состав источников", "Доли затрат без выделения НДС как отдельного источника.", "план / факт") + bars("plan", "План") + bars("fact", "Факт") + '<div class="source-mix-legend">' + values.map(function(item) { return '<span>' + escapeHtml(item.label) + '</span>'; }).join("") + '</div></section>';
  }

  function projectCostRowMatches(row) {
    if (row.level === 0) return true;
    if (state.costSource !== "all" && row.source !== state.costSource) return false;
    if (state.costOnlyDeviations && !["total", "base", "vat", "resourceCost", "attraction"].some(function(metric) { return num(row.plan[metric]) !== num(row.fact[metric]); })) return false;
    const query = normalizedText(state.costSearch);
    return !query || normalizedText(row.name + " " + row.source + " " + row.resources.join(" ")).includes(query);
  }

  function projectCostTable(model) {
    const rows = model.rows.filter(projectCostRowMatches);
    const body = rows.map(function(row) {
      const details = row.level > 0 ? '<button class="text-button cost-detail-trigger" data-cost-detail="' + escapeHtml(row.id) + '" type="button">Подробнее</button>' : "";
      return '<tr class="cost-row level-' + row.level + '"><td><span class="cost-hierarchy level-' + row.level + '">' + (row.level === 1 ? "▾" : (row.level === 2 ? "↳" : "Σ")) + '</span><strong>' + escapeHtml(row.name) + '</strong>' + details + '</td><td>' + escapeHtml(row.source) + '</td>' + projectCostCell(row.plan, row.fact, "base") + projectCostCell(row.plan, row.fact, "resourceCost") + projectCostCell(row.plan, row.fact, "attraction") + projectCostCell(row.plan, row.fact, "vat") + projectCostCell(row.plan, row.fact, "total") + '</tr>';
    }).join("") || '<tr><td colspan="7">' + empty("Нет строк для выбранных локальных фильтров.") + '</td></tr>';
    return '<div class="table-wrap project-cost-table-wrap"><table class="project-cost-table"><thead><tr><th>Источник / объект</th><th>Источник</th><th>Расходы без НДС</th><th>Себестоимость ресурсов</th><th>Привлечение ресурсов</th><th>НДС</th><th>Расходы с НДС</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderCosts() {
    const model = projectCostRows();
    const options = ["all", "Прочий подряд", "Подряд", "Штат"];
    return '<section class="grid two project-cost-overview">' + projectCostInformer(model) + sourceMixPanel(model) + '</section>' +
      '<section class="panel project-cost-register">' + sectionTitle("Проектные расходы (себест)", "Единая расчётная сводка по прочему подряду, подрядным и штатным ресурсам. Значение «факт» берётся из фактических часов и введённых расходов.", costPeriodLabel()) +
      '<div class="table-toolbar project-cost-toolbar"><div class="table-filters"><label>Источник<select id="cost-source">' + options.map(function(option) { return '<option value="' + option + '"' + (option === state.costSource ? " selected" : "") + '>' + (option === "all" ? "Все источники" : option) + '</option>'; }).join("") + '</select></label><label>Поиск<input id="cost-search" type="search" value="' + escapeHtml(state.costSearch) + '" placeholder="Категория или поставщик"></label><label class="cost-deviation-filter"><input id="cost-only-deviations" type="checkbox"' + (state.costOnlyDeviations ? " checked" : "") + '> Только отклонения</label></div><span class="table-edit-hint">В ячейке: факт, план и отклонение. Откройте «Подробнее» для помесячной расшифровки и формулы.</span></div>' + projectCostTable(model) + '</section>';
  }

  function otherSubcontractYears() {
    const years = new Set((state.snapshot.finance.years || []).map(String));
    state.otherSubcontractRecords.forEach(function(record) {
      Object.keys(record.plan || {}).forEach(function(year) { years.add(String(year)); });
      Object.keys(record.fact || {}).forEach(function(year) { years.add(String(year)); });
    });
    return Array.from(years).sort(function(left, right) { return Number(left) - Number(right); });
  }

  function otherSubcontractRows() {
    return state.otherSubcontractRecords.filter(function(record) {
      return !record.archived && (state.project === "all" || record.project === state.project);
    }).sort(function(left, right) {
      return (left.otherSubcontract + "|" + left.project).localeCompare(right.otherSubcontract + "|" + right.project, "ru-RU");
    });
  }

  function otherSubcontractReference(record) {
    return referenceRecords("otherSubcontracts", true).find(function(item) { return item.name === record.otherSubcontract; }) || null;
  }

  function otherSubcontractVatRate(record, year, month) {
    const reference = otherSubcontractReference(record);
    return num(reference && reference.vatPlan && reference.vatPlan[String(year)] && reference.vatPlan[String(year)][String(month)]) / 100;
  }

  function otherSubcontractAmounts(record, kind, year, months) {
    return (months || Array.from({ length: 12 }, function(_, index) { return index + 1; })).reduce(function(total, month) {
      const calculated = record.calculated && record.calculated[kind] && record.calculated[kind][String(year)] && record.calculated[kind][String(year)][String(month)];
      const amount = calculated ? num(calculated.sum) : num(record[kind] && record[kind][String(year)] && record[kind][String(month)]);
      const vat = calculated ? num(calculated.vat) : amount * otherSubcontractVatRate(record, year, month);
      const cost = calculated ? num(calculated.cost) : amount + vat;
      total.sum += amount;
      total.vat += vat;
      total.cost += cost;
      total.known = total.known || otherSubcontractAmountKnown(record, kind, year, month);
      return total;
    }, { sum: 0, vat: 0, cost: 0, known: false });
  }

  function otherSubcontractCompactCell(values, inlineConfig, kind, periodLabel) {
    const missing = !values.known;
    const cost = missing ? "—" : money(values.cost);
    const sumValue = missing ? "—" : money(values.sum);
    const vat = missing ? "—" : money(values.vat);
    const content = '<strong>' + cost + '</strong><span>Сумма <b>' + sumValue + '</b></span><span>НДС <b>' + vat + '</b></span>';
    return inlineCell(content, inlineConfig, "other-financial-cell " + kind + (missing ? " is-empty" : ""));
  }

  function otherSubcontractDetailCells(values, inlineConfig) {
    const missing = !values.known;
    return '<td class="money-cell">' + (missing ? "—" : money(values.cost)) + '</td>' + inlineCell(missing ? "—" : money(values.sum), inlineConfig, "money-cell other-subcontract-sum") + '<td class="money-cell">' + (missing ? "—" : money(values.vat)) + '</td>';
  }

  function otherSubcontractMetricCells(values, inlineConfig, kind, periodLabel) {
    if (state.otherSubcontractView === "detail") return otherSubcontractDetailCells(values, inlineConfig);
    return otherSubcontractCompactCell(values, inlineConfig, kind, periodLabel);
  }

  function otherSubcontractYearCells(record, year) {
    if (!state.expandedOtherSubcontractYears[year]) return otherSubcontractMetricCells(otherSubcontractAmounts(record, "plan", year), null, "plan", year) + otherSubcontractMetricCells(otherSubcontractAmounts(record, "fact", year), null, "fact", year);
    const months = Array.from({ length: 12 }, function(_, index) {
      const month = index + 1;
      return otherSubcontractMetricCells(otherSubcontractAmounts(record, "plan", year, [month]), { scope: "otherSubcontract", id: record.id, field: "plan", year: year, month: month }, "plan", fullMonthLabels[month - 1]);
    }).join("");
    return months + Array.from({ length: 12 }, function(_, index) {
      const month = index + 1;
      return otherSubcontractMetricCells(otherSubcontractAmounts(record, "fact", year, [month]), { scope: "otherSubcontract", id: record.id, field: "fact", year: year, month: month }, "fact", fullMonthLabels[month - 1]);
    }).join("");
  }

  function otherSubcontractTable(records, years) {
    const compact = state.otherSubcontractView === "compact";
    const metricWidth = compact ? 1 : 3;
    const yearGroups = years.map(function(year) {
      const expanded = Boolean(state.expandedOtherSubcontractYears[year]);
      return '<th colspan="' + (expanded ? 24 * metricWidth : 2 * metricWidth) + '" class="team-year-group"><button class="year-expand-button" data-other-subcontract-year-expand="' + escapeHtml(year) + '" type="button" aria-expanded="' + expanded + '">' + escapeHtml(year) + '<span>' + (expanded ? "Свернуть" : "По месяцам") + '</span></button></th>';
    }).join("");
    const metricHeaders = function() { return compact ? '<th>Стоимость / Сумма / НДС</th>' : '<th>Стоимость</th><th>Сумма</th><th>НДС</th>'; };
    const kindHeaders = years.map(function(year) {
      const colspan = state.expandedOtherSubcontractYears[year] ? 12 * metricWidth : metricWidth;
      return '<th colspan="' + colspan + '" class="other-subcontract-kind plan">План</th><th colspan="' + colspan + '" class="other-subcontract-kind fact">Факт</th>';
    }).join("");
    const periodHeaders = years.map(function(year) {
      if (!state.expandedOtherSubcontractYears[year]) return metricHeaders() + metricHeaders();
      const monthMetrics = function(label) {
        return compact ? '<th><abbr title="' + escapeHtml(label) + '">' + escapeHtml(label.slice(0, 3)) + '</abbr></th>' : '<th>' + escapeHtml(label) + ' · стоимость</th><th>' + escapeHtml(label) + ' · сумма</th><th>' + escapeHtml(label) + ' · НДС</th>';
      };
      return fullMonthLabels.map(monthMetrics).join("") + fullMonthLabels.map(monthMetrics).join("");
    }).join("");
    const body = records.length ? records.map(function(record) {
      const reference = otherSubcontractReference(record);
      return '<tr class="' + (reference && reference.archived ? "inactive-resource-row" : "") + '"><td>' + escapeHtml(record.project) + '</td><td><strong>' + escapeHtml(record.otherSubcontract) + '</strong></td>' + years.map(function(year) { return otherSubcontractYearCells(record, year); }).join("") + '<td class="subcontract-actions"><button class="edit-button" data-other-subcontract-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-other-subcontract-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button>' + historyButton("other-subcontract", record.id) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (3 + years.reduce(function(total, year) { return total + (state.expandedOtherSubcontractYears[year] ? 24 * metricWidth : 2 * metricWidth); }, 0)) + '">' + empty("Нет расходов прочего подряда для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap other-subcontract-table-wrap"><table class="other-subcontract-table ' + (compact ? "is-compact" : "is-detail") + '"><thead><tr><th rowspan="3">Проект</th><th rowspan="3">Статья/Подрядчик</th>' + yearGroups + '<th rowspan="3"></th></tr><tr>' + kindHeaders + '</tr><tr>' + periodHeaders + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function otherSubcontractComparison(records, years) {
    const values = records.reduce(function(total, record) {
      years.forEach(function(year) {
        ["plan", "fact"].forEach(function(kind) {
          const amount = otherSubcontractAmounts(record, kind, year);
          total[kind].sum += amount.sum;
          total[kind].vat += amount.vat;
          total[kind].cost += amount.cost;
          total[kind].known = total[kind].known || amount.known;
        });
      });
      return total;
    }, { plan: { sum: 0, vat: 0, cost: 0, known: false }, fact: { sum: 0, vat: 0, cost: 0, known: false } });
    const rows = [["Стоимость", "cost"], ["Сумма без НДС", "sum"], ["НДС", "vat"]].map(function(item, index) {
      const plan = values.plan[item[1]];
      const fact = values.fact[item[1]];
      const delta = financialDelta(plan, fact);
      const status = index === 0 ? costStatus(plan, fact) : null;
      return '<tr class="' + (index === 0 ? "comparison-total" : "") + '"><th>' + item[0] + (status ? '<small class="comparison-status ' + status.tone + '">' + status.label + '</small>' : "") + '</th><td>' + (values.plan.known ? money(plan) : "—") + '</td><td>' + (values.fact.known ? money(fact) : "—") + '</td><td class="' + (delta.value > 0 ? "negative" : (delta.value < 0 ? "positive" : "")) + '">' + ((values.plan.known || values.fact.known) ? (delta.value > 0 ? "+" : "") + money(delta.value) + ' · ' + percent(delta.percent) : "—") + '</td></tr>';
    }).join("");
    return '<section class="panel other-subcontract-comparison"><div class="comparison-head"><div><p class="eyebrow">Сравнение плана и факта</p><h2>' + escapeHtml(state.project === "all" ? "Все проекты" : state.project) + '</h2><p>' + escapeHtml(state.year === "all" ? "Все годы" : state.year + " год") + '</p></div></div><div class="comparison-table-wrap"><table><thead><tr><th>Показатель</th><th>План</th><th>Факт</th><th>Отклонение</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  function renderOtherSubcontracts() {
    const years = state.year === "all" ? otherSubcontractYears() : [String(state.year)];
    const records = otherSubcontractRows();
    return otherSubcontractComparison(records, years) + '<section class="panel other-subcontract-panel">' + sectionTitle("Прочий подряд", "Расходы на субподрядные задачи, не связанные с привлечением специалистов и ресурсов. По умолчанию показаны годы; в каждом году можно раскрыть месяцы.", state.year === "all" ? "все годы" : state.year) + '<div class="table-toolbar"><div class="table-edit-hint">Стоимость = Сумма + НДС; НДС = Сумма × ставка НДС из НСИ «Прочий подряд». Двойной щелчок по помесячной «Сумме» — изменение.</div><div class="view-toggle" role="group" aria-label="Представление финансовых ячеек"><button type="button" data-other-subcontract-view="compact" class="' + (state.otherSubcontractView === "compact" ? "active" : "") + '" aria-pressed="' + (state.otherSubcontractView === "compact") + '">Компактно</button><button type="button" data-other-subcontract-view="detail" class="' + (state.otherSubcontractView === "detail" ? "active" : "") + '" aria-pressed="' + (state.otherSubcontractView === "detail") + '">Детально</button></div><button id="add-other-subcontract" class="primary-button" type="button">+ Новая запись</button></div>' + otherSubcontractTable(records, years) + '</section>';
  }

  function otherSubcontractOptions(selected) {
    const records = referenceRecords("otherSubcontracts");
    const hasSelected = records.some(function(record) { return record.name === selected; });
    return '<option value="">Выберите статью или подрядчика</option>' + (selected && !hasSelected ? '<option value="" selected>Архивная запись: выберите активную</option>' : "") + records.map(function(record) {
      return '<option value="' + escapeHtml(record.name) + '"' + (record.name === selected ? " selected" : "") + '>' + escapeHtml(record.name) + '</option>';
    }).join("");
  }

  function otherSubcontractMonthInputs(record, year) {
    return '<div class="other-subcontract-month-grid">' + fullMonthLabels.map(function(label, index) {
      const month = String(index + 1);
      const plan = num(record.plan && record.plan[String(year)] && record.plan[String(year)][month]);
      const fact = num(record.fact && record.fact[String(year)] && record.fact[String(year)][month]);
      return '<div><strong>' + escapeHtml(label) + '</strong><label>План · сумма<input name="plan-' + month + '" type="number" min="0" step="0.01" value="' + escapeHtml(plan) + '"></label><label>Факт · сумма<input name="fact-' + month + '" type="number" min="0" step="0.01" value="' + escapeHtml(fact) + '"></label></div>';
    }).join("") + '</div>';
  }

  function closeOtherSubcontractModal() {
    const modal = document.getElementById("other-subcontract-modal");
    if (modal) modal.remove();
  }

  function showOtherSubcontractModal(record) {
    const editing = Boolean(record);
    const year = state.year === "all" ? currentHoursYear() : String(state.year);
    const item = record || { otherSubcontract: "", project: state.project === "all" ? "" : state.project, plan: {}, fact: {} };
    const modal = document.createElement("div");
    modal.id = "other-subcontract-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal other-subcontract-modal" role="dialog" aria-modal="true" aria-labelledby="other-subcontract-modal-title"><div class="modal-header"><div><p class="eyebrow">Прочий подряд</p><h2 id="other-subcontract-modal-title">' + (editing ? "Редактировать запись" : "Новая запись") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="other-subcontract-form"><div class="form-grid"><label>Статья/Подрядчик <b>*</b><select name="otherSubcontract">' + otherSubcontractOptions(item.otherSubcontract) + '</select><small data-error="otherSubcontract"></small></label><label>Проект <b>*</b><select name="project">' + referenceOptions("projects", item.project, "Выберите проект") + '</select><small data-error="project"></small></label><label>Год <b>*</b><input name="year" type="number" min="2024" max="2100" value="' + escapeHtml(year) + '" readonly><small></small></label></div><section class="cost-form-section"><div><strong>Сумма по месяцам</strong><span>План и факт</span></div><p class="form-note">НДС не вводится в этой форме: он рассчитывается по месячной ставке выбранной записи НСИ «Прочий подряд».</p>' + otherSubcontractMonthInputs(item, year) + '<small data-error="plan"></small><small data-error="fact"></small></section><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    modal.querySelector(".close-button").addEventListener("click", closeOtherSubcontractModal);
    modal.querySelector("[data-close]").addEventListener("click", closeOtherSubcontractModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeOtherSubcontractModal(); });
    modal.querySelector("form").addEventListener("submit", async function(event) {
      event.preventDefault();
      ["otherSubcontract", "project", "plan", "fact"].forEach(function(name) { formError(name, ""); });
      const form = event.currentTarget;
      const selectedYear = String(form.elements.year.value);
      const plan = Object.assign({}, item.plan || {});
      const fact = Object.assign({}, item.fact || {});
      plan[selectedYear] = {};
      fact[selectedYear] = {};
      for (let month = 1; month <= 12; month += 1) {
        plan[selectedYear][String(month)] = num(form.elements["plan-" + month].value);
        fact[selectedYear][String(month)] = num(form.elements["fact-" + month].value);
      }
      const body = { otherSubcontract: form.elements.otherSubcontract.value, project: form.elements.project.value, plan: plan, fact: fact };
      try {
        const response = await fetch(editing ? "/api/other-subcontracts/" + encodeURIComponent(record.id) : "/api/other-subcontracts", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (!response.ok) {
          Object.keys(payload.fields || {}).forEach(function(name) { formError(name, payload.fields[name]); });
          if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить запись.");
          return;
        }
        await refreshReferenceData();
        closeOtherSubcontractModal();
        render();
      } catch (error) {
        formError("otherSubcontract", error.message || "Не удалось сохранить запись.");
      }
    });
  }

  async function deleteOtherSubcontractRecord(record) {
    if (!window.confirm("Удалить запись «" + record.otherSubcontract + "»?")) return;
    try {
      const response = await fetch("/api/other-subcontracts/" + encodeURIComponent(record.id), { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить запись.");
      await refreshReferenceData();
      render();
    } catch (error) {
      window.alert(error.message || "Не удалось удалить запись.");
    }
  }

  function bindOtherSubcontractControls() {
    const add = document.getElementById("add-other-subcontract");
    if (add) add.addEventListener("click", function() { showOtherSubcontractModal(null); });
    document.querySelectorAll("[data-other-subcontract-year-expand]").forEach(function(button) {
      button.addEventListener("click", function() {
        const year = button.dataset.otherSubcontractYearExpand;
        state.expandedOtherSubcontractYears = state.expandedOtherSubcontractYears[year] ? {} : { [year]: true };
        render();
      });
    });
    document.querySelectorAll("[data-other-subcontract-view]").forEach(function(button) {
      button.addEventListener("click", function() {
        state.otherSubcontractView = button.dataset.otherSubcontractView;
        render();
      });
    });
    document.querySelectorAll("[data-other-subcontract-edit]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = state.otherSubcontractRecords.find(function(item) { return item.id === button.dataset.otherSubcontractEdit; });
        if (record) showOtherSubcontractModal(record);
      });
    });
    document.querySelectorAll("[data-other-subcontract-delete]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = state.otherSubcontractRecords.find(function(item) { return item.id === button.dataset.otherSubcontractDelete; });
        if (record) deleteOtherSubcontractRecord(record);
      });
    });
  }

  function closeProjectCostDetail() {
    const modal = document.getElementById("project-cost-detail");
    if (!modal) return;
    const trigger = modal._returnFocus;
    modal.remove();
    if (trigger && document.body.contains(trigger)) trigger.focus();
  }

  function projectCostDetailMarkup(row) {
    const months = row.monthly.slice().sort(function(left, right) { return (left.year + String(left.month).padStart(2, "0")).localeCompare(right.year + String(right.month).padStart(2, "0")); });
    const monthly = months.length ? '<div class="table-wrap project-cost-detail-table"><table><thead><tr><th>Период</th><th>План · стоимость</th><th>Факт · стоимость</th><th>Отклонение</th></tr></thead><tbody>' + months.map(function(item) {
      const delta = financialDelta(item.plan.total, item.fact.total);
      return '<tr><td>' + escapeHtml(fullMonthLabels[item.month - 1] + " " + item.year) + '</td><td>' + money(item.plan.total) + '</td><td>' + money(item.fact.total) + '</td><td class="' + (delta.value > 0 ? "negative" : (delta.value < 0 ? "positive" : "")) + '">' + (delta.value > 0 ? "+" : "") + money(delta.value) + ' · ' + percent(delta.percent) + '</td></tr>';
    }).join("") + '</tbody></table></div>' : empty("За выбранный период данных нет.");
    const resourceText = row.resources.length ? '<p><b>Ресурсы:</b> ' + escapeHtml(Array.from(new Set(row.resources)).join(", ")) + '</p>' : "";
    const formula = row.source === "Прочий подряд"
      ? "Стоимость = Сумма + НДС; НДС = Сумма × месячная ставка НДС из НСИ «Прочий подряд»."
      : (row.source === "Подряд" ? "Себестоимость ресурсов = Ставка × часы; Привлечение = Привлечение × часы; НДС = (Себестоимость + Привлечение) × месячная ставка НДС поставщика." : "Себестоимость ресурсов = Ставка × часы; Привлечение = Привлечение × часы; НДС не применяется.");
    return '<aside class="cost-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="project-cost-detail-title"><div class="modal-header"><div><p class="eyebrow">Расшифровка объекта</p><h2 id="project-cost-detail-title">' + escapeHtml(row.name) + '</h2><p class="drawer-context">' + escapeHtml(costPeriodLabel()) + ' · ' + escapeHtml(row.source) + '</p></div><button class="close-button" data-cost-detail-close type="button" aria-label="Закрыть">×</button></div><div class="cost-detail-content"><section><h3>Состав расчёта</h3><p><b>План:</b> ' + money(row.plan.total) + ' · <b>Факт:</b> ' + money(row.fact.total) + '</p><p><b>Себестоимость ресурсов:</b> ' + money(row.fact.resourceCost) + '; <b>Привлечение:</b> ' + money(row.fact.attraction) + '; <b>НДС:</b> ' + money(row.fact.vat) + '.</p><p class="form-note">' + escapeHtml(formula) + '</p>' + resourceText + '</section><section><h3>По месяцам</h3>' + monthly + '</section></div></aside>';
  }

  function showProjectCostDetail(id, trigger) {
    closeProjectCostDetail();
    const model = projectCostRows();
    const row = model.rows.find(function(item) { return item.id === id; });
    if (!row) return;
    const modal = document.createElement("div");
    modal.id = "project-cost-detail";
    modal.className = "cost-detail-backdrop";
    modal._returnFocus = trigger;
    modal.innerHTML = projectCostDetailMarkup(row);
    document.body.appendChild(modal);
    const close = function() { closeProjectCostDetail(); };
    modal.querySelector("[data-cost-detail-close]").addEventListener("click", close);
    modal.addEventListener("click", function(event) { if (event.target === modal) close(); });
    const keydown = function(event) {
      if (event.key === "Escape") { event.preventDefault(); close(); document.removeEventListener("keydown", keydown); }
    };
    document.addEventListener("keydown", keydown);
    modal.querySelector("[data-cost-detail-close]").focus();
  }

  function bindProjectCostControls() {
    const source = document.getElementById("cost-source");
    const search = document.getElementById("cost-search");
    const deviations = document.getElementById("cost-only-deviations");
    if (source) source.addEventListener("change", function(event) { state.costSource = event.target.value; render(); });
    if (search) search.addEventListener("input", function(event) { state.costSearch = event.target.value; render(); });
    if (deviations) deviations.addEventListener("change", function(event) { state.costOnlyDeviations = event.target.checked; render(); });
    document.querySelectorAll("[data-cost-detail]").forEach(function(button) {
      button.addEventListener("click", function() { showProjectCostDetail(button.dataset.costDetail, button); });
    });
  }

  function subcontractPage(rows) {
    const size = state.subcontractPageSize;
    const totalPages = Math.max(1, Math.ceil(rows.length / size));
    state.subcontractPage = Math.min(Math.max(1, state.subcontractPage), totalPages);
    const start = (state.subcontractPage - 1) * size;
    return { rows: rows.slice(start, start + size), start: start, totalPages: totalPages };
  }

  function subcontractPager(page, total) {
    if (total <= state.subcontractPageSize) return "";
    const from = page.start + 1;
    const to = Math.min(page.start + page.rows.length, total);
    return '<div class="table-pager"><span>Показано ' + integer(from) + '–' + integer(to) + ' из ' + integer(total) + '</span><div><button class="secondary-button compact-button" data-subcontract-page="' + (state.subcontractPage - 1) + '" type="button"' + (state.subcontractPage === 1 ? " disabled" : "") + '>Назад</button><span class="pager-current">' + state.subcontractPage + ' / ' + page.totalPages + '</span><button class="secondary-button compact-button" data-subcontract-page="' + (state.subcontractPage + 1) + '" type="button"' + (state.subcontractPage === page.totalPages ? " disabled" : "") + '>Далее</button></div></div>';
  }

  function renderSubcontracts() {
    const allYears = state.year === "all";
    const years = allYears ? teamPlanYears() : [String(state.year)];
    const months = subcontractContextMonths();
    const rows = subcontractPlanRows(years);
    const displayedRows = rows.filter(function(row) {
      if (!row.teamRecords.length) return false;
      return subcontractHasHours(row, years, months);
    });
    const amount = sum(displayedRows.map(function(row) { return { value: subcontractAmount(row, years, months) }; }), "value");
    const plannedHours = sum(displayedRows.map(function(row) { return { value: subcontractHoursTotal(row, years, months, subcontractPlanHours) }; }), "value");
    const actualHours = sum(displayedRows.map(function(row) { return { value: subcontractHoursTotal(row, years, months, subcontractActualHours) }; }), "value");
    const sourceCosts = displayedRows.flatMap(function(row) { return row.teamRecords; });
    const averageRate = sourceCosts.length ? sum(sourceCosts.map(function(record) { return { value: teamCostValues(record).rate }; }), "value") / sourceCosts.length : 0;
    const page = subcontractPage(displayedRows);
    const planTable = allYears ? subcontractAllYearsTable(page.rows, years, months) : subcontractTable(page.rows, years[0], months);
    const periodLabel = allYears ? "за все доступные годы" : "по месяцам " + years[0] + " года";
    const selectedMonthNote = state.subcontractViewMonth === "all" ? "" : " Выбран " + teamMonthLabels[months[0] - 1] + ": отображаются данные только этого месяца" + (allYears ? " в каждом году." : ".");
    return '<section class="metric-grid compact hours-metric-grid">' +
      card("Подрядные затраты", money(amount, true), periodLabel, "amber") +
      card("Часы · план", integer(plannedHours) + " ч", "из вкладки 06 · " + periodLabel, "cyan") +
      card("Часы · факт", integer(actualHours) + " ч", "введено на этой странице", "blue") +
      card("Средняя ставка", money(averageRate), "по ресурсам «Подряд» из НСИ", "violet") +
      '</section>' +
      '<section class="panel subcontract-plan-table">' + sectionTitle("Суммы и часы подряд", allYears ? "Годовые итоги часов с возможностью раскрытия месяцев." : "Часы указаны в разрезе месяцев выбранного года.", allYears ? "все годы" : years[0]) +
      '<div class="table-toolbar"><span class="table-edit-hint">Строки формируются по НСИ и плану команды; двойной клик по доступному полю — редактирование</span>' + subcontractPager(page, displayedRows.length) + '</div>' +
      planTable +
      '<p class="table-note">' + (allYears && state.subcontractViewMonth === "all" ? "Нажмите на название года, чтобы развернуть его по месяцам." : "Показаны строки, у которых есть план или факт часов в выбранном контексте.") + selectedMonthNote + " Стоимость, ставка и привлечение поступают из НСИ «Сотрудник / ресурс»; плановые часы — из раздела 06. Годовые показатели рассчитываются по плановым часам отображаемого периода. Факт и затраты присоединяются по проекту и ресурсу." + (subcontractSelectedPeriod() ? "" : " Для изменения конкретной записи выберите один год и месяц в контексте просмотра.") + '</p></section>';
  }

  function formError(name, message) {
    const target = document.querySelector('[data-error="' + name + '"]');
    if (target) target.textContent = message || "";
  }

  function closeSubcontractModal() {
    const modal = document.getElementById("subcontract-modal");
    if (modal) modal.remove();
  }

  function subcontractResourceOptions(selectedResource, selectedProject) {
    const resources = state.teamRecords.filter(function(record) {
      return !record.archived && isContractorResource(record) && record.employee && record.project && record.role;
    }).sort(function(left, right) {
      return (left.employee + "|" + left.project + "|" + left.role).localeCompare(right.employee + "|" + right.project + "|" + right.role, "ru-RU");
    });
    const available = resources.some(function(record) {
      return record.employee === selectedResource && record.project === selectedProject;
    });
    const unavailable = selectedResource && !available
      ? '<option value="' + escapeHtml(selectedResource) + '" data-project="' + escapeHtml(selectedProject) + '" selected>' + escapeHtml(selectedResource + " · " + (selectedProject || "проект не задан") + " · нет в активном плане") + '</option>'
      : "";
    return '<option value="">Выберите сотрудника</option>' + unavailable + resources.map(function(record) {
      const selected = record.employee === selectedResource && record.project === selectedProject;
      const vendor = subcontractResourceSupplier(record);
      return '<option value="' + escapeHtml(record.employee) + '" data-vendor="' + escapeHtml(vendor) + '" data-project="' + escapeHtml(record.project) + '" data-role="' + escapeHtml(record.role) + '" data-team-id="' + escapeHtml(record.id) + '"' + (selected ? " selected" : "") + '>' + escapeHtml(record.employee + " · " + vendor + " · " + record.project + " · " + record.role) + '</option>';
    }).join("");
  }

  function subcontractResourceCostMarkup(teamRecord, year) {
    if (!teamRecord) {
      return '<section class="cost-form-section"><div><strong>Стоимость, ₽</strong><span>Ставка + привлечение</span></div><p class="form-note">Выберите сотрудника, чтобы показать значения из НСИ «Сотрудник / ресурс» (07).</p></section>';
    }
    const months = subcontractContextMonths();
    const values = months.map(function(month) { return teamCostValues(teamRecord, year, month); });
    const period = state.subcontractViewMonth === "all" ? "за выбранный год" : teamMonthLabels[months[0] - 1] + " " + year + " года";
    return '<section class="cost-form-section"><div><strong>Стоимость, ₽</strong><span>Ставка + привлечение · ' + escapeHtml(period) + '</span></div><div class="cost-form-fields"><label>Ставка, ₽/ч<input class="calculated-field" type="text" value="' + escapeHtml(staffCostRange(values, "rate")) + '" readonly></label><label>Привлечение, ₽/ч<input class="calculated-field" type="text" value="' + escapeHtml(staffCostRange(values, "attraction")) + '" readonly></label><label>Стоимость, ₽/ч<input class="calculated-field" type="text" value="' + escapeHtml(staffCostRange(values, "cost")) + '" readonly></label></div><p class="form-note">Значения подставлены из НСИ «Сотрудник / ресурс» (07) и недоступны для изменения на этой форме.</p></section>';
  }

  function showSubcontractModal(record) {
    const editing = Boolean(record);
    const item = record || { resource: "", project: "", vendor: "", article: "", period: subcontractSelectedPeriod(), amount: "", rate: "", actualHours: "" };
    const modal = document.createElement("div");
    modal.id = "subcontract-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal team-modal" role="dialog" aria-modal="true" aria-labelledby="subcontract-modal-title"><div class="modal-header"><div><p class="eyebrow">Суммы и часы подряд</p><h2 id="subcontract-modal-title">' + (editing ? "Редактировать запись" : "Новая запись") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="subcontract-form"><div class="form-grid"><label>Сотрудник <b>*</b><select name="resource" autofocus>' + subcontractResourceOptions(item.resource, item.project) + '</select><small data-error="resource"></small></label><label>Поставщик <b>*</b><input name="supplier" class="calculated-field" value="" readonly aria-readonly="true"><small data-error="supplier"></small></label><label>Проект <b>*</b><input name="project" class="calculated-field" value="' + escapeHtml(item.project) + '" readonly aria-readonly="true"><small data-error="project"></small></label><label>Роль <b>*</b><input name="role" class="calculated-field" value="" readonly aria-readonly="true"><small data-error="role"></small></label><label>Статья <b>*</b><input name="article" value="' + escapeHtml(item.article) + '" placeholder="Например, разработка"><small data-error="article"></small></label><label>Период <b>*</b><input name="period" type="month" value="' + escapeHtml(item.period) + '"><small data-error="period"></small></label><label>Ставка, ₽/ч <b>*</b><input name="rate" type="number" min="0" step="0.01" value="' + escapeHtml(item.rate) + '"><small data-error="rate"></small></label><label>Часы (факт) <b>*</b><input name="actualHours" type="number" min="0" step="0.5" value="' + escapeHtml(item.actualHours) + '"><small data-error="actualHours"></small></label><label>Затраты, ₽ <b>*</b><input name="amount" type="number" min="0" step="0.01" value="' + escapeHtml(item.amount) + '"><small data-error="amount"></small></label></div><div id="subcontract-resource-cost"></div><p class="form-note">Сотрудник доступен, если в НСИ его поставщик имеет тип «Подряд». Поставщик, проект, роль и стоимость подставляются из НСИ (07) и плана команды (06).</p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    const subcontractForm = modal.querySelector("form");
    const subcontractResource = subcontractForm.elements.resource;
    const subcontractSupplier = subcontractForm.elements.supplier;
    const subcontractProject = subcontractForm.elements.project;
    const subcontractRole = subcontractForm.elements.role;
    const subcontractCostContext = modal.querySelector("#subcontract-resource-cost");
    function syncSubcontractResource() {
      const selected = subcontractResource.options[subcontractResource.selectedIndex];
      subcontractSupplier.value = selected && selected.dataset.vendor || "";
      subcontractProject.value = selected && selected.dataset.project || "";
      subcontractRole.value = selected && selected.dataset.role || "";
      const teamRecord = selected && selected.dataset.teamId ? state.teamRecords.find(function(item) { return item.id === selected.dataset.teamId; }) : null;
      subcontractCostContext.innerHTML = subcontractResourceCostMarkup(teamRecord, state.year === "all" ? teamYear() : String(state.year));
    }
    subcontractResource.addEventListener("change", syncSubcontractResource);
    syncSubcontractResource();
    modal.querySelector(".close-button").addEventListener("click", closeSubcontractModal);
    modal.querySelector("[data-close]").addEventListener("click", closeSubcontractModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeSubcontractModal(); });
    modal.querySelector("form").addEventListener("submit", async function(event) {
      event.preventDefault();
      ["resource", "period", "project", "article", "amount", "rate", "actualHours"].forEach(function(name) { formError(name, ""); });
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form).entries());
      body.amount = Number(body.amount);
      body.rate = Number(body.rate);
      body.actualHours = Number(body.actualHours);
      try {
        const response = await fetch(editing ? "/api/subcontracts/" + encodeURIComponent(record.id) : "/api/subcontracts", {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) {
          Object.keys(payload.fields || {}).forEach(function(name) { formError(name, payload.fields[name]); });
          if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить запись.");
          return;
        }
        await refreshSubcontracts();
        closeSubcontractModal();
        render();
      } catch (error) {
        formError("amount", error.message || "Не удалось сохранить запись.");
      }
    });
  }

  async function deleteSubcontractRecord(record) {
    if (!window.confirm("Удалить запись подрядчика «" + record.article + "» за " + record.period + "? Исходная запись будет перемещена в архив.")) return;
    try {
      const response = await fetch("/api/subcontracts/" + encodeURIComponent(record.id), { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить подрядную запись.");
      await refreshReferenceData();
      render();
      if (payload.action === "archived") window.alert("Исходная запись перемещена в архив и больше не отображается в активном реестре.");
    } catch (error) {
      window.alert(error.message || "Не удалось удалить подрядную запись.");
    }
  }

  async function refreshSubcontracts() {
    const response = await fetch("/api/subcontracts", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить подрядные записи.");
    state.subcontracts = payload.records || [];
  }

  async function refreshOtherSubcontracts() {
    const response = await fetch("/api/other-subcontracts", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить прочий подряд.");
    state.otherSubcontractRecords = payload.records || [];
  }

  function updateProjectFilterOptions() {
    const projects = referenceRecords("projects");
    const projectNames = projects.map(function(project) { return project.name; });
    projectFilter.innerHTML = '<option value="all">Все проекты</option>' + projects.map(function(project) {
      return '<option value="' + escapeHtml(project.name) + '">' + escapeHtml(projectDisplay(project)) + '</option>';
    }).join("");
    if (state.project !== "all" && !projectNames.includes(state.project)) state.project = "all";
    projectFilter.value = state.project;
  }

  function normalizedText(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
  }

  function planIndexKey(parts) {
    return parts.map(normalizedText).join("\u001f");
  }

  function indexedPlanHours(index, parts) {
    return num(index[planIndexKey(parts)]);
  }

  function addPlanHours(index, parts, value) {
    const key = planIndexKey(parts);
    index[key] = num(index[key]) + num(value);
  }

  function buildPlanIndexes() {
    const staff = Object.create(null);
    const contractors = Object.create(null);
    const staffTeams = Object.create(null);
    const contractorTeams = Object.create(null);
    state.teamRecords.forEach(function(record) {
      if (record.archived) return;
      if (record.source === "Подряд") {
        const contractorKey = planIndexKey([record.project, record.employee]);
        if (!contractorTeams[contractorKey]) contractorTeams[contractorKey] = [];
        contractorTeams[contractorKey].push(record);
      } else {
        staffTeams[planIndexKey([record.project, record.employee, record.role])] = record;
      }
      const target = record.source === "Подряд" ? contractors : staff;
      const years = Object.keys(record.hoursPlan || {});
      years.forEach(function(year) {
        for (let month = 1; month <= 12; month += 1) {
          const value = teamHours(record, year, month);
          if (!value) continue;
          if (record.source === "Подряд") addPlanHours(target, [record.project, record.employee, year, month], value);
          else addPlanHours(target, [record.project, record.employee, record.role, year, month], value);
        }
      });
    });
    state.staffPlanIndex = staff;
    state.contractorPlanIndex = contractors;
    state.staffTeamIndex = staffTeams;
    state.contractorTeamIndex = contractorTeams;
  }

  async function refreshReferenceData() {
    const responses = await Promise.all([
      fetch("/api/model", { cache: "no-store" }),
      fetch("/api/subcontracts", { cache: "no-store" }),
      fetch("/api/references", { cache: "no-store" }),
      fetch("/api/team", { cache: "no-store" }),
      fetch("/api/staff", { cache: "no-store" }),
      fetch("/api/other-subcontracts", { cache: "no-store" })
    ]);
    const model = await responses[0].json();
    const subcontracts = await responses[1].json();
    const references = await responses[2].json();
    const team = await responses[3].json();
    const staff = await responses[4].json();
    const otherSubcontracts = await responses[5].json();
    if (!responses[0].ok) throw new Error(model.error || "Не удалось загрузить данные.");
    if (!responses[1].ok) throw new Error(subcontracts.error || "Не удалось загрузить подрядные записи.");
    if (!responses[2].ok) throw new Error(references.error || "Не удалось загрузить справочники.");
    if (!responses[3].ok) throw new Error(team.error || "Не удалось загрузить записи команды.");
    if (!responses[4].ok) throw new Error(staff.error || "Не удалось загрузить штатные записи.");
    if (!responses[5].ok) throw new Error(otherSubcontracts.error || "Не удалось загрузить прочий подряд.");
    state.snapshot = model.snapshot;
    state.overview = model.overview;
    state.subcontracts = subcontracts.records || [];
    state.teamRecords = team.records || [];
    state.staffRecords = staff.records || [];
    state.otherSubcontractRecords = otherSubcontracts.records || [];
    state.references = references.directories || {};
    await refreshFinancialData();
    buildPlanIndexes();
    updateProjectFilterOptions();
  }

  function historyButton(entity, id, directory) {
    return '<button class="secondary-button compact-button" data-change-history="' + escapeHtml(entity) + '" data-change-id="' + escapeHtml(id) + '"' + (directory ? ' data-change-directory="' + escapeHtml(directory) + '"' : "") + ' type="button">История</button>';
  }

  function closeChangeLogModal() {
    const modal = document.getElementById("change-log-modal");
    if (modal) modal.remove();
  }

  function changeActionLabel(action) {
    return ({ updated: "Изменение", archived: "Перемещение в архив", restored: "Восстановление", deleted: "Удаление" })[action] || "Изменение";
  }

  function changeDateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
  }

  async function showChangeLogModal(entity, id, directory) {
    closeChangeLogModal();
    const modal = document.createElement("div");
    modal.id = "change-log-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal change-log-modal" role="dialog" aria-modal="true" aria-labelledby="change-log-title"><div class="modal-header"><div><p class="eyebrow">История изменений</p><h2 id="change-log-title">Изменения записи</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><div class="change-log-content"><p class="muted">Загружаем историю…</p></div></section>';
    document.body.appendChild(modal);
    modal.querySelector(".close-button").addEventListener("click", closeChangeLogModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeChangeLogModal(); });
    try {
      const params = new URLSearchParams({ entity: entity, recordId: id });
      if (directory) params.set("directory", directory);
      const response = await fetch("/api/change-log?" + params.toString(), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить историю изменений.");
      const entries = payload.entries || [];
      const content = entries.length ? '<div class="change-log-list">' + entries.map(function(entry) {
        const changes = (entry.changes || []).length
          ? '<dl class="change-log-changes">' + entry.changes.map(function(change) { return '<div><dt>' + escapeHtml(change.field) + '</dt><dd><span>' + escapeHtml(change.before) + '</span><b>→</b><span>' + escapeHtml(change.after) + '</span></dd></div>'; }).join("") + '</dl>'
          : '<p class="change-log-empty-change">Изменённых полей нет: зафиксировано действие над записью.</p>';
        return '<article class="change-log-entry"><div><strong>' + escapeHtml(changeActionLabel(entry.action)) + '</strong><span>' + escapeHtml(changeDateLabel(entry.changedAt)) + '</span></div>' + changes + '</article>';
      }).join("") + '</div>' : empty("Изменений этой записи пока нет.");
      modal.querySelector(".change-log-content").innerHTML = content;
    } catch (error) {
      modal.querySelector(".change-log-content").innerHTML = '<p class="form-note error-note">' + escapeHtml(error.message || "Не удалось загрузить историю изменений.") + '</p>';
    }
  }

  function inlineCell(content, config, className) {
    const classes = (className || "") + (config ? " inline-editable" : "");
    if (!config) return '<td' + (classes ? ' class="' + escapeHtml(classes.trim()) + '"' : "") + '>' + content + '</td>';
    const attributes = Object.keys(config).map(function(key) { return ' data-inline-' + key.replace(/[A-Z]/g, function(letter) { return "-" + letter.toLowerCase(); }) + '="' + escapeHtml(config[key]) + '"'; }).join("");
    return '<td class="' + escapeHtml(classes.trim()) + '" tabindex="0" title="Дважды щёлкните, чтобы изменить"' + attributes + '>' + content + '</td>';
  }

  function inlineRecord(cell) {
    const scope = cell.dataset.inlineScope;
    if (scope === "reference") return findReference(cell.dataset.inlineDirectory, cell.dataset.inlineId);
    if (scope === "team") return findTeamRecord(cell.dataset.inlineId);
    if (scope === "staff") return state.staffRecords.find(function(record) { return record.id === cell.dataset.inlineId; });
    if (scope === "subcontract") return state.subcontracts.find(function(record) { return record.id === cell.dataset.inlineId; });
    if (scope === "otherSubcontract") return state.otherSubcontractRecords.find(function(record) { return record.id === cell.dataset.inlineId; });
    return null;
  }

  function inlineEditorDefinition(cell, record) {
    const scope = cell.dataset.inlineScope;
    const field = cell.dataset.inlineField;
    if (scope === "reference") {
      if (field === "code") return { type: "text", value: record.code || "" };
      if (field === "providerType") return { type: "select", value: record.providerType, options: referenceRecords("providers").map(function(item) { return { value: item.name, label: item.name }; }) };
      if (field === "vendor") return { type: "select", value: record.vendor, options: referenceRecords("vendors").map(function(item) { return { value: item.name, label: item.name }; }) };
      if (field === "category") return { type: "select", value: record.category, options: ["Основные", "Косвенные", "Прочие"].map(function(item) { return { value: item, label: item }; }) };
      return { type: "text", value: record.name };
    }
    if (scope === "team") {
      if (field === "employee") return { type: "select", value: record.employee, options: referenceRecords("resources").filter(function(item) { return item.vendor === record.vendor; }).map(function(item) { return { value: item.name, label: item.name }; }) };
      if (field === "vendor") return { type: "select", value: record.vendor, options: referenceRecords("vendors").filter(function(item) {
        return referenceRecords("resources").some(function(resource) { return resource.vendor === item.name; });
      }).map(function(item) { return { value: item.name, label: item.name }; }) };
      if (field === "project") return { type: "select", value: record.project, options: referenceRecords("projects").map(function(item) { return { value: item.name, label: item.name }; }) };
      if (field === "role") return { type: "select", value: record.role, options: referenceRecords("roles").map(function(item) { return { value: item.name, label: item.name }; }) };
      return { type: "number", value: teamHours(record, cell.dataset.inlineYear, cell.dataset.inlineMonth), min: "0", step: "0.5" };
    }
    if (scope === "staff") {
      if (field === "employee") return { type: "staff-assignment", value: record.employee + "|" + record.project + "|" + record.role, options: staffPlanAssignments().map(function(item) { return { value: item.employee + "|" + item.project + "|" + item.role, label: item.employee + " · " + staffVendorForTeamRecord(item) + " · " + item.project + " · " + item.role, assignment: item }; }) };
      return { type: "number", value: staffActualHours(record, cell.dataset.inlineYear, cell.dataset.inlineMonth), min: "0", step: "0.5" };
    }
    if (scope === "subcontract") {
      if (field === "resource") return {
        type: "subcontract-assignment",
        value: record.resource + "|" + record.project,
        options: subcontractPlanAssignments().map(function(item) {
          return { value: item.employee + "|" + item.project, label: item.employee + " · " + subcontractResourceSupplier(item) + " · " + item.project + " · " + item.role, assignment: item };
        })
      };
      if (field === "project") return {
        type: "select",
        value: record.project,
        options: subcontractPlanAssignments().filter(function(item) { return item.employee === record.resource; }).map(function(item) {
          return { value: item.project, label: item.project };
        })
      };
      return field === "actualHours"
        ? { type: "number", value: record.actualHours, min: "0", step: "0.5" }
        : { type: "text", value: record.article };
    }
    if (scope === "otherSubcontract") {
      return { type: "number", value: num(record[field] && record[field][String(cell.dataset.inlineYear)] && record[field][String(cell.dataset.inlineYear)][String(cell.dataset.inlineMonth)]), min: "0", step: "0.01" };
    }
    return null;
  }

  async function saveInlineEdit(cell, record, definition, value, originalHtml) {
    const scope = cell.dataset.inlineScope;
    const field = cell.dataset.inlineField;
    let endpoint = "";
    let body = {};
    if (scope === "reference") {
      endpoint = "/api/references/" + cell.dataset.inlineDirectory + "/" + encodeURIComponent(record.id);
      body = { name: record.name, code: record.code, providerType: record.providerType, vendor: record.vendor, category: record.category, costPlan: record.costPlan, vatPlan: record.vatPlan, archived: record.archived };
      body[field] = value;
    } else if (scope === "team") {
      endpoint = "/api/team/" + encodeURIComponent(record.id);
      if (field === "hoursPlan") {
        const hoursPlan = JSON.parse(JSON.stringify(record.hoursPlan || {}));
        hoursPlan[cell.dataset.inlineYear] = hoursPlan[cell.dataset.inlineYear] || {};
        hoursPlan[cell.dataset.inlineYear][cell.dataset.inlineMonth] = Number(value);
        body.hoursPlan = hoursPlan;
      } else if (field === "vendor") {
        const availableResource = referenceRecords("resources").find(function(item) { return item.vendor === value; });
        body = { vendor: value, employee: availableResource ? availableResource.name : record.employee };
      } else body[field] = value;
    } else if (scope === "staff") {
      endpoint = "/api/staff/" + encodeURIComponent(record.id);
      if (field === "employee") {
        const assignment = definition.options.find(function(item) { return item.value === value; });
        if (!assignment) {
          cell.innerHTML = originalHtml;
          window.alert("Выберите сотрудника из плана команды.");
          return;
        }
        body = { employee: assignment.assignment.employee, project: assignment.assignment.project, role: assignment.assignment.role };
      } else {
        const hoursActual = JSON.parse(JSON.stringify(record.hoursActual || {}));
        hoursActual[cell.dataset.inlineYear] = hoursActual[cell.dataset.inlineYear] || {};
        hoursActual[cell.dataset.inlineYear][cell.dataset.inlineMonth] = Number(value);
        body.hoursActual = hoursActual;
      }
    } else if (scope === "subcontract") {
      endpoint = "/api/subcontracts/" + encodeURIComponent(record.id);
      if (field === "resource") {
        const assignment = definition.options.find(function(item) { return item.value === value; });
        if (!assignment) {
          cell.innerHTML = originalHtml;
          window.alert("Выберите ресурс из активного плана «Подряд».");
          return;
        }
        body = { resource: assignment.assignment.employee, project: assignment.assignment.project, vendor: subcontractResourceSupplier(assignment.assignment) };
      } else body[field] = field === "actualHours" ? Number(value) : value;
    } else if (scope === "otherSubcontract") {
      endpoint = "/api/other-subcontracts/" + encodeURIComponent(record.id);
      const values = JSON.parse(JSON.stringify(record[field] || {}));
      const year = String(cell.dataset.inlineYear);
      const month = String(cell.dataset.inlineMonth);
      values[year] = values[year] || {};
      values[year][month] = Number(value);
      body[field] = values;
    }
    try {
      cell.classList.add("inline-saving");
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(Object.values(payload.fields || {})[0] || payload.error || "Не удалось сохранить значение.");
      await refreshReferenceData();
      render();
    } catch (error) {
      cell.innerHTML = originalHtml;
      cell.classList.remove("inline-saving");
      window.alert(error.message || "Не удалось сохранить значение.");
    }
  }

  function startInlineEdit(cell) {
    if (cell.querySelector("input, select")) return;
    const record = inlineRecord(cell);
    if (!record || record.archived) return;
    const definition = inlineEditorDefinition(cell, record);
    if (!definition) return;
    const originalHtml = cell.innerHTML;
    const editor = document.createElement(definition.type === "select" || definition.type === "staff-assignment" || definition.type === "subcontract-assignment" ? "select" : "input");
    if (editor.tagName === "INPUT") {
      editor.type = definition.type;
      editor.value = definition.value == null ? "" : definition.value;
      if (definition.min) editor.min = definition.min;
      if (definition.step) editor.step = definition.step;
    } else {
      (definition.options || []).forEach(function(option) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        if (option.value === definition.value) element.selected = true;
        editor.appendChild(element);
      });
    }
    editor.className = "inline-editor";
    cell.innerHTML = "";
    cell.appendChild(editor);
    let saved = false;
    const commit = function() {
      if (saved) return;
      saved = true;
      saveInlineEdit(cell, record, definition, editor.value, originalHtml);
    };
    const cancel = function() { if (!saved) { saved = true; cell.innerHTML = originalHtml; } };
    if (editor.tagName === "SELECT") editor.addEventListener("change", commit);
    editor.addEventListener("keydown", function(event) {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
    });
    editor.addEventListener("blur", commit);
    editor.focus();
    if (editor.select) editor.select();
  }

  function bindInlineEditing() {
    document.querySelectorAll("td.inline-editable").forEach(function(cell) {
      cell.addEventListener("dblclick", function(event) { event.preventDefault(); startInlineEdit(cell); });
      cell.addEventListener("keydown", function(event) { if (event.key === "Enter") { event.preventDefault(); startInlineEdit(cell); } });
    });
  }

  function bindChangeLogControls() {
    document.querySelectorAll("[data-change-history]").forEach(function(button) {
      button.addEventListener("click", function() { showChangeLogModal(button.dataset.changeHistory, button.dataset.changeId, button.dataset.changeDirectory); });
    });
  }

  function closeReferenceModal() {
    const modal = document.getElementById("reference-modal");
    if (modal) modal.remove();
  }

  function findReference(directory, id) {
    return referenceRecords(directory, true).find(function(item) { return item.id === id; });
  }

  function referencePeriodYears(plan) {
    const base = (state.snapshot.finance.years || []).map(String);
    return Array.from(new Set(base.concat(Object.keys(plan || {})))).sort(function(left, right) { return Number(left) - Number(right); });
  }

  function referenceNewYearOptions(plan) {
    const used = new Set(referencePeriodYears(plan));
    return Array.from({ length: 12 }, function(_, index) { return String(2024 + index); }).filter(function(year) { return !used.has(year); });
  }

  function monthlyAverage(values) {
    return sum(Array.from({ length: 12 }, function(_, index) { return { value: num(values && values[String(index + 1)]) }; }), "value") / 12;
  }

  function resourceCostYearBlock(item, year) {
    const values = Array.from({ length: 12 }, function(_, index) { return teamCostValues(item, year, index + 1); });
    const average = values.reduce(function(total, value) { return total + value.cost; }, 0) / 12;
    return '<details class="period-editor" data-period-kind="cost" data-period-year="' + escapeHtml(year) + '"><summary><span>' + escapeHtml(year) + '</span><b data-period-average>Средняя стоимость: ' + escapeHtml(money(average)) + '/ч</b><em>Развернуть месяцы</em></summary><div class="team-cost-month-grid">' + teamMonthLabels.map(function(label, index) {
      const month = index + 1;
      const value = values[index];
      return '<div class="team-cost-month-row"><strong>' + label + '</strong><label>Ставка, ₽<input data-cost-input type="number" name="rate-' + escapeHtml(year) + '-' + month + '" min="0" step="0.01" value="' + escapeHtml(value.rate) + '"></label><label>Привлечение, ₽<input data-cost-input type="number" name="attraction-' + escapeHtml(year) + '-' + month + '" min="0" step="0.01" value="' + escapeHtml(value.attraction) + '"></label><label>Стоимость, ₽<input class="calculated-field" data-cost-total type="text" value="' + escapeHtml(money(value.cost)) + '" readonly></label></div>';
    }).join("") + '</div></details>';
  }

  function vendorVatYearBlock(item, year) {
    const values = item.vatPlan && item.vatPlan[year] || {};
    const average = monthlyAverage(values);
    const seeded = Object.keys(values).some(function(month) { return Number(values[month]) !== 0; });
    return '<details class="period-editor vat-period-editor" data-period-kind="vat" data-period-year="' + escapeHtml(year) + '" data-vat-seeded="' + seeded + '"><summary><span>' + escapeHtml(year) + '</span><b data-period-average>Средний НДС: ' + escapeHtml(percent(average / 100)) + '</b><em>Развернуть месяцы</em></summary><div class="vat-month-grid">' + teamMonthLabels.map(function(label, index) {
      const month = index + 1;
      const selected = num(values[String(month)]);
      return '<label><span>' + label + '</span><select data-vat-input name="vat-' + escapeHtml(year) + '-' + month + '">' + [0, 5, 7, 10, 22].map(function(rate) { return '<option value="' + rate + '"' + (rate === selected ? " selected" : "") + '>' + rate + '%</option>'; }).join("") + '</select></label>';
    }).join("") + '</div></details>';
  }

  function referencePeriodAddControl(kind, plan) {
    const years = referenceNewYearOptions(plan);
    if (!years.length) return "";
    return '<div class="period-add-control"><label>Новый год<select data-period-add-select="' + kind + '">' + years.map(function(year) { return '<option value="' + year + '">' + year + '</option>'; }).join("") + '</select></label><button class="secondary-button compact-button" data-period-add="' + kind + '" type="button">+ Добавить год</button></div>';
  }

  function referenceCostSection(item) {
    const years = referencePeriodYears(item.costPlan);
    return '<section class="cost-form-section reference-period-section" data-reference-period-section="cost"><div><strong>Стоимость, ₽</strong><span>Ставка + привлечение по месяцам</span></div><p class="form-note">Блоки по годам свёрнуты. В заголовке показана средняя стоимость за 12 месяцев.</p><div data-period-blocks="cost">' + years.map(function(year) { return resourceCostYearBlock(item, year); }).join("") + '</div>' + referencePeriodAddControl("cost", item.costPlan) + '<small data-error="costPlan"></small></section>';
  }

  function referenceVatSection(item) {
    const years = referencePeriodYears(item.vatPlan);
    return '<section class="cost-form-section reference-period-section" data-reference-period-section="vat"><div><strong>НДС</strong><span>Ставка НДС по месяцам</span></div><p class="form-note">Допустимы только ставки 0%, 5%, 7%, 10% и 22%. Первая выбранная ставка заполняет последующие месяцы года; любое значение затем можно изменить.</p><div data-period-blocks="vat">' + years.map(function(year) { return vendorVatYearBlock(item, year); }).join("") + '</div>' + referencePeriodAddControl("vat", item.vatPlan) + '<small data-error="vatPlan"></small></section>';
  }

  function fillFollowingVatMonths(details, input) {
    if (!details || details.dataset.vatSeeded === "true") return;
    const inputs = Array.from(details.querySelectorAll("[data-vat-input]"));
    const index = inputs.indexOf(input);
    if (index < 0) return;
    inputs.slice(index + 1).forEach(function(monthInput) { monthInput.value = input.value; });
    details.dataset.vatSeeded = "true";
  }

  function updateReferencePeriodSummary(form, kind, year) {
    const details = form.querySelector('[data-period-kind="' + kind + '"][data-period-year="' + year + '"]');
    if (!details) return;
    const summary = details.querySelector("[data-period-average]");
    if (!summary) return;
    if (kind === "cost") {
      const values = Array.from({ length: 12 }, function(_, index) {
        const month = index + 1;
        const rate = num(form.elements["rate-" + year + "-" + month].value);
        const attraction = num(form.elements["attraction-" + year + "-" + month].value);
        const total = form.elements["rate-" + year + "-" + month].closest(".team-cost-month-row").querySelector("[data-cost-total]");
        if (total) total.value = money(rate + attraction);
        return rate + attraction;
      });
      summary.textContent = "Средняя стоимость: " + money(values.reduce(function(total, value) { return total + value; }, 0) / 12) + "/ч";
      return;
    }
    const values = Array.from({ length: 12 }, function(_, index) { return num(form.elements["vat-" + year + "-" + (index + 1)].value); });
    summary.textContent = "Средний НДС: " + percent(values.reduce(function(total, value) { return total + value; }, 0) / 1200);
  }

  function collectReferencePeriodPlan(form, kind) {
    return Array.from(form.querySelectorAll('[data-period-kind="' + kind + '"]')).reduce(function(result, details) {
      const year = details.dataset.periodYear;
      result[year] = {};
      for (let month = 1; month <= 12; month += 1) {
        result[year][String(month)] = kind === "cost"
          ? { rate: num(form.elements["rate-" + year + "-" + month].value), attraction: num(form.elements["attraction-" + year + "-" + month].value) }
          : num(form.elements["vat-" + year + "-" + month].value);
      }
      return result;
    }, {});
  }

  function showReferenceModal(directory, record) {
    const editing = Boolean(record);
    const providerType = directory === "providers";
    const project = directory === "projects";
    const vendor = directory === "vendors";
    const resource = directory === "resources";
    const otherSubcontract = directory === "otherSubcontracts";
    const title = state.references[directory] && state.references[directory].title || "Справочник";
    const item = record || { name: "", providerType: "", vatPlan: {}, costPlan: {}, category: "Основные" };
    const modal = document.createElement("div");
    modal.id = "reference-modal";
    modal.className = "modal-backdrop";
    const fields = project
      ? '<label>Код проекта <b>*</b><input name="code" value="' + escapeHtml(item.code || "") + '" minlength="2" maxlength="32" pattern="[A-Za-z0-9_-]{2,32}" placeholder="Например, EDC-2026" autofocus><small data-error="code"></small></label><label>Наименование <b>*</b><input name="name" value="' + escapeHtml(item.name) + '"><small data-error="name"></small></label>'
      : vendor
      ? '<label>Наименование <b>*</b><input name="name" value="' + escapeHtml(item.name) + '" autofocus><small data-error="name"></small></label><label>Тип поставщика <b>*</b><select name="providerType">' + referenceOptions("providers", item.providerType, "Выберите тип поставщика") + '</select><small data-error="providerType"></small></label>'
      : (resource
        ? '<label>Сотрудник / ресурс <b>*</b><input name="name" value="' + escapeHtml(item.name) + '" autofocus><small data-error="name"></small></label><label>Поставщик <b>*</b><select name="vendor">' + referenceOptions("vendors", item.vendor, "Выберите поставщика") + '</select><small data-error="vendor"></small></label>'
        : (otherSubcontract
          ? '<label>Статья/Подрядчик <b>*</b><input name="name" value="' + escapeHtml(item.name) + '" autofocus><small data-error="name"></small></label><label>Категория <b>*</b><select name="category"><option value="Основные"' + (item.category === "Основные" ? " selected" : "") + '>Основные</option><option value="Косвенные"' + (item.category === "Косвенные" ? " selected" : "") + '>Косвенные</option><option value="Прочие"' + (item.category === "Прочие" ? " selected" : "") + '>Прочие</option></select><small data-error="category"></small></label>'
          : '<label>' + (providerType ? "Тип поставщика" : "Наименование") + ' <b>*</b><input name="name" value="' + escapeHtml(item.name) + '" autofocus><small data-error="name"></small></label>'));
    const note = project ? "Код обязателен, уникален и отображается в финансовых формах как «КОД — Наименование». После первой операции поступления или оплаты изменить его нельзя."
      : (providerType ? "Укажите доступный тип: «Штат» или «Подряд»." : (vendor ? "Поставщик выбирается в формах только при наличии активного типа поставщика." : (resource ? "Сотрудник или ресурс выбирается на вкладке 06 только вместе со связанным поставщиком." : (otherSubcontract ? "Тип поставщика фиксирован: «Подряд». Основные — затраты на вычислительные мощности, лицензии и т.д.; косвенные — сопутствующие затраты; прочие — навязанный субподряд." : ""))));
    const costSection = resource ? referenceCostSection(item) : "";
    const vatSection = vendor || otherSubcontract ? referenceVatSection(item) : "";
    modal.innerHTML = '<section class="modal reference-modal" role="dialog" aria-modal="true" aria-labelledby="reference-modal-title"><div class="modal-header"><div><p class="eyebrow">НСИ</p><h2 id="reference-modal-title">' + (editing ? "Редактировать: " : "Новая запись: ") + escapeHtml(title) + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="reference-form"><div class="form-grid ' + ((vendor || resource || otherSubcontract) ? "" : "single-field") + '">' + fields + '</div>' + costSection + vatSection + '<p class="form-note">' + note + '</p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    modal.querySelector(".close-button").addEventListener("click", closeReferenceModal);
    modal.querySelector("[data-close]").addEventListener("click", closeReferenceModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeReferenceModal(); });
    const referenceForm = modal.querySelector("form");
    const vatSectionElement = modal.querySelector('[data-reference-period-section="vat"]');
    const syncVatVisibility = function() { if (vatSectionElement && vendor) vatSectionElement.hidden = referenceForm.elements.providerType.value !== "Подряд"; };
    if (vendor) {
      referenceForm.elements.providerType.addEventListener("change", syncVatVisibility);
      syncVatVisibility();
    }
    const updateReferencePeriods = function(event) {
      const details = event.target.closest("[data-period-kind]");
      if (details && (event.target.matches("[data-cost-input]") || event.target.matches("[data-vat-input]"))) updateReferencePeriodSummary(referenceForm, details.dataset.periodKind, details.dataset.periodYear);
    };
    referenceForm.addEventListener("input", updateReferencePeriods);
    referenceForm.addEventListener("change", function(event) {
      const details = event.target.closest('[data-period-kind="vat"]');
      if (details && event.target.matches("[data-vat-input]")) fillFollowingVatMonths(details, event.target);
      updateReferencePeriods(event);
    });
    referenceForm.querySelectorAll("[data-period-add]").forEach(function(button) {
      button.addEventListener("click", function() {
        const kind = button.dataset.periodAdd;
        const select = referenceForm.querySelector('[data-period-add-select="' + kind + '"]');
        const year = select && select.value;
        if (!year) return;
        const blocks = referenceForm.querySelector('[data-period-blocks="' + kind + '"]');
        if (!blocks || blocks.querySelector('[data-period-year="' + year + '"]')) return;
        blocks.insertAdjacentHTML("beforeend", kind === "cost" ? resourceCostYearBlock({ costPlan: {} }, year) : vendorVatYearBlock({ vatPlan: {} }, year));
        select.querySelector('option[value="' + year + '"]').remove();
        if (!select.options.length) button.closest(".period-add-control").remove();
      });
    });
    referenceForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      ["code", "name", "providerType", "vendor", "category", "costPlan", "vatPlan"].forEach(function(name) { formError(name, ""); });
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (resource) body.costPlan = collectReferencePeriodPlan(referenceForm, "cost");
      if (vendor) body.vatPlan = body.providerType === "Подряд" ? collectReferencePeriodPlan(referenceForm, "vat") : {};
      if (otherSubcontract) body.vatPlan = collectReferencePeriodPlan(referenceForm, "vat");
      try {
        const response = await fetch(editing ? "/api/references/" + directory + "/" + encodeURIComponent(record.id) : "/api/references/" + directory, {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) {
          Object.keys(payload.fields || {}).forEach(function(name) { formError(name, payload.fields[name]); });
          if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить запись.");
          return;
        }
        await refreshReferenceData();
        closeReferenceModal();
        render();
      } catch (error) {
        formError("name", error.message || "Не удалось сохранить запись.");
      }
    });
  }

  async function deleteReference(directory, record) {
    if (!window.confirm("Удалить запись «" + record.name + "»? Если она используется, запись будет перемещена в архив.")) return;
    try {
      const response = await fetch("/api/references/" + directory + "/" + encodeURIComponent(record.id), { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить запись.");
      await refreshReferenceData();
      render();
      if (payload.action === "archived") window.alert("Запись используется и поэтому перемещена в архив. Она больше недоступна для выбора.");
    } catch (error) {
      window.alert(error.message || "Не удалось удалить запись.");
    }
  }

  async function restoreReference(directory, record) {
    try {
      const response = await fetch("/api/references/" + directory + "/" + encodeURIComponent(record.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: record.name, code: record.code, value: record.value, providerType: record.providerType, vendor: record.vendor, category: record.category, costPlan: record.costPlan, vatPlan: record.vatPlan, archived: false })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось восстановить запись.");
      await refreshReferenceData();
      render();
    } catch (error) {
      window.alert(error.message || "Не удалось восстановить запись.");
    }
  }

  const financialRateLabels = { profitTax: "Налог на прибыль", investment: "Инвестиции", overdraft: "Овердрафт", directorate: "Дирекция" };

  function financialRatesDirectory() {
    const records = referenceRecords("financialRates");
    const rows = records.slice().sort(function(left, right) { return (left.type + left.year + left.project).localeCompare(right.type + right.year + right.project, "ru-RU"); }).map(function(record) {
      return '<tr><td>' + escapeHtml(financialRateLabels[record.type] || record.type) + '</td><td>' + escapeHtml(record.projectCode ? record.projectCode + " — " + record.project : "Все проекты") + '</td><td>' + escapeHtml(record.year) + '</td><td>' + percent(num(record.rate) / 100) + '</td><td class="reference-actions"><button class="edit-button" data-financial-rate-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-financial-rate-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button>' + historyButton("financial-rate", record.id, "") + '</td></tr>';
    }).join("") || '<tr><td colspan="5">' + empty("Ставки ещё не заведены.") + '</td></tr>';
    return '<article class="panel reference-directory">' + sectionTitle("Финансовые ставки", "Ставки используются в финансовом план‑факте. Ставка «Дирекция» задаётся только для конкретного проекта; остальные допускают общий вариант.", integer(records.length)) + '<div class="table-toolbar"><span class="table-edit-hint">Отсутствующая обязательная ставка выводит «Не рассчитано» — ноль не подставляется.</span><button class="primary-button" id="add-financial-rate" type="button">+ Новая ставка</button></div><div class="table-wrap"><table><thead><tr><th>Показатель</th><th>Проект</th><th>Год</th><th>Ставка</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></article>';
  }

  function closeFinancialRateModal() { const modal = document.getElementById("financial-rate-modal"); if (modal) modal.remove(); }

  function showFinancialRateModal(record) {
    const editing = Boolean(record);
    const item = Object.assign({ type: "profitTax", projectId: "", year: state.year === "all" ? currentHoursYear() : state.year, rate: "" }, record || {});
    const modal = document.createElement("div"); modal.id = "financial-rate-modal"; modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal financial-event-modal" role="dialog" aria-modal="true" aria-labelledby="financial-rate-title"><div class="modal-header"><div><p class="eyebrow">НСИ</p><h2 id="financial-rate-title">' + (editing ? "Редактировать финансовую ставку" : "Новая финансовая ставка") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form><div class="form-grid"><label>Показатель <b>*</b><select name="type">' + Object.keys(financialRateLabels).map(function(type) { return '<option value="' + type + '"' + (type === item.type ? " selected" : "") + '>' + financialRateLabels[type] + '</option>'; }).join("") + '</select><small data-error="type"></small></label><label>Проект<select name="projectId"><option value="">Все проекты</option>' + activeCodedProjects().map(function(project) { return '<option value="' + escapeHtml(project.id) + '"' + (project.id === item.projectId ? " selected" : "") + '>' + escapeHtml(projectDisplay(project)) + '</option>'; }).join("") + '</select><small data-error="projectId"></small></label><label>Год <b>*</b><input name="year" type="number" min="2024" max="2100" value="' + escapeHtml(item.year) + '"><small data-error="year"></small></label><label>Ставка, % <b>*</b><input name="rate" type="number" min="0" max="100" step="0.01" value="' + escapeHtml(item.rate) + '"><small data-error="rate"></small></label></div><p class="form-note" data-rate-note></p><div class="form-actions"><button class="secondary-button" data-close type="button">Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal); const form = modal.querySelector("form");
    const close = closeFinancialRateModal; modal.querySelector(".close-button").addEventListener("click", close); modal.querySelector("[data-close]").addEventListener("click", close); modal.addEventListener("click", function(event) { if (event.target === modal) close(); });
    const updateNote = function() { const directorate = form.elements.type.value === "directorate"; form.elements.projectId.required = directorate; form.querySelector("[data-rate-note]").textContent = directorate ? "Для «Дирекции» выберите проект: общая ставка не применяется." : "Для общей ставки оставьте «Все проекты»; проектная ставка приоритетнее общей."; };
    form.elements.type.addEventListener("change", updateNote); updateNote();
    form.addEventListener("submit", async function(event) { event.preventDefault(); ["type", "projectId", "year", "rate"].forEach(function(field) { formError(field, ""); }); const body = Object.fromEntries(new FormData(form).entries()); body.year = Number(body.year); body.rate = Number(body.rate); if (body.type === "directorate" && !body.projectId) { formError("projectId", "Выберите проект для ставки дирекции"); return; } try { const response = await fetch(editing ? "/api/financial/rates/" + encodeURIComponent(record.id) : "/api/financial/rates", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) { Object.keys(payload.fields || {}).forEach(function(field) { formError(field, payload.fields[field]); }); if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить ставку."); return; } await refreshFinancialData(); close(); render(); } catch (error) { formError("rate", error.message || "Не удалось сохранить ставку."); } });
    form.elements.type.focus();
  }

  async function deleteFinancialRate(record) {
    if (!window.confirm("Удалить финансовую ставку?")) return;
    const response = await fetch("/api/financial/rates/" + encodeURIComponent(record.id), { method: "DELETE" });
    if (!response.ok) { window.alert("Не удалось удалить ставку."); return; }
    await refreshFinancialData(); render();
  }

  function bindReferenceControls() {
    document.querySelectorAll("[data-reference-page]").forEach(function(button) {
      button.addEventListener("click", function() {
        state.referenceDirectory = button.dataset.referencePage;
        render();
      });
    });
    document.querySelectorAll("[data-reference-add]").forEach(function(button) {
      button.addEventListener("click", function() { showReferenceModal(button.dataset.referenceAdd, null); });
    });
    document.querySelectorAll("[data-reference-edit]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = findReference(button.dataset.referenceEdit, button.dataset.referenceId);
        if (record) showReferenceModal(button.dataset.referenceEdit, record);
      });
    });
    document.querySelectorAll("[data-reference-delete]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = findReference(button.dataset.referenceDelete, button.dataset.referenceId);
        if (record) deleteReference(button.dataset.referenceDelete, record);
      });
    });
    document.querySelectorAll("[data-reference-restore]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = findReference(button.dataset.referenceRestore, button.dataset.referenceId);
        if (record) restoreReference(button.dataset.referenceRestore, record);
      });
    });
    const addFinancialRate = document.getElementById("add-financial-rate");
    if (addFinancialRate) addFinancialRate.addEventListener("click", function() { showFinancialRateModal(null); });
    document.querySelectorAll("[data-financial-rate-edit]").forEach(function(button) { button.addEventListener("click", function() { const record = referenceRecords("financialRates", true).find(function(item) { return item.id === button.dataset.financialRateEdit; }); if (record) showFinancialRateModal(record); }); });
    document.querySelectorAll("[data-financial-rate-delete]").forEach(function(button) { button.addEventListener("click", function() { const record = referenceRecords("financialRates", true).find(function(item) { return item.id === button.dataset.financialRateDelete; }); if (record) deleteFinancialRate(record); }); });
  }

  function bindSubcontractControls() {
    const add = document.getElementById("add-subcontract");
    if (add) add.addEventListener("click", function() { showSubcontractModal(null); });
    document.querySelectorAll("[data-subcontract-year-expand]").forEach(function(button) {
      button.addEventListener("click", function() {
        const year = button.dataset.subcontractYearExpand;
        state.expandedSubcontractYears[year] = !state.expandedSubcontractYears[year];
        render();
      });
    });
    document.querySelectorAll("[data-subcontract-page]").forEach(function(button) {
      button.addEventListener("click", function() {
        state.subcontractPage = Number(button.dataset.subcontractPage);
        render();
      });
    });
    document.querySelectorAll("[data-subcontract-id]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = state.subcontracts.find(function(item) { return item.id === button.dataset.subcontractId; });
        if (record) showSubcontractModal(record);
      });
    });
    document.querySelectorAll("[data-subcontract-delete]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = state.subcontracts.find(function(item) { return item.id === button.dataset.subcontractDelete; });
        if (record) deleteSubcontractRecord(record);
      });
    });
  }

  function bindStaffControls() {
    const add = document.getElementById("add-staff-record");
    if (add) add.addEventListener("click", function() { showStaffModal(null); });
    document.querySelectorAll("[data-staff-year-expand]").forEach(function(button) {
      button.addEventListener("click", function() {
        const year = button.dataset.staffYearExpand;
        state.expandedStaffYears[year] = !state.expandedStaffYears[year];
        render();
      });
    });
    document.querySelectorAll("[data-staff-edit]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = state.staffRecords.find(function(item) { return item.id === button.dataset.staffEdit; });
        if (record) showStaffModal(record);
      });
    });
    document.querySelectorAll("[data-staff-delete]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = state.staffRecords.find(function(item) { return item.id === button.dataset.staffDelete; });
        if (record) deleteStaffRecord(record);
      });
    });
    document.querySelectorAll("[data-staff-restore]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = state.staffRecords.find(function(item) { return item.id === button.dataset.staffRestore; });
        if (record) restoreStaffRecord(record);
      });
    });
  }

  function renderStaff() {
    const allYears = state.year === "all";
    const years = allYears ? teamPlanYears() : [String(state.year)];
    const months = staffContextMonths();
    const records = staffRecordsForContext(years, months, false);
    const archived = staffRecordsForContext(years, months, true).filter(function(record) { return record.archived; });
    const cost = sum(records.map(function(record) { return { value: teamCostValues(record.teamRecord || staffTeamRecord(record)).cost }; }), "value");
    const plannedHours = sum(records.map(function(item) { return { value: staffHoursTotal(item, years, staffPlanHours, months) }; }), "value");
    const actualHours = sum(records.map(function(item) { return { value: staffHoursTotal(item, years, staffActualHours, months) }; }), "value");
    const activePeople = new Set(records.map(function(item) { return item.employee; })).size;
    const planTable = allYears ? staffAllYearsTable(records, years, months, false) : staffTable(records, years[0], months, false);
    const archiveTable = allYears ? staffAllYearsTable(archived, years, months, true) : staffTable(archived, years[0], months, true);
    const periodLabel = allYears ? "за все доступные годы" : "по месяцам " + years[0] + " года";
    const selectedMonthNote = state.staffMonth === "all" ? "" : " Выбран " + teamMonthLabels[months[0] - 1] + ": отображаются данные только этого месяца" + (allYears ? " в каждом году." : ".");
    return '<section class="metric-grid compact hours-metric-grid">' +
      card("Стоимость ресурсов", money(cost, true), "ставка + привлечение из НСИ", "violet") +
      card("Часы · план", integer(plannedHours) + " ч", "из вкладки 06 · " + periodLabel, "cyan") +
      card("Часы · факт", integer(actualHours) + " ч", "введено на этой странице", "blue") +
      card("Специалисты", integer(activePeople), "в выбранном проектном срезе", "blue") +
      '</section>' +
      '<section class="panel staff-plan-table">' + sectionTitle("Суммы и часы штат", allYears ? "Годовые итоги плановых и фактических часов с возможностью раскрытия месяцев." : "План и факт часов в разрезе месяцев выбранного года.", allYears ? "все годы" : years[0]) +
      '<div class="table-toolbar"><span class="table-edit-hint">Строки формируются по НСИ и плану команды; двойной клик по доступному полю — редактирование</span></div>' +
      planTable +
      (archived.length ? '<details class="archive-details"><summary>Архивные записи · ' + integer(archived.length) + '</summary>' + archiveTable + '</details>' : "") +
      '<p class="table-note">' + (allYears && state.staffMonth === "all" ? "Нажмите на название года, чтобы развернуть его по месяцам." : "Показаны строки, у которых есть план или факт часов в выбранном контексте.") + selectedMonthNote + " План часов поступает из раздела 06, стоимость, ставка и привлечение — из НСИ «Сотрудник / ресурс», а факт вводится на этой странице. Годовые показатели рассчитываются по плановым часам отображаемого периода." + '</p></section>';
  }

  function closeStaffModal() {
    const modal = document.getElementById("staff-modal");
    if (modal) modal.remove();
  }

  function staffPlanAssignments() {
    const seen = new Set();
    return state.teamRecords.filter(function(record) {
      return !record.archived && record.source === "Штат" && record.employee && record.project && record.role;
    }).filter(function(record) {
      const key = normalizedText(record.employee) + "|" + normalizedText(record.vendor) + "|" + normalizedText(record.project) + "|" + normalizedText(record.role);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function(left, right) {
      return (left.employee + "|" + staffVendorForTeamRecord(left) + "|" + left.project + "|" + left.role).localeCompare(right.employee + "|" + staffVendorForTeamRecord(right) + "|" + right.project + "|" + right.role, "ru-RU");
    });
  }

  function staffEmployeeOptions(selectedEmployee, selectedProject, selectedRole) {
    const assignments = staffPlanAssignments();
    const available = assignments.some(function(record) {
      return record.employee === selectedEmployee && record.project === selectedProject && record.role === selectedRole;
    });
    const unavailable = selectedEmployee && !available
      ? '<option value="' + escapeHtml(selectedEmployee) + '" data-project="' + escapeHtml(selectedProject) + '" data-role="' + escapeHtml(selectedRole) + '" selected>' + escapeHtml(selectedEmployee + " · " + (selectedProject || "проект не задан") + " · " + (selectedRole || "роль не задана") + " · нет в активном плане") + '</option>'
      : "";
    return '<option value="">Выберите сотрудника</option>' + unavailable + assignments.map(function(record) {
      const selected = record.employee === selectedEmployee && record.project === selectedProject && record.role === selectedRole;
      const vendor = staffVendorForTeamRecord(record);
      return '<option value="' + escapeHtml(record.employee) + '" data-vendor="' + escapeHtml(vendor) + '" data-project="' + escapeHtml(record.project) + '" data-role="' + escapeHtml(record.role) + '" data-team-id="' + escapeHtml(record.id) + '"' + (selected ? " selected" : "") + '>' + escapeHtml(record.employee + " · " + vendor + " · " + record.project + " · " + record.role) + '</option>';
    }).join("");
  }

  function staffCostRange(values, key) {
    const amounts = values.map(function(value) { return num(value[key]); });
    if (!amounts.length) return "—";
    const minimum = Math.min.apply(Math, amounts);
    const maximum = Math.max.apply(Math, amounts);
    return minimum === maximum ? money(minimum) : "От " + money(minimum) + " до " + money(maximum);
  }

  function staffCostFormMarkup(teamRecord, year) {
    if (!teamRecord) {
      return '<section class="cost-form-section"><div><strong>Стоимость, ₽</strong><span>Ставка + привлечение</span></div><p class="form-note">Выберите сотрудника, чтобы показать значения из НСИ «Сотрудник / ресурс» (07).</p></section>';
    }
    const months = state.staffMonth === "all" ? Array.from({ length: 12 }, function(_, index) { return index + 1; }) : [Number(state.staffMonth)];
    const values = months.map(function(month) { return teamCostValues(teamRecord, year, month); });
    const period = state.staffMonth === "all" ? "за выбранный год" : teamMonthLabels[months[0] - 1] + " " + year + " года";
    return '<section class="cost-form-section"><div><strong>Стоимость, ₽</strong><span>Ставка + привлечение · ' + escapeHtml(period) + '</span></div><div class="cost-form-fields"><label>Ставка, ₽/ч<input class="calculated-field" type="text" value="' + escapeHtml(staffCostRange(values, "rate")) + '" readonly></label><label>Привлечение, ₽/ч<input class="calculated-field" type="text" value="' + escapeHtml(staffCostRange(values, "attraction")) + '" readonly></label><label>Стоимость, ₽/ч<input class="calculated-field" type="text" value="' + escapeHtml(staffCostRange(values, "cost")) + '" readonly></label></div><p class="form-note">Значения подставлены из НСИ «Сотрудник / ресурс» (07) и недоступны для изменения на этой форме.</p></section>';
  }

  function showStaffModal(record) {
    const editing = Boolean(record);
    const year = teamYear();
    const item = record || { employee: "", project: "", role: "", hoursActual: {} };
    const modal = document.createElement("div");
    modal.id = "staff-modal";
    modal.className = "modal-backdrop";
    const hourInputs = teamMonthLabels.map(function(label, index) {
      const month = index + 1;
      return '<label>' + label + '<input name="hours-' + month + '" type="number" min="0" step="0.5" value="' + escapeHtml(staffActualHours(item, year, month)) + '"></label>';
    }).join("");
    modal.innerHTML = '<section class="modal team-modal" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title"><div class="modal-header"><div><p class="eyebrow">Суммы и часы штат</p><h2 id="staff-modal-title">' + (editing ? "Редактировать запись" : "Новая запись") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="staff-form"><div class="form-grid"><label>Сотрудник <b>*</b><select name="employee" autofocus>' + staffEmployeeOptions(item.employee, item.project, item.role) + '</select><small data-error="employee"></small></label><label>Поставщик <b>*</b><input name="vendor" class="calculated-field" value="" readonly aria-readonly="true"><small data-error="vendor"></small></label><label>Проект <b>*</b><input name="project" class="calculated-field" value="' + escapeHtml(item.project) + '" readonly aria-readonly="true"><small data-error="project"></small></label><label>Роль <b>*</b><input name="role" class="calculated-field" value="' + escapeHtml(item.role) + '" readonly aria-readonly="true"><small data-error="role"></small></label></div><div id="staff-cost-context"></div><section class="hours-form-section"><div><strong>Часы (факт)</strong><span>' + escapeHtml(year) + ' год</span></div><div class="team-hours-grid">' + hourInputs + '</div><small data-error="hoursActual"></small></section><p class="form-note">Сотрудник, поставщик, проект и роль выбираются из активных записей «Штат» вкладки 06. План часов берётся с этой вкладки и на форме не изменяется.</p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    const staffForm = modal.querySelector("form");
    const staffEmployee = staffForm.elements.employee;
    const staffVendor = staffForm.elements.vendor;
    const staffProject = staffForm.elements.project;
    const staffRole = staffForm.elements.role;
    const staffCostContext = modal.querySelector("#staff-cost-context");
    function syncStaffAssignment() {
      const selected = staffEmployee.options[staffEmployee.selectedIndex];
      staffVendor.value = selected && selected.dataset.vendor || "";
      staffProject.value = selected && selected.dataset.project || "";
      staffRole.value = selected && selected.dataset.role || "";
      const teamRecord = selected && selected.dataset.teamId ? state.teamRecords.find(function(record) { return record.id === selected.dataset.teamId; }) : null;
      staffCostContext.innerHTML = staffCostFormMarkup(teamRecord, year);
    }
    staffEmployee.addEventListener("change", syncStaffAssignment);
    syncStaffAssignment();
    modal.querySelector(".close-button").addEventListener("click", closeStaffModal);
    modal.querySelector("[data-close]").addEventListener("click", closeStaffModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeStaffModal(); });
    modal.querySelector("form").addEventListener("submit", async function(event) {
      event.preventDefault();
      ["employee", "project", "role", "hoursActual"].forEach(function(name) { formError(name, ""); });
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      const hoursActual = JSON.parse(JSON.stringify(item.hoursActual || {}));
      hoursActual[year] = {};
      for (let month = 1; month <= 12; month += 1) {
        hoursActual[year][String(month)] = Number(body["hours-" + month]);
        delete body["hours-" + month];
      }
      body.hoursActual = hoursActual;
      try {
        const response = await fetch(editing ? "/api/staff/" + encodeURIComponent(record.id) : "/api/staff", {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) {
          Object.keys(payload.fields || {}).forEach(function(name) { formError(name, payload.fields[name]); });
          if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить штатную запись.");
          return;
        }
        await refreshReferenceData();
        closeStaffModal();
        render();
      } catch (error) {
        formError("employee", error.message || "Не удалось сохранить штатную запись.");
      }
    });
  }

  async function deleteStaffRecord(record) {
    if (!window.confirm("Удалить запись «" + record.employee + "»? Исходная запись будет перемещена в архив.")) return;
    try {
      const response = await fetch("/api/staff/" + encodeURIComponent(record.id), { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить штатную запись.");
      await refreshReferenceData();
      render();
      if (payload.action === "archived") window.alert("Исходная запись перемещена в архив и больше не отображается в активном реестре.");
    } catch (error) {
      window.alert(error.message || "Не удалось удалить штатную запись.");
    }
  }

  async function restoreStaffRecord(record) {
    try {
      const response = await fetch("/api/staff/" + encodeURIComponent(record.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: false }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось восстановить штатную запись.");
      await refreshReferenceData();
      render();
    } catch (error) {
      window.alert(error.message || "Не удалось восстановить штатную запись.");
    }
  }

  const teamMonthLabels = ["Ян", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

  function teamYear() {
    return String(selectedYear(state.overview.latestYear));
  }

  function teamHours(record, year, month) {
    return num(record.hoursPlan && record.hoursPlan[String(year)] && record.hoursPlan[String(year)][String(month)]);
  }

  function annualValue(record, field, year) {
    return num(record && record[field] && record[field][String(year)]);
  }

  function teamPlanYears() {
    return (state.snapshot.finance.years || []).map(String);
  }

  function teamYearTotal(record, year) {
    const annual = annualValue(record, "hoursPlanAnnual", year);
    return annual > 0 ? annual : sum(Array.from({ length: 12 }, function(_, index) { return { value: teamHours(record, year, index + 1) }; }), "value");
  }

  function teamHoursTotal(record, years) {
    return sum(years.map(function(year) { return { value: teamYearTotal(record, year) }; }), "value");
  }

  function teamHasPlan(record, years) {
    return years.some(function(year) { return teamYearTotal(record, year) > 0; });
  }

  function subcontractGroupId(record) {
    return String(record.id).replace(/-\d{4}-\d{2}$/, "");
  }

  function sameText(left, right) {
    return normalizedText(left) === normalizedText(right);
  }

  function teamCostValues(record, year, month) {
    const periodCost = record && year && month && record.costPlan && record.costPlan[String(year)] && record.costPlan[String(year)][String(month)];
    const rate = num(periodCost ? periodCost.rate : record && record.rate);
    const attraction = num(periodCost ? periodCost.attraction : record && record.attraction);
    return { rate: rate, attraction: attraction, cost: rate + attraction };
  }

  function teamCostSummary(records, year, month) {
    return (records || []).reduce(function(summary, record) {
      const values = teamCostValues(record, year, month);
      summary.rate += values.rate;
      summary.attraction += values.attraction;
      summary.cost += values.cost;
      return summary;
    }, { rate: 0, attraction: 0, cost: 0 });
  }

  function teamCostMarkup(records, year, month) {
    const values = teamCostSummary(records, year, month);
    return '<strong>' + money(values.cost) + '</strong><small>Ставка ' + money(values.rate) + ' · Привлечение ' + money(values.attraction) + '</small>';
  }

  function teamCostContextMarkup(record) {
    const year = state.year === "all" ? teamYear() : String(state.year);
    if (state.teamCostMonth !== "all") return teamCostMarkup([record], year, Number(state.teamCostMonth));
    const values = Array.from({ length: 12 }, function(_, index) { return teamCostValues(record, year, index + 1); });
    const unique = Array.from(new Set(values.map(function(value) { return value.rate + "|" + value.attraction; })));
    if (unique.length === 1) return teamCostMarkup([record], year, 1);
    const costs = values.map(function(value) { return value.cost; });
    return '<strong>Переменная</strong><small>От ' + money(Math.min.apply(Math, costs)) + ' до ' + money(Math.max.apply(Math, costs)) + '</small>';
  }

  function teamCostFormMarkup(prefix, records, source) {
    const values = teamCostSummary(records);
    const sourceNote = records.length
      ? (records.length === 1 ? "Значения найдены в одной записи вкладки 06" : "Сумма значений из " + integer(records.length) + " записей вкладки 06")
      : "Подходящая активная запись на вкладке 06 не найдена";
    return '<section class="cost-form-section" data-cost-section="' + prefix + '"><div><strong>Стоимость, ₽</strong><span>Ставка + привлечение</span></div><div class="cost-form-fields"><label>Ставка, ₽<input id="' + prefix + '-cost-rate" class="calculated-field" type="number" value="' + escapeHtml(values.rate) + '" readonly></label><label>Привлечение, ₽<input id="' + prefix + '-cost-attraction" class="calculated-field" type="number" value="' + escapeHtml(values.attraction) + '" readonly></label><label>Стоимость, ₽<input id="' + prefix + '-cost-total" class="calculated-field" type="number" value="' + escapeHtml(values.cost) + '" readonly></label></div><p class="form-note" data-cost-source="' + prefix + '">' + escapeHtml(sourceNote) + (source ? ". Источник: «" + escapeHtml(source) + "»." : ".") + '</p></section>';
  }

  function updateTeamCostForm(root, prefix, records, source) {
    const values = teamCostSummary(records);
    const fieldValues = {
      rate: values.rate,
      attraction: values.attraction,
      total: values.cost
    };
    Object.keys(fieldValues).forEach(function(key) {
      const input = root.querySelector("#" + prefix + "-cost-" + key);
      if (input) input.value = fieldValues[key];
    });
    const note = root.querySelector('[data-cost-source="' + prefix + '"]');
    if (note) {
      const sourceNote = records.length
        ? (records.length === 1 ? "Значения найдены в одной записи вкладки 06" : "Сумма значений из " + integer(records.length) + " записей вкладки 06")
        : "Подходящая активная запись на вкладке 06 не найдена";
      note.textContent = sourceNote + (source ? ". Источник: «" + source + "»." : ".");
    }
  }

  function subcontractTeamRecords(row) {
    const records = [];
    const seen = new Set();
    [row.resource, row.article, row.vendor].filter(Boolean).forEach(function(value) {
      const key = planIndexKey([row.project, value]);
      (state.contractorTeamIndex[key] || []).forEach(function(record) {
        if (seen.has(record.id)) return;
        seen.add(record.id);
        records.push(record);
      });
    });
    return records;
  }

  function staffTeamRecord(record) {
    return state.staffTeamIndex[planIndexKey([record.project, record.employee, record.role])] || null;
  }

  function subcontractRecordMatchesResource(record, resource) {
    const resourceName = normalizedText(resource.employee);
    return Boolean(resourceName) && record.project === resource.project && (
      normalizedText(record.resource) === resourceName || normalizedText(record.article) === resourceName || normalizedText(record.vendor) === resourceName
    );
  }

  function subcontractPlanRows(years) {
    return state.teamRecords.filter(function(resource) {
      return !resource.archived && isContractorResource(resource) &&
        (state.project === "all" || resource.project === state.project) &&
        (state.subcontractVendor === "all" || subcontractResourceSupplier(resource) === state.subcontractVendor) &&
        (state.subcontractResource === "all" || resource.id === state.subcontractResource);
    }).map(function(resource) {
      const sourceRecords = filterProject(state.subcontracts).filter(function(record) {
        return !record.archived && (state.year === "all" || record.period.startsWith(state.year + "-"));
      }).filter(function(record) {
        return subcontractRecordMatchesResource(record, resource);
      });
      const articles = Array.from(new Set(sourceRecords.map(function(record) { return record.article; }).filter(Boolean)));
      const row = {
        id: "team-" + resource.id,
        article: articles.length === 1 ? articles[0] : "—",
        resource: resource.employee,
        resourceVendor: subcontractResourceSupplier(resource),
        project: resource.project,
        role: resource.role,
        rates: [],
        actualHours: {},
        annualActualHours: {},
        amountPlan: {},
        recordsByPeriod: {},
        teamRecords: [resource]
      };
      sourceRecords.forEach(function(record) {
        const parts = String(record.period).split("-");
        const year = parts[0];
        const month = parts[1];
        if (!row.actualHours[year]) row.actualHours[year] = {};
        if (!row.amountPlan[year]) row.amountPlan[year] = {};
        row.actualHours[year][month] = num(row.actualHours[year][month]) + num(record.actualHours);
        row.annualActualHours[year] = num(row.annualActualHours[year]) + annualValue(record, "annualActualHours", year);
        row.amountPlan[year][month] = num(row.amountPlan[year][month]) + num(record.amount);
        if (!row.recordsByPeriod[record.period]) row.recordsByPeriod[record.period] = record;
        if (num(record.rate) > 0) row.rates.push(num(record.rate));
      });
      return row;
    });
  }

  function subcontractPlanHours(row, year, month) {
    return sum((row.teamRecords || subcontractTeamRecords(row)).map(function(record) {
      return { value: teamHours(record, year, month) };
    }), "value");
  }

  function subcontractPlanYearTotal(row, year) {
    return sum((row.teamRecords || subcontractTeamRecords(row)).map(function(record) { return { value: teamYearTotal(record, year) }; }), "value");
  }

  function subcontractActualHours(row, year, month) {
    return num(row.actualHours && row.actualHours[String(year)] && row.actualHours[String(year)][String(month)]);
  }

  function subcontractActualYearTotal(row, year) {
    const annual = num(row.annualActualHours && row.annualActualHours[String(year)]);
    return annual > 0 ? annual : sum(Array.from({ length: 12 }, function(_, index) { return { value: subcontractActualHours(row, year, index + 1) }; }), "value");
  }

  function subcontractContextMonths() {
    return state.subcontractViewMonth === "all" ? Array.from({ length: 12 }, function(_, index) { return index + 1; }) : [Number(state.subcontractViewMonth)];
  }

  function subcontractSelectedPeriod() {
    return state.year !== "all" && state.subcontractViewMonth !== "all"
      ? String(state.year) + "-" + String(state.subcontractViewMonth).padStart(2, "0")
      : "";
  }

  function subcontractHasHours(row, years, months) {
    return subcontractHoursTotal(row, years, months, subcontractPlanHours) > 0 ||
      subcontractHoursTotal(row, years, months, subcontractActualHours) > 0 ||
      subcontractAmount(row, years, months) > 0;
  }

  function subcontractAmount(row, years, selectedMonths) {
    const months = selectedMonths && selectedMonths.length ? selectedMonths : Array.from({ length: 12 }, function(_, index) { return index + 1; });
    return sum(years.flatMap(function(year) {
      return months.map(function(month) {
        return { value: num(row.amountPlan && row.amountPlan[String(year)] && row.amountPlan[String(year)][String(month)]) };
      });
    }), "value");
  }

  function subcontractHoursTotal(row, years, selectedMonths, getter) {
    const months = selectedMonths && selectedMonths.length ? selectedMonths : Array.from({ length: 12 }, function(_, index) { return index + 1; });
    if (months.length === 12 && getter === subcontractPlanHours) return sum(years.map(function(year) { return { value: subcontractPlanYearTotal(row, year) }; }), "value");
    if (months.length === 12 && getter === subcontractActualHours) return sum(years.map(function(year) { return { value: subcontractActualYearTotal(row, year) }; }), "value");
    return sum(years.flatMap(function(year) {
      return months.map(function(month) { return { value: getter(row, year, month) }; });
    }), "value");
  }

  function subcontractRate(row) {
    const uniqueRates = Array.from(new Set(row.rates.map(String)));
    if (!uniqueRates.length) return "—";
    if (uniqueRates.length === 1) return money(uniqueRates[0]) + "/ч";
    return "Разные";
  }

  function selectedSubcontractRecord(row) {
    const period = subcontractSelectedPeriod();
    return period && row.recordsByPeriod[period] || null;
  }

  function subcontractPlanAssignments() {
    const seen = new Set();
    return state.teamRecords.filter(function(record) {
      return !record.archived && isContractorResource(record) && record.employee && record.project;
    }).filter(function(record) {
      const key = normalizedText(record.employee) + "|" + normalizedText(record.project);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function(left, right) {
      return (left.employee + "|" + subcontractResourceSupplier(left) + "|" + left.project + "|" + left.role).localeCompare(right.employee + "|" + subcontractResourceSupplier(right) + "|" + right.project + "|" + right.role, "ru-RU");
    });
  }

  function subcontractIdentityCells(row) {
    const record = selectedSubcontractRecord(row);
    const editable = record && !record.archived;
    const resource = inlineCell('<strong>' + escapeHtml(row.resource) + '</strong>', editable ? { scope: "subcontract", id: record.id, field: "resource" } : null);
    const project = inlineCell(escapeHtml(row.project), editable ? { scope: "subcontract", id: record.id, field: "project" } : null);
    return resource + '<td>' + escapeHtml(row.resourceVendor) + '</td>' + project + '<td>' + escapeHtml(row.role || "—") + '</td>';
  }

  function subcontractCostCell(row) {
    return '<td class="source-cost">' + teamCostMarkup(row.teamRecords || subcontractTeamRecords(row)) + '</td>';
  }

  function annualResourceCosts(records, years, hoursForRecord, selectedMonths) {
    const months = selectedMonths && selectedMonths.length ? selectedMonths : Array.from({ length: 12 }, function(_, index) { return index + 1; });
    return (records || []).reduce(function(total, record) {
      years.forEach(function(year) {
        months.forEach(function(month) {
          const values = teamCostValues(record, year, month);
          const hours = num(hoursForRecord(record, year, month));
          total.cost += values.rate * hours;
          total.attraction += values.attraction * hours;
        });
      });
      return total;
    }, { cost: 0, attraction: 0 });
  }

  function annualCostCells(values) {
    return '<td class="money-cell">' + money(values.cost) + '</td><td class="money-cell">' + money(values.attraction) + '</td>';
  }

  function subcontractAnnualCosts(row, years, months) {
    return annualResourceCosts(row.teamRecords || subcontractTeamRecords(row), years, function(record, year, month) { return teamHours(record, year, month); }, months);
  }

  function subcontractActionCell(row) {
    const record = selectedSubcontractRecord(row);
    return record
      ? '<button class="edit-button" data-subcontract-id="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-subcontract-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button>' + historyButton("subcontract", record.id)
      : '<span class="table-action-note">Выберите год и месяц</span>';
  }

  function subcontractHoursPairCells(row, year, month, total) {
    const record = row.recordsByPeriod[String(year) + "-" + String(month).padStart(2, "0")];
    const plan = '<td class="hours-cell plan-hours' + (total ? " total-hours" : "") + '">' + integer(subcontractPlanHours(row, year, month)) + '</td>';
    const actual = inlineCell(integer(subcontractActualHours(row, year, month)), total || !record || record.archived ? null : { scope: "subcontract", id: record.id, field: "actualHours" }, "hours-cell actual-hours" + (total ? " total-hours" : ""));
    return plan + actual;
  }

  function hoursPairCells(plan, actual, total) {
    return '<td class="hours-cell plan-hours' + (total ? " total-hours" : "") + '">' + integer(plan) + '</td><td class="hours-cell actual-hours' + (total ? " total-hours" : "") + '">' + integer(actual) + '</td>';
  }

  function subcontractTable(rows, year, months) {
    const monthGroups = months.map(function(month) { return '<th colspan="2">' + teamMonthLabels[month - 1] + '</th>'; }).join("");
    const hourHeaders = months.map(function() { return '<th>План</th><th>Факт</th>'; }).join("");
    const costPeriod = months.length === 12 ? "в год" : "за период";
    const body = rows.length ? rows.map(function(row) {
      const values = months.map(function(month) {
        return subcontractHoursPairCells(row, year, month, false);
      }).join("");
      return '<tr class="' + inactiveResourceRowClass(row.resource) + '">' + subcontractIdentityCells(row) + subcontractCostCell(row) + annualCostCells(subcontractAnnualCosts(row, [year], months)) + values + hoursPairCells(subcontractHoursTotal(row, [year], months, subcontractPlanHours), subcontractHoursTotal(row, [year], months, subcontractActualHours), true) + '<td class="subcontract-actions">' + subcontractActionCell(row) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (10 + months.length * 2) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="subcontract-hours-table"><thead><tr><th rowspan="2">Сотрудник</th><th rowspan="2">Поставщик</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th><th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость ' + costPeriod + ', ₽</th><th rowspan="2">Привлечение ' + costPeriod + ', ₽</th>' + monthGroups + '<th colspan="2">Итого</th><th rowspan="2"></th></tr><tr>' + hourHeaders + '<th>План</th><th>Факт</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function subcontractAllYearsTable(rows, years, months) {
    const monthFiltered = months.length < 12;
    const costPeriod = monthFiltered ? "за период" : "в год";
    const yearBlocks = years.map(function(year) {
      const expanded = Boolean(state.expandedSubcontractYears[year]);
      if (monthFiltered) return '<th class="team-year-group" colspan="2">' + escapeHtml(year) + '</th>';
      return '<th class="team-year-group" colspan="' + (expanded ? 26 : 2) + '"><button class="year-expand-button" data-subcontract-year-expand="' + escapeHtml(year) + '" type="button" aria-expanded="' + expanded + '">' + escapeHtml(year) + '<span>' + (expanded ? "Свернуть" : "По месяцам") + '</span></button></th>';
    }).join("");
    const monthHeaders = years.map(function(year) {
      if (monthFiltered) return '<th>' + teamMonthLabels[months[0] - 1] + ' · план</th><th>' + teamMonthLabels[months[0] - 1] + ' · факт</th>';
      if (!state.expandedSubcontractYears[year]) return '<th>План</th><th>Факт</th>';
      return teamMonthLabels.map(function(label) { return '<th>' + label + ' · план</th><th>' + label + ' · факт</th>'; }).join("") + '<th>Итого · план</th><th>Итого · факт</th>';
    }).join("");
    const body = rows.length ? rows.map(function(row) {
      const values = years.map(function(year) {
        if (monthFiltered) return subcontractHoursPairCells(row, year, months[0], false);
        if (!state.expandedSubcontractYears[year]) return hoursPairCells(subcontractHoursTotal(row, [year], months, subcontractPlanHours), subcontractHoursTotal(row, [year], months, subcontractActualHours), true);
        const monthValues = Array.from({ length: 12 }, function(_, index) {
          const month = index + 1;
          return subcontractHoursPairCells(row, year, month, false);
        }).join("");
        return monthValues + hoursPairCells(subcontractHoursTotal(row, [year], null, subcontractPlanHours), subcontractHoursTotal(row, [year], null, subcontractActualHours), true);
      }).join("");
      return '<tr class="' + inactiveResourceRowClass(row.resource) + '">' + subcontractIdentityCells(row) + subcontractCostCell(row) + annualCostCells(subcontractAnnualCosts(row, years, months)) + values + '<td class="subcontract-actions">' + subcontractActionCell(row) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (8 + years.reduce(function(total, year) { return total + (monthFiltered ? 2 : (state.expandedSubcontractYears[year] ? 26 : 2)); }, 0)) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="subcontract-all-years-table"><thead><tr><th rowspan="2">Сотрудник</th><th rowspan="2">Поставщик</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th><th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость ' + costPeriod + ', ₽</th><th rowspan="2">Привлечение ' + costPeriod + ', ₽</th>' + yearBlocks + '<th rowspan="2"></th></tr><tr>' + monthHeaders + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function staffContextMonths() {
    return state.staffMonth === "all" ? Array.from({ length: 12 }, function(_, index) { return index + 1; }) : [Number(state.staffMonth)];
  }

  function staffRecordsForContext(years, months, includeArchived) {
    return filterProject(state.staffRecords).filter(function(record) {
      return (includeArchived || !record.archived) && (state.staffEmployee === "all" || record.employee === state.staffEmployee);
    }).map(function(record) {
      return Object.assign({}, record, { teamRecord: staffTeamRecord(record) });
    }).filter(function(record) {
      return record.teamRecord && isStaffResource(record) && (state.staffVendor === "all" || staffVendorForTeamRecord(record.teamRecord) === state.staffVendor) && staffHasHours(record, years, months);
    });
  }

  function staffIdentityCells(record, editable) {
    const teamRecord = record.teamRecord || staffTeamRecord(record);
    return inlineCell('<strong>' + escapeHtml(record.employee) + '</strong>', editable ? { scope: "staff", id: record.id, field: "employee" } : null) + '<td>' + escapeHtml(staffVendorForTeamRecord(teamRecord)) + '</td><td>' + escapeHtml(record.project) + '</td><td>' + escapeHtml(record.role) + '</td>';
  }

  function staffPlanHours(record, year, month) {
    const teamRecord = record.teamRecord || staffTeamRecord(record);
    return teamRecord ? teamHours(teamRecord, year, month) : 0;
  }

  function staffActualHours(record, year, month) {
    return num(record.hoursActual && record.hoursActual[String(year)] && record.hoursActual[String(year)][String(month)]);
  }

  function staffYearTotal(record, year, getter) {
    if (getter === staffPlanHours) {
      const teamRecord = record.teamRecord || staffTeamRecord(record);
      return teamRecord ? teamYearTotal(teamRecord, year) : 0;
    }
    const annual = annualValue(record, "hoursActualAnnual", year);
    return annual > 0 ? annual : sum(Array.from({ length: 12 }, function(_, index) { return { value: staffActualHours(record, year, index + 1) }; }), "value");
  }

  function staffHoursTotal(record, years, getter, selectedMonths) {
    const months = selectedMonths && selectedMonths.length ? selectedMonths : Array.from({ length: 12 }, function(_, index) { return index + 1; });
    if (months.length === 12) return sum(years.map(function(year) { return { value: staffYearTotal(record, year, getter) }; }), "value");
    return sum(years.flatMap(function(year) {
      return months.map(function(month) { return { value: getter(record, year, month) }; });
    }), "value");
  }

  function staffHasHours(record, years, months) {
    return staffHoursTotal(record, years, staffPlanHours, months) > 0 || staffHoursTotal(record, years, staffActualHours, months) > 0;
  }

  function staffActionCell(record, archived) {
    return archived
      ? '<button class="secondary-button compact-button" data-staff-restore="' + escapeHtml(record.id) + '" type="button">Восстановить</button>' + historyButton("staff", record.id)
      : '<button class="edit-button" data-staff-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-staff-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button>' + historyButton("staff", record.id);
  }

  function staffHoursPairCells(record, year, month, total, archived) {
    const plan = '<td class="hours-cell plan-hours' + (total ? " total-hours" : "") + '">' + integer(staffPlanHours(record, year, month)) + '</td>';
    const actual = inlineCell(integer(staffActualHours(record, year, month)), total || archived ? null : { scope: "staff", id: record.id, field: "hoursActual", year: year, month: month }, "hours-cell actual-hours" + (total ? " total-hours" : ""));
    return plan + actual;
  }

  function staffCostCell(record) {
    const teamRecord = record.teamRecord || staffTeamRecord(record);
    return '<td class="source-cost">' + teamCostMarkup(teamRecord ? [teamRecord] : []) + '</td>';
  }

  function staffAnnualCosts(record, years, months) {
    const teamRecord = record.teamRecord || staffTeamRecord(record);
    return annualResourceCosts(teamRecord ? [teamRecord] : [], years, function(item, year, month) { return teamHours(item, year, month); }, months);
  }

  function staffTable(records, year, months, archived) {
    const monthGroups = months.map(function(month) { return '<th colspan="2">' + teamMonthLabels[month - 1] + '</th>'; }).join("");
    const hourHeaders = months.map(function() { return '<th>План</th><th>Факт</th>'; }).join("");
    const costPeriod = months.length === 12 ? "в год" : "за период";
    const body = records.length ? records.map(function(record) {
      const values = months.map(function(month) {
        return staffHoursPairCells(record, year, month, false, archived);
      }).join("");
      return '<tr class="' + inactiveResourceRowClass(record.employee) + '">' + staffIdentityCells(record, !archived) + values + hoursPairCells(staffHoursTotal(record, [year], staffPlanHours, months), staffHoursTotal(record, [year], staffActualHours, months), true) + staffCostCell(record) + annualCostCells(staffAnnualCosts(record, [year], months)) + '<td class="staff-actions">' + staffActionCell(record, archived) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (10 + months.length * 2) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="staff-hours-table"><thead><tr><th rowspan="2">Сотрудник</th><th rowspan="2">Поставщик</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th>' + monthGroups + '<th colspan="2">Итого</th><th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость ' + costPeriod + ', ₽</th><th rowspan="2">Привлечение ' + costPeriod + ', ₽</th><th rowspan="2"></th></tr><tr>' + hourHeaders + '<th>План</th><th>Факт</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function staffAllYearsTable(records, years, months, archived) {
    const monthFiltered = months.length < 12;
    const costPeriod = monthFiltered ? "за период" : "в год";
    const yearBlocks = years.map(function(year) {
      const expanded = Boolean(state.expandedStaffYears[year]);
      if (monthFiltered) return '<th class="team-year-group" colspan="2">' + escapeHtml(year) + '</th>';
      return '<th class="team-year-group" colspan="' + (expanded ? 26 : 2) + '"><button class="year-expand-button" data-staff-year-expand="' + escapeHtml(year) + '" type="button" aria-expanded="' + expanded + '">' + escapeHtml(year) + '<span>' + (expanded ? "Свернуть" : "По месяцам") + '</span></button></th>';
    }).join("");
    const monthHeaders = years.map(function(year) {
      if (monthFiltered) return '<th>' + teamMonthLabels[months[0] - 1] + ' · план</th><th>' + teamMonthLabels[months[0] - 1] + ' · факт</th>';
      if (!state.expandedStaffYears[year]) return '<th>План</th><th>Факт</th>';
      return teamMonthLabels.map(function(label) { return '<th>' + label + ' · план</th><th>' + label + ' · факт</th>'; }).join("") + '<th>Итого · план</th><th>Итого · факт</th>';
    }).join("");
    const body = records.length ? records.map(function(record) {
      const values = years.map(function(year) {
        if (monthFiltered || !state.expandedStaffYears[year]) return hoursPairCells(staffHoursTotal(record, [year], staffPlanHours, months), staffHoursTotal(record, [year], staffActualHours, months), true);
        const monthValues = Array.from({ length: 12 }, function(_, index) {
          const month = index + 1;
          return staffHoursPairCells(record, year, month, false, archived);
        }).join("");
        return monthValues + hoursPairCells(staffHoursTotal(record, [year], staffPlanHours), staffHoursTotal(record, [year], staffActualHours), true);
      }).join("");
      return '<tr class="' + inactiveResourceRowClass(record.employee) + '">' + staffIdentityCells(record, !archived) + values + staffCostCell(record) + annualCostCells(staffAnnualCosts(record, years, months)) + '<td class="staff-actions">' + staffActionCell(record, archived) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (8 + years.reduce(function(total, year) { return total + (monthFiltered ? 2 : (state.expandedStaffYears[year] ? 26 : 2)); }, 0)) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="staff-all-years-table"><thead><tr><th rowspan="2">Сотрудник</th><th rowspan="2">Поставщик</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th>' + yearBlocks + '<th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость ' + costPeriod + ', ₽</th><th rowspan="2">Привлечение ' + costPeriod + ', ₽</th><th rowspan="2"></th></tr><tr>' + monthHeaders + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function teamRecordsForContext(includeArchived) {
    return state.teamRecords.filter(function(record) {
      const matchesContext = (includeArchived || !record.archived) &&
        (state.project === "all" || record.project === state.project) &&
        (state.teamRole === "all" || record.role === state.teamRole) &&
        (state.teamEmployee === "all" || record.employee === state.teamEmployee);
      if (!matchesContext || state.teamEmployee !== "all") return matchesContext;
      return state.year === "all" ? teamHasPlan(record, teamPlanYears()) : teamHasPlan(record, [String(state.year)]);
    });
  }

  function teamActionCells(record, archived) {
    return archived
      ? '<button class="secondary-button compact-button" data-team-restore="' + escapeHtml(record.id) + '" type="button">Восстановить</button>' + historyButton("team", record.id)
      : '<button class="edit-button" data-team-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-team-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button>' + historyButton("team", record.id);
  }

  function teamIdentityCells(record, editable) {
    const config = function(field) { return editable ? { scope: "team", id: record.id, field: field } : null; };
    return inlineCell('<strong>' + escapeHtml(record.employee) + '</strong>', config("employee")) + inlineCell(escapeHtml(record.vendor || "—"), config("vendor")) + inlineCell(escapeHtml(record.project), config("project")) + inlineCell(escapeHtml(record.role), config("role"));
  }

  function teamHoursCell(record, year, month, archived) {
    return inlineCell(integer(teamHours(record, year, month)), archived ? null : { scope: "team", id: record.id, field: "hoursPlan", year: year, month: month }, "hours-cell");
  }

  function teamGroups(records) {
    const groups = new Map();
    records.forEach(function(record) {
      const key = normalizedText(record.employee) || record.id;
      if (!groups.has(key)) groups.set(key, { key: key, employee: record.employee, records: [] });
      groups.get(key).records.push(record);
    });
    return Array.from(groups.values()).sort(function(left, right) { return left.employee.localeCompare(right.employee, "ru-RU"); });
  }

  function teamGroupValues(group, year) {
    return Array.from({ length: 12 }, function(_, index) {
      return sum(group.records.map(function(record) { return { value: teamHours(record, year, index + 1) }; }), "value");
    });
  }

  function teamGroupYearTotal(group, year) {
    return sum(group.records.map(function(record) { return { value: teamYearTotal(record, year) }; }), "value");
  }

  function employeePlanYearTotal(employee, year) {
    return sum(state.teamRecords.filter(function(record) {
      return !record.archived && normalizedText(record.employee) === normalizedText(employee);
    }).map(function(record) { return { value: teamYearTotal(record, year) }; }), "value");
  }

  function overloadedPlanClass(employee, year) {
    return employeePlanYearTotal(employee, year) > 168 * 12 ? " hours-overload" : "";
  }

  function totalHoursCell(value, className) {
    return '<td class="hours-cell total-hours' + (className || "") + '">' + integer(value) + '</td>';
  }

  function teamGroupEmployeeCell(group) {
    const expanded = Boolean(state.expandedTeamEmployees[group.key]);
    const count = group.records.length;
    return '<td><button class="team-employee-expand" data-team-employee-expand="' + escapeHtml(group.key) + '" type="button" aria-expanded="' + expanded + '"><strong>' + escapeHtml(group.employee) + '</strong><span>' + (expanded ? "Свернуть" : "Проекты: " + count) + '</span></button></td>';
  }

  function teamGroupIdentityCells(group) {
    const vendors = Array.from(new Set(group.records.map(function(record) { return record.vendor || "—"; }))).join(", ");
    const roles = Array.from(new Set(group.records.map(function(record) { return record.role || "—"; }))).join(", ");
    return teamGroupEmployeeCell(group) + '<td>' + escapeHtml(vendors) + '</td><td>Все проекты · ' + integer(group.records.length) + '</td><td>' + escapeHtml(roles) + '</td>';
  }

  function teamProjectIdentityCells(record, editable) {
    const config = function(field) { return editable ? { scope: "team", id: record.id, field: field } : null; };
    return '<td class="team-child-employee">↳</td>' + inlineCell(escapeHtml(record.vendor || "—"), config("vendor")) + inlineCell(escapeHtml(record.project), config("project")) + inlineCell(escapeHtml(record.role), config("role"));
  }

  function teamChildRow(record, year, archived, groupKey) {
    const plannedHours = Array.from({ length: 12 }, function(_, index) { return teamHours(record, year, index + 1); });
    return '<tr class="team-project-row' + inactiveResourceRowClass(record.employee) + '" data-team-group="' + escapeHtml(groupKey) + '">' + teamProjectIdentityCells(record, !archived) + plannedHours.map(function(_, index) { return teamHoursCell(record, year, index + 1, archived); }).join("") + totalHoursCell(teamYearTotal(record, year)) + '<td class="team-actions">' + teamActionCells(record, archived) + '</td></tr>';
  }

  function teamTable(headers, records, year, archived) {
    const groups = teamGroups(records);
    return table(headers, groups, function(group) {
      const values = teamGroupValues(group, year);
      const row = '<tr class="team-group-row' + inactiveResourceRowClass(group.employee) + '" data-team-group="' + escapeHtml(group.key) + '">' + teamGroupIdentityCells(group) + values.map(function(value) { return totalHoursCell(value); }).join("") + totalHoursCell(teamGroupYearTotal(group, year), overloadedPlanClass(group.employee, year)) + '<td class="team-actions"></td></tr>';
      const children = state.expandedTeamEmployees[group.key] ? group.records.map(function(record) { return teamChildRow(record, year, archived, group.key); }).join("") : "";
      return row + children;
    });
  }

  function teamAllYearsTable(records, years, archived) {
    const yearBlocks = years.map(function(year) {
      const expanded = Boolean(state.expandedTeamYears[year]);
      return '<th class="team-year-group" colspan="' + (expanded ? 13 : 1) + '"><button class="year-expand-button" data-team-year-expand="' + escapeHtml(year) + '" type="button" aria-expanded="' + expanded + '">' + escapeHtml(year) + '<span>' + (expanded ? "Свернуть" : "По месяцам") + '</span></button></th>';
    }).join("");
    const monthHeaders = years.map(function(year) {
      if (!state.expandedTeamYears[year]) return '<th>Часы (план)</th>';
      return teamMonthLabels.map(function(label) { return '<th>' + label + '</th>'; }).join("") + '<th>Итого</th>';
    }).join("");
    const groups = teamGroups(records);
    const body = groups.length ? groups.map(function(group) {
      const values = years.map(function(year) {
        const monthValues = teamGroupValues(group, year);
        const yearTotal = teamGroupYearTotal(group, year);
        if (!state.expandedTeamYears[year]) return totalHoursCell(yearTotal, overloadedPlanClass(group.employee, year));
        return monthValues.map(function(value) { return totalHoursCell(value); }).join("") + totalHoursCell(yearTotal, overloadedPlanClass(group.employee, year));
      }).join("");
      const groupRow = '<tr class="team-group-row' + inactiveResourceRowClass(group.employee) + '" data-team-group="' + escapeHtml(group.key) + '">' + teamGroupIdentityCells(group) + values + '<td class="team-actions"></td></tr>';
      const children = state.expandedTeamEmployees[group.key] ? group.records.map(function(record) {
        const childValues = years.map(function(year) {
          if (!state.expandedTeamYears[year]) return '<td class="hours-cell total-hours">' + integer(teamYearTotal(record, year)) + '</td>';
          const monthValues = Array.from({ length: 12 }, function(_, index) { return teamHours(record, year, index + 1); });
          return monthValues.map(function(_, index) { return teamHoursCell(record, year, index + 1, archived); }).join("") + totalHoursCell(teamYearTotal(record, year));
        }).join("");
        return '<tr class="team-project-row' + inactiveResourceRowClass(record.employee) + '" data-team-group="' + escapeHtml(group.key) + '">' + teamProjectIdentityCells(record, !archived) + childValues + '<td class="team-actions">' + teamActionCells(record, archived) + '</td></tr>';
      }).join("") : "";
      return groupRow + children;
    }).join("") : '<tr><td colspan="' + (5 + years.reduce(function(total, year) { return total + (state.expandedTeamYears[year] ? 13 : 1); }, 0)) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="team-all-years-table"><thead><tr><th rowspan="2">Сотрудник / ресурс</th><th rowspan="2">Поставщик</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th>' + yearBlocks + '<th rowspan="2"></th></tr><tr>' + monthHeaders + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function teamProjectSummaryTable(records, years) {
    const grouped = new Map();
    records.forEach(function(record) {
      const project = record.project || "Не указан";
      if (!grouped.has(project)) grouped.set(project, []);
      grouped.get(project).push(record);
    });
    const rows = Array.from(grouped.entries()).map(function(entry) {
      const values = years.map(function(year) {
        return sum(entry[1].map(function(record) { return { value: teamYearTotal(record, year) }; }), "value");
      });
      return { project: entry[0], values: values, total: sum(values.map(function(value) { return { value: value }; }), "value") };
    }).sort(function(left, right) { return left.project.localeCompare(right.project, "ru-RU"); });
    return table(["Проект"].concat(years).concat(["Итого"]), rows, function(row) {
      return '<tr><td><strong>' + escapeHtml(row.project) + '</strong></td>' + row.values.map(function(value) { return totalHoursCell(value); }).join("") + totalHoursCell(row.total) + '</tr>';
    });
  }

  function renderTeam() {
    const allYears = state.year === "all";
    const year = teamYear();
    const years = allYears ? teamPlanYears() : [year];
    const active = teamRecordsForContext(false);
    const archived = teamRecordsForContext(true).filter(function(record) { return record.archived; });
    const plannedHours = sum(active.map(function(record) { return { value: sum(years.map(function(item) { return { value: teamYearTotal(record, item) }; }), "value") }; }), "value");
    const employees = new Set(active.map(function(record) { return record.employee; })).size;
    const contractors = active.filter(function(record) { return record.source === "Подряд"; }).length;
    const roles = Array.from(new Set(active.map(function(record) { return record.role; }))).sort().map(function(role) {
      return { label: role, amount: active.filter(function(record) { return record.role === role; }).length };
    });
    const headers = ["Сотрудник / ресурс", "Поставщик", "Проект", "Роль"].concat(teamMonthLabels).concat(["Итого", ""]);
    const planTable = allYears ? teamAllYearsTable(active, years, false) : teamTable(headers, active, year, false);
    const archiveTable = allYears ? teamAllYearsTable(archived, years, true) : teamTable(headers, archived, year, true);
    const projectSummary = teamProjectSummaryTable(active, years);
    const periodLabel = allYears ? "за все доступные годы" : "по месяцам " + year + " года";
    return '<section class="metric-grid compact">' +
      card("План часов", integer(plannedHours) + " ч", periodLabel, "cyan") +
      card("Ресурсы", integer(employees), "уникальные сотрудники и подрядчики", "blue") +
      card("Подряд", integer(contractors), "активные записи с источником «Подряд»", "violet") +
      '</section>' +
      '<section class="grid two"><article class="panel">' + sectionTitle("Состав команды по ролям", "Активные записи в текущем проектном срезе.", "чел.") +
      (roles.length ? barChart(roles, "amount", "label", integer, "team-bars") : empty("Нет активных записей команды.")) +
      '</article><article class="panel insight-panel">' + sectionTitle("Плановая загрузка", "Помесячные значения взяты из листа «рес_план» исходной модели.", allYears ? "все годы" : year) +
      '<p>' + (allYears ? "Показаны годовые итоги; нажмите на название года в таблице, чтобы развернуть его по месяцам." : "Показаны только записи с планом часов в выбранном году. При выборе сотрудника выводятся все его записи.") + '</p><p class="muted">Тип поставщика определяет, относится ресурс к штату или подряду.</p></article></section>' +
      '<section class="panel team-plan-table">' + sectionTitle("Команда и план часов", allYears ? "Годовые итоги с возможностью раскрытия месяцев." : "Часы указаны в разрезе месяцев выбранного года.", allYears ? "все годы" : year) +
      '<div class="table-toolbar"><span class="table-edit-hint">Строки формируются по НСИ; двойной клик по доступному полю — редактирование. По умолчанию проекты свёрнуты в сотрудника.</span></div>' +
      planTable +
      (archived.length ? '<details class="archive-details"><summary>Архивные записи · ' + integer(archived.length) + '</summary>' + archiveTable + '</details>' : "") +
      '</section>' +
      '<section class="panel team-project-summary">' + sectionTitle("План часов по проектам", "Сумма плановых часов всех ресурсов в разрезе проектов и лет текущего контекста.", "ч") + projectSummary + '</section>';
  }

  function closeTeamModal() {
    const modal = document.getElementById("team-modal");
    if (modal) modal.remove();
  }

  function findTeamRecord(id) {
    return state.teamRecords.find(function(record) { return record.id === id; });
  }

  function showTeamModal(record) {
    const editing = Boolean(record);
    const year = teamYear();
    const item = record || { employee: "", vendor: "", project: state.project === "all" ? "" : state.project, role: "", hoursPlan: {}, costPlan: {}, rate: 0, attraction: 0 };
    const modal = document.createElement("div");
    modal.id = "team-modal";
    modal.className = "modal-backdrop";
    const hourInputs = teamMonthLabels.map(function(label, index) {
      const month = index + 1;
      return '<label>' + label + '<input name="hours-' + month + '" type="number" min="0" step="0.5" value="' + escapeHtml(teamHours(item, year, month)) + '"></label>';
    }).join("");
    modal.innerHTML = '<section class="modal team-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title"><div class="modal-header"><div><p class="eyebrow">Команда</p><h2 id="team-modal-title">' + (editing ? "Редактировать запись" : "Новая запись") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="team-form"><div class="form-grid"><label>Сотрудник / ресурс <b>*</b><select name="employee" autofocus>' + resourceOptions(item.vendor, item.employee) + '</select><small data-error="employee"></small></label><label>Поставщик <b>*</b><select name="vendor">' + referenceOptions("vendors", item.vendor, "Выберите поставщика") + '</select><small data-error="vendor"></small></label><label>Проект <b>*</b><select name="project">' + referenceOptions("projects", item.project, "Выберите проект") + '</select><small data-error="project"></small></label><label>Роль <b>*</b><select name="role">' + referenceOptions("roles", item.role, "Выберите роль") + '</select><small data-error="role"></small></label></div><section class="hours-form-section"><div><strong>Часы (план)</strong><span>' + escapeHtml(year) + ' год</span></div><div class="team-hours-grid">' + hourInputs + '</div><small data-error="hoursPlan"></small></section><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    modal.querySelector(".close-button").addEventListener("click", closeTeamModal);
    modal.querySelector("[data-close]").addEventListener("click", closeTeamModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeTeamModal(); });
    const teamForm = modal.querySelector("form");
    const updateTeamResources = function() {
      const employeeSelect = teamForm.elements.employee;
      employeeSelect.innerHTML = resourceOptions(teamForm.elements.vendor.value, employeeSelect.value);
    };
    teamForm.elements.vendor.addEventListener("change", updateTeamResources);
    teamForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      ["employee", "vendor", "project", "role", "hoursPlan"].forEach(function(name) { formError(name, ""); });
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form).entries());
      const hoursPlan = JSON.parse(JSON.stringify(item.hoursPlan || {}));
      hoursPlan[year] = {};
      for (let month = 1; month <= 12; month += 1) {
        hoursPlan[year][String(month)] = Number(body["hours-" + month]);
        delete body["hours-" + month];
      }
      body.hoursPlan = hoursPlan;
      try {
        const response = await fetch(editing ? "/api/team/" + encodeURIComponent(record.id) : "/api/team", {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) {
          Object.keys(payload.fields || {}).forEach(function(name) { formError(name, payload.fields[name]); });
          if (!payload.fields) throw new Error(payload.error || "Не удалось сохранить запись команды.");
          return;
        }
        await refreshReferenceData();
        closeTeamModal();
        render();
      } catch (error) {
        formError("employee", error.message || "Не удалось сохранить запись команды.");
      }
    });
  }

  async function deleteTeamRecord(record) {
    if (!window.confirm("Удалить запись «" + record.employee + "»? Исходная запись будет перемещена в архив.")) return;
    try {
      const response = await fetch("/api/team/" + encodeURIComponent(record.id), { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить запись команды.");
      await refreshReferenceData();
      render();
      if (payload.action === "archived") window.alert("Запись используется исходной моделью и перемещена в архив.");
    } catch (error) {
      window.alert(error.message || "Не удалось удалить запись команды.");
    }
  }

  async function restoreTeamRecord(record) {
    try {
      const response = await fetch("/api/team/" + encodeURIComponent(record.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({}, record, { archived: false }))
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось восстановить запись команды.");
      await refreshReferenceData();
      render();
    } catch (error) {
      window.alert(error.message || "Не удалось восстановить запись команды.");
    }
  }

  function bindTeamControls() {
    document.querySelectorAll("[data-team-employee-expand]").forEach(function(button) {
      button.addEventListener("click", function() {
        const key = button.dataset.teamEmployeeExpand;
        state.expandedTeamEmployees[key] = !state.expandedTeamEmployees[key];
        render();
      });
    });
    document.querySelectorAll("[data-team-year-expand]").forEach(function(button) {
      button.addEventListener("click", function() {
        const year = button.dataset.teamYearExpand;
        state.expandedTeamYears[year] = !state.expandedTeamYears[year];
        render();
      });
    });
    document.querySelectorAll("[data-team-edit]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = findTeamRecord(button.dataset.teamEdit);
        if (record) showTeamModal(record);
      });
    });
    document.querySelectorAll("[data-team-delete]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = findTeamRecord(button.dataset.teamDelete);
        if (record) deleteTeamRecord(record);
      });
    });
    document.querySelectorAll("[data-team-restore]").forEach(function(button) {
      button.addEventListener("click", function() {
        const record = findTeamRecord(button.dataset.teamRestore);
        if (record) restoreTeamRecord(record);
      });
    });
  }

  function referenceDirectory(directory) {
    if (directory === "financialRates") return financialRatesDirectory();
    const details = state.references[directory] || { title: directory, records: [] };
    const active = referenceRecords(directory);
    const archived = referenceRecords(directory, true).filter(function(item) { return item.archived; });
    const providerType = directory === "providers";
    const vendor = directory === "vendors";
    const resource = directory === "resources";
    const otherSubcontract = directory === "otherSubcontracts";
    const headers = project ? ["Код", "Наименование", "Статус", ""] : (vendor ? ["Наименование", "Тип поставщика", "Статус", ""] : (resource ? ["Сотрудник / ресурс", "Поставщик", "Тип поставщика", "Статус", ""] : (otherSubcontract ? ["Статья/Подрядчик", "Тип поставщика", "Категория", "НДС", "Статус", ""] : (providerType ? ["Тип поставщика", "Статус", ""] : ["Наименование", "Статус", ""]))));
    const row = function(record, archivedRow) {
      const editConfig = function(field) { return archivedRow ? null : { scope: "reference", directory: directory, id: record.id, field: field }; };
      const actions = archivedRow
        ? '<button class="edit-button" data-reference-edit="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="secondary-button compact-button" data-reference-restore="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Восстановить</button>' + historyButton("reference", record.id, directory)
        : '<button class="edit-button" data-reference-edit="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-reference-delete="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Удалить</button>' + historyButton("reference", record.id, directory);
      const hasVat = otherSubcontract && Object.keys(record.vatPlan || {}).some(function(year) { return Object.keys(record.vatPlan[year] || {}).some(function(month) { return num(record.vatPlan[year][month]) > 0; }); });
      const cells = (project ? inlineCell('<strong>' + escapeHtml(record.code || "—") + '</strong>', editConfig("code")) : "") + inlineCell('<strong>' + escapeHtml(record.name) + '</strong>', editConfig("name")) +
        (vendor ? inlineCell(escapeHtml(record.providerType || "—"), editConfig("providerType")) : "") +
        (resource ? inlineCell(escapeHtml(record.vendor || "—"), editConfig("vendor")) + '<td>' + escapeHtml(record.providerType || "—") + '</td>' : "") +
        (otherSubcontract ? '<td>Подряд</td>' + inlineCell(escapeHtml(record.category || "—"), editConfig("category")) + '<td>' + (hasVat ? "Да" : "Нет") + '</td>' : "");
      return '<tr>' + cells + '<td><span class="status-chip ' + (archivedRow ? "archived" : "") + '">' + (archivedRow ? "Архив" : "Активна") + '</span></td><td class="reference-actions">' + actions + '</td></tr>';
    };
    const note = project ? "Код проекта обязателен для финансовых операций, уникален без учёта регистра и имеет формат 2–32 символа: A–Z, 0–9, «-», «_». После первой финансовой операции код становится неизменяемым."
      : vendor ? "Поставщики выбираются в форме подрядной записи только из активных строк и имеют связанный тип."
        : providerType ? "Плоский справочник типов поставщика: «Штат» и «Подряд»."
          : resource ? "Каждый сотрудник или ресурс связан с поставщиком и доступен на вкладке 06."
            : otherSubcontract ? "Статьи расходов и подрядные организации вне привлечения ресурсов. Тип поставщика фиксирован: «Подряд»; «Да» в НДС означает, что заполнена хотя бы одна месячная ставка."
              : "Создавайте и редактируйте записи справочника.";
    return '<article class="panel reference-directory">' + sectionTitle(details.title, note, integer(active.length)) +
      '<div class="table-toolbar"><span class="table-edit-hint">Двойной клик по доступному полю — редактирование</span><button class="primary-button" data-reference-add="' + escapeHtml(directory) + '" type="button">+ Новая запись</button></div>' +
      table(headers, active, function(record) { return row(record, false); }) +
      (archived.length ? '<details class="archive-details"><summary>Архивные записи · ' + integer(archived.length) + '</summary>' + table(headers, archived, function(record) { return row(record, true); }) + '</details>' : "") +
      '</article>';
  }

  function renderReference() {
    const directory = selectedReferenceDirectory();
    const catalog = referenceDirectoryKeys.map(function(key) {
      const details = state.references[key] || { title: key };
      const count = referenceRecords(key).length;
      const icon = ({ roles: "◫", projects: "▣", providers: "◉", vendors: "⌁", resources: "◌", otherSubcontracts: "⊞" })[key] || "•";
      const selected = key === directory;
      return '<button class="nsi-catalog-item ' + (selected ? "active" : "") + '" type="button" data-reference-page="' + escapeHtml(key) + '"' + (selected ? ' aria-current="page"' : "") + '>' +
        '<span class="nsi-catalog-icon" aria-hidden="true">' + icon + '</span><span>' + escapeHtml(details.title) + '</span><span class="nsi-catalog-count">' + integer(count) + '</span></button>';
    }).join("");
    return '<section class="nsi-catalog-layout" aria-label="Нормативно-справочная информация">' +
      '<aside class="nsi-catalog-list" aria-label="Справочники НСИ"><div class="nsi-catalog-caption">Справочники</div>' + catalog + '</aside>' +
      '<div class="nsi-catalog-workspace">' + referenceDirectory(directory) + '</div>' +
      '</section>';
  }

  const renderers = [renderPipeline, renderIncome, renderCosts, renderSubcontracts, renderStaff, renderTeam, renderReference, renderOtherSubcontracts, renderFinancialPlanFact, renderPayments];

  function renderNavigation() {
    const tabs = state.snapshot.tabs;
    const items = [
      { tab: tabs[0], index: 0 }, { tab: "Доходы", index: 1 }, { tab: "Финансовый план‑факт", index: 8 },
      { tab: tabs[2], index: 2 }, { tab: "Прочий подряд", index: 7 }, { tab: tabs[3], index: 3 },
      { tab: "Оплаты подрядчикам", index: 9 }, { tab: tabs[4], index: 4 }, { tab: tabs[5], index: 5 }, { tab: tabs[6], index: 6 }
    ].map(function(item, index) { item.order = index + 1; return item; });
    nav.innerHTML = items.map(function(item) {
      return '<button class="tab-link ' + (item.index === state.activeTab ? "active" : "") + '" type="button" data-tab="' + item.index + '"><b>' + String(item.order).padStart(2, "0") + '</b><span>' + escapeHtml(item.tab) + '</span></button>';
    }).join("");
    nav.querySelectorAll("[data-tab]").forEach(function(button) {
      button.addEventListener("click", function() { state.activeTab = Number(button.dataset.tab); render(); });
    });
  }

  function render() {
    applyHoursContextDefaults();
    const isReferencePage = state.activeTab === 6;
    const directory = isReferencePage ? selectedReferenceDirectory() : null;
    const referenceTitle = directory && (state.references[directory] && state.references[directory].title || directory);
    const specialTitle = { 7: "Прочий подряд", 8: "Финансовый план‑факт", 9: "Оплаты подрядчикам" };
    pageTitle.textContent = isReferencePage ? "Нормативно-справочная информация" : (specialTitle[state.activeTab] || state.snapshot.tabs[state.activeTab]);
    pageSubtitle.textContent = isReferencePage ? "Справочники, обеспечивающие единые правила ведения данных. Открыт: «" + referenceTitle + "»." : subtitles[state.activeTab];
    renderNavigation();
    yearFilter.value = state.year;
    projectFilter.value = state.project;
    renderContextTabFilters();
    app.innerHTML = renderers[state.activeTab]();
    if (state.activeTab === 3) bindSubcontractControls();
    if (state.activeTab === 4) bindStaffControls();
    if (state.activeTab === 5) bindTeamControls();
    if (state.activeTab === 6) bindReferenceControls();
    if (state.activeTab === 7) bindOtherSubcontractControls();
    if (state.activeTab === 2) bindProjectCostControls();
    if (state.activeTab === 1) bindIncomeControls();
    if (state.activeTab === 8) bindFinancialPlanFactControls();
    if (state.activeTab === 9) bindPaymentControls();
    bindInlineEditing();
    bindChangeLogControls();
    setupTableRowNumbering();
    setupSortableTables();
    setupResizableTables();
    setupTableHeaderTooltips();
    setupGlobalTableScroll();
  }

  function populateFilters() {
    const years = state.snapshot.finance.years || [];
    yearFilter.innerHTML = '<option value="all">Все годы</option>' + years.map(function(year) { return '<option value="' + year + '">' + year + '</option>'; }).join("");
    updateProjectFilterOptions();
    yearFilter.addEventListener("change", function() { state.year = yearFilter.value; state.subcontractPage = 1; render(); });
    projectFilter.addEventListener("change", function() { state.project = projectFilter.value; state.subcontractPage = 1; render(); });
    document.getElementById("reset-filters").addEventListener("click", function() {
      state.year = "all";
      state.project = "all";
      state.subcontractViewMonth = "all";
      state.subcontractVendor = "all";
      state.subcontractResource = "all";
      state.staffVendor = "all";
      state.staffEmployee = "all";
      state.staffMonth = "all";
      state.teamRole = "all";
      state.teamEmployee = "all";
      state.referenceDirectory = "roles";
      state.otherSubcontractView = "compact";
      state.costPeriod = "year";
      state.costSource = "all";
      state.costSearch = "";
      state.costOnlyDeviations = false;
      state.expandedSubcontractYears = {};
      state.expandedOtherSubcontractYears = {};
      state.expandedStaffYears = {};
      state.expandedTeamYears = {};
      state.subcontractPage = 1;
      if (state.activeTab === 3) {
        state.year = currentHoursYear();
        state.subcontractViewMonth = currentHoursMonth();
      }
      if (state.activeTab === 4) {
        state.year = currentHoursYear();
        state.staffMonth = currentHoursMonth();
      }
      if (state.activeTab === 7) state.year = currentHoursYear();
      yearFilter.value = state.year;
      projectFilter.value = state.project;
      render();
    });
  }

  function setExchangeStatus(message, tone) {
    exchangeStatus.textContent = message;
    exchangeStatus.classList.toggle("is-error", tone === "error");
    exchangeStatus.classList.toggle("is-success", tone === "success");
  }

  async function fileBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))));
    }
    return window.btoa(chunks.join(""));
  }

  function exchangeSummaryText(summary) {
    return ["НСИ — " + (summary.references || 0), "Команда — " + (summary.team || 0), "Штат — " + (summary.staff || 0), "Подряд — " + (summary.subcontracts || 0)].join("; ");
  }

  function bindDataExchangeMenu() {
    exchangeButton.addEventListener("click", function() { exchangeFileInput.click(); });
    exchangeFileInput.addEventListener("change", async function() {
      const file = exchangeFileInput.files && exchangeFileInput.files[0];
      if (!file) return;
      if (!/\.xlsx$/i.test(file.name)) {
        setExchangeStatus("Выберите файл Excel в формате .xlsx.", "error");
        exchangeFileInput.value = "";
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        setExchangeStatus("Размер файла Excel не должен превышать 12 МБ.", "error");
        exchangeFileInput.value = "";
        return;
      }
      exchangeButton.disabled = true;
      setExchangeStatus("Проверяем и загружаем данные из «" + file.name + "»…");
      try {
        const response = await fetch("/api/data-exchange/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, content: await fileBase64(file) })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не удалось загрузить Excel-файл.");
        await refreshReferenceData();
        render();
        setExchangeStatus("Данные загружены: " + exchangeSummaryText(payload.summary || {}), "success");
      } catch (error) {
        setExchangeStatus(error.message || "Не удалось загрузить Excel-файл. Данные не изменены.", "error");
      } finally {
        exchangeButton.disabled = false;
        exchangeFileInput.value = "";
      }
    });
  }

    function setDesktopSyncStatus(message, tone) {
    desktopSyncStatus.textContent = message;
    desktopSyncStatus.classList.toggle("is-error", tone === "error");
    desktopSyncStatus.classList.toggle("is-success", tone === "success");
  }

  function setGithubStatus(message, tone) {
    setDesktopSyncStatus(message, tone);
    if (!desktopSyncModal.hidden) desktopSyncError.textContent = message;
  }

  function desktopStatusText(info) {
    if (!info || !info.configured) return "GitHub не подключён.";
    if (!info.lastSyncAt) return "Репозиторий подключён. Выполните первую синхронизацию.";
    return "Синхронизировано: " + new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(info.lastSyncAt));
  }

  async function refreshAfterDesktopSync() {
    await fetch("/api/reload", { method: "POST" });
    await refreshReferenceData();
    populateFilters();
    render();
  }

  async function bindDesktopSync() {
    if (!window.budgetDesktop) return;
    desktopSyncPanel.hidden = false;
    let currentStatus = await window.budgetDesktop.getStatus();
    setDesktopSyncStatus(desktopStatusText(currentStatus), currentStatus.configured ? "success" : "");

      function openConfigure(message) {
        desktopRepositoryUrl.value = currentStatus.remoteUrl || "";
        desktopGithubToken.value = "";
        desktopSyncError.textContent = message || "";
        desktopSyncModal.hidden = false;
        desktopRepositoryUrl.focus();
      }

    function setDesktopSyncBusy(isBusy) {
      desktopOperationInProgress = isBusy;
      desktopSyncButton.disabled = isBusy;
      desktopConfigureButton.disabled = isBusy;
      desktopSyncButton.textContent = isBusy ? "Синхронизация…" : "↻ Синхронизировать GitHub";
    }

      function closeConfigure(event) {
        if (event) event.preventDefault();
        desktopSyncModal.hidden = true;
      }

    desktopConfigureButton.addEventListener("click", openConfigure);
    document.getElementById("desktop-sync-cancel").addEventListener("click", closeConfigure);
      desktopSyncModal.addEventListener("click", function(event) { if (event.target === desktopSyncModal) closeConfigure(event); });
      desktopSyncForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      desktopSyncError.textContent = "";
        const submit = desktopSyncForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        setDesktopSyncBusy(true);
        submit.textContent = "Подключение…";
        setGithubStatus("Подключаемся к GitHub. Первичная загрузка данных может занять до трёх минут…");
        try {
          currentStatus = await window.budgetDesktop.configure({ remoteUrl: desktopRepositoryUrl.value, token: desktopGithubToken.value });
          await window.budgetDesktop.sync();
          closeConfigure();
        } catch (error) {
          setGithubStatus(error.message || "Не удалось сохранить параметры подключения.", "error");
        } finally {
          submit.disabled = false;
          submit.textContent = "Сохранить подключение";
          setDesktopSyncBusy(false);
        }
      });
      desktopSyncButton.addEventListener("click", async function() {
        if (!currentStatus.configured) return openConfigure();
        setDesktopSyncBusy(true);
        setGithubStatus("Запускаем синхронизацию с GitHub…");
        try {
          await window.budgetDesktop.sync();
        } catch (error) {
          setGithubStatus(error.message || "Не удалось синхронизировать данные.", "error");
        } finally {
          setDesktopSyncBusy(false);
        }
      });
      window.budgetDesktop.onStatus(async function(event) {
        setGithubStatus(event.message || "Проверяем синхронизацию…", event.phase === "error" ? "error" : event.phase === "success" ? "success" : "");
        if (event.status) currentStatus = event.status;
        if (event.phase === "success") {
          if (!desktopSyncModal.hidden) closeConfigure();
          try { await refreshAfterDesktopSync(); } catch (error) { setDesktopSyncStatus("Данные синхронизированы, но интерфейс нужно обновить.", "error"); }
        }
      });
      // При обычном повторном запуске используем сохранённые параметры и не
      // показываем форму. Форма открывается только если этот обмен завершился ошибкой.
      async function startStartupSync() {
        setDesktopSyncBusy(true);
        setGithubStatus("Проверяем актуальность данных в GitHub…");
        try {
          await window.budgetDesktop.sync();
        } catch (error) {
          const message = error.message || "Не удалось синхронизировать данные с GitHub.";
          setGithubStatus(message, "error");
          openConfigure(message);
        } finally {
          setDesktopSyncBusy(false);
        }
      }
      if (currentStatus.configured) startStartupSync();
    }

  async function boot() {
    try {
      await refreshReferenceData();
      populateFilters();
      bindDataExchangeMenu();
      await bindDesktopSync();
      render();
    } catch (error) {
      app.innerHTML = '<section class="error-card"><h2>Снимок модели недоступен</h2><p>' + escapeHtml(error.message) + '</p><p>Проверьте, что файл <code>data/model-snapshot.json</code> находится рядом с сервером.</p></section>';
    }
  }

  boot();
}());
