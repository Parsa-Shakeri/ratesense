"use strict";

/* =========================================================
   Helpers
   ========================================================= */
const $ = (id) => document.getElementById(id);

function fmtUSD(x) {
  if (!isFinite(x)) return "—";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}
function fmtUSD2(x) {
  if (!isFinite(x)) return "—";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}
function fmtPct(x) {
  if (!isFinite(x)) return "—";
  return (x * 100).toFixed(2) + "%";
}
function safeNum(v, d = 0) {
  const x = parseFloat(v);
  return isFinite(x) ? x : d;
}

function copyText(text, statusEl, ok = "Copied.") {
  navigator.clipboard.writeText(text).then(() => {
    if (statusEl) {
      statusEl.textContent = ok;
      setTimeout(() => (statusEl.textContent = ""), 1400);
    }
  });
}

/* =========================================================
   Core finance math
   ========================================================= */
function monthlyPayment(P, apr, years) {
  const r = apr / 100 / 12;
  const n = years * 12;
  if (r === 0) return P / n;
  const pow = Math.pow(1 + r, n);
  return P * (r * pow) / (pow - 1);
}

function amortSchedule(P, apr, years, extra = 0) {
  const r = apr / 100 / 12;
  const base = monthlyPayment(P, apr, years);
  let bal = P;
  let month = 0;
  let totalInterest = 0;
  const rows = [];

  while (bal > 0.01 && month < 1200) {
    month++;
    const interest = r === 0 ? 0 : bal * r;
    let pay = Math.min(base + extra, bal + interest);
    const principal = pay - interest;
    bal -= principal;
    totalInterest += interest;

    rows.push({
      month,
      payment: pay,
      interest,
      principal,
      balance: Math.max(0, bal)
    });
  }

  return {
    rows,
    months: rows.length,
    basePayment: base,
    totalInterest,
    totalPaid: P + totalInterest
  };
}

/* =========================================================
   Elements
   ========================================================= */
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

  annualTax: $("annualTax"),
  annualIns: $("annualIns"),
  monthlyHOA: $("monthlyHOA"),

  calcBtn: $("calcBtn"),
  resetBtn: $("resetBtn"),
  status: $("status"),

  baseMonthly: $("baseMonthly"),
  baseNote: $("baseNote"),
  newMonthly: $("newMonthly"),
  deltaMonthly: $("deltaMonthly"),

  baseInterest: $("baseInterest"),
  baseTotalPaid: $("baseTotalPaid"),
  newInterest: $("newInterest"),
  deltaInterest: $("deltaInterest"),

  pitiRow: $("pitiRow"),
  basePITI: $("basePITI"),
  newPITI: $("newPITI"),
  pitiAddons: $("pitiAddons"),
  pitiDeltaAbs: $("pitiDeltaAbs"),
  pitiDeltaPct: $("pitiDeltaPct"),

  scenarioBody: $("scenarioTable")?.querySelector("tbody"),

  chart: $("chart"),
  chartBalanceBtn: $("chartBalanceBtn"),
  chartSplitBtn: $("chartSplitBtn"),

  copyBtn: $("copyBtn"),
  shareBtn: $("shareBtn"),
  csvBtn: $("csvBtn"),
  printBtn: $("printBtn"),

  reportDate: $("reportDate"),
  reportInputs: $("reportInputs"),
  reportResults: $("reportResults"),
  reportRefi: $("reportRefi")
};

/* =========================================================
   UI logic
   ========================================================= */
function showHideFields() {
  const t = els.loanType.value;
  document.querySelectorAll(".amortizedOnly").forEach(el =>
    el.style.display = t === "creditcard" ? "none" : ""
  );
  document.querySelectorAll(".creditOnly").forEach(el =>
    el.style.display = t === "creditcard" ? "" : "none"
  );
  document.querySelectorAll(".mortgageOnly").forEach(el =>
    el.style.display = t === "mortgage" ? "" : "none"
  );
  els.pitiRow.style.display = "none";
}

function getDelta() {
  if (els.delta.value === "custom") return safeNum(els.customDelta.value, 0);
  return safeNum(els.delta.value, 0);
}

/* =========================================================
   Chart
   ========================================================= */
let chart = null;
let chartMode = "balance";

function buildChart(schedule) {
  if (!schedule?.rows?.length) return;

  const labels = schedule.rows.map(r => r.month);
  const balance = schedule.rows.map(r => r.balance);
  const interest = schedule.rows.map(r => r.interest);
  const principal = schedule.rows.map(r => r.principal);

  if (chart) chart.destroy();

  const datasets =
    chartMode === "balance"
      ? [{
          label: "Remaining balance",
          data: balance,
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          fill: true
        }]
      : [
          { label: "Interest", data: interest, borderWidth: 2, tension: 0.25, pointRadius: 0 },
          { label: "Principal", data: principal, borderWidth: 2, tension: 0.25, pointRadius: 0 }
        ];

  chart = new Chart(els.chart, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            title: (i) => `Month ${i[0].label}`,
            label: (i) => `${i.dataset.label}: ${fmtUSD(i.raw)}`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => fmtUSD(v)
          }
        }
      }
    }
  });
}

/* =========================================================
   Main calculation
   ========================================================= */
let lastSchedule = null;
let lastSummary = "";

