const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RECEIPT_NO_BASE = 4930;
const MAX_RECEIPT_DAYS = 366;
const MS_PER_DAY = 86400000;
const MAX_QUANTITY = 1000000;

const FALLBACK_FUEL_RATE_SCHEDULE = {
  Petrol: [
    { from: "2024-01-01", rate: 96.72 },
    { from: "2024-06-15", rate: 95.19 },
    { from: "2025-01-01", rate: 94.31 }
  ],
  Diesel: [
    { from: "2024-01-01", rate: 89.62 },
    { from: "2024-06-15", rate: 87.76 },
    { from: "2025-01-01", rate: 86.88 }
  ],
  CNG: [
    { from: "2024-01-01", rate: 72.11 },
    { from: "2024-07-01", rate: 74.02 },
    { from: "2025-01-01", rate: 76.15 }
  ],
  EV: [
    { from: "2024-01-01", rate: 11.5 },
    { from: "2025-01-01", rate: 12.0 }
  ]
};

// Optional same-origin backend endpoint. Keep provider credentials on the server.
const FUEL_RATE_ENDPOINT = document.querySelector('meta[name="fuel-rate-endpoint"]')?.content || "";
const API_TIMEOUT_MS = 5000;
const API_CONCURRENCY = 4;
const FUEL_UNITS = { Petrol: "LTR", Diesel: "LTR", CNG: "KG", EV: "kWh" };

const fuelRateCache = new Map();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function formatISODate(d) {
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return null;
  // setFullYear avoids the Date constructor's special handling of years 0–99.
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date : null;
}

function dayNumber(date) {
  const utc = new Date(0);
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round(utc.getTime() / MS_PER_DAY);
}

