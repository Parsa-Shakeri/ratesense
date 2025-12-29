"use strict";

/* =========================================================
   Small helpers
   ========================================================= */
const $ = (id) => document.getElementById(id);

function setStatus(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
}

function copyText(text, statusEl, ok = "Copied.") {
  navigator.clipboard.writeText(text).then(() => {
    if (statusEl) {
      statusEl.textContent = ok;
      setTimeout(() => (statusEl.textContent = ""), 1400);
    }
  }).catch(() => {
    if (statusEl) statusEl.textContent = "Copy failed (clipboard blocked).";
  });
}

function safeNum(v, d = NaN) {
  const x = parseFloat(v);
  return isFinite(x) ? x : d;
}

function fmtPct2(x) {
  if (!isFinite(x)) return "—";
  return x.toFixed(2) + "%";
}

/* =========================================================
   Mobile menu (same behavior as other pages)
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
   Fetch with fallback (GitHub Pages often blocks CORS)
   ========================================================= */
async function fetchJSONWithFallback(url, opts = {}) {
  // 1) Try direct
  try {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e1) {
    // 2) Try CORS proxy
    // NOTE: Public proxies can be rate-limited. This is best-effort.
    const proxied = "https://cors.isomorphic-git.org/" + url;
    const r2 = await fetch(proxied, opts);
    if (!r2.ok) throw new Error(`Proxy HTTP ${r2.status}`);
    return await r2.json();
  }
}

async function fetchTextWithFallback(url, opts = {}) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e1) {
    const proxied = "https://cors.isomorphic-git.org/" + url;
    const r2 = await fetch(proxied, opts);
    if (!r2.ok) throw new Error(`Proxy HTTP ${r2.status}`);
    return await r2.text();
  }
}

/* =========================================================
   PMMS (Freddie Mac Primary Mortgage Market Survey)
   =========================================================
   Freddie Mac provides PMMS data in several formats. The most
   consistent machine-friendly endpoint (as of past years) is
   a JSON-like feed used by their pages.

   We do a robust parse:
   - fetch a known PMMS JSON endpoint if available
   - otherwise fetch HTML and regex the most recent values
========================================================= */

const pmms = {
  productSel: $("pmmsProduct"),
  valueEl: $("pmmsValue"),
  metaEl: $("pmmsMeta"),
  fetchBtn: $("pmmsFetchBtn"),
  copyBtn: $("pmmsCopyBtn"),
  statusEl: $("pmmsStatus"),
};

let lastPMMS = { rate: null, date: null, product: "30" };

async function fetchPMMS() {
  setStatus(pmms.statusEl, "Fetching…");
  pmms.valueEl.textContent = "—";
  pmms.metaEl.textContent = "";

  const product = pmms.productSel.value; // "30" or "15"

  // Strategy A: Try Freddie Mac JSON endpoint used by their PMMS page
  // If this changes, Strategy B below still works.
  const jsonUrl = "https://www.freddiemac.com/pmms/data.json";

  try {
    const data = await fetchJSONWithFallback(jsonUrl);

    // data structure commonly contains: data.pmms or series arrays
    // We will search arrays for latest "30-year" or "15-year" fixed rate.
    // If format differs, fallback to HTML parse.
    const { rate, date } = parsePMMSFromJSON(data, product);
    if (!(rate && date)) throw new Error("PMMS JSON format not recognized");

    lastPMMS = { rate, date, product };
    pmms.valueEl.textContent = fmtPct2(rate);
    pmms.metaEl.textContent = `As of ${date} • Source: Freddie Mac PMMS`;
    setStatus(pmms.statusEl, "");
    return;
  } catch (e) {
    // fallback
  }

  // Strategy B: HTML parse from the PMMS landing page
  const htmlUrl = "https://www.freddiemac.com/pmms";
  try {
    const html = await fetchTextWithFallback(htmlUrl);
    const { rate, date } = parsePMMSFromHTML(html, product);
    if (!(rate && date)) throw new Error("Could not parse PMMS page");

    lastPMMS = { rate, date, product };
    pmms.valueEl.textContent = fmtPct2(rate);
    pmms.metaEl.textContent = `As of ${date} • Source: Freddie Mac PMMS`;
    setStatus(pmms.statusEl, "");
  } catch (err) {
    setStatus(pmms.statusEl, "Could not fetch PMMS (blocked or format changed). Try again later.");
    pmms.metaEl.textContent = "Tip: if this keeps failing on GitHub Pages, it’s usually CORS/proxy rate limiting.";
  }
}

function parsePMMSFromJSON(data, product) {
  // We try a few patterns safely.
  // Expected: a "series" or "data" structure containing dates and rates.
  // We'll normalize by scanning for keys that look like "30-year" and "15-year".

  const want = product === "30" ? "30" : "15";

  // Case 1: data.pmms is an array of objects like { date: "...", rate_30: ..., rate_15: ... }
  if (data && Array.isArray(data.pmms) && data.pmms.length) {
    const last = data.pmms[data.pmms.length - 1];
    const rate = want === "30" ? safeNum(last.rate_30, null) : safeNum(last.rate_15, null);
    const date = last.date || last.week || null;
    return { rate, date };
  }

  // Case 2: data might have series arrays keyed by name
  // e.g., data.series["30yrFRM"] = [{ date, value }, ...]
  if (data && data.series && typeof data.series === "object") {
    const key30 = Object.keys(data.series).find(k => /30/i.test(k) && /(fixed|frm|rate)/i.test(k));
    const key15 = Object.keys(data.series).find(k => /15/i.test(k) && /(fixed|frm|rate)/i.test(k));
    const key = want === "30" ? key30 : key15;
    const arr = key ? data.series[key] : null;
    if (Array.isArray(arr) && arr.length) {
      const last = arr[arr.length - 1];
      const rate = safeNum(last.value ?? last.rate, null);
      const date = last.date ?? last.week ?? null;
      return { rate, date };
    }
  }

  // Case 3: Search deep for last numeric rate + date string near "30" or "15"
  // If this fails, HTML fallback will handle it.
  return { rate: null, date: null };
}

