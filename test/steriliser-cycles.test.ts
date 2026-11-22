import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { call, freshApp, login, proofFor, seedUser, type TestApp } from './helpers.js';
import { small } from './engine-fixture.js';
import { PACKING_PLAN } from '../packing/migrate.js';

// Duplicates review item 24 (owner rule 19 Nov 2026: the product that owns a job keeps it; a linked one reads it):
// TrueBatch Injectables owns the sterilisation cycles run for its batches and publishes them as steriliser_cycle_v1;
// the Logbook lists them read-only in the steriliser's history. The cycle's step events are written here as the routes
// write them (the routes' own tests are elsewhere), so the view is checked on what the record keeps.

let t: TestApp;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  t = await freshApp();
  t.master.products_.push({ itemId: 'p', code: 'P', name: 'P', version: 1, active: true, strength: null, dosageForm: 'injection' });
  t.master.materials_.push({ itemId: 'm', code: 'M', name: 'M', version: 1, active: true, category: null, unit: 'kg' });
  for (const [name, perms] of Object.entries({ author: ['truebatch_injectables.master.author'], issuer: ['truebatch_injectables.batch.issue'] } as const)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(async () => { await t?.close(); });

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
const lim = (low?: string, high?: string, unit = '') => ({ ...(low ? { low } : {}), ...(high ? { high } : {}), unit });
const steps = [
  { block: { id: 'sterilise', version: 1 }, checker: true, settings: { what: 'items and parts', exposureLimit: lim('15', '30', 'min'), lowestLimit: lim('121', undefined, '°C') } },
  { block: { id: 'terminal-sterilise', version: 1 }, checker: true, settings: { medium: 'moist heat', lethalityLimit: lim('15', undefined, 'F-min') } },
  { block: { id: 'isolator-decon', version: 1 }, checker: true, settings: { h2o2Limit: lim(undefined, '1', 'ppm') } },
  { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } },
];
async function issue() {
  const res = await as('author', 'POST', '/api/masters', { doc: small([{ steps }]) });
  expect(res.statusCode, res.body).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  const b = await as('issuer', 'POST', '/api/batches', { masterVersionId: id, proof: proofFor('issuer') });
  expect(b.statusCode, b.body).toBe(200);
  return b.json() as { id: number; batchNo: string };
}
const machine = (code: string, type: string) => ({ itemId: code, code, name: `${type} ${code}`, version: 1, type, room: 'RM-211', area: 'Sterilisation' });
const num = (value: string, unit: string) => ({ value, unit });
const pass = (shown: string, ok = true) => ({ ok: true, value: '0', unit: '', shown, check: { pass: ok, level: ok ? 'pass' : 'fail', shown, rounded: '0' } });
async function event(batch: number, step: number, kind: string, payload: object = {}) {
  await t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
    values (${batch}, 0, 1, ${step}, 1, ${kind}, ${t.owner.json(payload as never)}, (select id from users where username = 'author'))`;
}
const rows = async (batchNo: string) => t.owner.unsafe(`select cycle_id, equipment_code, equipment_type, room_code, cycle_type, programme, load, controller_record_ref,
  result, exposure_min::text, lowest_temp_c::text, lowest_f0::text, max_product_temp_c::text, h2o2_ppm::text, leak_rate::text, units::text, bi_id, use_by::text, signed
  from ${t.schema}_report.steriliser_cycle_v1 where batch_number = $1 order by cycle_id`, [batchNo]);

describe('steriliser_cycle_v1: the batch\'s sterilisation cycles, published for the LEAD', () => {
  it('its columns, as agreed with the LEAD (added only at the end)', async () => {
    const cols = await t.owner<{ c: string }[]>`select column_name || ' ' || data_type as c from information_schema.columns
      where table_schema = ${`${t.schema}_report`} and table_name = 'steriliser_cycle_v1' order by ordinal_position`;
    expect(cols.map((r) => r.c)).toEqual(['cycle_id text', 'batch_number text', 'product_code text', 'step_key text', 'step_name text', 'equipment_code text',
      'equipment_name text', 'equipment_type text', 'room_code text', 'cycle_type text', 'programme text', 'load text', 'controller_record_ref text',
      'started_at timestamp with time zone', 'ended_at timestamp with time zone', 'result text', 'exposure_min numeric', 'lowest_temp_c numeric', 'lowest_f0 numeric',
      'max_product_temp_c numeric', 'h2o2_ppm numeric', 'leak_rate numeric', 'units numeric', 'bi_id text', 'use_by date', 'signed ARRAY',
      'read_at timestamp with time zone', 'data_as_of timestamp with time zone']);
  });

  it('TI-24 a cycle is published once signed as performed, with its figures as corrected, its result and who signed', async () => {
    const b = await issue();
    // 1. Items in an autoclave: recorded, signed and checked.
    await event(b.id, 0, 'started', { where: 'Stage 0 › Sterilise items or equipment' });
    await event(b.id, 0, 'value', { values: { steriliser: machine('EQS-ATC-01', 'Autoclave'), loadId: 'L-17', printout: 'ATC-01/2611/0042' }, results: {} });
    await event(b.id, 0, 'value', { values: { exposure: num('20', 'min'), lowest: num('121.4', '°C'), bi: 'BI-0091', useBy: '2026-11-22' },
      results: { exposureCheck: pass('20 min: within limits'), lowestCheck: pass('121.4 °C: within limits') } });
    expect(await rows(b.batchNo)).toEqual([]);
    await event(b.id, 0, 'done');
    // 2. A terminal load whose F0 was corrected, signed but not yet checked.
    await event(b.id, 1, 'started', { where: 'Stage 0 › Terminal sterilisation (each load)' });
    await event(b.id, 1, 'value', { values: { steriliser: machine('EQS-ATC-02', 'Autoclave'), loadNo: '1', units: num('9800', 'units'), printout: 'ATC-02/0007',
      lowestF: num('14.0', 'F-min'), exposure: num('30', 'min'), maxProduct: num('122', '°C') }, results: { lethality: pass('14 F-min: below 15', false) } });
    await event(b.id, 1, 'corrected', { values: { lowestF: num('16.5', 'F-min') }, reason: 'Misread the printout', results: { lethality: pass('16.5 F-min: within limits') } });
    await event(b.id, 1, 'done');
    // 3. The isolator's VHP decontamination, its H2O2 out of limits.
    await event(b.id, 2, 'started', { where: 'Stage 0 › Isolator or RABS decontamination' });
    await event(b.id, 2, 'value', { values: { isolator: machine('EQA-ISO-01', 'Isolator'), printout: 'ISO-01/0311', leakRate: num('0.02', 'mbar·L/s'), h2o2: num('1.6', 'ppm'), useBy: '2026-11-20' },
      results: { h2o2Check: pass('1.6 ppm: above 1', false) } });
    await event(b.id, 2, 'done');
    await event(b.id, 0, 'checked');
    const p = `${b.batchNo}/0.1.`;
    expect(await rows(b.batchNo)).toEqual([
      { cycle_id: `${p}0.1`, equipment_code: 'EQS-ATC-01', equipment_type: 'Autoclave', room_code: 'RM-211', cycle_type: 'steam', programme: 'items and parts', load: 'L-17',
        controller_record_ref: 'ATC-01/2611/0042', result: 'pass', exposure_min: '20', lowest_temp_c: '121.4', lowest_f0: null, max_product_temp_c: null, h2o2_ppm: null,
        leak_rate: null, units: null, bi_id: 'BI-0091', use_by: '2026-11-22', signed: ['performed', 'checked'] },
      { cycle_id: `${p}1.1`, equipment_code: 'EQS-ATC-02', equipment_type: 'Autoclave', room_code: 'RM-211', cycle_type: 'steam', programme: 'moist heat', load: '1',
        controller_record_ref: 'ATC-02/0007', result: 'pass', exposure_min: '30', lowest_temp_c: null, lowest_f0: '16.5', max_product_temp_c: '122', h2o2_ppm: null,
        leak_rate: null, units: '9800', bi_id: null, use_by: null, signed: ['performed'] },
      { cycle_id: `${p}2.1`, equipment_code: 'EQA-ISO-01', equipment_type: 'Isolator', room_code: 'RM-211', cycle_type: 'vhp', programme: null, load: null,
        controller_record_ref: 'ISO-01/0311', result: 'fail', exposure_min: null, lowest_temp_c: null, lowest_f0: null, max_product_temp_c: null, h2o2_ppm: '1.6',
        leak_rate: '0.02', units: null, bi_id: null, use_by: '2026-11-20', signed: ['performed'] },
    ]);
  });

  it('a dry-heat oven or a SIP machine gives its cycle type; the depyrogenation tunnel and freeze-drying are not cycles here', async () => {
    const b = await issue();
    await event(b.id, 0, 'started', { where: 'x' });
    await event(b.id, 0, 'value', { values: { steriliser: machine('EQS-DHS-01', 'Dry heat steriliser oven'), printout: 'DHS/1' }, results: {} });
    await event(b.id, 0, 'done');
    expect((await rows(b.batchNo)).map((r) => r.cycle_type)).toEqual(['dry_heat']);
    const src = readFileSync(path.join(import.meta.dirname, '../db/migrations/0026_steriliser_cycle.sql'), 'utf8');
    expect(src).toContain("k.block in ('sterilise', 'terminal-sterilise', 'isolator-decon')");
  });

  it('the manifest publishes it; packing does not migrate it (no cycles there)', () => {
    const m = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ops/manifest.draft.json'), 'utf8')) as { publishes: string[] };
    expect(m.publishes).toContain('steriliser_cycle_v1');
    expect(PACKING_PLAN.dirs[0]!.skip).toContain('0026_steriliser_cycle.sql');
  });
});
