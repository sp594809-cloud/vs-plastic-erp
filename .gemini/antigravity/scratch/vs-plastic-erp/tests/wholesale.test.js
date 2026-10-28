const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
process.env.WHOLESALE_SQLITE_PATH = ":memory:";
process.env.PORT = "0";
process.env.NODE_ENV = "test";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.ADMIN_PASSWORD = "test-admin-password-123";
delete process.env.DB_HOST;
delete process.env.TIDB_HOST;
const { start, db } = require("../server");
const d = require("../wholesale/domain");
let server, base, admin, buyer, other, orderId;
class Client {
  constructor() {
    this.cookies = {};
  }
  async request(url, data) {
    const response = await fetch(base + url, {
      method: data ? "POST" : "GET",
      redirect: "manual",
      headers: {
        Cookie: Object.entries(this.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        ...(data
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: data
        ? new URLSearchParams({ csrf: this.cookies.vs_csrf || "", ...data })
        : undefined,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, ...values] = cookie.split(";")[0].split("=");
      this.cookies[key] = values.join("=");
    }
    return {
      status: response.status,
      location: response.headers.get("location"),
      text: await response.text(),
      headers: response.headers,
    };
  }
  async login(email, password) {
    await this.request("/login");
    const r = await this.request("/login", { email, password });
    assert.equal(r.status, 302, r.text);
  }
}
const registration = (email) => ({
  email,
  password: "customer-password-123",
  business: "Test Showroom",
  contact: "Test Buyer",
  phone: "9876543210",
  business_type: "Curtain Showroom",
  city: "Ahmedabad",
  state: "Gujarat",
  pincode: "380001",
  address: "Test address, shop 1",
  gstin: "",
});
before(async () => {
  server = await start();
  base = "http://127.0.0.1:" + server.address().port;
  admin = new Client();
  buyer = new Client();
  other = new Client();
  await admin.login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});
test("public catalogue renders and never discloses configured wholesale prices", async () => {
  await db.run("UPDATE w_products SET price=12345,stock=1000 WHERE id=1");
  for (const path of [
    "/",
    "/products",
    "/products/mindi-runner",
    "/categories",
    "/about",
    "/contact",
    "/register",
    "/login",
    "/policies/privacy",
  ]) {
    const r = await other.request(path);
    assert.equal(r.status, 200, path + " " + r.text);
    assert.ok(!r.text.includes("₹123.45"), path);
  }
  assert.equal((await other.request("/admin")).status, 403);
});
test("registration is hashed and pending; cannot self-approve or order", async () => {
  await buyer.request("/register");
  const r = await buyer.request("/register", {
    ...registration("buyer@example.test"),
    role: "admin",
    status: "approved",
  });
  assert.equal(r.status, 302, r.text);
  const u = await db.one("SELECT * FROM w_users WHERE email=?", [
    "buyer@example.test",
  ]);
  assert.equal(u.role, "customer");
  assert.equal(u.status, "pending");
  assert.notEqual(u.password, registration("").password);
  await buyer.login("buyer@example.test", "customer-password-123");
  assert.equal((await buyer.request("/cart")).status, 403);
  assert.equal((await buyer.request("/admin/customers")).status, 403);
});
test("admin approval exposes current pricing and database-backed cart", async () => {
  const u = await db.one("SELECT * FROM w_users WHERE email=?", [
    "buyer@example.test",
  ]);
  let r = await admin.request("/admin/customers/" + u.id, {
    status: "approved",
    tier_id: "1",
    notes: "Approved test",
  });
  assert.equal(r.status, 302, r.text);
  r = await buyer.request("/products/mindi-runner");
  assert.match(r.text, /₹123\.45/);
  r = await buyer.request("/cart", { product_id: "1", qty: "10", price: "1" });
  assert.equal(r.status, 302, r.text);
  assert.equal((await buyer.request("/cart")).status, 200);
  assert.equal(
    (await db.one("SELECT qty FROM w_cart WHERE user_id=?", [u.id])).qty,
    10,
  );
});
test("submit ignores browser prices, snapshots products and does not deduct stock", async () => {
  let r = await buyer.request("/orders", {
    address: "Test Buyer, 9876543210, Shop 1 Ahmedabad Gujarat 380001",
    subtotal: "1",
    paid: "1",
  });
  assert.equal(r.status, 302, r.text);
  orderId = Number(r.location.match(/\/orders\/(\d+)/)[1]);
  const o = await db.one("SELECT * FROM w_orders WHERE id=?", [orderId]);
  assert.equal(o.subtotal, 123450);
  assert.equal(o.paid, 0);
  assert.equal(o.total, null);
  assert.equal(
    (await db.one("SELECT stock FROM w_products WHERE id=1")).stock,
    1000,
  );
  await db.run("UPDATE w_products SET name=?,price=? WHERE id=1", [
    "Changed current name",
    15000,
  ]);
  assert.equal(
    (await db.one("SELECT name FROM w_order_items WHERE order_id=?", [orderId]))
      .name,
    "Mindi Runner",
  );
  assert.equal((await buyer.request("/orders/" + orderId)).status, 200);
  assert.equal(
    (await buyer.request("/orders", { address: "duplicate attempt" })).status,
    400,
  );
});
test("ownership, admin endpoints and CSRF are enforced", async () => {
  await other.request("/register");
  assert.equal(
    (await other.request("/register", registration("other@example.test")))
      .status,
    302,
  );
  await other.login("other@example.test", "customer-password-123");
  assert.equal((await other.request("/orders/" + orderId)).status, 404);
  assert.equal(
    (
      await buyer.request("/admin/orders/" + orderId + "/payment", {
        amount: "1234.50",
        verified: "yes",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await buyer.request("/cart", {
        product_id: "1",
        qty: "2",
        csrf: "invalid",
      })
    ).status,
    403,
  );
  assert.equal((await buyer.request("/admin/export/customers")).status, 403);
});
test("quotation, stock reservation and verified payment workflow", async () => {
  for (const status of ["Under Review"])
    assert.equal(
      (await admin.request("/admin/orders/" + orderId + "/status", { status }))
        .status,
      302,
    );
  let r = await admin.request("/admin/orders/" + orderId + "/quote", {
    subtotal: "1234.50",
    tax: "0",
    shipping: "100",
    discount: "0",
    notes: "Confirmed with buyer",
  });
  assert.equal(r.status, 302, r.text);
  for (const status of ["Awaiting Customer Confirmation", "Awaiting Payment"]) {
    r = await admin.request("/admin/orders/" + orderId + "/status", { status });
    assert.equal(r.status, 302, r.text);
  }
  assert.equal(
    (await db.one("SELECT reserved FROM w_products WHERE id=1")).reserved,
    10,
  );
  r = await buyer.request("/orders/" + orderId + "/payment-reference", {
    reference: "customer-claim",
  });
  assert.equal(r.status, 302, r.text);
  assert.equal(
    (await db.one("SELECT paid FROM w_orders WHERE id=?", [orderId])).paid,
    0,
  );
  await admin.request("/admin/orders/" + orderId + "/status", {
    status: "Awaiting Payment",
  });
  assert.equal(
    (await db.one("SELECT reserved FROM w_products WHERE id=1")).reserved,
    10,
  );
  r = await admin.request("/admin/orders/" + orderId + "/payment", {
    amount: "1",
    method: "UPI",
    reference: "bad",
    payment_date: "2026-01-01",
    verified: "yes",
  });
  assert.equal(r.status, 400);
  r = await admin.request("/admin/orders/" + orderId + "/payment", {
    amount: "1334.50",
    method: "UPI",
    reference: "verified-bank-reference",
    payment_date: "2026-01-01",
    verified: "yes",
  });
  assert.equal(r.status, 302, r.text);
  assert.equal(
    (await db.one("SELECT status FROM w_orders WHERE id=?", [orderId])).status,
    "Payment Confirmed",
  );
});
test("dispatch requires tracking; deducts reserved inventory exactly once", async () => {
  assert.equal(
    (
      await admin.request("/admin/orders/" + orderId + "/status", {
        status: "Processing",
      })
    ).status,
    302,
  );
  assert.equal(
    (
      await admin.request("/admin/orders/" + orderId + "/status", {
        status: "Dispatched",
      })
    ).status,
    400,
  );
  let r = await admin.request("/admin/orders/" + orderId + "/shipping", {
    courier: "Test courier",
    tracking: "TEST123",
    link: "https://example.com/track",
    estimated_date: "2026-12-01",
  });
  assert.equal(r.status, 302, r.text);
  assert.equal(
    (
      await admin.request("/admin/orders/" + orderId + "/status", {
        status: "Dispatched",
      })
    ).status,
    302,
  );
  assert.equal(
    (
      await admin.request("/admin/orders/" + orderId + "/status", {
        status: "Dispatched",
      })
    ).status,
    400,
  );
  const p = await db.one("SELECT * FROM w_products WHERE id=1");
  assert.equal(p.stock, 990);
  assert.equal(p.reserved, 0);
  assert.match((await buyer.request("/orders/" + orderId)).text, /TEST123/);
});
test("reorder uses current prices and quantity rules", async () => {
  await db.run("UPDATE w_products SET moq=12,step=6 WHERE id=1");
  assert.equal(
    (await buyer.request("/orders/" + orderId + "/reorder", {})).status,
    302,
  );
  const u = await db.one("SELECT * FROM w_users WHERE email=?", [
    "buyer@example.test",
  ]);
  const c = await d.cart(db, u);
  assert.equal(c.rows[0].qty, 12);
  assert.equal(c.rows[0].quoted, 15000);
  assert.equal(c.subtotal, 180000);
});
test("transaction rolls back inventory reservations if any item lacks stock", async () => {
  const u = await db.one("SELECT * FROM w_users WHERE email=?", [
    "buyer@example.test",
  ]);
  await db.run("UPDATE w_products SET price=100,stock=20 WHERE id=2");
  await buyer.request("/cart", { product_id: "2", qty: "10" });
  let r = await buyer.request("/orders", { address: "Buyer test delivery" });
  assert.equal(r.status, 302);
  const id = Number(r.location.match(/\/orders\/(\d+)/)[1]);
  await db.run("UPDATE w_products SET stock=0 WHERE id=2");
  await admin.request("/admin/orders/" + id + "/status", {
    status: "Under Review",
  });
  await admin.request("/admin/orders/" + id + "/quote", {
    subtotal: "1810",
    tax: "0",
    shipping: "0",
    discount: "0",
  });
  await admin.request("/admin/orders/" + id + "/status", {
    status: "Awaiting Customer Confirmation",
  });
  r = await admin.request("/admin/orders/" + id + "/status", {
    status: "Awaiting Payment",
  });
  assert.equal(r.status, 400);
  assert.equal(
    (await db.one("SELECT reserved FROM w_products WHERE id=1")).reserved,
    0,
  );
  assert.equal(
    (await db.one("SELECT status FROM w_orders WHERE id=?", [id])).status,
    "Awaiting Customer Confirmation",
  );
});
test("admin can manage products and all dashboard pages render", async () => {
  const r = await admin.request("/admin/products", {
    name: "New Track",
    slug: "new-track",
    sku: "NEW-1",
    category_id: "2",
    description: "Real product configuration test",
    unit: "metres",
    price: "20",
    cost: "10",
    moq: "1",
    step: "1",
    tax: "18",
    active: "1",
    featured: "0",
  });
  assert.equal(r.status, 302, r.text);
  assert.ok(await db.one("SELECT * FROM w_products WHERE sku=?", ["NEW-1"]));
  for (const path of [
    "/admin",
    "/admin/orders",
    "/admin/customers",
    "/admin/products",
    "/admin/products/1",
    "/admin/products/new",
    "/admin/inventory",
    "/admin/settings",
    "/admin/analytics",
    "/account",
    "/saved",
  ]) {
    const page = await admin.request(path);
    assert.equal(page.status, 200, path + " " + page.text);
  }
  assert.equal((await admin.request("/admin/export/orders")).status, 200);
});
test("pricing precedence, quantity discounts and suspended-price privacy", async () => {
  const u = await db.one("SELECT * FROM w_users WHERE email=?", [
    "buyer@example.test",
  ]);
  const p = await db.one("SELECT * FROM w_products WHERE id=1");
  await db.run(
    "INSERT INTO w_prices (product_id,min_qty,price) VALUES (1,10,14000)",
  );
  await db.run(
    "INSERT INTO w_prices (product_id,tier_id,min_qty,price) VALUES (1,1,10,13000)",
  );
  assert.equal(await d.priceFor(db, p, u, 12), 13000);
  await db.run(
    "INSERT INTO w_prices (product_id,user_id,min_qty,price) VALUES (1,?,10,12000)",
    [u.id],
  );
  assert.equal(await d.priceFor(db, p, u, 12), 12000);
  assert.equal(await d.priceFor(db, p, u, 1), 15000);
});
test("image upload enforces admin, type validation and persistent public retrieval", async () => {
  const bytes = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../public/wholesale/icon-192.png"),
  );
  const send = (client, body, type) =>
    fetch(base + "/admin/products/1/image", {
      method: "POST",
      headers: {
        Cookie: Object.entries(client.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        "X-CSRF-Token": client.cookies.vs_csrf,
        "Content-Type": type,
      },
      body,
    });
  assert.equal((await send(buyer, bytes, "image/png")).status, 403);
  assert.equal(
    (await send(admin, Buffer.from("not an actual image"), "image/png")).status,
    400,
  );
  const response = await send(admin, bytes, "image/png");
  assert.equal(response.status, 200, await response.text());
  const p = await db.one("SELECT image FROM w_products WHERE id=1");
  assert.match(p.image, /^\/media\/\d+$/);
  const image = await fetch(base + p.image);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
});
test("negative stock, stale status and suspended accounts are rejected", async () => {
  assert.equal(
    (
      await admin.request("/admin/inventory", {
        product_id: "1",
        delta: "-100000",
        threshold: "0",
        reason: "invalid",
      })
    ).status,
    400,
  );
  const u = await db.one("SELECT * FROM w_users WHERE email=?", [
    "buyer@example.test",
  ]);
  assert.equal(
    (
      await admin.request("/admin/customers/" + u.id, {
        status: "suspended",
        tier_id: "1",
      })
    ).status,
    302,
  );
  assert.equal((await buyer.request("/orders")).location, "/login");
});