function parsePMMSFromHTML(html, product) {
  // Best-effort regex:
  // We look for the most prominent displayed rates on the page.
  // Patterns often include "30-year fixed-rate mortgage (FRM) averaged X.XX percent"
  const want = product === "30" ? "30" : "15";

  const rateRe = new RegExp(`${want}\\s*-?year[^\\d]{0,80}(\\d\\.\\d\\d)\\s*percent`, "i");
  const m = html.match(rateRe);
  const rate = m ? safeNum(m[1], null) : null;

  // Date often shown like "Week of December 25, 2025" or similar
  const dateRe = /Week of\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i;
  const d = html.match(dateRe);
  const date = d ? d[1] : null;

  return { rate, date };
}

/* =========================================================
   Treasury Yield Curve (Daily)
   Data source: U.S. Treasury "Daily Treasury Yield Curve Rates"
   JSON may not be stable; CSV is more consistent historically.
========================================================= */

const tsy = {
  maturitySel: $("tsyMaturity"),
  valueEl: $("tsyValue"),
  metaEl: $("tsyMeta"),
  fetchBtn: $("tsyFetchBtn"),
  copyBtn: $("tsyCopyBtn"),
  statusEl: $("tsyStatus"),
};

let lastTSY = { yield: null, date: null, maturity: "10 Yr" };

async function fetchTreasuryYield() {
  setStatus(tsy.statusEl, "Fetching…");
  tsy.valueEl.textContent = "—";
  tsy.metaEl.textContent = "";

  // Treasury publishes the daily yield curve data as CSV.
  // Endpoint:
  // https://home.treasury.gov/resource-center/data-chart-center/interest-rates/Datasets/yield.csv?type=daily_treasury_yield_curve&field_tdr_date_value=2025
  // We'll fetch the current year CSV and use the last row with values.

  const year = new Date().getFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/Datasets/yield.csv?type=daily_treasury_yield_curve&field_tdr_date_value=${year}`;

  try {
    const csv = await fetchTextWithFallback(url);
    const parsed = parseTreasuryCSV(csv);
    if (!parsed?.rows?.length) throw new Error("No Treasury rows");

    // Use last valid row (some rows may have blank yields)
    const last = findLastValidTreasuryRow(parsed.rows);
    if (!last) throw new Error("No valid row found");

    const maturity = tsy.maturitySel.value; // matches CSV header names
    const y = safeNum(last[maturity], null);

    if (!isFinite(y)) throw new Error("Yield missing for selected maturity");

    lastTSY = { yield: y, date: last.Date, maturity };
    tsy.valueEl.textContent = fmtPct2(y);
    tsy.metaEl.textContent = `As of ${last.Date} • Source: U.S. Treasury`;
    setStatus(tsy.statusEl, "");
  } catch (err) {
    setStatus(tsy.statusEl, "Could not fetch Treasury yields (blocked or rate-limited).");
    tsy.metaEl.textContent = "Tip: This can fail if a proxy is rate-limited. Try again later.";
  }
}

function parseTreasuryCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length !== headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => obj[h] = cols[idx]);
    rows.push(obj);
  }
  return { headers, rows };
}

function splitCSVLine(line) {
  // basic CSV split that handles quoted commas
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur.trim().replace(/^"|"$/g, ""));
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim().replace(/^"|"$/g, ""));
  return out;
}

function findLastValidTreasuryRow(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    // Check any common maturity exists to confirm row is usable
    const y10 = safeNum(r["10 Yr"], NaN);
    if (isFinite(y10) && r.Date) return r;
  }
  return null;
}

/* =========================================================
   Wire up events
   ========================================================= */
pmms.fetchBtn?.addEventListener("click", fetchPMMS);
pmms.copyBtn?.addEventListener("click", () => {
  if (!isFinite(lastPMMS.rate)) return setStatus(pmms.statusEl, "Fetch a PMMS rate first.");
  copyText(lastPMMS.rate.toFixed(2), pmms.statusEl, "Rate copied.");
});

tsy.fetchBtn?.addEventListener("click", fetchTreasuryYield);
tsy.copyBtn?.addEventListener("click", () => {
  if (!isFinite(lastTSY.yield)) return setStatus(tsy.statusEl, "Fetch a Treasury yield first.");
  copyText(lastTSY.yield.toFixed(2), tsy.statusEl, "Yield copied.");
});

/* =========================================================
   Nice default: auto-fetch Treasury on load (optional)
========================================================= */
window.addEventListener("load", () => {
  // Don’t auto-fetch PMMS because it can be heavier; Treasury is quick.
  // If you want both, uncomment the PMMS line.
  fetchTreasuryYield();
  // fetchPMMS();
});
