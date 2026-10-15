# Fuel Receipt Generator

A single-page, client-side tool that generates printable HPCL-style fuel purchase receipts for a date range. Open `receipt.html` in a browser, fill in the form, and get one receipt per day styled like a petrol pump printout.

## Features

- Generates one receipt per day for a given From/To date range.
- Supports Petrol, Diesel, CNG, and EV vehicle types.
- Randomizes fuel volume within a configurable litre range, and the time of purchase.
- Looks up the fuel rate for each date from a fuel price API, falling back to a built-in rate schedule (`FALLBACK_FUEL_RATE_SCHEDULE` in `generator.js`) if the API call fails or is unavailable.
- Each receipt shows the rate source used (API vs. fallback schedule).
- Print-friendly layout (`@media print` styles) for generating physical copies.

## Usage

1. Open `receipt.html` in any modern browser (no build step or server required).
2. Fill in the form:
   - **VEH TYPE** — Petrol, Diesel, CNG, or EV
   - **VEH NO** — vehicle registration number
   - **CUSTOMER NAME**
   - **FROM DATE** / **TO DATE** — date range to generate receipts for (inclusive)
   - **FUEL RANGE (LTR / KG / kWh)** — min/max quantity to randomize per receipt (0.01–1,000,000, at most two decimal places)
   - **CITY** / **STATE**
3. Click **Generate Receipts**. One receipt card is rendered per day in the range.
4. Use your browser's print function to print or save the receipts as a PDF.

## Files

| File | Description |
|---|---|
| `receipt.html` | Form UI and receipt layout/styles |
| `generator.js` | Date handling, fuel rate lookup/fallback, and receipt generation logic |
| `hplogo.png` | Logo used on the generated receipts |

## Notes

- Live prices are disabled by default. Built-in sample prices are location-independent, last updated January 2025, and continue to apply to later dates; dates before the schedule use the earliest sample rate.
- To enable live prices, serve this app over HTTP(S) and set the `fuel-rate-endpoint` meta tag in `receipt.html` to a same-origin backend route such as `/api/fuel-prices`. This repository does not include that backend. Keep RapidAPI/provider credentials exclusively on your backend, never in browser JavaScript. The route receives `country`, `state`, `city`, `fuel`, and `date` query parameters and must return JSON such as `{"rate": 94.31}` with a numeric rate between 0.01 and 1,000,000. The backend must validate the provider response and requested fuel/date/location. Requests are limited to four at a time, with a five-second timeout per request; failures use the sample schedule.
- Quantity units are litres for Petrol/Diesel, kilograms for CNG, and kWh for EV. Print output hides the form and page controls.
- Receipt numbers are derived from the receipt date, so the same date always yields the same number and overlapping ranges reuse the number for the same date.
- A single generation is capped at `MAX_RECEIPT_DAYS` (366) days.
- This tool is intended for generating sample/mock receipts (e.g. for testing or demo purposes) and is not affiliated with HPCL.

## Validation

Run `node --test tests/generator.test.cjs` with Node.js 18 or later. The suite uses the built-in test runner and requires no packages. It covers dates, receipt generation, escaping, quantities, bounded API concurrency, timeout fallback, response validation, and retry behavior.

The receipt uses the bundled Press Start 2P font, licensed under the SIL Open Font License (see `assets/fonts/OFL-PressStart2P.txt`). No external font request is needed.
