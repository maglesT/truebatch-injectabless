// The nine sterile rules of the minimum register (TI-23 to TI-31): what a master must hold for them, who may do the
// steps, and the use-by and result checks on the floor. The blocks' own calculations are in sterile-blocks.test.ts and
// the release's QC sign in batches.test.ts.
import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { refusal, stepNeeds, evaluate, parseKey } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { handProblem } from '../server/pull.js';
import { stepFrom } from '../web/src/designer/model.js';
import { unplaced } from './engine-fixture.js';

const step = (id: string, key: string, settings: object = {}) => { const s = stepFrom(findBlock({ id, version: 1 })!, []); return { ...s, key, settings: { ...s.settings, ...settings } }; };
// A complete aseptic liquid vial master: compounding, filtration, an aseptic filling stage, closing and inspection.
const vial = (): MasterDoc => masterSchema.parse({
  header: { productItemId: 'p', productCode: 'INJ-2', productName: 'Examplol 50 mg/mL injection', batchSize: '100', batchUnit: 'L', densityGPerMl: '1.012',
    fillVolumeMl: '10.0', fillExcessMl: '0.5', route: 'aseptic', claimPer: 'mL', dispensingRooms: ['D'] },
  formula: [{ key: 'api', materialItemId: 'a', code: 'API', name: 'Examplol', mg: '50.0', role: 'api' }, { key: 'wfi', materialItemId: 'w', code: 'WFI', name: 'Water for injections', role: 'solvent' }],
  stages: [
    { key: 'compound', name: 'Compounding', kind: 'normal', steps: [step('weigh', 'weigh'), step('filter-test', 'pre'), step('filtration', 'filter'), step('filter-test', 'post')] },
    { key: 'fill', name: 'Aseptic filling', kind: 'normal', aseptic: true, steps: [step('aseptic-ready', 'ready'), step('fill', 'fill'), step('interventions', 'log'), step('qa-sample', 'sterility'), step('seal-check', 'seal')] },
    { key: 'inspect', name: 'Inspection', kind: 'normal', steps: [step('visual-inspect', 'inspect')] },
  ],
});
const rules = (d: MasterDoc) => unplaced(masterChecks(d)).filter((p) => /^TI-(2[3-9]|3[01])$/.test(p.rule ?? '') || p.question?.key === 'pupsit').map((p) => `${p.rule ?? '-'} ${p.message}`);
const without = (stage: number, id: string) => { const d = vial(); d.stages[stage]!.steps = d.stages[stage]!.steps.filter((t) => t.block.id !== id); return rules(d); };

