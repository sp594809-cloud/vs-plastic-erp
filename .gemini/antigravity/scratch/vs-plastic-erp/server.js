const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const db = require('./db/connection');
const translate = require('./utils/translate');
const numberToWords = require('./utils/numberToWords');

const app = express();
const PORT = process.env.PORT || 3001;

// Set up templating & static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Session config
app.use(session({
    secret: 'vsplastic_secret_key_12345',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Shared view locals & translation middleware
app.use(async (req, res, next) => {
    // Current language (default 'en')
    const lang = req.session.lang || 'en';
    res.locals.currentLang = lang;
    res.locals.__ = translate(lang);
    
    // User login session info
    res.locals.username = req.session.user ? req.session.user.username : '';
    res.locals.userRole = req.session.user ? req.session.user.role : '';
    
    // Retrieve default active company name & fiscal year info
    try {
        const company = await db.getOne("SELECT name, gstin FROM companies LIMIT 1");
        res.locals.companyName = company ? company.name : 'VS Plastic';
        
        const year = await db.getOne("SELECT name FROM financial_years WHERE is_active = 1 LIMIT 1");
        res.locals.activeYear = year ? year.name : '2026-2027';
    } catch (err) {
        res.locals.companyName = 'VS Plastic';
        res.locals.activeYear = '2026-2027';
    }

    // Default notifications messages
    res.locals.success_msg = req.session.success_msg || null;
    res.locals.error_msg = req.session.error_msg || null;
    delete req.session.success_msg;
    delete req.session.error_msg;
    
    next();
});

// Route-level authentication guard
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};

// State list constant helper
const STATES_LIST = [
    { name: "Andhra Pradesh", code: "37" },
    { name: "Arunachal Pradesh", code: "12" },
    { name: "Assam", code: "18" },
    { name: "Bihar", code: "10" },
    { name: "Chhattisgarh", code: "22" },
    { name: "Goa", code: "30" },
    { name: "Gujarat", code: "24" },
    { name: "Haryana", code: "06" },
    { name: "Himachal Pradesh", code: "02" },
    { name: "Jharkhand", code: "20" },
    { name: "Karnataka", code: "29" },
    { name: "Kerala", code: "32" },
    { name: "Madhya Pradesh", code: "23" },
    { name: "Maharashtra", code: "27" },
    { name: "Manipur", code: "14" },
    { name: "Meghalaya", code: "17" },
    { name: "Mizoram", code: "15" },
    { name: "Nagaland", code: "13" },
    { name: "Odisha", code: "21" },
    { name: "Punjab", code: "03" },
    { name: "Rajasthan", code: "08" },
    { name: "Sikkim", code: "11" },
    { name: "Tamil Nadu", code: "33" },
    { name: "Telangana", code: "36" },
    { name: "Tripura", code: "16" },
    { name: "Uttar Pradesh", code: "09" },
    { name: "Uttarakhand", code: "05" },
    { name: "West Bengal", code: "19" },
    { name: "Andaman & Nicobar Islands", code: "35" },
    { name: "Chandigarh", code: "04" },
    { name: "Dadra & Nagar Haveli", code: "26" },
    { name: "Daman & Diu", code: "25" },
    { name: "Delhi", code: "07" },
    { name: "Jammu & Kashmir", code: "01" },
    { name: "Lakshadweep", code: "31" },
    { name: "Puducherry", code: "34" }
];

// ==========================================
// 1. AUTHENTICATION ROUTES
// ==========================================

app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login', { error_msg: res.locals.error_msg });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db.getOne("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
        if (user) {
            req.session.user = { id: user.id, username: user.username, role: user.role };
            req.session.success_msg = "Successfully logged in!";
            res.redirect('/dashboard');
        } else {
            res.render('login', { error_msg: "Invalid username or password!" });
        }
    } catch (err) {
        res.render('login', { error_msg: "Database connection error." });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

app.get('/lang/:lang', (req, res) => {
    const lang = req.params.lang;
    if (['en', 'gu'].includes(lang)) {
        req.session.lang = lang;
    }
    res.redirect('back');
});

// ==========================================
// 2. DASHBOARD ROUTE
// ==========================================

app.get('/dashboard', requireAuth, async (req, res) => {
    try {
        // Query Stats
        const sales = await db.getOne("SELECT COUNT(*) AS count FROM sales_invoices WHERE type = 'Invoice' AND is_draft = 0");
        const purchases = await db.getOne("SELECT COUNT(*) AS count FROM purchase_invoices");
        const parties = await db.getOne("SELECT COUNT(*) AS count FROM parties");
        const products = await db.getOne("SELECT COUNT(*) AS count FROM products");
        
        // Outstanding Balances
        const rec = await db.getOne("SELECT SUM(current_balance) AS total FROM parties WHERE type IN ('Customer', 'Both') AND current_balance > 0");
        const pay = await db.getOne("SELECT SUM(current_balance) AS total FROM parties WHERE type IN ('Supplier', 'Both') AND current_balance < 0");

        // Recent Invoices lists
        const recentSales = await db.query(
            "SELECT s.*, p.name AS party_name FROM sales_invoices s JOIN parties p ON s.party_id = p.id ORDER BY s.date DESC, s.id DESC LIMIT 5"
        );
        const recentPurchases = await db.query(
            "SELECT s.*, p.name AS party_name FROM purchase_invoices s JOIN parties p ON s.party_id = p.id ORDER BY s.date DESC, s.id DESC LIMIT 5"
        );

        // Chart Data (Sales per month in active fiscal year)
        // Group by month
        const monthlySales = await db.query(
            "SELECT strftime('%m', date) AS month, SUM(grand_total) AS total FROM sales_invoices WHERE is_draft = 0 GROUP BY month"
        );

        // Map values to standard fiscal year (Apr to Mar)
        const fiscalMonths = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"];
        const monthNames = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
        const chartSalesData = fiscalMonths.map(m => {
            const match = monthlySales.find(s => s.month === m);
            return match ? match.total : 0;
        });

        res.render('dashboard', {
            currentRoute: 'dashboard',
            stats: {
                salesCount: sales ? sales.count : 0,
                purchaseCount: purchases ? purchases.count : 0,
                partiesCount: parties ? parties.count : 0,
                productsCount: products ? products.count : 0,
                totalReceivables: rec && rec.total ? rec.total : 0.0,
                totalPayables: pay && pay.total ? Math.abs(pay.total) : 0.0
            },
            recentSales,
            recentPurchases,
            chartData: {
                labels: monthNames,
                sales: chartSalesData
            }
        });
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Error loading dashboard metrics";
        res.redirect('/login');
    }
});

// ==========================================
// 3. MASTER -> PARTY ROUTES
// ==========================================

app.get('/master/party', requireAuth, async (req, res) => {
    try {
        const parties = await db.query("SELECT * FROM parties ORDER BY name ASC");
        res.render('parties/list', { currentRoute: 'master-party', parties });
    } catch (err) {
        req.session.error_msg = "Could not fetch parties list.";
        res.redirect('/dashboard');
    }
});

app.get('/master/party/add', requireAuth, (req, res) => {
    res.render('parties/form', { currentRoute: 'master-party', isEdit: false, statesList: STATES_LIST });
});

app.post('/master/party/add', requireAuth, async (req, res) => {
    const { name, type, address, shipping_address, gstin, state, state_code, contact_person, mobile, email, opening_balance, balance_type } = req.body;
    const opBal = parseFloat(opening_balance) || 0;
    const currentBal = opBal * (balance_type === 'Dr' ? 1 : -1);

    try {
        await db.runQuery(
            `INSERT INTO parties (name, type, address, shipping_address, gstin, state, state_code, contact_person, mobile, email, opening_balance, balance_type, current_balance) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, type, address, shipping_address, gstin, state, state_code, contact_person, mobile, email, opBal, balance_type, currentBal]
        );
        req.session.success_msg = "Party added successfully!";
        res.redirect('/master/party');
    } catch (err) {
        res.render('parties/form', { currentRoute: 'master-party', isEdit: false, statesList: STATES_LIST, error_msg: "Error saving party details." });
    }
});

app.get('/master/party/edit/:id', requireAuth, async (req, res) => {
    try {
        const party = await db.getOne("SELECT * FROM parties WHERE id = ?", [req.params.id]);
        res.render('parties/form', { currentRoute: 'master-party', isEdit: true, party, statesList: STATES_LIST });
    } catch (err) {
        req.session.error_msg = "Party account not found.";
        res.redirect('/master/party');
    }
});

app.post('/master/party/edit/:id', requireAuth, async (req, res) => {
    const { name, type, address, shipping_address, gstin, state, state_code, contact_person, mobile, email, opening_balance, balance_type } = req.body;
    const opBal = parseFloat(opening_balance) || 0;
    
    try {
        // Calculate new current balance by adjusting ledger transactions
        const originalParty = await db.getOne("SELECT current_balance, opening_balance, balance_type FROM parties WHERE id = ?", [req.params.id]);
        const originalOpBal = originalParty.opening_balance * (originalParty.balance_type === 'Dr' ? 1 : -1);
        const difference = (opBal * (balance_type === 'Dr' ? 1 : -1)) - originalOpBal;
        const newCurrentBalance = originalParty.current_balance + difference;

        await db.runQuery(
            `UPDATE parties SET name=?, type=?, address=?, shipping_address=?, gstin=?, state=?, state_code=?, contact_person=?, mobile=?, email=?, opening_balance=?, balance_type=?, current_balance=? WHERE id=?`,
            [name, type, address, shipping_address, gstin, state, state_code, contact_person, mobile, email, opBal, balance_type, newCurrentBalance, req.params.id]
        );
        req.session.success_msg = "Party details updated successfully!";
        res.redirect('/master/party');
    } catch (err) {
        req.session.error_msg = "Error updating party profile.";
        res.redirect('/master/party');
    }
});

app.get('/master/party/delete/:id', requireAuth, async (req, res) => {
    try {
        await db.runQuery("DELETE FROM parties WHERE id = ?", [req.params.id]);
        req.session.success_msg = "Party deleted successfully!";
    } catch (err) {
        req.session.error_msg = "Cannot delete party linked to transactions.";
    }
    res.redirect('/master/party');
});

// ==========================================
// 4. MASTER -> PRODUCT ROUTES
// ==========================================

app.get('/master/products', requireAuth, async (req, res) => {
    try {
        const products = await db.query(
            `SELECT p.*, u.name AS unit_name, t.rate_percent AS tax_rate 
             FROM products p 
             JOIN units u ON p.unit_id = u.id 
             JOIN taxes t ON p.tax_id = t.id 
             ORDER BY p.name ASC`
        );
        res.render('products/list', { currentRoute: 'master-products', products });
    } catch (err) {
        req.session.error_msg = "Error loading products.";
        res.redirect('/dashboard');
    }
});

app.get('/master/products/add', requireAuth, async (req, res) => {
    try {
        const units = await db.query("SELECT * FROM units");
        const taxes = await db.query("SELECT * FROM taxes");
        res.render('products/form', { currentRoute: 'master-products', isEdit: false, units, taxes });
    } catch (err) {
        res.redirect('/master/products');
    }
});

app.post('/master/products/add', requireAuth, async (req, res) => {
    const { name, hsn_sac, unit_id, tax_id, purchase_rate, sale_rate, opening_stock } = req.body;
    const opStock = parseFloat(opening_stock) || 0;

    try {
        const result = await db.runQuery(
            `INSERT INTO products (name, hsn_sac, unit_id, tax_id, purchase_rate, sale_rate, opening_stock, current_stock) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, hsn_sac, unit_id, tax_id, parseFloat(purchase_rate), parseFloat(sale_rate), opStock, opStock]
        );
        
        // Add opening stock ledger entry
        await db.runQuery(
            `INSERT INTO stock_ledger (product_id, type, qty, date, reference_table, reference_id, description) 
             VALUES (?, 'IN', ?, CURRENT_DATE, 'products', ?, 'Opening Stock')`,
            [result.id, opStock, result.id]
        );

        req.session.success_msg = "Product created successfully!";
        res.redirect('/master/products');
    } catch (err) {
        req.session.error_msg = "Error saving product.";
        res.redirect('/master/products');
    }
});

app.get('/master/products/edit/:id', requireAuth, async (req, res) => {
    try {
        const product = await db.getOne("SELECT * FROM products WHERE id = ?", [req.params.id]);
        const units = await db.query("SELECT * FROM units");
        const taxes = await db.query("SELECT * FROM taxes");
        res.render('products/form', { currentRoute: 'master-products', isEdit: true, product, units, taxes });
    } catch (err) {
        res.redirect('/master/products');
    }
});

app.post('/master/products/edit/:id', requireAuth, async (req, res) => {
    const { name, hsn_sac, unit_id, tax_id, purchase_rate, sale_rate } = req.body;
    try {
        await db.runQuery(
            `UPDATE products SET name=?, hsn_sac=?, unit_id=?, tax_id=?, purchase_rate=?, sale_rate=? WHERE id=?`,
            [name, hsn_sac, unit_id, tax_id, parseFloat(purchase_rate), parseFloat(sale_rate), req.params.id]
        );
        req.session.success_msg = "Product updated successfully!";
        res.redirect('/master/products');
    } catch (err) {
        req.session.error_msg = "Error updating product.";
        res.redirect('/master/products');
    }
});

app.get('/master/products/delete/:id', requireAuth, async (req, res) => {
    try {
        await db.runQuery("DELETE FROM products WHERE id = ?", [req.params.id]);
        req.session.success_msg = "Product deleted successfully!";
    } catch (err) {
        req.session.error_msg = "Cannot delete product mapped to invoice items.";
    }
    res.redirect('/master/products');
});

// ==========================================
// 5. SALES & BILLING / CHALLAN ROUTES
// ==========================================

app.get('/sales/bill', requireAuth, async (req, res) => {
    try {
        const invoices = await db.query(
            `SELECT s.*, p.name AS party_name 
             FROM sales_invoices s 
             JOIN parties p ON s.party_id = p.id 
             WHERE s.type = 'Invoice' 
             ORDER BY s.date DESC, s.invoice_no DESC`
        );
        res.render('sales/bills_list', { currentRoute: 'sales-bill', typeFilter: 'Invoice', invoices });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.get('/sales/challan', requireAuth, async (req, res) => {
    try {
        const invoices = await db.query(
            `SELECT s.*, p.name AS party_name 
             FROM sales_invoices s 
             JOIN parties p ON s.party_id = p.id 
             WHERE s.type = 'Challan' 
             ORDER BY s.date DESC, s.invoice_no DESC`
        );
        res.render('sales/bills_list', { currentRoute: 'sales-challan', typeFilter: 'Challan', invoices });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.get('/sales/bill/add', requireAuth, async (req, res) => {
    try {
        const companies = await db.query("SELECT * FROM companies");
        const years = await db.query("SELECT * FROM financial_years");
        const activeCompany = companies[0] || {};
        const parties = await db.query("SELECT * FROM parties WHERE type IN ('Customer', 'Both') ORDER BY name ASC");
        const products = await db.query(
            `SELECT p.*, t.rate_percent AS tax_rate, u.name AS unit_name 
             FROM products p 
             JOIN taxes t ON p.tax_id = t.id
             JOIN units u ON p.unit_id = u.id`
        );
        
        // Generate next invoice number
        const invCount = await db.getOne("SELECT COUNT(*) AS count FROM sales_invoices WHERE type='Invoice'");
        const nextInvoiceNo = `${activeCompany.invoice_prefix || 'VS'}/INV/${(invCount.count + 1).toString().padStart(4, '0')}`;
        
        res.render('sales/bill_form', {
            currentRoute: 'sales-bill',
            isEdit: false,
            companies,
            years,
            activeCompany,
            parties,
            products,
            nextInvoiceNo,
            todayDate: new Date().toISOString().split('T')[0]
        });
    } catch (err) {
        console.error(err);
        res.redirect('/sales/bill');
    }
});

app.post('/sales/bill/add', requireAuth, async (req, res) => {
    const { type, company_id, party_id, financial_year_id, date, sub_total, tax_total, round_off, grand_total, notes, status, items } = req.body;
    const isDraft = status === 'Draft' ? 1 : 0;

    try {
        // 1. Insert Sales Invoice Header
        const header = await db.runQuery(
            `INSERT INTO sales_invoices (type, invoice_no, company_id, party_id, financial_year_id, date, sub_total, tax_total, round_off, grand_total, is_draft, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [type, req.body.invoice_no, company_id, party_id, financial_year_id, date, parseFloat(sub_total), parseFloat(tax_total), parseFloat(round_off), parseFloat(grand_total), isDraft, notes]
        );

        const invoiceId = header.id;

        // 2. Loop and Insert Line Items
        if (items && typeof items === 'object') {
            for (const key in items) {
                const item = items[key];
                if (!item.product_id) continue;

                await db.runQuery(
                    `INSERT INTO sales_invoice_items (invoice_id, product_id, bags, quantity, rate, unit, amount, cgst_percent, cgst_amount, sgst_percent, sgst_amount, igst_percent, igst_amount, total) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        invoiceId, item.product_id, parseInt(item.bags) || 0, parseFloat(item.quantity) || 0, parseFloat(item.rate) || 0, item.unit, parseFloat(item.amount) || 0,
                        parseFloat(item.cgst_percent) || 0, parseFloat(item.cgst_amount) || 0, parseFloat(item.sgst_percent) || 0, parseFloat(item.sgst_amount) || 0,
                        parseFloat(item.igst_percent) || 0, parseFloat(item.igst_amount) || 0, parseFloat(item.total) || 0
                    ]
                );

                // If final sale -> reduce product current stock level & create stock ledger entry
                if (isDraft === 0) {
                    const qty = parseFloat(item.quantity) || 0;
                    await db.runQuery("UPDATE products SET current_stock = current_stock - ? WHERE id = ?", [qty, item.product_id]);
                    await db.runQuery(
                        `INSERT INTO stock_ledger (product_id, type, qty, bags, date, reference_table, reference_id, description) 
                         VALUES (?, 'OUT', ?, ?, ?, 'sales_invoice_items', ?, ?)`,
                        [item.product_id, qty, parseInt(item.bags) || 0, date, invoiceId, `Sales ${type}: ${req.body.invoice_no}`]
                    );
                }
            }
        }

        // 3. Update Party Account Balance if not Draft
        if (isDraft === 0) {
            const billAmt = parseFloat(grand_total) || 0;
            // Sales increase Customer Receivable outstanding balance (+)
            await db.runQuery("UPDATE parties SET current_balance = current_balance + ? WHERE id = ?", [billAmt, party_id]);
        }

        req.session.success_msg = `Sales ${type} created successfully!`;
        if (isDraft === 0) {
            res.redirect(`/sales/bill/print/${invoiceId}`);
        } else {
            res.redirect(type === 'Invoice' ? '/sales/bill' : '/sales/challan');
        }
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Error creating invoice. Please try again.";
        res.redirect('/sales/bill');
    }
});

app.get('/sales/bill/print/:id', requireAuth, async (req, res) => {
    try {
        const invoice = await db.getOne("SELECT * FROM sales_invoices WHERE id = ?", [req.params.id]);
        if (!invoice) return res.redirect('/sales/bill');

        const company = await db.getOne("SELECT * FROM companies WHERE id = ?", [invoice.company_id]);
        const party = await db.getOne("SELECT * FROM parties WHERE id = ?", [invoice.party_id]);
        const items = await db.query(
            `SELECT i.*, p.name AS product_name, p.hsn_sac 
             FROM sales_invoice_items i 
             JOIN products p ON i.product_id = p.id 
             WHERE i.invoice_id = ?`,
            [invoice.id]
        );
        const year = await db.getOne("SELECT name FROM financial_years WHERE id = ?", [invoice.financial_year_id]);

        // CGST / SGST / IGST visual trigger
        const taxMode = (party.state_code === company.gstin.substring(0, 2)) ? 'intra' : 'inter';
        const grandTotalWords = numberToWords(invoice.grand_total);

        res.render('sales/print_invoice', {
            currentRoute: invoice.type === 'Invoice' ? 'sales-bill' : 'sales-challan',
            invoice,
            company,
            party,
            items,
            taxMode,
            financialYear: year ? year.name : '',
            grandTotalWords
        });
    } catch (err) {
        console.error(err);
        res.redirect('/sales/bill');
    }
});

app.get('/sales/bill/edit/:id', requireAuth, async (req, res) => {
    try {
        const invoice = await db.getOne("SELECT * FROM sales_invoices WHERE id = ?", [req.params.id]);
        if (!invoice) return res.redirect('/sales/bill');

        const companies = await db.query("SELECT * FROM companies");
        const years = await db.query("SELECT * FROM financial_years");
        const parties = await db.query("SELECT * FROM parties ORDER BY name ASC");
        const products = await db.query(
            `SELECT p.*, t.rate_percent AS tax_rate, u.name AS unit_name 
             FROM products p 
             JOIN taxes t ON p.tax_id = t.id
             JOIN units u ON p.unit_id = u.id`
        );
        const items = await db.query("SELECT * FROM sales_invoice_items WHERE invoice_id = ?", [invoice.id]);
        const activeCompany = companies.find(c => c.id === invoice.company_id) || companies[0];

        res.render('sales/bill_form', {
            currentRoute: invoice.type === 'Invoice' ? 'sales-bill' : 'sales-challan',
            isEdit: true,
            invoice,
            companies,
            years,
            activeCompany,
            parties,
            products,
            items,
            todayDate: invoice.date
        });
    } catch (err) {
        console.error(err);
        res.redirect('/sales/bill');
    }
});

app.post('/sales/bill/edit/:id', requireAuth, async (req, res) => {
    const invoiceId = req.params.id;
    const { type, company_id, party_id, financial_year_id, date, sub_total, tax_total, round_off, grand_total, notes, status, items } = req.body;
    const isDraft = status === 'Draft' ? 1 : 0;

    try {
        const oldInvoice = await db.getOne("SELECT * FROM sales_invoices WHERE id = ?", [invoiceId]);
        const oldItems = await db.query("SELECT * FROM sales_invoice_items WHERE invoice_id = ?", [invoiceId]);

        // 1. Revert Old Party balances & Stock if the old invoice was Final
        if (oldInvoice.is_draft === 0) {
            await db.runQuery("UPDATE parties SET current_balance = current_balance - ? WHERE id = ?", [oldInvoice.grand_total, oldInvoice.party_id]);
            
            for (const item of oldItems) {
                await db.runQuery("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [item.quantity, item.product_id]);
            }
            await db.runQuery("DELETE FROM stock_ledger WHERE reference_table = 'sales_invoice_items' AND reference_id = ?", [invoiceId]);
        }

        // Delete old items
        await db.runQuery("DELETE FROM sales_invoice_items WHERE invoice_id = ?", [invoiceId]);

        // 2. Update Invoice Header
        await db.runQuery(
            `UPDATE sales_invoices SET type=?, company_id=?, party_id=?, financial_year_id=?, date=?, sub_total=?, tax_total=?, round_off=?, grand_total=?, is_draft=?, notes=? 
             WHERE id=?`,
            [type, company_id, party_id, financial_year_id, date, parseFloat(sub_total), parseFloat(tax_total), parseFloat(round_off), parseFloat(grand_total), isDraft, notes, invoiceId]
        );

        // 3. Insert New Line Items & recalculate Stock
        if (items && typeof items === 'object') {
            for (const key in items) {
                const item = items[key];
                if (!item.product_id) continue;

                await db.runQuery(
                    `INSERT INTO sales_invoice_items (invoice_id, product_id, bags, quantity, rate, unit, amount, cgst_percent, cgst_amount, sgst_percent, sgst_amount, igst_percent, igst_amount, total) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        invoiceId, item.product_id, parseInt(item.bags) || 0, parseFloat(item.quantity) || 0, parseFloat(item.rate) || 0, item.unit, parseFloat(item.amount) || 0,
                        parseFloat(item.cgst_percent) || 0, parseFloat(item.cgst_amount) || 0, parseFloat(item.sgst_percent) || 0, parseFloat(item.sgst_amount) || 0,
                        parseFloat(item.igst_percent) || 0, parseFloat(item.igst_amount) || 0, parseFloat(item.total) || 0
                    ]
                );

                if (isDraft === 0) {
                    const qty = parseFloat(item.quantity) || 0;
                    await db.runQuery("UPDATE products SET current_stock = current_stock - ? WHERE id = ?", [qty, item.product_id]);
                    await db.runQuery(
                        `INSERT INTO stock_ledger (product_id, type, qty, bags, date, reference_table, reference_id, description) 
                         VALUES (?, 'OUT', ?, ?, ?, 'sales_invoice_items', ?, ?)`,
                        [item.product_id, qty, parseInt(item.bags) || 0, date, invoiceId, `Sales ${type}: ${oldInvoice.invoice_no}`]
                    );
                }
            }
        }

        // 4. Update new Party Outstanding Balance if final
        if (isDraft === 0) {
            const billAmt = parseFloat(grand_total) || 0;
            await db.runQuery("UPDATE parties SET current_balance = current_balance + ? WHERE id = ?", [billAmt, party_id]);
        }

        req.session.success_msg = `Sales ${type} updated successfully!`;
        if (isDraft === 0) {
            res.redirect(`/sales/bill/print/${invoiceId}`);
        } else {
            res.redirect(type === 'Invoice' ? '/sales/bill' : '/sales/challan');
        }
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Error updating bill.";
        res.redirect('/sales/bill');
    }
});

app.get('/sales/bill/delete/:id', requireAuth, async (req, res) => {
    try {
        const inv = await db.getOne("SELECT * FROM sales_invoices WHERE id = ?", [req.params.id]);
        const items = await db.query("SELECT * FROM sales_invoice_items WHERE invoice_id = ?", [req.params.id]);

        if (inv.is_draft === 0) {
            // Revert party balance
            await db.runQuery("UPDATE parties SET current_balance = current_balance - ? WHERE id = ?", [inv.grand_total, inv.party_id]);
            // Revert stock levels
            for (const item of items) {
                await db.runQuery("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [item.quantity, item.product_id]);
            }
            // Clear stock logs
            await db.runQuery("DELETE FROM stock_ledger WHERE reference_table = 'sales_invoice_items' AND reference_id = ?", [inv.id]);
        }

        await db.runQuery("DELETE FROM sales_invoices WHERE id = ?", [req.params.id]);
        req.session.success_msg = "Invoice deleted successfully.";
    } catch (err) {
        req.session.error_msg = "Error deleting invoice.";
    }
    res.redirect('/sales/bill');
});

// ==========================================
// 6. SALES PAYMENTS RECEIPTS ROUTES
// ==========================================

app.get('/sales/payment', requireAuth, async (req, res) => {
    try {
        const parties = await db.query("SELECT * FROM parties WHERE type IN ('Customer', 'Both') ORDER BY name ASC");
        const banks = await db.query("SELECT * FROM banks");
        const payments = await db.query(
            `SELECT sp.*, p.name AS party_name, si.invoice_no 
             FROM sales_payments sp 
             JOIN parties p ON sp.party_id = p.id 
             LEFT JOIN sales_invoices si ON sp.invoice_id = si.id 
             ORDER BY sp.date DESC, sp.id DESC`
        );

        res.render('sales/payment', {
            currentRoute: 'sales-payment',
            parties,
            banks,
            payments,
            todayDate: new Date().toISOString().split('T')[0]
        });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.post('/sales/payment/add', requireAuth, async (req, res) => {
    const { party_id, invoice_id, amount, date, payment_mode, reference_no, bank_id, notes } = req.body;
    const amt = parseFloat(amount) || 0;

    try {
        // 1. Save sales payment receipt
        const payResult = await db.runQuery(
            `INSERT INTO sales_payments (party_id, invoice_id, amount, date, payment_mode, reference_no, bank_id, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [party_id, invoice_id || null, amt, date, payment_mode, reference_no || null, bank_id || null, notes]
        );

        // 2. Reduce Customer outstanding balance (credit customer account: - amt)
        await db.runQuery("UPDATE parties SET current_balance = current_balance - ? WHERE id = ?", [amt, party_id]);

        const party = await db.getOne("SELECT name FROM parties WHERE id = ?", [party_id]);

        // 3. Create cash/bank log entries
        if (payment_mode === 'Cash') {
            await db.runQuery(
                `INSERT INTO cash_transactions (type, amount, date, party_id, payment_id, description) 
                 VALUES ('Receipt', ?, ?, ?, ?, ?)`,
                [amt, date, party_id, payResult.id, `Sale Receipt: ${party.name}`]
            );
        } else {
            // Deposit to Bank Account (+)
            await db.runQuery("UPDATE banks SET current_balance = current_balance + ? WHERE id = ?", [amt, bank_id]);
            await db.runQuery(
                `INSERT INTO bank_transactions (bank_id, type, amount, date, party_id, payment_id, reference_no, description) 
                 VALUES (?, 'Deposit', ?, ?, ?, ?, ?, ?)`,
                [bank_id, amt, date, party_id, payResult.id, reference_no, `Sale Receipt deposit: ${party.name}`]
            );
        }

        req.session.success_msg = "Payment Receipt saved successfully!";
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Error recording payment.";
    }
    res.redirect('/sales/payment');
});

app.get('/sales/payment/delete/:id', requireAuth, async (req, res) => {
    try {
        const pay = await db.getOne("SELECT * FROM sales_payments WHERE id = ?", [req.params.id]);
        if (!pay) return res.redirect('/sales/payment');

        // 1. Revert Party current outstanding (debit party: + amount)
        await db.runQuery("UPDATE parties SET current_balance = current_balance + ? WHERE id = ?", [pay.amount, pay.party_id]);

        // 2. Revert cash/bank logs
        if (pay.payment_mode === 'Cash') {
            await db.runQuery("DELETE FROM cash_transactions WHERE payment_id = ?", [pay.id]);
        } else {
            await db.runQuery("UPDATE banks SET current_balance = current_balance - ? WHERE id = ?", [pay.amount, pay.bank_id]);
            await db.runQuery("DELETE FROM bank_transactions WHERE payment_id = ?", [pay.id]);
        }

        await db.runQuery("DELETE FROM sales_payments WHERE id = ?", [pay.id]);
        req.session.success_msg = "Payment Receipt deleted successfully.";
    } catch (err) {
        req.session.error_msg = "Error deleting payment receipt.";
    }
    res.redirect('/sales/payment');
});

// ==========================================
// 7. PURCHASE MODULE ROUTES
// ==========================================

app.get('/purchase/bill', requireAuth, async (req, res) => {
    try {
        const invoices = await db.query(
            `SELECT p.*, pt.name AS party_name 
             FROM purchase_invoices p 
             JOIN parties pt ON p.party_id = pt.id 
             ORDER BY p.date DESC, p.id DESC`
        );
        res.render('purchases/bills_list', { currentRoute: 'purchase-bill', invoices });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.get('/purchase/bill/add', requireAuth, async (req, res) => {
    try {
        const companies = await db.query("SELECT * FROM companies");
        const years = await db.query("SELECT * FROM financial_years");
        const activeCompany = companies[0] || {};
        const parties = await db.query("SELECT * FROM parties WHERE type IN ('Supplier', 'Both') ORDER BY name ASC");
        const products = await db.query(
            `SELECT p.*, t.rate_percent AS tax_rate, u.name AS unit_name 
             FROM products p 
             JOIN taxes t ON p.tax_id = t.id
             JOIN units u ON p.unit_id = u.id`
        );

        res.render('purchases/bill_form', {
            currentRoute: 'purchase-bill',
            isEdit: false,
            companies,
            years,
            activeCompany,
            parties,
            products,
            todayDate: new Date().toISOString().split('T')[0]
        });
    } catch (err) {
        res.redirect('/purchase/bill');
    }
});

app.post('/purchase/bill/add', requireAuth, async (req, res) => {
    const { company_id, party_id, financial_year_id, invoice_no, date, sub_total, tax_total, round_off, grand_total, notes, items } = req.body;
    const billAmt = parseFloat(grand_total) || 0;

    try {
        // 1. Insert header
        const header = await db.runQuery(
            `INSERT INTO purchase_invoices (invoice_no, company_id, party_id, financial_year_id, date, sub_total, tax_total, round_off, grand_total, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [invoice_no, company_id, party_id, financial_year_id, date, parseFloat(sub_total), parseFloat(tax_total), parseFloat(round_off), billAmt, notes]
        );

        const billId = header.id;

        // 2. Insert items and increase stock IN (+)
        if (items && typeof items === 'object') {
            for (const key in items) {
                const item = items[key];
                if (!item.product_id) continue;

                await db.runQuery(
                    `INSERT INTO purchase_invoice_items (purchase_invoice_id, product_id, bags, quantity, rate, unit, amount, cgst_percent, cgst_amount, sgst_percent, sgst_amount, igst_percent, igst_amount, total) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        billId, item.product_id, parseInt(item.bags) || 0, parseFloat(item.quantity) || 0, parseFloat(item.rate) || 0, item.unit, parseFloat(item.amount) || 0,
                        parseFloat(item.cgst_percent) || 0, parseFloat(item.cgst_amount) || 0, parseFloat(item.sgst_percent) || 0, parseFloat(item.sgst_amount) || 0,
                        parseFloat(item.igst_percent) || 0, parseFloat(item.igst_amount) || 0, parseFloat(item.total) || 0
                    ]
                );

                const qty = parseFloat(item.quantity) || 0;
                await db.runQuery("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [qty, item.product_id]);
                await db.runQuery(
                    `INSERT INTO stock_ledger (product_id, type, qty, bags, date, reference_table, reference_id, description) 
                     VALUES (?, 'IN', ?, ?, ?, 'purchase_invoice_items', ?, ?)`,
                    [item.product_id, qty, parseInt(item.bags) || 0, date, billId, `Purchase Bill: ${invoice_no}`]
                );
            }
        }

        // 3. Update Supplier balance (Purchases increase supplier outstanding credits: - amt)
        await db.runQuery("UPDATE parties SET current_balance = current_balance - ? WHERE id = ?", [billAmt, party_id]);

        req.session.success_msg = "Purchase Bill saved successfully!";
        res.redirect('/purchase/bill');
    } catch (err) {
        console.error(err);
        res.redirect('/purchase/bill');
    }
});

app.get('/purchase/bill/edit/:id', requireAuth, async (req, res) => {
    try {
        const invoice = await db.getOne("SELECT * FROM purchase_invoices WHERE id = ?", [req.params.id]);
        if (!invoice) return res.redirect('/purchase/bill');

        const companies = await db.query("SELECT * FROM companies");
        const years = await db.query("SELECT * FROM financial_years");
        const parties = await db.query("SELECT * FROM parties WHERE type IN ('Supplier', 'Both') ORDER BY name ASC");
        const products = await db.query(
            `SELECT p.*, t.rate_percent AS tax_rate, u.name AS unit_name 
             FROM products p 
             JOIN taxes t ON p.tax_id = t.id
             JOIN units u ON p.unit_id = u.id`
        );
        const items = await db.query("SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?", [invoice.id]);
        const activeCompany = companies.find(c => c.id === invoice.company_id) || companies[0];

        res.render('purchases/bill_form', {
            currentRoute: 'purchase-bill',
            isEdit: true,
            invoice,
            companies,
            years,
            activeCompany,
            parties,
            products,
            items,
            todayDate: invoice.date
        });
    } catch (err) {
        console.error(err);
        res.redirect('/purchase/bill');
    }
});

app.post('/purchase/bill/edit/:id', requireAuth, async (req, res) => {
    const billId = req.params.id;
    const { company_id, party_id, financial_year_id, invoice_no, date, sub_total, tax_total, round_off, grand_total, notes, items } = req.body;
    const newBillAmt = parseFloat(grand_total) || 0;

    try {
        const oldBill = await db.getOne("SELECT * FROM purchase_invoices WHERE id = ?", [billId]);
        const oldItems = await db.query("SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?", [billId]);

        // Revert Supplier Balance & Stock IN
        await db.runQuery("UPDATE parties SET current_balance = current_balance + ? WHERE id = ?", [oldBill.grand_total, oldBill.party_id]);
        for (const item of oldItems) {
            await db.runQuery("UPDATE products SET current_stock = current_stock - ? WHERE id = ?", [item.quantity, item.product_id]);
        }
        await db.runQuery("DELETE FROM stock_ledger WHERE reference_table = 'purchase_invoice_items' AND reference_id = ?", [billId]);

        // Delete old items
        await db.runQuery("DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = ?", [billId]);

        // Update purchase header
        await db.runQuery(
            `UPDATE purchase_invoices SET company_id=?, party_id=?, financial_year_id=?, invoice_no=?, date=?, sub_total=?, tax_total=?, round_off=?, grand_total=?, notes=? 
             WHERE id=?`,
            [company_id, party_id, financial_year_id, invoice_no, date, parseFloat(sub_total), parseFloat(tax_total), parseFloat(round_off), newBillAmt, notes, billId]
        );

        // Insert new items
        if (items && typeof items === 'object') {
            for (const key in items) {
                const item = items[key];
                if (!item.product_id) continue;

                await db.runQuery(
                    `INSERT INTO purchase_invoice_items (purchase_invoice_id, product_id, bags, quantity, rate, unit, amount, cgst_percent, cgst_amount, sgst_percent, sgst_amount, igst_percent, igst_amount, total) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        billId, item.product_id, parseInt(item.bags) || 0, parseFloat(item.quantity) || 0, parseFloat(item.rate) || 0, item.unit, parseFloat(item.amount) || 0,
                        parseFloat(item.cgst_percent) || 0, parseFloat(item.cgst_amount) || 0, parseFloat(item.sgst_percent) || 0, parseFloat(item.sgst_amount) || 0,
                        parseFloat(item.igst_percent) || 0, parseFloat(item.igst_amount) || 0, parseFloat(item.total) || 0
                    ]
                );

                const qty = parseFloat(item.quantity) || 0;
                await db.runQuery("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [qty, item.product_id]);
                await db.runQuery(
                    `INSERT INTO stock_ledger (product_id, type, qty, bags, date, reference_table, reference_id, description) 
                     VALUES (?, 'IN', ?, ?, ?, 'purchase_invoice_items', ?, ?)`,
                    [item.product_id, qty, parseInt(item.bags) || 0, date, billId, `Purchase Bill: ${invoice_no}`]
                );
            }
        }

        // Update supplier balance
        await db.runQuery("UPDATE parties SET current_balance = current_balance - ? WHERE id = ?", [newBillAmt, party_id]);

        req.session.success_msg = "Purchase Bill updated successfully.";
        res.redirect('/purchase/bill');
    } catch (err) {
        console.error(err);
        res.redirect('/purchase/bill');
    }
});

app.get('/purchase/bill/delete/:id', requireAuth, async (req, res) => {
    try {
        const bill = await db.getOne("SELECT * FROM purchase_invoices WHERE id = ?", [req.params.id]);
        const items = await db.query("SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?", [req.params.id]);

        // Revert Supplier balance (debit supplier outstanding: + grand_total)
        await db.runQuery("UPDATE parties SET current_balance = current_balance + ? WHERE id = ?", [bill.grand_total, bill.party_id]);
        
        // Revert stock level IN (-)
        for (const item of items) {
            await db.runQuery("UPDATE products SET current_stock = current_stock - ? WHERE id = ?", [item.quantity, item.product_id]);
        }

        await db.runQuery("DELETE FROM stock_ledger WHERE reference_table = 'purchase_invoice_items' AND reference_id = ?", [bill.id]);
        await db.runQuery("DELETE FROM purchase_invoices WHERE id = ?", [req.params.id]);

        req.session.success_msg = "Purchase invoice deleted.";
    } catch (err) {
        req.session.error_msg = "Error deleting purchase invoice.";
    }
    res.redirect('/purchase/bill');
});

// ==========================================
// Purchase Outflow Payments Routes
// ==========================================

app.get('/purchase/payment', requireAuth, async (req, res) => {
    try {
        const parties = await db.query("SELECT * FROM parties WHERE type IN ('Supplier', 'Both') ORDER BY name ASC");
        const banks = await db.query("SELECT * FROM banks");
        const payments = await db.query(
            `SELECT pp.*, p.name AS party_name, pi.invoice_no 
             FROM purchase_payments pp 
             JOIN parties p ON pp.party_id = p.id 
             LEFT JOIN purchase_invoices pi ON pp.purchase_invoice_id = pi.id 
             ORDER BY pp.date DESC, pp.id DESC`
        );

        res.render('purchases/payment', {
            currentRoute: 'purchase-payment',
            parties,
            banks,
            payments,
            todayDate: new Date().toISOString().split('T')[0]
        });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.post('/purchase/payment/add', requireAuth, async (req, res) => {
    const { party_id, purchase_invoice_id, amount, date, payment_mode, reference_no, bank_id, notes } = req.body;
    const amt = parseFloat(amount) || 0;

    try {
        // 1. Record payment outflow
        const payResult = await db.runQuery(
            `INSERT INTO purchase_payments (party_id, purchase_invoice_id, amount, date, payment_mode, reference_no, bank_id, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [party_id, purchase_invoice_id || null, amt, date, payment_mode, reference_no || null, bank_id || null, notes]
        );

        // 2. Reduce supplier balance (debit supplier account: + amt)
        await db.runQuery("UPDATE parties SET current_balance = current_balance + ? WHERE id = ?", [amt, party_id]);

        const party = await db.getOne("SELECT name FROM parties WHERE id = ?", [party_id]);

        // 3. Create cash/bank log
        if (payment_mode === 'Cash') {
            await db.runQuery(
                `INSERT INTO cash_transactions (type, amount, date, party_id, purchase_payment_id, description) 
                 VALUES ('Payment', ?, ?, ?, ?, ?)`,
                [amt, date, party_id, payResult.id, `Supplier Payment: ${party.name}`]
            );
        } else {
            // Withdraw from Bank Account (-)
            await db.runQuery("UPDATE banks SET current_balance = current_balance - ? WHERE id = ?", [amt, bank_id]);
            await db.runQuery(
                `INSERT INTO bank_transactions (bank_id, type, amount, date, party_id, purchase_payment_id, reference_no, description) 
                 VALUES (?, 'Withdrawal', ?, ?, ?, ?, ?, ?)`,
                [bank_id, amt, date, party_id, payResult.id, reference_no, `Supplier Payment: ${party.name}`]
            );
        }

        req.session.success_msg = "Purchase Payment recorded successfully!";
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Error recording payment.";
    }
    res.redirect('/purchase/payment');
});

app.get('/purchase/payment/delete/:id', requireAuth, async (req, res) => {
    try {
        const pay = await db.getOne("SELECT * FROM purchase_payments WHERE id = ?", [req.params.id]);
        if (!pay) return res.redirect('/purchase/payment');

        // 1. Revert Supplier balance (credit supplier: - amount)
        await db.runQuery("UPDATE parties SET current_balance = current_balance - ? WHERE id = ?", [pay.amount, pay.party_id]);

        // 2. Revert cash/bank logs
        if (pay.payment_mode === 'Cash') {
            await db.runQuery("DELETE FROM cash_transactions WHERE purchase_payment_id = ?", [pay.id]);
        } else {
            await db.runQuery("UPDATE banks SET current_balance = current_balance + ? WHERE id = ?", [pay.amount, pay.bank_id]);
            await db.runQuery("DELETE FROM bank_transactions WHERE purchase_payment_id = ?", [pay.id]);
        }

        await db.runQuery("DELETE FROM purchase_payments WHERE id = ?", [pay.id]);
        req.session.success_msg = "Purchase Payment deleted.";
    } catch (err) {
        req.session.error_msg = "Error deleting payment.";
    }
    res.redirect('/purchase/payment');
});

// ==========================================
// 8. TRANSACTIONS RECORDS ROUTES
// ==========================================

app.get('/transactions/cash', requireAuth, async (req, res) => {
    try {
        const transactions = await db.query(
            `SELECT ct.*, p.name AS party_name 
             FROM cash_transactions ct 
             LEFT JOIN parties p ON ct.party_id = p.id 
             ORDER BY ct.date ASC, ct.id ASC`
        );
        
        // Sum totals
        const receipts = await db.getOne("SELECT SUM(amount) AS total FROM cash_transactions WHERE type='Receipt'");
        const payments = await db.getOne("SELECT SUM(amount) AS total FROM cash_transactions WHERE type='Payment'");
        const totalReceipts = receipts && receipts.total ? receipts.total : 0.0;
        const totalPayments = payments && payments.total ? payments.total : 0.0;

        res.render('transactions/cash', {
            currentRoute: 'cash-records',
            transactions,
            stats: {
                totalReceipts,
                totalPayments,
                netCash: totalReceipts - totalPayments
            }
        });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.get('/transactions/bank', requireAuth, async (req, res) => {
    try {
        const banks = await db.query("SELECT * FROM banks");
        if (banks.length === 0) return res.redirect('/settings/bank');

        const activeBankId = req.query.bank_id || banks[0].id;
        const activeBank = banks.find(b => b.id == activeBankId) || banks[0];

        const transactions = await db.query(
            `SELECT bt.*, p.name AS party_name 
             FROM bank_transactions bt 
             LEFT JOIN parties p ON bt.party_id = p.id 
             WHERE bt.bank_id = ? 
             ORDER BY bt.date ASC, bt.id ASC`,
            [activeBank.id]
        );

        res.render('transactions/bank', {
            currentRoute: 'bank-records',
            banks,
            activeBank,
            transactions
        });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

// ==========================================
// 9. STOCK LEDGER ROUTE
// ==========================================

app.get('/stock', requireAuth, async (req, res) => {
    try {
        // Query product details aggregated with stock_ledger IN/OUT entries
        const stockItems = await db.query(
            `SELECT p.*, u.name AS unit_name,
               (SELECT SUM(qty) FROM stock_ledger WHERE product_id = p.id AND type='IN') AS in_qty,
               (SELECT SUM(qty) FROM stock_ledger WHERE product_id = p.id AND type='OUT') AS out_qty
             FROM products p
             JOIN units u ON p.unit_id = u.id
             ORDER BY p.name ASC`
        );
        res.render('stock/list', { currentRoute: 'stock', stockItems });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

// ==========================================
// 10. REPORTS VIEWS ROUTES
// ==========================================

app.get('/reports', requireAuth, (req, res) => {
    res.render('reports/index', { currentRoute: 'reports' });
});

// Sales Register Report
app.get('/reports/sales-register', requireAuth, async (req, res) => {
    const { start_date, end_date, party_id } = req.query;
    
    // Set default dates if empty (start of active year to now)
    const startDate = start_date || '2026-04-01';
    const endDate = end_date || new Date().toISOString().split('T')[0];

    try {
        const parties = await db.query("SELECT id, name FROM parties ORDER BY name ASC");
        
        let query = `
            SELECT s.*, p.name AS party_name, c.name AS company_name 
            FROM sales_invoices s 
            JOIN parties p ON s.party_id = p.id 
            JOIN companies c ON s.company_id = c.id
            WHERE s.date >= ? AND s.date <= ? AND s.is_draft = 0
        `;
        const params = [startDate, endDate];
        if (party_id) {
            query += " AND s.party_id = ?";
            params.push(party_id);
        }
        query += " ORDER BY s.date DESC";

        const invoices = await db.query(query, params);

        res.render('reports/sales_purchase', {
            currentRoute: 'reports',
            reportType: 'sales',
            parties,
            invoices,
            filters: { start_date: startDate, end_date: endDate, party_id }
        });
    } catch (err) {
        res.redirect('/reports');
    }
});

// Purchase Register Report
app.get('/reports/purchase-register', requireAuth, async (req, res) => {
    const { start_date, end_date, party_id } = req.query;
    const startDate = start_date || '2026-04-01';
    const endDate = end_date || new Date().toISOString().split('T')[0];

    try {
        const parties = await db.query("SELECT id, name FROM parties ORDER BY name ASC");
        
        let query = `
            SELECT p.*, pt.name AS party_name, c.name AS company_name 
            FROM purchase_invoices p 
            JOIN parties pt ON p.party_id = pt.id 
            JOIN companies c ON p.company_id = c.id
            WHERE p.date >= ? AND p.date <= ?
        `;
        const params = [startDate, endDate];
        if (party_id) {
            query += " AND p.party_id = ?";
            params.push(party_id);
        }
        query += " ORDER BY p.date DESC";

        const invoices = await db.query(query, params);

        res.render('reports/sales_purchase', {
            currentRoute: 'reports',
            reportType: 'purchase',
            parties,
            invoices,
            filters: { start_date: startDate, end_date: endDate, party_id }
        });
    } catch (err) {
        res.redirect('/reports');
    }
});

// Party Ledger Report
app.get('/reports/party-ledger', requireAuth, async (req, res) => {
    const { party_id, start_date, end_date } = req.query;
    const startDate = start_date || '2026-04-01';
    const endDate = end_date || new Date().toISOString().split('T')[0];

    try {
        const parties = await db.query("SELECT id, name, type FROM parties ORDER BY name ASC");
        let activeParty = null;
        let openingBalance = 0;
        let transactions = [];

        if (party_id) {
            activeParty = await db.getOne("SELECT * FROM parties WHERE id = ?", [party_id]);
            
            // Calculate transactions prior to start date for Opening Balance
            // Opening balance in table + prior debits - prior credits
            const salesPrior = await db.getOne("SELECT SUM(grand_total) AS total FROM sales_invoices WHERE party_id = ? AND date < ? AND is_draft = 0", [party_id, startDate]);
            const receiptsPrior = await db.getOne("SELECT SUM(amount) AS total FROM sales_payments WHERE party_id = ? AND date < ?", [party_id, startDate]);
            const purchasesPrior = await db.getOne("SELECT SUM(grand_total) AS total FROM purchase_invoices WHERE party_id = ? AND date < ?", [party_id, startDate]);
            const paymentsPrior = await db.getOne("SELECT SUM(amount) AS total FROM purchase_payments WHERE party_id = ? AND date < ?", [party_id, startDate]);

            const sPrior = salesPrior && salesPrior.total ? salesPrior.total : 0.0;
            const rPrior = receiptsPrior && receiptsPrior.total ? receiptsPrior.total : 0.0;
            const pPrior = purchasesPrior && purchasesPrior.total ? purchasesPrior.total : 0.0;
            const payPrior = paymentsPrior && paymentsPrior.total ? paymentsPrior.total : 0.0;

            const initialBal = activeParty.opening_balance * (activeParty.balance_type === 'Dr' ? 1 : -1);
            
            // Net balance prior to start date
            openingBalance = initialBal + (sPrior - rPrior) - (pPrior - payPrior);

            // Fetch transactions in date range
            // Unified query
            const salesTrans = await db.query(
                `SELECT date, 'Sales Invoice' AS voucher_type, invoice_no AS ref_no, 'Goods sold' AS description, grand_total AS debit, 0.0 AS credit 
                 FROM sales_invoices 
                 WHERE party_id = ? AND date >= ? AND date <= ? AND is_draft = 0`,
                [party_id, startDate, endDate]
            );

            const receiptsTrans = await db.query(
                `SELECT date, 'Receipt Voucher' AS voucher_type, reference_no AS ref_no, 'Payment received' AS description, 0.0 AS debit, amount AS credit 
                 FROM sales_payments 
                 WHERE party_id = ? AND date >= ? AND date <= ?`,
                [party_id, startDate, endDate]
            );

            const purchaseTrans = await db.query(
                `SELECT date, 'Purchase Bill' AS voucher_type, invoice_no AS ref_no, 'Goods purchased' AS description, 0.0 AS debit, grand_total AS credit 
                 FROM purchase_invoices 
                 WHERE party_id = ? AND date >= ? AND date <= ?`,
                [party_id, startDate, endDate]
            );

            const paymentsTrans = await db.query(
                `SELECT date, 'Payment Voucher' AS voucher_type, reference_no AS ref_no, 'Payment sent to supplier' AS description, amount AS debit, 0.0 AS credit 
                 FROM purchase_payments 
                 WHERE party_id = ? AND date >= ? AND date <= ?`,
                [party_id, startDate, endDate]
            );

            // Merge and sort by date chronological
            transactions = [...salesTrans, ...receiptsTrans, ...purchaseTrans, ...paymentsTrans];
            transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        }

        res.render('reports/party_ledger', {
            currentRoute: 'reports',
            parties,
            activeParty,
            openingBalance,
            transactions,
            filters: { party_id, start_date: startDate, end_date: endDate }
        });
    } catch (err) {
        console.error(err);
        res.redirect('/reports');
    }
});

// GST Summary Report
app.get('/reports/gst-summary', requireAuth, async (req, res) => {
    const { start_date, end_date } = req.query;
    const startDate = start_date || '2026-04-01';
    const endDate = end_date || new Date().toISOString().split('T')[0];

    try {
        // Query Outward (Sales GSTR-1 details)
        const outwardItems = await db.query(
            `SELECT s.invoice_no, s.date, s.grand_total, s.sub_total AS taxable_value, s.tax_total, p.name AS party_name, p.gstin AS party_gstin,
                    (SELECT SUM(cgst_amount) FROM sales_invoice_items WHERE invoice_id = s.id) AS cgst_amount,
                    (SELECT SUM(sgst_amount) FROM sales_invoice_items WHERE invoice_id = s.id) AS sgst_amount,
                    (SELECT SUM(igst_amount) FROM sales_invoice_items WHERE invoice_id = s.id) AS igst_amount
             FROM sales_invoices s
             JOIN parties p ON s.party_id = p.id
             WHERE s.date >= ? AND s.date <= ? AND s.is_draft = 0`,
            [startDate, endDate]
        );

        // Query Inward (Purchase GSTR-2 details)
        const inwardItems = await db.query(
            `SELECT s.invoice_no, s.date, s.grand_total, s.sub_total AS taxable_value, s.tax_total, p.name AS party_name, p.gstin AS party_gstin,
                    (SELECT SUM(cgst_amount) FROM purchase_invoice_items WHERE purchase_invoice_id = s.id) AS cgst_amount,
                    (SELECT SUM(sgst_amount) FROM purchase_invoice_items WHERE purchase_invoice_id = s.id) AS sgst_amount,
                    (SELECT SUM(igst_amount) FROM purchase_invoice_items WHERE purchase_invoice_id = s.id) AS igst_amount
             FROM purchase_invoices s
             JOIN parties p ON s.party_id = p.id
             WHERE s.date >= ? AND s.date <= ?`,
            [startDate, endDate]
        );

        // Aggregate outward totals
        let outwardTotals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 };
        outwardItems.forEach(it => {
            outwardTotals.taxable += it.taxable_value;
            outwardTotals.cgst += it.cgst_amount || 0;
            outwardTotals.sgst += it.sgst_amount || 0;
            outwardTotals.igst += it.igst_amount || 0;
        });
        outwardTotals.gst = outwardTotals.cgst + outwardTotals.sgst + outwardTotals.igst;

        // Aggregate inward totals
        let inwardTotals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 };
        inwardItems.forEach(it => {
            inwardTotals.taxable += it.taxable_value;
            inwardTotals.cgst += it.cgst_amount || 0;
            inwardTotals.sgst += it.sgst_amount || 0;
            inwardTotals.igst += it.igst_amount || 0;
        });
        inwardTotals.gst = inwardTotals.cgst + inwardTotals.sgst + inwardTotals.igst;

        res.render('reports/gst_summary', {
            currentRoute: 'reports',
            outwardItems,
            inwardItems,
            outwardTotals,
            inwardTotals,
            filters: { start_date: startDate, end_date: endDate }
        });
    } catch (err) {
        console.error(err);
        res.redirect('/reports');
    }
});

// Outstanding Balance Report
app.get('/reports/outstanding', requireAuth, async (req, res) => {
    try {
        const parties = await db.query("SELECT * FROM parties WHERE current_balance != 0 ORDER BY name ASC");
        
        // Sum total Dr (Receivable) and total Cr (Payable)
        const rec = await db.getOne("SELECT SUM(current_balance) AS total FROM parties WHERE current_balance > 0");
        const pay = await db.getOne("SELECT SUM(current_balance) AS total FROM parties WHERE current_balance < 0");

        res.render('reports/outstanding', {
            currentRoute: 'reports',
            parties,
            totalReceivables: rec && rec.total ? rec.total : 0.0,
            totalPayables: pay && pay.total ? Math.abs(pay.total) : 0.0
        });
    } catch (err) {
        res.redirect('/reports');
    }
});

// ==========================================
// 11. SETTINGS CRUD ROUTES
// ==========================================

// Years Configuration
app.get('/settings/year', requireAuth, async (req, res) => {
    try {
        const years = await db.query("SELECT * FROM financial_years ORDER BY name DESC");
        res.render('settings/year', { currentRoute: 'settings-year', years });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.post('/settings/year/add', requireAuth, async (req, res) => {
    const { name } = req.body;
    try {
        await db.runQuery("INSERT INTO financial_years (name) VALUES (?)", [name]);
        req.session.success_msg = "Financial Year registered successfully!";
    } catch (err) {
        req.session.error_msg = "Year already exists or format is invalid.";
    }
    res.redirect('/settings/year');
});

app.get('/settings/year/activate/:id', requireAuth, async (req, res) => {
    try {
        // Set all inactive first, then active specific
        await db.runQuery("UPDATE financial_years SET is_active = 0");
        await db.runQuery("UPDATE financial_years SET is_active = 1 WHERE id = ?", [req.params.id]);
        req.session.success_msg = "Financial Year activated!";
    } catch (err) {
        req.session.error_msg = "Could not activate year.";
    }
    res.redirect('/settings/year');
});

app.get('/settings/year/delete/:id', requireAuth, async (req, res) => {
    try {
        await db.runQuery("DELETE FROM financial_years WHERE id = ? AND is_active = 0", [req.params.id]);
        req.session.success_msg = "Year deleted.";
    } catch (err) {
        req.session.error_msg = "Active year cannot be deleted.";
    }
    res.redirect('/settings/year');
});

// Units Configuration
app.get('/settings/unit', requireAuth, async (req, res) => {
    try {
        const units = await db.query("SELECT * FROM units ORDER BY name ASC");
        res.render('settings/unit', { currentRoute: 'settings-unit', units });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.post('/settings/unit/add', requireAuth, async (req, res) => {
    try {
        await db.runQuery("INSERT INTO units (name) VALUES (?)", [req.body.name]);
        req.session.success_msg = "Measurement Unit added.";
    } catch (err) {
        req.session.error_msg = "Unit already exists.";
    }
    res.redirect('/settings/unit');
});

app.get('/settings/unit/delete/:id', requireAuth, async (req, res) => {
    try {
        await db.runQuery("DELETE FROM units WHERE id = ?", [req.params.id]);
        req.session.success_msg = "Unit deleted.";
    } catch (err) {
        req.session.error_msg = "Cannot delete unit linked to product items.";
    }
    res.redirect('/settings/unit');
});

// Company Settings Configuration
app.get('/settings/company', requireAuth, async (req, res) => {
    try {
        const company = await db.getOne("SELECT * FROM companies LIMIT 1");
        res.render('settings/company', { currentRoute: 'settings-company', company });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.post('/settings/company/save', requireAuth, async (req, res) => {
    const { id, name, address, gstin, phone, email, bank_name, bank_ac_no, bank_ifsc, bank_branch, invoice_prefix } = req.body;
    try {
        await db.runQuery(
            `UPDATE companies SET name=?, address=?, gstin=?, phone=?, email=?, bank_name=?, bank_ac_no=?, bank_ifsc=?, bank_branch=?, invoice_prefix=? 
             WHERE id = ?`,
            [name, address, gstin, phone, email, bank_name, bank_ac_no, bank_ifsc, bank_branch, invoice_prefix, id]
        );
        req.session.success_msg = "Company profile details updated successfully!";
    } catch (err) {
        req.session.error_msg = "Error saving company profile.";
    }
    res.redirect('/settings/company');
});

// Taxes Configuration
app.get('/settings/tax', requireAuth, async (req, res) => {
    try {
        const taxes = await db.query("SELECT * FROM taxes ORDER BY rate_percent ASC");
        res.render('settings/tax', { currentRoute: 'settings-tax', taxes });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.post('/settings/tax/add', requireAuth, async (req, res) => {
    const { name, rate_percent } = req.body;
    try {
        await db.runQuery("INSERT INTO taxes (name, rate_percent) VALUES (?, ?)", [name, parseFloat(rate_percent)]);
        req.session.success_msg = "Tax slab created.";
    } catch (err) {
        req.session.error_msg = "Tax slab already exists.";
    }
    res.redirect('/settings/tax');
});

app.get('/settings/tax/delete/:id', requireAuth, async (req, res) => {
    try {
        await db.runQuery("DELETE FROM taxes WHERE id = ?", [req.params.id]);
        req.session.success_msg = "Tax slab deleted.";
    } catch (err) {
        req.session.error_msg = "Cannot delete slab linked to product master.";
    }
    res.redirect('/settings/tax');
});

// Banks accounts Configuration
app.get('/settings/bank', requireAuth, async (req, res) => {
    try {
        const banks = await db.query("SELECT * FROM banks ORDER BY name ASC");
        res.render('settings/bank', { currentRoute: 'settings-bank', banks });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

app.post('/settings/bank/add', requireAuth, async (req, res) => {
    const { name, ac_no, ifsc, branch, opening_balance } = req.body;
    const opBal = parseFloat(opening_balance) || 0;
    try {
        await db.runQuery(
            "INSERT INTO banks (name, ac_no, ifsc, branch, opening_balance, current_balance) VALUES (?, ?, ?, ?, ?, ?)",
            [name, ac_no, ifsc, branch, opBal, opBal]
        );
        req.session.success_msg = "Bank account registered successfully!";
    } catch (err) {
        req.session.error_msg = "Error registering bank account.";
    }
    res.redirect('/settings/bank');
});

app.get('/settings/bank/delete/:id', requireAuth, async (req, res) => {
    try {
        await db.runQuery("DELETE FROM banks WHERE id = ?", [req.params.id]);
        req.session.success_msg = "Bank account deleted.";
    } catch (err) {
        req.session.error_msg = "Cannot delete bank account with history.";
    }
    res.redirect('/settings/bank');
});

// Backup Download: Serves SQLite db file download directly!
app.get('/settings/backup', requireAuth, (req, res) => {
    const dbFile = path.join(__dirname, 'db', 'vsplastic.db');
    if (fs.existsSync(dbFile)) {
        res.download(dbFile, `vsplastic_backup_${new Date().toISOString().slice(0,10)}.db`);
    } else {
        req.session.error_msg = "Backup file not found.";
        res.redirect('/dashboard');
    }
});

// ==========================================
// 12. AJAX HELPER APIS
// ==========================================

app.get('/api/party/:id', requireAuth, async (req, res) => {
    try {
        const party = await db.getOne("SELECT * FROM parties WHERE id = ?", [req.params.id]);
        res.json(party);
    } catch (err) {
        res.status(500).json({ error: "DB error" });
    }
});

app.get('/api/product/:id', requireAuth, async (req, res) => {
    try {
        const product = await db.getOne(
            `SELECT p.*, t.rate_percent AS tax_rate, u.name AS unit_name 
             FROM products p 
             JOIN taxes t ON p.tax_id = t.id 
             JOIN units u ON p.unit_id = u.id 
             WHERE p.id = ?`,
            [req.params.id]
        );
        res.json(product);
    } catch (err) {
        res.status(500).json({ error: "DB error" });
    }
});

app.get('/api/outstanding-invoices/:partyId', requireAuth, async (req, res) => {
    try {
        // Query unpaid/partially paid sales invoices for party
        const invoices = await db.query(
            `SELECT si.id, si.invoice_no, si.grand_total,
               (si.grand_total - COALESCE((SELECT SUM(amount) FROM sales_payments WHERE invoice_id = si.id), 0)) AS outstanding
             FROM sales_invoices si
             WHERE si.party_id = ? AND si.is_draft = 0
             HAVING outstanding > 0`,
            [req.params.partyId]
        );
        res.json(invoices);
    } catch (err) {
        // Fallback for standard SQLite that might complain about HAVING without GROUP BY in some versions
        try {
            const allInvoices = await db.query(
                `SELECT si.id, si.invoice_no, si.grand_total 
                 FROM sales_invoices si 
                 WHERE si.party_id = ? AND si.is_draft = 0`,
                [req.params.partyId]
            );
            
            const filtered = [];
            for (const inv of allInvoices) {
                const paidObj = await db.getOne("SELECT SUM(amount) AS total FROM sales_payments WHERE invoice_id = ?", [inv.id]);
                const paid = paidObj ? paidObj.total || 0 : 0;
                if (inv.grand_total - paid > 0) {
                    filtered.push(inv);
                }
            }
            res.json(filtered);
        } catch (innerErr) {
            res.status(500).json({ error: "DB error" });
        }
    }
});

app.get('/api/outstanding-purchase-invoices/:partyId', requireAuth, async (req, res) => {
    try {
        const invoices = await db.query(
            `SELECT pi.id, pi.invoice_no, pi.grand_total
             FROM purchase_invoices pi
             WHERE pi.party_id = ?`,
            [req.params.partyId]
        );
        res.json(invoices);
    } catch (err) {
        res.status(500).json({ error: "DB error" });
    }
});

app.get('/api/next-invoice-number', requireAuth, async (req, res) => {
    const { type, company_id } = req.query;
    try {
        const company = await db.getOne("SELECT invoice_prefix FROM companies WHERE id = ?", [company_id]);
        const prefix = company ? company.invoice_prefix : 'VS';
        
        let count;
        if (type === 'Invoice') {
            count = await db.getOne("SELECT COUNT(*) AS count FROM sales_invoices WHERE type='Invoice'");
        } else {
            count = await db.getOne("SELECT COUNT(*) AS count FROM sales_invoices WHERE type='Challan'");
        }
        
        const nextNum = (count.count + 1).toString().padStart(4, '0');
        const code = type === 'Invoice' ? 'INV' : 'CHL';
        res.json({ number: `${prefix}/${code}/${nextNum}` });
    } catch (err) {
        res.status(500).json({ error: "DB error" });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`VS Plastic ERP PWA server running on http://localhost:${PORT}`);
});
