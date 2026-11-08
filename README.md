# MedShop — offline medical shop software

Tauri 2 + React 19 + TypeScript + SQLite. Runs fully offline on Windows.
**Sprint 1**: medicine / supplier / customer screens, Excel-CSV import of existing stock, GST 2.0 rates.
(Sprint 0 gave the skeleton, schema, design system and home screen.)

## Windows पर पहली बार setup (एक बार)

1. **Node.js 22 LTS** install करें — https://nodejs.org
2. **Rust** install करें — https://rustup.rs (`rustup-init.exe` चलाएँ, default options)
3. **Microsoft C++ Build Tools** — Visual Studio Installer से "Desktop development with C++" चुनें
4. **WebView2** — Windows 10/11 में पहले से होता है
5. Project folder में:

```bash
npm install
npm run tauri dev     # app खुलेगा, पहली बार Rust compile में 3–5 मिनट लगेंगे
```

Installer बनाने के लिए: `npm run tauri build` → `src-tauri/target/release/bundle/` में `.msi` और `.exe` मिलेगा।

## Sprint 1 में क्या नया है

- **GST 2.0** (22 Sep 2025 से): दवाओं पर 0% / 5% / 18%। Migration `002` पुराने 12% items को 5% कर देता है, और DB अब 12%/28% स्वीकार नहीं करता।
- **दवाएँ (F6):** list + search; `Alt+N` नई दवा, `Enter` से अगला field, `Ctrl+S` save, `Esc` वापस। एक ही नाम की दवा पहले से हो तो चेतावनी। स्टॉक होने पर pack size lock हो जाता है।
- **सप्लायर / ग्राहक:** list + form, GSTIN check।
- **Excel / CSV import** (`Alt+I`): file चुनें → कॉलम अपने-आप पहचाने जाते हैं → जाँचें → import।
  - Marg जैसी reports की title lines छोड़कर असली header ढूँढता है।
  - Expiry के सारे formats: `08/27`, `Jan-28`, `0628`, `31/08/2027`, Excel dates।
  - Pack: `15's`, `1x15`, `15 TAB`, `150ML`। मात्रा: `3`, `2.5`, `2:5` (2 strip + 5 tablet)।
  - गलत lines छोड़ दी जाती हैं और कारण के साथ दिखती हैं; पूरा import एक transaction में (या सब, या कुछ नहीं)।
  - वही file layout दोबारा आए तो पिछली बार का column मिलान याद रहता है।
  - दूसरी बार opening stock import करने से पहले चेतावनी (वरना stock दोगुना होगा)।
- **"सैंपल डेटा से आज़माएँ"** बटन: `templates/sample-opening-stock.csv` (29 दवाएँ, जानबूझकर गड़बड़ data) से पूरा import try करें।

`.xls` (पुराना Excel) अभी सीधे नहीं पढ़ता: Excel में खोलकर **Save As → .xlsx** करें।

> **Sample data हटाना:** test के बाद असली data डालने से पहले app बंद करें और `%APPDATA%\com.medshop.app\medshop.db*` files delete करें; अगली बार खाली DB बनेगा।

## Daily commands

| Command | काम |
| --- | --- |
| `npm run tauri dev` | Desktop app development mode में |
| `npm test` | Calculation tests (GST, discount, strips, expiry) |
| `npm run typecheck` | TypeScript errors check |
| `npm run dev` | सिर्फ़ UI browser में (database के बिना) |

## Folder structure

```
src/
  App.tsx              routes + startup (settings load)
  index.css            design tokens (colours, fonts) — रंग यहीं बदलें
  components/          AppShell (header), Icons
  pages/               Home, ComingSoon (बाकी screens अगले sprints में)
  hooks/useShortcuts   F2 बिल, F3 खरीद, F4 खोज, F6 स्टॉक, F7 एक्सपायरी, F8 रिपोर्ट, F9 सेटिंग्स, Esc होम
  i18n/                English / हिंदी / मराठी text
  db/                  index.ts (reads), batch.ts (writes in one transaction), repo.ts, masters.ts, errors.ts
  lib/                 money.ts, stock.ts, gst.ts — pure logic + tests
  lib/importer/        read → mapping → values → stockImport / partyImport (+ importer.test.ts)
templates/             blank import templates + sample files
src-tauri/
  migrations/001_init.sql   पूरा database schema
  migrations/002_gst2_and_imports.sql   GST 2.0, sale ≤ MRP, import tables
  src/lib.rs                SQL plugin + migrations
  src/batch.rs              run_batch: बहुत सारे statements एक transaction में
```

## Data rules (इन्हें कभी न तोड़ें)

- **पैसे integer paise में** (₹34.10 = 3410)। कभी `REAL`/float में नहीं।
- **Quantity सबसे छोटी unit में** (tablet/ml)। Strip सिर्फ़ दिखाने के लिए।
- **GST rate basis points में** (12% = 1200)।
- **Stock सिर्फ़ `stock_moves` में row डालकर बदलता है।** Trigger अपने-आप `batches.qty_units` update करता है। Stock negative होने पर DB ख़ुद error देगा (`STOCK_NEGATIVE`)।
- `stock_moves` और `schedule_register` से कुछ delete नहीं हो सकता — DB triggers रोकते हैं।
- Bill delete नहीं, cancel होता है (`status = 'CANCELLED'`)।
- Schema बदलना हो तो **नई migration file** (`002_xxx.sql`) बनाएँ और `lib.rs` में जोड़ें; पुरानी file कभी edit न करें।

## Database कहाँ है

`%APPDATA%\com.medshop.app\medshop.db` — backup के लिए यही file (साथ में `-wal` file भी) copy करनी है।
Inspect करने के लिए [DB Browser for SQLite](https://sqlitebrowser.org) से खोलें।

## Reads vs writes

- **Reads** (`query`, `queryOne` in `db/index.ts`) go through `tauri-plugin-sql`.
- **Writes that touch more than one row** go through `new Batch().add(...).run()` (`db/batch.ts` → Rust `run_batch`).
  It runs everything in one SQLite transaction on a single connection, so a failure saves nothing.
  The plugin's pool cannot guarantee that for `BEGIN … COMMIT` sent from JavaScript.

## Tested

- 45 automated tests (`npm test`): GST, money, expiry/pack/quantity parsing, column detection, and the full sample import run against a real SQLite database with both migrations (including rollback on error).
- Search speed: 10,000 medicines + 15,000 batches → each search about 1 ms (target was < 300 ms).

## Next: Sprint 2

Purchase entry: तेज़ keyboard grid + distributor की CSV/Excel file से import (हर distributor का format एक बार map करें)। Purchase rate पिछली बार से अलग हो तो चेतावनी।
