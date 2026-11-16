# TrueBatch Injectables

An electronic batch record for sterile injectables, from dispensing to QA release of filled, closed and inspected
units, on the Medhanta platform. All injectable types (liquid vials and ampoules, freeze-dried vials, prefilled
syringes and cartridges, bags and bottles, powders, emulsions, suspensions, liposomes, dual-chamber) and both ways of
making them sterile (terminal sterilisation after filling; sterile filtration and aseptic filling; or both).

It is built the TrueBatch Tablets way and starts from a copy of TrueBatch Tablets (its engine, templates, master
format, server, screens and tests), changed only where injections need it (owner, 16 November 2026). One app, plain
SQL, a small set of rules checked once in the app.

- Design decisions: `docs/design.md`
- The 29 TrueBatch Injectables rules and their tests: `docs/rules.md`
- The calculation templates: `shared/templates/README.md`

## Status (phase C)
The copy of TrueBatch Tablets, renamed (product `truebatch_injectables`, batch numbers `TI`, permissions
`truebatch_injectables.*`, rules `TI-xx`), with TrueBatch Tablets Packing removed. Everything the copy brings works:
sign-on through core, permissions, audit trail, e-signatures, master-data reads, the master designer and its checks,
the batch engine, shop floor, QC and QA release, the batch record PDF, links to Deviations, QMS, Logbook and MMS with
hand entry when a link is down, the demo skip. Still from tablets until the next phases: the tablet header and
formula (mg per tablet), the tablet blocks and process skeletons. Next: the six approved engine changes (liquid
header, event log beside filling, results that come days later, number of readings set by the master, time limits
from step X to step Y, an item expiring during a step) and the clean-air limits table; then the sterile templates and
blocks from the final library.

## Develop
Needs Node 22 and PostgreSQL 17.

```sh
npm install
export DATABASE_URL=postgres://truebatch_injectables_owner:dev@localhost:5432/truebatch_injectables_dev DB_APP_ROLE=truebatch_injectables_app
# Medhanta core: people, sign-in, permissions and master data are managed there
export MASTER_DATA_DATABASE_URL=postgres://truebatch_injectables_app:...@<core db>:5432/master_data   # read through its report views
# Optional links, each set by the platform only while the link is on:
# DEVIATIONS_DATABASE_URL, QMS_DATABASE_URL, LOGBOOK_DATABASE_URL, MMS_DATABASE_URL
export OIDC_ISSUER=https://<core domain>/oidc OIDC_CLIENT_SECRET=... OIDC_REDIRECT_URI=http://localhost:3000/cb
npm run migrate
npm run dev        # API on :3000
npm run dev:web    # UI on :5173 (proxies /api)
npm run ci         # typecheck, tests, build, rule-to-test check — run before pushing
npm run test:e2e   # browser tests (Playwright; once: npx playwright install chromium)
```

Tests use `TEST_DATABASE_URL` (default
`postgres://truebatch_injectables_owner:dev@localhost:5432/truebatch_injectables_test`); each test file gets its own
schema. The test login must be able to create roles and databases (the platform test makes its own).

## On the platform
`ops/manifest.draft.json` is the draft of the product's platform manifest (permissions, back-channel logout, the views
it reads from master data and the linked products, and the views it publishes). On the platform the app reads its
database from `TRUEBATCH_INJECTABLES_DATABASE_URL` and runs as the restricted login `truebatch_injectables_app`, which
cannot change or delete audit rows or signatures. Migrations run as the database owner.

## Demo installations
The platform sets `TRUEBATCH_DEMO=1` only for the demo customer's installation, never for a plant's
(`server/demo.ts`). Then every screen shows a DEMO banner, and a person with `truebatch_injectables.demo.skip` sees
"Skip wait (demo)" on a step that waits (a minimum time, the next periodic check, a hold time running, a mixing time
below its lower limit), which ends that wait at once. From a terminal in the product's container:

```sh
node dist/server/demo-skip.js TI260004 [stage] --as <username>
```

Each skip is an insert-only step event `demo_wait_skipped` with who, when and which wait, shown in the step history,
QA's review and the batch record PDF as "DEMO: wait skipped by … at …"; the engine counts that wait as satisfied,
nothing else changes. Without `TRUEBATCH_DEMO=1` the button is absent, the route answers 403 and the command exits
non-zero.

## Conventions
- One app: `server/` (Fastify), `web/` (React), `db/migrations/` (plain SQL), `shared/` (engine, templates, blocks,
  master format), `test/`, `e2e/` (browser tests), `ops/`, `docs/`.
- A test that proves a rule starts its name with the rule ID: `TI-xx` for TrueBatch Injectables rules, `PL-xx` for
  platform rules.
- Paraphrase regulations; never paste more than a short phrase.
- Work on a branch, CI green, one review pass, then merge.
