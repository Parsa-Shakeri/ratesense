// app.js
"use strict";

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

function fmtUSD(x) {
  if (!isFinite(x)) return "—";
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtUSD2(x) {
  if (!isFinite(x)) return "—";
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function fmtPct(x) {
  if (!isFinite(x)) return "—";
  return (x * 100).toFixed(2) + "%";
}
function clampPositive(n) {
  return isFinite(n) && n > 0 ? n : NaN;
}

// ---------- Core Math ----------
function monthlyPaymentAmortized(principal, aprPercent, years) {
  const P = principal;
  const r = (aprPercent / 100) / 12;
  const n = years * 12;
  if (r === 0) return P / n;
  const pow = Math.pow(1 + r, n);
  return P * (r * pow) / (pow - 1);
}

function amortizedSummary(principal, aprPercent, years) {
  const n = years * 12;
  const m = monthlyPaymentAmortized(principal, aprPercent, years);
  const totalPaid = m * n;
  const totalInterest = totalPaid - principal;
  return { monthly: m, totalPaid, totalInterest, months: n };
}

// Credit card payoff simulation
// mode = "minimum" or "fixed"
// - minimum: payment = max(2% of balance, 25), but never less than interest+1 to ensure payoff progress
function creditCardSim(balance, aprPercent, mode, fixedPayment) {
  const monthlyRate = (aprPercent / 100) / 12;
  let b = balance;
  let months = 0;
  let totalInterest = 0;

  // Safety: stop at 600 months (50 years) to avoid infinite loops for too-low payments
  const MAX_MONTHS = 600;

  while (b > 0.01 && months < MAX_MONTHS) {
    const interest = b * monthlyRate;
    totalInterest += interest;

    let payment;
    if (mode === "fixed") {
      payment = fixedPayment;
    } else {
      payment = Math.max(0.02 * b, 25);
      // ensure payment at least covers interest + small principal
      payment = Math.max(payment, interest + 1);
    }

    // prevent overpay
    payment = Math.min(payment, b + interest);

    b = b + interest - payment;
    months += 1;

    // If payment can't reduce principal, break
    if (months > 3 && payment <= interest + 0.01) break;
  }

  const monthlyEstimate = (mode === "fixed") ? fixedPayment : NaN;
  const totalPaid = balance + totalInterest;

  const paidOff = b <= 0.01;
  return { months, totalInterest, totalPaid, paidOff, monthlyEstimate };
}

// ---------- UI Logic ----------
const els = {
  loanType: $("loanType"),
  principal: $("principal"),
  termYears: $("termYears"),
  apr: $("apr"),
  delta: $("delta"),
  customDelta: $("customDelta"),
  customDeltaWrap: $("customDeltaWrap"),
  ccMode: $("ccMode"),
  ccFixedPayment: $("ccFixedPayment"),
  status: $("status"),
  baseMonthly: $("baseMonthly"),
  newMonthly: $("newMonthly"),
  deltaMonthly: $("deltaMonthly"),
  baseInterest: $("baseInterest"),
  newInterest: $("newInterest"),
  deltaInterest: $("deltaInterest"),
  baseTotalPaid: $("baseTotalPaid"),
  baseNote: $("baseNote"),
  scenarioTable: $("scenarioTable").querySelector("tbody"),
  calcBtn: $("calcBtn"),
  resetBtn: $("resetBtn"),
};

function showHideFields() {
  const isCC = els.loanType.value === "creditcard";
  document.querySelectorAll(".amortizedOnly").forEach(el => el.style.display = isCC ? "none" : "");
  document.querySelectorAll(".creditOnly").forEach(el => el.style.display = isCC ? "" : "none");
}

function getDelta() {
  if (els.delta.value === "custom") {
    const c = parseFloat(els.customDelta.value);
    return isFinite(c) ? c : 0;
  }
  return parseFloat(els.delta.value);
}

function setStatus(msg) {
  els.status.textContent = msg || "";
}

function validateInputs() {
  const principal = parseFloat(els.principal.value);
  const apr = parseFloat(els.apr.value);

  if (!(principal > 0)) return { ok: false, msg: "Enter a principal/balance > 0." };
  if (!(apr >= 0)) return { ok: false, msg: "Enter APR (>= 0)." };

  if (els.loanType.value !== "creditcard") {
    const years = parseFloat(els.termYears.value);
    if (!(years > 0)) return { ok: false, msg: "Enter term in years > 0." };
  } else {
    const mode = els.ccMode.value;
    if (mode === "fixed") {
      const fp = parseFloat(els.ccFixedPayment.value);
      if (!(fp > 0)) return { ok: false, msg: "Enter a fixed payment > 0." };
    }
  }

  return { ok: true };
}

function renderResults(base, next, loanType) {
  if (loanType === "creditcard") {
    els.baseMonthly.textContent = "—";
    els.newMonthly.textContent = "—";
    els.baseNote.textContent = `Payoff time (baseline): ${base.months} months${base.paidOff ? "" : " (may not fully pay off)"}`;
    els.deltaMonthly.textContent = `Payoff time (new): ${next.months} months${next.paidOff ? "" : " (may not fully pay off)"}`;

    els.baseInterest.textContent = fmtUSD2(base.totalInterest);
    els.newInterest.textContent = fmtUSD2(next.totalInterest);

    const dI = next.totalInterest - base.totalInterest;
    els.deltaInterest.textContent = `${dI >= 0 ? "+" : ""}${fmtUSD2(dI)} interest`;

    els.baseTotalPaid.textContent = `Total paid: ${fmtUSD2(base.totalPaid)}`;
    els.deltaMonthly.textContent += ` • Δ months: ${(next.months - base.months >= 0 ? "+" : "")}${next.months - base.months}`;

    return;
  }

  els.baseMonthly.textContent = fmtUSD2(base.monthly);
  els.newMonthly.textContent = fmtUSD2(next.monthly);

  const dM = next.monthly - base.monthly;
  const pct = dM / base.monthly;
  els.deltaMonthly.textContent = `${dM >= 0 ? "+" : ""}${fmtUSD2(dM)} (${fmtPct(pct)})`;
  els.baseNote.textContent = `Term: ${base.months} months`;

  els.baseInterest.textContent = fmtUSD2(base.totalInterest);
  els.newInterest.textContent = fmtUSD2(next.totalInterest);

  const dI = next.totalInterest - base.totalInterest;
  els.deltaInterest.textContent = `${dI >= 0 ? "+" : ""}${fmtUSD2(dI)} interest`;

  els.baseTotalPaid.textContent = `Total paid: ${fmtUSD2(base.totalPaid)}`;
}

function renderScenarioTable(rows, baseRow) {
  // rows include baseline as first row
  els.scenarioTable.innerHTML = "";
  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    const deltaMonthly = r.monthly - baseRow.monthly;
    const deltaInterest = r.totalInterest - baseRow.totalInterest;

    tr.innerHTML = `
      <td>${idx === 0 ? "Baseline" : (r.delta >= 0 ? "+" : "") + r.delta.toFixed(2) + "%"}</td>
      <td>${r.apr.toFixed(2)}%</td>
      <td>${fmtUSD2(r.monthly)}</td>
      <td>${fmtUSD2(r.totalInterest)}</td>
      <td>${idx === 0 ? "—" : (deltaMonthly >= 0 ? "+" : "") + fmtUSD2(deltaMonthly)}</td>
      <td>${idx === 0 ? "—" : (deltaInterest >= 0 ? "+" : "") + fmtUSD2(deltaInterest)}</td>
    `;
    els.scenarioTable.appendChild(tr);
  });
}

