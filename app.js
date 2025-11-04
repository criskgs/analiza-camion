// App V2: fixed mapping for the provided 'SUMMARY' Excel
const fileInput = document.getElementById("fileInput");
const statusBox = document.getElementById("status");
const periodBox = document.getElementById("periodBox");
const analyzeBtn = document.getElementById("analyzeBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const clearBtn = document.getElementById("clearBtn");
const minKmEl = document.getElementById("minKm");
const kmSourceEl = document.getElementById("kmSource");
const tableWrap = document.getElementById("tableWrap");

let RAW_SHEETS = []; // store whole sheet tables
let PERIOD = null;   // {start: Date, end: Date, hours: Number}

fileInput.addEventListener("change", async (e) => {
  RAW_SHEETS = [];
  PERIOD = null;
  statusBox.textContent = "Se citesc fișierele...";
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      const meta = extractPeriod(grid);
      if (meta) PERIOD = meta;
      const table = extractTable(grid);
      RAW_SHEETS.push(...table);
      statusBox.textContent = `${f.name} → ${table.length} rânduri`;
    } catch (err) {
      console.error(err);
      statusBox.textContent = `Eroare la ${f.name}: ${err.message || err}`;
    }
  }
  if (PERIOD) {
    const hrs = PERIOD.hours.toFixed(2);
    const allowed = (PERIOD.hours / 24) * 3;
    periodBox.textContent = `Perioadă: ${PERIOD.start.toLocaleString()}  –  ${PERIOD.end.toLocaleString()}  •  Durată: ${hrs} h  •  Idle normal admis: ${(allowed).toFixed(2)} h (3h/24h)`;
  } else {
    periodBox.textContent = "Nu am putut extrage perioada (\"Data / Durata efectivă\").";
  }
});

clearBtn.addEventListener("click", () => {
  RAW_SHEETS = []; PERIOD = null; tableWrap.innerHTML = "";
  fileInput.value = ""; statusBox.textContent = "Am golit datele încărcate."; periodBox.textContent = "";
});

analyzeBtn.addEventListener("click", () => {
  if (!RAW_SHEETS.length) { statusBox.textContent = "Încarcă mai întâi fișiere."; return; }
  const minKm = Number(minKmEl.value || 0);
  const kmSource = kmSourceEl.value;
  const dataset = transformAndAggregate(RAW_SHEETS, { kmSource });
  const result = analyze(dataset, { minKm, periodHours: PERIOD ? PERIOD.hours : null });
  renderTable(result);
  statusBox.textContent = `Analiză: ${dataset.length} camioane • ${result.flagsLowKm.length} sub prag KM • ${result.flagsIdleOver.length} peste idle normal`;
});

exportPdfBtn.addEventListener("click", () => {
  const rows = document.querySelectorAll("table tbody tr");
  if (!rows.length) { statusBox.textContent = "Nu am ce exporta. Rulează o analiză întâi."; return; }
  exportPdf();
});

// --- Parsing helpers for the fixed sheet ---
function extractPeriod(grid) {
  // Expect row ~2, col ~2: "Data / Durata efectivă: dd.mm.yyyy hh:mm:ss - dd.mm.yyyy hh:mm:ss"
  const re = /Data\s*\/\s*Durata\s*efectiv[ăa]\s*:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})\s*-\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})/i;
  for (let r = 0; r < Math.min(10, grid.length); r++) {
    for (let c = 0; c < Math.min(6, grid[r].length); c++) {
      const cell = String(grid[r][c] || "");
      const m = cell.match(re);
      if (m) {
        const [_, s1, s2] = m;
        const [d1, t1] = s1.split(" "); const [d2, t2] = s2.split(" ");
        const toDate = (d, t) => {
          const [dd, mm, yyyy] = d.split(".").map(Number);
          const [hh, mi, ss] = t.split(":").map(Number);
          return new Date(yyyy, mm - 1, dd, hh, mi, ss);
        };
        const start = toDate(d1, t1), end = toDate(d2, t2);
        const hours = (end - start) / 3_600_000;
        return { start, end, hours };
      }
    }
  }
  return null;
}

