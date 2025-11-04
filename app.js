// App V3 – manual period selection (days)
const fileInput = document.getElementById("fileInput");
const statusBox = document.getElementById("status");
const analyzeBtn = document.getElementById("analyzeBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const clearBtn = document.getElementById("clearBtn");
const minKmEl = document.getElementById("minKm");
const kmSourceEl = document.getElementById("kmSource");
const periodDaysEl = document.getElementById("periodDays");
const tableWrap = document.getElementById("tableWrap");

let RAW_SHEETS = [];

fileInput.addEventListener("change", async (e) => {
  RAW_SHEETS = [];
  statusBox.textContent = "Se citesc fișierele...";
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      const table = extractTable(grid);
      RAW_SHEETS.push(...table);
      statusBox.textContent = `${f.name} → ${table.length} rânduri`;
    } catch (err) {
      console.error(err);
      statusBox.textContent = `Eroare la ${f.name}: ${err.message || err}`;
    }
  }
});

clearBtn.addEventListener("click", () => {
  RAW_SHEETS = []; tableWrap.innerHTML = "";
  fileInput.value = ""; statusBox.textContent = "Am golit datele încărcate.";
});

analyzeBtn.addEventListener("click", () => {
  if (!RAW_SHEETS.length) { statusBox.textContent = "Încarcă mai întâi fișiere."; return; }
  const minKm = Number(minKmEl.value || 0);
  const kmSource = kmSourceEl.value;
  const days = Number(periodDaysEl.value || 1);
  const dataset = transformAndAggregate(RAW_SHEETS, { kmSource });
  const result = analyze(dataset, { minKm, days });
  renderTable(result);
  statusBox.textContent = `Analiză: ${dataset.length} camioane • ${result.flagsLowKm.length} sub prag KM • ${result.flagsIdleOver.length} peste idle normal`;
});

exportPdfBtn.addEventListener("click", () => {
  const rows = document.querySelectorAll("table tbody tr");
  if (!rows.length) { statusBox.textContent = "Nu am ce exporta. Rulează o analiză întâi."; return; }
  exportPdf();
});

function extractTable(grid) {
  let headerRow = -1;
  for (let i = 0; i < Math.min(grid.length, 200); i++) {
    if (grid[i].some(v => String(v).trim().toLowerCase() === "vehicul")) { headerRow = i; break; }
  }
  if (headerRow === -1) return [];
  const row = grid[headerRow].map(x => String(x).trim().toLowerCase());
  const getIdx = (needle) => row.findIndex(v => v.includes(needle));
  const idx = {
    vehicul: row.indexOf("vehicul"),
    timpMiscare: getIdx("timp în mi") !== -1 ? getIdx("timp în mi") : getIdx("timp in mi"),
    distGps: getIdx("distanta gps"),
    kmCan: getIdx("kilometraj oprire can"),
    timpIdle: getIdx("timp func") !== -1 ? getIdx("timp func") : getIdx("functionare stationar"),
    funcMotor: getIdx("functionare motor"),
    vMedie: getIdx("viteza medie"),
    stationari: getIdx("stationari"),
  };
  const out = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const g = grid[r];
    const veh = String(g[idx.vehicul] || "").trim();
    if (!veh || veh.toLowerCase() === "total" || veh.toLowerCase() === "medie") break;
    out.push({
      vehicle: veh,
      distGps: g[idx.distGps] || "",
      kmCan: g[idx.kmCan] || "",
      timpMiscare: g[idx.timpMiscare] || "",
      timpIdle: g[idx.timpIdle] || "",
      funcMotor: g[idx.funcMotor] || "",
      vMedie: g[idx.vMedie] || "",
      stationari: g[idx.stationari] || "",
    });
  }
  return out;
}

