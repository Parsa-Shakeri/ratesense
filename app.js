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

function downloadText(filename, text, mime="text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setParam(url, key, value) {
  if (value === null || value === undefined || value === "") url.searchParams.delete(key);
  else url.searchParams.set(key, String(value));
}

function safeNum(v, def = 0) {
  const x = parseFloat(v);
  return isFinite(x) ? x : def;
}

function copyToClipboard(text, okMsg, statusEl) {
  navigator.clipboard.writeText(text).then(() => {
    statusEl.textContent = okMsg;
    setTimeout(() => statusEl.textContent = "", 1500);
  }).catch(() => statusEl.textContent = "Copy failed (clipboard blocked).");
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
    if (mode === "fixed") payment = fixedPayment;
    else {
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
    if (breakevenMonth === null && cumulativeSavings >= closingCosts) breakevenMonth = m;
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
  menuBtn: $("menuBtn"),
  nav: $("nav"),

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

  annualTax: $("annualTax"),
  annualIns: $("annualIns"),
  monthlyHOA: $("monthlyHOA"),
  pitiRow: $("pitiRow"),
  basePITI: $("basePITI"),
  newPITI: $("newPITI"),
  deltaPITI: $("deltaPITI"),
  pitiAddons: $("pitiAddons"),
  pitiDeltaAbs: $("pitiDeltaAbs"),
  pitiDeltaPct: $("pitiDeltaPct"),

  baseMonthly: $("baseMonthly"),
  newMonthly: $("newMonthly"),
  deltaMonthly: $("deltaMonthly"),
  baseInterest: $("baseInterest"),
  newInterest: $("newInterest"),
  deltaInterest: $("deltaInterest"),
  baseTotalPaid: $("baseTotalPaid"),
  baseNote: $("baseNote"),

  scenarioTbody: $("scenarioTable").querySelector("tbody"),

  refiNewApr: $("refiNewApr"),
  refiClosingCosts: $("refiClosingCosts"),
  refiKeepYears: $("refiKeepYears"),
  refiBreakeven: $("refiBreakeven"),
  refiSavings: $("refiSavings"),

  chartCanvas: $("chart"),
  chartBalanceBtn: $("chartBalanceBtn"),
  chartSplitBtn: $("chartSplitBtn"),

  copyBtn: $("copyBtn"),
  shareBtn: $("shareBtn"),
  csvBtn: $("csvBtn"),
  printBtn: $("printBtn"),

  calcBtn: $("calcBtn"),
  resetBtn: $("resetBtn"),

  reportDate: $("reportDate"),
  reportInputs: $("reportInputs"),
  reportResults: $("reportResults"),
  reportRefi: $("reportRefi"),
};

function setStatus(msg) { els.status.textContent = msg || ""; }

// ---------- Mobile menu ----------
function initMenu() {
  if (!els.menuBtn || !els.nav) return;
  els.menuBtn.addEventListener("click", () => {
    const open = els.nav.classList.toggle("open");
    els.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  els.nav.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => {
      els.nav.classList.remove("open");
      els.menuBtn.setAttribute("aria-expanded", "false");
    });
  });
}
initMenu();

// ---------- Field visibility ----------
function showHideFields() {
  const type = els.loanType.value;
  const isCC = type === "creditcard";
  const isMortgage = type === "mortgage";

  document.querySelectorAll(".amortizedOnly").forEach(el => el.style.display = isCC ? "none" : "");
  document.querySelectorAll(".creditOnly").forEach(el => el.style.display = isCC ? "" : "none");
  document.querySelectorAll(".mortgageOnly").forEach(el => el.style.display = isMortgage ? "" : "none");

  els.pitiRow.style.display = "none";
}

function getDelta() {
  if (els.delta.value === "custom") return safeNum(els.customDelta.value, 0);
  return safeNum(els.delta.value, 0);
}

