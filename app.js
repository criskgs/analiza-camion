// Pure front-end app. No build step.
// Utility helpers (RO formats)
const stripDiacritics = (s = "") =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

const parseRoNumber = (val) => {
  if (val == null) return null;
  if (typeof val === "number") return val;
  let s = String(val).trim();
  if (!s) return null;
  s = s.replace(/\s/g, "").replace(/\./g, "").replace(/,/, "."); // thousands dot, decimal comma
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const parseTimeToSeconds = (val) => {
  if (!val && val !== 0) return 0;
  if (typeof val === "number") return val; // assume already seconds
  const s = String(val).trim();
  const hhmmss = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmss) {
    const h = parseInt(hhmmss[1] || "0", 10);
    const m = parseInt(hhmmss[2] || "0", 10);
    const sec = parseInt(hhmmss[3] || "0", 10);
    return h * 3600 + m * 60 + sec;
  }
  let days = 0, h = 0, m = 0, sec = 0;
  const dMatch = s.match(/(\d+)\s*z/i);
  if (dMatch) days = parseInt(dMatch[1], 10);
  const hMatch = s.match(/(\d+)\s*h/i);
  if (hMatch) h = parseInt(hMatch[1], 10);
  const mMatch = s.match(/(\d+)\s*m(?!s)/i);
  if (mMatch) m = parseInt(mMatch[1], 10);
  const sMatch = s.match(/(\d+)\s*s/i);
  if (sMatch) sec = parseInt(sMatch[1], 10);
  const total = days * 86400 + h * 3600 + m * 60 + sec;
  return Number.isFinite(total) ? total : 0;
};

const secondsToHMS = (total) => {
  total = Math.max(0, Math.round(total));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

// Column header detection
const HEADER_ALIASES = {
  vehicul: ["vehicul", "camion", "masina", "autovehicul"],
  dist_gps: ["distanta gps", "distanta", "km gps", "km", "distance gps"],
  km_can: ["kilometraj oprire can", "km can", "kilometraj can"],
  timp_miscare: ["timp in miscare", "timp miscare", "timp deplasare"],
  timp_stationare: ["timp stationare", "timp staționare"],
  stationari: ["stationari", "staționari", "opriri"],
  viteza_medie: ["viteza medie (km/h)", "viteza medie", "viteza medie km/h"],
  timp_fnct_stationar: ["timp functionare stationara", "timp funcționare staționară", "timp functionare staționară"],
  functionare_motor: ["functionare motor", "funcționare motor"]
};

function matchHeader(name) {
  const n = stripDiacritics(name);
  for (const key in HEADER_ALIASES) {
    const aliases = HEADER_ALIASES[key];
    if (aliases.some(a => n === a || n.includes(a))) return key;
  }
  return null;
}

// State
let RAW_ROWS = []; // rows from all files merged

// UI refs
const fileInput = document.getElementById("fileInput");
const statusBox = document.getElementById("status");
const analyzeBtn = document.getElementById("analyzeBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const clearBtn = document.getElementById("clearBtn");
const minKmEl = document.getElementById("minKm");
const idlePctEl = document.getElementById("idlePct");
const kmSourceEl = document.getElementById("kmSource");
const tableWrap = document.getElementById("tableWrap");

fileInput.addEventListener("change", async (e) => {
  RAW_ROWS = [];
  statusBox.textContent = "Se citesc fișierele...";
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    try {
      if (f.type === "application/pdf" || f.name.toLowerCase().endswith(".pdf")) {
        const rows = await parsePdfFile(f);
        RAW_ROWS.push(...rows);
        statusBox.textContent = `PDF: ${f.name} → ${rows.length} rânduri`;
      } else {
        const rows = await parseSpreadsheetFile(f);
        RAW_ROWS.push(...rows);
        statusBox.textContent = `${f.name} → ${rows.length} rânduri`;
      }
    } catch (err) {
      console.error(err);
      statusBox.textContent = `Eroare la ${f.name}: ${err.message || err}`;
    }
  }
  if (!files.length) statusBox.textContent = "Niciun fișier încărcat.";
});

clearBtn.addEventListener("click", () => {
  RAW_ROWS = [];
  tableWrap.innerHTML = "";
  fileInput.value = "";
  statusBox.textContent = "Am golit datele încărcate.";
});

analyzeBtn.addEventListener("click", () => {
  if (!RAW_ROWS.length) {
    statusBox.textContent = "Încarcă mai întâi fișiere.";
    return;
  }
  const minKm = Number(minKmEl.value || 0);
  const idlePct = Number(idlePctEl.value || 0);
  const kmSource = kmSourceEl.value;
  const dataset = transformRows(RAW_ROWS, { kmSource });
  const result = analyze(dataset, { minKm, idlePct });
  renderTable(result);
  statusBox.textContent = `Analiză finalizată: ${dataset.length} camioane. ${result.flagsLowKm.length} sub prag / ${result.flagsIdle.length} idle suspect.`;
});

exportPdfBtn.addEventListener("click", () => {
  const rows = document.querySelectorAll("table tbody tr");
  if (!rows.length) { statusBox.textContent = "Nu am ce exporta. Rulează o analiză întâi."; return; }
  exportPdf();
});

async function parseSpreadsheetFile(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const out = [];
  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    out.push(...json);
  });
  return out;
}

