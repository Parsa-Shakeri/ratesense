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

  // Mortgage add-ons
  annualTax: $("annualTax"),
  annualIns: $("annualIns"),
  monthlyHOA: $("monthlyHOA"),
  pitiRow: $("pitiRow"),
  basePITI: $("basePITI"),
  newPITI: $("newPITI"),
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

function showHideFields() {
  const type = els.loanType.value;
  const isCC = type === "creditcard";
  const isMortgage = type === "mortgage";

  document.querySelectorAll(".amortizedOnly").forEach(el => el.style.display = isCC ? "none" : "");
  document.querySelectorAll(".creditOnly").forEach(el => el.style.display = isCC ? "" : "none");
  document.querySelectorAll(".mortgageOnly").forEach(el => el.style.display = isMortgage ? "" : "none");

  // PITI row display happens after calculation
  els.pitiRow.style.display = "none";
}

function getDelta() {
  if (els.delta.value === "custom") {
    const c = safeNum(els.customDelta.value, 0);
    return c;
  }
  return safeNum(els.delta.value, 0);
}

function validateInputs() {
  const principal = safeNum(els.principal.value, NaN);
  const apr = safeNum(els.apr.value, NaN);
  if (!(principal > 0)) return { ok: false, msg: "Enter a principal/balance > 0." };
  if (!(apr >= 0)) return { ok: false, msg: "Enter APR (>= 0)." };

  if (els.loanType.value !== "creditcard") {
    const years = safeNum(els.termYears.value, NaN);
    if (!(years > 0)) return { ok: false, msg: "Enter term in years > 0." };
    const extra = safeNum(els.extraPayment.value, 0);
    if (!(extra >= 0)) return { ok: false, msg: "Extra payment must be >= 0." };
  } else {
    const mode = els.ccMode.value;
    if (mode === "fixed") {
      const fp = safeNum(els.ccFixedPayment.value, NaN);
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
        { label: "Interest portion (monthly)", data: intP, borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "Principal portion (monthly)", data: prinP, borderWidth: 2, pointRadius: 0, tension: 0.25 }
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

    // Mortgage add-ons
    if (loanType === "mortgage") {
      setParam(url, "tax", els.annualTax.value);
      setParam(url, "ins", els.annualIns.value);
      setParam(url, "hoa", els.monthlyHOA.value);
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

  const principal = p.get("p");
  const apr = p.get("apr");
  const term = p.get("term");
  const extra = p.get("extra");
  const delta = p.get("delta");
  const cdelta = p.get("cdelta");

  if (principal) els.principal.value = principal;
  if (apr) els.apr.value = apr;
  if (delta) els.delta.value = delta;

  els.customDeltaWrap.style.display = (els.delta.value === "custom") ? "" : "none";
  if (cdelta) els.customDelta.value = cdelta;

  if (els.loanType.value !== "creditcard") {
    if (term) els.termYears.value = term;
    if (extra) els.extraPayment.value = extra;

    const refiapr = p.get("refiapr");
    const reficost = p.get("reficost");
    const keep = p.get("keep");
    if (refiapr) els.refiNewApr.value = refiapr;
    if (reficost) els.refiClosingCosts.value = reficost;
    if (keep) els.refiKeepYears.value = keep;

    if (els.loanType.value === "mortgage") {
      const tax = p.get("tax");
      const ins = p.get("ins");
      const hoa = p.get("hoa");
      if (tax) els.annualTax.value = tax;
      if (ins) els.annualIns.value = ins;
      if (hoa) els.monthlyHOA.value = hoa;
    }
  } else {
    const ccmode = p.get("ccmode");
    const ccpay = p.get("ccpay");
    if (ccmode) els.ccMode.value = ccmode;
    if (ccpay) els.ccFixedPayment.value = ccpay;
  }

  showHideFields();
  setStatus("Loaded from share link. Click Calculate.");
}

// ---------- CSV Export ----------
function scheduleToCSV(scheduleObj) {
  const lines = [];
  lines.push(["Month","Payment","Interest","Principal","Balance"].join(","));

  let sumPay = 0, sumInt = 0, sumPrin = 0;
  for (const row of scheduleObj.schedule) {
    sumPay += row.payment;
    sumInt += row.interest;
    sumPrin += row.principal;
    lines.push([
      row.month,
      row.payment.toFixed(2),
      row.interest.toFixed(2),
      row.principal.toFixed(2),
      row.balance.toFixed(2)
    ].join(","));
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
  inputLines.push(`Principal/balance: ${fmtUSD2(safeNum(els.principal.value, NaN))}`);
  inputLines.push(`APR: ${safeNum(els.apr.value, NaN).toFixed(2)}%`);
  inputLines.push(`Rate scenario: +${delta.toFixed(2)}%`);

  if (loanType !== "creditcard") {
    inputLines.push(`Term: ${safeNum(els.termYears.value, NaN)} years`);
    inputLines.push(`Extra payment: ${fmtUSD2(safeNum(els.extraPayment.value, 0))}`);
    if (loanType === "mortgage") {
      const taxM = safeNum(els.annualTax.value, 0) / 12;
      const insM = safeNum(els.annualIns.value, 0) / 12;
      const hoaM = safeNum(els.monthlyHOA.value, 0);
      inputLines.push(`PITI add-ons (monthly): tax ${fmtUSD2(taxM)}, ins ${fmtUSD2(insM)}, HOA ${fmtUSD2(hoaM)}`);
    }
  } else {
    inputLines.push(`CC mode: ${els.ccMode.value}`);
    if (els.ccMode.value === "fixed") inputLines.push(`Fixed payment: ${fmtUSD2(safeNum(els.ccFixedPayment.value, NaN))}`);
  }

  els.reportInputs.textContent = inputLines.join("\n");

  const resultsLines = [];
  resultsLines.push(`Baseline monthly: ${els.baseMonthly.textContent}`);
  if (els.baseNote.textContent) resultsLines.push(`${els.baseNote.textContent}`);
  resultsLines.push(`Baseline interest: ${els.baseInterest.textContent}`);
  if (els.baseTotalPaid.textContent) resultsLines.push(`${els.baseTotalPaid.textContent}`);
  resultsLines.push("");
  resultsLines.push(`Scenario monthly: ${els.newMonthly.textContent}`);
  resultsLines.push(`Δ monthly: ${els.deltaMonthly.textContent}`);
  resultsLines.push(`Scenario interest: ${els.newInterest.textContent}`);
  resultsLines.push(`Δ interest: ${els.deltaInterest.textContent}`);

  if (loanType === "mortgage" && els.pitiRow.style.display !== "none") {
    resultsLines.push("");
    resultsLines.push(`Baseline PITI: ${els.basePITI.textContent}`);
    resultsLines.push(`Scenario PITI: ${els.newPITI.textContent}`);
    resultsLines.push(`Δ PITI: ${els.pitiDeltaAbs.textContent} (${els.pitiDeltaPct.textContent})`);
  }

  els.reportResults.textContent = resultsLines.join("\n");

  const refiLines = [];
  refiLines.push(`New APR: ${els.refiNewApr.value || "—"}`);
  refiLines.push(`Closing costs: ${els.refiClosingCosts.value ? fmtUSD2(safeNum(els.refiClosingCosts.value, 0)) : "—"}`);
  refiLines.push(`Keep years: ${els.refiKeepYears.value || "—"}`);
  refiLines.push(`Break-even: ${els.refiBreakeven.textContent}`);
  refiLines.push(`Savings: ${els.refiSavings.textContent}`);
  els.reportRefi.textContent = refiLines.join("\n");
}

// ---------- Copy summary ----------
let lastSummary = "";
let lastBaselineSchedule = null;

function copyToClipboard(text, okMsg="Copied.") {
  navigator.clipboard.writeText(text).then(() => {
    setStatus(okMsg);
    setTimeout(() => setStatus(""), 1500);
  }).catch(() => setStatus("Copy failed (clipboard blocked)."));
}

// ---------- PITI helpers ----------
function mortgageAddonsMonthly() {
  const taxM = safeNum(els.annualTax.value, 0) / 12;
  const insM = safeNum(els.annualIns.value, 0) / 12;
  const hoaM = safeNum(els.monthlyHOA.value, 0);
  return { taxM, insM, hoaM, addons: taxM + insM + hoaM };
}

// ---------- Main Calculation ----------
function calculateAndRender() {
  const v = validateInputs();
  if (!v.ok) { setStatus(v.msg); return; }
  setStatus("");

  const loanType = els.loanType.value;
  const principal = safeNum(els.principal.value, NaN);
  const apr = safeNum(els.apr.value, NaN);
  const delta = getDelta();
  const aprNew = apr + delta;

  // Hide PITI row unless we explicitly show it for mortgage after calc
  els.pitiRow.style.display = "none";

  if (loanType === "creditcard") {
    const mode = els.ccMode.value;
    const fixed = safeNum(els.ccFixedPayment.value, NaN);

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

    if (chart) { chart.destroy(); chart = null; }
    lastBaselineSchedule = null;

    els.refiBreakeven.textContent = "—";
    els.refiSavings.textContent = "Refinance applies to amortized loans only.";

    lastSummary =
      `RateSense summary (Credit Card)\n` +
      `Balance: ${fmtUSD2(principal)}\nAPR: ${apr.toFixed(2)}% (Scenario: +${delta.toFixed(2)}% => ${(aprNew).toFixed(2)}%)\n` +
      `Baseline payoff: ${base.months} months, total interest ${fmtUSD2(base.totalInterest)}\n` +
      `New payoff: ${next.months} months, total interest ${fmtUSD2(next.totalInterest)}\n` +
      `Δ interest: ${fmtUSD2(next.totalInterest - base.totalInterest)}\n` +
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
  els.baseNote.textContent = `Payoff: ${baseSched.months} months${extra > 0 ? " (with extra payment)" : ""}`;
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

  // Mortgage PITI display
  if (loanType === "mortgage") {
    const { taxM, insM, hoaM, addons } = mortgageAddonsMonthly();
    const basePITI = baseMonthly + addons;
    const newPITI = newMonthly + addons;
    const dP = newPITI - basePITI;

    // Only show if user entered anything OR if it's non-zero
    if (addons > 0) {
      els.pitiRow.style.display = "";
      els.basePITI.textContent = fmtUSD2(basePITI);
      els.newPITI.textContent = fmtUSD2(newPITI);
      els.pitiAddons.textContent = fmtUSD2(addons);
      els.pitiDeltaAbs.textContent = (dP >= 0 ? "+" : "") + fmtUSD2(dP);
      els.pitiDeltaPct.textContent = fmtPct(dP / basePITI);
    }
  }

  // Refi
  const refiApr = safeNum(els.refiNewApr.value, NaN);
  const closingCosts = safeNum(els.refiClosingCosts.value, NaN);
  const keepYears = safeNum(els.refiKeepYears.value, NaN);

  if (isFinite(refiApr) && isFinite(closingCosts) && closingCosts >= 0 && isFinite(keepYears) && keepYears > 0) {
    const r = refinanceBreakeven(principal, apr, refiApr, years, extra, closingCosts, keepYears);
    if (r.breakevenMonth === null) els.refiBreakeven.textContent = "No break-even within keep period";
    else els.refiBreakeven.textContent = `${r.breakevenMonth} months (~${(r.breakevenMonth/12).toFixed(1)} yrs)`;
    els.refiSavings.textContent = `Estimated net savings over ${keepYears} years: ${fmtUSD2(r.netSavings)} (after closing costs)`;
  } else {
    els.refiBreakeven.textContent = "—";
    els.refiSavings.textContent = "Enter new APR, closing costs, and keep years.";
  }

  const addonsText = (loanType === "mortgage")
    ? (() => {
        const { taxM, insM, hoaM, addons } = mortgageAddonsMonthly();
        return `\nMortgage add-ons (monthly): tax ${fmtUSD2(taxM)}, ins ${fmtUSD2(insM)}, HOA ${fmtUSD2(hoaM)} (total ${fmtUSD2(addons)})`;
      })()
    : "";

  lastSummary =
    `RateSense summary (${loanType})\n` +
    `Principal: ${fmtUSD2(principal)}\nTerm: ${years} years\nAPR baseline: ${apr.toFixed(2)}%\nExtra monthly payment: ${fmtUSD2(extra)}\n` +
    `Scenario: +${delta.toFixed(2)}% => APR ${(aprNew).toFixed(2)}%` +
    `${addonsText}\n\n` +
    `Baseline monthly (P&I): ${fmtUSD2(baseMonthly)}\nBaseline payoff: ${baseSched.months} months\nBaseline interest: ${fmtUSD2(baseSched.totalInterest)}\n\n` +
    `Scenario monthly (P&I): ${fmtUSD2(newMonthly)}\nScenario interest: ${fmtUSD2(newSched.totalInterest)}\n` +
    `Δ monthly: ${fmtUSD2(dM)}\nΔ interest: ${fmtUSD2(dI)}\n\n` +
    `Educational only; not financial advice.`;

  updateReportBlocks();
}

// ---------- Reset ----------
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

  // Mortgage add-ons defaults
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

// ---------- Scenario Loader ----------
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

// ---------- Events ----------
els.loanType.addEventListener("change", showHideFields);
els.delta.addEventListener("change", () => {
  els.customDeltaWrap.style.display = (els.delta.value === "custom") ? "" : "none";
});

els.calcBtn.addEventListener("click", calculateAndRender);
els.resetBtn.addEventListener("click", resetAll);

els.copyBtn.addEventListener("click", () => {
  if (!lastSummary) return setStatus("Run a calculation first.");
  copyToClipboard(lastSummary, "Summary copied.");
});

els.shareBtn.addEventListener("click", () => {
  const link = buildShareURL();
  copyToClipboard(link, "Share link copied.");
});

els.csvBtn.addEventListener("click", () => {
  if (!lastBaselineSchedule?.schedule?.length) {
    setStatus("Run an amortized loan calc first (mortgage/auto/student).");
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

// init
applyParamsFromURL();
showHideFields();
updateReportBlocks();
