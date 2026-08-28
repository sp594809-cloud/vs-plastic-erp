# VS Plastic ERP (PWA Replica)

A complete, production-ready Progressive Web App (PWA) replica of the internal ERP software **VS Plastic**. Built using a modern, lightweight, and zero-setup stack suitable for local desktop execution and hosting.

## Technology Stack
- **Backend**: Node.js + Express (MVC architecture rendering templates server-side)
- **Database**: SQLite (SQL engine stored inside `db/vsplastic.db`, requiring zero local database server setup)
- **Frontend Engine**: EJS (Embedded JavaScript for PHP-like templating logic)
- **Frontend UI Styles**: Bootstrap 5 + AdminLTE style theme (`public/css/custom-adminlte.css`)
- **Frontend Interactivity**: jQuery + Select2 (Party & Product lookup dropdowns) + DataTables (with Excel, PDF, & Print export buttons)
- **Data Visualization**: Chart.js (monthly sales trends and outstanding statistics)
- **PWA Features**: Service Worker cache integration, offline fallbacks, and mobile-responsive layout shell

---

## Installation & Setup

1. **Prerequisites**: Make sure you have [Node.js](https://nodejs.org) installed on your machine.
2. **Install Dependencies**:
   ```bash
   npm install
   ```
3. **Database Initialization**: The SQLite database engine is configured to automatically initialize the schema and seed standard plastic trading dataset (HDPE, LDPE, PP bags, company profiles, customer/supplier accounts) upon first server boot.

---

## Running the Application

1. **Development Mode (Auto-Reload)**:
   ```bash
   npm run dev
   ```
2. **Production Mode**:
   ```bash
   npm start
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## Default Access Credentials
- **Username**: `sanjay`
- **Password**: `patel`

---

## Features Implemented

1. **Authentication**: Simple login page using session validation.
2. **Dashboard**: Stat tiles showing Sales/Purchase invoice counts, Party counts, and Product counts. Integrated dynamic charts showcasing monthly sales logs and customer/supplier balance ratios.
3. **Party Master**: CRUD panel for customer and supplier accounts.
   - **Auto-fill GST State Code**: Entering the first two digits of a party's GSTIN automatically fills the State and State Code fields.
4. **Product Master**: CRUD panel with product details, unit of measurement selections, pricing grids, and tax rates.
5. **Sales & Challan**: Highly interactive invoicing sheet.
   - Company profiles selection.
   - Select2 party auto-completion with address filling.
   - Dynamic item row addition/removal.
   - **Intelligent GST Calculations**: Tax calculations are performed automatically on the client side: same-state company and customer applies **CGST + SGST**, while inter-state trades trigger **IGST**.
   - Save as Draft or Finalize and Print.
   - A4 Professional Print layout view with print CSS (hides navbars/buttons, centers invoicing table, signature boxes).
   - **Indian Rupee Wordings**: Auto-converts numbers to Indian style currency words (e.g. "Ten Thousand Rupees") for the printed invoice.
6. **Purchase Module**: Identical invoicing panels for recording supplier trade logs, affecting product stock levels and supplier ledger balances.
7. **Payments**: Records payments received from customers (Sale Payments) or paid to suppliers (Purchase Payments). Links payments to specific invoices, updates ledger balances, and creates cash/bank transaction records.
8. **Cash & Bank Records**: Real-time cash book and individual bank books tracking cash levels and bank ledger statement entries.
9. **Stock Ledger**: Aggregated list of all products showing opening stock, stock in, stock out, current stock, and valuation estimates.
10. **Business Reports**: 
    - **Sales/Purchase Register**: Filterable list of all finalized bills by date range, company, and party with DataTables exports.
    - **Party Ledger**: Full statements of account calculating opening outstanding balance, chronologically ordering debits/credits, and generating closing balances.
    - **GST Summary**: Outward (GSTR-1) and Inward (GSTR-2) summaries grouping taxable amount, CGST, SGST, and IGST totals.
    - **Outstanding Balances**: Receivables and Payables list.
11. **Settings**: Year management (activate financial years), Units, Companies configuration, Taxes, Banks account profiles, and **One-Click Backup** (downloads the database file `vsplastic.db` directly).
