// The sterile blocks of the injectables library (v1, sections 4.2-4.8) run on the engine like any block: each is a
// valid description, and the main ones work out their results from realistic values.
import { describe, expect, it } from 'vitest';
import { BLOCKS, findBlock } from '../shared/blocks/index.js';
import { LIBRARY } from '../web/src/designer/model.js';
import { blockProblems } from '../shared/blocks/format.js';
import { doneProblems, evaluate, openSteps, parseKey, type StepEvent } from '../shared/engine/index.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { masterChecks } from '../shared/master/checks.js';
import { stepFrom } from '../web/src/designer/model.js';
import { workedExample } from '../web/src/designer/example.js';
import { at, ev } from './engine-fixture.js';

// A liquid vial batch: 100 L at 1.012 g/mL, filled at 10.0 mL + 0.5 mL excess.
const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100', batchUnit: 'L', densityGPerMl: '1.012', fillVolumeMl: '10.0', fillExcessMl: '0.5', dispensingRooms: ['D'] };
const one = (id: string, settings: object, extra: object = {}): MasterDoc => {
  const b = findBlock({ id, version: 1 })!;
  return masterSchema.parse({ header, formula: [{ key: 'x', materialItemId: 'm', code: 'M', name: 'M', mg: '50.0', role: 'api' }],
    stages: [{ key: 's', name: 'Stage', kind: 'normal', steps: [{ ...stepFrom(b, []), key: 't', settings: { ...stepFrom(b, []).settings, ...settings }, ...extra }] }] });
};
const run = (doc: MasterDoc, values: object) => evaluate(doc, [], parseKey('0.1.0.1')!, values as never);
const g = (value: string) => ({ value, unit: 'g' });

describe('the sterile blocks of the injectables library', () => {
  it('library v1: every block is a valid description, and the designer offers the sterile ones', () => {
    for (const b of BLOCKS) expect([b.id, blockProblems(b)]).toEqual([b.id, []]);
    for (const id of ['fill', 'filtration', 'filtration-clarifying', 'terminal-sterilise', 'heat-treatment', 'interventions', 'incubated-results', 'lyo-cycle', 'column', 'chamber-seal']) expect(LIBRARY.map((b) => b.id)).toContain(id);
  });

  it('TI-14 fill: the target fill weight comes from the header (10.5 mL × 1.012 g/mL = 10.626 g); one weight per needle (N4)', () => {
    const doc = one('fill', { needles: '4', meanLimit: { low: '10.50', high: '10.75', unit: 'g' }, band: '2.0' });
    const r = run(doc, { weights: [g('10.62'), g('10.64'), g('10.60'), g('10.66')], stoppers: 'yes', counter: { value: '1200', unit: 'units' }, filling: 'going on' });
    expect(r.target).toMatchObject({ ok: true, value: '10.626', unit: 'g' });
    expect(r.mean).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.each).toMatchObject({ ok: true, check: { pass: true } });
    const low = run(doc, { weights: [g('10.62'), g('10.64'), g('10.30'), g('10.66')], stoppers: 'yes', counter: { value: '1200', unit: 'units' }, filling: 'going on' });
    expect(low.each).toMatchObject({ ok: true, check: { pass: false } });
  });

  it('TI-13 make-up: the batch weight to reach is the batch volume × density, the reading within ± 0.5 %', () => {
    const doc = one('make-up', {});
    const r = run(doc, { gross: { value: '1351.4', unit: 'kg' }, tare: { value: '339.2', unit: 'kg' }, temperature: { value: '22', unit: '°C' } });
    expect(r.target).toMatchObject({ ok: true, value: '101.2', unit: 'kg' });
    expect(r.netCheck).toMatchObject({ ok: true, check: { pass: false } });
    const ok = run(doc, { gross: { value: '440.5', unit: 'kg' }, tare: { value: '339.2', unit: 'kg' } });
    expect(ok.netCheck).toMatchObject({ ok: true, check: { pass: true } });
  });

  it('TI-25 filter integrity: a product-wetted bubble point uses the product factor; without it the test is refused', () => {
    const settings = { test: 'bubble point', resultUnit: 'bar g', makerLimit: '3.45 bar g', wettedWith: 'product', productFactor: '0.92', temperatureRange: { low: '15', high: '25', unit: '°C' } };
    const values = { result: { value: '3.20', unit: 'bar g' }, temperature: { value: '21', unit: '°C' }, asMaster: 'yes' };
    expect(run(one('filter-test', settings), values).integrity).toMatchObject({ ok: true, check: { pass: true } });
    const { productFactor: _, ...without } = settings;
    expect(run(one('filter-test', without), values).integrity).toMatchObject({ ok: false, message: expect.stringMatching(/needs the product factor/) });
    // The designer's worked example starts at the step's own limits, so a right master passes (17 Nov 2026 run, F7).
    const ex = workedExample(one('filter-test', { ...without, wettedWith: 'water', makerLimit: '3.2 bar g' }), 0, 0);
    expect(ex.values).toMatchObject({ result: { value: '3.2', unit: 'bar g' }, temperature: { value: '20', unit: '°C' } });
    expect(ex.results.integrity).toMatchObject({ ok: true, check: { pass: true } });
  });

  it('TI-24 terminal sterilisation: the lowest probe lethality against the validated minimum F0', () => {
    const doc = one('terminal-sterilise', { medium: 'moist heat', lethalityLimit: { low: '15', unit: 'F-min' } });
    const base = { units: { value: '9600', unit: 'units' }, exposure: { value: '15', unit: 'min' }, maxProduct: { value: '122.4', unit: '°C' }, pattern: 'yes', indicators: 'yes', apart: 'yes' };
    expect(run(doc, { ...base, lowestF: { value: '16.2', unit: 'F-min' } }).lethality).toMatchObject({ ok: true, check: { pass: true } });
    expect(run(doc, { ...base, lowestF: { value: '12.0', unit: 'F-min' } }).lethality).toMatchObject({ ok: true, check: { pass: false } });
  });

  it('TI-24 irradiation: every box at or above the validated minimum dose (a dose typed in Mrad converts)', () => {
    const doc = one('irradiation', { boxCount: '3', minDoseLimit: { low: '25', unit: 'kGy' }, maxDoseLimit: { high: '40', unit: 'kGy' } });
    const kgy = (...v: string[]) => v.map((value) => ({ value, unit: 'kGy' }));
    const r = run(doc, { minDose: kgy('26.1', '25.4', '24.0'), maxDose: kgy('33', '34', '31'), indicator: 'yes', unitsSent: { value: '3000', unit: 'units' }, unitsBack: { value: '3000', unit: 'units' } });
    expect(r.minCheck).toMatchObject({ ok: true, check: { pass: false } });
  });

  it('TI-18 unit reconciliation: theoretical units from the header (10,000 L ÷ 10.5 mL), yield and accountability', () => {
    const doc = one('unit-reconcile', { yieldLimit: { low: '95.0', unit: '%' }, accountabilityLimit: { low: '99.5', high: '100.5', unit: '%' } });
    const u = (value: string) => ({ value, unit: 'units' });
    const r = run(doc, { good: u('9214'), fillRejects: u('120'), inspectionRejects: u('88'), samples: u('60'), removed: u('40'), other: u('1') });
    expect(r.yield).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.accountability).toMatchObject({ ok: true, check: { pass: true } });
  });

  it('TI-08 a sterilised load past its use-by date during the step needs a deviation note (engine change 6)', () => {
    const doc = one('transfer-in', {});
    const day = (d: string) => new Date(`${d}T10:00:00+05:30`);
    const events: StepEvent[] = [{ ...ev('started', '0.1.0.1'), at: day('2026-11-15') },
      { ...ev('value', '0.1.0.1', { payload: { values: { item: 'Stopper bowl', load: 'AC-26-114', useBy: '2026-11-15', method: 'RTP port', intact: 'yes' }, results: {} } }), at: day('2026-11-15') }];
    const v = openSteps(doc, events, day('2026-11-16')).steps[0]!;
    expect(doneProblems(doc, v, day('2026-11-16'))).toContain('Use-by date of the load expired on 15 Nov 2026, during this step. Add a deviation note first.');
    expect(at(0)).toBeInstanceOf(Date);
  });
});

