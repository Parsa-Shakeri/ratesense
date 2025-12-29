"use strict";

/* =========================================================
   Helpers
   ========================================================= */
const $ = (id) => document.getElementById(id);

function safeNum(v, d = NaN) {
  const x = parseFloat(v);
  return isFinite(x) ? x : d;
}
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

/* =========================================================
   Mobile menu (shared behavior)
   ========================================================= */
(function initMenu(){
  const btn = $("menuBtn");
  const nav = $("nav");
  if (!btn || !nav) return;
  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => {
      nav.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    });
  });
})();

/* =========================================================
   Core loan math
   ========================================================= */
function monthlyPayment(P, apr, months) {
  const r = apr / 100 / 12;
  if (r === 0) return P / months;
  const pow = Math.pow(1 + r, months);
  return P * (r * pow) / (pow - 1);
}

/* =========================================================
   Stress test engine
   =========================================================
   - Supports fixed-rate baseline
   - Rate shock paths (stepwise increases)
   - ARM-style periodic resets
========================================================= */

function runStressTest(cfg) {
  let balance = cfg.principal;
  let rate = cfg.startApr;
  let month = 0;

  const results = [];
  let maxPayment = 0;
  let totalInterest = 0;

  while (balance > 0.01 && month < cfg.maxMonths) {
    month++;

    // Apply rate shock
    if (
      cfg.shockEvery > 0 &&
      month <= cfg.shockMonths &&
      month % cfg.shockEvery === 0
    ) {
      rate += cfg.shockSize;
    }

    // ARM reset
    if (cfg.armResetEvery > 0 && month % cfg.armResetEvery === 0) {
      rate = Math.min(rate + cfg.armDelta, cfg.armCap);
    }

    const remainingMonths = Math.max(1, cfg.maxMonths - month + 1);
    const payment = monthlyPayment(balance, rate, remainingMonths);

    const interest = balance * (rate / 100 / 12);
    const principalPaid = payment - interest;

    balance -= principalPaid;
    totalInterest += interest;
    maxPayment = Math.max(maxPayment, payment);

    results.push({
      month,
      rate,
      payment,
      interest,
      balance: Math.max(0, balance)
    });
  }

  return {
    rows: results,
    months: results.length,
    maxPayment,
    totalInterest
  };
}

/* =========================================================
   Elements
   ========================================================= */
const els = {
  principal: $("stressPrincipal"),
  termYears: $("stressYears"),
  startApr: $("stressApr"),

  shockSize: $("shockSize"),
  shockEvery: $("shockEvery"),
  shockMonths: $("shockMonths"),

  armResetEvery: $("armResetEvery"),
  armDelta: $("armDelta"),
  armCap: $("armCap"),

  runBtn: $("stressRunBtn"),
  status: $("stressStatus"),

  maxPayment: $("stressMaxPayment"),
  totalInterest: $("stressTotalInterest"),
  payoffTime: $("stressPayoff"),

  chart: $("stressChart"),
  copyBtn: $("stressCopyBtn")
};

/* =========================================================
   Chart
   ========================================================= */
let chart = null;

function buildChart(rows) {
  if (!rows?.length) return;

  const labels = rows.map(r => r.month);
  const payment = rows.map(r => r.payment);
  const rate = rows.map(r => r.rate);

  if (chart) chart.destroy();

  chart = new Chart(els.chart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Monthly payment ($)",
          data: payment,
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          yAxisID: "y"
        },
        {
          label: "Interest rate (%)",
          data: rate,
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ctx.dataset.label.includes("rate")
                ? `${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%`
                : `${ctx.dataset.label}: ${fmtUSD(ctx.raw)}`
          }
        }
      },
      scales: {
        y: {
          title: { display: true, text: "Monthly payment ($)" },
          ticks: { callback: v => fmtUSD(v) }
        },
        y1: {
          position: "right",
          title: { display: true, text: "Interest rate (%)" },
          grid: { drawOnChartArea: false },
          ticks: { callback: v => v.toFixed(1) + "%" }
        }
      }
    }
  });
}

/* =========================================================
   Run stress test
   ========================================================= */
let lastSummary = "";

function runStress() {
  const P = safeNum(els.principal.value, NaN);
  const years = safeNum(els.termYears.value, NaN);
  const startApr = safeNum(els.startApr.value, NaN);

  if (!(P > 0 && years > 0 && startApr >= 0)) {
    els.status.textContent = "Enter principal, years, and starting APR.";
    return;
  }

  const cfg = {
    principal: P,
    startApr,
    maxMonths: years * 12,

    shockSize: safeNum(els.shockSize.value, 0),
    shockEvery: safeNum(els.shockEvery.value, 0),
    shockMonths: safeNum(els.shockMonths.value, 0),

    armResetEvery: safeNum(els.armResetEvery.value, 0),
    armDelta: safeNum(els.armDelta.value, 0),
    armCap: safeNum(els.armCap.value, Infinity)
  };

  const out = runStressTest(cfg);

  els.maxPayment.textContent = fmtUSD(out.maxPayment);
  els.totalInterest.textContent = fmtUSD(out.totalInterest);
  els.payoffTime.textContent = `${out.months} months`;

  buildChart(out.rows);

  lastSummary =
`RateSense Stress Test

Loan balance: ${fmtUSD(P)}
Term: ${years} years
Starting APR: ${startApr.toFixed(2)}%

Shock size: ${cfg.shockSize.toFixed(2)}%
Shock frequency: every ${cfg.shockEvery || "—"} months
Shock duration: ${cfg.shockMonths || "—"} months

ARM reset: every ${cfg.armResetEvery || "—"} months
ARM step: ${cfg.armDelta.toFixed(2)}%
Rate cap: ${isFinite(cfg.armCap) ? cfg.armCap.toFixed(2) + "%" : "None"}

Worst monthly payment: ${fmtUSD(out.maxPayment)}
Total interest paid: ${fmtUSD(out.totalInterest)}
Payoff time: ${out.months} months

Educational use only.`;

  els.status.textContent = "";
}

/* =========================================================
   Events
   ========================================================= */
els.runBtn?.addEventListener("click", runStress);
els.copyBtn?.addEventListener("click", () => {
  if (!lastSummary) return;
  navigator.clipboard.writeText(lastSummary);
  els.status.textContent = "Summary copied.";
  setTimeout(() => (els.status.textContent = ""), 1500);
});
