# Analizor Rapoarte GPS Camioane (static SPA)

Aplicație front-end (fără backend) pentru a încărca rapoarte din sistemul GPS (Excel/CSV sau PDF), a calcula sumarizări și a exporta un raport PDF pentru dispecerat.

## Funcționalități
- Upload multiple fișiere `.xlsx`, `.xls`, `.csv` sau `.pdf` (PDF este best-effort).
- Mapare flexibilă a coloanelor (funcționează cu antete în română; toleră diacritice).
- Agregare pe *Vehicul* (sume pe km și timp).
- Alegere sursă KM (GPS / CAN / Auto).
- Praguri configurabile: KM minim, procent idle suspect.
- Tablou comparativ + etichete: **KM scăzuți**, **Idle suspect**.
- Export **PDF** cu tabel și listă de alerte.
- **Găzduire ușoară pe Netlify** (static site).

## Deploy rapid pe Netlify
1. Fork / clone repo sau descarcă arhiva.
2. În Netlify -> **New site from Git** (sau "Deploy manually" și încarcă folderul).
3. Build command: *(nimic)*, Publish directory: rădăcina.
4. Done.

## Structură
```
/index.html
/styles.css
/app.js
/sample.csv
/LICENSE
```

## Format date
Antetele acceptate (câteva variante):  
- **Vehicul**  
- **Distanța GPS** / **Distanța** / **KM GPS** / **KM**  
- **Kilometraj Oprire CAN** / **KM CAN**  
- **Timp în mișcare** / **Timp mișcare**  
- **Timp staționare**  
- **Staționări**  
- **Viteza medie (Km/h)**  
- **Timp funcționare staționară**  
- **Funcționare motor**  

> Formatele de timp acceptate: `hh:mm:ss`, `12h 03m 30s`, `1z 02h 20m 05s` etc.  
> Numerele cu punct ca separator de mii și virgulă ca zecimal sunt suportate (ex. `6.959,16`).

## PDF
Parserul de PDF folosește `pdf.js` și este *heuristic*. Pentru rezultate perfecte, exportați din sistem în Excel/CSV; PDF-urile tabelare sunt adesea greu de reconstruit fidel.

## Licență
MIT