function extractTable(grid) {
  // Find header row where 'Vehicul' appears
  let headerRow = -1;
  for (let i = 0; i < Math.min(grid.length, 200); i++) {
    if (grid[i].some(v => String(v).trim().toLowerCase() === "vehicul")) { headerRow = i; break; }
  }
  if (headerRow === -1) return [];
  // Identify column indices based on the exact labels present in provided sheet
  const row = grid[headerRow];
  const idx = {
    vehicul: row.findIndex(v => String(v).trim().toLowerCase() === "vehicul"),
    timpMiscare: row.findIndex(v => String(v).toLowerCase().includes("timp în mi")),
    distGps: row.findIndex(v => String(v).toLowerCase().includes("distanta gps")),
    kmCan: row.findIndex(v => String(v).toLowerCase().includes("kilometraj oprire can")),
    timpStationare: row.findIndex(v => String(v).toLowerCase().includes("timp stationare")),
    stationari: row.findIndex(v => String(v).toLowerCase().includes("staționări")),
    vMax: row.findIndex(v => String(v).toLowerCase().includes("viteză maximă")),
    vMedie: row.findIndex(v => String(v).toLowerCase().includes("viteza medie")),
    consum: row.findIndex(v => String(v).toLowerCase().includes("consum total normat")),
    timpIdle: row.findIndex(v => String(v).toLowerCase().includes("timp func") && String(v).toLowerCase().includes("staționar")),
    funcMotor: row.findIndex(v => String(v).toLowerCase().includes("functionare motor")),
  };
  const out = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const g = grid[r];
    const veh = String(g[idx.vehicul] || "").trim();
    if (!veh || veh.toLowerCase() === "total" || veh.toLowerCase() === "medie") break;
    out.push({
      vehicle: veh,
      timpMiscare: String(g[idx.timpMiscare] || ""),
      distGps: String(g[idx.distGps] || ""),
      kmCan: String(g[idx.kmCan] || ""),
      timpStationare: String(g[idx.timpStationare] || ""),
      stationari: String(g[idx.stationari] || ""),
      vMedie: String(g[idx.vMedie] || ""),
      timpIdle: String(g[idx.timpIdle] || ""),
      funcMotor: String(g[idx.funcMotor] || ""),
    });
  }
  return out;
}

// --- Transform + analysis ---
const toNumberRO = (s) => {
  if (s == null) return null;
  if (typeof s === "number") return s;
  s = String(s).trim();
  if (!s) return null;
  return Number(s.replace(/\s/g,"").replace(/\./g,"").replace(",", "."));
};

const timeToHours = (val) => {
  if (!val) return 0;
  const s = String(val);
  // supports "2z 08h 55m 33s" or "06h 48m 19s" etc
  let d=0,h=0,m=0,sec=0;
  const D = s.match(/(\d+)\s*z/i); if (D) d = +D[1];
  const H = s.match(/(\d+)\s*h/i); if (H) h = +H[1];
  const M = s.match(/(\d+)\s*m(?!s)/i); if (M) m = +M[1];
  const S = s.match(/(\d+)\s*s/i); if (S) sec = +S[1];
  return d*24 + h + m/60 + sec/3600;
};

function transformAndAggregate(rows, { kmSource = "auto" } = {}) {
  // dedupe/aggregate by vehicle (sum times and kms)
  const map = new Map();
  for (const r of rows) {
    const kmGps = toNumberRO(r.distGps);
    const kmCan = toNumberRO(r.kmCan);
    let km;
    if (kmSource === "gps") km = kmGps || 0;
    else if (kmSource === "can") km = kmCan || 0;
    else km = (kmGps && kmGps > 0) ? kmGps : (kmCan || 0);
    const key = r.vehicle;
    const val = map.get(key) || { vehicle: key, km: 0, tMoveH: 0, tIdleH: 0, tEngineH: 0, stops: 0, vMedie: null };
    val.km += km;
    val.tMoveH += timeToHours(r.timpMiscare);
    val.tIdleH += timeToHours(r.timpIdle);
    val.tEngineH += timeToHours(r.funcMotor);
    val.stops += Number(r.stationari || 0);
    val.vMedie = toNumberRO(r.vMedie) || val.vMedie;
    map.set(key, val);
  }
  return Array.from(map.values()).sort((a,b)=>b.km-a.km);
}

