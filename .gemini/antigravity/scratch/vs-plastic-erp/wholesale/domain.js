const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const now = () => new Date().toISOString();
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function integer(value, min = 0, max = 100000000) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    fail("Enter a valid whole number.");
  return n;
}
function money(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value)))
    fail("Enter an amount with at most two decimal places.");
  return integer(Math.round(Number(value) * 100));
}
function field(value, label, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`Please enter a valid ${label}.`);
  return value.trim();
}
async function hash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    fail("Use a password between 12 and 128 characters.");
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(password, salt, 64)).toString("hex")}`;
}
async function verify(password, stored) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, key] = stored.split(":");
  const derived = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(derived, Buffer.from(key, "hex"));
}
async function priceFor(tx, p, user, qty) {
  const rules = await tx.all(
    "SELECT * FROM w_prices WHERE product_id=? AND min_qty<=?",
    [p.id, qty],
  );
  const matching = rules.filter(
    (r) =>
      r.user_id === user.id ||
      (!r.user_id && r.tier_id === user.tier_id) ||
      (!r.user_id && !r.tier_id),
  );
  matching.sort(
    (a, b) =>
      (b.user_id ? 2 : b.tier_id ? 1 : 0) -
        (a.user_id ? 2 : a.tier_id ? 1 : 0) || b.min_qty - a.min_qty,
  );
  return matching[0]?.price ?? p.price;
}
async function cart(tx, user) {
  const rows = await tx.all(
    "SELECT p.*,c.qty FROM w_cart c JOIN w_products p ON p.id=c.product_id WHERE c.user_id=?",
    [user.id],
  );
  let subtotal = 0,
    tax = 0;
  for (const p of rows) {
    p.quoted = await priceFor(tx, p, user, p.qty);
    p.valid =
      !!p.active &&
      p.quoted !== null &&
      p.qty >= p.moq &&
      (p.qty - p.moq) % p.step === 0 &&
      p.qty <= p.stock - p.reserved;
    subtotal += (p.quoted || 0) * p.qty;
    tax += Math.round(((p.quoted || 0) * p.qty * p.tax) / 10000);
  }
  return { rows, subtotal, tax };
}
async function history(tx, id, actor, event) {
  await tx.run(
    "INSERT INTO w_history (order_id,actor_id,event,created_at) VALUES (?,?,?,?)",
    [id, actor, event, now()],
  );
}
async function audit(tx, actor, event) {
  await tx.run(
    "INSERT INTO w_audit (actor_id,event,created_at) VALUES (?,?,?)",
    [actor, event, now()],
  );
}
async function submit(db, user, address, minimum) {
  return db.transaction(async (tx) => {
    const current = await tx.one("SELECT * FROM w_users WHERE id=?" + db.lock, [
      user.id,
    ]);
    if (current.status !== "approved")
      fail("Your account must be approved before ordering.", 403);
    const c = await cart(tx, current);
    if (!c.rows.length) fail("Your cart is empty.");
    if (c.rows.some((p) => !p.valid))
      fail(
        "Some items need updated quantities or availability. Review your cart.",
      );
    if (c.subtotal < minimum)
      fail("Your cart does not meet the minimum order value.");
    const ref = `VS-${new Date().getFullYear()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const r = await tx.run(
      "INSERT INTO w_orders (reference,user_id,subtotal,tax,address,created_at) VALUES (?,?,?,?,?,?)",
      [ref, user.id, c.subtotal, c.tax, address, now()],
    );
    for (const p of c.rows)
      await tx.run(
        "INSERT INTO w_order_items (order_id,product_id,name,sku,variant,unit,qty,price,tax) VALUES (?,?,?,?,?,?,?,?,?)",
        [r.id, p.id, p.name, p.sku, p.variant, p.unit, p.qty, p.quoted, p.tax],
      );
    await history(tx, r.id, user.id, "Request Received");
    await tx.run("DELETE FROM w_cart WHERE user_id=?", [user.id]);
    return r.id;
  });
}
const transitions = {
  "Request Received": ["Under Review", "Cancelled", "Rejected"],
  "Under Review": ["Awaiting Customer Confirmation", "Cancelled", "Rejected"],
  "Awaiting Customer Confirmation": [
    "Under Review",
    "Awaiting Payment",
    "Cancelled",
  ],
  "Awaiting Payment": ["Payment Verification Pending", "Cancelled"],
  "Payment Verification Pending": ["Awaiting Payment", "Cancelled"],
  "Payment Confirmed": ["Processing", "Refunded"],
  Processing: ["Dispatched", "Refunded"],
  Dispatched: ["Delivered"],
  Delivered: ["Completed"],
  Completed: ["Refunded"],
  Cancelled: [],
  Rejected: [],
  Refunded: [],
};
async function transition(db, id, actor, status) {
  return db.transaction(async (tx) => {
    const o = await tx.one("SELECT * FROM w_orders WHERE id=?" + db.lock, [id]);
    if (!o) fail("Order not found.", 404);
    if (!transitions[o.status]?.includes(status))
      fail("That status change is not allowed.");
    if (status === "Awaiting Payment" && !o.reservation) {
      if (o.total === null || o.total <= 0)
        fail("Save a final quotation first.");
      const items = await tx.all(
        "SELECT * FROM w_order_items WHERE order_id=? ORDER BY product_id",
        [id],
      );
      for (const p of items) {
        const result = await tx.run(
          "UPDATE w_products SET reserved=reserved+? WHERE id=? AND active=1 AND stock-reserved>=?",
          [p.qty, p.product_id, p.qty],
        );
        if (!result.changes) fail(`Insufficient stock for ${p.name}.`);
      }
      await tx.run("UPDATE w_orders SET reservation=1 WHERE id=?", [id]);
    }
    if (
      ["Cancelled", "Rejected", "Refunded"].includes(status) &&
      o.reservation === 1
    ) {
      for (const p of await tx.all(
        "SELECT * FROM w_order_items WHERE order_id=?",
        [id],
      ))
        await tx.run("UPDATE w_products SET reserved=reserved-? WHERE id=?", [
          p.qty,
          p.product_id,
        ]);
      await tx.run("UPDATE w_orders SET reservation=0 WHERE id=?", [id]);
    }
    if (status === "Dispatched") {
      if (!o.paid || o.reservation !== 1)
        fail("Verified payment and reserved stock are required.");
      const shipping = await tx.one(
        "SELECT * FROM w_shipping WHERE order_id=?",
        [id],
      );
      if (!shipping?.courier || !shipping?.tracking)
        fail("Save courier and tracking details before dispatch.");
      for (const p of await tx.all(
        "SELECT * FROM w_order_items WHERE order_id=?",
        [id],
      )) {
        await tx.run(
          "UPDATE w_products SET stock=stock-?,reserved=reserved-? WHERE id=?",
          [p.qty, p.qty, p.product_id],
        );
        await tx.run(
          "INSERT INTO w_movements (product_id,actor_id,delta,reason,created_at) VALUES (?,?,?,?,?)",
          [p.product_id, actor, -p.qty, `Dispatch ${o.reference}`, now()],
        );
      }
      await tx.run("UPDATE w_orders SET reservation=2 WHERE id=?", [id]);
      await tx.run("UPDATE w_shipping SET dispatched_at=? WHERE order_id=?", [
        now(),
        id,
      ]);
    }
    await tx.run("UPDATE w_orders SET status=? WHERE id=?", [status, id]);
    await history(tx, id, actor, status);
    await audit(tx, actor, `${o.reference}: ${status}`);
  });
}
async function confirmPayment(db, id, actor, input) {
  return db.transaction(async (tx) => {
    const o = await tx.one("SELECT * FROM w_orders WHERE id=?" + db.lock, [id]);
    if (!o) fail("Order not found.", 404);
    if (
      !["Awaiting Payment", "Payment Verification Pending"].includes(
        o.status,
      ) ||
      o.paid ||
      o.total === null
    )
      fail("This order is not awaiting payment.");
    const amount = money(input.amount);
    if (amount !== o.total)
      fail("Verified payment must match the final quotation.");
    if (input.verified !== "yes")
      fail("Confirm independent bank verification first.");
    if (!["Bank transfer", "UPI", "Other"].includes(input.method))
      fail("Select a payment method.");
    const date = field(input.payment_date, "payment date", 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      date > now().slice(0, 10)
    )
      fail("Enter a valid payment date.");
    await tx.run(
      "INSERT INTO w_payments (order_id,amount,method,reference,payment_date,verified_by,verified_at,notes) VALUES (?,?,?,?,?,?,?,?)",
      [
        id,
        amount,
        input.method,
        field(input.reference, "payment reference"),
        date,
        actor,
        now(),
        String(input.notes || "").slice(0, 2000),
      ],
    );
    await tx.run(
      "UPDATE w_orders SET paid=1,status='Payment Confirmed' WHERE id=?",
      [id],
    );
    await history(
      tx,
      id,
      actor,
      "Payment independently verified; Payment Confirmed",
    );
    await audit(tx, actor, `Payment verified for ${o.reference}`);
  });
}
module.exports = {
  now,
  fail,
  integer,
  money,
  field,
  hash,
  verify,
  priceFor,
  cart,
  history,
  audit,
  submit,
  transitions,
  transition,
  confirmPayment,
};