describe('an optional reading', () => {
  it('left blank checks nothing: its limit check is left out, not failed; given, it is checked against its limit', () => {
    const doc = one('bulk-test', { phLimit: { low: '6.5', high: '7.5', unit: 'pH' }, solventLimit: { high: '50', unit: 'ppm' } });
    const blank = run(doc, { reference: 'S-1', ph: { value: '7.0', unit: 'pH' }, appearance: 'yes' });
    expect(blank.phCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(blank.solventCheck).toBeUndefined();
    expect(run(doc, { reference: 'S-1', ph: { value: '7.0', unit: 'pH' }, solvent: { value: '80', unit: 'ppm' }, appearance: 'yes' }).solventCheck).toMatchObject({ ok: true, check: { pass: false } });
    // Nothing recorded yet: the master check finds no calculation to refuse.
    expect(Object.values(run(doc, {})).filter((r) => !r.ok)).toEqual([]);
  });

  it('against an optional limit the master did not set checks nothing: the reading is kept, its check left out', () => {
    const doc = one('vehicle', {});
    const v = findBlock({ id: 'vehicle', version: 1 })!;
    const values = Object.fromEntries(v.fields.filter((f) => f.kind === 'number').map((f) => [f.name, { value: '25', unit: f.unit ?? '' }]));
    const r = run(doc, values);
    expect(Object.values(r).filter((x) => !x.ok)).toEqual([]);
    expect(Object.keys(r).filter((k) => /Check$/.test(k))).toEqual([]);
  });
});

describe('a limit of the wrong kind', () => {
  it('is refused by the master check: a minimum lethality written in minutes, not F-min (found in the first batch run)', () => {
    const wrong = masterChecks(one('terminal-sterilise', { medium: 'moist heat', lethalityLimit: { low: '15', unit: 'min' } })).filter((p) => /lethality limit is needed/.test(p.message));
    expect(wrong).toEqual([expect.objectContaining({ level: 'error', path: 'stages[0].steps[0].settings.lethalityLimit' })]);
    expect(masterChecks(one('terminal-sterilise', { medium: 'moist heat', lethalityLimit: { low: '15', unit: 'F-min' } })).filter((p) => /limit is needed/.test(p.message))).toEqual([]);
  });
});

describe('fill-weight limits and the fill target', () => {
  it('the master check warns when a fill\'s mean fill-weight limits do not contain the fill target (owner, 17 Nov 2026)', () => {
    // header: 10.0 mL + 0.5 mL excess × 1.012 g/mL = 10.626 g
    const warns = (meanLimit: object) => masterChecks(one('fill', { needles: '2', band: '2', meanLimit })).filter((p) => /do not contain the fill target/.test(p.message));
    expect(warns({ low: '10.500', high: '10.750', unit: 'g' })).toEqual([]);
    expect(warns({ low: '2.130', high: '2.200', unit: 'g' })).toEqual([expect.objectContaining({ level: 'warning', path: 'stages[0].steps[0].settings.meanLimit' })]);
    expect(warns({ low: '0.0105', high: '0.0108', unit: 'kg' })).toEqual([]);
  });
});
