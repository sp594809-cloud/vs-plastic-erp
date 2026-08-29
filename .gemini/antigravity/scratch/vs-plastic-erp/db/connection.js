const fs = require('fs');
const path = require('path');

// Load .env from project root (parent of /db)
const envPath = path.join(__dirname, '..', '.env');
try {
    require('dotenv').config({ path: envPath });
    if (fs.existsSync(envPath)) {
        console.log('Loaded .env from', envPath);
    } else {
        console.warn('No .env file at', envPath, '— using SQLite unless env vars are set in the shell.');
    }
} catch (e) {
    console.warn('dotenv not installed or failed:', e.message);
}

const useTiDB = !!(process.env.DB_HOST || process.env.TIDB_HOST);
console.log('DB mode:', useTiDB ? 'TiDB/MySQL' : 'SQLite',
    '| DB_HOST=', process.env.DB_HOST || '(empty)');

function normalizeSql(sql, engine) {
    let q = sql;
    if (engine === 'mysql') {
        // SQLite -> MySQL
        q = q.replace(/strftime\s*\(\s*'%m'\s*,\s*date\s*\)/gi, "DATE_FORMAT(date, '%m')");
    } else {
        // MySQL -> SQLite
        q = q.replace(/DATE_FORMAT\s*\(\s*date\s*,\s*'%m'\s*\)/gi, "strftime('%m', date)");
        q = q.replace(/COALESCE\s*\(/gi, 'IFNULL(');
    }
    return q;
}

function createMysqlApi() {
    const mysql = require('mysql2/promise');
    const host = process.env.DB_HOST || process.env.TIDB_HOST;
    const port = parseInt(process.env.DB_PORT || process.env.TIDB_PORT || '4000', 10);
    const user = process.env.DB_USER || process.env.TIDB_USER || 'root';
    const password = process.env.DB_PASSWORD || process.env.TIDB_PASSWORD || '';
    const database = process.env.DB_NAME || process.env.TIDB_DATABASE || 'vsplastic';
    const sslReject = (process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true') !== 'false';

    console.log(`Connecting TiDB at ${host}:${port} db=${database}`);
    const pool = mysql.createPool({
        host, port, user, password, database,
        waitForConnections: true,
        connectionLimit: 10,
        multipleStatements: true,
        decimalNumbers: true,
        ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: sslReject }
    });

    async function initSchema() {
        const [rows] = await pool.query(
            "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'"
        );
        if (rows[0].c > 0) {
            console.log('TiDB: tables already exist.');
            return;
        }
        const schemaPath = path.join(__dirname, 'schema.mysql.sql');
        if (!fs.existsSync(schemaPath)) {
            console.error('Missing db/schema.mysql.sql');
            return;
        }
        console.log('TiDB: creating tables...');
        await pool.query(fs.readFileSync(schemaPath, 'utf8'));
        const seedsPath = path.join(__dirname, 'seeds.sql');
        if (fs.existsSync(seedsPath)) {
            try {
                await pool.query(fs.readFileSync(seedsPath, 'utf8'));
                console.log('TiDB: seed done.');
            } catch (e) {
                console.warn('Seed warning:', e.message);
            }
        }
    }

    const ready = initSchema()
        .then(() => console.log('TiDB ready.'))
        .catch((err) => {
            console.error('TiDB init failed:', err.message);
            throw err;
        });

    const wrap = (fn) => async (...args) => {
        await ready;
        return fn(...args);
    };

    return {
        engine: 'mysql',
        query: wrap(async (sql, params = []) => {
            const [rows] = await pool.query(normalizeSql(sql, 'mysql'), params);
            return rows;
        }),
        getOne: wrap(async (sql, params = []) => {
            const [rows] = await pool.query(normalizeSql(sql, 'mysql'), params);
            return rows[0] || null;
        }),
        runQuery: wrap(async (sql, params = []) => {
            const [result] = await pool.query(normalizeSql(sql, 'mysql'), params);
            return { id: result.insertId || 0, changes: result.affectedRows || 0 };
        }),
        pool
    };
}

function createSqliteApi() {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, 'vsplastic.db');
    const db = new sqlite3.Database(dbPath);
    console.warn('Using SQLite file:', dbPath);
    console.warn('Data will NOT persist on cloud deploy. Set DB_HOST in .env for TiDB.');

    // auto-init sqlite schema if empty
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
            if (!row) {
                console.log('SQLite: initializing schema...');
                db.exec(fs.readFileSync(schemaPath, 'utf8'), (e) => {
                    if (e) return console.error(e.message);
                    const seeds = path.join(__dirname, 'seeds.sql');
                    if (fs.existsSync(seeds)) db.exec(fs.readFileSync(seeds, 'utf8'));
                });
            }
        });
    }

    return {
        engine: 'sqlite',
        query: (sql, params = []) => new Promise((resolve, reject) => {
            db.all(normalizeSql(sql, 'sqlite'), params, (err, rows) => err ? reject(err) : resolve(rows));
        }),
        getOne: (sql, params = []) => new Promise((resolve, reject) => {
            db.get(normalizeSql(sql, 'sqlite'), params, (err, row) => err ? reject(err) : resolve(row));
        }),
        runQuery: (sql, params = []) => new Promise((resolve, reject) => {
            db.run(normalizeSql(sql, 'sqlite'), params, function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        })
    };
}

module.exports = useTiDB ? createMysqlApi() : createSqliteApi();