// Basic PDF text extraction, then heuristic row reconstruction (best-effort)
async function parsePdfFile(file) {
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  let textItems = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    textItems.push(...content.items.map(i => i.str));
  }
  const full = textItems.join(" ");
  // Heuristic: split by vehicle tokens like AG-XX-YYY or patterns with letters-digits-hyphens
  const chunks = full.split(/\s(?=[A-Z]{1,3}-?\d{1,3}-?[A-Z]{0,3}\w*)/g);
  // Fallback to table header keywords
  const rows = [];
  chunks.forEach(ch => {
    const hasVeh = /[A-Z]{1,3}-?\d{1,3}-?[A-Z]{0,3}\w*/.test(ch);
    const hasKm = /(km|distanta|kilometraj)/i.test(ch);
    if (hasVeh && hasKm) rows.push({ _raw: ch });
  });
  // Return as pseudo rows. User can combine with Excel for accuracy.
  return rows;
}

function normalizeRow(row) {
  // Map columns by header names (case-insensitive, RO diacritics tolerant)
  const mapped = {};
  for (const k in row) {
    if (!k) continue;
    const key = matchHeader(k);
    if (key) mapped[key] = row[k];
  }
  // Vehicle
  const veh = row["Vehicul"] || row["VEHICUL"] || row["vehicul"] || mapped.vehicul || row.vehicul || row._raw || "";
  const vehicle = String(veh).trim();
  // Distances
  const distGps = parseRoNumber(mapped.dist_gps ?? row["Distanța GPS"] ?? row["Distanta GPS"] ?? row["Distanta"] ?? row["Km"]);
  const kmCan = parseRoNumber(mapped.km_can ?? row["Kilometraj Oprire CAN"] ?? row["Kilometraj CAN"]);
  // Times
  const tIdle = parseTimeToSeconds(mapped.timp_fnct_stationar ?? row["Timp functionare staționară"] ?? row["Timp functionare stationara"]);
  const tEngine = parseTimeToSeconds(mapped.functionare_motor ?? row["Functionare motor"] ?? row["Funcționare motor"]);
  const tMove = parseTimeToSeconds(mapped.timp_miscare ?? row["Timp in miscare"] ?? row["Timp în mișcare"]);
  const tStop = parseTimeToSeconds(mapped.timp_stationare ?? row["Timp stationare"]);
  const stops = parseRoNumber(mapped.stationari ?? row["Staționări"] ?? row["Stationari"]);
  const vmed = parseRoNumber(mapped.viteza_medie ?? row["Viteza medie (Km/h)"] ?? row["Viteza medie"]);
  return { vehicle, distGps, kmCan, tIdle, tEngine, tMove, tStop, stops, vmed };
}

function transformRows(rows, { kmSource = "auto" } = {}) {
  const out = [];
  rows.forEach(r => {
    const n = normalizeRow(r);
    if (!n.vehicle) return;
    let km = null;
    if (kmSource === "gps") km = n.distGps;
    else if (kmSource === "can") km = n.kmCan;
    else km = (n.distGps && n.distGps > 0) ? n.distGps : (n.kmCan ?? null);
    if (km == null) km = 0;
    const idlePct = n.tEngine > 0 ? (n.tIdle / n.tEngine) * 100 : 0;
    out.push({ ...n, km, idlePct });
  });
  // merge duplicates by vehicle (sum km and times)
  const byVeh = {};
  out.forEach(r => {
    if (!byVeh[r.vehicle]) byVeh[r.vehicle] = { ...r };
    else {
      const t = byVeh[r.vehicle];
      t.km += r.km;
      t.distGps = (t.distGps || 0) + (r.distGps || 0);
      t.kmCan = (t.kmCan || 0) + (r.kmCan || 0);
      t.tIdle += r.tIdle; t.tEngine += r.tEngine; t.tMove += r.tMove; t.tStop += r.tStop;
      t.stops = (t.stops || 0) + (r.stops || 0);
    }
  });
  return Object.values(byVeh).sort((a,b)=>b.km-a.km);
}

