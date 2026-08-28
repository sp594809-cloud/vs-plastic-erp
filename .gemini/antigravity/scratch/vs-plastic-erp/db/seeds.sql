-- VS Plastic ERP Seed Data

-- Clear existing data (optional but good for clean seeding)
DELETE FROM users;
DELETE FROM financial_years;
DELETE FROM companies;
DELETE FROM units;
DELETE FROM taxes;
DELETE FROM banks;
DELETE FROM parties;
DELETE FROM products;

-- 1. Insert Users (Password: patel, simple plain-text or bcrypt/hash, we will support plain-text comparison for simple ERP demo as requested: sanjay / patel)
INSERT INTO users (id, username, password, role) VALUES (1, 'sanjay', 'patel', 'admin');

-- 2. Insert Financial Years
INSERT INTO financial_years (id, name, is_active) VALUES 
(1, '2025-2026', 0),
(2, '2026-2027', 1);

-- 3. Insert Default Company
INSERT INTO companies (id, name, address, gstin, phone, email, logo_path, bank_name, bank_ac_no, bank_ifsc, bank_branch, invoice_prefix) VALUES 
(1, 'VS Plastic Industries', 'Plot No. 124, GIDC Halol, Panchmahal, Gujarat - 389350', '24AABCV1234F1Z1', '9876543210', 'info@vsplastic.com', '/images/logo.png', 'State Bank of India', '30245678901', 'SBIN0001234', 'Halol GIDC Branch', 'VSP');

-- 4. Insert Units
INSERT INTO units (id, name) VALUES 
(1, 'Kg'),
(2, 'Bag'),
(3, 'Nos'),
(4, 'Ton');

-- 5. Insert Taxes
INSERT INTO taxes (id, name, rate_percent) VALUES 
(1, 'GST 5%', 5.0),
(2, 'GST 12%', 12.0),
(3, 'GST 18%', 18.0),
(4, 'GST 28%', 28.0);

-- 6. Insert Banks
INSERT INTO banks (id, name, ac_no, ifsc, branch, opening_balance, current_balance) VALUES 
(1, 'State Bank of India', '30245678901', 'SBIN0001234', 'Halol GIDC Branch', 150000.0, 150000.0),
(2, 'HDFC Bank', '50100234567890', 'HDFC0000456', 'Vadodara Alkapuri Branch', 280000.0, 280000.0);

-- 7. Insert Parties (Customers, Suppliers, Both)
-- States: Gujarat is 24 (Same state as Company, triggers CGST + SGST)
-- Other states (like Maharashtra 27, Rajasthan 08) trigger IGST.
INSERT INTO parties (id, name, type, address, shipping_address, gstin, state, state_code, contact_person, mobile, email, opening_balance, balance_type, current_balance) VALUES 
(1, 'Ambika Plastics', 'Customer', '12, Shrinathji Industrial Estate, Ahmedabad, Gujarat', '12, Shrinathji Industrial Estate, Ahmedabad, Gujarat', '24AADCA9988C1ZX', 'Gujarat', '24', 'Rameshbhai', '9426011223', 'ambikaplastics@gmail.com', 45000.0, 'Dr', 45000.0),
(2, 'Krishna Polymers', 'Supplier', 'Plot 45, GIDC Sachin, Surat, Gujarat', 'Plot 45, GIDC Sachin, Surat, Gujarat', '24AAECK7766A1ZB', 'Gujarat', '24', 'Kiritbhai Patel', '9825122334', 'krishnapolymers@yahoo.com', 85000.0, 'Cr', 85000.0),
(3, 'Maruti Enterprise', 'Customer', 'Survey No. 234, Kalol Road, Mehsana, Gujarat', 'Survey No. 234, Kalol Road, Mehsana, Gujarat', '24AABFM3344D1ZR', 'Gujarat', '24', 'Vijaybhai', '9724123456', 'maruti_enterprise@rediff.com', 12000.0, 'Dr', 12000.0),
(4, 'Apex Trading Co.', 'Both', '302, Maker Chambers, Nariman Point, Mumbai, Maharashtra', 'Warehouse A, Bhiwandi, Thane, Maharashtra', '27AAAFA5522F1ZK', 'Maharashtra', '27', 'Sanjay Shah', '9920198765', 'apex@apextrading.co.in', 0.0, 'Dr', 0.0),
(5, 'Rajasthan Poly Pack', 'Supplier', 'F-88, Industrial Area, Jaipur, Rajasthan', 'F-88, Industrial Area, Jaipur, Rajasthan', '08AAHRP1122B1ZN', 'Rajasthan', '08', 'Gopal Sharma', '8003112233', 'rajasthanpoly@gmail.com', 120000.0, 'Cr', 120000.0),
(6, 'Balaji Traders', 'Customer', 'Shop No. 5, Market Yard, Rajkot, Gujarat', 'Shop No. 5, Market Yard, Rajkot, Gujarat', '24AAJFB1155M1ZP', 'Gujarat', '24', 'Manishbhai', '9898012345', 'balaji@gmail.com', 7500.0, 'Dr', 7500.0),
(7, 'Narmada Plastic Works', 'Customer', 'Opp. Railway Station, Bharuch, Gujarat', 'Opp. Railway Station, Bharuch, Gujarat', '24AAKFN2211S1ZV', 'Gujarat', '24', 'Pravinbhai', '9427188776', 'narmada@yahoo.com', 0.0, 'Dr', 0.0);

-- 8. Insert Products (with linked unit_id and tax_id)
INSERT INTO products (id, name, hsn_sac, unit_id, purchase_rate, sale_rate, tax_id, opening_stock, current_stock) VALUES 
(1, 'HDPE Blue Granules', '39011010', 1, 85.00, 95.00, 3, 5000.0, 5000.0), -- 18% GST, Kg
(2, 'LDPE Clear Film Roll', '39201019', 1, 105.00, 118.00, 3, 2000.0, 2000.0), -- 18% GST, Kg
(3, 'PP Woven Bags 50kg', '63053300', 2, 12.50, 15.00, 2, 10000.0, 10000.0), -- 12% GST, Bag
(4, 'Plastic Stick 10 inch', '39269099', 3, 0.45, 0.60, 3, 50000.0, 50000.0), -- 18% GST, Nos
(5, 'PVC Rigid Conduit Pipe', '39172310', 3, 45.00, 55.00, 3, 1000.0, 1000.0), -- 18% GST, Nos
(6, 'LLDPE Rotomoulding Powder', '39011090', 1, 92.00, 102.00, 3, 3000.0, 3000.0), -- 18% GST, Kg
(7, 'Recycled Black Bags Large', '39232100', 2, 22.00, 28.00, 1, 15000.0, 15000.0), -- 5% GST, Bag
(8, 'HM-HDPE Carry Bags', '39232100', 1, 98.00, 110.00, 3, 1500.0, 1500.0), -- 18% GST, Kg
(9, 'Masterbatch Yellow Color', '32064990', 1, 150.00, 180.00, 3, 500.0, 500.0), -- 18% GST, Kg
(10, 'PET Flakes Clear Premium', '39076100', 1, 65.00, 72.00, 3, 8000.0, 8000.0), -- 18% GST, Kg
(11, 'Plastic Pallet Double Deck', '39239090', 3, 1200.00, 1450.00, 3, 100.0, 100.0), -- 18% GST, Nos
(12, 'Stretch Wrapping Film Roll', '39201012', 3, 250.00, 290.00, 3, 400.0, 400.0); -- 18% GST, Nos