function analyze(dataset, { minKm = 500, periodHours = null } = {}) {
  const avgKm = dataset.reduce((s,r)=>s+r.km,0) / Math.max(1, dataset.length);
  const lowEdge = Math.min(minKm, avgKm * 0.6);
  let allowedIdleH = null;
  if (periodHours) allowedIdleH = (periodHours / 24) * 3; // rule: 3h per 24h
  const flagsLowKm = dataset.filter(r => r.km < lowEdge).map(r => ({ vehicle: r.vehicle, km: r.km }));
  const flagsIdleOver = allowedIdleH == null ? [] :
    dataset.filter(r => r.tIdleH > allowedIdleH).map(r => ({ vehicle: r.vehicle, idleH: r.tIdleH, overBy: r.tIdleH - allowedIdleH }));
  return { avgKm, lowEdge, allowedIdleH, flagsLowKm, flagsIdleOver, dataset };
}

function renderTable(result) {
  const { dataset, avgKm, lowEdge, allowedIdleH } = result;
  const rows = dataset.map(r => {
    const low = r.km < lowEdge;
    const idleOver = (allowedIdleH != null && r.tIdleH > allowedIdleH);
    return `<tr>
      <td>${r.vehicle}</td>
      <td class="num">${r.km.toFixed(2)}</td>
      <td>${r.tMoveH.toFixed(2)} h</td>
      <td>${r.tIdleH.toFixed(2)} h</td>
      <td>${r.tEngineH.toFixed(2)} h</td>
      <td>${r.vMedie ?? ""}</td>
      <td>${r.stops}</td>
      <td>${low ? '<span class="badge danger">KM scăzuți</span>' : '<span class="badge ok">OK</span>'} ${idleOver ? `<span class="badge warn">Idle peste normal (+${(r.tIdleH-allowedIdleH).toFixed(2)}h)</span>` : ''}</td>
    </tr>`;
  }).join("");
  const footerNote = allowedIdleH != null ? `Idle permis (3h/24h): ${allowedIdleH.toFixed(2)} h` : `Idle permis: n/a`;
  tableWrap.innerHTML = `<table>
    <thead><tr>
      <th>Vehicul</th><th>KM</th><th>Timp mișcare</th><th>Timp idle</th><th>Funcționare motor</th><th>Viteză medie</th><th>Staționări</th><th>Alerte</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${dataset.reduce((s,r)=>s+r.km,0).toFixed(2)}</td><td colspan="6" class="muted">Medie km: ${avgKm.toFixed(1)} • ${footerNote}</td></tr></tfoot>
  </table>`;
}

function exportPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text("Analiză rapoarte GPS camioane – V2", 40, 40);
  doc.setFontSize(10);
  const p = periodBox.textContent || "";
  doc.text(p, 40, 58, { maxWidth: 515 });
  const headers = Array.from(document.querySelectorAll("thead th")).map(th => th.textContent.trim());
  const body = Array.from(document.querySelectorAll("tbody tr")).map(tr =>
    Array.from(tr.children).slice(0, 7).map(td => td.textContent.trim())
  );
  doc.autoTable({
    startY: 80,
    head: [headers.slice(0,7)],
    body,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [79,70,229] },
    columnStyles: { 1: { halign: "right" } }
  });
  // Alerts
  let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 20 : 80;
  doc.setFontSize(12); doc.text("Alerte:", 40, y); y += 14; doc.setFontSize(10);
  const flagged = Array.from(document.querySelectorAll("tbody tr")).filter(tr => tr.querySelector(".badge.danger,.badge.warn"));
  if (!flagged.length) doc.text("Nicio alertă.", 40, y);
  else {
    flagged.forEach(tr => {
      const tds = Array.from(tr.children);
      const veh = tds[0].textContent.trim();
      const km = tds[1].textContent.trim();
      const idle = tds[3].textContent.trim();
      const note = tds[7].innerText.replace(/\s+/g," ").trim();
      doc.text(`- ${veh}: KM=${km}, Idle=${idle}, ${note}`, 48, y); y += 12;
    });
  }
  doc.save(`raport_camioane_v2_${Date.now()}.pdf`);
}
