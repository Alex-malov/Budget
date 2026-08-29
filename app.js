(function () {
  "use strict";

  const state = {
    snapshot: null, overview: null, subcontracts: [], staffRecords: [], teamRecords: [], references: {}, activeTab: 0,
    year: "all", project: "all", subcontractMonth: "all", subcontractVendor: "all", teamRole: "all", teamEmployee: "all", referenceDirectory: "all",
    expandedSubcontractYears: {}, expandedStaffYears: {}, expandedTeamYears: {},
    subcontractPage: 1, subcontractPageSize: 80, staffPlanIndex: Object.create(null), contractorPlanIndex: Object.create(null), staffTeamIndex: Object.create(null), contractorTeamIndex: Object.create(null)
  };
  const app = document.getElementById("app");
  const nav = document.getElementById("tab-nav");
  const yearFilter = document.getElementById("filter-year");
  const projectFilter = document.getElementById("filter-project");
  const globalTableScroll = document.getElementById("global-table-scroll");
  const globalTableScrollTrack = document.getElementById("global-table-scroll-track");
  const contextTabFilters = document.getElementById("context-tab-filters");
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const status = document.getElementById("source-status");
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
    "Структура себестоимости: подряд, ФОТ и прочие затраты.",
    "Детализация затрат подрядчиков: план из ресурсного плана и введённый факт.",
    "Учёт плановых и фактических часов штатных ресурсов.",
    "Состав команды, роли и распределение по проектам.",
    "Роли, контракты и параметры бюджетирования."
  ];

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

  function sum(rows, field) { return rows.reduce(function(total, row) { return total + num(row[field]); }, 0); }

  function selectedYear(fallback) {
    return state.year === "all" ? fallback : Number(state.year);
  }

  function filterProject(rows) {
    return state.project === "all" ? rows : rows.filter(function(row) { return row.project === state.project; });
  }

  function referenceRecords(directory, includeArchived) {
    const source = state.references[directory] && state.references[directory].records || [];
    return source.filter(function(record) { return includeArchived || !record.archived; });
  }

  function activeReferenceNames(directory) {
    return referenceRecords(directory).map(function(record) { return record.name; });
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
      return '<option value="' + escapeHtml(record.name) + '"' + (record.name === selected ? ' selected' : '') + '>' + escapeHtml(record.name) + '</option>';
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

  function subcontractContext() {
    const yearRecords = filterProject(state.subcontracts).filter(function(item) {
      return state.year === "all" || item.period.startsWith(state.year + "-");
    });
    const availableMonths = Array.from(new Set(yearRecords.map(function(item) { return item.period; }))).sort();
    const availableVendors = Array.from(new Set(yearRecords.map(function(item) { return item.vendor; }))).sort();
    if (state.subcontractMonth !== "all" && !availableMonths.includes(state.subcontractMonth)) state.subcontractMonth = "all";
    if (state.subcontractVendor !== "all" && !availableVendors.includes(state.subcontractVendor)) state.subcontractVendor = "all";
    return { yearRecords: yearRecords, availableMonths: availableMonths, availableVendors: availableVendors };
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
    const directories = ["roles", "projects", "vendors", "providers", "resources", "parameters"];
    if (!directories.includes(state.referenceDirectory)) state.referenceDirectory = "all";
    return { directories: directories };
  }

  function updateContextControlsVisibility() {
    const nsiOnly = state.activeTab === 6;
    projectFilter.closest("label").hidden = nsiOnly;
    yearFilter.closest("label").hidden = nsiOnly;
    document.getElementById("reset-filters").hidden = nsiOnly;
  }

  function renderContextTabFilters() {
    updateContextControlsVisibility();
    contextTabFilters.innerHTML = "";
    if (state.activeTab === 3) {
      const context = subcontractContext();
      contextTabFilters.innerHTML = '<label>Месяц<select id="subcontract-month"><option value="all">Все месяцы</option>' +
        context.availableMonths.map(function(item) { return '<option value="' + item + '"' + (item === state.subcontractMonth ? ' selected' : '') + '>' + monthName(item) + '</option>'; }).join("") +
        '</select></label><label>Поставщик<select id="subcontract-vendor"><option value="all">Все поставщики</option>' +
        context.availableVendors.map(function(item) { return '<option value="' + escapeHtml(item) + '"' + (item === state.subcontractVendor ? ' selected' : '') + '>' + escapeHtml(item) + '</option>'; }).join("") +
        '</select></label>';
      document.getElementById("subcontract-month").addEventListener("change", function(event) { state.subcontractMonth = event.target.value; state.subcontractPage = 1; render(); });
      document.getElementById("subcontract-vendor").addEventListener("change", function(event) { state.subcontractVendor = event.target.value; state.subcontractPage = 1; render(); });
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
    if (state.activeTab === 6) {
      const context = referenceContext();
      contextTabFilters.innerHTML = '<label>Справочник<select id="reference-directory"><option value="all">Все справочники</option>' +
        context.directories.map(function(directory) { const title = state.references[directory] && state.references[directory].title || directory; return '<option value="' + escapeHtml(directory) + '"' + (directory === state.referenceDirectory ? ' selected' : '') + '>' + escapeHtml(title) + '</option>'; }).join("") +
        '</select></label>';
      document.getElementById("reference-directory").addEventListener("change", function(event) { state.referenceDirectory = event.target.value; render(); });
      return;
    }
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

  function renderIncome() {
    const records = currentCashRecords();
    const series = cashSeries();
    const total = sum(records, "visibleTotal");
    const projects = new Set(records.map(function(item) { return item.project; })).size;
    return '<section class="metric-grid compact">' +
      card("Поступления", money(total, true), state.year === "all" ? "за все доступные периоды" : "за " + state.year + " год", "blue") +
      card("Проекты", integer(projects), "с ненулевыми поступлениями", "violet") +
      card("Контракты / этапы", integer(records.length), "строки исходной модели", "cyan") +
      '</section>' +
      '<section class="grid two"><article class="panel">' + sectionTitle("Распределение поступлений", "Период определяется датами исходной книги.", "руб.") +
      (series.length ? barChart(series, "amount", "period", function(value) { return money(value, true); }, "cash-bars") : empty("Нет поступлений для выбранного фильтра.")) +
      '</article><article class="panel insight-panel">' + sectionTitle("Как читать страницу", "Экран соответствует вкладке «Доходы» новой книги.") +
      '<p>Каждая строка — договорной период проекта. В таблице отражается сумма только за выбранный год; выбор «Все годы» показывает общий итог.</p><p class="muted">НДС и служебные строки исключены: отображаются только строки «Всего» по проектам.</p></article></section>' +
      '<section class="panel">' + sectionTitle("Доходы по проектам и договорным периодам", "Нажмите фильтр проекта, чтобы сузить срез.") +
      table(["Проект", "Период ГК", "Поступления", "Активные месяцы"], records, function(record) {
        return '<tr><td><strong>' + escapeHtml(record.project) + '</strong></td><td>' + escapeHtml(record.contractPeriod || "—") + '</td><td>' + money(record.visibleTotal) + '</td><td>' + record.visibleMonthly.map(function(item) { return '<span class="month-chip">' + monthName(item.period) + '</span>'; }).join("") + '</td></tr>';
      }) + '</section>';
  }

  function renderCosts() {
    const rows = ["Себестоимость работ всего", "Подрядчики", "Затраты на оплату труда всего", "Прочие затраты всего", "НДС всего"].map(function(label) {
      return { label: label, values: line(label).values };
    });
    const year = selectedYear(state.overview.latestYear);
    const total = valueFor("Себестоимость работ всего", year);
    const subcontract = valueFor("Подрядчики", year);
    const payroll = valueFor("Затраты на оплату труда всего", year);
    return '<section class="metric-grid compact">' +
      card("Себестоимость", money(total, true), "итого · " + year, "violet") +
      card("Доля подряда", percent(total ? subcontract / total : null), money(subcontract, true), "amber") +
      card("Доля ФОТ", percent(total ? payroll / total : null), money(payroll, true), "cyan") +
      '</section>' +
      '<section class="grid two"><article class="panel">' + sectionTitle("Структура затрат", "Себестоимость по выбранному году.", String(year)) +
      barChart(rows.map(function(row) { return { label: row.label, amount: num(row.values[String(year)]) }; }), "amount", "label", function(value) { return money(value, true); }, "financial-bars") +
      '</article><article class="panel insight-panel">' + sectionTitle("Контроль состава", "Экран соответствует вкладке «Проектные Расходы (себест)».") +
      '<p>Себестоимость — макроуровень из листа «Свод». На следующих вкладках её детализация разделена на подрядные и штатные ресурсы.</p><p class="muted">Значения НДС выводятся отдельно и не включаются в операционную разницу без НДС.</p></article></section>' +
      '<section class="panel">' + sectionTitle("Проектные расходы по годам", "Источник: «Свод», строки себестоимости.") +
      table(["Статья", "2024", "2025", "2026"], rows, function(row) {
        return '<tr><td>' + escapeHtml(row.label) + '</td><td>' + money(row.values["2024"]) + '</td><td>' + money(row.values["2025"]) + '</td><td>' + money(row.values["2026"]) + '</td></tr>';
      }) + '</section>';
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
    const rows = subcontractPlanRows(years);
    const displayedRows = rows.filter(function(row) {
      if (!row.teamRecords.length) return false;
      const hasHours = subcontractHasHours(row, years);
      const matchesMonth = state.subcontractMonth === "all" || subcontractPlanHours(row, state.subcontractMonth.slice(0, 4), Number(state.subcontractMonth.slice(5, 7))) > 0 || subcontractActualHours(row, state.subcontractMonth.slice(0, 4), Number(state.subcontractMonth.slice(5, 7))) > 0 || subcontractAmount(row, years, state.subcontractMonth) > 0;
      return hasHours && matchesMonth;
    });
    const amount = sum(displayedRows.map(function(row) { return { value: subcontractAmount(row, years, state.subcontractMonth) }; }), "value");
    const plannedHours = sum(displayedRows.map(function(row) { return { value: subcontractHoursTotal(row, years, state.subcontractMonth, subcontractPlanHours) }; }), "value");
    const actualHours = sum(displayedRows.map(function(row) { return { value: subcontractHoursTotal(row, years, state.subcontractMonth, subcontractActualHours) }; }), "value");
    const sourceCosts = displayedRows.flatMap(function(row) { return row.teamRecords; });
    const averageRate = sourceCosts.length ? sum(sourceCosts.map(function(record) { return { value: teamCostValues(record).rate }; }), "value") / sourceCosts.length : 0;
    const page = subcontractPage(displayedRows);
    const planTable = allYears ? subcontractAllYearsTable(page.rows, years) : subcontractTable(page.rows, years[0]);
    const periodLabel = allYears ? "за все доступные годы" : "по месяцам " + years[0] + " года";
    return '<section class="metric-grid compact hours-metric-grid">' +
      card("Подрядные затраты", money(amount, true), periodLabel, "amber") +
      card("Часы · план", integer(plannedHours) + " ч", "из вкладки 06 · " + periodLabel, "cyan") +
      card("Часы · факт", integer(actualHours) + " ч", "введено на этой странице", "blue") +
      card("Средняя ставка", money(averageRate), "по ресурсам «Подряд» из НСИ", "violet") +
      '</section>' +
      '<section class="panel subcontract-plan-table">' + sectionTitle("Суммы и часы подряд", allYears ? "Годовые итоги часов с возможностью раскрытия месяцев." : "Часы указаны в разрезе месяцев выбранного года.", allYears ? "все годы" : years[0]) +
      '<div class="table-toolbar"><button id="add-subcontract" class="primary-button" type="button">+ Новая запись</button>' + subcontractPager(page, displayedRows.length) + '</div>' +
      planTable +
      '<p class="table-note">' + (allYears ? "Нажмите на название года, чтобы развернуть его по месяцам." : "Показаны строки, у которых есть план или факт часов в выбранном году.") + " Стоимость, ставка и привлечение поступают из НСИ «Сотрудник / ресурс»; плановые часы — из раздела 06. Годовые показатели рассчитываются по плановым часам каждого месяца. Факт и затраты присоединяются по проекту и ресурсу." + (state.subcontractMonth === "all" ? " Для изменения конкретной записи выберите месяц в контексте просмотра." : "") + '</p></section>';
  }

  function formError(name, message) {
    const target = document.querySelector('[data-error="' + name + '"]');
    if (target) target.textContent = message || "";
  }

  function closeSubcontractModal() {
    const modal = document.getElementById("subcontract-modal");
    if (modal) modal.remove();
  }

  function showSubcontractModal(record) {
    const editing = Boolean(record);
    const item = record || { project: state.project === "all" ? "" : state.project, vendor: "", article: "", period: state.subcontractMonth === "all" ? "" : state.subcontractMonth, amount: "", rate: "", actualHours: "" };
    const modal = document.createElement("div");
    modal.id = "subcontract-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML = '<section class="modal" role="dialog" aria-modal="true" aria-labelledby="subcontract-modal-title"><div class="modal-header"><div><p class="eyebrow">Суммы и часы подряд</p><h2 id="subcontract-modal-title">' + (editing ? "Редактировать запись" : "Новая запись") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="subcontract-form"><div class="form-grid"><label>Поставщик <b>*</b><select name="vendor">' + referenceOptions("vendors", item.vendor, "Выберите поставщика") + '</select><small data-error="vendor"></small></label><label>Статья <b>*</b><input name="article" value="' + escapeHtml(item.article) + '" placeholder="Например, разработка"><small data-error="article"></small></label><label>Проект <b>*</b><select name="project">' + referenceOptions("projects", item.project, "Выберите проект") + '</select><small data-error="project"></small></label><label>Период <b>*</b><input name="period" type="month" value="' + escapeHtml(item.period) + '"><small data-error="period"></small></label><label>Ставка, ₽/ч <b>*</b><input name="rate" type="number" min="0" step="0.01" value="' + escapeHtml(item.rate) + '"><small data-error="rate"></small></label><label>Часы (факт) <b>*</b><input name="actualHours" type="number" min="0" step="0.5" value="' + escapeHtml(item.actualHours) + '"><small data-error="actualHours"></small></label><label>Затраты, ₽ <b>*</b><input name="amount" type="number" min="0" step="0.01" value="' + escapeHtml(item.amount) + '"><small data-error="amount"></small></label></div><p class="form-note">Поставщики выбираются только из активного справочника НСИ. План часов поступает с вкладки 06 и не редактируется на этой форме.</p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    const subcontractForm = modal.querySelector("form");
    const subcontractNote = modal.querySelector(".form-note");
    subcontractNote.insertAdjacentHTML("beforebegin", teamCostFormMarkup("subcontract", subcontractTeamRecords(item), "Подряд"));
    const updateSubcontractCost = function() {
      updateTeamCostForm(modal, "subcontract", subcontractTeamRecords({
        project: subcontractForm.elements.project.value,
        vendor: subcontractForm.elements.vendor.value,
        article: subcontractForm.elements.article.value
      }), "Подряд");
    };
    ["vendor", "article", "project"].forEach(function(name) {
      const field = subcontractForm.elements[name];
      field.addEventListener(field.tagName === "INPUT" ? "input" : "change", updateSubcontractCost);
    });
    modal.querySelector(".close-button").addEventListener("click", closeSubcontractModal);
    modal.querySelector("[data-close]").addEventListener("click", closeSubcontractModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeSubcontractModal(); });
    modal.querySelector("form").addEventListener("submit", async function(event) {
      event.preventDefault();
      ["period", "project", "article", "vendor", "amount", "rate", "actualHours"].forEach(function(name) { formError(name, ""); });
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

  async function refreshSubcontracts() {
    const response = await fetch("/api/subcontracts", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить подрядные записи.");
    state.subcontracts = payload.records || [];
  }

  function updateProjectFilterOptions() {
    const projects = activeReferenceNames("projects");
    projectFilter.innerHTML = '<option value="all">Все проекты</option>' + projects.map(function(project) {
      return '<option value="' + escapeHtml(project) + '">' + escapeHtml(project) + '</option>';
    }).join("");
    if (state.project !== "all" && !projects.includes(state.project)) state.project = "all";
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
      fetch("/api/staff", { cache: "no-store" })
    ]);
    const model = await responses[0].json();
    const subcontracts = await responses[1].json();
    const references = await responses[2].json();
    const team = await responses[3].json();
    const staff = await responses[4].json();
    if (!responses[0].ok) throw new Error(model.error || "Не удалось загрузить данные.");
    if (!responses[1].ok) throw new Error(subcontracts.error || "Не удалось загрузить подрядные записи.");
    if (!responses[2].ok) throw new Error(references.error || "Не удалось загрузить справочники.");
    if (!responses[3].ok) throw new Error(team.error || "Не удалось загрузить записи команды.");
    if (!responses[4].ok) throw new Error(staff.error || "Не удалось загрузить штатные записи.");
    state.snapshot = model.snapshot;
    state.overview = model.overview;
    state.subcontracts = subcontracts.records || [];
    state.teamRecords = team.records || [];
    state.staffRecords = staff.records || [];
    state.references = references.directories || {};
    buildPlanIndexes();
    updateProjectFilterOptions();
  }

  function closeReferenceModal() {
    const modal = document.getElementById("reference-modal");
    if (modal) modal.remove();
  }

  function findReference(directory, id) {
    return referenceRecords(directory, true).find(function(item) { return item.id === id; });
  }

  function showReferenceModal(directory, record) {
    const editing = Boolean(record);
    const parameter = directory === "parameters";
    const providerType = directory === "providers";
    const vendor = directory === "vendors";
    const resource = directory === "resources";
    const year = teamYear();
    const title = state.references[directory] && state.references[directory].title || "Справочник";
    const item = record || { name: "", value: "", providerType: "" };
    const modal = document.createElement("div");
    modal.id = "reference-modal";
    modal.className = "modal-backdrop";
    const fields = vendor
      ? '<label>Наименование <b>*</b><input name="name" value="' + escapeHtml(item.name) + '" autofocus><small data-error="name"></small></label><label>Тип поставщика <b>*</b><select name="providerType">' + referenceOptions("providers", item.providerType, "Выберите тип поставщика") + '</select><small data-error="providerType"></small></label>'
      : (resource
        ? '<label>Сотрудник / ресурс <b>*</b><input name="name" value="' + escapeHtml(item.name) + '" autofocus><small data-error="name"></small></label><label>Поставщик <b>*</b><select name="vendor">' + referenceOptions("vendors", item.vendor, "Выберите поставщика") + '</select><small data-error="vendor"></small></label>'
        : '<label>' + (parameter ? "Параметр" : (providerType ? "Тип поставщика" : "Наименование")) + ' <b>*</b><input name="name" value="' + escapeHtml(item.name) + '" autofocus><small data-error="name"></small></label>' + (parameter ? '<label>Значение <b>*</b><input name="value" value="' + escapeHtml(item.value) + '"><small data-error="value"></small></label>' : ""));
    const note = providerType ? "Укажите доступный тип: «Штат» или «Подряд»." : (vendor ? "Поставщик выбирается в формах только при наличии активного типа поставщика." : (resource ? "Сотрудник или ресурс выбирается на вкладке 06 только вместе со связанным поставщиком." : ""));
    const costSection = resource ? '<section class="cost-form-section"><div><strong>Стоимость, ₽</strong><span>Ставка + привлечение · ' + escapeHtml(year) + ' год</span></div><div class="team-cost-month-grid">' + teamMonthLabels.map(function(label, index) { const month = index + 1; const values = teamCostValues(item, year, month); return '<div class="team-cost-month-row"><strong>' + label + '</strong><label>Ставка, ₽<input name="rate-' + month + '" type="number" min="0" step="0.01" value="' + escapeHtml(values.rate) + '"></label><label>Привлечение, ₽<input name="attraction-' + month + '" type="number" min="0" step="0.01" value="' + escapeHtml(values.attraction) + '"></label><label>Стоимость, ₽<input id="resource-cost-' + month + '" class="calculated-field" type="text" value="' + escapeHtml(money(values.cost)) + '" readonly></label></div>'; }).join("") + '</div><small data-error="costPlan"></small></section>' : "";
    modal.innerHTML = '<section class="modal reference-modal" role="dialog" aria-modal="true" aria-labelledby="reference-modal-title"><div class="modal-header"><div><p class="eyebrow">НСИ</p><h2 id="reference-modal-title">' + (editing ? "Редактировать: " : "Новая запись: ") + escapeHtml(title) + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="reference-form"><div class="form-grid ' + ((parameter || vendor || resource) ? "" : "single-field") + '">' + fields + '</div>' + costSection + '<p class="form-note">' + note + '</p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    modal.querySelector(".close-button").addEventListener("click", closeReferenceModal);
    modal.querySelector("[data-close]").addEventListener("click", closeReferenceModal);
    modal.addEventListener("click", function(event) { if (event.target === modal) closeReferenceModal(); });
    const referenceForm = modal.querySelector("form");
    if (resource) for (let month = 1; month <= 12; month += 1) {
      [referenceForm.elements["rate-" + month], referenceForm.elements["attraction-" + month]].forEach(function(field) { field.addEventListener("input", function() { modal.querySelector("#resource-cost-" + month).value = money(num(referenceForm.elements["rate-" + month].value) + num(referenceForm.elements["attraction-" + month].value)); }); });
    }
    referenceForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      ["name", "value", "providerType", "vendor", "costPlan"].forEach(function(name) { formError(name, ""); });
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (resource) {
        const costPlan = JSON.parse(JSON.stringify(item.costPlan || {}));
        costPlan[year] = {};
        for (let month = 1; month <= 12; month += 1) { costPlan[year][String(month)] = { rate: Number(body["rate-" + month]), attraction: Number(body["attraction-" + month]) }; delete body["rate-" + month]; delete body["attraction-" + month]; }
        body.costPlan = costPlan;
      }
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
        body: JSON.stringify({ name: record.name, value: record.value, providerType: record.providerType, vendor: record.vendor, costPlan: record.costPlan, archived: false })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось восстановить запись.");
      await refreshReferenceData();
      render();
    } catch (error) {
      window.alert(error.message || "Не удалось восстановить запись.");
    }
  }

  function bindReferenceControls() {
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
  }

  function renderStaff() {
    const allYears = state.year === "all";
    const years = allYears ? teamPlanYears() : [String(state.year)];
    const records = staffRecordsForContext(years);
    const cost = sum(records.map(function(record) { return { value: teamCostValues(record.teamRecord || staffTeamRecord(record)).cost }; }), "value");
    const plannedHours = sum(records.map(function(item) { return { value: staffHoursTotal(item, years, staffPlanHours) }; }), "value");
    const actualHours = sum(records.map(function(item) { return { value: staffHoursTotal(item, years, staffActualHours) }; }), "value");
    const activePeople = new Set(records.map(function(item) { return item.employee; })).size;
    const planTable = allYears ? staffAllYearsTable(records, years) : staffTable(records, years[0]);
    const periodLabel = allYears ? "за все доступные годы" : "по месяцам " + years[0] + " года";
    return '<section class="metric-grid compact hours-metric-grid">' +
      card("Стоимость ресурсов", money(cost, true), "ставка + привлечение из НСИ", "violet") +
      card("Часы · план", integer(plannedHours) + " ч", "из вкладки 06 · " + periodLabel, "cyan") +
      card("Часы · факт", integer(actualHours) + " ч", "введено на этой странице", "blue") +
      card("Специалисты", integer(activePeople), "в выбранном проектном срезе", "blue") +
      '</section>' +
      '<section class="panel staff-plan-table">' + sectionTitle("Суммы и часы штат", allYears ? "Годовые итоги плановых и фактических часов с возможностью раскрытия месяцев." : "План и факт часов в разрезе месяцев выбранного года.", allYears ? "все годы" : years[0]) +
      '<div class="table-toolbar"><button id="add-staff-record" class="primary-button" type="button">+ Новая запись</button></div>' +
      planTable +
      '<p class="table-note">' + (allYears ? "Нажмите на название года, чтобы развернуть его по месяцам." : "Показаны строки, у которых есть план или факт часов в выбранном году.") + " План часов поступает из раздела 06, стоимость, ставка и привлечение — из НСИ «Сотрудник / ресурс», а факт вводится на этой странице. Годовые показатели рассчитываются по плановым часам каждого месяца." + '</p></section>';
  }

  function closeStaffModal() {
    const modal = document.getElementById("staff-modal");
    if (modal) modal.remove();
  }

  function staffPlanAssignments() {
    const seen = new Set();
    return state.teamRecords.filter(function(record) {
      return !record.archived && record.source === "Штат" && record.employee && record.project;
    }).filter(function(record) {
      const key = normalizedText(record.employee) + "|" + normalizedText(record.project);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function(left, right) {
      return (left.employee + "|" + left.project).localeCompare(right.employee + "|" + right.project, "ru-RU");
    });
  }

  function staffEmployeeOptions(selectedEmployee, selectedProject) {
    const assignments = staffPlanAssignments();
    const available = assignments.some(function(record) {
      return record.employee === selectedEmployee && record.project === selectedProject;
    });
    const unavailable = selectedEmployee && !available
      ? '<option value="' + escapeHtml(selectedEmployee) + '" data-project="' + escapeHtml(selectedProject) + '" selected>' + escapeHtml(selectedEmployee + " · " + (selectedProject || "проект не задан") + " · нет в активном плане") + '</option>'
      : "";
    return '<option value="">Выберите сотрудника</option>' + unavailable + assignments.map(function(record) {
      const selected = record.employee === selectedEmployee && record.project === selectedProject;
      return '<option value="' + escapeHtml(record.employee) + '" data-project="' + escapeHtml(record.project) + '"' + (selected ? " selected" : "") + '>' + escapeHtml(record.employee + " · " + record.project) + '</option>';
    }).join("");
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
    modal.innerHTML = '<section class="modal team-modal" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title"><div class="modal-header"><div><p class="eyebrow">Суммы и часы штат</p><h2 id="staff-modal-title">' + (editing ? "Редактировать запись" : "Новая запись") + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div><form id="staff-form"><div class="form-grid"><label>Сотрудник <b>*</b><select name="employee" autofocus>' + staffEmployeeOptions(item.employee, item.project) + '</select><small data-error="employee"></small></label><label>Проект <b>*</b><input name="project" class="calculated-field" value="' + escapeHtml(item.project) + '" readonly aria-readonly="true"><small data-error="project"></small></label><label>Роль <b>*</b><select name="role">' + referenceOptions("roles", item.role, "Выберите роль") + '</select><small data-error="role"></small></label></div><section class="hours-form-section"><div><strong>Часы (факт)</strong><span>' + escapeHtml(year) + ' год</span></div><div class="team-hours-grid">' + hourInputs + '</div><small data-error="hoursActual"></small></section><p class="form-note">Сотрудник и связанный с ним проект выбираются из активных записей «Штат» вкладки 06. План часов берётся с этой вкладки и на форме не изменяется.</p><div class="form-actions"><button class="secondary-button" type="button" data-close>Отмена</button><button class="primary-button" type="submit">' + (editing ? "Сохранить" : "Создать") + '</button></div></form></section>';
    document.body.appendChild(modal);
    const staffForm = modal.querySelector("form");
    const staffEmployee = staffForm.elements.employee;
    const staffProject = staffForm.elements.project;
    function syncStaffProject() {
      const selected = staffEmployee.options[staffEmployee.selectedIndex];
      staffProject.value = selected && selected.dataset.project || "";
    }
    staffEmployee.addEventListener("change", syncStaffProject);
    syncStaffProject();
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

  const teamMonthLabels = ["Ян", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

  function teamYear() {
    return String(selectedYear(state.overview.latestYear));
  }

  function teamHours(record, year, month) {
    return num(record.hoursPlan && record.hoursPlan[String(year)] && record.hoursPlan[String(year)][String(month)]);
  }

  function teamPlanYears() {
    return (state.snapshot.finance.years || []).map(String);
  }

  function teamYearTotal(record, year) {
    return sum(Array.from({ length: 12 }, function(_, index) { return { value: teamHours(record, year, index + 1) }; }), "value");
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
    [row.article, row.vendor].filter(Boolean).forEach(function(value) {
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
      normalizedText(record.article) === resourceName || normalizedText(record.vendor) === resourceName
    );
  }

  function subcontractPlanRows(years) {
    const context = subcontractContext();
    return state.teamRecords.filter(function(resource) {
      return !resource.archived && resource.source === "Подряд" && (state.project === "all" || resource.project === state.project);
    }).map(function(resource) {
      const sourceRecords = context.yearRecords.filter(function(record) {
        return subcontractRecordMatchesResource(record, resource);
      });
      const vendors = Array.from(new Set(sourceRecords.map(function(record) { return record.vendor; })));
      const articles = Array.from(new Set(sourceRecords.map(function(record) { return record.article; }).filter(Boolean)));
      const row = {
        id: "team-" + resource.id,
        vendor: vendors.length === 1 ? vendors[0] : "—",
        vendors: vendors,
        article: articles.length === 1 ? articles[0] : (resource.role || "—"),
        resource: resource.employee,
        project: resource.project,
        rates: [],
        actualHours: {},
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
        row.amountPlan[year][month] = num(row.amountPlan[year][month]) + num(record.amount);
        if (!row.recordsByPeriod[record.period]) row.recordsByPeriod[record.period] = record;
        if (num(record.rate) > 0) row.rates.push(num(record.rate));
      });
      return row;
    }).filter(function(row) {
      return state.subcontractVendor === "all" || row.vendors.includes(state.subcontractVendor);
    });
  }

  function subcontractPlanHours(row, year, month) {
    return sum((row.teamRecords || subcontractTeamRecords(row)).map(function(record) {
      return { value: teamHours(record, year, month) };
    }), "value");
  }

  function subcontractActualHours(row, year, month) {
    return num(row.actualHours && row.actualHours[String(year)] && row.actualHours[String(year)][String(month)]);
  }

  function subcontractHasHours(row, years) {
    return years.some(function(year) {
      return Array.from({ length: 12 }, function(_, index) {
        return subcontractPlanHours(row, year, index + 1) + subcontractActualHours(row, year, index + 1);
      }).some(function(value) { return value > 0; });
    }) || subcontractAmount(row, years) > 0;
  }

  function subcontractAmount(row, years, selectedPeriod) {
    if (selectedPeriod && selectedPeriod !== "all") {
      const parts = selectedPeriod.split("-");
      return years.includes(parts[0]) ? num(row.amountPlan && row.amountPlan[parts[0]] && row.amountPlan[parts[0]][parts[1]]) : 0;
    }
    return sum(years.flatMap(function(year) {
      return Array.from({ length: 12 }, function(_, index) {
        return { value: num(row.amountPlan && row.amountPlan[String(year)] && row.amountPlan[String(year)][String(index + 1)]) };
      });
    }), "value");
  }

  function subcontractHoursTotal(row, years, selectedPeriod, getter) {
    if (selectedPeriod && selectedPeriod !== "all") {
      const parts = selectedPeriod.split("-");
      return years.includes(parts[0]) ? getter(row, parts[0], Number(parts[1])) : 0;
    }
    return sum(years.flatMap(function(year) {
      return Array.from({ length: 12 }, function(_, index) { return { value: getter(row, year, index + 1) }; });
    }), "value");
  }

  function subcontractRate(row) {
    const uniqueRates = Array.from(new Set(row.rates.map(String)));
    if (!uniqueRates.length) return "—";
    if (uniqueRates.length === 1) return money(uniqueRates[0]) + "/ч";
    return "Разные";
  }

  function subcontractIdentityCells(row) {
    const resource = row.resource ? '<small class="resource-reference">Ресурс: ' + escapeHtml(row.resource) + '</small>' : "";
    return '<td>' + escapeHtml(row.vendor) + '</td><td><strong>' + escapeHtml(row.article) + '</strong>' + resource + '</td><td>' + escapeHtml(row.project) + '</td>';
  }

  function subcontractCostCell(row) {
    return '<td class="source-cost">' + teamCostMarkup(row.teamRecords || subcontractTeamRecords(row)) + '</td>';
  }

  function annualResourceCosts(records, years, hoursForRecord) {
    return (records || []).reduce(function(total, record) {
      years.forEach(function(year) {
        for (let month = 1; month <= 12; month += 1) {
          const values = teamCostValues(record, year, month);
          const hours = num(hoursForRecord(record, year, month));
          total.cost += values.rate * hours;
          total.attraction += values.attraction * hours;
        }
      });
      return total;
    }, { cost: 0, attraction: 0 });
  }

  function annualCostCells(values) {
    return '<td class="money-cell">' + money(values.cost) + '</td><td class="money-cell">' + money(values.attraction) + '</td>';
  }

  function subcontractAnnualCosts(row, years) {
    return annualResourceCosts(row.teamRecords || subcontractTeamRecords(row), years, function(record, year, month) { return teamHours(record, year, month); });
  }

  function subcontractActionCell(row) {
    const record = state.subcontractMonth === "all" ? null : row.recordsByPeriod[state.subcontractMonth];
    return record
      ? '<button class="edit-button" data-subcontract-id="' + escapeHtml(record.id) + '" type="button">Изменить</button>'
      : '<span class="table-action-note">Выберите месяц</span>';
  }

  function hoursPairCells(plan, actual, total) {
    return '<td class="hours-cell plan-hours' + (total ? " total-hours" : "") + '">' + integer(plan) + '</td><td class="hours-cell actual-hours' + (total ? " total-hours" : "") + '">' + integer(actual) + '</td>';
  }

  function subcontractTable(rows, year) {
    const monthGroups = teamMonthLabels.map(function(label) { return '<th colspan="2">' + label + '</th>'; }).join("");
    const hourHeaders = teamMonthLabels.map(function() { return '<th>План</th><th>Факт</th>'; }).join("");
    const body = rows.length ? rows.map(function(row) {
      const values = Array.from({ length: 12 }, function(_, index) {
        const month = index + 1;
        return hoursPairCells(subcontractPlanHours(row, year, month), subcontractActualHours(row, year, month), false);
      }).join("");
      return '<tr>' + subcontractIdentityCells(row) + subcontractCostCell(row) + annualCostCells(subcontractAnnualCosts(row, [year])) + values + hoursPairCells(subcontractHoursTotal(row, [year], "all", subcontractPlanHours), subcontractHoursTotal(row, [year], "all", subcontractActualHours), true) + '<td class="subcontract-actions">' + subcontractActionCell(row) + '</td></tr>';
    }).join("") : '<tr><td colspan="33">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="subcontract-hours-table"><thead><tr><th rowspan="2">Поставщик</th><th rowspan="2">Статья</th><th rowspan="2">Проект</th><th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость в год, ₽</th><th rowspan="2">Привлечение в год, ₽</th>' + monthGroups + '<th colspan="2">Итого</th><th rowspan="2"></th></tr><tr>' + hourHeaders + '<th>План</th><th>Факт</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function subcontractAllYearsTable(rows, years) {
    const yearBlocks = years.map(function(year) {
      const expanded = Boolean(state.expandedSubcontractYears[year]);
      return '<th class="team-year-group" colspan="' + (expanded ? 26 : 2) + '"><button class="year-expand-button" data-subcontract-year-expand="' + escapeHtml(year) + '" type="button" aria-expanded="' + expanded + '">' + escapeHtml(year) + '<span>' + (expanded ? "Свернуть" : "По месяцам") + '</span></button></th>';
    }).join("");
    const monthHeaders = years.map(function(year) {
      if (!state.expandedSubcontractYears[year]) return '<th>План</th><th>Факт</th>';
      return teamMonthLabels.map(function(label) { return '<th>' + label + ' · план</th><th>' + label + ' · факт</th>'; }).join("") + '<th>Итого · план</th><th>Итого · факт</th>';
    }).join("");
    const body = rows.length ? rows.map(function(row) {
      const values = years.map(function(year) {
        if (!state.expandedSubcontractYears[year]) return hoursPairCells(subcontractHoursTotal(row, [year], "all", subcontractPlanHours), subcontractHoursTotal(row, [year], "all", subcontractActualHours), true);
        const monthValues = Array.from({ length: 12 }, function(_, index) {
          const month = index + 1;
          return hoursPairCells(subcontractPlanHours(row, year, month), subcontractActualHours(row, year, month), false);
        }).join("");
        return monthValues + hoursPairCells(subcontractHoursTotal(row, [year], "all", subcontractPlanHours), subcontractHoursTotal(row, [year], "all", subcontractActualHours), true);
      }).join("");
      return '<tr>' + subcontractIdentityCells(row) + subcontractCostCell(row) + annualCostCells(subcontractAnnualCosts(row, years)) + values + '<td class="subcontract-actions">' + subcontractActionCell(row) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (7 + years.reduce(function(total, year) { return total + (state.expandedSubcontractYears[year] ? 26 : 2); }, 0)) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="subcontract-all-years-table"><thead><tr><th rowspan="2">Поставщик</th><th rowspan="2">Статья</th><th rowspan="2">Проект</th><th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость в год, ₽</th><th rowspan="2">Привлечение в год, ₽</th>' + yearBlocks + '<th rowspan="2"></th></tr><tr>' + monthHeaders + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function staffRecordsForContext(years) {
    return filterProject(state.staffRecords).map(function(record) {
      return Object.assign({}, record, { teamRecord: staffTeamRecord(record) });
    }).filter(function(record) {
      return record.teamRecord && staffHasHours(record, years);
    });
  }

  function staffIdentityCells(record) {
    return '<td><strong>' + escapeHtml(record.employee) + '</strong></td><td>' + escapeHtml(record.project) + '</td><td>' + escapeHtml(record.role) + '</td>';
  }

  function staffPlanHours(record, year, month) {
    const teamRecord = record.teamRecord || staffTeamRecord(record);
    return teamRecord ? teamHours(teamRecord, year, month) : 0;
  }

  function staffActualHours(record, year, month) {
    return num(record.hoursActual && record.hoursActual[String(year)] && record.hoursActual[String(year)][String(month)]);
  }

  function staffHoursTotal(record, years, getter) {
    return sum(years.flatMap(function(year) {
      return Array.from({ length: 12 }, function(_, index) { return { value: getter(record, year, index + 1) }; });
    }), "value");
  }

  function staffHasHours(record, years) {
    return staffHoursTotal(record, years, staffPlanHours) > 0 || staffHoursTotal(record, years, staffActualHours) > 0;
  }

  function staffActionCell(record) {
    return '<button class="edit-button" data-staff-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button>';
  }

  function staffCostCell(record) {
    const teamRecord = record.teamRecord || staffTeamRecord(record);
    return '<td class="source-cost">' + teamCostMarkup(teamRecord ? [teamRecord] : []) + '</td>';
  }

  function staffAnnualCosts(record, years) {
    const teamRecord = record.teamRecord || staffTeamRecord(record);
    return annualResourceCosts(teamRecord ? [teamRecord] : [], years, function(item, year, month) { return teamHours(item, year, month); });
  }

  function staffTable(records, year) {
    const monthGroups = teamMonthLabels.map(function(label) { return '<th colspan="2">' + label + '</th>'; }).join("");
    const hourHeaders = teamMonthLabels.map(function() { return '<th>План</th><th>Факт</th>'; }).join("");
    const body = records.length ? records.map(function(record) {
      const values = Array.from({ length: 12 }, function(_, index) {
        const month = index + 1;
        return hoursPairCells(staffPlanHours(record, year, month), staffActualHours(record, year, month), false);
      }).join("");
      return '<tr>' + staffIdentityCells(record) + values + hoursPairCells(staffHoursTotal(record, [year], staffPlanHours), staffHoursTotal(record, [year], staffActualHours), true) + staffCostCell(record) + annualCostCells(staffAnnualCosts(record, [year])) + '<td class="staff-actions">' + staffActionCell(record) + '</td></tr>';
    }).join("") : '<tr><td colspan="31">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="staff-hours-table"><thead><tr><th rowspan="2">Сотрудник</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th>' + monthGroups + '<th colspan="2">Итого</th><th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость в год, ₽</th><th rowspan="2">Привлечение в год, ₽</th><th rowspan="2"></th></tr><tr>' + hourHeaders + '<th>План</th><th>Факт</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function staffAllYearsTable(records, years) {
    const yearBlocks = years.map(function(year) {
      const expanded = Boolean(state.expandedStaffYears[year]);
      return '<th class="team-year-group" colspan="' + (expanded ? 26 : 2) + '"><button class="year-expand-button" data-staff-year-expand="' + escapeHtml(year) + '" type="button" aria-expanded="' + expanded + '">' + escapeHtml(year) + '<span>' + (expanded ? "Свернуть" : "По месяцам") + '</span></button></th>';
    }).join("");
    const monthHeaders = years.map(function(year) {
      if (!state.expandedStaffYears[year]) return '<th>План</th><th>Факт</th>';
      return teamMonthLabels.map(function(label) { return '<th>' + label + ' · план</th><th>' + label + ' · факт</th>'; }).join("") + '<th>Итого · план</th><th>Итого · факт</th>';
    }).join("");
    const body = records.length ? records.map(function(record) {
      const values = years.map(function(year) {
        if (!state.expandedStaffYears[year]) return hoursPairCells(staffHoursTotal(record, [year], staffPlanHours), staffHoursTotal(record, [year], staffActualHours), true);
        const monthValues = Array.from({ length: 12 }, function(_, index) {
          const month = index + 1;
          return hoursPairCells(staffPlanHours(record, year, month), staffActualHours(record, year, month), false);
        }).join("");
        return monthValues + hoursPairCells(staffHoursTotal(record, [year], staffPlanHours), staffHoursTotal(record, [year], staffActualHours), true);
      }).join("");
      return '<tr>' + staffIdentityCells(record) + values + staffCostCell(record) + annualCostCells(staffAnnualCosts(record, years)) + '<td class="staff-actions">' + staffActionCell(record) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (7 + years.reduce(function(total, year) { return total + (state.expandedStaffYears[year] ? 26 : 2); }, 0)) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="staff-all-years-table"><thead><tr><th rowspan="2">Сотрудник</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th>' + yearBlocks + '<th rowspan="2">Стоимость, ₽</th><th rowspan="2">Себестоимость в год, ₽</th><th rowspan="2">Привлечение в год, ₽</th><th rowspan="2"></th></tr><tr>' + monthHeaders + '</tr></thead><tbody>' + body + '</tbody></table></div>';
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
      ? '<button class="secondary-button compact-button" data-team-restore="' + escapeHtml(record.id) + '" type="button">Восстановить</button>'
      : '<button class="edit-button" data-team-edit="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-team-delete="' + escapeHtml(record.id) + '" type="button">Удалить</button>';
  }

  function teamIdentityCells(record) {
    return '<td><strong>' + escapeHtml(record.employee) + '</strong></td><td>' + escapeHtml(record.vendor || "—") + '</td><td>' + escapeHtml(record.project) + '</td><td>' + escapeHtml(record.role) + '</td>';
  }

  function teamTable(headers, records, year, archived) {
    return table(headers, records, function(record) {
      const plannedHours = Array.from({ length: 12 }, function(_, index) { return teamHours(record, year, index + 1); });
      return '<tr>' + teamIdentityCells(record) + plannedHours.map(function(value) { return '<td class="hours-cell">' + integer(value) + '</td>'; }).join("") + '<td class="hours-cell total-hours">' + integer(sum(plannedHours)) + '</td><td class="team-actions">' + teamActionCells(record, archived) + '</td></tr>';
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
    const body = records.length ? records.map(function(record) {
      const values = years.map(function(year) {
        if (!state.expandedTeamYears[year]) return '<td class="hours-cell total-hours">' + integer(teamYearTotal(record, year)) + '</td>';
        const monthValues = Array.from({ length: 12 }, function(_, index) { return teamHours(record, year, index + 1); });
        return monthValues.map(function(value) { return '<td class="hours-cell">' + integer(value) + '</td>'; }).join("") + '<td class="hours-cell total-hours">' + integer(sum(monthValues)) + '</td>';
      }).join("");
      return '<tr>' + teamIdentityCells(record) + values + '<td class="team-actions">' + teamActionCells(record, archived) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + (5 + years.reduce(function(total, year) { return total + (state.expandedTeamYears[year] ? 13 : 1); }, 0)) + '">' + empty("Нет строк для выбранного контекста.") + '</td></tr>';
    return '<div class="table-wrap"><table class="team-all-years-table"><thead><tr><th rowspan="2">Сотрудник / ресурс</th><th rowspan="2">Поставщик</th><th rowspan="2">Проект</th><th rowspan="2">Роль</th>' + yearBlocks + '<th rowspan="2"></th></tr><tr>' + monthHeaders + '</tr></thead><tbody>' + body + '</tbody></table></div>';
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
      '<div class="table-toolbar"><button id="add-team-record" class="primary-button" type="button">+ Новая запись</button></div>' +
      planTable +
      (archived.length ? '<details class="archive-details"><summary>Архивные записи · ' + integer(archived.length) + '</summary>' + archiveTable + '</details>' : "") +
      '</section>';
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
    const add = document.getElementById("add-team-record");
    if (add) add.addEventListener("click", function() { showTeamModal(null); });
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
    const details = state.references[directory] || { title: directory, records: [] };
    const active = referenceRecords(directory);
    const archived = referenceRecords(directory, true).filter(function(item) { return item.archived; });
    const parameter = directory === "parameters";
    const providerType = directory === "providers";
    const vendor = directory === "vendors";
    const resource = directory === "resources";
    const headers = parameter ? ["Параметр", "Значение", "Статус", ""] : (vendor ? ["Наименование", "Тип поставщика", "Статус", ""] : (resource ? ["Сотрудник / ресурс", "Поставщик", "Тип поставщика", "Статус", ""] : (providerType ? ["Тип поставщика", "Статус", ""] : ["Наименование", "Статус", ""])));
    const row = function(record, archivedRow) {
      const actions = archivedRow
        ? '<button class="edit-button" data-reference-edit="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="secondary-button compact-button" data-reference-restore="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Восстановить</button>'
        : '<button class="edit-button" data-reference-edit="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Изменить</button><button class="archive-button" data-reference-delete="' + escapeHtml(directory) + '" data-reference-id="' + escapeHtml(record.id) + '" type="button">Удалить</button>';
      const cells = '<td><strong>' + escapeHtml(record.name) + '</strong></td>' +
        (parameter ? '<td>' + escapeHtml(record.value) + '</td>' : "") +
        (vendor ? '<td>' + escapeHtml(record.providerType || "—") + '</td>' : "") +
        (resource ? '<td>' + escapeHtml(record.vendor || "—") + '</td><td>' + escapeHtml(record.providerType || "—") + '</td>' : "");
      return '<tr>' + cells + '<td><span class="status-chip ' + (archivedRow ? "archived" : "") + '">' + (archivedRow ? "Архив" : "Активна") + '</span></td><td class="reference-actions">' + actions + '</td></tr>';
    };
    const note = vendor ? "Поставщики выбираются в форме подрядной записи только из активных строк и имеют связанный тип."
      : (providerType ? "Плоский справочник типов поставщика: «Штат» и «Подряд»." : (resource ? "Каждый сотрудник или ресурс связан с поставщиком и доступен на вкладке 06." : "Создавайте и редактируйте записи справочника."));
    return '<article class="panel reference-directory">' + sectionTitle(details.title, note, integer(active.length)) +
      '<div class="table-toolbar"><button class="primary-button" data-reference-add="' + escapeHtml(directory) + '" type="button">+ Новая запись</button></div>' +
      table(headers, active, function(record) { return row(record, false); }) +
      (archived.length ? '<details class="archive-details"><summary>Архивные записи · ' + integer(archived.length) + '</summary>' + table(headers, archived, function(record) { return row(record, true); }) + '</details>' : "") +
      '</article>';
  }

  function renderReference() {
    const directories = state.referenceDirectory === "all" ? ["roles", "projects", "vendors", "providers", "resources", "parameters"] : [state.referenceDirectory];
    return '<section class="grid reference-grid">' + directories.map(function(directory) { return referenceDirectory(directory); }).join("") + '</section>' +
      '<section class="panel source-panel">' + sectionTitle("Соответствие структуры", "Названия разделов повторяют вкладки книги «Бюджетирование (новый)».") +
      '<div class="tab-pills">' + state.snapshot.tabs.map(function(tab, index) { return '<span><b>' + String(index + 1).padStart(2, "0") + '</b>' + escapeHtml(tab) + '</span>'; }).join("") + '</div></section>';
  }

  const renderers = [renderPipeline, renderIncome, renderCosts, renderSubcontracts, renderStaff, renderTeam, renderReference];

  function renderNavigation() {
    nav.innerHTML = state.snapshot.tabs.map(function(tab, index) {
      return '<button class="tab-link ' + (index === state.activeTab ? "active" : "") + '" type="button" data-tab="' + index + '"><b>' + String(index + 1).padStart(2, "0") + '</b><span>' + escapeHtml(tab) + '</span></button>';
    }).join("");
    nav.querySelectorAll("[data-tab]").forEach(function(button) {
      button.addEventListener("click", function() { state.activeTab = Number(button.dataset.tab); render(); });
    });
  }

  function render() {
    const title = state.snapshot.tabs[state.activeTab];
    pageTitle.textContent = title;
    pageSubtitle.textContent = subtitles[state.activeTab];
    renderNavigation();
    renderContextTabFilters();
    app.innerHTML = renderers[state.activeTab]();
    if (state.activeTab === 3) bindSubcontractControls();
    if (state.activeTab === 4) bindStaffControls();
    if (state.activeTab === 5) bindTeamControls();
    if (state.activeTab === 6) bindReferenceControls();
    setupResizableTables();
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
      state.subcontractMonth = "all";
      state.subcontractVendor = "all";
      state.teamRole = "all";
      state.teamEmployee = "all";
      state.referenceDirectory = "all";
      state.expandedSubcontractYears = {};
      state.expandedStaffYears = {};
      state.expandedTeamYears = {};
      state.subcontractPage = 1;
      yearFilter.value = "all";
      projectFilter.value = "all";
      render();
    });
  }

  async function boot() {
    try {
      await refreshReferenceData();
      status.textContent = state.snapshot.source.dataWorkbook + " · на " + state.snapshot.source.asOf;
      populateFilters();
      render();
    } catch (error) {
      app.innerHTML = '<section class="error-card"><h2>Снимок модели недоступен</h2><p>' + escapeHtml(error.message) + '</p><p>Проверьте, что файл <code>data/model-snapshot.json</code> находится рядом с сервером.</p></section>';
    }
  }

  boot();
}());
