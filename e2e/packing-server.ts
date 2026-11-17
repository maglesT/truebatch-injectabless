// Starts TrueBatch Injectables Packing with its built UI on a fresh schema of the test database, for its browser journey,
// with a stand-in for TrueBatch Injectables' batch_fact_v1 (one released batch of filled vials). Master data is an in-memory stand-in.
// The Logbook's equipment_status_v1 is stood in too, knowing line LL-01 only (dirty); its link is down (no grant) until
// the journey grants it for its pick-list check (e2e/packing.spec.ts).
import { connect } from '../server/db.js';
import { migrate } from '../db/migrate.js';
import { buildApp } from '../server/app.js';
import { links } from '../server/links.js';
import { PACKING_APP_ROLE, PACKING_PLAN } from '../packing/migrate.js';
import { PACKING } from '../packing/product.js';
import globalSetup from '../test/global-setup.js';
import { TEST_DATABASE_URL, TEST_PROOF_KEY, fakeMaster, fakeSignOn, seedUser } from '../test/helpers.js';
import { E2E_PACKING_PORT, E2E_PACKING_SCHEMA, PACKING_USERS } from './config.js';

const S = E2E_PACKING_SCHEMA;
await globalSetup();
const owner = connect(TEST_DATABASE_URL);
await owner.unsafe(`drop schema if exists ${S} cascade; drop schema if exists ${S}_report cascade; drop schema if exists ${S}_tb cascade; drop schema if exists ${S}_lb cascade; create schema ${S}; create schema ${S}_tb; create schema ${S}_lb;
  create table ${S}_tb.batch_fact_v1 (batch_number text, product_code text, record_kind text, status text, issued_at timestamptz, completed_at timestamptz, released boolean,
    read_at timestamptz default now(), data_as_of timestamptz default now(), manufactured_on date);
  insert into ${S}_tb.batch_fact_v1 values ('TI260001', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-02 06:00+00', '2026-11-08 06:00+00', true, now(), now(), '2026-11-03');
  grant usage on schema ${S}_tb to ${PACKING_APP_ROLE}; grant select on all tables in schema ${S}_tb to ${PACKING_APP_ROLE};
  create table ${S}_lb.equipment_status_v1 (master_id text, code text, kind text, state text, fit_for_use boolean, blockers text[], warnings text[], in_use_batch text,
    cleaned_at timestamptz, cleaned_by text, checked_at timestamptz default now(), read_at timestamptz default now(), data_as_of timestamptz default now());
  insert into ${S}_lb.equipment_status_v1 (master_id, code, kind, state, fit_for_use, blockers, warnings) values
    ('ln-1', 'LL-01', 'equipment', 'dirty', false, '{"Dirty: clean and verify before the next use."}', '{}');
  grant usage on schema ${S}_lb to ${PACKING_APP_ROLE};`);
await owner.end();

const schemaOwner = connect(TEST_DATABASE_URL, { searchPath: S });
await migrate(schemaOwner, PACKING_PLAN);
for (const [username, permissions] of Object.entries(PACKING_USERS)) await seedUser(schemaOwner, username, permissions);
await schemaOwner.end();

const master = fakeMaster();
const item = (itemId: string, code: string, name: string) => ({ itemId, code, name, version: 1, active: true });
// Master data's kind: the pack and the product it is packed from; PRD-002 has no kind yet (offered in both lists).
master.products_.push({ ...item('pk-1', 'PK-001', 'Examplocin 1 g injection, 10 vials per carton'), strength: '1 g', dosageForm: 'injection', kind: 'pack' },
  { ...item('prd-1', 'PRD-001', 'Examplocin 1 g injection (filled vials)'), strength: '1 g', dosageForm: 'injection', kind: 'bulk' },
  { ...item('prd-2', 'PRD-002', 'Examplocin 2 g injection (filled vials)'), strength: '2 g', dosageForm: 'injection' });
master.materials_.push({ ...item('pm-lbl', 'PM-101', 'Vial label'), category: 'packing', unit: 'nos' },
  { ...item('pm-ctn', 'PM-103', 'Carton'), category: 'packing', unit: 'nos' });
master.equipment_.push({ ...item('ln-1', 'LL-01', 'Labelling line 1'), kind: 'equipment', type: 'labelling line', room: 'PK-01' },
  { ...item('ln-2', 'LL-02', 'Labelling line 2'), kind: 'equipment', type: 'labelling line', room: 'PK-01' });
// The line stands in a packing room (the packing stages allow the Packing area).
master.rooms_.splice(0, master.rooms_.length, { ...item('rm-pk1', 'PK-01', 'Packing hall 1'), area: 'Sterile packing', grade: 'D' });

const sql = connect(TEST_DATABASE_URL, { role: PACKING_APP_ROLE, searchPath: S });
const bulk = connect(TEST_DATABASE_URL, { role: PACKING_APP_ROLE, link: true });
const app = await buildApp({ sql, signOn: fakeSignOn(), proofKey: TEST_PROOF_KEY, master, links: links({ truebatch_injectables: bulk, logbook: bulk }, { truebatch_injectables: `${S}_tb`, logbook: `${S}_lb` }),
  webRoot: new URL('../dist/packing-web', import.meta.url).pathname, cookieSecure: false, product: PACKING });
await app.listen({ port: E2E_PACKING_PORT, host: '127.0.0.1' });
