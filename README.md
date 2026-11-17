# TrueBatch Injectables

An electronic batch record for sterile injectables, from dispensing to QA release of filled, closed and inspected
units, on the Medhanta platform. All injectable types (liquid vials and ampoules, freeze-dried vials, prefilled
syringes and cartridges, bags and bottles, powders, emulsions, suspensions, liposomes, dual-chamber) and both ways of
making them sterile (terminal sterilisation after filling; sterile filtration and aseptic filling; or both).

It is built the TrueBatch Tablets way and starts from a copy of TrueBatch Tablets (its engine, templates, master
format, server, screens and tests), changed only where injections need it (owner, 16 November 2026). One app, plain
SQL, a small set of rules checked once in the app.

- Design decisions: `docs/design.md`
- The 30 TrueBatch Injectables rules (the 29 of the minimum register and TI-32, only trained people sign) and their tests: `docs/rules.md`
- The calculation templates: `shared/templates/README.md`

## Status (phase E)
Built: the copy of TrueBatch Tablets renamed and without Packing (phase C); the six approved engine changes and the
clean-air limits table (phase D: liquid header, event log, results that come later, number of readings set by the
master, time limits from step X to step Y, an item expiring during a step); the injectables library v1 (phase E):
units, templates I18-I22 and the setting changes of the reused ones, the 11 reused and the sterile blocks as data, the
library's master calculation checks, and the 29 rules with their tests (`docs/rules.md`). The tablet steps are gone
from the product (the engine tests keep five of them as test-only fixtures, `test/test-blocks.ts`). Next: the screens
(phase F: the filling screen, the designer by type and route), links and the platform release (G), the end-to-end runs
on the demo (H).

## TrueBatch Injectables Packing
Labelling and packing the filled, inspected units of a released TrueBatch Injectables batch is a separate product on
the platform (owner, 17 November 2026), built from this repository on the same engine and screens, as TrueBatch Tablets
Packing is for tablets: `docs/packing-design.md`, its rules TI-P1 to TI-P9 in `docs/rules.md`. Its own parts are in
`packing/` (entry points, migrations, the views it publishes) and `ops/packing.*`.

```sh
export DATABASE_URL=postgres://truebatch_injectables_owner:dev@localhost:5432/truebatch_injectables_packing_dev DB_APP_ROLE=truebatch_injectables_packing_app
export TRUEBATCH_INJECTABLES_DATABASE_URL=postgres://...   # optional: TrueBatch Injectables' published views (released batches)
npm run migrate:packing
npm run dev:packing        # API on :3001
npm run dev:packing-web    # UI on :5174 (proxies /api)
```

On the platform the packing product reads its own database from `TRUEBATCH_INJECTABLES_PACKING_DATABASE_URL`, runs as
`truebatch_injectables_packing_app`, and is declared in `ops/packing.manifest.draft.json`.

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
node dist/packing/server/demo-skip.js TIP260001 [stage] --as <username>   # TrueBatch Injectables Packing (truebatch_injectables_packing.demo.skip)
```

Each skip is an insert-only step event `demo_wait_skipped` with who, when and which wait, shown in the step history,
QA's review and the batch record PDF as "DEMO: wait skipped by … at …"; the engine counts that wait as satisfied,
nothing else changes. Without `TRUEBATCH_DEMO=1` the button is absent, the route answers 403 and the command exits
non-zero.

## Conventions
- One app: `server/` (Fastify), `web/` (React), `db/migrations/` (plain SQL), `shared/` (engine, templates, blocks,
  master format), `test/`, `e2e/` (browser tests), `ops/`, `docs/`, and `packing/` for TrueBatch Injectables
  Packing's own entry points and migrations.
- A test that proves a rule starts its name with the rule ID: `TI-xx` for TrueBatch Injectables rules, `TI-Px` for
  the packing rules, `PL-xx` for platform rules.
- Paraphrase regulations; never paste more than a short phrase.
- Work on a branch, CI green, one review pass, then merge.
