# 🏟️ ARENA TULAI — TikTok LIVE Quiz

Quiz vertical **9:16** pentru TikTok LIVE. Oamenii răspund în chat cu **A / B / C / D**, primesc puncte, iar **Top 3** rămâne permanent pe ecran.

## Ce include

- întrebări de cultură generală, logică, puzzle, capcane, matematică, știință și funny;
- niveluri: ușor / mediu / greu / expert;
- timer automat + reveal + rundă următoare;
- primul răspuns A/B/C/D al fiecărui utilizator este luat în calcul;
- puncte de quiz bazate și pe viteză;
- **Gift Power**: maximum 30 puncte/rundă, adică maximum 30% dintr-o rundă de 100;
- Top 3 permanent + leaderboard Top 10 în Control Room;
- animație mare la gift;
- mod DEMO pentru test fără TikTok;
- Control Room pentru Start / Reveal / Reset / simulare răspunsuri și gift-uri;
- pregătit pentru GitHub + Render.

## 1. Test local

Ai nevoie de Node.js 20+.

```bash
npm install
cp .env.example .env
npm start
```

Deschide:

- joc: `http://localhost:3000`
- control: `http://localhost:3000/control?key=arena-tulai-dev`

Dacă setezi `ADMIN_KEY` în mediul de rulare, folosește acea valoare în URL.

## 2. Conectare TikTok LIVE

Setează variabila:

```env
TIKTOK_USERNAME=numele_tau_fara_arond
```

Serverul ascultă mesajele din chat. Dacă un mesaj începe cu `A`, `B`, `C` sau `D`, îl tratează drept răspuns. Gift-urile adaugă Gift Power.

> Integrarea folosește `tiktok-live-connector`, un proiect neoficial. TikTok poate schimba protocolul. De aceea jocul are și mod demo/manual, iar partea de UI/scoring nu depinde de TikTok.

## 3. Render

1. Render → **New +** → **Web Service**.
2. Conectezi repo-ul GitHub `arena-tulai`.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Adaugi Environment Variables:
   - `TIKTOK_USERNAME` = userul tău TikTok fără `@`
   - `ADMIN_KEY` = o parolă lungă aleatoare
   - `AUTO_ADVANCE` = `true`
6. Deploy.

Repo-ul include și `render.yaml`, deci poți folosi și Blueprint.

## 4. Cum îl pui pe LIVE

Deschide URL-ul Render într-un browser source/OBS/Live Studio la rezoluție **1080 × 1920**. Interfața este făcută cu zone importante mutate spre centru și cu spațiu de siguranță spre partea de jos, unde TikTok pune multe elemente UI.

### Control Room

Pe laptop/PC:

`https://URL-UL-TAU.onrender.com/control?key=ADMIN_KEY`

Acolo vezi preview-ul, Top 10 și poți controla rundele.

## Scoring

- Quiz: max **70 puncte** pe rundă; răspunsurile mai rapide primesc mai mult.
- Gift Power: max **30 puncte** pe utilizator/rundă.
- Total maxim/rundă: **100**.
- Gift-urile nu pot trece peste plafonul de 30%.

Poți modifica rata cu:

```env
GIFT_POINT_RATE=0.35
```

Dacă oferi premii reale sau bani, verifică separat regulile TikTok și legislația aplicabilă concursurilor/promoțiilor.
