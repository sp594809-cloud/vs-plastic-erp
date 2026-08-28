-- VS Plastic ERP Database Schema (SQLite)

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Financial Years Table
CREATE TABLE IF NOT EXISTS financial_years (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, -- e.g. "2025-2026", "2026-2027"
    is_active INTEGER DEFAULT 0, -- 1 for active, 0 for inactive
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    gstin TEXT,
    phone TEXT,
    email TEXT,
    logo_path TEXT,
    bank_name TEXT,
    bank_ac_no TEXT,
    bank_ifsc TEXT,
    bank_branch TEXT,
    invoice_prefix TEXT DEFAULT 'VS',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Units Table
CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, -- e.g. "Nos", "Kg", "Bag"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Taxes Table
CREATE TABLE IF NOT EXISTS taxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, -- e.g. "GST 5%", "GST 12%", "GST 18%"
    rate_percent REAL NOT NULL, -- e.g. 5.0, 12.0, 18.0
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Banks Table
CREATE TABLE IF NOT EXISTS banks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, -- e.g. "State Bank of India"
    ac_no TEXT,
    ifsc TEXT,
    branch TEXT,
    opening_balance REAL DEFAULT 0.0,
    current_balance REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Parties (Customers & Suppliers) Table
CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- "Customer", "Supplier", "Both"
    address TEXT,
    shipping_address TEXT,
    gstin TEXT,
    state TEXT, -- e.g. "Gujarat"
    state_code TEXT, -- e.g. "24"
    contact_person TEXT,
    mobile TEXT,
    email TEXT,
    opening_balance REAL DEFAULT 0.0,
    balance_type TEXT DEFAULT 'Dr', -- "Dr" (Receivable) or "Cr" (Payable)
    current_balance REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products Table
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hsn_sac TEXT,
    unit_id INTEGER,
    purchase_rate REAL DEFAULT 0.0,
    sale_rate REAL DEFAULT 0.0,
    tax_id INTEGER,
    opening_stock REAL DEFAULT 0.0,
    current_stock REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(unit_id) REFERENCES units(id),
    FOREIGN KEY(tax_id) REFERENCES taxes(id)
);

-- Sales Invoices Table
CREATE TABLE IF NOT EXISTS sales_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'Invoice', -- "Invoice" or "Challan"
    invoice_no TEXT NOT NULL,
    company_id INTEGER,
    party_id INTEGER,
    financial_year_id INTEGER,
    date DATE NOT NULL,
    sub_total REAL DEFAULT 0.0,
    tax_total REAL DEFAULT 0.0,
    round_off REAL DEFAULT 0.0,
    grand_total REAL DEFAULT 0.0,
    is_draft INTEGER DEFAULT 0, -- 1 for draft, 0 for final
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(financial_year_id) REFERENCES financial_years(id)
);

-- Sales Invoice Items Table
CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER,
    product_id INTEGER,
    bags INTEGER DEFAULT 0,
    quantity REAL DEFAULT 0.0,
    rate REAL DEFAULT 0.0,
    unit TEXT,
    amount REAL DEFAULT 0.0,
    cgst_percent REAL DEFAULT 0.0,
    cgst_amount REAL DEFAULT 0.0,
    sgst_percent REAL DEFAULT 0.0,
    sgst_amount REAL DEFAULT 0.0,
    igst_percent REAL DEFAULT 0.0,
    igst_amount REAL DEFAULT 0.0,
    total REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
);

-- Sales Payments Table
CREATE TABLE IF NOT EXISTS sales_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id INTEGER,
    invoice_id INTEGER, -- Optional, can be direct or against specific bill
    amount REAL NOT NULL,
    date DATE NOT NULL,
    payment_mode TEXT NOT NULL, -- "Cash", "Bank", "Cheque", "UPI", etc.
    reference_no TEXT,
    bank_id INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
    FOREIGN KEY(bank_id) REFERENCES banks(id)
);

-- Purchase Invoices Table
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL,
    company_id INTEGER,
    party_id INTEGER,
    financial_year_id INTEGER,
    date DATE NOT NULL,
    sub_total REAL DEFAULT 0.0,
    tax_total REAL DEFAULT 0.0,
    round_off REAL DEFAULT 0.0,
    grand_total REAL DEFAULT 0.0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(financial_year_id) REFERENCES financial_years(id)
);

-- Purchase Invoice Items Table
CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_invoice_id INTEGER,
    product_id INTEGER,
    bags INTEGER DEFAULT 0,
    quantity REAL DEFAULT 0.0,
    rate REAL DEFAULT 0.0,
    unit TEXT,
    amount REAL DEFAULT 0.0,
    cgst_percent REAL DEFAULT 0.0,
    cgst_amount REAL DEFAULT 0.0,
    sgst_percent REAL DEFAULT 0.0,
    sgst_amount REAL DEFAULT 0.0,
    igst_percent REAL DEFAULT 0.0,
    igst_amount REAL DEFAULT 0.0,
    total REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(purchase_invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
);

-- Purchase Payments Table
CREATE TABLE IF NOT EXISTS purchase_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id INTEGER,
    purchase_invoice_id INTEGER,
    amount REAL NOT NULL,
    date DATE NOT NULL,
    payment_mode TEXT NOT NULL, -- "Cash", "Bank", "Cheque", "UPI", etc.
    reference_no TEXT,
    bank_id INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(purchase_invoice_id) REFERENCES purchase_invoices(id),
    FOREIGN KEY(bank_id) REFERENCES banks(id)
);

-- Cash Transactions Table (Cash Book Ledger)
CREATE TABLE IF NOT EXISTS cash_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- "Receipt" (+) or "Payment" (-)
    amount REAL NOT NULL,
    date DATE NOT NULL,
    party_id INTEGER,
    invoice_id INTEGER,
    purchase_invoice_id INTEGER,
    payment_id INTEGER,
    purchase_payment_id INTEGER,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
    FOREIGN KEY(purchase_invoice_id) REFERENCES purchase_invoices(id),
    FOREIGN KEY(payment_id) REFERENCES sales_payments(id),
    FOREIGN KEY(purchase_payment_id) REFERENCES purchase_payments(id)
);

-- Bank Transactions Table (Bank Book Ledger)
CREATE TABLE IF NOT EXISTS bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- "Deposit" (+) or "Withdrawal" (-)
    amount REAL NOT NULL,
    date DATE NOT NULL,
    party_id INTEGER,
    invoice_id INTEGER,
    purchase_invoice_id INTEGER,
    payment_id INTEGER,
    purchase_payment_id INTEGER,
    reference_no TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(bank_id) REFERENCES banks(id),
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
    FOREIGN KEY(purchase_invoice_id) REFERENCES purchase_invoices(id),
    FOREIGN KEY(payment_id) REFERENCES sales_payments(id),
    FOREIGN KEY(purchase_payment_id) REFERENCES purchase_payments(id)
);

-- Stock Ledger Table (In/Out Stock movement)
CREATE TABLE IF NOT EXISTS stock_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- "IN" (Purchase, Opening) or "OUT" (Sales)
    qty REAL NOT NULL,
    bags INTEGER DEFAULT 0,
    date DATE NOT NULL,
    reference_table TEXT, -- "products" (for opening stock), "sales_invoice_items", "purchase_invoice_items"
    reference_id INTEGER,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id)
);
