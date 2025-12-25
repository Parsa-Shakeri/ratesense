// app.js
"use strict";

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

function fmtUSD2(x) {
  if (!isFinite(x)) return "—";
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function fmtPct(x) {
  if (!isFinite(x)) return "—";
  return (x * 100).toFixed(2) + "%";
}
function shortCurrency(v){
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v/1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (v/1_000).toFixed(0) + "k";
  return String(Math.round(v));
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

// Generates a full amortization schedule, supporting extra monthly payment.
function amortizationSchedule(principal, aprPercent, years, extraMonthly = 0) {
  const P0 = principal;
  const r = (aprPercent / 100) / 12;
  const baseMonthly = monthlyPaymentAmortized(P0, aprPercent, years);
  const extra = Math.max(0, extraMonthly || 0);

  let balance = P0;
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  const schedule = [];
  const MAX_MONTHS = 1200;

  while (balance > 0.01 && month < MAX_MONTHS) {
    month += 1;
    const interest = (r === 0) ? 0 : balance * r;

    let payment = baseMonthly + extra;
    payment = Math.min(payment, balance + interest);

    const principalPaid = payment - interest;
    balance = balance - principalPaid;

    totalInterest += interest;
    totalPaid += payment;

    schedule.push({
      month,
      payment,
      interest,
      principal: principalPaid,
      balance: Math.max(0, balance),
    });
  }

  return {
    schedule,
    totalInterest,
    totalPaid,
    months: schedule.length,
    monthlyPaymentBase: schedule[0]?.payment ?? NaN,
  };
}

// Credit card payoff simulation
function creditCardSim(balance, aprPercent, mode, fixedPayment) {
  const monthlyRate = (aprPercent / 100) / 12;
  let b = balance;
  let months = 0;
  let totalInterest = 0;

  const MAX_MONTHS = 600;

  while (b > 0.01 && months < MAX_MONTHS) {
    const interest = b * monthlyRate;
    totalInterest += interest;

    let payment;
    if (mode === "fixed") {
      payment = fixedPayment;
    } else {
      payment = Math.max(0.02 * b, 25);
      payment = Math.max(payment, interest + 1);
    }

    payment = Math.min(payment, b + interest);
    b = b + interest - payment;
    months += 1;

    if (months > 3 && payment <= interest + 0.01) break;
  }

  const totalPaid = balance + totalInterest;
  const paidOff = b <= 0.01;
  return { months, totalInterest, totalPaid, paidOff };
}

// Refinance break-even estimate
function refinanceBreakeven(principal, baseApr, newApr, years, extraMonthly, closingCosts, keepYears) {
  const base = amortizationSchedule(principal, baseApr, years, extraMonthly);
  const refi = amortizationSchedule(principal, newApr, years, extraMonthly);

  const keepMonths = Math.max(1, Math.round((keepYears || years) * 12));
  const mMax = Math.min(keepMonths, Math.max(base.months, refi.months));

  let cumulativeSavings = 0;
  let breakevenMonth = null;

  for (let m = 1; m <= mMax; m++) {
    const basePay = base.schedule[m - 1]?.payment ?? 0;
    const refiPay = refi.schedule[m - 1]?.payment ?? 0;
    cumulativeSavings += (basePay - refiPay);

    if (breakevenMonth === null && cumulativeSavings >= closingCosts) {
      breakevenMonth = m;
    }
  }

  const basePaid = base.schedule.slice(0, keepMonths).reduce((s, x) => s + x.payment, 0);
  const refiPaid = refi.schedule.slice(0, keepMonths).reduce((s, x) => s + x.payment, 0);
  const baseRem = base.schedule[Math.min(keepMonths, base.schedule.length) - 1]?.balance ?? 0;
  const refiRem = refi.schedule[Math.min(keepMonths, refi.schedule.length) - 1]?.balance ?? 0;

  const baseNet = basePaid + baseRem;
  const refiNet = refiPaid + refiRem + closingCosts;

  const netSavings = baseNet - refiNet;

  return { breakevenMonth, netSavings };
}

// ---------- UI Elements ----------
const els = {
  loanType: $("loanType"),
  principal: $("principal"),
  termYears: $("termYears"),
  apr: $("apr"),
  extraPayment: $("extraPayment"),
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

  scenarioTbody: $("scenarioTable").querySelector("tbody"),

  // Refi
  refiNewApr: $("refiNewApr"),
  refiClosingCosts: $("refiClosingCosts"),
  refiKeepYears: $("refiKeepYears"),
  refiBreakeven: $("refiBreakeven"),
  refiSavings: $("refiSavings"),

  // Chart
  chartCanvas: $("chart"),
  chartBalanceBtn: $("chartBalanceBtn"),
  chartSplitBtn: $("chartSplitBtn"),

  // Buttons
  calcBtn: $("calcBtn"),
  resetBtn: $("resetBtn"),
  copyBtn: $("copyBtn"),
};

function setStatus(msg) {
  els.status.textContent = msg || "";
}

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

function validateInputs() {
  const principal = parseFloat(els.principal.value);
  const apr = parseFloat(els.apr.value);
  if (!(principal > 0)) return { ok: false, msg: "Enter a principal/balance > 0." };
  if (!(apr >= 0)) return { ok: false, msg: "Enter APR (>= 0)." };

  if (els.loanType.value !== "creditcard") {
    const years = parseFloat(els.termYears.value);
    if (!(years > 0)) return { ok: false, msg: "Enter term in years > 0." };
    const extra = parseFloat(els.extraPayment.value || "0");
    if (!(extra >= 0)) return { ok: false, msg: "Extra payment must be >= 0." };
  } else {
    const mode = els.ccMode.value;
    if (mode === "fixed") {
      const fp = parseFloat(els.ccFixedPayment.value);
      if (!(fp > 0)) return { ok: false, msg: "Enter a fixed payment > 0." };
    }
  }
  return { ok: true };
}

// ---------- Scenario Tables ----------
function renderScenarioTableAmortized(baseApr, principal, years, extra) {
  els.scenarioTbody.innerHTML = "";
  const deltas = [0, 0.25, 0.50, 1.00];

  const baseSched = amortizationSchedule(principal, baseApr, years, extra);
  const baseMonthly = baseSched.monthlyPaymentBase;
  const baseInterest = baseSched.totalInterest;

  deltas.forEach((d, idx) => {
    const apr = baseApr + d;
    const s = amortizationSchedule(principal, apr, years, extra);
    const monthly = s.monthlyPaymentBase;
    const interest = s.totalInterest;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx === 0 ? "Baseline" : "+" + d.toFixed(2) + "%"}</td>
      <td>${apr.toFixed(2)}%</td>
      <td>${fmtUSD2(monthly)}</td>
      <td>${fmtUSD2(interest)}</td>
      <td>${idx === 0 ? "—" : (monthly - baseMonthly >= 0 ? "+" : "") + fmtUSD2(monthly - baseMonthly)}</td>
      <td>${idx === 0 ? "—" : (interest - baseInterest >= 0 ? "+" : "") + fmtUSD2(interest - baseInterest)}</td>
    `;
    els.scenarioTbody.appendChild(tr);
  });

  return baseSched;
}

function renderScenarioTableCC(balance, baseApr, mode, fixedPayment) {
  els.scenarioTbody.innerHTML = "";
  const deltas = [0, 0.25, 0.50, 1.00];

  const base = creditCardSim(balance, baseApr, mode, fixedPayment);

  deltas.forEach((d, idx) => {
    const sim = creditCardSim(balance, baseApr + d, mode, fixedPayment);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx === 0 ? "Baseline" : "+" + d.toFixed(2) + "%"}</td>
      <td>${(baseApr + d).toFixed(2)}%</td>
      <td>${sim.months} mo</td>
      <td>${fmtUSD2(sim.totalInterest)}</td>
      <td>${idx === 0 ? "—" : (sim.months - base.months >= 0 ? "+" : "") + (sim.months - base.months) + " mo"}</td>
      <td>${idx === 0 ? "—" : (sim.totalInterest - base.totalInterest >= 0 ? "+" : "") + fmtUSD2(sim.totalInterest - base.totalInterest)}</td>
    `;
    els.scenarioTbody.appendChild(tr);
  });
}

// ---------- Chart ----------
let chart = null;
let chartMode = "balance"; // "balance" or "split"

function downsampleSchedule(schedule, maxPoints = 140){
  if (schedule.length <= maxPoints) return schedule;
  const step = Math.ceil(schedule.length / maxPoints);
  const out = [];
  for (let i=0; i<schedule.length; i+=step) out.push(schedule[i]);
  if (out[out.length-1] !== schedule[schedule.length-1]) out.push(schedule[schedule.length-1]);
  return out;
}

function buildChart(scheduleObj) {
  if (!scheduleObj?.schedule?.length) return;

  const s = downsampleSchedule(scheduleObj.schedule, 140);
  const labels = s.map(x => x.month);
  const bal = s.map(x => x.balance);
  const intP = s.map(x => x.interest);
  const prinP = s.map(x => x.principal);

  const isBalance = (chartMode === "balance");

  const data = isBalance
    ? {
        labels,
        datasets: [{
          label: "Remaining balance",
          data: bal,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: true
        }]
      }
    : {
        labels,
        datasets: [
          { label: "Interest portion (monthly)", data: intP, borderWidth: 2, pointRadius: 0, tension: 0.25 },
          { label: "Principal portion (monthly)", data: prinP, borderWidth: 2, pointRadius: 0, tension: 0.25 }
        ]
      };

  if (chart) chart.destroy();

  chart = new Chart(els.chartCanvas, {
    type: "line",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { boxWidth: 12 } },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            title: (items) => `Month ${items[0].label}`,
            label: (item) => `${item.dataset.label}: $${item.raw.toLocaleString(undefined, {maximumFractionDigits: 0})}`
          }
        }
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { title: { display: true, text: "Month" }, ticks: { maxTicksLimit: 10 } },
        y: { title: { display: true, text: "Dollars ($)" }, ticks: { callback: (v) => "$" + shortCurrency(v) } }
      }
    }
  });
}