function calculate() {
  const P = safeNum(els.principal.value, NaN);
  const apr = safeNum(els.apr.value, NaN);
  if (!(P > 0 && apr >= 0)) {
    els.status.textContent = "Enter a valid balance and interest rate.";
    return;
  }

  const delta = getDelta();
  const aprNew = apr + delta;

  if (els.loanType.value === "creditcard") {
    els.status.textContent = "Credit card mode summary only.";
    return;
  }

  const years = safeNum(els.termYears.value, NaN);
  const extra = safeNum(els.extraPayment.value, 0);

  const base = amortSchedule(P, apr, years, extra);
  const next = amortSchedule(P, aprNew, years, extra);

  els.baseMonthly.textContent = fmtUSD(base.basePayment);
  els.baseNote.textContent = `Payoff time: ${base.months} months`;
  els.baseInterest.textContent = fmtUSD(base.totalInterest);
  els.baseTotalPaid.textContent = `Total paid: ${fmtUSD(base.totalPaid)}`;

  els.newMonthly.textContent = fmtUSD(next.basePayment);
  els.deltaMonthly.textContent =
    `${fmtUSD(next.basePayment - base.basePayment)} (${fmtPct((next.basePayment - base.basePayment) / base.basePayment)})`;

  els.newInterest.textContent = fmtUSD(next.totalInterest);
  els.deltaInterest.textContent =
    `${fmtUSD(next.totalInterest - base.totalInterest)} interest`;

  if (els.loanType.value === "mortgage") {
    const addons =
      safeNum(els.annualTax.value, 0) / 12 +
      safeNum(els.annualIns.value, 0) / 12 +
      safeNum(els.monthlyHOA.value, 0);

    if (addons > 0) {
      const baseHousing = base.basePayment + addons;
      const newHousing = next.basePayment + addons;
      els.pitiRow.style.display = "";
      els.basePITI.textContent = fmtUSD(baseHousing);
      els.newPITI.textContent = fmtUSD(newHousing);
      els.pitiAddons.textContent = fmtUSD(addons);
      els.pitiDeltaAbs.textContent = fmtUSD(newHousing - baseHousing);
      els.pitiDeltaPct.textContent = fmtPct((newHousing - baseHousing) / baseHousing);
    }
  }

  if (els.scenarioBody) {
    els.scenarioBody.innerHTML = `
      <tr><td>Baseline</td><td>${apr.toFixed(2)}%</td><td>${fmtUSD(base.basePayment)}</td><td>${fmtUSD(base.totalInterest)}</td><td>—</td><td>—</td></tr>
      <tr><td>Scenario</td><td>${aprNew.toFixed(2)}%</td><td>${fmtUSD(next.basePayment)}</td><td>${fmtUSD(next.totalInterest)}</td>
      <td>${fmtUSD(next.basePayment - base.basePayment)}</td>
      <td>${fmtUSD(next.totalInterest - base.totalInterest)}</td></tr>
    `;
  }

  buildChart(base);
  lastSchedule = base;

  lastSummary =
`RateSense Summary
Loan balance: ${fmtUSD(P)}
Loan length: ${years} years
Baseline APR: ${apr.toFixed(2)}%
Scenario APR: ${aprNew.toFixed(2)}%

Baseline payment: ${fmtUSD(base.basePayment)}
Scenario payment: ${fmtUSD(next.basePayment)}

Baseline interest: ${fmtUSD(base.totalInterest)}
Scenario interest: ${fmtUSD(next.totalInterest)}

Educational use only.`;

  els.status.textContent = "";
}

/* =========================================================
   CSV + Share
   ========================================================= */
function exportCSV() {
  if (!lastSchedule) return;
  let csv = "Month,Payment,Interest,Principal,Balance\n";
  lastSchedule.rows.forEach(r => {
    csv += `${r.month},${r.payment.toFixed(2)},${r.interest.toFixed(2)},${r.principal.toFixed(2)},${r.balance.toFixed(2)}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ratesense_schedule.csv";
  a.click();
}

function shareLink() {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("p", els.principal.value);
  url.searchParams.set("apr", els.apr.value);
  url.searchParams.set("term", els.termYears.value);
  url.searchParams.set("delta", els.delta.value);
  copyText(url.toString(), els.status, "Share link copied.");
}

/* =========================================================
   Events
   ========================================================= */
els.loanType.addEventListener("change", showHideFields);
els.delta.addEventListener("change", () => {
  els.customDeltaWrap.style.display =
    els.delta.value === "custom" ? "" : "none";
});

els.calcBtn.addEventListener("click", calculate);
els.resetBtn.addEventListener("click", () => location.reload());

els.copyBtn.addEventListener("click", () => {
  if (!lastSummary) return;
  copyText(lastSummary, els.status, "Summary copied.");
});
els.shareBtn.addEventListener("click", shareLink);
els.csvBtn.addEventListener("click", exportCSV);
els.printBtn.addEventListener("click", () => window.print());

els.chartBalanceBtn.addEventListener("click", () => {
  chartMode = "balance";
  if (lastSchedule) buildChart(lastSchedule);
});
els.chartSplitBtn.addEventListener("click", () => {
  chartMode = "split";
  if (lastSchedule) buildChart(lastSchedule);
});

/* =========================================================
   Init
   ========================================================= */
showHideFields();
