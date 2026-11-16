import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from '../server/db.js';
import { MIGRATIONS_DIR, migrate, type Plan } from '../db/migrate.js';

// TrueBatch Tablets Packing's own database: TrueBatch Tablets' migrations (accounts, audit trail, signatures, masters,
// batches and their events: the same tables, no copy of them), with its own app role and without the views TrueBatch
// Tablets publishes (0006 to 0008, 0011), then its own migrations (packing/migrations: the views packing publishes).
const here = path.dirname(fileURLToPath(import.meta.url));
export const PACKING_MIGRATIONS_DIR = path.resolve(here, here.includes(`${path.sep}dist${path.sep}`) ? '../../packing/migrations' : 'migrations');
export const PACKING_APP_ROLE = 'truebatch_packing_app';
export const PACKING_PLAN: Plan = { role: PACKING_APP_ROLE, dirs: [{ dir: MIGRATIONS_DIR, skip: ['0006_report_views.sql', '0007_batch_fact_manufactured_on.sql', '0008_published_names_and_material_use.sql', '0011_stage_uses_and_stock_units.sql'] }, { dir: PACKING_MIGRATIONS_DIR }] };

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is required');
  const sql = connect(url);
  const applied = await migrate(sql, PACKING_PLAN);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
  await sql.end();
}