function analyze(dataset, { minKm = 500, idlePct = 30 } = {}) {
  const avgKm = dataset.reduce((s,r)=>s+r.km,0) / (dataset.length || 1);
  const lowEdge = Math.min(minKm, avgKm * 0.6);
  const flagsLowKm = dataset.filter(r => r.km < lowEdge).map(r => ({ vehicle: r.vehicle, km: r.km }));
  const flagsIdle = dataset.filter(r => r.idlePct > idlePct && r.tEngine > 3600) // engine run > 1h to matter
      .map(r => ({ vehicle: r.vehicle, idlePct: r.idlePct, tIdle: r.tIdle, tEngine: r.tEngine }));
  return { avgKm, lowEdge, flagsLowKm, flagsIdle, dataset };
}

function renderTable(result) {
  const { dataset, avgKm, lowEdge } = result;
  const rows = dataset.map(r => {
    const low = r.km < lowEdge;
    const idleSus = r.idlePct > Number(idlePctEl.value || 0) && r.tEngine > 3600;
    return `<tr>
      <td>${r.vehicle}</td>
      <td>${r.km.toFixed(2)}</td>
      <td>${secondsToHMS(r.tMove)}</td>
      <td>${secondsToHMS(r.tIdle)}</td>
      <td>${secondsToHMS(r.tEngine)}</td>
      <td>${r.idlePct.toFixed(1)}%</td>
      <td>${r.stops ?? ""}</td>
      <td>${r.vmed ?? ""}</td>
      <td>${low ? '<span class="badge danger">KM scăzuți</span>' : '<span class="badge ok">OK</span>'} ${idleSus ? '<span class="badge warn">Idle suspect</span>' : ''}</td>
    </tr>`;
  }).join("");
  tableWrap.innerHTML = `<table>
    <thead><tr>
      <th>Vehicul</th><th>KM</th><th>Timp mișcare</th><th>Timp idle</th><th>Funcționare motor</th><th>% Idle</th><th>Staționări</th><th>Viteză medie</th><th>Flag</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td>${dataset.reduce((s,r)=>s+r.km,0).toFixed(2)}</td><td colspan="7" class="muted">Medie km: ${avgKm.toFixed(1)}</td></tr></tfoot>
  </table>`;
}

function exportPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const date = new Date().toLocaleString();
  doc.setFontSize(14);
  doc.text("Analiză rapoarte GPS camioane", 40, 40);
  doc.setFontSize(10);
  doc.text(`Generat: ${date}`, 40, 58);
  // Build table from current DOM
  const headers = Array.from(document.querySelectorAll("thead th")).map(th => th.textContent.trim());
  const body = Array.from(document.querySelectorAll("tbody tr")).map(tr =>
    Array.from(tr.children).slice(0, 8).map(td => td.textContent.trim())
  );
  doc.autoTable({
    startY: 70,
    head: [headers.slice(0,8)],
    body,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [79,70,229] },
    columnStyles: { 1: { halign: "right" }, 5: { halign: "right" } }
  });
  // Flags summary
  const flagged = Array.from(document.querySelectorAll("tbody tr")).filter(tr => tr.querySelector(".badge.danger,.badge.warn"));
  let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 20 : 70;
  doc.setFontSize(12);
  doc.text("Alerte:", 40, y); y += 14;
  doc.setFontSize(10);
  if (!flagged.length) { doc.text("Nicio alertă.", 40, y); }
  else {
    flagged.forEach(tr => {
      const tds = Array.from(tr.children);
      const veh = tds[0].textContent.trim();
      const km = tds[1].textContent.trim();
      const idlePct = tds[5].textContent.trim();
      const flags = tds[8].innerText.replace(/\s+/g, " ").trim();
      doc.text(`- ${veh}: KM=${km}, Idle=${idlePct}, ${flags}`, 48, y); y += 12;
    });
  }
  doc.save(`raport_camioane_${Date.now()}.pdf`);
}
