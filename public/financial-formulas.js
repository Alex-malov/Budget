(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BudgetFinancialFormulas = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
  }

  // Единый контракт расчёта финансового результата. Денежный поток и
  // овердрафт считаются на помесячном слое и передаются уже итогом.
  function summary(input) {
    const income = number(input.income);
    const outputVat = number(input.outputVat);
    const otherGross = number(input.otherGross);
    const contractorGross = number(input.contractorGross);
    const staffCost = number(input.staffCost);
    const staffAttraction = number(input.staffAttraction);
    const inputVat = number(input.inputVat);
    const expenses = otherGross + contractorGross + staffCost;
    const profitGross = income - expenses;
    const vatTotal = outputVat - inputVat;
    const beforeTax = profitGross - vatTotal;
    const taxRate = input.taxRate == null ? null : number(input.taxRate);
    const directorateRate = input.directorateRate == null ? null : number(input.directorateRate);
    const profitTax = taxRate == null ? null : Math.max(0, beforeTax) * taxRate;
    const net = profitTax == null ? null : beforeTax - profitTax;
    const investment = (income - otherGross) * 0.1;
    const directorate = directorateRate == null ? null : (income - otherGross - investment) * directorateRate;
    const overdraftCost = number(input.overdraftCost);
    const dks = net == null || directorate == null ? null : net - investment - directorate - staffAttraction - overdraftCost;
    return {
      income: income, outputVat: outputVat, otherGross: otherGross, contractorGross: contractorGross, staffCost: staffCost, staffAttraction: staffAttraction,
      expenses: expenses, inputVat: inputVat, profitGross: profitGross, vatTotal: vatTotal, beforeTax: beforeTax, profitTax: profitTax, net: net,
      investment: investment, directorate: directorate, overdraftCost: overdraftCost, dks: dks,
      profitability: net == null || !(income - outputVat) ? null : net / (income - outputVat),
      taxBurden: !income || profitTax == null ? null : (vatTotal + profitTax) / income
    };
  }

  return { summary: summary };
}));
