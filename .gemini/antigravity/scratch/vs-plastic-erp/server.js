const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const express = require("express"),
  crypto = require("node:crypto");
const db = require("./wholesale/database"),
  d = require("./wholesale/domain");
const app = express();
const production = process.env.NODE_ENV === "production";
const secret =
  process.env.SESSION_SECRET ||
  (!production && crypto.randomBytes(32).toString("hex"));
if (!secret || secret.length < 32)
  throw new Error(
    "Set SESSION_SECRET to a random secret of at least 32 characters.",
  );
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views", "wholesale"));
app.use(
  "/admin/products/:id/image",
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: "2mb",
  }),
);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  });
  if (production) res.set("Strict-Transport-Security", "max-age=31536000");
  next();
});
app.use(
  "/wholesale",
  express.static(path.join(__dirname, "public", "wholesale")),
);
app.get("/service-worker.js", (req, res) =>
  res
    .set("Cache-Control", "no-cache")
    .sendFile(path.join(__dirname, "public", "service-worker.js")),
);
app.get("/manifest.json", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "manifest.json")),
);
app.get("/health", (req, res) => res.json({ status: "ok" }));
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
function cookie(req, name) {
  const value = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="));
  return value?.slice(name.length + 1);
}
const digest = (x) => crypto.createHash("sha256").update(x).digest("hex");
const sign = (x) => crypto.createHmac("sha256", secret).update(x).digest("hex");
const opts = { httpOnly: true, secure: production, sameSite: "lax", path: "/" };
const fmt = (n) =>
  n === null || n === undefined
    ? "To be confirmed"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
      }).format(n / 100);
app.use(
  wrap(async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const token = cookie(req, "vs_session");
    req.user = null;
    if (token && /^[a-f0-9]{64}$/.test(token))
      req.user = await db.one(
        "SELECT u.* FROM w_sessions s JOIN w_users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?",
        [digest(token), Date.now()],
      );
    if (req.user && req.user.status === "suspended") req.user = null;
    let csrf = cookie(req, "vs_csrf");
    if (
      !csrf ||
      !/^([a-f0-9]{48})\.([a-f0-9]{64})$/.test(csrf) ||
      sign(csrf.split(".")[0]) !== csrf.split(".")[1]
    ) {
      const value = crypto.randomBytes(24).toString("hex");
      csrf = value + "." + sign(value);
      res.cookie("vs_csrf", csrf, opts);
    }
    if (
      req.method === "POST" &&
      (req.body?.csrf || req.get("X-CSRF-Token")) !== csrf
    )
      d.fail("Your form expired. Reload the page and try again.", 403);
    req.settings = JSON.parse(
      (await db.one("SELECT data FROM w_settings WHERE id=1")).data,
    );
    res.locals = {
      ...res.locals,
      user: req.user,
      settings: req.settings,
      csrf,
      fmt,
      path: req.path,
      title: "Wholesale curtain accessories",
      message: req.query.notice || "",
      error: "",
      categories: await db.all("SELECT * FROM w_categories ORDER BY id"),
      wa: (message) =>
        req.settings.whatsapp
          ? "https://wa.me/" +
            req.settings.whatsapp.replace(/\D/g, "") +
            "?text=" +
            encodeURIComponent(message)
          : "/contact",
    };
    next();
  }),
);
const login = (req, res, next) => (req.user ? next() : res.redirect("/login"));
const approved = (req, res, next) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.status !== "approved")
    return next(
      Object.assign(
        new Error(
          "Your business account is awaiting approval. Contact our team for assistance.",
        ),
        { status: 403 },
      ),
    );
  next();
};
const admin = (req, res, next) =>
  req.user?.role === "admin"
    ? next()
    : next(
        Object.assign(new Error("Administrator access required."), {
          status: 403,
        }),
      );
const redirect = (res, to, msg) =>
  res.redirect(to + "?notice=" + encodeURIComponent(msg));
