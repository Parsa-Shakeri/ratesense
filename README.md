# RateSense

RateSense is a student-built finance calculator that translates interest-rate changes into real monthly impacts.

**Live demo:** (add your GitHub Pages link here)

## What it does
- Calculates **monthly payment**, **total interest**, and **payoff time** for amortized loans (mortgage/auto/student)
- Simulates **credit card payoff** (minimum-payment or fixed-payment mode)
- Shows a scenario table for **+0.25%, +0.50%, +1.00%** rate changes
- Includes **refinance break-even** estimate (closing costs + keep horizon)
- For mortgages, supports **PITI budgeting**:
  - Principal + Interest (P&I)
  - + Property taxes (annual → monthly)
  - + Homeowners insurance (annual → monthly)
  - + HOA / extra monthly costs

## Key product features
- **Charts** (balance over time; principal vs interest split)
- **Shareable link** (stores inputs in the URL so others can reproduce scenarios)
- **CSV export** for amortization schedule (Excel/Sheets-ready)
- **Print report** view for clean, client-style output

## Tech stack
- HTML / CSS / Vanilla JavaScript
- Chart.js for charting
- GitHub Pages for deployment

## Model assumptions (simplified)
- Fixed-rate amortization (no lender fees, compounding quirks, or escrow mechanics)
- Extra payment is applied monthly and reduces principal
- PITI add-ons are **budgeting add-ons** and are not part of interest math
- Educational only — not financial advice

## Why I built it
Rate headlines (e.g., “rates rose 25 bps”) are abstract. RateSense turns those headlines into concrete household impacts:
monthly budget changes, lifetime interest cost, and refinance tradeoffs.

## Future improvements
- Mortgage PMI toggle
- Taxes/insurance included in CSV as optional columns
- Compare two loans side-by-side
- Variable-rate modeling

## License
MIT (optional: choose a license)
