-- VS Plastic ERP Schema for TiDB / MySQL

CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS financial_years (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE,
    is_active TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS companies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    gstin VARCHAR(20),
    phone VARCHAR(30),
    email VARCHAR(100),
    logo_path VARCHAR(255),
    bank_name VARCHAR(100),
    bank_ac_no VARCHAR(50),
    bank_ifsc VARCHAR(30),
    bank_branch VARCHAR(100),
    invoice_prefix VARCHAR(20) DEFAULT 'VS',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS taxes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE,
    rate_percent DOUBLE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    ac_no VARCHAR(50),
    ifsc VARCHAR(30),
    branch VARCHAR(100),
    opening_balance DOUBLE DEFAULT 0,
    current_balance DOUBLE DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parties (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    address TEXT,
    shipping_address TEXT,
    gstin VARCHAR(20),
    state VARCHAR(50),
    state_code VARCHAR(5),
    contact_person VARCHAR(100),
    mobile VARCHAR(30),
    email VARCHAR(100),
    opening_balance DOUBLE DEFAULT 0,
    balance_type VARCHAR(5) DEFAULT 'Dr',
    current_balance DOUBLE DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    hsn_sac VARCHAR(20),
    unit_id INT,
    purchase_rate DOUBLE DEFAULT 0,
    sale_rate DOUBLE DEFAULT 0,
    tax_id INT,
    opening_stock DOUBLE DEFAULT 0,
    current_stock DOUBLE DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(unit_id) REFERENCES units(id),
    FOREIGN KEY(tax_id) REFERENCES taxes(id)
);

CREATE TABLE IF NOT EXISTS sales_invoices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    type VARCHAR(20) DEFAULT 'Invoice',
    invoice_no VARCHAR(50) NOT NULL,
    company_id INT,
    party_id INT,
    financial_year_id INT,
    date DATE NOT NULL,
    sub_total DOUBLE DEFAULT 0,
    tax_total DOUBLE DEFAULT 0,
    round_off DOUBLE DEFAULT 0,
    grand_total DOUBLE DEFAULT 0,
    is_draft TINYINT DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(financial_year_id) REFERENCES financial_years(id)
);

CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    invoice_id INT,
    product_id INT,
    bags INT DEFAULT 0,
    quantity DOUBLE DEFAULT 0,
    rate DOUBLE DEFAULT 0,
    unit VARCHAR(20),
    amount DOUBLE DEFAULT 0,
    cgst_percent DOUBLE DEFAULT 0,
    cgst_amount DOUBLE DEFAULT 0,
    sgst_percent DOUBLE DEFAULT 0,
    sgst_amount DOUBLE DEFAULT 0,
    igst_percent DOUBLE DEFAULT 0,
    igst_amount DOUBLE DEFAULT 0,
    total DOUBLE DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS sales_payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    party_id INT,
    invoice_id INT,
    amount DOUBLE NOT NULL,
    date DATE NOT NULL,
    payment_mode VARCHAR(30) NOT NULL,
    reference_no VARCHAR(50),
    bank_id INT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
    FOREIGN KEY(bank_id) REFERENCES banks(id)
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    invoice_no VARCHAR(50) NOT NULL,
    company_id INT,
    party_id INT,
    financial_year_id INT,
    date DATE NOT NULL,
    sub_total DOUBLE DEFAULT 0,
    tax_total DOUBLE DEFAULT 0,
    round_off DOUBLE DEFAULT 0,
    grand_total DOUBLE DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(financial_year_id) REFERENCES financial_years(id)
);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    purchase_invoice_id INT,
    product_id INT,
    bags INT DEFAULT 0,
    quantity DOUBLE DEFAULT 0,
    rate DOUBLE DEFAULT 0,
    unit VARCHAR(20),
    amount DOUBLE DEFAULT 0,
    cgst_percent DOUBLE DEFAULT 0,
    cgst_amount DOUBLE DEFAULT 0,
    sgst_percent DOUBLE DEFAULT 0,
    sgst_amount DOUBLE DEFAULT 0,
    igst_percent DOUBLE DEFAULT 0,
    igst_amount DOUBLE DEFAULT 0,
    total DOUBLE DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(purchase_invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS purchase_payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    party_id INT,
    purchase_invoice_id INT,
    amount DOUBLE NOT NULL,
    date DATE NOT NULL,
    payment_mode VARCHAR(30) NOT NULL,
    reference_no VARCHAR(50),
    bank_id INT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(party_id) REFERENCES parties(id),
    FOREIGN KEY(purchase_invoice_id) REFERENCES purchase_invoices(id),
    FOREIGN KEY(bank_id) REFERENCES banks(id)
);

CREATE TABLE IF NOT EXISTS cash_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    type VARCHAR(20) NOT NULL,
    amount DOUBLE NOT NULL,
    date DATE NOT NULL,
    party_id INT,
    invoice_id INT,
    purchase_invoice_id INT,
    payment_id INT,
    purchase_payment_id INT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    bank_id INT NOT NULL,
    type VARCHAR(20) NOT NULL,
    amount DOUBLE NOT NULL,
    date DATE NOT NULL,
    party_id INT,
    invoice_id INT,
    purchase_invoice_id INT,
    payment_id INT,
    purchase_payment_id INT,
    reference_no VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(bank_id) REFERENCES banks(id)
);

CREATE TABLE IF NOT EXISTS stock_ledger (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    type VARCHAR(10) NOT NULL,
    qty DOUBLE NOT NULL,
    bags INT DEFAULT 0,
    date DATE NOT NULL,
    reference_table VARCHAR(50),
    reference_id INT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id)
);