describe('the sterile rules in the master', () => {
  it('TI-23 a complete aseptic master has nothing missing', () => {
    expect(rules(vial())).toEqual([]);
  });

  it('TI-23 an aseptic master marks its aseptic stages, and each starts with the aseptic set-up (people, media fill, sterile items, gloves)', () => {
    const d = vial(); delete d.stages[1]!.aseptic;
    expect(rules(d)).toContain('TI-23 An aseptic master marks its aseptic stages (set-up, filling, closing): only aseptic operators work in them');
    expect(without(1, 'aseptic-ready')).toContain('TI-23 The aseptic stage Aseptic filling starts with the aseptic set-up (people, the line\'s media fill, sterilised items, gloves, grade A air)');
  });

  it('TI-25 an aseptic master filters with a bioburden sample and tests the filter before and after use (pre-use left out only by the risk assessment)', () => {
    expect(without(0, 'filtration')).toContain('TI-25 An aseptic master has its sterile filtration (with the bioburden sample just before the filter)');
    const d = vial(); d.stages[0]!.steps = d.stages[0]!.steps.filter((t) => t.key !== 'pre');
    expect(rules(d)).toEqual([expect.stringMatching(/^- An aseptic master tests the sterilising filter before use/)]);
  });

  // 17 Nov 2026: aseptic blow-fill-seal (a liquid, filtered) and a sterile powder filled as it is (no filtration).
  const bfs = (): MasterDoc => { const d = vial(); d.stages[1]!.steps = [step('aseptic-ready', 'ready'), step('interventions', 'log'), step('ffs-run', 'bfs'), step('qa-sample', 'sterility')];
    d.stages[2]!.steps.unshift(step('leak-test-100', 'leak')); return d; };
  const powder = (): MasterDoc => { const d = vial(); d.header = { ...d.header, batchUnit: 'units', batchSize: '20000', claimPer: 'container (filled content)' };
    delete d.header.densityGPerMl; delete d.header.fillVolumeMl; delete d.header.fillExcessMl;
    d.stages[0] = { ...d.stages[0]!, name: 'Sterile dispensing', steps: [step('weigh', 'weigh')] };
    d.stages[1]!.steps = d.stages[1]!.steps.map((t) => (t.block.id === 'fill' ? step('powder-fill', 'fill') : t)); return d; };

  it('TI-23 TI-25 TI-28 an aseptic blow-fill-seal master and a sterile powder master hold every sterile rule; a powder has no filtration', () => {
    expect(rules(bfs())).toEqual([]);
    expect(rules(powder())).toEqual([]);
    // Blow-fill-seal is a liquid: filtered and its filter tested as any aseptic liquid; a powder filtered after all tests its filter.
    const unfiltered = bfs(); unfiltered.stages[0]!.steps = unfiltered.stages[0]!.steps.filter((t) => t.block.id !== 'filtration');
    expect(rules(unfiltered)).toEqual(['TI-25 An aseptic master has its sterile filtration (with the bioburden sample just before the filter)']);
    const filtered = powder(); filtered.stages[0]!.steps.push(step('filtration', 'filter'));
    expect(rules(filtered)).toEqual([expect.stringMatching(/^- An aseptic master tests the sterilising filter before use/), 'TI-25 The sterilising filter is integrity tested after use']);
    // The interventions log in the aseptic stage of each; the samples, closing and inspection as for a vial.
    for (const d of [bfs(), powder()]) {
      d.stages[1]!.steps = d.stages[1]!.steps.filter((t) => t.block.id !== 'interventions');
      expect(rules(d)).toEqual(['TI-28 The aseptic filling stage Aseptic filling has an interventions and stoppages log']);
    }
    const p = powder(); p.stages[1]!.steps = p.stages[1]!.steps.filter((t) => !['qa-sample', 'seal-check'].includes(t.block.id)); p.stages[2]!.steps = [];
    expect(rules(p)).toEqual(['TI-26 The master takes the sterility and endotoxin samples where the release needs them (each sub-batch or load)',
      'TI-29 The master closes and checks the containers (seal check or 100 % container-closure test)', 'TI-30 Every filled unit is inspected (100 % visual inspection)']);
    // Library check 37 holds for blow-fill-seal: nothing added between the sterile filtration and the fill.
    const added = bfs(); added.stages[1]!.steps.splice(2, 0, step('charge', 'late'));
    expect(unplaced(masterChecks(added)).filter((x) => x.rule === 'TI-25').map((x) => x.message)).toEqual([expect.stringMatching(/comes between the sterile filtration and filling/)]);
  });

  it('TI-26 the master takes the sterility and endotoxin samples; incubated results are read in a stage that starts after the sampling', () => {
    expect(without(1, 'qa-sample')).toContain('TI-26 The master takes the sterility and endotoxin samples where the release needs them (each sub-batch or load)');
    const d = vial(); d.stages[2]!.steps.push(step('incubated-results', 'plates'));
    expect(rules(d)).toContain('TI-26 Incubated results (EM, BIs, bioburden) are read in a stage that starts after the step that took the samples');
  });

  it('TI-28 an aseptic filling stage has its interventions log', () => {
    expect(without(1, 'interventions')).toContain('TI-28 The aseptic filling stage Aseptic filling has an interventions and stoppages log');
  });

  it('TI-29 the containers are closed and checked', () => {
    expect(without(1, 'seal-check')).toContain('TI-29 The master closes and checks the containers (seal check or 100 % container-closure test)');
  });

  it('TI-30 every filled unit is inspected', () => {
    expect(without(2, 'visual-inspect')).toContain('TI-30 Every filled unit is inspected (100 % visual inspection)');
  });

  it('TI-31 freeze-drying has its loading and its stoppering and unloading', () => {
    const d = vial(); d.stages[1]!.steps.push(step('lyo-cycle', 'lyo'));
    expect(rules(d)).toContain('TI-31 Freeze-drying has its loading and its stoppering and unloading with the cycle');
  });
});

