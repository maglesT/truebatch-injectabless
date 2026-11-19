import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links } from '../server/links.js';
import { findBlock } from '../shared/blocks/index.js';
import { blockProblems } from '../shared/blocks/format.js';
import { emOfBatch, emProblems, emText, emWindow, labTests, type EmRow, type EmWindow, type StepEvent } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { call, freshApp, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { ev, small } from './engine-fixture.js';

// Owner rule 19 Nov 2026 (duplicates review item 10): Medhanta LIMS owns the environmental monitoring results
// (report.em_v1). While LIMS answers, QC approval of an aseptic batch shows the EM samples of the batch's aseptic rooms
// and window read-only, and QC signs that it reviewed them; approval waits while a sample is undecided or an excursion
// has no deviation number. Alone (LIMS not linked) or LIMS down: the EM review is typed as before. em_v1 is a stand-in
// table in its own schema, read with TrueBatch's restricted login as on the platform.

const TZ = 'Asia/Kolkata';
const row = (o: Partial<EmRow> = {}): EmRow => ({ sampleNumber: 'EM26001', pointCode: 'A-01', pointName: 'Filling needle zone', roomCode: 'RM-301', grade: 'A',
  kind: 'settle plate', takenOn: '2026-11-18', sampledAt: null, batchNumber: null, value: '0', unit: 'CFU', limitText: '< 1 CFU', level: 'NONE',
  excursionStatus: 'NONE', deviationNumber: null, decision: 'APPROVED', ...o });
const w: EmWindow = { rooms: ['RM-301'], from: '2026-11-18T03:30:00.000Z', to: '2026-11-18T10:30:00.000Z' };

describe('the EM rules (shared/engine/em.ts)', () => {
  it('the batch\'s aseptic rooms and window come from what its aseptic stages recorded', () => {
    const doc = small([{ steps: [{}] }, { aseptic: true, steps: [{}, {}] }]);
    const t = (h: number) => new Date(Date.UTC(2026, 10, 18, h));
    const events: StepEvent[] = [
      { ...ev('started', '0.1.0.1'), at: t(1) },
      { ...ev('value', '0.1.0.1', { payload: { values: { m: { itemId: 'x', code: 'EQ-1', name: 'M', version: 1, room: 'RM-101' } } } }), at: t(1) },
      { ...ev('started', '1.1.0.1'), at: t(3) },
      { ...ev('value', '1.1.0.1', { payload: { values: { iso: { itemId: 'i', code: 'EQA-ISO-01', name: 'Isolator', version: 1, room: 'RM-301' }, x: '1' } } }), at: t(4) },
      { ...ev('value', '1.1.1.1', { payload: { values: { room: { itemId: 'r', code: 'RM-302', name: 'Room', version: 1, room: 'RM-302' } } } }), at: t(6) },
      { ...ev('done', '1.1.1.1'), at: t(9) },
    ];
    expect(emWindow(doc, events, t(12))).toEqual({ rooms: ['RM-301', 'RM-302'], from: t(3).toISOString(), to: t(9).toISOString() });
    expect(emWindow(small([{ steps: [{}] }]), events, t(12))).toEqual({ rooms: [], from: null, to: null });
  });

  it('a sample naming a batch is that batch\'s only; else its room and its time (or, from an older LIMS, its plant day)', () => {
    expect(emOfBatch(row(), 'TI260001', w, TZ)).toBe(true);
    expect(emOfBatch(row({ roomCode: 'RM-999' }), 'TI260001', w, TZ)).toBe(false);
    expect(emOfBatch(row({ takenOn: '2026-11-19' }), 'TI260001', w, TZ)).toBe(false);
    expect(emOfBatch(row({ batchNumber: 'ti260001', roomCode: 'RM-999' }), 'TI260001', w, TZ)).toBe(true);
    expect(emOfBatch(row({ batchNumber: 'TI260002' }), 'TI260001', w, TZ)).toBe(false);
    expect(emOfBatch(row({ sampledAt: '2026-11-18T05:00:00Z' }), 'TI260001', w, TZ)).toBe(true);
    // The same plant day, but taken after this batch's filling (another batch in the same room).
    expect(emOfBatch(row({ sampledAt: '2026-11-18T12:00:00Z' }), 'TI260001', w, TZ)).toBe(false);
  });

  it('TI-27 QC approval waits while a sample is undecided or an excursion has no deviation number; none at all waits too', () => {
    expect(emProblems([row()], w)).toEqual([]);
    expect(emProblems([], w)).toEqual(['LIMS has no EM samples of RM-301 for this batch yet: QC approval waits for them.']);
    expect(emProblems([row({ decision: null, level: null })], w)).toEqual(['EM sample EM26001 (Filling needle zone, RM-301) is not decided in LIMS yet.']);
    expect(emProblems([row({ value: '1', level: 'ACTION', excursionStatus: 'OPEN' })], w)).toEqual(['EM sample EM26001 (Filling needle zone, RM-301): the action excursion has no deviation number in LIMS.']);
    expect(emProblems([row({ value: '1', level: 'ACTION', excursionStatus: 'OPEN', deviationNumber: 'DEV-2026-0060' })], w)).toEqual([]);
    expect(emText([row(), row({ sampleNumber: 'EM26002', value: '1', level: 'ACTION', deviationNumber: 'DEV-2026-0060' })], w))
      .toBe('EM from LIMS: 2 samples of RM-301; 1 excursion: EM26002 action 1 CFU (DEV-2026-0060)');
    // An alert is a trend watch in LIMS (no investigation, no deviation number): listed, it does not hold approval.
    const alert = row({ sampleNumber: 'EM26003', value: '4', level: 'ALERT', excursionStatus: 'OPEN' });
    expect(emProblems([row(), alert], w)).toEqual([]);
    expect(emText([alert], w)).toBe('EM from LIMS: 1 sample of RM-301; 1 excursion: EM26003 alert 4 CFU');
    // An excursion LIMS opened without a level still needs its deviation number.
    expect(emProblems([row({ level: null, excursionStatus: 'OPEN' })], w)).toEqual(['EM sample EM26001 (Filling needle zone, RM-301): the excursion has no deviation number in LIMS.']);
  });

  it('the incubated results split: EM plates (without LIMS) and BI and bioburden (picked from LIMS as an in-process test)', () => {
    const plates = findBlock({ id: 'incubated-em', version: 1 })!;
    const lab = findBlock({ id: 'incubated-lab', version: 1 })!;
    expect(plates.fields.find((f) => f.name === 'kind')!.options).toEqual(['air sample', 'settle plate', 'contact plate', 'glove print']);
    expect(plates.fields.some((f) => f.qc)).toBe(false);
    expect(lab.fields.find((f) => f.name === 'kind')!.options).toEqual(['biological indicator', 'bioburden']);
    expect(labTests(lab.fields, (f) => f.unit ?? '', { count: 'incubated-lab.count' })).toEqual([{ code: 'incubated-lab.count', name: 'count', label: 'Count (CFU; a BI: 0 = no growth)', unit: 'CFU', individual: null }]);
    for (const b of [plates, lab]) expect(blockProblems(b)).toEqual([]);
    // Masters made before keep the old block.
    expect(findBlock({ id: 'incubated-results', version: 1 })).toBeDefined();
  });

  it('TI-27 with LIMS linked, the master check says a step typing EM plates would enter them twice; alone, nothing', () => {
    const doc = small([{ steps: [{}] }, { key: 'later', startsAfter: 's0/t0', steps: [{ key: 'plates', block: { id: 'incubated-em', version: 1 }, checker: true, settings: { countLimit: { high: '1', unit: 'CFU' } } }] }]);
    const said = (limsLinked: boolean) => masterChecks(doc, { limsLinked }).filter((p) => p.message.startsWith('LIMS is linked'));
    expect(said(true)).toEqual([expect.objectContaining({ level: 'warning', path: 'stages[1].steps[0]' })]);
    expect(said(false)).toEqual([]);
  });
});

let t: TestApp;
let provider: Sql;
let L = '';
const cookies: Record<string, string> = {};
beforeAll(async () => {
  t = await freshApp(async (db) => {
    L = `${db.schema}_em`;
    await db.owner.unsafe(`
      create schema ${L};
      create table ${L}.em_v1 (em_id uuid, sample_number text, plan_number text, plan_version int, point_code text, point_name text, point_kind text, room_code text,
        room_grade text, water_system text, sampling_kind text, state text, frequency text, taken_on date, test_key text, value numeric, unit text, shown text,
        limit_text text, alert_limit text, action_limit text, level text, excursion_status text, deviation_number text, decision text,
        read_at timestamptz default now(), data_as_of timestamptz default now());
      create table ${L}.coa_v1 (coa_id uuid, coa_number text, sample_number text, lot_number text, item_kind text, item_master_id text, item_code text,
        item_name text, purpose text, decision text, decided_at timestamptz, decided_by text, spec_number text, spec_version int, reason text,
        read_at timestamptz default now(), data_as_of timestamptz default now());
      create table ${L}.result_v1 (result_id uuid, coa_id uuid, coa_number text, test_name text, unit text, limit_text text, analysis_number text, decision text);
      grant usage on schema ${L} to truebatch_injectables_app;
      grant select on all tables in schema ${L} to truebatch_injectables_app;`);
    provider = connect(TEST_DATABASE_URL, { role: 'truebatch_injectables_app', link: true });
    return links({ lims: provider }, { lims: L });
  });
  t.master.products_.push({ itemId: 'p', code: 'P', name: 'P', version: 1, active: true, strength: null, dosageForm: 'injection' });
  t.master.materials_.push({ itemId: 'm', code: 'M', name: 'M', version: 1, active: true, category: null, unit: 'kg' });
  const people = { author: ['truebatch_injectables.master.author'], issuer: ['truebatch_injectables.batch.issue'], quinn: ['truebatch_injectables.qc.approve'] } as const;
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(async () => {
  await provider?.end();
  if (L) await t.owner.unsafe(`drop schema if exists ${L} cascade`);
  await t?.close();
});

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
const cut = () => t.owner.unsafe(`revoke select on all tables in schema ${L} from truebatch_injectables_app`);
const restore = () => t.owner.unsafe(`grant select on all tables in schema ${L} to truebatch_injectables_app`);
const yieldStep = { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } };
/** A production-approved batch whose second stage is aseptic and used the isolator in RM-301 today (its events as the routes write them). */
async function batch(aseptic = true) {
  const res = await as('author', 'POST', '/api/masters', { doc: small([{ steps: [yieldStep] }, { key: 'fill', steps: [{}, yieldStep] }]) });
  expect(res.statusCode, res.body).toBe(200);
  const { id: mv } = res.json() as { id: number };
  if (aseptic) await t.owner`update master_versions set doc = jsonb_set(doc, '{stages,1,aseptic}', 'true') where id = ${mv}`;
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${mv}`;
  const b = await as('issuer', 'POST', '/api/batches', { masterVersionId: mv, proof: proofFor('issuer') });
  expect(b.statusCode, b.body).toBe(200);
  const { id, batchNo } = b.json() as { id: number; batchNo: string };
  const ins = (kind: string, payload: object) => t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
    values (${id}, 1, 1, 0, 1, ${kind}, ${t.owner.json(payload as never)}, (select id from users where username = 'author'))`;
  await ins('started', {});
  await ins('value', { values: { iso: { itemId: 'i', code: 'EQA-ISO-01', name: 'Isolator', version: 1, type: 'Isolator', room: 'RM-301', area: 'Aseptic filling' } } });
  await ins('done', {});
  await t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${id}, 'production_approved', '{}', (select id from users where username = 'author'))`;
  await t.owner.unsafe(`insert into ${L}.coa_v1 (coa_id, coa_number, sample_number, lot_number, item_kind, item_master_id, item_code, item_name, purpose, decision, decided_at)
    values (gen_random_uuid(), $1, $2, $3, 'PRODUCT', 'p', 'P', 'P', 'release', 'APPROVED', now())`, [`COA-${batchNo}`, `LS-${batchNo}`, batchNo]);
  return { id, batchNo };
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
let n = 0;
async function sample(o: { room?: string; value?: string; level?: string | null; excursion?: string; deviation?: string | null; decision?: string | null; day?: string } = {}) {
  n += 1;
  const number = `EM26${String(n).padStart(4, '0')}`;
  await t.owner.unsafe(`insert into ${L}.em_v1 (em_id, sample_number, point_code, point_name, point_kind, room_code, room_grade, sampling_kind, taken_on, value, unit,
    level, excursion_status, deviation_number, decision) values (gen_random_uuid(), $1, 'A-01', 'Needle zone', 'ROOM', $2, 'A', 'settle plate', $3, $4, 'CFU', $5, $6, $7, $8)`,
  [number, o.room ?? 'RM-301', o.day ?? today(), o.value ?? '0', o.level === undefined ? 'NONE' : o.level, o.excursion ?? 'NONE', o.deviation ?? null, o.decision === undefined ? 'APPROVED' : o.decision]);
  return number;
}
const hash = async (id: number) => ((await as('quinn', 'GET', `/api/batches/${id}`)).json() as { batch: { contentHash: string } }).batch.contentHash;
const approve = async (b: { id: number; batchNo: string }, emReview?: string) => as('quinn', 'POST', `/api/batches/${b.id}/qc-approve`,
  { proof: proofFor('quinn'), reportNo: `COA-${b.batchNo}`, contentHash: await hash(b.id), ...(emReview ? { emReview } : {}) });
type Em = { link: string; pulled: boolean; window: EmWindow; rows: { sampleNumber: string }[]; problems: string[] };

describe('QC approval of an aseptic batch with LIMS linked: the EM is read from LIMS', () => {
  it('TI-27 the batch\'s EM samples are listed read-only; approval waits while one is undecided or an excursion has no deviation number', async () => {
    const b = await batch();
    const ok = await sample();
    const open = await sample({ value: '1', level: 'ACTION', excursion: 'OPEN', deviation: null });
    await sample({ room: 'RM-999' });                       // another room
    await sample({ day: '2026-01-05' });                    // another day
    const em = (await as('quinn', 'GET', `/api/batches/${b.id}/em`)).json() as Em;
    expect(em).toMatchObject({ link: 'ok', pulled: true, window: { rooms: ['RM-301'] } });
    expect(em.rows.map((r) => r.sampleNumber)).toEqual([ok, open]);
    expect(em.problems).toEqual([`EM sample ${open} (Needle zone, RM-301): the action excursion has no deviation number in LIMS.`]);
    expect((await approve(b)).json()).toMatchObject({ error: 'em_not_ready', problems: em.problems });
    // Typing the EM review while LIMS answers is refused.
    await t.owner.unsafe(`update ${L}.em_v1 set deviation_number = 'DEV-2026-0061' where sample_number = $1`, [open]);
    expect((await approve(b, 'EM-26-1: no excursion')).json()).toMatchObject({ error: 'invalid', problems: ['The EM review comes from LIMS: it is not typed while LIMS answers.'] });
    const r = await approve(b);
    expect(r.statusCode, r.body).toBe(200);
    const [e] = await t.owner<{ payload: { em: { shown: string; samples: object[] }; emReview?: string } }[]>`select payload from batch_events where batch_id = ${b.id} and kind = 'qc_approved'`;
    expect(e!.payload.emReview).toBeUndefined();
    expect(e!.payload.em.shown).toBe(`EM from LIMS: 2 samples of RM-301; 1 excursion: ${open} action 1 CFU (DEV-2026-0061)`);
    expect(e!.payload.em.samples).toHaveLength(2);
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, b.id))!, t.master), 'QUINN', new Date(), false));
    expect(pdf).toContain(`EM from LIMS: 2 samples of RM-301`);
  });

  it('TI-27 a sample LIMS names for this batch is taken wherever it is; one named for another batch is not', async () => {
    await t.owner.unsafe(`alter table ${L}.em_v1 add column sampled_at timestamptz, add column batch_number text`);
    try {
      const b = await batch();
      const mine = await sample({ room: 'RM-555' });
      await t.owner.unsafe(`update ${L}.em_v1 set batch_number = $1 where sample_number = $2`, [b.batchNo, mine]);
      const other = await sample();
      await t.owner.unsafe(`update ${L}.em_v1 set batch_number = 'TI269999' where sample_number = $1`, [other]);
      const em = (await as('quinn', 'GET', `/api/batches/${b.id}/em`)).json() as Em;
      expect(em.rows.map((r) => r.sampleNumber)).toContain(mine);
      expect(em.rows.map((r) => r.sampleNumber)).not.toContain(other);
    } finally { await t.owner.unsafe(`alter table ${L}.em_v1 drop column sampled_at, drop column batch_number`); }
  });

  it('TI-27 no EM in LIMS yet: approval waits for it', async () => {
    await t.owner.unsafe(`delete from ${L}.em_v1`);
    const b = await batch();
    expect((await approve(b)).json()).toMatchObject({ error: 'em_not_ready', problems: ['LIMS has no EM samples of RM-301 for this batch yet: QC approval waits for them.'] });
  });

  it('a batch with no aseptic stage types its EM review as before', async () => {
    const b = await batch(false);
    expect(((await as('quinn', 'GET', `/api/batches/${b.id}/em`)).json() as Em).pulled).toBe(false);
    expect((await approve(b)).json()).toMatchObject({ error: 'invalid' });
    expect((await approve(b, 'No aseptic processing: terminal route')).statusCode).toBe(200);
  });

  it('TI-27 LIMS down: the EM review is typed, marked typed by hand', async () => {
    const b = await batch();
    await cut();
    try {
      expect(((await as('quinn', 'GET', `/api/batches/${b.id}/em`)).json() as Em)).toMatchObject({ link: 'down', pulled: false });
      // The release CoA is typed too while LIMS is down.
      const r = await approve(b, 'EM-26-118, EM-26-119: no excursion');
      expect(r.statusCode, r.body).toBe(200);
    } finally { await restore(); }
    const [e] = await t.owner<{ payload: object }[]>`select payload from batch_events where batch_id = ${b.id} and kind = 'qc_approved'`;
    expect(e!.payload).toMatchObject({ emReview: 'EM-26-118, EM-26-119: no excursion', emSource: { from: 'hand', link: 'lims', state: 'down' } });
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, b.id))!, t.master), 'QUINN', new Date(), false));
    expect(pdf).toContain('EM review: EM-26-118, EM-26-119: no excursion (typed by hand: LIMS link down)');
  });

  it('the designer is told whether LIMS is linked', async () => {
    expect((await as('author', 'GET', '/api/links')).json()).toEqual({ lims: true });
  });
});

describe('alone (LIMS not linked)', () => {
  let alone: TestApp;
  beforeAll(async () => { alone = await freshApp(); });
  afterAll(async () => { await alone?.close(); });
  it('TI-27 the EM review is typed as today; the designer is told LIMS is not linked', async () => {
    await seedUser(alone.owner, 'author', ['truebatch_injectables.master.author']);
    const c = (await login(alone.app, 'author')).cookie;
    expect((await call(alone.app, c, 'GET', '/api/links')).json()).toEqual({ lims: false });
  });
});