function dateRangeInclusive(fromDate, toDate) {
  const dates = [];
  const cursor = new Date(fromDate);

  while (cursor <= toDate) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function setDefaultDates() {
  const fromDateInput = document.getElementById("fromDate");
  const toDateInput = document.getElementById("toDate");
  if (!fromDateInput || !toDateInput) return;

  if (!toDateInput.value) {
    toDateInput.value = formatISODate(new Date());
  }

  if (!fromDateInput.value) {
    // parseDateInput keeps this in local time; `new Date("YYYY-MM-DD")` would
    // parse as UTC and shift the result by a day west of UTC.
    const from = parseDateInput(toDateInput.value) || new Date();
    from.setDate(from.getDate() - 6);
    fromDateInput.value = formatISODate(from);
  }
}

function getFallbackFuelRate(product, date) {
  const schedule = FALLBACK_FUEL_RATE_SCHEDULE[product] || FALLBACK_FUEL_RATE_SCHEDULE.Petrol;
  const target = date.getTime();
  let selectedRate = schedule[0].rate;
  let selectedFrom = -Infinity;

  // Pick the latest entry effective on or before `date`, independent of the
  // order the schedule happens to be written in.
  schedule.forEach((entry) => {
    const effectiveDate = parseDateInput(entry.from).getTime();
    if (effectiveDate <= target && effectiveDate >= selectedFrom) {
      selectedFrom = effectiveDate;
      selectedRate = entry.rate;
    }
  });

  return selectedRate;
}

async function fetchFuelRateFromApi({ product, date, state, city }) {
  if (!FUEL_RATE_ENDPOINT) return null;
  const endpoint = new URL(FUEL_RATE_ENDPOINT, window.location.href);
  if (endpoint.origin !== window.location.origin || !["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("Fuel rate endpoint must use the same origin.");
  }

  const isoDate = formatISODate(date);
  const cacheKey = JSON.stringify([product, state, city, isoDate]);
  if (fuelRateCache.has(cacheKey)) return fuelRateCache.get(cacheKey);

  const params = new URLSearchParams({
    country: "IN",
    state,
    city,
    fuel: product.toLowerCase(),
    date: isoDate
  });

  for (const [name, value] of params) endpoint.searchParams.set(name, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let rate;
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) throw new Error(`Fuel API failed with status ${response.status}`);
    const payload = await response.json();
    // The backend contract is an explicit positive numeric rate.
    rate = typeof payload?.rate === "number" && Number.isFinite(payload.rate) && payload.rate >= 0.01 && payload.rate <= 1000000
      ? payload.rate : null;
  } finally {
    clearTimeout(timer);
  }
  if (rate != null) fuelRateCache.set(cacheKey, rate);
  return rate;
}

function generateReceiptHTML(data) {
  const v = {};
  Object.keys(data).forEach((key) => {
    v[key] = escapeHtml(data[key]);
  });

  return `
      <div class="receipt">
        <img class="logo" src="./hplogo.png" alt="Hindustan Petroleum Logo">
        <div class="title">WELCOME!!!</div>
        <div class="receipt-tag">SAMPLE RECEIPT</div>
        <div class="section section-center">
          HPCL PETROL PUMP - HP Auto<br>
          Care H-9 Site B Industrial<br>
          Area, Baburi Sharqi, Uttar<br>
          Pradesh
        </div>
        <div class="section">Receipt No.: ${v.receiptNo}</div>
        <div class="section">
          PRODUCT: ${v.product}<br>
          RATE/${v.unit}: ₹ ${v.ratePerLitre}<br>
          <div class="receipt-amount">AMOUNT: ₹ ${v.amount}</div>
          QUANTITY(${v.unit}): ${v.volume}
        </div>
        <div class="section">
          VEH TYPE: ${v.vehicleType}<br>
          VEH NO: ${v.vehicleNo}<br>
          CUSTOMER NAME: ${v.customerName}
        </div>
        <div class="section">
          Date: ${v.date}<br>
          Time: ${v.time}
        </div>
        <div class="section">
          MODE: ${v.mode}
        </div>
        <div class="section receipt-meta">
          From Date: ${v.fromDate}<br>
          To Date: ${v.toDate}<br>
          Rate Source: ${v.rateSource}
        </div>
        <div class="footer">
          SAVE FUEL YAANI SAVE MONEY !!<br>
          THANKS FOR FUELLING WITH US.<br>
          YOU CAN NOW CALL US ON<br>
          476069 (TOLL-FREE) FOR<br>
          QUERIES/COMPLAINTS.
        </div>
      </div>`;
}

async function generateReceipts() {
  const vehicleType = document.getElementById("vehType").value || "Petrol";
  const vehicleNo = document.getElementById("vehNo").value.trim() || "UP13 AT6119";
  const customerName = document.getElementById("custName").value.trim() || "Mithun Kumar";
  const fromDateVal = document.getElementById("fromDate").value;
  const toDateVal = document.getElementById("toDate").value;
  const fuelRangeStart = Number(document.getElementById("fuelRangeStart").value);
  const fuelRangeEnd = Number(document.getElementById("fuelRangeEnd").value);
  const city = document.getElementById("city").value.trim() || "Ghaziabad";
  const state = document.getElementById("state").value.trim() || "Uttar Pradesh";

  if (!fromDateVal || !toDateVal) {
    alert("Please select both From Date and To Date.");
    return;
  }

  if (!Number.isFinite(fuelRangeStart) || !Number.isFinite(fuelRangeEnd) || fuelRangeStart <= 0 || fuelRangeEnd <= 0) {
    alert("Please enter valid fuel range values.");
    return;
  }

  if (fuelRangeStart < 0.01 || fuelRangeEnd > MAX_QUANTITY ||
      [fuelRangeStart, fuelRangeEnd].some(value => Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) {
    alert(`Quantity must be between 0.01 and ${MAX_QUANTITY}, with at most two decimal places.`);
    return;
  }

  if (fuelRangeStart > fuelRangeEnd) {
    alert("Fuel range start should not be greater than fuel range end.");
    return;
  }

  const fromDate = parseDateInput(fromDateVal);
  const toDate = parseDateInput(toDateVal);

  if (!fromDate || !toDate) {
    alert("Please enter valid dates between years 0001 and 9999.");
    return;
  }

  if (fromDate > toDate) {
    alert("From Date should not be greater than To Date.");
    return;
  }

  const totalDays = dayNumber(toDate) - dayNumber(fromDate) + 1;
  if (totalDays > MAX_RECEIPT_DAYS) {
    alert(`Please select a range of ${MAX_RECEIPT_DAYS} days or fewer (selected: ${totalDays}).`);
    return;
  }

  const fromDateDisplay = formatDate(fromDate);
  const toDateDisplay = formatDate(toDate);
  const dates = dateRangeInclusive(fromDate, toDate);
  const rates = await mapWithConcurrency(dates, API_CONCURRENCY, async (date) => {
    let rate = null;
    let rateSource = "Built-in sample schedule (not live; location-independent)";

    try {
      rate = await fetchFuelRateFromApi({
        product: vehicleType,
        date,
        state,
        city
      });
      if (rate != null) {
        rateSource = "Fuel API";
      }
    } catch (error) {
      console.warn("Fuel API lookup failed, fallback applied:", error.message);
    }

    if (rate == null) {
      rate = getFallbackFuelRate(vehicleType, date);
    }

    return { rate, rateSource };
  });

  const receiptsData = dates.map((date, index) => {
    const { rate, rateSource } = rates[index];
    const volume = +(fuelRangeStart + Math.random() * (fuelRangeEnd - fuelRangeStart)).toFixed(2);
    // Round the rate before deriving the amount so the printed
    // RATE x QUANTITY actually equals the printed AMOUNT.
    const ratePerLitre = +rate.toFixed(2);
    const amount = +(volume * ratePerLitre).toFixed(2);
    const hh = String(8 + Math.floor(Math.random() * 10)).padStart(2, "0");
    const mm = String(Math.floor(Math.random() * 60)).padStart(2, "0");

    return {
      receiptNo: String(RECEIPT_NO_BASE + dayNumber(date)),
      product: vehicleType,
      unit: FUEL_UNITS[vehicleType],
      ratePerLitre: ratePerLitre.toFixed(2),
      amount: amount.toFixed(2),
      volume: volume.toFixed(2),
      vehicleType,
      vehicleNo,
      customerName,
      date: formatDate(date),
      time: `${hh}:${mm}`,
      mode: "Cash",
      fromDate: fromDateDisplay,
      toDate: toDateDisplay,
      rateSource
    };
  });

  const receiptsContainer = document.getElementById("receipts");
  receiptsContainer.innerHTML = receiptsData.map(generateReceiptHTML).join("");
  const printButton = document.getElementById("printBtn");
  if (printButton) printButton.disabled = receiptsData.length === 0;
  const status = document.getElementById("previewStatus");
  if (status) status.textContent = `${receiptsData.length} receipt${receiptsData.length === 1 ? "" : "s"} · Ready to print`;
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await callback(items[index]);
    }
  }));
  return results;
}

function updateFuelUnit() {
  const unit = FUEL_UNITS[document.getElementById("vehType").value];
  document.querySelector('label[for="fuelRangeStart"]').textContent = `FUEL RANGE (${unit}):`;
}

function initGenerator() {
  document.getElementById("printBtn")?.addEventListener("click", () => window.print());
  updateFuelUnit();
  document.getElementById("vehType").addEventListener("change", updateFuelUnit);
  setDefaultDates();

  const button = document.getElementById("generateBtn");
  if (!button) return;

  button.addEventListener("click", async () => {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Generating...";

    try {
      await generateReceipts();
    } catch (error) {
      console.error("Receipt generation failed:", error);
      alert("Receipt generation failed. See the browser console for details.");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

initGenerator();
