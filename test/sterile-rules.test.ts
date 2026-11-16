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