function validateInputs() {
  const principal = safeNum(els.principal.value, NaN);
  const apr = safeNum(els.apr.value, NaN);
  if (!(principal > 0)) return { ok: false, msg: "Enter a loan balance greater than 0." };
  if (!(apr >= 0)) return { ok: false, msg: "Enter an annual interest rate (0 or higher)." };

  if (els.loanType.value !== "creditcard") {
    const years = safeNum(els.termYears.value, NaN);
    if (!(years > 0)) return { ok: false, msg: "Enter loan length in years (greater than 0)." };
    const extra = safeNum(els.extraPayment.value, 0);
    if (!(extra >= 0)) return { ok: false, msg: "Extra monthly amount must be 0 or higher." };
  } else {
    if (els.ccMode.value === "fixed") {
      const fp = safeNum(els.ccFixedPayment.value, NaN);
      if (!(fp > 0)) return { ok: false, msg: "Enter a fixed monthly payment greater than 0." };
    }
  }
  return { ok: true };
}

// ---------- Mortgage monthly add-ons ----------
function mortgageAddonsMonthly() {
  const taxesMonthly = safeNum(els.annualTax.value, 0) / 12;
  const insuranceMonthly = safeNum(els.annualIns.value, 0) / 12;
  const housingFeesMonthly = safeNum(els.monthlyHOA.value, 0);
  return { taxesMonthly, insuranceMonthly, housingFeesMonthly, addons: taxesMonthly + insuranceMonthly + housingFeesMonthly };
}

