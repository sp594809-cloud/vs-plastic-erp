# VS Plastic ERP – Bug fixes + PWA + Mobile UI

## Apply these files
Copy into your project root at:
`.gemini/antigravity/scratch/vs-plastic-erp/`

Overwrite matching paths:
- server.js
- views/sales/bill_form.ejs
- views/sales/print_invoice.ejs
- views/purchases/bill_form.ejs
- views/parties/form.ejs
- views/layouts/header.ejs
- views/layouts/footer.ejs
- views/layouts/sidebar.ejs
- public/css/custom-adminlte.css
- public/manifest.json
- public/service-worker.js

Then:
```bash
cd .gemini/antigravity/scratch/vs-plastic-erp
npm install
npm start
```
Open http://localhost:3001

## What was fixed / added

### Bugs
1. **GSTIN mandatory** – party form requires valid 15-char GSTIN (client + server)
2. **First product row empty** – Select2 now initializes after jQuery loads (`initBillFormPage`)
3. **GSTIN null crash** – safe substring on company GSTIN
4. **Tax mode** – only intra when both state codes exist and match
5. **Stock** – logs warning when selling below available stock

### PWA
- Improved manifest (maskable icons, scope, categories)
- Stronger service worker (network-first app, cache-first CDN)
- Apple / Android install meta tags
- theme-color + standalone display

### Mobile UI
- Off-canvas sidebar with dark overlay
- Bottom tab bar: Home | Sales | New Bill | Party | Reports
- Touch-friendly buttons/inputs (min 42px)
- Horizontal scroll tables
- Safe-area support for notched phones
- Extra bottom padding so content is not hidden behind nav

## Login
sanjay / patel
