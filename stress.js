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
    maximumFractionDigits: 0,
  });
}
function fmtUSD2(x) {
  if (!isFinite(x)) return "—";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
function fmtPct2(x) {
  if (!isFinite(x)) return "—";
  return x.toFixed(2) + "%";
}

/* =========================================================
   Core amortization for a single month step
   ========================================================= */
function paymentForRemainingMonths(balance, aprPercent, remainingMonths) {
  const r = (aprPercent / 100) / 12;
  const n = Math.max(1, remainingMonths);
  if (r === 0) return balance / n;
  const pow = Math.pow(1 + r, n);
  return balance * (r * pow) / (pow - 1);
}

/* =========================================================
   Stress modes
   =========================================================
   1) steps:
      - increase APR by stStep every stEveryMonths
      - for stDurationMonths
      - optional cap (stCapApr)
   2) arm:
      - fixed period armFixedYears (APR stays at starting APR)
      - after that, every armAdjustEveryMonths:
          APR = clamp( index + margin , with periodic/lifetime caps + optional floor )
      - index comes from:
          - constant (armIndexValue)
          - manual schedule (armIndexSchedule list)
      - (treasury_history is UI-visible but we keep it placeholder-safe: no fetch here)
========================================================= */

function runStressSteps(cfg) {
  const rows = [];
  let balance = cfg.principal;
  let apr = cfg.startApr;
  let totalInterest = 0;
  let worstPayment = 0;
  let worstMonth = 1;

  const maxMonths = cfg.termMonths;

  for (let m = 1; m <= maxMonths && balance > 0.01; m++) {
    // Apply step increases within duration
    if (cfg.everyMonths > 0 && m <= cfg.durationMonths && (m % cfg.everyMonths === 0)) {
      apr += cfg.stepSize;
      if (isFinite(cfg.capApr)) apr = Math.min(apr, cfg.capApr);
    }

    const remainingMonths = maxMonths - m + 1;
    const pay = paymentForRemainingMonths(balance, apr, remainingMonths);

    const interest = balance * (apr / 100 / 12);
    const principalPaid = Math.max(0, pay - interest);
    balance = Math.max(0, balance - principalPaid);

    totalInterest += interest;

    if (pay > worstPayment) {
      worstPayment = pay;
      worstMonth = m;
    }

    rows.push({
      month: m,
      apr,
      payment: pay,
      interest,
      principal: principalPaid,
      balance,
    });
  }

  return { rows, totalInterest, worstPayment, worstMonth };
}

function parseManualSchedule(text) {
  if (!text) return [];
  return text
    .split(/[, \n\r\t]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(v => safeNum(v, NaN))
    .filter(v => isFinite(v));
}

function clamp(v, lo, hi) {
  if (isFinite(lo)) v = Math.max(lo, v);
  if (isFinite(hi)) v = Math.min(hi, v);
  return v;
}

function runStressARM(cfg) {
  const rows = [];
  let balance = cfg.principal;
  let totalInterest = 0;

  const maxMonths = cfg.simMonths ?? cfg.termMonths;
  const fixedMonths = Math.max(0, Math.round(cfg.fixedYears * 12));
  const adjustEvery = Math.max(1, Math.round(cfg.adjustEveryMonths));

  const startApr = cfg.startApr;
  const lifetimeCapAbs = isFinite(cfg.lifetimeCapAboveStart) ? (startApr + cfg.lifetimeCapAboveStart) : Infinity;
  const floorAbs = isFinite(cfg.floorApr) ? cfg.floorApr : -Infinity;

  const manual = cfg.indexMode === "manual_schedule" ? cfg.manualSchedule : [];
  let manualIdx = 0;

  let currentApr = startApr;

  let worstPayment = 0;
  let worstMonth = 1;
  let peakRate = startApr;
  let peakMonth = 1;

  for (let m = 1; m <= maxMonths && balance > 0.01; m++) {
    // Fixed period: keep starting APR
    if (m <= fixedMonths) {
      currentApr = startApr;
    } else {
      // Adjustment month?
      const monthsAfterFixed = m - fixedMonths;
      const isReset = (monthsAfterFixed % adjustEvery === 1); // reset at first month after fixed, then every adjustEvery

      if (isReset) {
        let indexRate = startApr; // fallback

        if (cfg.indexMode === "constant") {
          indexRate = cfg.indexValue;
        } else if (cfg.indexMode === "manual_schedule") {
          indexRate = (manualIdx < manual.length) ? manual[manualIdx] : manual[manual.length - 1];
          manualIdx++;
        } else {
          // treasury_history placeholder (no fetch here)
          // if user chooses it without data, we use constant indexValue if available
          indexRate = isFinite(cfg.indexValue) ? cfg.indexValue : startApr;
        }

        const targetApr = indexRate + cfg.margin;

        // Apply caps:
        // periodic cap: limit change from previous APR
        let nextApr = targetApr;

        if (isFinite(cfg.periodicCap)) {
          nextApr = clamp(nextApr, currentApr - cfg.periodicCap, currentApr + cfg.periodicCap);
        }

        // lifetime cap
        nextApr = Math.min(nextApr, lifetimeCapAbs);

        // floor
        nextApr = Math.max(nextApr, floorAbs);

        currentApr = nextApr;
      }
    }

    peakRate = Math.max(peakRate, currentApr);
    if (peakRate === currentApr) peakMonth = m;

    const remainingMonths = cfg.termMonths - m + 1;
    const pay = paymentForRemainingMonths(balance, currentApr, remainingMonths);

    const interest = balance * (currentApr / 100 / 12);
    const principalPaid = Math.max(0, pay - interest);
    balance = Math.max(0, balance - principalPaid);

    totalInterest += interest;

    if (pay > worstPayment) {
      worstPayment = pay;
      worstMonth = m;
    }

    rows.push({
      month: m,
      apr: currentApr,
      payment: pay,
      interest,
      principal: principalPaid,
      balance,
    });
  }

  return { rows, totalInterest, worstPayment, worstMonth, peakRate, peakMonth };
}

/* =========================================================
   Elements (MATCH stress.html IDs)
   ========================================================= */
const els = {
  // mode + shared inputs
  stMode: $("stMode"),
  stBaseApr: $("stBaseApr"),
  stPrincipal: $("stPrincipal"),
  stTermYears: $("stTermYears"),
  stExtra: $("stExtra"),

  // steps inputs
  stPreset: $("stPreset"),
  stStep: $("stStep"),
  stEveryMonths: $("stEveryMonths"),
  stDurationMonths: $("stDurationMonths"),
  stCapApr: $("stCapApr"),

  // ARM inputs
  armStartDate: $("armStartDate"),
  armFixedYears: $("armFixedYears"),
  armAdjustEveryMonths: $("armAdjustEveryMonths"),
  armIndexMode: $("armIndexMode"),
  armIndexValue: $("armIndexValue"),
  armIndexMaturity: $("armIndexMaturity"),
  armIndexSchedule: $("armIndexSchedule"),
  armMargin: $("armMargin"),
  armPeriodicCap: $("armPeriodicCap"),
  armLifetimeCap: $("armLifetimeCap"),
  armFloor: $("armFloor"),
  armSimYears: $("armSimYears"),

  // buttons
  stUseCalcBtn: $("stUseCalcBtn"),
  stRunBtn: $("stRunBtn"),
  stStatus: $("stStatus"),

  // results
  stWorstPayment: $("stWorstPayment"),
  stWorstWhen: $("stWorstWhen"),
  stTotalInterest: $("stTotalInterest"),
  stPayoff: $("stPayoff"),
  stRisk: $("stRisk"),
  stPeakRate: $("stPeakRate"),
  stPeakMeta: $("stPeakMeta"),

  // chart + table
  stChart: $("stChart"),
  stTableBody: $("stTable")?.querySelector("tbody"),
};

function setStatus(msg) {
  if (!els.stStatus) return;
  els.stStatus.textContent = msg || "";
}

/* =========================================================
   UI show/hide by mode
   ========================================================= */
function applyModeVisibility() {
  const mode = els.stMode?.value || "steps";
  document.querySelectorAll(".stStepsOnly").forEach(el => {
    el.style.display = (mode === "steps") ? "" : "none";
  });
  document.querySelectorAll(".stArmOnly").forEach(el => {
    el.style.display = (mode === "arm") ? "" : "none";
  });
}

els.stMode?.addEventListener("change", applyModeVisibility);

/* =========================================================
   Presets (Steps mode)
   ========================================================= */
function applyPreset(preset) {
  if (!preset || preset === "none") return;
  if (preset === "gentle") {
    els.stStep.value = "0.25";
    els.stEveryMonths.value = "6";
    els.stDurationMonths.value = "24";
  } else if (preset === "moderate") {
    els.stStep.value = "0.25";
    els.stEveryMonths.value = "3";
    els.stDurationMonths.value = "24";
  } else if (preset === "shock") {
    els.stStep.value = "0.50";
    els.stEveryMonths.value = "3";
    els.stDurationMonths.value = "18";
  }
}
els.stPreset?.addEventListener("change", () => applyPreset(els.stPreset.value));

/* =========================================================
   Chart
   ========================================================= */
let chart = null;

function buildChart(rows) {
  if (!rows?.length || !els.stChart) return;

  const labels = rows.map(r => r.month);
  const payment = rows.map(r => r.payment);
  const rate = rows.map(r => r.apr);

  if (chart) chart.destroy();

  chart = new Chart(els.stChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Monthly payment", data: payment, borderWidth: 2, tension: 0.25, pointRadius: 0, yAxisID: "y" },
        { label: "APR (%)", data: rate, borderWidth: 2, tension: 0.25, pointRadius: 0, yAxisID: "y1" },
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
            label: (ctx) => {
              if (ctx.dataset.label.includes("APR")) return `${ctx.dataset.label}: ${fmtPct2(ctx.raw)}`;
              return `${ctx.dataset.label}: ${fmtUSD(ctx.raw)}`;
            }
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
          title: { display: true, text: "APR (%)" },
          grid: { drawOnChartArea: false },
          ticks: { callback: v => `${Number(v).toFixed(1)}%` }
        }
      }
    }
  });
}

