// Round 46 (Tablets, ported): report.reading_v1, one row per recorded number of a step signed done, with the master's
// limits, for Operations' continued process verification (db/migrations/0031, shared/engine/readings.ts); and the
// device assembly's component in material_use_v1 (db/migrations/0030).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readingParameters } from '../shared/engine/readings.js';
import { freshDb, seedUser, type TestDb } from './helpers.js';
import { small } from './engine-fixture.js';
import { findBlock } from '../shared/blocks/index.js';

let t: TestDb;
let user = 0;
beforeAll(async () => {
  t = await freshDb();
  user = await seedUser(t.owner, 'reader.one', []);
});
afterAll(async () => t?.close());
const rep = () => `${t.schema}_report`;

const q = (value: string, unit: string) => ({ value, unit });
async function batch(no: string, steps: object[]) {
  const doc = small([{ key: 'filling', name: 'Aseptic filling', steps }]);
  const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(doc as never)}, ${user}) returning id::int`;
  const [b] = await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values (${no}, ${v!.id}, ${user}) returning id::int`;
  return (step: number, round: number, kind: string, payload: object, at: string) => t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id, at)
    values (${b!.id}, 0, 1, ${step}, ${round}, ${kind}, ${t.owner.json(payload as never)}, ${user}, ${at})`;
}
const rows = (no: string) => t.owner.unsafe(`select reading_id, stage, step, step_name, sub_batch, round, block, parameter, field, reading_no, value::text, unit,
  low_limit::text, high_limit::text, limit_unit, limit_of, recorded_at, corrected from ${rep()}.reading_v1 where batch_number = $1 order by step, round, field, reading_no`, [no]);

describe('reading_v1', () => {
  it('the list of number fields in the database is the blocks\' (a new number field needs a migration replacing reading_parameters)', async () => {
    const db = await t.owner<{ block: string; field: string; label: string; limit_setting: string | null; fixed_limit: object | null; limit_of: string | null }[]>`
      select block, field, label, limit_setting, fixed_limit, limit_of from reading_parameters`;
    const key = (p: { block: string; field: string }) => `${p.block}/${p.field}`;
    const sorted = <T extends { block: string; field: string }>(l: T[]) => [...l].sort((x, y) => key(x).localeCompare(key(y)));
    expect(sorted(db.map((r) => ({ block: r.block, field: r.field, label: r.label, limitSetting: r.limit_setting, fixedLimit: r.fixed_limit, limitOf: r.limit_of }))))
      .toEqual(sorted(readingParameters()));
    expect(readingParameters().find((p) => p.block === 'fill' && p.field === 'weights')).toMatchObject({ limitSetting: 'meanLimit', limitOf: 'mean' });
    expect(readingParameters().find((p) => p.block === 'device-assembly' && p.field === 'failed')).toMatchObject({ fixedLimit: { high: '0', unit: 'units' }, limitOf: 'each' });
    // One row per block and field (a block with several versions once), never a packing block's.
    expect(new Set(readingParameters().map((p) => `${p.block}/${p.field}`)).size).toBe(readingParameters().length);
    expect(readingParameters().some((p) => findBlock({ id: p.block, version: 1 })!.packing)).toBe(false);
  });

  it('one row per reading of a step signed done, with the master\'s limits; a list one row per reading; the current value after a correction', async () => {
    const fill = { key: 'fill', block: { id: 'fill', version: 1 }, settings: { needles: '3', meanLimit: { low: '1.040', high: '1.080', unit: 'g' }, band: '2',
      fillTarget: '1.05 mL', density: '1.01 g/mL' } };
    const e = await batch('READ-1', [fill, { key: 'check', settings: { what: 'pH of the bulk', unit: '', limit: { low: '5.0', high: '7.0', unit: '' } } }]);
    await e(0, 1, 'started', { where: 'Aseptic filling › Fill with periodic fill-weight checks' }, '2026-11-20 08:00+00');
    await e(0, 1, 'value', { values: { machine: { code: 'FIL-01' }, weights: [q('1.061', 'g'), q('1.058', 'g'), q('1.063', 'g')], counter: q('1200', 'units'), stoppers: 'yes' } },
      '2026-11-20 08:05+00');
    // Round 2 recorded, not signed: not published yet.
    await e(0, 2, 'started', {}, '2026-11-20 08:30+00');
    await e(0, 2, 'value', { values: { counter: q('2400', 'units') } }, '2026-11-20 08:31+00');
    // The "check a value" step: its parameter is what the master says it checks.
    await e(1, 1, 'started', {}, '2026-11-20 09:00+00');
    await e(1, 1, 'value', { values: { reading: q('6.1', '') } }, '2026-11-20 09:01+00');
    await e(1, 1, 'done', {}, '2026-11-20 09:02+00');
    expect((await rows('READ-1')).map((r) => r.field)).toEqual(['reading']);
    await e(0, 1, 'done', {}, '2026-11-20 08:06+00');
    const r = await rows('READ-1');
    expect(r.map((x) => [x.field, x.reading_no, x.value, x.unit, x.low_limit, x.high_limit, x.limit_unit, x.limit_of])).toEqual([
      ['reading', 1, '6.1', '', '5.0', '7.0', '', 'each'],
      ['counter', 1, '1200', 'units', null, null, null, null],
      ['weights', 1, '1.061', 'g', '1.040', '1.080', 'g', 'mean'],
      ['weights', 2, '1.058', 'g', '1.040', '1.080', 'g', 'mean'],
      ['weights', 3, '1.063', 'g', '1.040', '1.080', 'g', 'mean'],
    ]);
    expect(r[2]).toMatchObject({ reading_id: 'READ-1/0.1.0.1/weights/1', stage: 'Aseptic filling', step: 'filling/fill', step_name: 'Aseptic filling › Fill with periodic fill-weight checks',
      sub_batch: 1, round: 1, block: 'fill', parameter: 'Net fill weight per needle', recorded_at: new Date('2026-11-20T08:05:00Z'), corrected: false });
    expect(r[0]).toMatchObject({ parameter: 'pH of the bulk', step_name: 'Aseptic filling › check' });
    await e(0, 1, 'corrected', { values: { counter: q('1210', 'units') }, reason: 'Misread' }, '2026-11-20 10:00+00');
    expect((await rows('READ-1')).find((x) => x.field === 'counter')).toMatchObject({ value: '1210', corrected: true, recorded_at: new Date('2026-11-20T10:00:00Z') });
  });

  it('a device assembly: the counts and the function test, the fixed limit of no failed device; an optional limit left unset gives no limit', async () => {
    const e = await batch('READ-2', [{ key: 'assemble', block: { id: 'device-assembly', version: 1 }, checker: true, settings: { component: { formula: 'x' }, theoretical: '1000 units',
      functionSample: '5', level: 'II', criticalAql: '0', majorAql: '0.65', minorAql: '2.5', yieldLimit: { low: '97', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99', high: '100.5', unit: '%' } } }]);
    await e(0, 1, 'started', {}, '2026-11-20 08:00+00');
    await e(0, 1, 'value', { values: { lot: 'AI-1', good: q('980', 'units'), failed: q('0', 'units'), force: q('15', 'N') } }, '2026-11-20 08:05+00');
    await e(0, 1, 'done', {}, '2026-11-20 08:06+00');
    expect((await rows('READ-2')).map((x) => [x.field, x.value, x.unit, x.high_limit, x.limit_unit, x.limit_of])).toEqual([
      ['failed', '0', 'units', '0', 'units', 'each'], ['force', '15', 'N', null, null, null], ['good', '980', 'units', null, null, null]]);
  });

  it('is published in the report schema with its columns, closed to everybody until the platform links a reader', async () => {
    const cols = await t.owner.unsafe(`select column_name || ' ' || data_type as c from information_schema.columns where table_schema = $1 and table_name = 'reading_v1' order by ordinal_position`, [rep()]);
    expect(cols.map((c) => c.c)).toEqual(['reading_id text', 'batch_number text', 'product_code text', 'stage text', 'step text', 'step_name text', 'sub_batch integer', 'round integer',
      'block text', 'parameter text', 'field text', 'reading_no integer', 'value numeric', 'unit text', 'low_limit numeric', 'high_limit numeric', 'limit_unit text', 'limit_of text',
      'recorded_at timestamp with time zone', 'corrected boolean', 'read_at timestamp with time zone', 'data_as_of timestamp with time zone']);
    await expect(t.sql.unsafe(`select 1 from ${rep()}.reading_v1 limit 1`)).rejects.toThrow(/permission denied/);
  });

  it('PL-01 the report schema holds exactly the views the manifest publishes (reading_v1 among them); reading_parameters is not published', async () => {
    const m = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ops/manifest.draft.json'), 'utf8')) as { publishes: string[] };
    const views = await t.owner.unsafe(`select table_name from information_schema.views where table_schema = $1 order by table_name`, [rep()]);
    expect(views.map((v) => v.table_name)).toEqual([...m.publishes].sort());
    expect(m.publishes).toContain('reading_v1');
  });
});

describe('material_use_v1 and a device assembly (0030)', () => {
  it('the component used (issued − returned, the step\'s "net") is published for MMS, in master data\'s count name, once signed done', async () => {
    const e = await batch('DEV-USE-1', [{ key: 'assemble', block: { id: 'device-assembly', version: 1 }, checker: true, settings: { component: { formula: 'x' } } }]);
    await e(0, 1, 'started', { where: 'Aseptic filling › Device assembly' }, '2026-11-20 08:00+00');
    await e(0, 1, 'value', { values: { lot: 'AI-HSG-1', issued: q('1010', 'units'), returned: q('5', 'units') }, results: { net: { ok: true, value: '1005', unit: 'units', shown: '' } } }, '2026-11-20 08:05+00');
    const used = () => t.owner.unsafe(`select lot_number, material_code, quantity::text, unit, step from ${rep()}.material_use_v1 where batch_number = 'DEV-USE-1'`);
    expect(await used()).toEqual([]);
    await e(0, 1, 'done', { stockUnit: 'nos' }, '2026-11-20 08:06+00');
    expect(await used()).toEqual([{ lot_number: 'AI-HSG-1', material_code: 'M', quantity: '1005', unit: 'nos', step: 'filling/assemble' }]);
  });
});
