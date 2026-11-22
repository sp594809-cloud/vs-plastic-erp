# VS Plastic — Smart Khata & Collections

Open **Wholesale ERP → Admin → Smart Khata & Collections** or sign in at `/khata`. A salesperson, manager or accountant is redirected to Khata after signing in.

## Shop counter

1. Find the customer's mobile or shop name. An owner can also create a walk-in account. Existing wholesale and Khata operations share the same customer ID.
2. The owner sets a credit limit under **Credit policy & messaging consent**. The initial limit is zero. A sale exceeding the limit or overdue-day rule creates a pending request and leaves the balance unchanged.
3. Record ₹2,000 using **Quick credit sale**. For stock-managed sales select products under **Detailed product sale**. This uses wholesale prices, pack constraints and tax rates and records stock movement on approval. Attach the actual invoice reference. The module does not issue statutory GST invoices.
4. Receive ₹800, optionally choose specific open sales, and print the receipt. The account shows ₹1,200 outstanding. Receive the final ₹1,200 to settle it. An excess payment creates an advance.
5. Open the collection queue to call, message, record an outcome or capture a payment promise. A dial or WhatsApp link never records a successful contact.
6. The owner can create dedicated employee logins from the dashboard and assign accounts in each customer's policy. Managers approve another operator's requests only within their configured exception cap.

## Implementation

| Area | Implementation |
| --- | --- |
| Integration | Existing Express/EJS, authenticated sessions, CSRF, TiDB adapter, catalogue, inventory and PWA. Server-side role and customer scope protect the Khata routes. No Supabase services or second customer database. |
| Ledger | Integer paise, database transactions, customer-row locks on TiDB, unique request keys and payment references, immutable entries and linked corrections. Per-sale allocations can be selected manually. Remaining payments use transaction-date order. |
| Credit | Per-customer limits, payment terms, overdue blocking, review history, manager caps, configurable aging thresholds. Risk colour uses oldest open overdue age. History also shows actual repayment statistics. |
| Collections | Current exposure, seven aging buckets, period totals, due promises, prioritized calls, payment promises, contact notes, disputes, extensions, manual WhatsApp and receipts. |
| Reports | Date-range movements and as-of balances per customer with city, category and staff filters. CSV, Excel-compatible SpreadsheetML and browser print/save-to-PDF. |
| Languages | The dashboard, ledger and common counter controls have Gujarati and Hindi labels. Some controls, reasons and report labels are English. |
| Messaging | Private scheduled worker, consent, reviewed template configuration, live open amount before dispatch, duplicate suppression, capped rate-limit retries, provider acceptance, signed status webhooks and STOP opt-outs. |
| Tests | SQLite financial/permission tests in tests/khata.test.js; EJS rendering checks and a Chromium desktop/mobile workflow. Demo customer is opt-in, has no consent and uses invalid contact details. |

## Migration and staging

The existing startup migrator applies additive tables from `wholesale/schema.sql`. Run a single migration process on a staging copy first. Tables are `k_policy`, `k_preferences`, `k_entries`, `k_targets`, `k_items`, `k_requests`, `k_contacts`, `k_extensions`, `k_deliveries` `k_profiles` and `k_delivery_events`. Customer, employee, product, inventory movement and audit IDs belong to the existing ERP. Take and restore-test a TiDB backup before rollout. Roll back the app version while retaining posted records.

Use Node 24. From `.gemini/antigravity/scratch/vs-plastic-erp` run `npm ci`, `npm test`, then `npm start`. Render build/start commands remain `npm ci` and `npm start`, health check `/health`. Local SQLite uses the existing development setup. Use the optional `tests/khata-demo.sql` only on an expendable local database.

| Variable | Purpose |
| --- | --- |
| NODE_ENV, SESSION_SECRET, PUBLIC_URL, TRUST_PROXY | Existing secure production session and deployment settings. |
| DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME | Existing TiDB credentials with TLS verification. |
| ADMIN_EMAIL, ADMIN_PASSWORD | Existing first-admin bootstrap only. |
| WA_GRAPH_VERSION, WA_PHONE_ID, WA_TOKEN | Supported Graph version, business number ID and server-side access token. |
| WA_APPROVED_TEMPLATE, WA_LANGUAGE | Exact approved utility template name and matching language code. The three body variables, in order, are shop name, outstanding invoice amount in INR and due date. |
| WA_APP_SECRET, WA_VERIFY_TOKEN | Webhook signature verification and subscription challenge verification. |
| KHATA_REMINDER_DAYS | Optional comma-separated signed offsets from due date. Defaults to -3,0,3,7,14,30. |

Set up the Meta callback at `/integrations/khata/whatsapp` and subscribe the configured business phone to message events. Test with a consenting internal recipient. Create a private cron job using `npm run khata:reminders` in the same app directory at 04:00 UTC (09:30 IST) daily. Test provider rate limiting, opt-out, delivered/read callbacks and production TiDB contention before enabling it for customers. Monitor cron failures and unknown/sending outcomes; an ambiguous network response is intentionally held for operator reconciliation. Protect DB backups and restrict direct DB writes to trusted operators. Configure the same approved template name in each supported customer language.

## Release boundaries

- Khata tracks entries posted here. Historical storefront orders and bank-verified order payments do not automatically become Khata receivables. Do not enter the same sale or receipt twice across workflows. Historical opening balances need reconciliation before rollout.
- Financial reversals do not automatically restock returned goods. Use the existing inventory adjustment screen after physical verification. Money transfers and refunds happen externally. Receipts acknowledge entries made by staff.
- The role boundary is implemented on the Express server. Privileged direct SQL access can alter financial records. Independent tamper-evident storage, backup monitoring and restore verification require deployment setup.
- The worker currently selects the customer’s preferred template language, falling back to WA_LANGUAGE. There is a short interval between committing the send reservation and the provider's acceptance. A payment made during that interval can cross an already-dispatched message.
- Promise matching is chronological and based on posted payments since the promise; overlapping promises are superseded. General-ledger export of owner-approved write-offs, dedicated recovery trend dashboards, full translation, statutory invoicing and automated bank reconciliation need additional implementation.
- Local verification covered isolated SQLite behavior and EJS rendering. Browser tests run via the PR workflow where Chromium is available. Live TiDB, physical device installation, provider credentials and real message delivery need staging verification.
