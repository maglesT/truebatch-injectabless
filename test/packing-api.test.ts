import { plantDate } from '../shared/plant-time.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links } from '../server/links.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { PACKING } from '../packing/product.js';
import { PACKING_APP_ROLE } from '../packing/migrate.js';
import { call, freshApp, handLabels, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { packing } from './packing-fixture.js';
import { openSteps, returnsOf, usesOfLot } from '../shared/engine/index.js';

// TrueBatch Injectables Packing through its own server: its own permission codes, a packing batch issued from the filled
// units of a RELEASED batch read from TrueBatch Injectables' batch_fact_v1 (a fake provider schema, read with packing's restricted login),
// the hand fallback with a second person, one active order per line, the whole record run to QC approval and QA release,
// the packing record PDF, its published view, and its insert-only tables.

let t: TestApp;
let provider: Sql;
let TB = '';
const cookies: Record<string, string> = {};
const item = (itemId: string, c: string, name: string) => ({ itemId, code: c, name, version: 1, active: true });
const P = (...codes: string[]) => codes.map((c) => `truebatch_injectables_packing.${c}` as const);

beforeAll(async () => {
  t = await freshApp(async (db) => {
    TB = `${db.schema}_tb`;
    // TrueBatch Injectables' published batch_fact_v1, as a table with its columns. manufactured_on (the date the first
    // processing step started) is not the issue date: TI260001 was issued on 31 Oct and started on 3 Nov.
    await db.owner.unsafe(`
      create schema ${TB};
      create table ${TB}.batch_fact_v1 (batch_id uuid, batch_number text, product_code text, strength text, mbr_version_id uuid, family_code text, record_kind text,
        status text, issued_at timestamptz, completed_at timestamptz, released boolean, read_at timestamptz default now(), data_as_of timestamptz default now(), manufactured_on date);
      -- The Deviations system's deviation_v1 (in the same fake schema): the bulk batch's open deviations block release (S24).
      create table ${TB}.deviation_v1 (number text, status text, classification text, opened_at timestamptz, closed_at timestamptz, product text, batch text,
        batch_norm text, outcome text, read_at timestamptz default now(), data_as_of timestamptz default now(), title text, source_ref text);
      grant usage on schema ${TB} to ${PACKING_APP_ROLE};
      grant select on all tables in schema ${TB} to ${PACKING_APP_ROLE};
      insert into ${TB}.batch_fact_v1 (batch_number, product_code, record_kind, status, issued_at, released, manufactured_on) values
        ('TI260001', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-10-31 06:00+00', true, '2026-11-03'),
        ('TI260002', 'PRD-001', 'PROCESSING', 'QC_APPROVED', '2026-11-05 06:00+00', false, '2026-11-05'),
        ('TI260003', 'PRD-002', 'PROCESSING', 'RELEASED', '2026-11-04 06:00+00', true, '2026-11-04'),
        ('TI260004', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-06 06:00+00', true, '2026-11-06'),
        ('TI260005', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-07 06:00+00', true, null);`);
    provider = connect(TEST_DATABASE_URL, { role: PACKING_APP_ROLE, link: true });
    return links({ truebatch_injectables: provider, deviations: provider }, { truebatch_injectables: TB, deviations: TB });
  }, false, PACKING);
  t.master.products_.push({ ...item('pk-1', 'PK-001', 'Examplocin 1 g injection, 10 vials per carton'), strength: '1 g', dosageForm: 'injection' },
    { ...item('prd-1', 'PRD-001', 'Examplocin 1 g injection (filled vials)'), strength: '1 g', dosageForm: 'injection' });
  for (const m of packing().pack!.materials) t.master.materials_.push({ ...item(m.materialItemId, m.code, m.name), category: 'packing', unit: m.unit === 'units' ? 'nos' : m.unit });
  t.master.equipment_.push({ ...item('ln-1', 'LL-01', 'Labelling line 1'), kind: 'equipment', type: 'labelling line', room: 'PK-01' },
    { ...item('ln-2', 'LL-02', 'Labelling line 2'), kind: 'equipment', type: 'labelling line', room: 'PK-02' });
  const people = {
    author: P('master.author', 'view'), issuer: P('batch.issue'), op1: P('batch.operate'), chk1: P('batch.check'), sup1: P('batch.supervise'), qc1: P('qc.approve'), qa1: P('qa.release'),
  };
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, perms);
    cookies[name] = (await login(t.app, name)).cookie;
  }
  await seedUser(t.owner, 'injectables', ['truebatch_injectables.batch.operate', 'truebatch_injectables.qa.release']);
});
afterAll(async () => {
  await provider?.end();
  await t.owner.unsafe(`drop schema if exists ${TB} cascade`);
  await t.close();
});

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
type Batch = { batch: { status: string; contentHash: string; actions: string[] }; steps: { id: string; state: string; actions: string[]; contentHash: string; values: Record<string, unknown>;
  source: Record<string, { from: string }>; handFields: { name: string }[]; results: Record<string, { ok: boolean; shown?: string; check?: { pass: boolean } }>; problems: string[] }[] };