// ---------- Copy summary ----------
let lastSummary = "";
let lastBaselineSchedule = null;

function copySummary(text) {
  navigator.clipboard.writeText(text).then(() => {
    setStatus("Copied summary.");
    setTimeout(() => setStatus(""), 1500);
  }).catch(() => {
    setStatus("Copy failed (clipboard blocked).");
  });
}

// ---------- Main Calculation ----------
function calculateAndRender() {
  const v = validateInputs();
  if (!v.ok) { setStatus(v.msg); return; }
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

    els.baseMonthly.textContent = "—";
    els.newMonthly.textContent = "—";
    els.baseNote.textContent = `Baseline payoff time: ${base.months} months${base.paidOff ? "" : " (may not fully pay off)"}`;
    els.deltaMonthly.textContent = `New payoff time: ${next.months} months • Δ ${(next.months - base.months >= 0 ? "+" : "")}${next.months - base.months} mo`;

    els.baseInterest.textContent = fmtUSD2(base.totalInterest);
    els.baseTotalPaid.textContent = `Total paid: ${fmtUSD2(base.totalPaid)}`;
    els.newInterest.textContent = fmtUSD2(next.totalInterest);
    els.deltaInterest.textContent = `${(next.totalInterest - base.totalInterest >= 0 ? "+" : "")}${fmtUSD2(next.totalInterest - base.totalInterest)} interest`;

    renderScenarioTableCC(principal, apr, mode, fixed);

    // Chart not shown for CC in this version
    if (chart) { chart.destroy(); chart = null; }
    lastBaselineSchedule = null;

    els.refiBreakeven.textContent = "—";
    els.refiSavings.textContent = "Refinance model applies to amortized loans only.";

    lastSummary =
      `RateSense summary (Credit Card)\n` +
      `Balance: ${fmtUSD2(principal)}\nAPR: ${apr.toFixed(2)}% (Scenario: +${delta.toFixed(2)}% => ${(aprNew).toFixed(2)}%)\n` +
      `Baseline payoff: ${base.months} months, total interest ${fmtUSD2(base.totalInterest)}\n` +
      `New payoff: ${next.months} months, total interest ${fmtUSD2(next.totalInterest)}\n` +
      `Δ interest: ${fmtUSD2(next.totalInterest - base.totalInterest)}\n` +
      `Educational only; not financial advice.`;
    return;
  }

  const years = parseFloat(els.termYears.value);
  const extra = parseFloat(els.extraPayment.value || "0") || 0;

  const baseSched = renderScenarioTableAmortized(apr, principal, years, extra);
  const newSched = amortizationSchedule(principal, aprNew, years, extra);

  const baseMonthly = baseSched.monthlyPaymentBase;
  const newMonthly = newSched.monthlyPaymentBase;

  els.baseMonthly.textContent = fmtUSD2(baseMonthly);
  els.baseNote.textContent = `Payoff: ${baseSched.months} months${extra > 0 ? " (with extra payment)" : ""}`;
  els.baseInterest.textContent = fmtUSD2(baseSched.totalInterest);
  els.baseTotalPaid.textContent = `Total paid: ${fmtUSD2(baseSched.totalPaid)}`;

  els.newMonthly.textContent = fmtUSD2(newMonthly);
  const dM = newMonthly - baseMonthly;
  els.deltaMonthly.textContent = `${dM >= 0 ? "+" : ""}${fmtUSD2(dM)} (${fmtPct(dM / baseMonthly)})`;

  els.newInterest.textContent = fmtUSD2(newSched.totalInterest);
  const dI = newSched.totalInterest - baseSched.totalInterest;
  els.deltaInterest.textContent = `${dI >= 0 ? "+" : ""}${fmtUSD2(dI)} interest`;

  // Chart uses baseline schedule
  lastBaselineSchedule = baseSched;
  buildChart(baseSched);

  // Refi (optional inputs)
  const refiApr = parseFloat(els.refiNewApr.value);
  const closingCosts = parseFloat(els.refiClosingCosts.value);
  const keepYears = parseFloat(els.refiKeepYears.value);

  if (isFinite(refiApr) && isFinite(closingCosts) && closingCosts >= 0 && isFinite(keepYears) && keepYears > 0) {
    const r = refinanceBreakeven(principa
