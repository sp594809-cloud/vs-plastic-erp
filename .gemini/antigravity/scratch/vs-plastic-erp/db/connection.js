const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'vsplastic.db');
const dbExists = fs.existsSync(dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database at:', dbPath);
    }
});

// Run a query and return a Promise (helper for async/await)
db.query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

db.getOne = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

db.runQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
};

// Check if database needs initialization
db.serialize(() => {
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
        if (err) {
            console.error('Error checking database status:', err);
            return;
        }

        if (!row) {
            console.log('Database is new. Initializing schema...');
            const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
            
            // Execute schema commands sequentially (SQLite can execute multiple statements via exec)
            db.exec(schemaSql, (err) => {
                if (err) {
                    console.error('Error running schema.sql:', err.message);
                } else {
                    console.log('Schema loaded successfully. Seeding data...');
                    const seedsSql = fs.readFileSync(path.join(__dirname, 'seeds.sql'), 'utf8');
                    db.exec(seedsSql, (err) => {
                        if (err) {
                            console.error('Error running seeds.sql:', err.message);
                        } else {
                            console.log('Seed data loaded successfully!');
                        }
                    });
                }
            });
        } else {
            console.log('Database already initialized.');
        }
    });
});

module.exports = db;
