# VS Curtain Accessories — B2B wholesale platform

This replaces the previous ERP web entry point with a wholesale storefront and operations dashboard. **It keeps the existing TiDB database connection settings** and uses new `w_` tables. Existing ERP tables, invoices, products and customer records are not migrated, deleted or overwritten. The previous application is available in Git history at commit `861ca71`.

## Stack decision

The existing repository is Express/EJS + TiDB. This implementation deliberately retains that connection and stack instead of introducing Next.js/Supabase and requiring a second database. Authentication uses server-side sessions and scrypt-hashed passwords; authorization is enforced by server routes, with no public database API. Supabase Auth/RLS are not used.

## Run locally

Requires Node **22.13+** (Node 24 recommended). Local development uses Node's built-in SQLite, in `db/wholesale-dev.db`.

```sh
npm ci
cp .env.example .env
# Set ADMIN_EMAIL, ADMIN_PASSWORD and SESSION_SECRET in .env
npm start
```

Open http://localhost:3001. Sign in with your configured admin email/password; there are no default production credentials. `npm test` runs isolated in-memory database tests and does not access live TiDB.

## Deploy on the existing Render service

Keep the existing service's database environment variables. Use this repository directory as the Render **Root Directory**:

```
.gemini/antigravity/scratch/vs-plastic-erp
```

Build: `npm ci` · Start: `npm start` · Health check: `/health`.

Set:

| Variable                                                  | Purpose                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                     | Enables secure cookies and requires TiDB                                                                                |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Existing TiDB connection; unchanged. TIDB_HOST/TIDB_PORT/TIDB_USER/TIDB_PASSWORD/TIDB_DATABASE aliases also work        |
| `SESSION_SECRET`                                          | At least 32 random characters; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_EMAIL`                                             | Your first wholesale administrator's email                                                                              |
| `ADMIN_PASSWORD`                                          | Unique password, 12–128 characters; required only for the first bootstrap                                               |
| `PUBLIC_URL`                                              | Canonical HTTPS origin, such as your existing Render URL                                                                |
| `TRUST_PROXY=1`                                           | Only when deployed behind one trusted reverse proxy, as on Render                                                       |

The new account system does not reuse old plaintext ERP logins. After the first administrator exists, remove `ADMIN_PASSWORD` from the hosting environment. Change the password through My account when needed.

Startup applies the additive schema in `wholesale/schema.sql`. `w_migrations` tracks initial category/product/settings seeds. Only the 12 named catalogue products are seeded: no invented prices, positive stock, credentials, testimonials or customer data. Run only one initial migration process; take a normal database backup before the first production rollout. TLS certificate verification is mandatory for TiDB.

### First-run checklist

1. Sign in as admin and open Settings. Enter real phone, WhatsApp (country code + number), email, business address, policies and official payment instructions.
2. Edit the 12 initial products: real prices, tax, units, minimum quantities, increment, specifications and photographs. Archive unused entries. Variants are separate sellable SKUs.
3. Use Inventory to record real opening stock with a reason. The initial zero stock is an unconfigured opening balance, not a stock claim.
4. Register a test buyer, approve it, then verify the entire order flow in staging before accepting customer orders.
5. Review policies and payment instructions for the actual business. Configure a public URL for canonical tags and sitemap.

## Working features

- Responsive server-rendered public catalogue, category browsing, product URLs, keyword/category/availability search and sorting.
- Business registration, pending approval, rejection/suspension, tier assignment, profile/address management and password changes.
- Approved-only prices, base/tier/customer/quantity pricing, server-side quantity validation, minimum order value and durable carts.
- Order requests without payment, immutable product/price snapshots, saved products and reorder at current pricing/MOQs.
- Admin customer, product, category, pricing tier, pricing rule and inventory controls. Raster photograph uploads (PNG/JPEG/WebP, maximum 2 MB) persist in TiDB; HTTPS image links are also supported.
- Quotation review, manual bank-verified payment, customer references that never mark payment confirmed, history, tracking and WhatsApp click-to-chat.
- Transactional reservation at Awaiting Payment; atomic stock checks; deduction at dispatch; release on cancellation before dispatch. Refund status requires actual refund outside the application; inventory is not automatically restocked after dispatch.
- Admin overview, monthly confirmed sales, sales by city/state, average paid order, repeat buyer rate and CSV exports.
- CSRF checks, role/ownership enforcement, database-backed expiring sessions, secure production cookies, hashed passwords, login/register rate limits, security headers and safe CSV escaping.
- Installable manifest and static-only service worker that clears old ERP caches. Private pages are never service-worker cached.

### Workflow

Request Received → Under Review → Awaiting Customer Confirmation → Awaiting Payment → Payment Verification Pending → Payment Confirmed → Processing → Dispatched → Delivered → Completed.

Admin may verify a payment directly from Awaiting Payment. Payment Confirmation cannot be set by the generic status selector. The customer confirmation stage is recorded by the administrator after contacting the buyer. Cancellation/rejection/refund transitions are restricted according to the current stage.

Money is stored as integer paise. Tax rates are integer basis points. Pricing precedence: customer rule, tier rule, general quantity rule, base price; highest eligible quantity threshold within each group. Remove an old rule before replacing one with the same scope/threshold.

## Boundaries and remaining work

This implements the core wholesale ordering workflow, **not every optional feature in the original 34-page specification**:

- No Supabase/Next.js migration, email verification, automated email/password-reset delivery, SMS OTP, gateway or automated WhatsApp messages. Account recovery currently requires administrator support; there is no insecure reset shortcut.
- Single warehouse and complete-order dispatch; split/partial fulfilment and multiple parcel tracking are not implemented.
- One photograph per SKU; no gallery, brand-logo upload, advanced variant matrix or product-image cropping.
- Categories and tiers can be added; renaming existing categories/tiers is not currently exposed.
- No historical ERP import; wholesale operations are separate from the old manufacturing ERP.
- No GST invoices, gross-profit reporting, top-product ranking, daily/weekly cohort dashboards or online refunds. Sales analytics use order creation dates and include tax/shipping; they are not net profit.
- Rate limiting is per running instance. Use a shared edge rate limiter before scaling to multiple instances.
- All initial migration statements are idempotent; follow-on schema evolution needs a new versioned migration rather than editing applied table definitions.

## Verification

Automated HTTP/database tests cover registration, approval, price privacy, durable cart, price tampering, order snapshots, duplicate empty-cart submission, cross-customer isolation, CSRF, admin restrictions, quotation/payment workflow, re-reservation prevention, tracking-gated dispatch, stock rollback, reorder, product creation and page rendering.

Tests use SQLite. **Live TiDB integration, actual bank payments, courier behaviour and real Android/iPhone/PWA installation are not verified by those tests.** Test these on a staging deployment using the existing hosting credentials before releasing publicly. No live database migrations or customer communications are performed by the coding workflow.