// ---------- Scenario tables ----------
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
      <td>${idx === 0 ? "Baseline" : "Increase by " + d.toFixed(2) + "%"}</td>
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
      <td>${idx === 0 ? "Baseline" : "Increase by " + d.toFixed(2) + "%"}</td>
      <td>${(baseApr + d).toFixed(2)}%</td>
      <td>${sim.months} months</td>
      <td>${fmtUSD2(sim.totalInterest)}</td>
      <td>${idx === 0 ? "—" : (sim.months - base.months >= 0 ? "+" : "") + (sim.months - base.months) + " months"}</td>
      <td>${idx === 0 ? "—" : (sim.totalInterest - base.totalInterest >= 0 ? "+" : "") + fmtUSD2(sim.totalInterest - base.totalInterest)}</td>
    `;
    els.scenarioTbody.appendChild(tr);
  });
}

// ---------- Chart ----------
let chart = null;
let chartMode = "balance";

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
    ? { labels, datasets: [{ label: "Remaining balance", data: bal, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }] }
    : { labels, datasets: [
        { label: "Interest part of payment (monthly)", data: intP, borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "Principal part of payment (monthly)", data: prinP, borderWidth: 2, pointRadius: 0, tension: 0.25 }
      ]};

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

// ---------- Share link ----------
function buildShareURL() {
  const url = new URL(window.location.href);
  url.search = "";

  const loanType = els.loanType.value;
  setParam(url, "loan", loanType);
  setParam(url, "p", els.principal.value);
  setParam(url, "apr", els.apr.value);
  setParam(url, "delta", els.delta.value);
  if (els.delta.value === "custom") setParam(url, "cdelta", els.customDelta.value);

  if (loanType !== "creditcard") {
    setParam(url, "term", els.termYears.value);
    setParam(url, "extra", els.extraPayment.value || "0");
    setParam(url, "refiapr", els.refiNewApr.value);
    setParam(url, "reficost", els.refiClosingCosts.value);
    setParam(url, "keep", els.refiKeepYears.value);

    if (loanType === "mortgage") {
      setParam(url, "tax", els.annualTax.value);
      setParam(url, "ins", els.annualIns.value);
      setParam(url, "fees", els.monthlyHOA.value);
    }
  } else {
    setParam(url, "ccmode", els.ccMode.value);
    setParam(url, "ccpay", els.ccFixedPayment.value);
  }

  return url.toString();
}

function applyParamsFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.size) return;

  const loan = p.get("loan");
  if (loan) els.loanType.value = loan;

  if (p.get("p")) els.principal.value = p.get("p");
  if (p.get("apr")) els.apr.value = p.get("apr");
  if (p.get("delta")) els.delta.value = p.get("delta");

  els.customDeltaWrap.style.display = (els.delta.value === "custom") ? "" : "none";
  if (p.get("cdelta")) els.customDelta.value = p.get("cdelta");

  if (els.loanType.value !== "creditcard") {
    if (p.get("term")) els.termYears.value = p.get("term");
    if (p.get("extra")) els.extraPayment.value = p.get("extra");

    if (p.get("refiapr")) els.refiNewApr.value = p.get("refiapr");
    if (p.get("reficost")) els.refiClosingCosts.value = p.get("reficost");
    if (p.get("keep")) els.refiKeepYears.value = p.get("keep");

    if (els.loanType.value === "mortgage") {
      if (p.get("tax")) els.annualTax.value = p.get("tax");
      if (p.get("ins")) els.annualIns.value = p.get("ins");
      if (p.get("fees")) els.monthlyHOA.value = p.get("fees");
    }
  } else {
    if (p.get("ccmode")) els.ccMode.value = p.get("ccmode");
    if (p.get("ccpay")) els.ccFixedPayment.value = p.get("ccpay");
  }

  showHideFields();
  setStatus("Loaded from share link. Click Calculate.");
}

// ---------- CSV ----------
function scheduleToCSV(scheduleObj) {
  const lines = [];
  lines.push(["Month","Payment","Interest","Principal","Balance"].join(","));

  let sumPay = 0, sumInt = 0, sumPrin = 0;
  for (const row of scheduleObj.schedule) {
    sumPay += row.payment;
    sumInt += row.interest;
    sumPrin += row.principal;
    lines.push([row.month, row.payment.toFixed(2), row.interest.toFixed(2), row.principal.toFixed(2), row.balance.toFixed(2)].join(","));
  }

  lines.push("");
  lines.push(["Totals", sumPay.toFixed(2), sumInt.toFixed(2), sumPrin.toFixed(2), ""].join(","));
  return lines.join("\n");
}

// ---------- Print report ----------
function updateReportBlocks() {
  const now = new Date();
  els.reportDate.textContent = `Generated: ${now.toLocaleString()}`;

  const loanType = els.loanType.value;
  const delta = getDelta();

  const inputLines = [];
  inputLines.push(`Loan type: ${loanType}`);
  inputLines.push(`Loan balance: ${fmtUSD2(safeNum(els.principal.value, NaN))}`);
  inputLines.push(`Annual interest rate: ${safeNum(els.apr.value, NaN).toFixed(2)}%`);
  inputLines.push(`Scenario: increase by ${delta.toFixed(2)}%`);

  if (loanType !== "creditcard") {
    inputLines.push(`Loan length: ${safeNum(els.termYears.value, NaN)} years`);
    inputLines.push(`Extra monthly payment: ${fmtUSD2(safeNum(els.extraPayment.value, 0))}`);
    if (loanType === "mortgage") {
      const { taxesMonthly, insuranceMonthly, housingFeesMonthly } = mortgageAddonsMonthly();
      inputLines.push(`Monthly housing add-ons: taxes ${fmtUSD2(taxesMonthly)}, insurance ${fmtUSD2(insuranceMonthly)}, fees ${fmtUSD2(housingFeesMonthly)}`);
    }
  } else {
    inputLines.push(`Credit card payment style: ${els.ccMode.value}`);
    if (els.ccMode.value === "fixed") inputLines.push(`Fixed monthly payment: ${fmtUSD2(safeNum(els.ccFixedPayment.value, NaN))}`);
  }

  els.reportInputs.textContent = inputLines.join("\n");

  const resultsLines = [];
  resultsLines.push(`Baseline monthly payment: ${els.baseMonthly.textContent}`);
  if (els.baseNote.textContent) resultsLines.push(`${els.baseNote.textContent}`);
  resultsLines.push(`Baseline total interest: ${els.baseInterest.textContent}`);
  if (els.baseTotalPaid.textContent) resultsLines.push(`${els.baseTotalPaid.textContent}`);
  resultsLines.push("");
  resultsLines.push(`Scenario monthly payment: ${els.newMonthly.textContent}`);
  resultsLines.push(`Change in monthly payment: ${els.deltaMonthly.textContent}`);
  resultsLines.push(`Scenario total interest: ${els.newInterest.textContent}`);
  resultsLines.push(`Change in total interest: ${els.deltaInterest.textContent}`);

  if (loanType === "mortgage" && els.pitiRow.style.display !== "none") {
    resultsLines.push("");
    resultsLines.push(`Baseline total monthly housing cost: ${els.basePITI.textContent}`);
    resultsLines.push(`Scenario total monthly housing cost: ${els.newPITI.textContent}`);
    resultsLines.push(`Change in total monthly housing cost: ${els.pitiDeltaAbs.textContent} (${els.pitiDeltaPct.textContent})`);
  }

  els.reportResults.textContent = resultsLines.join("\n");

  const refiLines = [];
  refiLines.push(`New annual interest rate: ${els.refiNewApr.value || "—"}`);
  refiLines.push(`One-time refinance costs: ${els.refiClosingCosts.value ? fmtUSD2(safeNum(els.refiClosingCosts.value, 0)) : "—"}`);
  refiLines.push(`Keep years: ${els.refiKeepYears.value || "—"}`);
  refiLines.push(`Estimated break-even: ${els.refiBreakeven.textContent}`);
  refiLines.push(`Estimated savings: ${els.refiSavings.textContent}`);
  els.reportRefi.textContent = refiLines.join("\n");
}

// ---------- Main ----------
let lastSummary = "";
let lastBaselineSchedule = null;

function calculateAndRender() {
  const v = validateInputs();
  if (!v.ok) { setStatus(v.msg); return; }
  setStatus("");

  const loanType = els.loanType.value;
  const principal = safeNum(els.principal.value, NaN);
  const apr = safeNum(els.apr.value, NaN);
  const delta = getDelta();
  const aprNew = apr + delta;

  els.pitiRow.style.display = "none";

  if (loanType === "creditcard") {
    const mode = els.ccMode.value;
    const fixed = safeNum(els.ccFixedPayment.value, NaN);

    const base = creditCardSim(principal, apr, mode, fixed);
    const next = creditCardSim(principal, aprNew, mode, fixed);

    els.baseMonthly.textContent = "—";
    els.newMonthly.textContent = "—";
    els.baseNote.textContent = `Baseline payoff time: ${base.months} months${base.paidOff ? "" : " (may not fully pay off)"}`;
    els.deltaMonthly.textContent = `Scenario payoff time: ${next.months} months • Change ${(next.months - base.months >= 0 ? "+" : "")}${next.months - base.months} months`;

    els.baseInterest.textContent = fmtUSD2(base.totalInterest);
    els.baseTotalPaid.textContent = `Total paid: ${fmtUSD2(base.totalPaid)}`;
    els.newInterest.textContent = fmtUSD2(next.totalInterest);
    els.deltaInterest.textContent = `${(next.totalInterest - base.totalInterest >= 0 ? "+" : "")}${fmtUSD2(next.totalInterest - base.totalInterest)} interest`;

    renderScenarioTableCC(principal, apr, mode, fixed);

    if (chart) { chart.destroy(); chart = null; }
    lastBaselineSchedule = null;

    els.refiBreakeven.textContent = "—";
    els.refiSavings.textContent = "Refinance estimate applies to mortgage/auto/student loans only.";

    lastSummary =
      `RateSense summary (Credit card)\n` +
      `Balance: ${fmtUSD2(principal)}\nAnnual interest rate: ${apr.toFixed(2)}% (Scenario: +${delta.toFixed(2)}% => ${(aprNew).toFixed(2)}%)\n` +
      `Baseline payoff: ${base.months} months, total interest ${fmtUSD2(base.totalInterest)}\n` +
      `Scenario payoff: ${next.months} months, total interest ${fmtUSD2(next.totalInterest)}\n` +
      `Change in interest: ${fmtUSD2(next.totalInterest - base.totalInterest)}\n` +
      `Educational only; not financial advice.`;

    updateReportBlocks();
    return;
  }

  const years = safeNum(els.termYears.value, NaN);
  const extra = safeNum(els.extraPayment.value, 0);

  const baseSched = renderScenarioTableAmortized(apr, principal, years, extra);
  const newSched = amortizationSchedule(principal, aprNew, years, extra);

  const baseMonthly = baseSched.monthlyPaymentBase;
  const newMonthly = newSched.monthlyPaymentBase;

  els.baseMonthly.textContent = fmtUSD2(baseMonthly);
  els.baseNote.textContent = `Payoff time: ${baseSched.months} months${extra > 0 ? " (includes extra monthly payments)" : ""}`;
  els.baseInterest.textContent = fmtUSD2(baseSched.totalInterest);
  els.baseTotalPaid.textContent = `Total paid: ${fmtUSD2(baseSched.totalPaid)}`;

  els.newMonthly.textContent = fmtUSD2(newMonthly);
  const dM = newMonthly - baseMonthly;
  els.deltaMonthly.textContent = `${dM >= 0 ? "+" : ""}${fmtUSD2(dM)} (${fmtPct(dM / baseMonthly)})`;

  els.newInterest.textContent = fmtUSD2(newSched.totalInterest);
  const dI = newSched.totalInterest - baseSched.totalInterest;
  els.deltaInterest.textContent = `${dI >= 0 ? "+" : ""}${fmtUSD2(dI)} interest`;

  lastBaselineSchedule = baseSched;
  buildChart(baseSched);

  if (loanType === "mortgage") {
    const { addons } = mortgageAddonsMonthly();
    const baseHousing = baseMonthly + addons;
    const newHousing = newMonthly + addons;
    const dH = newHousing - baseHousing;

    if (addons > 0) {
      els.pitiRow.style.display = "";
      els.basePITI.textContent = fmtUSD2(baseHousing);
      els.newPITI.textContent = fmtUSD2(newHousing);
      els.deltaPITI.textContent = `Change: ${(dH >= 0 ? "+" : "")}${fmtUSD2(dH)}`;
      els.pitiAddons.textContent = fmtUSD2(addons);
      els.pitiDeltaAbs.textContent = (dH >= 0 ? "+" : "") + fmtUSD2(dH);
      els.pitiDeltaPct.textContent = fmtPct(dH / baseHousing);
    }
  }

  const refiApr = safeNum(els.refiNewApr.value, NaN);
  const closingCosts = safeNum(els.refiClosingCosts.value, NaN);
  const keepYears = safeNum(els.refiKeepYears.value, NaN);

  if (isFinite(refiApr) && isFinite(closingCosts) && closingCosts >= 0 && isFinite(keepYears) && keepYears > 0) {
    const r = refinanceBreakeven(principal, apr, refiApr, years, extra, closingCosts, keepYears);
    if (r.breakevenMonth === null) els.refiBreakeven.textContent = "No break-even within that time";
    else els.refiBreakeven.textContent = `${r.breakevenMonth} months (~${(r.breakevenMonth/12).toFixed(1)} years)`;
    els.refiSavings.textContent = `Estimated net savings over ${keepYears} years: ${fmtUSD2(r.netSavings)} (after refinance costs)`;
  } else {
    els.refiBreakeven.textContent = "—";
    els.refiSavings.textContent = "Enter new interest rate, refinance costs, and keep years.";
  }

  lastSummary =
    `RateSense summary (${loanType})\n` +
    `Loan balance: ${fmtUSD2(principal)}\nLoan length: ${years} years\nAnnual interest rate (baseline): ${apr.toFixed(2)}%\nExtra monthly payment: ${fmtUSD2(extra)}\n` +
    `Scenario: increase by ${delta.toFixed(2)}% => annual interest rate ${(aprNew).toFixed(2)}%\n\n` +
    `Baseline monthly payment: ${fmtUSD2(baseMonthly)}\nBaseline payoff time: ${baseSched.months} months\nBaseline total interest: ${fmtUSD2(baseSched.totalInterest)}\n\n` +
    `Scenario monthly payment: ${fmtUSD2(newMonthly)}\nScenario total interest: ${fmtUSD2(newSched.totalInterest)}\n` +
    `Change in monthly payment: ${fmtUSD2(dM)}\nChange in total interest: ${fmtUSD2(dI)}\n\n` +
    `Educational only; not financial advice.`;

  updateReportBlocks();
}

function resetAll() {
  els.loanType.value = "mortgage";
  els.principal.value = "";
  els.termYears.value = "";
  els.apr.value = "";
  els.extraPayment.value = "0";
  els.delta.value = "0";
  els.customDelta.value = "";
  els.customDeltaWrap.style.display = "none";
  els.ccMode.value = "minimum";
  els.ccFixedPayment.value = "";

  els.annualTax.value = "";
  els.annualIns.value = "";
  els.monthlyHOA.value = "0";

  els.refiNewApr.value = "";
  els.refiClosingCosts.value = "";
  els.refiKeepYears.value = "";

  els.baseMonthly.textContent = "—";
  els.newMonthly.textContent = "—";
  els.deltaMonthly.textContent = "—";
  els.baseInterest.textContent = "—";
  els.newInterest.textContent = "—";
  els.deltaInterest.textContent = "—";
  els.baseTotalPaid.textContent = "—";
  els.baseNote.textContent = "";

  els.pitiRow.style.display = "none";
  els.basePITI.textContent = "—";
  els.newPITI.textContent = "—";
  els.deltaPITI.textContent = "—";
  els.pitiAddons.textContent = "—";
  els.pitiDeltaAbs.textContent = "—";
  els.pitiDeltaPct.textContent = "—";

  els.refiBreakeven.textContent = "—";
  els.refiSavings.textContent = "—";

  els.scenarioTbody.innerHTML = `<tr><td colspan="6" class="muted">Run a calculation to populate scenarios.</td></tr>`;

  if (chart) { chart.destroy(); chart = null; }
  lastSummary = "";
  lastBaselineSchedule = null;

  updateReportBlocks();
  setStatus("");
  showHideFields();
}

// ---------- Scenarios ----------
const scenarios = {
  mortgage350: { loanType: "mortgage", principal: 350000, years: 30, apr: 6.5, extra: 0, tax: 7200, ins: 1800, hoa: 0 },
  auto25: { loanType: "auto", principal: 25000, years: 5, apr: 7.9, extra: 0 },
  student40: { loanType: "student", principal: 40000, years: 10, apr: 6.0, extra: 0 },
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
    els.extraPayment.value = String(s.extra ?? 0);
  }

  if (s.loanType === "mortgage") {
    els.annualTax.value = s.tax ?? "";
    els.annualIns.value = s.ins ?? "";
    els.monthlyHOA.value = String(s.hoa ?? 0);
  }

  els.delta.value = "0";
  els.customDeltaWrap.style.display = "none";
  showHideFields();
  setStatus("Scenario loaded. Click Calculate.");
  window.location.hash = "#calculator";
}

// ---------- Compare Mode ----------
const cmp = {
  aType: $("aType"), bType: $("bType"),
  aP: $("aP"), aTerm: $("aTerm"), aApr: $("aApr"), aExtra: $("aExtra"),
  bP: $("bP"), bTerm: $("bTerm"), bApr: $("bApr"), bExtra: $("bExtra"),
  aTax: $("aTax"), aIns: $("aIns"), aHoa: $("aHoa"),
  bTax: $("bTax"), bIns: $("bIns"), bHoa: $("bHoa"),
  btn: $("compareBtn"),
  copyBtn: $("compareCopyBtn"),
  status: $("compareStatus"),
  tbody: $("compareTable")?.querySelector("tbody"),
};

let lastCompareSummary = "";

function addonsMonthlyFor(annualTax, annualIns, feesMonthly) {
  const taxesMonthly = safeNum(annualTax, 0) / 12;
  const insuranceMonthly = safeNum(annualIns, 0) / 12;
  const housingFeesMonthly = safeNum(feesMonthly, 0);
  return taxesMonthly + insuranceMonthly + housingFeesMonthly;
}

function loanMetrics(type, P, termY, apr, extra, tax, ins, fees) {
  const sched = amortizationSchedule(P, apr, termY, extra);
  const monthlyPayment = sched.monthlyPaymentBase;
  const months = sched.months;
  const totalInterest = sched.totalInterest;

  let totalMonthlyHousingCost = null;
  if (type === "mortgage") {
    const addons = addonsMonthlyFor(tax, ins, fees);
    totalMonthlyHousingCost = monthlyPayment + addons;
  }

  return { monthlyPayment, months, totalInterest, totalMonthlyHousingCost };
}

function renderCompareTable(rows) {
  cmp.tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.metric}</td><td>${r.a}</td><td>${r.b}</td><td>${r.diff}</td>`;
    cmp.tbody.appendChild(tr);
  }
}

