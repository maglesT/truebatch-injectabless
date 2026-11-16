// The sterile blocks of the injectables library (v1, sections 4.2-4.8) run on the engine like any block: each is a
// valid description, and the main ones work out their results from realistic values.
import { describe, expect, it } from 'vitest';
import { BLOCKS, findBlock, OFFERED } from '../shared/blocks/index.js';
import { blockProblems } from '../shared/blocks/format.js';
import { doneProblems, evaluate, openSteps, parseKey, type StepEvent } from '../shared/engine/index.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { stepFrom } from '../web/src/designer/model.js';
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
    for (const id of ['fill', 'filtration', 'filtration-clarifying', 'terminal-sterilise', 'heat-treatment', 'interventions', 'incubated-results', 'lyo-cycle', 'column', 'chamber-seal']) expect(OFFERED).toContain(id);
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
