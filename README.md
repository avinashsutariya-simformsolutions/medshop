# MedShop — offline medical shop software

Tauri 2 + React 19 + TypeScript + SQLite. Runs fully offline on Windows.
This is **Sprint 0**: project skeleton, database schema, design system and home screen.

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
  db/                  index.ts (connection), repo.ts (queries), types.ts
  lib/                 money.ts, stock.ts — pure logic + tests
src-tauri/
  migrations/001_init.sql   पूरा database schema
  src/lib.rs                SQL plugin + migrations
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

## Known limitation (Sprint 3 में ठीक करेंगे)

`tauri-plugin-sql` connection pool use करता है, इसलिए JavaScript से `BEGIN … COMMIT` भरोसेमंद transaction नहीं है।
Bill save / purchase save जैसे multi-row काम Sprint 2–3 में **Rust command** से एक ही transaction में होंगे।

## Next: Sprint 1

Item / company / supplier / customer masters, CSV import, और search की speed test (10,000 items पर < 0.3 sec)।