describe('the sterile rules on the floor', () => {
  const ctx = (permissions: string[], needs?: string) => ({ state: 'open' as const, events: [], flow: 'none' as const, user: { id: 1, permissions }, needs });
  const operate = 'truebatch_injectables.batch.operate';

  it('TI-23 only an aseptic operator (a QA-given permission) works the steps of an aseptic stage', () => {
    const d = vial();
    const needs = stepNeeds(d.stages[1], findBlock(d.stages[1]!.steps[1]!.block));
    expect(needs).toBe('truebatch_injectables.batch.aseptic');
    expect(refusal('start', ctx([operate], needs))).toMatchObject({ status: 403, message: expect.stringMatching(/Only an aseptic operator/) });
    expect(refusal('start', ctx([operate, 'truebatch_injectables.batch.aseptic'], needs))).toBeNull();
    expect(stepNeeds(d.stages[0], findBlock(d.stages[0]!.steps[0]!.block))).toBeUndefined();
  });

  it('TI-30 only a visual inspector records the visual inspection', () => {
    const d = vial();
    const needs = stepNeeds(d.stages[2], findBlock(d.stages[2]!.steps[0]!.block));
    expect(refusal('start', ctx([operate], needs))).toMatchObject({ status: 403, message: expect.stringMatching(/Only a visual inspector/) });
    expect(refusal('start', ctx([operate, 'truebatch_injectables.batch.inspect'], needs))).toBeNull();
  });

  it('TI-24 TI-17 a sterilised load past its use-by date cannot be used (re-sterilise); the media fill past its due date neither', () => {
    const transfer = findBlock({ id: 'transfer-in', version: 1 })!.fields.find((f) => f.name === 'useBy')!;
    expect(handProblem({ ...transfer, name: 'useBy.expiry' }, '2026-11-14', new Date('2026-11-16T06:00:00Z'), 'Asia/Kolkata')).toMatch(/has passed: the item may not be used/);
    const aps = findBlock({ id: 'aseptic-ready', version: 1 })!.fields.find((f) => f.name === 'apsDue')!;
    expect(aps.useBy).toBe(true);
  });

  it('TI-27 an EM count at a grade\'s action limit fails and needs a deviation note; grade A is no growth', () => {
    const doc = masterSchema.parse({ ...vial(), stages: [{ key: 'em', name: 'Plates read', kind: 'preparation', startsAfter: undefined, steps: [step('incubated-results', 'plates', { countLimit: { high: '0', unit: 'CFU' } })] }] });
    const r = (count: string) => evaluate(doc, [], parseKey('0.1.0.1')!, { count: { value: count, unit: 'CFU' }, incubationStart: '2026-11-15T08:00:00Z', incubationEnd: '2026-11-20T08:00:00Z' }).countCheck;
    expect(r('0')).toMatchObject({ ok: true, check: { pass: true } });
    expect(r('1')).toMatchObject({ ok: true, check: { pass: false } });
  });
});

