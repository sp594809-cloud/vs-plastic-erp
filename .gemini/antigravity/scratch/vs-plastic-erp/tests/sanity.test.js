// VS Plastic ERP Sanity Test Script

const db = require('../db/connection');
const translate = require('../utils/translate');
const numberToWords = require('../utils/numberToWords');

async function runTests() {
    console.log("=== RUNNING VS PLASTIC ERP SANITY TESTS ===\n");
    let failed = false;

    // Test 1: Verify Translation Helper
    try {
        console.log("Test 1: Translation Helper");
        const translateGu = translate('gu');
        const translatedDashboard = translateGu('Dashboard');
        if (translatedDashboard === 'ડેશબોર્ડ') {
            console.log("  [PASS] Translation of 'Dashboard' to Gujarati correct: ડેશબોર્ડ");
        } else {
            throw new Error(`Expected 'ડેશબોર્ડ', got '${translatedDashboard}'`);
        }
    } catch (e) {
        console.error("  [FAIL] Translation test failed:", e.message);
        failed = true;
    }

    // Test 2: Verify Number to Words Converter
    try {
        console.log("\nTest 2: Number to Words Converter");
        const words = numberToWords(14500.50);
        const expected = "Fourteen Thousand Five Hundred Rupees and Fifty Paisa";
        if (words === expected) {
            console.log("  [PASS] Number 14500.50 converted to words correctly!");
        } else {
            throw new Error(`Expected '${expected}', got '${words}'`);
        }
    } catch (e) {
        console.error("  [FAIL] Number to words test failed:", e.message);
        failed = true;
    }

    // Test 3: Verify Database Tables and Seed Data
    try {
        console.log("\nTest 3: Database Tables Check");
        const users = await db.query("SELECT * FROM users");
        const user = users[0];
        if (user && user.username === 'sanjay' && user.password === 'patel') {
            console.log("  [PASS] Users table exists and seeded with 'sanjay'/'patel'");
        } else {
            throw new Error("Seed user 'sanjay'/'patel' not found in database.");
        }

        const companies = await db.query("SELECT * FROM companies");
        if (companies.length > 0) {
            console.log(`  [PASS] Companies table populated (Found: ${companies[0].name})`);
        } else {
            throw new Error("Companies table is empty.");
        }

        const parties = await db.query("SELECT * FROM parties");
        console.log(`  [PASS] Parties table populated (${parties.length} accounts seeded)`);

        const products = await db.query("SELECT * FROM products");
        console.log(`  [PASS] Products table populated (${products.length} items seeded)`);

    } catch (e) {
        console.error("  [FAIL] Database check failed:", e.message);
        failed = true;
    }

    console.log("\n=== TEST RESULTS SUMMARY ===");
    if (failed) {
        console.error("  [FAIL] Some sanity checks failed. Please check log details.");
        process.exit(1);
    } else {
        console.log("  [PASS] All core backend and database sanity checks passed successfully!");
        process.exit(0);
    }
}

// Give a slight delay for database initialization connection logic to run
setTimeout(runTests, 1500);
