const path = require("node:path");
const fs = require("node:fs");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});
const mysql = process.env.NODE_ENV !== 'test' && !process.env.WHOLESALE_SQLITE_PATH && !!(process.env.DB_HOST || process.env.TIDB_HOST);
let pool, sqlite;
if (mysql) {
  pool = require("mysql2/promise").createPool({
    host: process.env.DB_HOST || process.env.TIDB_HOST,
    port: Number(process.env.DB_PORT || process.env.TIDB_PORT || 4000),
    user: process.env.DB_USER || process.env.TIDB_USER,
    password: process.env.DB_PASSWORD || process.env.TIDB_PASSWORD,
    database: process.env.DB_NAME || process.env.TIDB_DATABASE || "vsplastic",
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionLimit: 10,
    decimalNumbers: true,
  });
} else {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Production requires the existing TiDB DB_HOST and credentials. SQLite is development-only.",
    );
  const { DatabaseSync } = require("node:sqlite");
  sqlite = new DatabaseSync(
    process.env.WHOLESALE_SQLITE_PATH ||
      path.join(__dirname, "..", "db", "wholesale-dev.db"),
  );
  sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
}
function api(connection) {
  return {
    async all(sql, params = []) {
      return mysql
        ? (await connection.execute(sql, params))[0]
        : connection.prepare(sql).all(...params);
    },
    async one(sql, params = []) {
      return (await this.all(sql, params))[0] || null;
    },
    async run(sql, params = []) {
      const r = mysql
        ? (await connection.execute(sql, params))[0]
        : connection.prepare(sql).run(...params);
      return {
        id: Number(r.insertId || r.lastInsertRowid || 0),
        changes: Number(r.affectedRows ?? r.changes),
      };
    },
  };
}
const db = api(pool || sqlite);
let queue = Promise.resolve();
db.transaction = async function (fn) {
  if (mysql) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const result = await fn(api(c));
      await c.commit();
      return result;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  const task = queue.then(async () => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const r = await fn(api(sqlite));
      sqlite.exec("COMMIT");
      return r;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  });
  queue = task.catch(() => {});
  return task;
};
db.lock = mysql ? " FOR UPDATE" : "";
db.close = () => (mysql ? pool.end() : sqlite.close());
db.migrate = async () => {
  const source = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  for (let sql of source
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (mysql)
      sql = sql.replace(
        /INTEGER PRIMARY KEY AUTOINCREMENT/g,
        "INTEGER PRIMARY KEY AUTO_INCREMENT",
      );
    await db.run(sql);
  }
  const migration = await db.one(
    "SELECT version FROM w_migrations WHERE version = 1",
  );
  if (!migration)
    await db.transaction(async (tx) => {
      const cats = [
        "Curtain Runners",
        "Curtain Tracks",
        "Curtain Hooks",
        "Curtain Clamps",
        "Curtain Belts",
      ];
      for (const name of cats)
        await tx.run("INSERT INTO w_categories (name) VALUES (?)", [name]);
      for (const name of ["Silver", "Gold", "Platinum"])
        await tx.run("INSERT INTO w_tiers (name) VALUES (?)", [name]);
      const products = [
        ["Mindi Runner", 1],
        ["Arabian Runner", 1],
        ["M Track Runner", 1],
        ["Arabian Track", 2],
        ["M Track", 2],
        ["Fish Hook", 3],
        ["Fish Hook Pointer", 3],
        ["Ceiling Clamp", 4],
        ["Arabian Hand Clamp", 4],
        ["M Track Hand Clamp", 4],
        ["Arabian Belt", 5],
        ["M Track Belt", 5],
      ];
      for (let i = 0; i < products.length; i++) {
        const [name, category] = products[i];
        await tx.run(
          "INSERT INTO w_products (name,slug,sku,category_id,unit,description) VALUES (?,?,?,?,?,?)",
          [
            name,
            name.toLowerCase().replaceAll(" ", "-"),
            `VS-${String(i + 1).padStart(3, "0")}`,
            category,
            category === 5 ? "rolls" : category === 2 ? "metres" : "pieces",
            "Product specifications and photographs will be added by our team. Contact us to confirm the right fitting for your requirements.",
          ],
        );
      }
      await tx.run("INSERT INTO w_settings (id,data) VALUES (1,?)", [
        JSON.stringify({
          name: "VS Curtain Accessories",
          phone: "",
          whatsapp: "",
          email: "",
          address: "Ahmedabad, Gujarat, India",
          headline: "Small fittings. Big possibilities.",
          minimum: 0,
          payment: "",
          shipping:
            "Shipping cost and estimated delivery are confirmed with your quotation.",
          returns:
            "Contact us before returning any goods. Return eligibility will be confirmed by our team.",
          privacy:
            "We use your business and delivery details to review accounts and fulfil orders. Contact us to request correction or deletion, subject to record retention obligations.",
          terms:
            "Order requests are not accepted sales until pricing, stock and delivery are confirmed. Payment is requested only after quotation approval.",
        }),
      ]);
      await tx.run("INSERT INTO w_migrations (version) VALUES (1)");
    });
};
module.exports = db;
