"use strict";

const scenarios = {
  mortgage350: { loanType:"mortgage", principal:350000, years:30, apr:6.5, extra:0, tax:7200, ins:1800, hoa:0 },
  auto25:      { loanType:"auto",     principal:25000,  years:5,  apr:7.9, extra:0 },
  student40:   { loanType:"student",  principal:40000,  years:10, apr:6.0, extra:0 },
  cc4k:        { loanType:"creditcard", principal:4000, apr:24.0, ccMode:"fixed", ccFixedPayment:200 },
};

document.querySelectorAll("[data-scenario]").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-scenario");
    const payload = scenarios[key];
    if (!payload) return;

    localStorage.setItem("ratesense_scenario", JSON.stringify(payload));
    window.location.href = "./index.html#calculator";
  });
});