function runCompare() {
  if (!cmp.tbody) return;
  cmp.status.textContent = "";

  const aType = cmp.aType.value;
  const bType = cmp.bType.value;

  const aP = safeNum(cmp.aP.value, NaN);
  const bP = safeNum(cmp.bP.value, NaN);
  const aTerm = safeNum(cmp.aTerm.value, NaN);
  const bTerm = safeNum(cmp.bTerm.value, NaN);
  const aApr = safeNum(cmp.aApr.value, NaN);
  const bApr = safeNum(cmp.bApr.value, NaN);
  const aExtra = safeNum(cmp.aExtra.value, 0);
  const bExtra = safeNum(cmp.bExtra.value, 0);

  if (!(aP > 0 && bP > 0 && aTerm > 0 && bTerm > 0 && aApr >= 0 && bApr >= 0)) {
    cmp.status.textContent = "Fill in loan balance, length, and interest rate for both loans.";
    return;
  }

  const A = loanMetrics(aType, aP, aTerm, aApr, aExtra, cmp.aTax?.value, cmp.aIns?.value, cmp.aHoa?.value);
  const B = loanMetrics(bType, bP, bTerm, bApr, bExtra, cmp.bTax?.value, cmp.bIns?.value, cmp.bHoa?.value);

  const rows = [
    {
      metric: "Monthly loan payment",
      a: fmtUSD2(A.monthlyPayment),
      b: fmtUSD2(B.monthlyPayment),
      diff: (B.monthlyPayment - A.monthlyPayment >= 0 ? "+" : "") + fmtUSD2(B.monthlyPayment - A.monthlyPayment),
    },
    {
      metric: "Total interest paid",
      a: fmtUSD2(A.totalInterest),
      b: fmtUSD2(B.totalInterest),
      diff: (B.totalInterest - A.totalInterest >= 0 ? "+" : "") + fmtUSD2(B.totalInterest - A.totalInterest),
    },
    {
      metric: "Payoff time",
      a: `${A.months} months`,
      b: `${B.months} months`,
      diff: (B.months - A.months >= 0 ? "+" : "") + `${B.months - A.months} months`,
    },
  ];

  if (aType === "mortgage" || bType === "mortgage") {
    const aVal = (A.totalMonthlyHousingCost == null) ? "—" : fmtUSD2(A.totalMonthlyHousingCost);
    const bVal = (B.totalMonthlyHousingCost == null) ? "—" : fmtUSD2(B.totalMonthlyHousingCost);

    let diff = "—";
    if (A.totalMonthlyHousingCost != null && B.totalMonthlyHousingCost != null) {
      diff = (B.totalMonthlyHousingCost - A.totalMonthlyHousingCost >= 0 ? "+" : "") + fmtUSD2(B.totalMonthlyHousingCost - A.totalMonthlyHousingCost);
    }

    rows.push({
      metric: "Total monthly housing cost (mortgages)",
      a: aVal,
      b: bVal,
      diff
    });
  }

  renderCompareTable(rows);

  lastCompareSummary =
    `RateSense comparison\n\n` +
    `Loan A (${aType}): balance ${fmtUSD2(aP)}, length ${aTerm} years, interest rate ${aApr.toFixed(2)}%, extra ${fmtUSD2(aExtra)}\n` +
    `  Monthly payment: ${fmtUSD2(A.monthlyPayment)} | Total interest: ${fmtUSD2(A.totalInterest)} | Payoff: ${A.months} months` +
    `${A.totalMonthlyHousingCost != null ? ` | Total monthly housing cost: ${fmtUSD2(A.totalMonthlyHousingCost)}` : ""}\n\n` +
    `Loan B (${bType}): balance ${fmtUSD2(bP)}, length ${bTerm} years, interest rate ${bApr.toFixed(2)}%, extra ${fmtUSD2(bExtra)}\n` +
    `  Monthly payment: ${fmtUSD2(B.monthlyPayment)} | Total interest: ${fmtUSD2(B.totalInterest)} | Payoff: ${B.months} months` +
    `${B.totalMonthlyHousingCost != null ? ` | Total monthly housing cost: ${fmtUSD2(B.totalMonthlyHousingCost)}` : ""}\n\n` +
    `Educational only; not financial advice.`;

  cmp.status.textContent = "Comparison complete.";
  setTimeout(() => cmp.status.textContent = "", 1500);
}