/* =========================================================
   Table (first 36 rows)
   ========================================================= */
function renderTable(rows) {
  if (!els.stTableBody) return;
  const show = rows.slice(0, 36);

  els.stTableBody.innerHTML = show.map(r => `
    <tr>
      <td>${r.month}</td>
      <td>${r.apr.toFixed(2)}%</td>
      <td>${fmtUSD2(r.payment)}</td>
      <td>${fmtUSD2(r.interest)}</td>
      <td>${fmtUSD2(r.principal)}</td>
      <td>${fmtUSD2(r.balance)}</td>
    </tr>
  `).join("");

  if (!show.length) {
    els.stTableBody.innerHTML = `<tr><td colspan="6" class="muted">No rows.</td></tr>`;
  }
}

/* =========================================================
   Risk score
   ========================================================= */
function riskScore(startPay, worstPay) {
  if (!(startPay > 0) || !(worstPay > 0)) return "—";
  const jump = (worstPay - startPay) / startPay; // 0.25 = +25%

  if (jump <= 0.10) return "Low";
  if (jump <= 0.25) return "Moderate";
  if (jump <= 0.45) return "High";
  return "Severe";
}

/* =========================================================
   Run
   ========================================================= */
function run() {
  setStatus("");

  const mode = els.stMode.value;
  const startApr = safeNum(els.stBaseApr.value, NaN);
  const principal = safeNum(els.stPrincipal.value, NaN);
  const termYears = safeNum(els.stTermYears.value, NaN);
  const extra = safeNum(els.stExtra.value, 0);

  if (!(principal > 0) || !(termYears > 0) || !(startApr >= 0)) {
    setStatus("Enter starting APR, starting balance, and original term.");
    return;
  }

  const termMonths = Math.round(termYears * 12);

  let out;

  if (mode === "steps") {
    const stepSize = safeNum(els.stStep.value, 0);
    const everyMonths = Math.round(safeNum(els.stEveryMonths.value, 0));
    const durationMonths = Math.round(safeNum(els.stDurationMonths.value, 0));
    const capApr = safeNum(els.stCapApr.value, NaN);

    out = runStressSteps({
      principal,
      startApr,
      termMonths,
      extraMonthly: extra,
      stepSize,
      everyMonths,
      durationMonths,
      capApr: isFinite(capApr) ? capApr : NaN
    });

    // peak rate for steps
    const peak = out.rows.reduce((m, r) => Math.max(m, r.apr), startApr);
    const peakRow = out.rows.find(r => r.apr === peak);
    els.stPeakRate.textContent = isFinite(peak) ? `${peak.toFixed(2)}%` : "—";
    els.stPeakMeta.textContent = peakRow ? `Peak reached in month ${peakRow.month}` : "";
  } else {
    const fixedYears = safeNum(els.armFixedYears.value, 5);
    const adjustEveryMonths = safeNum(els.armAdjustEveryMonths.value, 12);

    const indexMode = els.armIndexMode.value;
    const indexValue = safeNum(els.armIndexValue.value, NaN);
    const margin = safeNum(els.armMargin.value, 0);
    const periodicCap = safeNum(els.armPeriodicCap.value, NaN);
    const lifetimeCapAboveStart = safeNum(els.armLifetimeCap.value, NaN);
    const floorApr = safeNum(els.armFloor.value, NaN);
    const simYears = safeNum(els.armSimYears.value, NaN);

    const manualSchedule = parseManualSchedule(els.armIndexSchedule.value);

    out = runStressARM({
      principal,
      startApr,
      termMonths,
      fixedYears,
      adjustEveryMonths,
      indexMode,
      indexValue: isFinite(indexValue) ? indexValue : startApr,
      manualSchedule,
      margin,
      periodicCap: isFinite(periodicCap) ? periodicCap : NaN,
      lifetimeCapAboveStart: isFinite(lifetimeCapAboveStart) ? lifetimeCapAboveStart : NaN,
      floorApr: isFinite(floorApr) ? floorApr : NaN,
      simMonths: isFinite(simYears) ? Math.round(simYears * 12) : null
    });

    els.stPeakRate.textContent = isFinite(out.peakRate) ? `${out.peakRate.toFixed(2)}%` : "—";
    els.stPeakMeta.textContent = `Peak reached in month ${out.peakMonth}`;
  }

  // Outputs
  els.stWorstPayment.textContent = fmtUSD(out.worstPayment);
  els.stWorstWhen.textContent = `Worst month: ${out.worstMonth}`;
  els.stTotalInterest.textContent = fmtUSD(out.totalInterest);
  els.stPayoff.textContent = `${out.rows.length} months simulated`;

  // risk score based on month 1 payment vs worst
  const startPay = out.rows[0]?.payment ?? NaN;
  els.stRisk.textContent = riskScore(startPay, out.worstPayment);

  // chart + table
  buildChart(out.rows);
  renderTable(out.rows);

  setStatus("");
}

els.stRunBtn?.addEventListener("click", run);

/* =========================================================
   Use calculator inputs (from index page localStorage if you later add it)
   For now: tries URL params if present, otherwise does nothing safely.
   ========================================================= */
function useCalculatorInputs() {
  // Optional: read from query string if you add share params
  const qs = new URLSearchParams(window.location.search);
  const p = safeNum(qs.get("p"), NaN);
  const apr = safeNum(qs.get("apr"), NaN);
  const term = safeNum(qs.get("term"), NaN);
  const extra = safeNum(qs.get("extra"), NaN);

  if (isFinite(p)) els.stPrincipal.value = String(p);
  if (isFinite(apr)) els.stBaseApr.value = String(apr);
  if (isFinite(term)) els.stTermYears.value = String(term);
  if (isFinite(extra)) els.stExtra.value = String(extra);

  setStatus("Loaded any available calculator values. Edit if needed.");
}

els.stUseCalcBtn?.addEventListener("click", useCalculatorInputs);

// init
applyModeVisibility();
applyPreset(els.stPreset?.value || "none");
