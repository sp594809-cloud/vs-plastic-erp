# Connect VS Plastic ERP to TiDB Cloud (persistent DB)

## Why
Local SQLite file is wiped on many hosts when the app restarts/redeploys.
TiDB Cloud keeps bills, parties, products permanently.

## 1. Files to copy into your app
Put these into `.gemini/antigravity/scratch/vs-plastic-erp/`:

- `db/connection.js`          (TiDB + SQLite fallback)
- `db/schema.mysql.sql`       (MySQL/TiDB schema)
- `db/seeds.sql`              (unchanged seed data)
- `server.js`                 (loads dotenv + DATE_FORMAT fix)
- `package.json`              (adds mysql2 + dotenv)
- `.env.example`
- `.gitignore`                (ignores `.env`)

## 2. Install
```bash
cd .gemini/antigravity/scratch/vs-plastic-erp
npm install
```

## 3. Local `.env` (never commit this file)
```env
DB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
DB_PORT=4000
DB_USER=Be1MriyfRQUTywa.root
DB_PASSWORD=your_password_here
DB_NAME=vsplastic
DB_SSL_REJECT_UNAUTHORIZED=true
```

Use database **`vsplastic`** (not `sys`).

## 4. Deploy platform env vars
On Render / Railway / Vercel / Fly / etc. set the same keys:

| Variable | Value |
|----------|--------|
| DB_HOST | gateway01.ap-southeast-1.prod.aws.tidbcloud.com |
| DB_PORT | 4000 |
| DB_USER | Be1MriyfRQUTywa.root |
| DB_PASSWORD | (your TiDB password) |
| DB_NAME | vsplastic |
| DB_SSL_REJECT_UNAUTHORIZED | true |

## 5. Run
```bash
npm start
```

First start creates tables + seeds (user `sanjay` / `patel`).
Later starts reuse existing data — **refresh will NOT wipe bills**.

## Security (important)
You shared a **GitHub token** and **DB password** in chat.
1. Revoke/rotate the GitHub token now: GitHub → Settings → Developer settings → Personal access tokens
2. Change the TiDB password in TiDB Cloud console
3. Never commit `.env` or tokens to git
