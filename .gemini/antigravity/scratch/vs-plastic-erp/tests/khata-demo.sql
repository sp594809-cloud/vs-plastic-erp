-- Optional SQLite test fixture only. Use an expendable local database after app migration.
BEGIN;
INSERT INTO w_users(email,password,role,status,business,contact,phone,business_type,city,state,pincode,address,created_at)
VALUES('khata-demo@example.invalid','disabled','customer','approved','DEMO · Curtain showroom','Demo contact','0000000000','showroom','Ahmedabad','Gujarat','380001','Demo address','2026-01-01T00:00:00.000Z');
INSERT INTO k_policy(customer_id,limit_paise,terms,block_days,consent)
SELECT id,5000000,14,7,0 FROM w_users WHERE email='khata-demo@example.invalid';
COMMIT;