const limits = new Map();
function rate(req, res, next) {
  const key = req.ip;
  const current = limits.get(key) || { count: 0, until: Date.now() + 900000 };
  if (Date.now() > current.until) {
    current.count = 0;
    current.until = Date.now() + 900000;
  }
  current.count++;
  limits.set(key, current);
  if (limits.size > 10000)
    for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
  if (current.count > 20)
    return next(
      Object.assign(new Error("Too many attempts. Try again in 15 minutes."), {
        status: 429,
      }),
    );
  next();
}
function business(body) {
  const b = {};
  for (const [key, max] of Object.entries({
    business: 160,
    contact: 100,
    phone: 20,
    business_type: 60,
    city: 100,
    state: 100,
    pincode: 6,
    address: 1500,
  }))
    b[key] = d.field(body[key], key.replaceAll("_", " "), max);
  if (!/^[6-9]\d{9}$/.test(b.phone))
    d.fail("Enter a valid 10-digit Indian mobile number.");
  if (!/^[1-9]\d{5}$/.test(b.pincode))
    d.fail("Enter a valid six-digit PIN code.");
  b.gstin = String(body.gstin || "")
    .trim()
    .toUpperCase();
  if (b.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(b.gstin))
    d.fail("Enter a valid GSTIN or leave it empty.");
  return b;
}
app.get(
  "/",
  wrap(async (req, res) =>
    res.render("home", {
      products: await db.all(
        "SELECT * FROM w_products WHERE active=1 AND featured=1 LIMIT 6",
      ),
    }),
  ),
);
app.get("/categories", (req, res) => res.render("categories"));
app.get(
  "/products",
  wrap(async (req, res) => {
    let sql =
        "SELECT p.*,c.name AS category FROM w_products p JOIN w_categories c ON c.id=p.category_id WHERE p.active=1",
      params = [];
    if (req.query.q) {
      sql +=
        " AND (p.name LIKE ? OR p.sku LIKE ? OR p.material LIKE ? OR p.variant LIKE ?)";
      params.push(
        ...Array(4).fill("%" + String(req.query.q).slice(0, 100) + "%"),
      );
    }
    if (req.query.category) {
      sql += " AND p.category_id=?";
      params.push(d.integer(req.query.category, 1));
    }
    if (req.query.available === "1") sql += " AND p.stock>p.reserved";
    sql += " ORDER BY p.name";
    let products = await db.all(sql, params);
    if (req.user?.status === "approved")
      for (const p of products)
        p.quoted = await d.priceFor(db, p, req.user, p.moq);
    if (req.query.sort === "price" && req.user?.status === "approved")
      products.sort((a, b) => (a.quoted ?? Infinity) - (b.quoted ?? Infinity));
    if (req.query.sort === "newest") products.sort((a, b) => b.id - a.id);
    res.render("products", { products, query: req.query });
  }),
);
app.get(
  "/products/:slug",
  wrap(async (req, res) => {
    const p = await db.one(
      "SELECT * FROM w_products WHERE slug=? AND active=1",
      [req.params.slug],
    );
    if (!p) d.fail("Product not found.", 404);
    if (req.user?.status === "approved")
      p.quoted = await d.priceFor(db, p, req.user, p.moq);
    res.render("product", { p, title: p.name });
  }),
);
app.get("/register", (req, res) => res.render("auth", { register: true }));
app.get("/login", (req, res) => res.render("auth", { register: false }));
app.post(
  "/register",
  rate,
  wrap(async (req, res) => {
    const b = business(req.body),
      email = d.field(req.body.email, "email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      d.fail("Enter a valid email address.");
    const password = await d.hash(req.body.password);
    if (await db.one("SELECT id FROM w_users WHERE email=?", [email]))
      d.fail(
        "Unable to register this email. Try signing in or contact support.",
      );
    await db.run(
      "INSERT INTO w_users (email,password,business,contact,phone,business_type,city,state,pincode,address,gstin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [email, password, ...Object.values(b), d.now()],
    );
    redirect(
      res,
      "/login",
      "Registration received. Sign in to check your approval status.",
    );
  }),
);
app.post(
  "/login",
  rate,
  wrap(async (req, res) => {
    const user = await db.one("SELECT * FROM w_users WHERE email=?", [
      String(req.body.email || "")
        .trim()
        .toLowerCase(),
    ]);
    if (
      !user ||
      !(await d.verify(req.body.password, user.password)) ||
      user.status === "suspended" ||
      user.status === "rejected"
    )
      d.fail("Invalid credentials or account unavailable.", 401);
    const token = crypto.randomBytes(32).toString("hex");
    await db.run("DELETE FROM w_sessions WHERE expires<?", [Date.now()]);
    await db.run("INSERT INTO w_sessions (id,user_id,expires) VALUES (?,?,?)", [
      digest(token),
      user.id,
      Date.now() + 86400000,
    ]);
    res.cookie("vs_session", token, { ...opts, maxAge: 86400000 });
    res.redirect(user.role === "admin" ? "/admin" : "/account");
  }),
);
app.post(
  "/logout",
  wrap(async (req, res) => {
    await db.run("DELETE FROM w_sessions WHERE id=?", [
      digest(cookie(req, "vs_session") || ""),
    ]);
    res.clearCookie("vs_session", opts);
    res.redirect("/");
  }),
);
app.get(
  "/account",
  login,
  wrap(async (req, res) =>
    res.render("account", {
      addresses: await db.all("SELECT * FROM w_addresses WHERE user_id=?", [
        req.user.id,
      ]),
    }),
  ),
);
app.post(
  "/account",
  login,
  wrap(async (req, res) => {
    const b = business(req.body);
    await db.run(
      "UPDATE w_users SET business=?,contact=?,phone=?,business_type=?,city=?,state=?,pincode=?,address=?,gstin=? WHERE id=?",
      [...Object.values(b), req.user.id],
    );
    redirect(res, "/account", "Business details updated.");
  }),
);
app.post(
  "/account/password",
  login,
  rate,
  wrap(async (req, res) => {
    if (!(await d.verify(req.body.current, req.user.password)))
      d.fail("Current password is incorrect.");
    const password = await d.hash(req.body.password);
    await db.transaction(async (tx) => {
      await tx.run("UPDATE w_users SET password=? WHERE id=?", [
        password,
        req.user.id,
      ]);
      await tx.run("DELETE FROM w_sessions WHERE user_id=?", [req.user.id]);
    });
    res.clearCookie("vs_session", opts);
    redirect(res, "/login", "Password changed. Please sign in again.");
  }),
);
app.post(
  "/addresses",
  login,
  wrap(async (req, res) => {
    await db.run(
      "INSERT INTO w_addresses (user_id,label,address) VALUES (?,?,?)",
      [
        req.user.id,
        d.field(req.body.label, "label", 100),
        d.field(req.body.address, "complete delivery address", 2000),
      ],
    );
    redirect(res, "/account", "Address saved.");
  }),
);
app.post(
  "/addresses/:id/delete",
  login,
  wrap(async (req, res) => {
    await db.run("DELETE FROM w_addresses WHERE id=? AND user_id=?", [
      d.integer(req.params.id, 1),
      req.user.id,
    ]);
    res.redirect("/account");
  }),
);
app.get(
  "/saved",
  login,
  wrap(async (req, res) =>
    res.render("products", {
      products: await db.all(
        "SELECT p.* FROM w_saved s JOIN w_products p ON p.id=s.product_id WHERE s.user_id=? AND p.active=1",
        [req.user.id],
      ),
      query: {},
      title: "Saved products",
    }),
  ),
);
app.post(
  "/saved/:id",
  login,
  wrap(async (req, res) => {
    const id = d.integer(req.params.id, 1);
    if (
      await db.one("SELECT * FROM w_saved WHERE user_id=? AND product_id=?", [
        req.user.id,
        id,
      ])
    )
      await db.run("DELETE FROM w_saved WHERE user_id=? AND product_id=?", [
        req.user.id,
        id,
      ]);
    else
      await db.run("INSERT INTO w_saved (user_id,product_id) VALUES (?,?)", [
        req.user.id,
        id,
      ]);
    redirect(res, "/saved", "Saved products updated.");
  }),
);
app.get(
  "/cart",
  approved,
  wrap(async (req, res) =>
    res.render("cart", {
      cart: await d.cart(db, req.user),
      addresses: await db.all("SELECT * FROM w_addresses WHERE user_id=?", [
        req.user.id,
      ]),
    }),
  ),
);
app.post(
  "/cart",
  approved,
  wrap(async (req, res) => {
    const id = d.integer(req.body.product_id, 1),
      qty = d.integer(req.body.qty, 0, 1000000);
    if (!qty) {
      await db.run("DELETE FROM w_cart WHERE user_id=? AND product_id=?", [
        req.user.id,
        id,
      ]);
      return res.redirect("/cart");
    }
    const p = await db.one("SELECT * FROM w_products WHERE id=? AND active=1", [
      id,
    ]);
    if (!p) d.fail("Product is no longer available.");
    if (qty < p.moq || (qty - p.moq) % p.step)
      d.fail(`Minimum quantity is ${p.moq}, with increments of ${p.step}.`);
    await db.transaction(async (tx) => {
      await tx.run("DELETE FROM w_cart WHERE user_id=? AND product_id=?", [
        req.user.id,
        id,
      ]);
      await tx.run(
        "INSERT INTO w_cart (user_id,product_id,qty) VALUES (?,?,?)",
        [req.user.id, id, qty],
      );
    });
    res.redirect("/cart");
  }),
);
app.post(
  "/orders",
  approved,
  wrap(async (req, res) => {
    const id = await d.submit(
      db,
      req.user,
      d.field(req.body.address, "delivery address", 2000),
      req.settings.minimum || 0,
    );
    redirect(
      res,
      "/orders/" + id,
      "Your wholesale order request has been received. Our team will contact you to confirm availability, shipping and payment details.",
    );
  }),
);
app.get(
  "/orders",
  login,
  wrap(async (req, res) =>
    res.render("orders", {
      orders: await db.all(
        "SELECT * FROM w_orders WHERE user_id=? ORDER BY id DESC",
        [req.user.id],
      ),
      adminView: false,
    }),
  ),
);
async function orderData(req) {
  const id = d.integer(req.params.id, 1);
  const o = await db.one(
    "SELECT o.*,u.business,u.contact,u.phone,u.email FROM w_orders o JOIN w_users u ON u.id=o.user_id WHERE o.id=?",
    [id],
  );
  if (!o || (req.user.role !== "admin" && o.user_id !== req.user.id))
    d.fail("Order not found.", 404);
  return {
    o,
    items: await db.all("SELECT * FROM w_order_items WHERE order_id=?", [id]),
    history: await db.all(
      "SELECT * FROM w_history WHERE order_id=? ORDER BY id",
      [id],
    ),
    shipping: await db.one("SELECT * FROM w_shipping WHERE order_id=?", [id]),
    payments: await db.all("SELECT * FROM w_payments WHERE order_id=?", [id]),
    transitions: d.transitions[o.status] || [],
  };
}
app.get(
  "/orders/:id",
  login,
  wrap(async (req, res) => res.render("order", await orderData(req))),
);
app.post(
  "/orders/:id/reorder",
  approved,
  wrap(async (req, res) => {
    const { items } = await orderData(req);
    let skipped = 0;
    await db.transaction(async (tx) => {
      for (const item of items) {
        const p = await tx.one(
          "SELECT * FROM w_products WHERE id=? AND active=1",
          [item.product_id],
        );
        if (!p) {
          skipped++;
          continue;
        }
        const qty =
          p.moq + Math.ceil(Math.max(0, item.qty - p.moq) / p.step) * p.step;
        await tx.run("DELETE FROM w_cart WHERE user_id=? AND product_id=?", [
          req.user.id,
          p.id,
        ]);
        await tx.run(
          "INSERT INTO w_cart (user_id,product_id,qty) VALUES (?,?,?)",
          [req.user.id, p.id, qty],
        );
      }
    });
    redirect(
      res,
      "/cart",
      `Products added using current quantities and pricing. ${skipped} archived products skipped. Review availability before submitting.`,
    );
  }),
);
app.post(
  "/orders/:id/payment-reference",
  approved,
  wrap(async (req, res) => {
    const { o } = await orderData(req);
    if (o.status !== "Awaiting Payment")
      d.fail("Payment is not currently requested.");
    await db.transaction(async (tx) => {
      const r = await tx.run(
        "UPDATE w_orders SET status='Payment Verification Pending' WHERE id=? AND status='Awaiting Payment'",
        [o.id],
      );
      if (!r.changes) d.fail("Order status changed. Reload and try again.");
      await d.history(
        tx,
        o.id,
        req.user.id,
        "Customer submitted reference (unverified): " +
          d.field(req.body.reference, "payment reference"),
      );
    });
    res.redirect("/orders/" + o.id);
  }),
);
app.get("/about", (req, res) =>
  res.render("info", {
    heading: "Built for the businesses behind beautiful spaces.",
    body: "We are an Ahmedabad-based wholesale curtain accessories business serving showrooms, tailors, decorators and dealers. Browse our range, request a quotation and speak directly with our team before payment. We confirm product specifications, stock and transport for every order.",
  }),
);
app.get("/contact", (req, res) =>
  res.render("info", {
    heading: "Let’s talk about your next order.",
    body: "Contact our team for product specifications, bulk requirements and order support. Business contact details appear below when configured.",
  }),
);
app.get("/policies/:type", (req, res) => {
  if (!["privacy", "terms", "shipping", "returns"].includes(req.params.type))
    return res
      .status(404)
      .render("info", {
        heading: "Page not found",
        body: "Return to the catalogue.",
      });
  res.render("info", {
    heading:
      req.params.type[0].toUpperCase() + req.params.type.slice(1) + " policy",
    body: req.settings[req.params.type],
  });
});
app.use("/admin", admin);
app.get(
  "/admin",
  wrap(async (req, res) => {
    const orders = await db.all(
      "SELECT o.*,u.business,u.city,u.state FROM w_orders o JOIN w_users u ON u.id=o.user_id ORDER BY o.id DESC",
    );
    const customers = await db.all(
      "SELECT id,status FROM w_users WHERE role='customer'",
    );
    res.render("admin", {
      orders,
      customers,
      low: await db.all(
        "SELECT * FROM w_products WHERE active=1 AND stock-reserved<=threshold",
      ),
      audit: await db.all("SELECT * FROM w_audit ORDER BY id DESC LIMIT 20"),
    });
  }),
);
app.get(
  "/admin/orders",
  wrap(async (req, res) => {
    let orders = await db.all(
      "SELECT o.*,u.business FROM w_orders o JOIN w_users u ON u.id=o.user_id ORDER BY o.id DESC",
    );
    if (req.query.status)
      orders = orders.filter((o) => o.status === req.query.status);
    res.render("orders", { orders, adminView: true });
  }),
);
app.post(
  "/admin/orders/:id/status",
  wrap(async (req, res) => {
    await d.transition(
      db,
      d.integer(req.params.id, 1),
      req.user.id,
      req.body.status,
    );
    res.redirect("/orders/" + req.params.id);
  }),
);
app.post(
  "/admin/orders/:id/quote",
  wrap(async (req, res) => {
    const id = d.integer(req.params.id, 1);
    await db.transaction(async (tx) => {
      const o = await tx.one("SELECT * FROM w_orders WHERE id=?" + db.lock, [
        id,
      ]);
      if (
        !o ||
        !["Under Review", "Awaiting Customer Confirmation"].includes(o.status)
      )
        d.fail(
          "Quotation can only be edited during review or customer confirmation.",
        );
      const subtotal = d.money(req.body.subtotal),
        tax = d.money(req.body.tax),
        shipping = d.money(req.body.shipping),
        discount = d.money(req.body.discount),
        total = subtotal + tax + shipping - discount;
      if (total <= 0) d.fail("Final payable amount must be positive.");
      await tx.run(
        "UPDATE w_orders SET subtotal=?,tax=?,shipping=?,discount=?,total=?,notes=? WHERE id=?",
        [
          subtotal,
          tax,
          shipping,
          discount,
          total,
          String(req.body.notes || "").slice(0, 2000),
          id,
        ],
      );
      await d.history(
        tx,
        id,
        req.user.id,
        `Final quotation updated: ${fmt(total)}. ${String(req.body.notes || "").slice(0, 1000)}`,
      );
      await d.audit(tx, req.user.id, `Quotation updated: ${o.reference}`);
    });
    res.redirect("/orders/" + id);
  }),
);
app.post(
  "/admin/orders/:id/payment",
  wrap(async (req, res) => {
    await d.confirmPayment(
      db,
      d.integer(req.params.id, 1),
      req.user.id,
      req.body,
    );
    res.redirect("/orders/" + req.params.id);
  }),
);
app.post(
  "/admin/orders/:id/shipping",
  wrap(async (req, res) => {
    const id = d.integer(req.params.id, 1),
      link = String(req.body.link || "").trim();
    if (link && !/^https:\/\//.test(link))
      d.fail("Tracking URL must use https.");
    await db.transaction(async (tx) => {
      const o = await tx.one("SELECT * FROM w_orders WHERE id=?" + db.lock, [
        id,
      ]);
      if (!o || !o.paid || ["Refunded", "Cancelled"].includes(o.status))
        d.fail("Verified payment is required before arranging shipment.");
      const old = await tx.one("SELECT * FROM w_shipping WHERE order_id=?", [
        id,
      ]);
      await tx.run("DELETE FROM w_shipping WHERE order_id=?", [id]);
      await tx.run(
        "INSERT INTO w_shipping (order_id,courier,tracking,link,dispatched_at,estimated_date) VALUES (?,?,?,?,?,?)",
        [
          id,
          d.field(req.body.courier, "courier", 100),
          d.field(req.body.tracking, "tracking number"),
          link,
          old?.dispatched_at || null,
          String(req.body.estimated_date || "").slice(0, 10),
        ],
      );
      await d.history(tx, id, req.user.id, "Shipping information updated");
    });
    res.redirect("/orders/" + id);
  }),
);
app.get(
  "/admin/customers",
  wrap(async (req, res) => {
    let customers = await db.all(
      "SELECT u.*,t.name AS tier FROM w_users u LEFT JOIN w_tiers t ON t.id=u.tier_id WHERE u.role='customer' ORDER BY u.id DESC",
    );
    const q = String(req.query.q || "").toLowerCase();
    if (q)
      customers = customers.filter((u) =>
        [u.business, u.city, u.state, u.business_type, u.email].some((v) =>
          v.toLowerCase().includes(q),
        ),
      );
    if (req.query.status)
      customers = customers.filter((u) => u.status === req.query.status);
    res.render("customers", {
      customers,
      tiers: await db.all("SELECT * FROM w_tiers"),
      query: req.query,
    });
  }),
);
app.post(
  "/admin/customers/:id",
  wrap(async (req, res) => {
    const id = d.integer(req.params.id, 1);
    if (
      !["approved", "pending", "rejected", "suspended"].includes(
        req.body.status,
      )
    )
      d.fail("Invalid customer status.");
    await db.transaction(async (tx) => {
      const target = await tx.one(
        "SELECT id FROM w_users WHERE id=? AND role='customer'",
        [id],
      );
      if (!target) d.fail("Customer not found.", 404);
      await tx.run(
        "UPDATE w_users SET status=?,tier_id=?,notes=? WHERE id=? AND role='customer'",
        [
          req.body.status,
          d.integer(req.body.tier_id, 1),
          String(req.body.notes || "").slice(0, 2000),
          id,
        ],
      );
      if (req.body.status !== "approved")
        await tx.run("DELETE FROM w_sessions WHERE user_id=?", [id]);
      await d.audit(
        tx,
        req.user.id,
        `Customer ${id}: ${req.body.status}; tier ${req.body.tier_id}`,
      );
    });
    redirect(res, "/admin/customers", "Customer updated.");
  }),
);
app.post(
  "/admin/products/:id/image",
  wrap(async (req, res) => {
    const id = d.integer(req.params.id, 1),
      data = req.body,
      mime = req.get("Content-Type");
    if (!Buffer.isBuffer(data) || data.length < 12)
      d.fail("Choose a PNG, JPEG or WebP image up to 2 MB.");
    const valid =
      (mime === "image/png" &&
        data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mime === "image/jpeg" &&
        data[0] === 255 &&
        data[1] === 216 &&
        data[2] === 255) ||
      (mime === "image/webp" &&
        data.toString("ascii", 0, 4) === "RIFF" &&
        data.toString("ascii", 8, 12) === "WEBP");
    if (!valid) d.fail("The uploaded file does not match its image type.");
    await db.transaction(async (tx) => {
      if (!(await tx.one("SELECT id FROM w_products WHERE id=?", [id])))
        d.fail("Product not found.", 404);
      const image = await tx.run(
        "INSERT INTO w_images (mime,image_data) VALUES (?,?)",
        [mime, data.toString("base64")],
      );
      await tx.run("UPDATE w_products SET image=? WHERE id=?", [
        "/media/" + image.id,
        id,
      ]);
      await d.audit(tx, req.user.id, `Product ${id} image uploaded`);
    });
    res.json({ ok: true });
  }),
);
app.get(
  "/media/:id",
  wrap(async (req, res) => {
    const image = await db.one("SELECT * FROM w_images WHERE id=?", [
      d.integer(req.params.id, 1),
    ]);
    if (!image) d.fail("Image not found.", 404);
    res
      .set("Cache-Control", "public,max-age=86400")
      .type(image.mime)
      .send(Buffer.from(image.image_data, "base64"));
  }),
);
app.get(
  "/admin/products",
  wrap(async (req, res) =>
    res.render("manage-products", {
      products: await db.all("SELECT * FROM w_products ORDER BY id DESC"),
    }),
  ),
);
app.get(
  "/admin/products/new",
  wrap(async (req, res) =>
    res.render("product-form", {
      p: { moq: 1, step: 1, unit: "pieces", tax: 0, active: 1, featured: 1 },
      rules: [],
      tiers: await db.all("SELECT * FROM w_tiers"),
    }),
  ),
);
app.get(
  "/admin/products/:id",
  wrap(async (req, res) => {
    const p = await db.one("SELECT * FROM w_products WHERE id=?", [
      d.integer(req.params.id, 1),
    ]);
    if (!p) d.fail("Product not found.", 404);
    res.render("product-form", {
      p,
      rules: await db.all("SELECT * FROM w_prices WHERE product_id=?", [p.id]),
      tiers: await db.all("SELECT * FROM w_tiers"),
    });
  }),
);
app.post(
  "/admin/products",
  wrap(async (req, res) => {
    const b = req.body;
    const slug = d.field(b.slug, "product URL", 180);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      d.fail("Use lowercase letters, numbers and hyphens for the product URL.");
    const image = String(b.image || "").trim();
    if (image && !/^https:\/\//.test(image) && !/^\/media\/\d+$/.test(image))
      d.fail("Use an https product image URL.");
    if (!["pieces", "packets", "boxes", "rolls", "metres"].includes(b.unit))
      d.fail("Choose a supported unit.");
    const values = [
      d.field(b.name, "product name"),
      slug,
      d.field(b.sku, "SKU", 80),
      d.integer(b.category_id, 1),
      String(b.description || "").slice(0, 5000),
      b.unit,
      b.price === "" ? null : d.money(b.price),
      b.cost === "" ? null : d.money(b.cost),
      d.integer(b.moq, 1, 1000000),
      d.integer(b.step, 1, 1000000),
      d.integer(Math.round(Number(b.tax) * 100), 0, 10000),
      b.active === "1" ? 1 : 0,
      b.featured === "1" ? 1 : 0,
      image,
      String(b.variant || "").slice(0, 160),
      String(b.material || "").slice(0, 100),
    ];
    await db.transaction(async (tx) => {
      let id;
      if (b.id) {
        id = d.integer(b.id, 1);
        await tx.run(
          "UPDATE w_products SET name=?,slug=?,sku=?,category_id=?,description=?,unit=?,price=?,cost=?,moq=?,step=?,tax=?,active=?,featured=?,image=?,variant=?,material=? WHERE id=?",
          [...values, id],
        );
      } else {
        id = (
          await tx.run(
            "INSERT INTO w_products (name,slug,sku,category_id,description,unit,price,cost,moq,step,tax,active,featured,image,variant,material) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            values,
          )
        ).id;
      }
      await d.audit(tx, req.user.id, `Product ${id} saved`);
    });
    redirect(res, "/admin/products", "Product saved.");
  }),
);
app.post(
  "/admin/prices",
  wrap(async (req, res) => {
    const b = req.body;
    await db.transaction(async (tx) => {
      await tx.run(
        "INSERT INTO w_prices (product_id,tier_id,user_id,min_qty,price) VALUES (?,?,?,?,?)",
        [
          d.integer(b.product_id, 1),
          b.tier_id ? d.integer(b.tier_id, 1) : null,
          b.user_id ? d.integer(b.user_id, 1) : null,
          d.integer(b.min_qty, 1),
          d.money(b.price),
        ],
      );
      await d.audit(tx, req.user.id, "Pricing rule created");
    });
    res.redirect("/admin/products/" + d.integer(b.product_id, 1));
  }),
);
app.post(
  "/admin/prices/:id/delete",
  wrap(async (req, res) => {
    await db.transaction(async (tx) => {
      await tx.run("DELETE FROM w_prices WHERE id=?", [
        d.integer(req.params.id, 1),
      ]);
      await d.audit(tx, req.user.id, "Pricing rule removed");
    });
    res.redirect("/admin/products");
  }),
);
app.get(
  "/admin/inventory",
  wrap(async (req, res) =>
    res.render("inventory", {
      products: await db.all("SELECT * FROM w_products ORDER BY name"),
      movements: await db.all(
        "SELECT m.*,p.name FROM w_movements m JOIN w_products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 100",
      ),
    }),
  ),
);
app.post(
  "/admin/inventory",
  wrap(async (req, res) => {
    const id = d.integer(req.body.product_id, 1),
      delta = d.integer(req.body.delta, -1000000, 1000000),
      threshold = d.integer(req.body.threshold);
    await db.transaction(async (tx) => {
      const r = await tx.run(
        "UPDATE w_products SET stock=stock+?,threshold=? WHERE id=? AND stock+?>=reserved",
        [delta, threshold, id, delta],
      );
      if (!r.changes)
        d.fail("Adjustment would reduce stock below the reserved quantity.");
      await tx.run(
        "INSERT INTO w_movements (product_id,actor_id,delta,reason,created_at) VALUES (?,?,?,?,?)",
        [
          id,
          req.user.id,
          delta,
          d.field(req.body.reason, "adjustment reason", 1000),
          d.now(),
        ],
      );
      await d.audit(tx, req.user.id, `Inventory ${id}: ${delta}`);
    });
    redirect(res, "/admin/inventory", "Stock adjustment recorded.");
  }),
);
app.get(
  "/admin/settings",
  wrap(async (req, res) =>
    res.render("settings", { tiers: await db.all("SELECT * FROM w_tiers") }),
  ),
);
app.post(
  "/admin/settings",
  wrap(async (req, res) => {
    const s = { ...req.settings };
    for (const k of [
      "name",
      "phone",
      "whatsapp",
      "email",
      "address",
      "headline",
      "payment",
      "shipping",
      "returns",
      "privacy",
      "terms",
    ])
      s[k] = String(req.body[k] || "")
        .trim()
        .slice(0, 5000);
    if (!s.name) d.fail("Business name is required.");
    for (const k of ["phone", "whatsapp"])
      if (s[k] && !/^\+?\d{10,15}$/.test(s[k]))
        d.fail("Use country code and digits for contact numbers.");
    s.minimum = d.money(req.body.minimum);
    await db.transaction(async (tx) => {
      await tx.run("UPDATE w_settings SET data=? WHERE id=1", [
        JSON.stringify(s),
      ]);
      await d.audit(tx, req.user.id, "Business settings updated");
    });
    redirect(res, "/admin/settings", "Settings saved.");
  }),
);
app.post(
  "/admin/categories",
  wrap(async (req, res) => {
    await db.run("INSERT INTO w_categories (name) VALUES (?)", [
      d.field(req.body.name, "category", 100),
    ]);
    redirect(res, "/admin/settings", "Category created.");
  }),
);
app.post(
  "/admin/tiers",
  wrap(async (req, res) => {
    await db.run("INSERT INTO w_tiers (name) VALUES (?)", [
      d.field(req.body.name, "pricing tier", 80),
    ]);
    redirect(res, "/admin/settings", "Pricing tier created.");
  }),
);
function csv(rows) {
  const safe = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const keys = Object.keys(rows[0] || {});
  return [
    keys.map(safe).join(","),
    ...rows.map((r) => keys.map((k) => safe(r[k])).join(",")),
  ].join("\r\n");
}
app.get(
  "/admin/export/:type",
  wrap(async (req, res) => {
    let rows;
    if (req.params.type === "customers")
      rows = await db.all(
        "SELECT id,business,contact,email,phone,city,state,status FROM w_users WHERE role='customer'",
      );
    else if (req.params.type === "orders")
      rows = await db.all(
        "SELECT reference,status,subtotal,tax,shipping,discount,total,paid,created_at FROM w_orders ORDER BY id DESC",
      );
    else d.fail("Export not found.", 404);
    await d.audit(db, req.user.id, `Exported ${req.params.type}`);
    res
      .type("text/csv")
      .attachment(req.params.type + ".csv")
      .send(csv(rows));
  }),
);
app.get(
  "/admin/analytics",
  wrap(async (req, res) => {
    let orders = await db.all(
      "SELECT o.*,u.business,u.city,u.state FROM w_orders o JOIN w_users u ON u.id=o.user_id",
    );
    if (req.query.from)
      orders = orders.filter(
        (o) => o.created_at.slice(0, 10) >= req.query.from,
      );
    if (req.query.to)
      orders = orders.filter((o) => o.created_at.slice(0, 10) <= req.query.to);
    res.render("analytics", { orders, query: req.query });
  }),
);
app.get("/robots.txt", (req, res) =>
  res
    .type("text/plain")
    .send(
      "User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /orders\nDisallow: /cart\nDisallow: /saved\n" +
        (process.env.PUBLIC_URL
          ? "Sitemap: " +
            process.env.PUBLIC_URL.replace(/\/$/, "") +
            "/sitemap.xml"
          : ""),
    ),
);
app.get(
  "/sitemap.xml",
  wrap(async (req, res) => {
    if (!process.env.PUBLIC_URL)
      d.fail("Set PUBLIC_URL to enable the sitemap.", 503);
    const base = new URL(process.env.PUBLIC_URL).origin;
    const products = await db.all("SELECT slug FROM w_products WHERE active=1");
    res
      .type("application/xml")
      .send(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          [
            "",
            "/products",
            "/categories",
            "/about",
            "/contact",
            ...products.map((p) => "/products/" + p.slug),
          ]
            .map((p) => "<url><loc>" + base + p + "</loc></url>")
            .join("") +
          "</urlset>",
      );
  }),
);
app.use((req, res) =>
  res
    .status(404)
    .render("info", {
      heading: "Page not found",
      body: "This page may have moved. Explore our product catalogue to continue.",
    }),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const known = !!err.status;
  res.status(err.status || 500);
  if (!known) console.error("Request failed:", err.code || err.name);
  res.render("info", {
    heading: known
      ? "Please check your request"
      : "We couldn’t complete that request",
    body: known
      ? err.message
      : "Please try again. If the problem continues, contact our team.",
    settings: req.settings || { name: "VS Curtain Accessories" },
    categories: res.locals.categories || [],
    user: req.user || null,
    csrf: res.locals.csrf || "",
    message: "",
    fmt,
    wa: () => "/contact",
    path: req.path,
    title: "Request error",
  });
});
async function start() {
  await db.migrate();
  if (
    process.env.ADMIN_EMAIL &&
    process.env.ADMIN_PASSWORD &&
    !(await db.one("SELECT id FROM w_users WHERE role='admin'"))
  ) {
    const password = await d.hash(process.env.ADMIN_PASSWORD);
    await db.run(
      "INSERT INTO w_users (email,password,role,status,business,contact,phone,business_type,city,state,pincode,address,created_at) VALUES (?,?,'admin','approved',?,?,?,?,?,?,?,?,?)",
      [
        process.env.ADMIN_EMAIL.toLowerCase(),
        password,
        "VS Curtain Accessories",
        "Administrator",
        "",
        "Other",
        "Ahmedabad",
        "Gujarat",
        "380001",
        "Ahmedabad",
        d.now(),
      ],
    );
  }
  if (
    production &&
    !(await db.one("SELECT id FROM w_users WHERE role='admin'"))
  )
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first administrator.",
    );
  return app.listen(
    process.env.PORT ||
      (process.argv.includes("--port")
        ? Number(process.argv[process.argv.indexOf("--port") + 1])
        : 3001),
    () => console.log("Wholesale platform listening on configured port."),
  );
}
if (require.main === module)
  start().catch((e) => {
    console.error("Startup failed:", e.message);
    process.exit(1);
  });
module.exports = { app, start, db };