const get = async (id: number, who = 'op1') => (await as(who, 'GET', `/api/batches/${id}`)).json() as Batch;
let mv = 0;
async function effective() {
  const res = await as('author', 'POST', '/api/masters', { doc: packing() });
  expect(res.statusCode, res.body).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  return id;
}
// No Logbook link here: the line's status labels are answered at issue (TI-11).
const issue = (values: Record<string, unknown>) => as('issuer', 'POST', '/api/batches', { masterVersionId: mv, proof: proofFor('issuer'), values: { ...handLabels('line', 'machine'), ...values } });

describe('TrueBatch Injectables Packing: its own product on the platform', () => {
  it('PL-01 packing reads only its own permission codes from core, each as the shared code of the same thing', async () => {
    const me = (await as('op1', 'GET', '/api/me')).json() as { permissions: string[] };
    expect(me.permissions).toEqual(['truebatch_injectables.batch.operate']);
    const refused = await login(t.app, 'injectables');
    expect(refused.res.statusCode).toBe(403);
    expect(refused.res.body).toContain('You have no right to use TrueBatch Injectables Packing.');
  });

  it('PL-01 the packing draft manifest declares exactly the packing permission codes and labels, in the platform format', () => {
    const m = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ops/packing.manifest.draft.json'), 'utf8')) as { product: string; database: string; permissions: { code: string; label: string }[]; reads: Record<string, string[]>; publishes: string[] };
    expect(Object.fromEntries(m.permissions.map((p) => [p.code, p.label]))).toEqual(PACKING.permissions);
    expect([m.product, m.database]).toEqual(['truebatch_injectables_packing', 'truebatch_injectables_packing']);
    for (const p of m.permissions) expect(p.code).toMatch(/^truebatch_injectables_packing(\.[a-z0-9_]+)+$/);
    expect(m.reads.truebatch_injectables).toEqual(['batch_fact_v1']);
    expect(m.publishes).toEqual(['packing_batch_v1', 'equipment_use_v1', 'material_use_v1', 'deviation_note_v1']);
  });

  it('PL-06 the packing app login keeps the step events and signatures insert-only', async () => {
    mv = await effective();
    await expect(t.sql`update step_events set kind = 'done'`).rejects.toMatchObject({ code: '42501' });
    await expect(t.sql`delete from signatures`).rejects.toMatchObject({ code: '42501' });
  });
});

