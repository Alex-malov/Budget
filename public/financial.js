(function () {
  "use strict";

  const VAT_RATES = [0, 5, 7, 10, 22];
  const RATE_NAMES = { profitTax: "Налог на прибыль", overdraft: "Овердрафт", directorate: "Дирекция" };

  function create(api) {
    const formulas = window.BudgetFinancialFormulas;
    const state = api.state;
    const text = api.escapeHtml;
    const money = api.money;
    const percent = api.percent;
    const number = api.num;
    const months = api.fullMonthLabels;

    function projects(includeArchived) {
      return api.referenceRecords("projects", includeArchived).filter(function (item) { return item.code; });
    }

    function projectByCode(code) {
      const normalized = String(code || "").toUpperCase();
      return projects(true).find(function (item) { return String(item.code || "").toUpperCase() === normalized; }) || null;
    }

    function projectLabel(code) {
      const project = projectByCode(code);
      return project ? project.code + " — " + project.name : (code || "Код не назначен");
    }

    function ensureFilters() {
      if (!state.financeYears || !state.financeYears.length) state.financeYears = [String(api.currentYear())];
      const activeCodes = projects().map(function (item) { return item.code; });
      state.financeYears = state.financeYears.filter(function (year) { return /^\d{4}$/.test(String(year)); });
      if (!state.financeYears.length) state.financeYears = [String(api.currentYear())];
      state.financeProjects = (state.financeProjects || []).filter(function (code) { return activeCodes.includes(code); });
    }

    function selectedYears() {
      ensureFilters();
      return state.financeYears.slice().sort(function (left, right) { return Number(left) - Number(right); });
    }

    function selectedCodes() {
      ensureFilters();
      return state.financeProjects.length ? state.financeProjects.slice() : projects().map(function (item) { return item.code; });
    }

    function selectedProjectText() {
      return state.financeProjects.length ? state.financeProjects.map(projectLabel).join(", ") : "Все проекты";
    }

    function periodLabel(period) {
      const parts = String(period || "").split("-");
      return parts.length === 2 ? months[Number(parts[1]) - 1] + " " + parts[0] : period;
    }

    function allModelYears() {
      const years = new Set((state.snapshot && state.snapshot.finance && state.snapshot.finance.years || []).map(String));
      selectedYears().forEach(function (year) { years.add(year); });
      return Array.from(years).sort(function (left, right) { return Number(left) - Number(right); });
    }

    function rateFor(kind, projectCode, year) {
      const target = String(year);
      const project = projectByCode(projectCode);
      const name = project && project.name || "";
      const match = api.referenceRecords("financialRates", true).find(function (record) {
        if (record.archived || record.financialKind !== kind) return false;
        const range = String(record.year || "").split("-");
        const active = range.length === 2 ? Number(target) >= Number(range[0]) && Number(target) <= Number(range[1]) : String(record.year) === target;
        if (!active) return false;
        return kind === "directorate" ? record.project === name : !record.project;
      });
      return match && Number.isFinite(Number(match.rate)) ? { value: Number(match.rate) / 100, record: match } : null;
    }

    function costForHours(resource, hours, vatRate, vatKnown) {
      const cost = number(resource.rate) * number(hours);
      const attraction = number(resource.attraction) * number(hours);
      const base = cost + attraction;
      const valid = !number(hours) || vatKnown;
      return {
        base: base,
        resourceCost: cost,
        attraction: attraction,
        vat: valid ? base * number(vatRate) : null,
        gross: valid ? base * (1 + number(vatRate)) : null,
        known: valid
      };
    }

    function accruals() {
      const result = [];
      const years = allModelYears();
      state.teamRecords.filter(function (item) { return !item.archived && item.project; }).forEach(function (resource) {
        const project = projects(true).find(function (item) { return item.name === resource.project; });
        if (!project || !project.code) return;
        years.forEach(function (year) {
          for (let month = 1; month <= 12; month += 1) {
            const period = year + "-" + String(month).padStart(2, "0");
            const rate = api.teamCostValues(resource, year, month);
            const contractor = resource.source === "Подряд";
            const vat = contractor ? api.vendorVatRate(resource.vendor, year, month) : { value: 0, known: true };
            const planHours = api.teamHours(resource, year, month);
            const factHours = contractor ? api.costContractorActualHours(resource, year, month) : api.costStaffActualHours(resource, year, month);
            ["plan", "fact"].forEach(function (scenario) {
              const hours = scenario === "plan" ? planHours : factHours;
              if (!hours) return;
              const values = costForHours(rate, hours, vat.value, vat.known);
              result.push({
                id: "resource:" + resource.id + ":" + scenario + ":" + period,
                type: contractor ? "resource" : "staff",
                scenario: scenario,
                projectCode: project.code,
                project: project.name,
                period: period,
                contractor: contractor ? resource.vendor : "Штат",
                resource: resource.employee,
                hours: hours,
                rate: number(rate.rate),
                attraction: number(rate.attraction),
                vatRate: vat.known ? number(vat.value) : null,
                base: values.base,
                resourceCost: values.resourceCost,
                attractionCost: values.attraction,
                vat: values.vat,
                gross: values.gross,
                known: values.known
              });
            });
          }
        });
      });
      state.otherSubcontractRecords.filter(function (item) { return !item.archived; }).forEach(function (record) {
        const project = projects(true).find(function (item) { return item.name === record.project; });
        if (!project || !project.code) return;
        years.forEach(function (year) {
          for (let month = 1; month <= 12; month += 1) {
            const period = year + "-" + String(month).padStart(2, "0");
            ["plan", "fact"].forEach(function (scenario) {
              const values = api.otherSubcontractAmounts(record, scenario, year, [month]);
              if (!values.known && !values.sum) return;
              result.push({
                id: "other:" + record.id + ":" + scenario + ":" + period,
                type: "other",
                scenario: scenario,
                projectCode: project.code,
                project: project.name,
                period: period,
                contractor: record.otherSubcontract,
                resource: "",
                hours: null,
                rate: null,
                attraction: null,
                vatRate: values.sum ? values.vat / values.sum : 0,
                base: values.sum,
                resourceCost: 0,
                attractionCost: 0,
                vat: values.vat,
                gross: values.cost,
                known: values.known
              });
            });
          }
        });
      });
      return result;
    }

    function events(kind) {
      return (state.financial && state.financial[kind] || []).filter(function (item) { return !item.archived; });
    }

    function matches(item, code, year, scenario) {
      return (!code || item.projectCode === code) && (!year || String(item.period || "").startsWith(String(year) + "-")) && (!scenario || item.scenario === scenario);
    }

    function sum(items, field) {
      return items.reduce(function (total, item) { return total + number(item[field]); }, 0);
    }

    function collectScenario(code, year, scenario) {
      const income = events("incomes").filter(function (item) { return matches(item, code, year, scenario); });
      const accrual = accruals().filter(function (item) { return matches(item, code, year, scenario); });
      const payment = events("payments").filter(function (item) { return matches(item, code, year, scenario); });
      const other = accrual.filter(function (item) { return item.type === "other"; });
      const contractor = accrual.filter(function (item) { return item.type === "resource"; });
      const staff = accrual.filter(function (item) { return item.type === "staff"; });
      const grossIncome = sum(income, "gross");
      const outputVat = sum(income, "vat");
      const otherGross = sum(other, "gross");
      const contractorGross = sum(contractor, "gross");
      const staffCost = sum(staff, "resourceCost");
      const staffAttraction = sum(staff, "attractionCost");
      const inputVat = sum(other, "vat") + sum(contractor, "vat");
      const taxRate = rateFor("profitTax", code, year);
      const directorateRate = rateFor("directorate", code, year);
      const calculated = formulas.summary({ income: grossIncome, outputVat: outputVat, otherGross: otherGross, contractorGross: contractorGross, staffCost: staffCost, staffAttraction: staffAttraction, inputVat: inputVat, taxRate: taxRate && taxRate.value, directorateRate: directorateRate && directorateRate.value, overdraftCost: 0 });
      const cashPayments = sum(payment, "gross") + staffCost;
      return Object.assign({}, calculated, {
        cashPayments: cashPayments, incomeEvents: income, accruals: accrual, payments: payment,
        taxRate: taxRate, directorateRate: directorateRate
      });
    }

    function addMetric(target, source) {
      Object.keys(source).forEach(function (key) {
        if (typeof source[key] === "number") target[key] = number(target[key]) + source[key];
      });
      return target;
    }

    function calculate() {
      const total = {};
      const slices = [];
      selectedCodes().forEach(function (code) {
        selectedYears().forEach(function (year) {
          ["plan", "fact"].forEach(function (scenario) {
            const value = collectScenario(code, year, scenario);
            slices.push({ code: code, year: year, scenario: scenario, value: value });
            if (!total[scenario]) total[scenario] = {};
            addMetric(total[scenario], value);
          });
        });
      });
      ["plan", "fact"].forEach(function (scenario) {
        const value = total[scenario] || {};
        let balance = 0;
        let previousNeed = 0;
        let overdraftCost = 0;
        const cash = [];
        selectedYears().forEach(function (year) {
          const yearlyOverdraftRate = rateFor("overdraft", "", year);
          for (let month = 1; month <= 12; month += 1) {
            const period = year + "-" + String(month).padStart(2, "0");
            const periodSlices = slices.filter(function (item) { return item.scenario === scenario && item.year === year; }).map(function (item) { return item.value; });
            const incoming = periodSlices.reduce(function (amount, item) { return amount + sum(item.incomeEvents.filter(function (event) { return event.period === period; }), "gross"); }, 0);
            const payments = periodSlices.reduce(function (amount, item) {
              const contractors = sum(item.payments.filter(function (event) { return event.period === period; }), "gross");
              const staff = sum(item.accruals.filter(function (event) { return event.type === "staff" && event.period === period; }), "resourceCost");
              return amount + contractors + staff;
            }, 0);
            balance += incoming - payments;
            const need = Math.max(0, -balance);
            const days = new Date(Number(year), month, 0).getDate();
            const interest = yearlyOverdraftRate ? ((previousNeed + need) / 2) * yearlyOverdraftRate.value * days / 365 : 0;
            overdraftCost += interest;
            cash.push({ period: period, income: incoming, payments: payments, balance: balance, need: need, interest: interest, overdraftRate: yearlyOverdraftRate ? yearlyOverdraftRate.value : null });
            previousNeed = need;
          }
        });
        value.overdraftCost = overdraftCost;
        value.maxOverdraft = cash.reduce(function (maximum, item) { return Math.max(maximum, item.need); }, 0);
        value.endOverdraft = previousNeed;
        value.cash = cash;
        value.overdraftRate = rateFor("overdraft", "", selectedYears()[0]);
        value.dks = value.net == null || value.directorate == null ? null : value.net - value.investment - value.directorate - value.staffAttraction - overdraftCost;
        value.profitability = value.net == null || !(value.income - value.outputVat) ? null : value.net / (value.income - value.outputVat);
        value.taxBurden = !value.income || value.profitTax == null ? null : (value.vatTotal + value.profitTax) / value.income;
      });
      return { plan: total.plan || {}, fact: total.fact || {}, slices: slices };
    }

    function delta(plan, fact) {
      const value = number(fact) - number(plan);
      return { value: value, percent: number(plan) ? value / number(plan) : null };
    }

    function financeCell(plan, fact, metric, label, details) {
      const p = plan[metric];
      const f = fact[metric];
      if (p == null || f == null) return '<td class="financial-cell is-not-calculated"><strong>Не рассчитано</strong><span>Нет обязательной ставки</span></td>';
      const change = delta(p, f);
      const hint = label + "\nФормула: " + details + "\nПлан: " + money(p) + "; Факт: " + money(f) + "; Отклонение: " + money(change.value) + ".\nКонтекст: " + selectedProjectText() + " · " + selectedYears().join(", ") + ".";
      return '<td class="financial-cell" tabindex="0"><strong>' + money(f) + '</strong><span>План ' + money(p) + '</span><small>Δ ' + (change.value > 0 ? "+" : "") + money(change.value) + ' · ' + percent(change.percent) + '</small><button type="button" class="formula-help" data-finance-help="' + text(hint) + '" aria-label="Пояснение расчёта «' + text(label) + '»">?</button></td>';
    }

    function modal(title, html) {
      document.getElementById("finance-modal") && document.getElementById("finance-modal").remove();
      const backdrop = document.createElement("div");
      backdrop.id = "finance-modal";
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = '<section class="modal finance-modal" role="dialog" aria-modal="true" aria-labelledby="finance-modal-title"><div class="modal-header"><div><p class="eyebrow">Финансовый контур</p><h2 id="finance-modal-title">' + text(title) + '</h2></div><button class="close-button" type="button" aria-label="Закрыть">×</button></div>' + html + '</section>';
      document.body.appendChild(backdrop);
      const close = function () { backdrop.remove(); };
      backdrop.querySelector(".close-button").addEventListener("click", close);
      backdrop.addEventListener("click", function (event) { if (event.target === backdrop) close(); });
      const onKeyDown = function (event) { if (event.key === "Escape") { close(); document.removeEventListener("keydown", onKeyDown); } };
      document.addEventListener("keydown", onKeyDown);
      return backdrop;
    }

    function projectOptions(selected) {
      return '<option value="">Выберите проект</option>' + projects().map(function (item) {
        return '<option value="' + text(item.code) + '"' + (item.code === selected ? " selected" : "") + '>' + text(item.code + " — " + item.name) + '</option>';
      }).join("");
    }

    function rateProjectOptions(selected) {
      return '<option value="">Все проекты</option>' + projects().map(function (item) {
        return '<option value="' + text(item.name) + '"' + (item.name === selected ? " selected" : "") + '>' + text(item.code + " — " + item.name) + '</option>';
      }).join("");
    }

    function incomeForm(record) {
      const item = record || { projectCode: "", scenario: "plan", period: selectedYears()[0] + "-01", gross: "", vatRate: 22, comment: "" };
      const backdrop = modal(record ? "Редактировать поступление" : "Новое поступление", '<form id="finance-income-form"><div class="form-grid"><label>Проект <b>*</b><select name="projectCode">' + projectOptions(item.projectCode) + '</select><small data-error="projectCode"></small></label><label>Сценарий <b>*</b><select name="scenario"><option value="plan"' + (item.scenario === "plan" ? " selected" : "") + '>План</option><option value="fact"' + (item.scenario === "fact" ? " selected" : "") + '>Факт</option></select></label><label>Месяц <b>*</b><input name="period" type="month" value="' + text(item.period) + '"></label><label>Поступление с НДС, ₽ <b>*</b><input name="gross" type="number" min="0" step="0.01" value="' + text(item.gross) + '"></label><label>Ставка НДС <b>*</b><select name="vatRate">' + VAT_RATES.map(function (rate) { return '<option value="' + rate + '"' + (Number(item.vatRate) === rate ? " selected" : "") + '>' + rate + '%</option>'; }).join("") + '</select></label><label>НДС<input name="vat" class="calculated-field" readonly></label><label class="form-wide">Комментарий<textarea name="comment" rows="3">' + text(item.comment || "") + '</textarea></label></div><p class="form-note" data-finance-formula></p><div class="form-actions"><button class="secondary-button" data-close type="button">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div></form>');
      const form = backdrop.querySelector("form");
      const showVat = function () {
        const gross = number(form.elements.gross.value);
        const rate = number(form.elements.vatRate.value);
        const vat = gross * rate / (100 + rate);
        form.elements.vat.value = money(vat);
        form.querySelector("[data-finance-formula]").textContent = "НДС = Поступление с НДС × ставка / (100 + ставка): " + gross + " × " + rate + " / " + (100 + rate) + " = " + money(vat) + ". Ставка сохраняется снимком события.";
      };
      form.elements.gross.addEventListener("input", showVat); form.elements.vatRate.addEventListener("change", showVat); showVat();
      form.querySelector("[data-close]").addEventListener("click", function () { backdrop.remove(); });
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(form).entries()); body.gross = number(body.gross); body.vatRate = number(body.vatRate);
        await saveEvent("incomes", record, body, form, backdrop);
      });
    }

    function contractorOptions(source, selected) {
      const directory = source === "other" ? "otherSubcontracts" : "vendors";
      return '<option value="">Выберите значение</option>' + api.referenceRecords(directory).map(function (item) {
        return '<option value="' + text(item.name) + '"' + (item.name === selected ? " selected" : "") + '>' + text(item.name) + '</option>';
      }).join("");
    }

    function paymentForm(record) {
      const item = record || { projectCode: "", scenario: "plan", period: selectedYears()[0] + "-01", gross: "", vatRate: 22, source: "resource", contractor: "", allocations: [], comment: "" };
      const backdrop = modal(record ? "Редактировать оплату" : "Новая оплата подрядчику", '<form id="finance-payment-form"><div class="form-grid"><label>Вид <b>*</b><select name="scenario"><option value="plan"' + (item.scenario === "plan" ? " selected" : "") + '>План оплаты</option><option value="fact"' + (item.scenario === "fact" ? " selected" : "") + '>Факт оплаты</option></select></label><label>Проект <b>*</b><select name="projectCode">' + projectOptions(item.projectCode) + '</select><small data-error="projectCode"></small></label><label>Источник <b>*</b><select name="source"><option value="resource"' + (item.source === "resource" ? " selected" : "") + '>Ресурсный подряд</option><option value="other"' + (item.source === "other" ? " selected" : "") + '>Прочий подряд</option></select></label><label>Подрядчик / статья <b>*</b><select name="contractor"></select><small data-error="contractor"></small></label><label>Месяц оплаты <b>*</b><input name="period" type="month" value="' + text(item.period) + '"></label><label>Оплачено с НДС, ₽ <b>*</b><input name="gross" type="number" min="0" step="0.01" value="' + text(item.gross) + '"></label><label>Ставка НДС <b>*</b><select name="vatRate">' + VAT_RATES.map(function (rate) { return '<option value="' + rate + '"' + (Number(item.vatRate) === rate ? " selected" : "") + '>' + rate + '%</option>'; }).join("") + '</select></label><label>Дата документа<input name="documentDate" type="date" value="' + text(item.documentDate || "") + '"></label><label>Номер документа<input name="documentNumber" value="' + text(item.documentNumber || "") + '"></label><label class="form-wide">Комментарий<textarea name="comment" rows="2">' + text(item.comment || "") + '</textarea></label></div><section class="finance-allocation"><div><strong>Распределение по начислениям</strong><span>Не распределённая сумма считается авансом</span></div><div data-allocation-rows></div><button type="button" class="secondary-button compact-button" data-add-allocation>+ Добавить распределение</button><small data-error="allocations"></small></section><div class="form-actions"><button class="secondary-button" data-close type="button">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div></form>');
      const form = backdrop.querySelector("form");
      const rows = form.querySelector("[data-allocation-rows]");
      const rebuildContractors = function () {
        const previous = form.elements.contractor.value || item.contractor;
        form.elements.contractor.innerHTML = contractorOptions(form.elements.source.value, previous);
        rebuildAllocations();
      };
      const addAllocation = function (allocation) {
        const source = form.elements.source.value;
        const code = form.elements.projectCode.value;
        const scenario = form.elements.scenario.value;
        const options = accruals().filter(function (accrual) { return accrual.type === source && accrual.projectCode === code && accrual.scenario === scenario; }).map(function (accrual) {
          return '<option value="' + text(accrual.id) + '"' + (allocation && allocation.accrualId === accrual.id ? " selected" : "") + '>' + text(periodLabel(accrual.period) + " · " + accrual.contractor + " · " + money(accrual.gross)) + '</option>';
        }).join("");
        rows.insertAdjacentHTML("beforeend", '<div class="allocation-row"><select data-allocation-id><option value="">Не распределять</option>' + options + '</select><input data-allocation-amount type="number" min="0" step="0.01" value="' + text(allocation && allocation.amount || "") + '" placeholder="Сумма, ₽"><button type="button" class="text-button" data-remove-allocation>Убрать</button></div>');
      };
      const rebuildAllocations = function () { rows.innerHTML = ""; const values = item.allocations && item.allocations.length ? item.allocations : []; (values.length ? values : [null]).forEach(addAllocation); };
      form.elements.source.addEventListener("change", rebuildContractors); form.elements.projectCode.addEventListener("change", rebuildAllocations); form.elements.scenario.addEventListener("change", rebuildAllocations);
      form.querySelector("[data-add-allocation]").addEventListener("click", function () { addAllocation(null); });
      rows.addEventListener("click", function (event) { const button = event.target.closest("[data-remove-allocation]"); if (button) button.closest(".allocation-row").remove(); });
      rebuildContractors();
      form.querySelector("[data-close]").addEventListener("click", function () { backdrop.remove(); });
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(form).entries());
        body.gross = number(body.gross); body.vatRate = number(body.vatRate);
        body.allocations = Array.from(rows.querySelectorAll(".allocation-row")).map(function (row) { return { accrualId: row.querySelector("[data-allocation-id]").value, amount: number(row.querySelector("[data-allocation-amount]").value) }; }).filter(function (item) { return item.accrualId || item.amount; });
        await saveEvent("payments", record, body, form, backdrop);
      });
    }

    async function saveEvent(collection, record, body, form, backdrop) {
      form.querySelectorAll("[data-error]").forEach(function (target) { target.textContent = ""; });
      const response = await fetch("/api/financial/" + collection + (record ? "/" + encodeURIComponent(record.id) : ""), { method: record ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) {
        Object.keys(payload.fields || {}).forEach(function (field) { const target = form.querySelector('[data-error="' + field + '"]'); if (target) target.textContent = payload.fields[field]; });
        if (!payload.fields) window.alert(payload.error || "Не удалось сохранить событие.");
        return;
      }
      await api.refresh(); backdrop.remove(); api.render();
    }

    async function archiveEvent(collection, record) {
      if (!window.confirm("Переместить финансовое событие в архив?")) return;
      const response = await fetch("/api/financial/" + collection + "/" + encodeURIComponent(record.id), { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) { window.alert(payload.error || "Не удалось архивировать событие."); return; }
      await api.refresh(); api.render();
    }

    function incomeGroups() {
      const groups = {};
      events("incomes").filter(function (item) { return selectedYears().includes(item.period.slice(0, 4)) && selectedCodes().includes(item.projectCode); }).forEach(function (item) {
        const key = item.period.slice(0, 4) + "|" + item.projectCode + "|" + item.period;
        if (!groups[key]) groups[key] = { year: item.period.slice(0, 4), code: item.projectCode, period: item.period, plan: [], fact: [] };
        groups[key][item.scenario].push(item);
      });
      return Object.values(groups).sort(function (left, right) { return (left.year + left.code + left.period).localeCompare(right.year + right.code + right.period); });
    }

    function eventCell(items) {
      const gross = sum(items, "gross"); const vat = sum(items, "vat");
      const comments = items.filter(function (item) { return item.comment; });
      return '<div class="event-total"><strong>' + money(gross) + '</strong><span>НДС ' + money(vat) + ' · ×' + items.length + '</span>' + (comments.length ? '<button class="formula-help" type="button" data-finance-help="' + text(comments.map(function (item) { return periodLabel(item.period) + " · " + money(item.gross) + " · " + item.comment; }).join("\n")) + '">💬</button>' : "") + '</div>';
    }

    function renderIncome() {
      ensureFilters();
      const grouped = incomeGroups();
      const totalPlan = sum(events("incomes").filter(function (item) { return item.scenario === "plan" && selectedYears().includes(item.period.slice(0, 4)) && selectedCodes().includes(item.projectCode); }), "gross");
      const totalFact = sum(events("incomes").filter(function (item) { return item.scenario === "fact" && selectedYears().includes(item.period.slice(0, 4)) && selectedCodes().includes(item.projectCode); }), "gross");
      const body = grouped.map(function (group) {
        const plan = sum(group.plan, "gross"), fact = sum(group.fact, "gross"), diff = delta(plan, fact);
        const eventRows = group.plan.concat(group.fact).map(function (item) { return '<li><b>' + (item.scenario === "plan" ? "План" : "Факт") + '</b> · ' + money(item.gross) + ' · НДС ' + money(item.vat) + (item.comment ? ' · ' + text(item.comment) : "") + '<span><button type="button" class="text-button" data-income-edit="' + text(item.id) + '">Изменить</button><button type="button" class="text-button" data-income-delete="' + text(item.id) + '">Архив</button></span></li>'; }).join("");
        return '<tr><td><details><summary><b>' + text(group.year + " · " + projectLabel(group.code)) + '</b><br><small>' + text(periodLabel(group.period)) + '</small></summary><ul class="finance-event-list">' + eventRows + '</ul></details></td><td>' + eventCell(group.plan) + '</td><td>' + eventCell(group.fact) + '</td><td>' + (fact || plan ? (diff.value > 0 ? "+" : "") + money(diff.value) + " · " + percent(diff.percent) : "—") + '</td></tr>';
      }).join("") || '<tr><td colspan="4">Нет поступлений по выбранному срезу.</td></tr>';
      return '<section class="metric-grid compact"><article class="metric-card blue"><span>Поступления · план</span><strong>' + money(totalPlan) + '</strong><small>с НДС</small></article><article class="metric-card violet"><span>Поступления · факт</span><strong>' + money(totalFact) + '</strong><small>с НДС</small></article><article class="metric-card cyan"><span>Отклонение</span><strong>' + money(totalFact - totalPlan) + '</strong><small>Факт − План</small></article></section><section class="panel finance-income"><div class="section-heading"><div><h2>Доходы</h2><p>Независимые денежные события Плана и Факта. НДС рассчитывается и сохраняется снимком события.</p></div><button id="add-finance-income" class="primary-button" type="button">+ Поступление</button></div><div class="table-wrap"><table><thead><tr><th>Год / проект / месяц</th><th>План</th><th>Факт</th><th>Отклонение</th></tr></thead><tbody>' + body + '</tbody><tfoot><tr><th>Итого по фильтру</th><th>' + money(totalPlan) + '</th><th>' + money(totalFact) + '</th><th>' + money(totalFact - totalPlan) + '</th></tr></tfoot></table></div></section>';
    }

    function planFactRows(model) {
      const rows = [
        ["Поступления с НДС · Д+(+НДС)", "income", "Σ поступлений с НДС"], ["НДС поступлений · (+НДС)", "outputVat", "Σ НДС поступлений"], ["Расходы с НДС · Р+(-НДС)", "expenses", "Прочий подряд с НДС + ресурсный подряд с НДС + себестоимость штата"], ["НДС расходов · (-НДС)", "inputVat", "НДС прочего и ресурсного подряда"], ["Прибыль всего с НДС", "profitGross", "Поступления с НДС − расходы с НДС"], ["НДС всего", "vatTotal", "НДС поступлений − НДС расходов"], ["Прибыль до налога", "beforeTax", "Прибыль всего с НДС − НДС всего"], ["Налог на прибыль", "profitTax", "max(0; прибыль до налога) × финансовая ставка"], ["Чистая прибыль", "net", "Прибыль до налога − налог на прибыль"], ["Инвестирование", "investment", "(Поступления с НДС − прочий подряд с НДС) × 10%"], ["Дирекция", "directorate", "(Поступления с НДС − прочий подряд с НДС − инвестирование) × ставка дирекции"], ["Распределение ЛТ", "staffAttraction", "Σ привлечение штатных ресурсов × часы; не входит в расходы"], ["Стоимость овердрафта", "overdraftCost", "Средняя задолженность × годовая ставка × дни / 365"], ["Остаток ДКС после распределения", "dks", "Чистая прибыль − инвестирование − дирекция − распределение ЛТ − стоимость овердрафта"]
      ];
      return rows.map(function (item) { return '<tr><th>' + text(item[0]) + '<button type="button" class="formula-help" data-finance-help="' + text(item[2]) + '">?</button></th>' + financeCell(model.plan, model.fact, item[1], item[0], item[2]) + '</tr>'; }).join("");
    }

    function renderPlanFact() {
      ensureFilters();
      const model = calculate();
      const plan = model.plan, fact = model.fact;
      const cash = fact.cash || [];
      const paymentPlanMissing = model.slices.some(function (slice) { return slice.scenario === "plan" && slice.value.accruals.some(function (item) { return item.type !== "staff"; }) && !slice.value.payments.length; });
      const cashRows = cash.map(function (item) { return '<tr><td>' + text(periodLabel(item.period)) + '</td><td>' + money(item.income) + '</td><td>' + money(item.payments) + '</td><td>' + money(item.balance) + '</td><td>' + money(item.need) + '</td></tr>'; }).join("") || '<tr><td colspan="5">Нет данных денежного потока.</td></tr>';
      return '<section class="finance-context-note"><b>Срез:</b> ' + text(selectedProjectText() + " · " + selectedYears().join(", ")) + '</section>' + (paymentPlanMissing ? '<div class="finance-warning">План оплаты не задан: начисления не переносятся в денежный поток автоматически.</div>' : "") + '<section class="metric-grid finance-kpi"><article class="metric-card blue"><span>Чистая прибыль · факт</span><strong>' + (fact.net == null ? "Не рассчитано" : money(fact.net, true)) + '</strong><small>после НДС и налога</small></article><article class="metric-card violet"><span>Рентабельность</span><strong>' + percent(fact.profitability) + '</strong><small>чистая прибыль / поступления без НДС</small></article><article class="metric-card amber"><span>Макс. овердрафт</span><strong>' + money(fact.maxOverdraft, true) + '</strong><small>моментная потребность</small></article><article class="metric-card cyan"><span>Остаток ДКС</span><strong>' + (fact.dks == null ? "Не рассчитано" : money(fact.dks, true)) + '</strong><small>после распределения</small></article></section><section class="panel"><div class="section-heading"><div><h2>Финансовый план-факт</h2><p>План, факт и отклонение рассчитываются на месячном уровне, затем агрегируются. Первичные записи редактируются только в реестрах.</p></div></div><div class="table-wrap"><table class="finance-matrix"><thead><tr><th>Показатель</th><th>План / Факт / Δ</th></tr></thead><tbody>' + planFactRows(model) + '</tbody></table></div></section><section class="grid two"><article class="panel"><div class="section-heading"><div><h2>Денежный поток · факт</h2><p>Поступления и реальные оплаты; штат оплачивается в месяце работ.</p></div></div><div class="table-wrap"><table><thead><tr><th>Месяц</th><th>Поступления</th><th>Выплаты</th><th>Остаток</th><th>Овердрафт</th></tr></thead><tbody>' + cashRows + '</tbody></table></div></article><article class="panel"><div class="section-heading"><div><h2>Контроль формул</h2><p>Подсказка «?» у каждого показателя раскрывает смысл, формулу, источники и применённый срез.</p></div></div><ul class="finance-check-list"><li>Расходы включают прочий подряд, ресурсный подряд и себестоимость штата.</li><li>Привлечение штата показывается отдельно как «Распределение ЛТ».</li><li>НДС не добавляется повторно к gross-показателям.</li><li>Тело овердрафта не включается в прибыль.</li></ul></article></section>';
    }

    function modeToolbar(scope, mode) {
      const title = scope === "other" ? "Прочий подряд" : "Суммы и часы подряд";
      const value = scope === "other" ? state.financeOtherMode : state.financeContractorMode;
      return '<section class="finance-mode-toolbar" aria-label="Режим финансового контура ' + text(title) + '"><b>' + text(title) + '</b><div role="group"><button type="button" data-finance-mode="' + mode + ':work" class="' + (value === "work" ? "active" : "") + '">Работы / начисления</button><button type="button" data-finance-mode="' + mode + ':payments" class="' + (value === "payments" ? "active" : "") + '">Оплаты</button><button type="button" data-finance-mode="' + mode + ':reconciliation" class="' + (value === "reconciliation" ? "active" : "") + '">Сверка</button></div></section>';
    }

    function contractorToolbar() { return modeToolbar("resource", "resource"); }
    function otherToolbar() { return modeToolbar("other", "other"); }

    function paymentRows(source) {
      return events("payments").filter(function (item) { return item.source === source && selectedYears().includes(item.period.slice(0, 4)) && selectedCodes().includes(item.projectCode); });
    }

    function renderPayments(source) {
      const payments = paymentRows(source);
      const body = payments.map(function (item) {
        const allocated = sum(item.allocations || [], "amount");
        return '<tr><td>' + text(projectLabel(item.projectCode)) + '</td><td>' + text(item.scenario === "plan" ? "План оплаты" : "Факт оплаты") + '</td><td>' + text(periodLabel(item.period)) + '</td><td>' + text(item.contractor) + '</td><td>' + money(item.gross) + '<small>НДС ' + money(item.vat) + '</small></td><td>' + money(allocated) + '<small>' + (item.gross - allocated > 0 ? "Аванс " + money(item.gross - allocated) : "Распределено") + '</small></td><td><button class="text-button" type="button" data-payment-edit="' + text(item.id) + '">Изменить</button><button class="text-button" type="button" data-payment-delete="' + text(item.id) + '">Архив</button></td></tr>';
      }).join("") || '<tr><td colspan="7">Оплат по выбранному срезу нет.</td></tr>';
      return '<section class="panel"><div class="section-heading"><div><h2>Оплаты подрядчикам</h2><p>Месяц оплаты участвует в денежном потоке. Он не меняет месяц работ и не увеличивает расходы второй раз.</p></div><button id="add-finance-payment" class="primary-button" type="button">+ Оплата</button></div><div class="table-wrap"><table><thead><tr><th>Проект</th><th>Вид</th><th>Месяц оплаты</th><th>Подрядчик / статья</th><th>Сумма</th><th>Распределение</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
    }

    function reconciliationRows(source) {
      const rows = {};
      accruals().filter(function (item) { return item.type === source && item.scenario === "fact" && selectedYears().includes(item.period.slice(0, 4)) && selectedCodes().includes(item.projectCode); }).forEach(function (item) {
        const key = item.projectCode + "|" + item.contractor;
        if (!rows[key]) rows[key] = { projectCode: item.projectCode, contractor: item.contractor, accrued: 0, paid: 0, unallocated: 0 };
        rows[key].accrued += number(item.gross);
      });
      paymentRows(source).filter(function (item) { return item.scenario === "fact"; }).forEach(function (item) {
        const key = item.projectCode + "|" + item.contractor;
        if (!rows[key]) rows[key] = { projectCode: item.projectCode, contractor: item.contractor, accrued: 0, paid: 0, unallocated: 0 };
        rows[key].paid += number(item.gross); rows[key].unallocated += number(item.gross) - sum(item.allocations || [], "amount");
      });
      return Object.values(rows).map(function (item) { item.balance = item.accrued - item.paid; return item; });
    }

    function renderReconciliation(source) {
      const rows = reconciliationRows(source);
      const body = rows.map(function (item) {
        const status = item.balance > 0 ? "К оплате" : (item.balance < 0 ? "Аванс / переплата" : "Сверено");
        return '<tr><td>' + text(projectLabel(item.projectCode)) + '</td><td>' + text(item.contractor) + '</td><td>' + money(item.accrued) + '</td><td>' + money(item.paid) + '</td><td>' + money(item.balance) + '</td><td><span class="status-chip ' + (item.balance ? "warning" : "") + '">' + status + '</span><small>Нераспределено: ' + money(item.unallocated) + '</small></td></tr>';
      }).join("") || '<tr><td colspan="6">Начислений и оплат по выбранному срезу нет.</td></tr>';
      return '<section class="panel"><div class="section-heading"><div><h2>Сверка начислений и оплат</h2><p>Баланс = начислено с НДС − оплачено с НДС. Расхождение неблокирующее; аванс сохраняется отдельно.</p></div></div><div class="table-wrap"><table><thead><tr><th>Проект</th><th>Подрядчик / статья</th><th>Начислено</th><th>Оплачено</th><th>Баланс</th><th>Статус</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
    }

    function renderContractorMode(mode) { return contractorToolbar() + (mode === "payments" ? renderPayments("resource") : renderReconciliation("resource")); }
    function renderOtherMode(mode) { return otherToolbar() + (mode === "payments" ? renderPayments("other") : renderReconciliation("other")); }

    function rateForm(record) {
      const item = record || { financialKind: "profitTax", project: "", year: selectedYears()[0], rate: 5 };
      const backdrop = modal(record ? "Редактировать финансовую ставку" : "Новая финансовая ставка", '<form id="financial-rate-form"><div class="form-grid"><label>Вид <b>*</b><select name="financialKind"><option value="profitTax"' + (item.financialKind === "profitTax" ? " selected" : "") + '>Налог на прибыль</option><option value="overdraft"' + (item.financialKind === "overdraft" ? " selected" : "") + '>Овердрафт</option><option value="directorate"' + (item.financialKind === "directorate" ? " selected" : "") + '>Дирекция</option></select></label><label>Проект<select name="project">' + rateProjectOptions(item.project) + '</select><small data-error="project"></small></label><label>Год или интервал <b>*</b><input name="year" value="' + text(item.year || "") + '" placeholder="2026 или 2024-2026"></label><label>Ставка, % <b>*</b><input name="rate" type="number" min="0" max="100" step="0.1" value="' + text(item.rate) + '"></label><label class="form-wide">Наименование<input name="name" value="' + text(item.name || "") + '" placeholder="Заполняется автоматически, можно уточнить"></label></div><p class="form-note" data-rate-note></p><div class="form-actions"><button class="secondary-button" data-close type="button">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div></form>');
      const form = backdrop.querySelector("form");
      form.elements.project.value = item.project || "";
      const sync = function () { const needProject = form.elements.financialKind.value === "directorate"; form.elements.project.disabled = !needProject; form.elements.project.required = needProject; form.querySelector("[data-rate-note]").textContent = needProject ? "Ставка дирекции применяется к выбранному проекту и периоду." : "Глобальная ставка применяется ко всем проектам; проект не указывается."; };
      form.elements.financialKind.addEventListener("change", sync); sync();
      form.querySelector("[data-close]").addEventListener("click", function () { backdrop.remove(); });
      form.addEventListener("submit", async function (event) {
        event.preventDefault(); const body = Object.fromEntries(new FormData(form).entries()); body.rate = number(body.rate); if (!body.name) body.name = RATE_NAMES[body.financialKind] + " · " + body.year + (body.project ? " · " + body.project : "");
        const response = await fetch("/api/references/financialRates" + (record ? "/" + encodeURIComponent(record.id) : ""), { method: record ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json();
        if (!response.ok) { Object.keys(payload.fields || {}).forEach(function (field) { const target = form.querySelector('[data-error="' + field + '"]'); if (target) target.textContent = payload.fields[field]; }); if (!payload.fields) window.alert(payload.error || "Не удалось сохранить ставку."); return; }
        await api.refresh(); backdrop.remove(); api.render();
      });
    }

    function renderRatesReference() {
      const records = api.referenceRecords("financialRates");
      const rows = records.map(function (record) { return '<tr><td>' + text(RATE_NAMES[record.financialKind] || record.financialKind) + '</td><td>' + text(record.project ? (projects(true).find(function (item) { return item.name === record.project; }) || { name: record.project, code: "" }).code + " — " + record.project : "Все проекты") + '</td><td>' + text(record.year) + '</td><td>' + percent(number(record.rate) / 100) + '</td><td><button type="button" class="edit-button" data-rate-edit="' + text(record.id) + '">Изменить</button><button type="button" class="archive-button" data-rate-delete="' + text(record.id) + '">Удалить</button></td></tr>'; }).join("") || '<tr><td colspan="5">Нет финансовых ставок.</td></tr>';
      return '<article class="panel reference-directory"><div class="section-heading"><div><h2>Финансовые ставки</h2><p>Глобальные ставки налога и овердрафта, а также ставки дирекции в разрезе проекта и периода.</p></div><button id="add-financial-rate" class="primary-button" type="button">+ Новая ставка</button></div><div class="table-wrap"><table><thead><tr><th>Вид</th><th>Проект</th><th>Период</th><th>Ставка</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></article>';
    }

    function bindHelp() {
      document.querySelectorAll("[data-finance-help]").forEach(function (button) { button.addEventListener("click", function () { modal("Пояснение расчёта", '<div class="formula-popover"><pre>' + text(button.dataset.financeHelp) + '</pre><div class="form-actions"><button type="button" class="primary-button" data-close>Закрыть</button></div></div>').querySelector("[data-close]").addEventListener("click", function (event) { event.currentTarget.closest("#finance-modal").remove(); }); }); });
    }

    function bindFinancialControls() {
      bindHelp();
      const add = document.getElementById("add-finance-income"); if (add) add.addEventListener("click", function () { incomeForm(null); });
      document.querySelectorAll("[data-income-edit]").forEach(function (button) { button.addEventListener("click", function () { const record = events("incomes").find(function (item) { return item.id === button.dataset.incomeEdit; }); if (record) incomeForm(record); }); });
      document.querySelectorAll("[data-income-delete]").forEach(function (button) { button.addEventListener("click", function () { const record = events("incomes").find(function (item) { return item.id === button.dataset.incomeDelete; }); if (record) archiveEvent("incomes", record); }); });
    }

    function bindModeControls() {
      document.querySelectorAll("[data-finance-mode]").forEach(function (button) { button.addEventListener("click", function () { const parts = button.dataset.financeMode.split(":"); if (parts[0] === "resource") state.financeContractorMode = parts[1]; else state.financeOtherMode = parts[1]; api.render(); }); });
      const add = document.getElementById("add-finance-payment"); if (add) add.addEventListener("click", function () { paymentForm(null); });
      document.querySelectorAll("[data-payment-edit]").forEach(function (button) { button.addEventListener("click", function () { const record = events("payments").find(function (item) { return item.id === button.dataset.paymentEdit; }); if (record) paymentForm(record); }); });
      document.querySelectorAll("[data-payment-delete]").forEach(function (button) { button.addEventListener("click", function () { const record = events("payments").find(function (item) { return item.id === button.dataset.paymentDelete; }); if (record) archiveEvent("payments", record); }); });
      bindHelp();
    }

    function contextMarkup() {
      ensureFilters();
      const years = allModelYears();
      return '<label class="finance-context-select">Годы<select id="finance-years" multiple size="1" aria-label="Годы">' + years.map(function (year) { return '<option value="' + year + '"' + (state.financeYears.includes(year) ? " selected" : "") + '>' + year + '</option>'; }).join("") + '</select></label><label class="finance-context-select">Проекты<select id="finance-projects" multiple size="1" aria-label="Проекты">' + projects().map(function (item) { return '<option value="' + text(item.code) + '"' + (state.financeProjects.includes(item.code) ? " selected" : "") + '>' + text(item.code + " — " + item.name) + '</option>'; }).join("") + '</select></label>';
    }

    function bindContext() {
      const years = document.getElementById("finance-years"); const project = document.getElementById("finance-projects");
      if (years) years.addEventListener("change", function () { const values = Array.from(years.selectedOptions).map(function (item) { return item.value; }); state.financeYears = values.length ? values : [String(api.currentYear())]; api.render(); });
      if (project) project.addEventListener("change", function () { state.financeProjects = Array.from(project.selectedOptions).map(function (item) { return item.value; }); api.render(); });
    }

    function bindContractorControls() { bindModeControls(); }
    function bindOtherControls() { bindModeControls(); }
    function bindRatesControls() {
      const add = document.getElementById("add-financial-rate"); if (add) add.addEventListener("click", function () { rateForm(null); });
      document.querySelectorAll("[data-rate-edit]").forEach(function (button) { button.addEventListener("click", function () { const record = api.referenceRecords("financialRates", true).find(function (item) { return item.id === button.dataset.rateEdit; }); if (record) rateForm(record); }); });
      document.querySelectorAll("[data-rate-delete]").forEach(function (button) { button.addEventListener("click", async function () { if (!window.confirm("Удалить ставку? Используемая ставка будет перенесена в архив.")) return; const response = await fetch("/api/references/financialRates/" + encodeURIComponent(button.dataset.rateDelete), { method: "DELETE" }); const payload = await response.json(); if (!response.ok) { window.alert(payload.error || "Не удалось удалить ставку."); return; } await api.refresh(); api.render(); }); });
    }

    return { contextMarkup: contextMarkup, bindContext: bindContext, renderIncome: renderIncome, renderPlanFact: renderPlanFact, contractorToolbar: contractorToolbar, otherToolbar: otherToolbar, renderContractorMode: renderContractorMode, renderOtherMode: renderOtherMode, bindFinancialControls: bindFinancialControls, bindContractorControls: bindContractorControls, bindOtherControls: bindOtherControls, renderRatesReference: renderRatesReference, bindRatesControls: bindRatesControls };
  }

  window.BudgetFinancial = { create: create };
}());