describe('the sterility assurance summary at release', () => {
  it('TI-29 a round followed by another is not out of limits there (its stop check reads as the rounds going on); a real failure is', async () => {
    const { summaryOf } = await import('../web/src/release/SterileSummary.js');
    const block = findBlock({ id: 'seal-check', version: 1 })!;
    const goingOn = { ok: true, value: '0', unit: '', shown: '', check: { pass: false, level: 'fail', shown: 'Sealing: going on: FAIL' } };
    const pass = { ok: true, value: '0', unit: 'units', shown: '', check: { pass: true, level: 'pass', shown: 'Defective units: 0 units: within limits' } };
    const row = (results: object, notYet?: string) => ({ key: { stage: 0, sub: 1, step: 0, round: 1 }, id: '0.1.0.1', results, values: {}, notYet }) as never;
    const r1 = summaryOf(row({ done: goingOn, defectCheck: pass }, 'done'), block);
    expect(r1.bad).toBe(false);
    expect(r1.said.join(' ')).toMatch(/not reached in this round; the next round followed/);
    expect(summaryOf(row({ done: goingOn, defectCheck: { ...pass, check: { pass: false, level: 'fail', shown: 'Defective units: 2 units: OUT OF LIMITS' } } }, 'done'), block).bad).toBe(true);
  });

  it('run 2 G8: the summary names the isolator or RABS and the capping machine used, with their LEAD status as the step recorded it', async () => {
    const { summaryOf } = await import('../web/src/release/SterileSummary.js');
    const { latestBlock } = await import('../shared/blocks/index.js');
    const iso = { itemId: 'i', code: 'EQS-ISO-01', name: 'Filling isolator', version: 1, type: 'Isolator', room: 'RM-207', area: 'Aseptic filling' };
    const row = (values: object, source: object) => ({ key: { stage: 0, sub: 1, step: 0, round: 1 }, id: '0.1.0.1', results: {}, values, source }) as never;
    expect(summaryOf(row({ isolator: iso, people: 'yes' }, { isolator: { from: 'logbook', asOf: null, shown: 'EQS-ISO-01: clean' } }), latestBlock('aseptic-ready')).said[0])
      .toBe('Isolator, RABS or blow-fill-seal machine: EQS-ISO-01 · Filling isolator (LEAD at use: EQS-ISO-01: clean)');
    const cap = { ...iso, code: 'EQS-CAP-01', name: 'Vial capping machine', type: 'Capping machine' };
    expect(summaryOf(row({ capper: cap }, { capper: { from: 'hand', link: 'logbook', state: 'down' } }), latestBlock('seal-check')).said[0])
      .toBe('Capping machine: EQS-CAP-01 · Vial capping machine (LEAD down at use: its status answered by hand)');
    // Display backlog 12: the line's media fill with its outcome and next date in words, not the protocol number only.
    const aps = { from: 'qual', asOf: null, shown: 'Qualification media fill PRT-2026-0058 of RM-207: pass, next 2027-05-18' };
    expect(summaryOf(row({ isolator: iso, apsReport: 'PRT-2026-0058', apsDue: '2027-05-18' }, { apsReport: aps }), latestBlock('aseptic-ready')).said[1])
      .toBe('Line media fill PRT-2026-0058 of RM-207: pass, next 18 May 2027 (Qualification)');
    expect(summaryOf(row({ apsReport: 'APS-7', apsDue: '2027-05-18' }, { apsReport: { from: 'hand', link: 'qual', state: 'down' } }), latestBlock('aseptic-ready')).said[0])
      .toBe('Line media fill APS-7 (typed by hand), next due 18 May 2027');
  });

  it('a short duration reads in minutes or seconds, not as a long raw figure (17 Nov 2026 run, F23)', async () => {
    const { shortTime } = await import('../web/src/release/SterileSummary.js');
    expect(shortTime('Settle plate exposure: 0.0002777… h rounded to 0 decimals (as the limit is written) = 0 h'))
      .toBe('Settle plate exposure: about 1 s; in h rounded to 0 decimals (as the limit is written) = 0 h');
    expect(shortTime('0.2541666… h')).toBe('about 15.25 min');
    expect(shortTime('4.1234… h and 3.5 h')).toBe('about 4.12 h and 3.5 h');
  });
});