describe('a packing batch from the filled units of a released batch', () => {
  let first = 0;
  it('TI-P2 the issue screen offers the RELEASED batches of the product packed, read from TrueBatch Injectables', async () => {
    const r = (await as('issuer', 'GET', '/api/bulk-batches?product=PRD-001')).json() as { link: string; batches: { batchNo: string }[] };
    expect([r.link, ...r.batches.map((b) => b.batchNo)]).toEqual(['ok', 'TI260005', 'TI260004', 'TI260001']);
    expect((await as('op1', 'GET', '/api/bulk-batches?product=PRD-001')).statusCode).toBe(403);
  });

  it('TI-P2 a packing batch is issued from a RELEASED batch of TrueBatch Injectables: line, batch and filled units recorded, the date of manufacture pulled (the date its first step started, not its issue date)', async () => {
    const res = await issue({ line: 'ln-1', bulk: 'TI260001', units: '10000' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ batchNo: expect.stringMatching(/^TIP\d{6}$/) });
    first = (res.json() as { id: number }).id;
    const s = (await get(first)).steps[0]!;
    expect(s).toMatchObject({ state: 'in_progress', values: { bulk: 'TI260001', mfgDate: '2026-11-03', line: { code: 'LL-01' } }, source: { bulk: { from: 'truebatch_injectables' }, mfgDate: { from: 'truebatch_injectables' } } });
    expect(s.results.expiry).toMatchObject({ ok: true, shown: expect.stringContaining('expiry 10/2028') });
    expect(s.results.packs).toMatchObject({ ok: true, shown: '10000 units ÷ 10 units = 1000 packs' });
    // The pulled date cannot be typed over.
    const r = await as('op1', 'POST', `/api/batches/${first}/steps/0.1.0.1/record`, { values: { mfgDate: '2026-11-01' } });
    expect(r.json()).toMatchObject({ problems: ['Date of manufacture of the filled units comes from TrueBatch Injectables and cannot be typed over'] });
  });

  it('TI-P2 the batch must be released: a batch not released, of another product, or unknown is refused', async () => {
    const no = async (bulk: string) => (await issue({ line: 'ln-2', bulk, units: '1000' })).json() as { problems: string[] };
    expect((await no('TI260002')).problems).toEqual(['Batch TI260002 is qc approved in TrueBatch Injectables: only a released batch may be packed.']);
    expect((await no('TI260003')).problems).toEqual(['Batch TI260003 is PRD-002 in TrueBatch Injectables, not PRD-001 Examplocin 1 g injection (filled vials).']);
    expect((await no('TI269999')).problems).toEqual(['Batch TI269999 is not in TrueBatch Injectables.']);
    expect((await no('TI260005')).problems).toEqual(['Batch TI260005 has no date of manufacture in TrueBatch Injectables (no processing step started).']);
    expect((await issue({ line: 'ln-2', bulk: 'TI260001' })).json()).toMatchObject({ problems: ['Filled units issued is not recorded'] });
  });

  it('TI-P7 one active packing order per line: a line with a batch being packed takes no other', async () => {
    const res = await issue({ line: 'ln-1', bulk: 'TI260004', units: '5000' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'line_in_use', problems: [expect.stringMatching(/^Line LL-01 has an active packing order: batch TIP\d{6} \(PK-001\) is still being packed\. One packing order per line\.$/)] });
  });

  it('TI-P2 without the TrueBatch Injectables link the batch is typed from the tray or case labels (RELEASED), and a second person checks it', async () => {
    await t.owner.unsafe(`revoke select on ${TB}.batch_fact_v1 from ${PACKING_APP_ROLE}`);
    try {
      // TI-P8: a typed date of manufacture is a real date, never in the future (plant time).
      const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const future = await issue({ line: 'ln-2', bulk: 'TI260004', units: '5000', mfgDate: tomorrow, 'bulk.released': 'yes', 'bulk.product': 'yes' });
      expect(future.statusCode).toBe(400);
      expect(future.json()).toMatchObject({ problems: [`The date of manufacture ${plantDate(tomorrow)} is in the future: give the date on the tray or case labels.`] });
      expect((await issue({ line: 'ln-2', bulk: 'TI260004', units: '5000', mfgDate: '6/11/2026', 'bulk.released': 'yes', 'bulk.product': 'yes' })).json())
        .toMatchObject({ problems: ['Date of manufacture of the filled units: give a date, e.g. 2026-11-15.'] });
      const notReleased = await issue({ line: 'ln-2', bulk: 'TI260004', units: '5000', mfgDate: '2026-11-06', 'bulk.released': 'no', 'bulk.product': 'yes' });
      expect(notReleased.json()).toMatchObject({ problems: [expect.stringContaining('the tray or case labels say RELEASED (QA) for this batch number: if not, do not use it')] });
      const res = await issue({ line: 'ln-2', bulk: 'TI260004', units: '5000', mfgDate: '2026-11-06', 'bulk.released': 'yes', 'bulk.product': 'yes' });
      expect(res.statusCode, res.body).toBe(200);
      const id = (res.json() as { id: number }).id;
      const s = (await get(id)).steps[0]!;
      expect(s.source.bulk).toEqual({ from: 'hand', link: 'truebatch_injectables', state: 'down' });
      expect(s.handFields.map((f) => f.name)).toEqual(expect.arrayContaining(['bulk.released', 'bulk.product']));
      // The issuer cannot check it; the review lists the hand entry for QA.
      const review = (await as('qa1', 'GET', `/api/batches/${id}/review`)).json() as { hand: { field: string; link: string }[] };
      expect(review.hand.map((h) => `${h.field} ${h.link}`)).toContain('bulk truebatch_injectables');
      const done = await as('op1', 'POST', `/api/batches/${id}/steps/0.1.0.1/record`, { values: { received: 'yes' } });
      expect(done.statusCode).toBe(200);
      const signed = await as('op1', 'POST', `/api/batches/${id}/steps/0.1.0.1/done`, { proof: proofFor('op1'), contentHash: (await get(id)).steps[0]!.contentHash });
      expect(signed.statusCode, signed.body).toBe(200);
      expect((await get(id, 'chk1')).steps[0]).toMatchObject({ state: 'done_awaiting_check', actions: ['check', 'send-back', 'note'] });
    } finally {
      await t.owner.unsafe(`grant select on ${TB}.batch_fact_v1 to ${PACKING_APP_ROLE}`);
    }
  });

  it('TI-21 QA terminates a packing batch in production (owner, 16 Nov 2026): rejected with its reason, its line use ended, the line takes the next order', async () => {
    const id = (await t.owner<{ id: number }[]>`select id::int from batches order by id desc limit 1`)[0]!.id;
    expect((await issue({ line: 'ln-2', bulk: 'TI260004', units: '5000' })).json()).toMatchObject({ error: 'line_in_use' });
    // The filled units checked, then vial labels and trays issued before the line broke down.
    expect((await as('chk1', 'POST', `/api/batches/${id}/steps/0.1.0.1/check`, { proof: proofFor('chk1'), contentHash: (await get(id)).steps[0]!.contentHash })).statusCode).toBe(200);
    for (const [key, values] of [['0.1.1.1', { lot: 'LABEL-9', issued: '5250' }], ['0.1.2.1', { lot: 'TRAY-9', issued: '500' }]] as const) {
      expect((await as('op1', 'POST', `/api/batches/${id}/steps/${key}/start`)).statusCode).toBe(200);
      const rec = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/record`, { values: { ...values, ...handLabels('lot', 'lot'), matches: 'yes' } });
      expect(rec.statusCode, rec.body).toBe(200);
      const done = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/done`, { proof: proofFor('op1'), contentHash: (await get(id)).steps.find((x) => x.id === key)!.contentHash });
      expect(done.statusCode, done.body).toBe(200);
    }
    const b = await get(id, 'qa1');
    expect(b.batch.actions).toEqual(['terminate']);
    // In production the packing record says what is still to come.
    const live = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, id))!), 'QA1'));
    for (const text of ['not reconciled yet', '"not started"']) expect(live).toContain(text);
    // The window asks, per lot issued, what went back to stores unused: up to what was issued, in the published unit.
    expect((b.batch as unknown as { issued: object[] }).issued).toEqual([{ lot: 'LABEL-9', material: 'PM-101 · Vial label', value: '5250', unit: 'nos' }, { lot: 'TRAY-9', material: expect.stringMatching(/^PM-102 · /), value: '500', unit: 'nos' }]);
    const terminate = (returns?: object[]) => as('qa1', 'POST', `/api/batches/${id}/terminate`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash, reason: 'Labelling line 2 down for repair', ...(returns ? { returns } : {}) });
    expect((await terminate()).json()).toMatchObject({ error: 'invalid_values', problems: [expect.stringMatching(/^Say how much of lot LABEL-9 /), expect.stringMatching(/^Say how much of lot TRAY-9 /)] });
    expect((await terminate([{ lot: 'LABEL-9', value: '5300', unit: 'nos' }, { lot: 'TRAY-9', value: '0', unit: 'nos' }])).json())
      .toMatchObject({ problems: ['Lot LABEL-9: 5250 nos was issued to this batch; 5300 nos cannot have gone back to stores.'] });
    const r = await terminate([{ lot: 'LABEL-9', value: '300', unit: 'nos' }, { lot: 'TRAY-9', value: '0', unit: 'nos' }]);
    expect(r.statusCode, r.body).toBe(200);
    expect((await get(id)).batch).toMatchObject({ status: 'rejected', actions: [] });
    const no = (await t.owner<{ no: string }[]>`select batch_no as no from batches where id = ${id}`)[0]!.no;
    expect(await t.owner.unsafe(`select status from ${t.schema}_report.packing_batch_v1 where batch_number = $1`, [no])).toEqual([{ status: 'REJECTED' }]);
    // material_use_v1 gives back what went back to stores; the app counts the same (shared/engine/stock.ts).
    const used = await t.owner.unsafe(`select lot_number, quantity::text, unit from ${t.schema}_report.material_use_v1 where batch_number = $1 order by lot_number`, [no]);
    expect(used).toEqual([{ lot_number: 'LABEL-9', quantity: '4950', unit: 'nos' }, { lot_number: 'TRAY-9', quantity: '500', unit: 'nos' }]);
    const l = (await loadBatch(t.sql, id))!;
    expect(['LABEL-9', 'TRAY-9'].map((lot) => usesOfLot(l.doc, openSteps(l.doc, l.events, l.now).steps, lot, returnsOf(l.batchEvents))[0]!.quantity.value)).toEqual(['4950', '500']);
    const record = JSON.stringify(batchRecordDoc(await recordInput(t.sql, l, t.app.master), 'QA1'));
    expect(record).toMatch(/Terminated by QA1 at [^"]* IST: Labelling line 2 down for repair · Back to stores unused: lot LABEL-9 \(PM-101 · Vial label\) 300 nos, lot TRAY-9 \([^)]*\) 0 nos; the rest counts as used/);
    // The packing materials it stopped before issuing say so in plain words, not "Lot —: —".
    for (const text of ['Lot LABEL-9: 5250 nos · 1.2 Issue Vial label (PM-101)', 'not issued · 1.4 Issue Carton (PM-103)', 'not issued · 1.5 Issue Leaflet (PM-104)']) expect(record).toContain(text);
    expect(record).not.toContain('Lot —');
    // What it stopped before doing reads "terminated", never as still to come (owner, 16 Nov 2026).
    for (const text of ['"not reconciled (terminated)"', '"terminated, not started"']) expect(record).toContain(text);
    expect(record).not.toMatch(/\byet\b|"not started"|"in progress"/);
    expect((await issue({ line: 'ln-2', bulk: 'TI260004', units: '5000' })).statusCode).toBe(200);
  });

  it('TI-P6 the packing record runs to the end: materials issued and reconciled, checks alongside the line, finished goods; QC approves it, then QA releases it, and the line is free again', async () => {
    const id = first;
    const step = async (key: string, values: Record<string, unknown>) => {
      let s = (await get(id)).steps.find((x) => x.id === key)!;
      if (s.actions.includes('start')) expect((await as('op1', 'POST', `/api/batches/${id}/steps/${key}/start`)).statusCode).toBe(200);
      const r = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/record`, { values });
      expect(r.statusCode, `${key}: ${r.body}`).toBe(200);
      s = (await get(id)).steps.find((x) => x.id === key)!;
      const d = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/done`, { proof: proofFor('op1'), contentHash: s.contentHash });
      expect(d.statusCode, `${key} done: ${d.body}`).toBe(200);
      s = (await get(id, 'chk1')).steps.find((x) => x.id === key)!;
      if (s.state === 'done_awaiting_check') {
        const c = await as('chk1', 'POST', `/api/batches/${id}/steps/${key}/check`, { proof: proofFor('chk1'), contentHash: s.contentHash });
        expect(c.statusCode, `${key} check: ${c.body}`).toBe(200);
      }
      return s;
    };
    const yes = (...names: string[]) => Object.fromEntries(names.map((n) => [n, 'yes']));
    const line = { line: 'ln-1', ...handLabels('line', 'machine') };
    await step('0.1.0.1', { received: 'yes' });
    const issued: Record<string, string> = { label: '10500', tray: '1000', carton: '1000', leaflet: '1000' };
    for (const [i, k] of Object.keys(issued).entries()) await step(`0.1.${i + 1}.1`, { lot: `${k.toUpperCase()}-1`, ...handLabels('lot', 'lot'), issued: issued[k], matches: 'yes' });
    await step('1.1.0.1', { ...line, ...yes('noPrevious', 'coderCleared', 'rejectsEmpty', 'clean'), cleanedOn: '2026-11-15 07:00', cleanedBy: 'CLEANER ONE' });
    await step('1.1.1.1', yes('components', 'changeParts', 'coderSet', 'specimens'));
    const coding = await step('1.1.2.1', { printedBatch: 'TI260001', printedMfg: 'NOV.2026', printedExpiry: 'OCT.2028', printedMrp: 'Rs. 125.00', ...yes('legible', 'packingDone') });
    expect(coding.results.expiryCheck).toMatchObject({ check: { pass: true } });
    await step('1.1.3.1', yes('appearance', 'complete', 'samplesKept', 'packingDone'));
    await step('1.1.4.1', { cartons: '10', ...yes('leaflet', 'count', 'coded', 'packingDone') });
    // The packing stage is closed: the line stays in use by the batch (its reconciliation and line clearance run in the
    // packing rooms, PK-01's area), not dirty before the batch is finished with it.
    const lineUse = async () => (await t.owner.unsafe(`select ended_at is not null as ended from ${t.schema}_report.equipment_use_v1 where equipment_code = 'LL-01'
      and batch_number = (select batch_no from batches where id = $1)`, [id]))[0];
    expect(await t.owner`select 1 from batch_events where batch_id = ${id} and kind = 'stage_closed' and payload->>'stage' = '1'`).toHaveLength(1);
    expect(await lineUse()).toEqual({ ended: false });
    // The good packs and the yield are published once the finished goods step is signed: null until then.
    const yieldOf = async () => (await t.owner.unsafe(`select good_quantity::text, good_unit, yield_percent::text from ${t.schema}_report.packing_batch_v1
      where batch_number = (select batch_no from batches where id = $1)`, [id]))[0];
    expect(await yieldOf()).toEqual({ good_quantity: null, good_unit: 'packs', yield_percent: null });
    const fg = await step('2.1.0.1', { packs: '980', cartons: '98', shippers: '2', samples: '4', returned: '120', rejects: '40' });
    expect(fg.results.accountability).toMatchObject({ check: { pass: true } });
    // 980 good packs of the 1000 theoretical packs (10000 units ÷ 10 per pack).
    expect(await yieldOf()).toEqual({ good_quantity: '980', good_unit: 'packs', yield_percent: '98' });
    // Before the reconciliation MMS takes off the whole quantity issued.
    const usedOf = async (lot: string) => (await t.owner.unsafe(`select quantity::text from ${t.schema}_report.material_use_v1 where lot_number = $1
      and batch_number = (select batch_no from batches where id = $2)`, [lot, id]))[0]?.quantity as string | undefined;
    expect(await usedOf('LABEL-1')).toBe('10500');
    await step('2.1.1.1', { used: '9840', destroyed: '160', returned: '500' });
    // Once the reconciliation is signed, what went back to stores uncoded is no longer used (destroyed material is).
    expect(await usedOf('LABEL-1')).toBe('10000');
    await step('2.1.2.1', { used: '984', destroyed: '6', returned: '10' });
    await step('2.1.3.1', { used: '984', destroyed: '0', returned: '16' });
    await step('2.1.4.1', { what: 'Vial labels 160, cartons 6', method: 'shredded', destroyed: 'yes' });
    await step('2.1.5.1', { ...line, ...yes('noLeftover', 'coderCleared', 'leftoversDone') });

    let b = await get(id, 'sup1');
    expect(b.batch.status).toBe('manufacturing complete');
    expect((await as('sup1', 'POST', `/api/batches/${id}/production-approve`, { proof: proofFor('sup1'), contentHash: b.batch.contentHash })).statusCode).toBe(200);
    // TI-21: QC signs first (the finished packed product tested and complies, with the QC report number), then QA releases.
    b = await get(id, 'qa1');
    expect(b.batch).toMatchObject({ status: 'production approved', actions: [] });
    const early = await as('qa1', 'POST', `/api/batches/${id}/release`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ problems: ['Not possible while the batch is production approved.'] });
    expect(((await as('qa1', 'GET', '/api/batches/to-review')).json() as { id: number }[]).find((x) => x.id === id)).toBeUndefined();
    const forQc = (await as('qc1', 'GET', '/api/batches/to-review')).json() as { id: number; waiting: string; actions: string[] }[];
    expect(forQc.find((x) => x.id === id)).toMatchObject({ waiting: 'QC', actions: ['qc-approve'] });
    b = await get(id, 'qc1');
    const qc = await as('qc1', 'POST', `/api/batches/${id}/qc-approve`, { proof: proofFor('qc1'), contentHash: b.batch.contentHash, reportNo: 'QC-26-0101' });
    expect(qc.statusCode, qc.body).toBe(200);
    const [qcRow] = await t.owner.unsafe(`select status from ${t.schema}_report.packing_batch_v1 where batch_number = $1`, [(await loadBatch(t.sql, id))!.batch.batchNo]);
    expect(qcRow).toEqual({ status: 'QC_APPROVED' });
    b = await get(id, 'qa1');
    expect(b.batch).toMatchObject({ status: 'QC approved', actions: ['release', 'reject'] });
    const toReview = (await as('qa1', 'GET', '/api/batches/to-review')).json() as { id: number; waiting: string }[];
    expect(toReview.find((x) => x.id === id)).toMatchObject({ waiting: 'QA' });
    // Whole-suite run, S24: the bulk batch's deviation still open in the Deviations system is shown in the review and
    // blocks release until it is closed there (a closed one, or another batch's, does not).
    await t.owner.unsafe(`insert into ${TB}.deviation_v1 (number, status, batch, batch_norm, title, closed_at) values
      ('DEV-2026-0045', 'closure', 'TI260001', 'ti260001', 'Room refused at line clearance', null),
      ('DEV-2026-0044', 'closed', 'TI260001', 'ti260001', 'Closed before', now()),
      ('DEV-2026-0046', 'investigation', 'TI260003', 'ti260003', 'Another bulk batch', null)`);
    const review = async () => ((await as('qa1', 'GET', `/api/batches/${id}/review`)).json() as { bulkOpen: unknown }).bulkOpen;
    expect(await review()).toEqual({ bulk: 'TI260001', open: [{ number: 'DEV-2026-0045', status: 'closure', title: 'Room refused at line clearance', closedAt: null }] });
    const held = await as('qa1', 'POST', `/api/batches/${id}/release`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash });
    expect(held.statusCode).toBe(409);
    expect(held.json()).toMatchObject({ problems: ['Deviation DEV-2026-0045 of the bulk batch TI260001 is still open in the Deviations system (waiting for closure): it is closed there first'] });
    await t.owner.unsafe(`update ${TB}.deviation_v1 set status = 'closed', closed_at = now() where number = 'DEV-2026-0045'`);
    expect(await review()).toBeNull();
    const rel = await as('qa1', 'POST', `/api/batches/${id}/release`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash });
    expect(rel.statusCode, rel.body).toBe(200);
    expect((await get(id, 'qa1')).batch.status).toBe('released');

    // TI-22 for packing: the packing record PDF, with the pack, the filled units and the packing materials.
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, id))!, t.app.master), 'QA'));
    for (const text of ['Packing record TIP', 'TrueBatch Injectables Packing', 'batch TI260001', 'expiry 10/2028', 'QC report QC-26-0101', 'Packing materials', 'Lot LABEL-1: 10500 nos', '9840 nos used']) expect(pdf).toContain(text);
    expect(pdf).not.toContain('9840 units used');
    // A count in master data's name for it (cartons in nos), as on screen and in MMS: per pack, the lots issued, the values.
    for (const text of ['"10 nos per pack"', '"Quantity"', 'Lot CARTON-1: 1000 nos', 'Quantity issued: 1000 nos', 'Used in good packs: 984 nos']) expect(pdf).toContain(text);
    for (const text of ['"10 units"', 'Lot CARTON-1: 1000 units', 'Quantity issued: 1000 units']) expect(pdf).not.toContain(text);
    // A check's line that states its own question says it once.
    expect(pdf).toContain('Packing finished: ');
    expect(pdf).not.toMatch(/Packing finished: Packing finished/i);
    const res = await as('qa1', 'GET', `/api/batches/${id}/pdf`);
    expect(res.headers['content-type']).toContain('application/pdf');

    // The published view, for MMS finished goods later.
    const [row] = await t.owner.unsafe(`select batch_number, coded_batch_number, product_code, bulk_product_code, pack_type, units_per_pack, mfg_date, expiry_month, packs::text, cartons::text, status, released, shippers::text
      from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TI260001'`);
    expect(row).toMatchObject({ coded_batch_number: 'TI260001', product_code: 'PK-001', bulk_product_code: 'PRD-001', pack_type: 'carton', units_per_pack: 10, mfg_date: '2026-11-03',
      expiry_month: '2028-10', packs: '980', cartons: '98', status: 'RELEASED', released: true, shippers: '2' });
    // For the Logbook: the line used, as TrueBatch Injectables publishes its machines. For MMS: the packing materials issued,
    // per lot, in the material's unit, as TrueBatch Injectables publishes what it dispensed.
    const batchNo = (await loadBatch(t.sql, id))!.batch.batchNo;
    // One use of the line, for its whole packing stage (not the line named at issue, nor the clearance after packing);
    // named only in the line clearance, it was used by the stage: the Logbook reads "(Labelling and cartoning)".
    expect(await lineUse()).toEqual({ ended: true });
    const eq = await t.owner.unsafe(`select equipment_code, equipment_type, room_code, step, step_name, ended_at is not null as ended from ${t.schema}_report.equipment_use_v1 where batch_number = $1`, [batchNo]);
    expect(eq).toEqual([{ equipment_code: 'LL-01', equipment_type: 'labelling line', room_code: 'PK-01', step: 'packing/clearance', step_name: 'Labelling and cartoning', ended: true }]);
    const used = await t.owner.unsafe(`select lot_number, material_code, material_master_id, quantity::text, unit, step, status
      from ${t.schema}_report.material_use_v1 where batch_number = $1 order by step`, [batchNo]);
    // A count in master data's unit (nos). A printed material: issued less returned to stores uncoded (cartons 1000 − 10,
    // leaflets 1000 − 16, vial labels 10500 − 500); the trays, not printed and not reconciled, as issued.
    expect(used).toEqual([['CARTON-1', 'PM-103', 'pm-ctn', '990', 'nos', 'issue/issue-carton'], ['LABEL-1', 'PM-101', 'pm-lbl', '10000', 'nos', 'issue/issue-label'],
      ['LEAFLET-1', 'PM-104', 'pm-lft', '984', 'nos', 'issue/issue-leaflet'], ['TRAY-1', 'PM-102', 'pm-try', '1000', 'nos', 'issue/issue-tray']]
      .map(([lot_number, material_code, material_master_id, quantity, unit, step]) => ({ lot_number, material_code, material_master_id, quantity, unit, step, status: 'dispensed' })));
    // The app works out the same quantities when it compares a lot with MMS's stock (shared/engine/stock.ts).
    const done = (await loadBatch(t.sql, id))!;
    const steps = openSteps(done.doc, done.events, done.now).steps;
    for (const u of used as unknown as { lot_number: string; quantity: string }[]) expect(usesOfLot(done.doc, steps, u.lot_number).map((x) => x.quantity.value)).toEqual([u.quantity]);
    const cols = async (v: string) => (await t.owner.unsafe(`select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as c from information_schema.columns
      where table_schema = $1 and table_name = $2`, [`${t.schema}_report`, v]))[0]!.c as string;
    expect(await cols('material_use_v1')).toBe('batch_number text, lot_number text, material_code text, material_master_id text, quantity numeric, unit text, '
      + 'dispensed_at timestamp with time zone, step text, event_id bigint, status text, read_at timestamp with time zone, data_as_of timestamp with time zone, step_name text');
    expect(await cols('equipment_use_v1')).toBe('batch_number text, equipment_code text, equipment_type text, room_code text, step text, '
      + 'started_at timestamp with time zone, ended_at timestamp with time zone, read_at timestamp with time zone, data_as_of timestamp with time zone, step_name text');
    expect(await cols('deviation_note_v1')).toBe('note_id bigint, source_ref text, batch_number text, product_code text, step text, note text, reference text, status text, '
      + 'noted_at timestamp with time zone, read_at timestamp with time zone, data_as_of timestamp with time zone');

    // TI-P7: the line takes the next order once this one is finished.
    expect((await issue({ line: 'ln-1', bulk: 'TI260004', units: '5000' })).statusCode).toBe(200);
    // Its shippers are not counted yet: null, so MMS asks for them (the last column, for MMS finished goods).
    expect(await t.owner.unsafe(`select distinct shippers from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TI260004'`)).toEqual([{ shippers: null }]);
    // The yield columns (owner, 17 Nov 2026) are appended after it, never reordered.
    expect((await cols('packing_batch_v1')).split(', ').slice(-4)).toEqual(['shippers numeric', 'good_quantity numeric', 'good_unit text', 'yield_percent numeric']);
    expect(await t.owner.unsafe(`select distinct good_quantity, good_unit, yield_percent from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TI260004'`))
      .toEqual([{ good_quantity: null, good_unit: 'packs', yield_percent: null }]);
  });

  it('packing_batch_v1 good_quantity and yield_percent are null again while the finished goods step is sent back (0110, as TrueBatch Tablets Packing)', async () => {
    const [u] = await t.owner<{ id: number }[]>`select id::int from users order by id limit 1`;
    // Only what the view reads of a packing master: a pack, then the finished goods step.
    const doc = { header: { productCode: 'PK-SB' }, pack: { bulkCode: 'PRD-001', type: 'vial', unitsPerPack: 10 },
      stages: [{ key: 'r', steps: [{ key: 'i', block: { id: 'bulk-issue', version: 1 } }] }, { key: 'f', steps: [{ key: 'g', block: { id: 'finished-goods', version: 1 } }] }] };
    const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(doc as never)}, ${u!.id}) returning id::int`;
    const [b] = await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values ('PK-SB-1', ${v!.id}, ${u!.id}) returning id::int`;
    const add = (kind: string, payload: object) => t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
      values (${b!.id}, 1, 1, 0, 1, ${kind}, ${t.owner.json(payload as never)}, ${u!.id})`;
    const out = async () => (await t.owner.unsafe(`select good_quantity::text, yield_percent::text from ${t.schema}_report.packing_batch_v1 where batch_number = 'PK-SB-1'`))[0];
    await add('value', { values: { packs: { value: '990', unit: 'packs' } }, results: { yield: { ok: true, value: '99', unit: '%', shown: '' } } });
    await add('done', {});
    expect(await out()).toEqual({ good_quantity: '990', yield_percent: '99' });
    await add('sent_back', { reason: 'recount' });
    expect(await out()).toEqual({ good_quantity: null, yield_percent: null });
    await add('value', { values: { packs: { value: '985', unit: 'packs' } }, results: { yield: { ok: true, value: '98.5', unit: '%', shown: '' } } });
    await add('done', {});
    expect(await out()).toEqual({ good_quantity: '985', yield_percent: '98.5' });
  });

  it('gap 10, suite B2: the filled units issued are the good units still unpacked (batch_fact_v1.good_quantity less what packing batches issued from it), all or part; more is refused; a terminated packing batch gives its units back; without the column or the link: typed, as before', async () => {
    for (const n of [3, 4, 5, 6, 7]) t.master.equipment_.push({ ...item(`ln-${n}`, `LL-0${n}`, `Labelling line ${n}`), kind: 'equipment', type: 'labelling line', room: 'PK-01' });
    // The stand-in view so far had no good_quantity: every batch above was issued with its units typed.
    await t.owner.unsafe(`alter table ${TB}.batch_fact_v1 add column good_quantity numeric`);
    try {
      await t.owner.unsafe(`insert into ${TB}.batch_fact_v1 (batch_number, product_code, record_kind, status, issued_at, released, manufactured_on, good_quantity)
        values ('TI260006', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-08 06:00+00', true, '2026-11-08', 9600)`);
      // TI260001's packing batch above issued 10000 units of it: none left, so it is not offered.
      await t.owner.unsafe(`update ${TB}.batch_fact_v1 set good_quantity = 9600 where batch_number = 'TI260001'`);
      const picks = async () => ((await as('issuer', 'GET', '/api/bulk-batches?product=PRD-001')).json() as { batches: { batchNo: string; goodQuantity: string | null; remaining: string | null }[] })
        .batches.map((b) => [b.batchNo, b.goodQuantity, b.remaining]);
      expect(await picks()).toEqual([['TI260006', '9600', '9600'], ['TI260005', null, null], ['TI260004', null, null]]);
      expect((await issue({ line: 'ln-3', bulk: 'TI260001' })).json())
        .toMatchObject({ problems: ['Batch TI260001 has no units left to pack: its 9600 good units are all issued to packing batches.'] });
      // Part of it: 3000 units; the rest stays to be packed.
      const part = await issue({ line: 'ln-3', bulk: 'TI260006', units: '3000' });
      expect(part.statusCode, part.body).toBe(200);
      const s = (await get((part.json() as { id: number }).id)).steps[0]!;
      expect(s).toMatchObject({ values: { units: { value: '3000', unit: 'units' } }, source: { units: { from: 'truebatch_injectables' } } });
      expect(s.results.packs).toMatchObject({ ok: true, shown: '3000 units ÷ 10 units = 300 packs' });
      expect(await picks()).toContainEqual(['TI260006', '9600', '6600']);
      // More than is left, or not a whole number of units: refused.
      expect((await issue({ line: 'ln-4', bulk: 'TI260006', units: '7000' })).json())
        .toMatchObject({ problems: ['Batch TI260006 has 6600 good units still unpacked (9600 less 3000 already issued for packing): issue at most 6600.'] });
      expect((await issue({ line: 'ln-4', bulk: 'TI260006', units: '0' })).json()).toMatchObject({ problems: ['Filled units issued: give a whole number from 1 to 6600.'] });
      // Not typed: all that is left.
      const rest = await issue({ line: 'ln-4', bulk: 'TI260006' });
      expect(rest.statusCode, rest.body).toBe(200);
      const restId = (rest.json() as { id: number }).id;
      expect((await get(restId)).steps[0]!.values.units).toEqual({ value: '6600', unit: 'units' });
      expect((await picks()).map((b) => b[0])).not.toContain('TI260006');
      expect((await issue({ line: 'ln-5', bulk: 'TI260006', units: '1' })).json())
        .toMatchObject({ problems: ['Batch TI260006 has no units left to pack: its 9600 good units are all issued to packing batches.'] });
      // A terminated packing batch's units are not counted: they go back to be packed.
      const b = await get(restId, 'qa1');
      const end = await as('qa1', 'POST', `/api/batches/${restId}/terminate`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash, reason: 'Issued to the wrong line' });
      expect(end.statusCode, end.body).toBe(200);
      expect(await picks()).toContainEqual(['TI260006', '9600', '6600']);
      expect((await issue({ line: 'ln-5', bulk: 'TI260006', units: '6600' })).statusCode).toBe(200);
      // No good quantity in the view: typed, as before.
      const typed = await issue({ line: 'ln-6', bulk: 'TI260004', units: '100' });
      expect(typed.statusCode, typed.body).toBe(200);
      expect((await get((typed.json() as { id: number }).id)).steps[0]!.source.units).toBeUndefined();
      // The link down: the batch and its units typed from the labels, a second person checks them; nothing is compared.
      await t.owner.unsafe(`revoke select on ${TB}.batch_fact_v1 from ${PACKING_APP_ROLE}`);
      try {
        const hand = await issue({ line: 'ln-7', bulk: 'TI260006', units: '20000', mfgDate: '2026-11-08', 'bulk.released': 'yes', 'bulk.product': 'yes' });
        expect(hand.statusCode, hand.body).toBe(200);
        expect((await get((hand.json() as { id: number }).id)).steps[0]!).toMatchObject({ values: { units: { value: '20000' } }, source: { bulk: { from: 'hand', state: 'down' } } });
      } finally {
        await t.owner.unsafe(`grant select on ${TB}.batch_fact_v1 to ${PACKING_APP_ROLE}`);
      }
    } finally {
      await t.owner.unsafe(`delete from ${TB}.batch_fact_v1 where batch_number = 'TI260006'`);
      await t.owner.unsafe(`alter table ${TB}.batch_fact_v1 drop column good_quantity`);
    }
  });
});
