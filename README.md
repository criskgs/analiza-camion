# Analizor Rapoarte GPS Camioane – V2 (format fix SUMMARY)

Această versiune este adaptată la structura Excel (`SUMMARY`) furnizată:
- Perioada este extrasă din textul „Data / Durata efectivă: … - …” de sus.
- Tabelul începe de la rândul cu **Vehicul** și folosește exact coloanele:  
  Vehicul, Timp în mișcare, Distanța GPS, Kilometraj Oprire CAN, Timp staționare, Staționări, Viteza medie (Km/h), Timp funcționare staționară, Funcționare motor.
- Prag „idle normal” calculat ca **3 ore / 24h** pe întreaga perioadă. Exemplu: la 9 zile ≈ **27h** permise; peste → „Idle peste normal (+Xh)”.

## Deploy Netlify
- Build command: *(gol)* sau `none`  
- Publish directory: `/` (rădăcina)

## Notă
Pentru Excel-uri cu foi multiple, se analizează prima foaie din fiecare fișier încărcat. Se pot încărca mai multe fișiere, iar rezultatele se agregă pe vehicul.