function initCompareDefaults() {
  if (!cmp.aType) return;
  cmp.aType.value = "mortgage";
  cmp.bType.value = "mortgage";
  cmp.aP.value = 350000;
  cmp.bP.value = 350000;
  cmp.aTerm.value = 30;
  cmp.bTerm.value = 30;
  cmp.aApr.value = 7.10;
  cmp.bApr.value = 6.25;
  cmp.aExtra.value = 0;
  cmp.bExtra.value = 0;

  if (cmp.aTax) cmp.aTax.value = 7200;
  if (cmp.aIns) cmp.aIns.value = 1800;
  if (cmp.aHoa) cmp.aHoa.value = 0;

  if (cmp.bTax) cmp.bTax.value = 7200;
  if (cmp.bIns) cmp.bIns.value = 1800;
  if (cmp.bHoa) cmp.bHoa.value = 0;
}

// ---------- Events ----------
els.loanType.addEventListener("change", showHideFields);
els.delta.addEventListener("change", () => {
  els.customDeltaWrap.style.display = (els.delta.value === "custom") ? "" : "none";
});

$("calcBtn").addEventListener("click", calculateAndRender);
$("resetBtn").addEventListener("click", resetAll);

els.copyBtn.addEventListener("click", () => {
  if (!lastSummary) return setStatus("Run a calculation first.");
  copyToClipboard(lastSummary, "Summary copied.", els.status);
});
els.shareBtn.addEventListener("click", () => {
  const link = buildShareURL();
  copyToClipboard(link, "Share link copied.", els.status);
});
els.csvBtn.addEventListener("click", () => {
  if (!lastBaselineSchedule?.schedule?.length) {
    setStatus("Run a mortgage/auto/student calculation first to export a schedule.");
    return;
  }
  const csv = scheduleToCSV(lastBaselineSchedule);
  downloadText("ratesense_schedule.csv", csv, "text/csv");
  setStatus("CSV downloaded.");
  setTimeout(() => setStatus(""), 1500);
});
els.printBtn.addEventListener("click", () => {
  if (!lastSummary) setStatus("Tip: run a calculation first for a complete report.");
  updateReportBlocks();
  window.print();
});

els.chartBalanceBtn.addEventListener("click", () => {
  chartMode = "balance";
  if (lastBaselineSchedule) buildChart(lastBaselineSchedule);
});
els.chartSplitBtn.addEventListener("click", () => {
  chartMode = "split";
  if (lastBaselineSchedule) buildChart(lastBaselineSchedule);
});

document.querySelectorAll("[data-scenario]").forEach(btn => {
  btn.addEventListener("click", () => loadScenario(btn.dataset.scenario));
});

if (cmp.btn) {
  cmp.btn.addEventListener("click", runCompare);
  cmp.copyBtn.addEventListener("click", () => {
    if (!lastCompareSummary) return (cmp.status.textContent = "Run comparison first.");
    copyToClipboard(lastCompareSummary, "Comparison copied.", cmp.status);
  });
  initCompareDefaults();
}

applyParamsFromURL();
showHideFields();
updateReportBlocks();