function calculateAndRender() {
  const v = validateInputs();
  if (!v.ok) {
    setStatus(v.msg);
    return;
  }
  setStatus("");

  const loanType = els.loanType.value;
  const principal = parseFloat(els.principal.value);
  const apr = parseFloat(els.apr.value);
  const delta = getDelta();
  const aprNew = apr + delta;

  if (loanType === "creditcard") {
    const mode = els.ccMode.value;
    const fixed = parseFloat(els.ccFixedPayment.value);

    const base = creditCardSim(principal, apr, mode, fixed);
    const next = creditCardSim(principal, aprNew, mode, fixed);

    renderResults(base, next, loanType);

    // Scenario table for CC: show months + interest instead (simple)
    els.scenarioTable.innerHTML = "";
    const deltas = [0, 0.25, 0.50, 1.00];
    deltas.forEach((d) => {
      const sim = creditCardSim(principal, apr + d, mode, fixed);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${d === 0 ? "Baseline" : "+" + d.toFixed(2) + "%"}</td>
        <td>${(apr + d).toFixed(2)}%</td>
        <td>${sim.months} mo</td>
        <td>${fmtUSD2(sim.totalInterest)}</td>
        <td>${d === 0 ? "—" : (sim.months - base.months >= 0 ? "+" : "") + (sim.months - base.months) + " mo"}</td>
        <td>${d === 0 ? "—" : (sim.totalInterest - base.totalInterest >= 0 ? "+" : "") + fmtUSD2(sim.totalInterest - base.totalInterest)}</td>
      `;
      els.scenarioTable.appendChild(tr);
    });
    return;
  }

  const years = parseFloat(els.termYears.value);
  const base = amortizedSummary(principal, apr, years);
  const next = amortizedSummary(principal, aprNew, years);
  renderResults(base, next, loanType);

  // Scenario table
  const deltas = [0, 0.25, 0.50, 1.00];
  const rows = deltas.map((d) => {
    const s = amortizedSummary(principal, apr + d, years);
    return { delta: d, apr: apr + d, monthly: s.monthly, totalInterest: s.totalInterest };
  });
  renderScenarioTable(rows, rows[0]);
}

function resetAll() {
  els.loanType.value = "mortgage";
  els.principal.value = "";
  els.termYears.value = "";
  els.apr.value = "";
  els.delta.value = "0";
  els.customDelta.value = "";
  els.customDeltaWrap.style.display = "none";
  els.ccMode.value = "minimum";
  els.ccFixedPayment.value = "";
  setStatus("");

  els.baseMonthly.textContent = "—";
  els.newMonthly.textContent = "—";
  els.deltaMonthly.textContent = "—";
  els.baseInterest.textContent = "—";
  els.newInterest.textContent = "—";
  els.deltaInterest.textContent = "—";
  els.baseTotalPaid.textContent = "—";
  els.baseNote.textContent = "";

  els.scenarioTable.innerHTML = `<tr><td colspan="6" class="muted">Run a calculation to populate scenarios.</td></tr>`;
  showHideFields();
}

// ---------- Scenario Loader ----------
const scenarios = {
  mortgage350: { loanType: "mortgage", principal: 350000, years: 30, apr: 6.5 },
  auto25: { loanType: "auto", principal: 25000, years: 5, apr: 7.9 },
  student40: { loanType: "student", principal: 40000, years: 10, apr: 6.0 },
  cc4k: { loanType: "creditcard", principal: 4000, apr: 24.0, ccMode: "fixed", ccFixedPayment: 200 },
};

function loadScenario(key) {
  const s = scenarios[key];
  if (!s) return;

  els.loanType.value = s.loanType;
  els.principal.value = s.principal;
  els.apr.value = s.apr;

  if (s.loanType === "creditcard") {
    els.ccMode.value = s.ccMode || "minimum";
    els.ccFixedPayment.value = s.ccFixedPayment ?? "";
  } else {
    els.termYears.value = s.years;
  }

  els.delta.value = "0";
  els.customDeltaWrap.style.display = "none";
  showHideFields();
  setStatus("Scenario loaded. Click Calculate.");
  window.location.hash = "#calculator";
}

// ---------- Event Wiring ----------
els.loanType.addEventListener("change", () => {
  showHideFields();
});

els.delta.addEventListener("change", () => {
  const isCustom = els.delta.value === "custom";
  els.customDeltaWrap.style.display = isCustom ? "" : "none";
});

els.calcBtn.addEventListener("click", calculateAndRender);
els.resetBtn.addEventListener("click", resetAll);

document.querySelectorAll("[data-scenario]").forEach(btn => {
  btn.addEventListener("click", () => loadScenario(btn.dataset.scenario));
});

// init
resetAll();