const toNumberRO = (s) => {
  if (s == null) return null;
  if (typeof s === "number") return s;
  s = String(s).trim();
  if (!s) return null;
  return Number(s.replace(/\\s/g,\"\" ).replace(/\\./g, \"\").replace(\",\", \".\"));
};

const timeToHours = (val) => {
  if (!val) return 0;
  const s = String(val);
  let d=0,h=0,m=0,sec=0;
  const D = s.match(/(\\d+)\\s*z/i); if (D) d = +D[1];
  const H = s.match(/(\\d+)\\s*h/i); if (H) h = +H[1];
  const M = s.match(/(\\d+)\\s*m(?!s)/i); if (M) m = +M[1];
  const S = s.match(/(\\d+)\\s*s/i); if (S) sec = +S[1];
  return d*24 + h + m/60 + sec/3600;
};

function transformAndAggregate(rows, { kmSource = \"auto\" } = {}) {
  const map = new Map();
  for (const r of rows) {
    const kmGps = toNumberRO(r.distGps);
    const kmCan = toNumberRO(r.kmCan);
    let km;
    if (kmSource === \"gps\") km = kmGps || 0;
    else if (kmSource === \"can\") km = kmCan || 0;
    else km = (kmGps && kmGps > 0) ? kmGps : (kmCan || 0);
    const key = r.vehicle;
    const val = map.get(key) || { vehicle: key, km: 0, tMoveH: 0, tIdleH: 0, tEngineH: 0, stops: 0, vMedie: null };
    val.km += km;
    val.tMoveH += timeToHours(r.timpMiscare);
    val.tIdleH += timeToHours(r.timpIdle);
    val.tEngineH += timeToHours(r.funcMotor);
    val.vMedie = toNumberRO(r.vMedie) || val.vMedie;
    map.set(key, val);
  }
  return Array.from(map.values()).sort((a,b)=>b.km-a.km);
}

function analyze(dataset, { minKm = 500, days = 1 } = {}) {
  const avgKm = dataset.reduce((s,r)=>s+r.km,0) / Math.max(1, dataset.length);
  const lowEdge = Math.min(minKm, avgKm * 0.6);
  const allowedIdleH = days * 3; // 3h per day
  const flagsLowKm = dataset.filter(r => r.km < lowEdge);
  const flagsIdleOver = dataset.filter(r => r.tIdleH > allowedIdleH);
  return { avgKm, lowEdge, allowedIdleH, flagsLowKm, flagsIdleOver, dataset };
}

function renderTable(result) {
  const { dataset, avgKm, lowEdge, allowedIdleH } = result;
  const rows = dataset.map(r => {
    const low = r.km < lowEdge;
    const idleOver = r.tIdleH > allowedIdleH;
    return `<tr>
      <td>${r.vehicle}</td>
      <td>${r.km.toFixed(2)}</td>
      <td>${r.tMoveH.toFixed(2)} h</td>
      <td>${r.tIdleH.toFixed(2)} h</td>
      <td>${r.tEngineH.toFixed(2)} h</td>
      <td>${r.vMedie ?? \"\"}</td>
      <td>${low ? '<span class=\"badge danger\">KM scăzuți</span>' : '<span class=\"badge ok\">OK</span>'} ${idleOver ? `<span class=\"badge warn\">Idle peste normal (+${(r.tIdleH-allowedIdleH).toFixed(2)}h)</span>` : ''}</td>
    </tr>`;
  }).join(\"\");
  tableWrap.innerHTML = `<table>
    <thead><tr><th>Vehicul</th><th>KM</th><th>Timp mișcare</th><th>Timp idle</th><th>Funcționare motor</th><th>Viteză medie</th><th>Alerte</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td>${dataset.reduce((s,r)=>s+r.km,0).toFixed(2)}</td><td colspan=\"5\" class=\"muted\">Medie km: ${avgKm.toFixed(1)} • Idle permis: ${allowedIdleH.toFixed(2)} h (3h/zi)</td></tr></tfoot>
  </table>`;
}

function exportPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: \"pt\", format: \"a4\" });
  const date = new Date().toLocaleString();
  doc.setFontSize(14);
  doc.text(\"Analiză rapoarte GPS camioane – V3\", 40, 40);
  doc.setFontSize(10);
  doc.text(`Generat: ${date}`, 40, 58);
  const headers = Array.from(document.querySelectorAll(\"thead th\")).map(th => th.textContent.trim());
  const body = Array.from(document.querySelectorAll(\"tbody tr\")).map(tr =>
    Array.from(tr.children).slice(0, 6).map(td => td.textContent.trim())
  );
  doc.autoTable({ startY: 80, head: [headers.slice(0,6)], body, styles:{fontSize:8}, headStyles:{fillColor:[79,70,229]} });
  doc.save(`raport_camioane_v3_${Date.now()}.pdf`);
}
