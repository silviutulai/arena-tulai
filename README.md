# ARENA TULAI VISUAL — TikTok LIVE Quiz

Joc de întrebări în **format 9:16** pentru TikTok LIVE, cu răspunsuri **A / B / C / D** din comentarii, cadouri reale și Top 3. Designul modern este gândit pentru OBS / TikTok LIVE Studio, în rezoluție **1080 × 1920**.

## Ce conține

- **120 de întrebări complet noi**, din 35 de categorii, dintre care **46 cu imagini**;
- **23 de ilustrații SVG locale**, inclusiv 8 siluete de țări și diagrame de știință, matematică, logică, astronomie și tehnologie; nu depind de servicii externe de imagini;
- **LIVE GOAL de 2.000 PTS** — suma punctelor de quiz și a celor din cadouri ale tuturor jucătorilor;
- **LIVE GOAL de 100.000 TAP TAP-uri** — like-urile primite prin evenimentul TikTok `LIKE`;
- **⚡ x2 după 500 PTS**: când un jucător depășește 500 de puncte totale, **răspunsurile viitoare** la întrebări primesc puncte duble; cadourile rămân la valoarea normală;
- punctaj cumulativ pe utilizator, identitate comună pentru chat și cadouri și un singur răspuns luat în calcul pentru fiecare rundă;
- Top 3 cu indicator x2, feedback la răspunsuri, animații pentru cadouri și Control Room cu mod demo.

## Punctaj

Primul răspuns **corect** la o întrebare primește **50 PTS**. Ceilalți pierd câte 10 PTS pentru fiecare secundă de întârziere: 40 PTS după o secundă, 30 după două, 20 după trei, 10 după patru și **0 după cinci secunde**. Fracțiunile de secundă contează proporțional. Răspunsurile greșite primesc 0; fiecare jucător poate da un singur răspuns per rundă.

Când scorul unui jucător a devenit **mai mare de 500 PTS**, punctele câștigate la următoarele întrebări sunt multiplicate cu 2. Nu se dublează punctele deja obținute și nici cadourile. **1 diamant = 1 punct**, fără plafon.

## Configurare

Instalează **Node.js 22** și rulează:

```bash
npm install
npm run verify
npm start
```

Server local: `http://localhost:3000`

Control Room: `http://localhost:3000/control?key=CHEIA_TA`

Variabilele relevante în Render → Environment sunt:

```env
TIKTOK_USERNAME=numele_tau_fara_arond
SIGN_API_KEY=cheia_euler_daca_ai_una
ADMIN_KEY=cheia_privata_de_admin
AUTO_ADVANCE=true
QUESTION_SECONDS=25
REVEAL_SECONDS=7
TIKTOK_RETRY_MS=15000
```

**Nu publica** `SIGN_API_KEY` sau `ADMIN_KEY` în GitHub și nu le trimite în chat. Cheia Euler este opțională, dar dacă ai configurat-o deja în Render, **las-o acolo**; noua interfață nu modifică conectarea TikTok.

Render folosește `npm install && npm run verify` înainte de pornire, iar `npm start` rulează `server2.js`.

## LIVE și Control Room

Deschide pagina Render în browser source la **1080 × 1920**, apoi accesează `/control?key=CHEIA_TA` pentru a porni prima întrebare. Următoarele se schimbă automat dacă `AUTO_ADVANCE=true`.

În Control Room poți simula un comentariu A/B/C/D, un cadou și un lot de like-uri fără să cheltui cadouri reale sau să creezi noi conexiuni TikTok. **Nu folosi Reconnect sau deploy repetat** fără motiv: serviciul de semnare poate aplica limite orare.

Imaginile întrebărilor se află în `public/visuals/`, iar banca nouă în `data/questions.js`. Întrebările nu se repetă până nu a fost parcursă toată lista.

**Notă despre Render Free:** scorurile, LIVE GOAL-urile și rundele sunt păstrate în memoria procesului. Un restart sau o intrare în sleep le resetează. Like-urile sunt numărate din evenimentele LIVE recepționate efectiv de joc, nu reprezintă o statistică TikTok garantată pentru perioadele în care aplicația nu este conectată.

## Testare înainte de LIVE

`npm run verify` verifică sintaxa, dependențele și testele pentru întrebări/imagini, conectarea păstrată nemodificată, comentarii, cadouri, multiplicator x2 și evenimentul LIKE. Testele automate nu înlocuiesc o verificare reală pe LIVE: pornește o rundă și cere unui alt cont să trimită răspunsuri.
