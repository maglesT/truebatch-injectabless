// The sterile blocks of the injectables library (v1, sections 4.2-4.8) run on the engine like any block: each is a
// valid description, and the main ones work out their results from realistic values.
import { describe, expect, it } from 'vitest';
import { BLOCKS, findBlock, latestBlock } from '../shared/blocks/index.js';
import { LIBRARY } from '../web/src/designer/model.js';
import { blockProblems } from '../shared/blocks/format.js';
import { doneProblems, evaluate, openSteps, parseKey, usedQuantity, type StepEvent } from '../shared/engine/index.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { masterChecks } from '../shared/master/checks.js';
import { neededKind, quantityChoices, stepFrom } from '../web/src/designer/model.js';
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

  // 17 Nov 2026: aseptic blow-fill-seal and sterile powder filling.
  const latest = (id: string, settings: object): MasterDoc => {
    const b = latestBlock(id)!;
    return masterSchema.parse({ header, formula: [{ key: 'x', materialItemId: 'm', code: 'M', name: 'M', mg: '50.0', role: 'api' }],
      stages: [{ key: 's', name: 'Stage', kind: 'normal', steps: [{ ...stepFrom(b, []), key: 't', settings: { ...stepFrom(b, []).settings, ...settings } }] }] });
  };
  const c = (value: string) => ({ value, unit: '°C' });

  it('TI-14 powder-fill: the net powder of the units per round, the mean and each unit within their limits, the room humidity within its limit', () => {
    const b = latestBlock('powder-fill')!;
    expect([b.version, b.periodic, b.stop, b.fields.find((f) => f.name === 'machine')!.types]).toEqual([1, { maxMinutes: 1440 }, 'done', ['powder fill', 'auger']]);
    const doc = latest('powder-fill', { units: '4', meanLimit: { low: '1.040', high: '1.080', unit: 'g' }, eachLimit: { low: '1.010', high: '1.110', unit: 'g' },
      humidityLimit: { high: '35', unit: '%RH' } });
    expect(doc.stages[0]!.steps[0]).toMatchObject({ everyMinutes: 30, flow: { kind: 'repeat-until' } });
    const values = (weights: string[], rh: string) => ({ weights: weights.map(g), humidity: { value: rh, unit: '%RH' }, stoppers: 'yes', counter: { value: '1200', unit: 'units' }, filling: 'going on' });
    const r = run(doc, values(['1.061', '1.055', '1.068', '1.050'], '28'));
    expect(r.mean).toMatchObject({ ok: true, value: '1.0585', check: { pass: true } });
    expect(r.each).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.humidityCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.stopperCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.done).toMatchObject({ ok: true, check: { pass: false } });
    const bad = run(doc, values(['1.061', '1.055', '1.120', '1.050'], '38'));
    expect(bad.each).toMatchObject({ ok: true, check: { pass: false } });
    expect(bad.humidityCheck).toMatchObject({ ok: true, check: { pass: false } });
    // The limits are the product's own: the master check asks for them.
    expect(masterChecks(latest('powder-fill', {})).filter((p) => p.path.startsWith('stages[0].steps[0].settings')).map((p) => p.message))
      .toEqual(expect.arrayContaining(['Mean fill weight limits is not set', 'Each fill weight limits is not set', 'Room humidity limit is not set']));
  });

  it('TI-14 ffs-run version 2: each round also records the parison temperature (BFS, against its optional limits), the mould or tool, and the air filter check', () => {
    expect(findBlock({ id: 'ffs-run', version: 1 })!.fields.some((f) => f.name === 'parison')).toBe(false);
    const b = latestBlock('ffs-run')!;
    expect(b.version).toBe(2);
    expect(b.fields.map((f) => f.name)).toEqual(['machine', 'parison', 'mould', 'airFilter', 'weights', 'seals', 'leak', 'counter', 'filling']);
    const settings = { units: '3', meanLimit: { low: '2.00', high: '2.10', unit: 'g' }, eachLimit: { low: '1.95', high: '2.15', unit: 'g' } };
    const values = { mould: 'MLD-5ML-08', airFilter: 'yes', weights: [g('2.05'), g('2.04'), g('2.06')], seals: 'yes', leak: 'yes', counter: { value: '6000', unit: 'units' }, filling: 'going on' };
    const doc = latest('ffs-run', { ...settings, parisonLimit: { low: '165', high: '185', unit: '°C' } });
    const r = run(doc, { ...values, parison: c('178') });
    expect(r.parisonCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.airCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.mean).toMatchObject({ ok: true, check: { pass: true } });
    expect(run(doc, { ...values, parison: c('190') }).parisonCheck).toMatchObject({ ok: true, check: { pass: false } });
    expect(run(doc, { ...values, parison: c('178'), airFilter: 'no' }).airCheck).toMatchObject({ ok: true, check: { pass: false } });
    // A film form-fill-seal has no parison: left empty, nothing is checked.
    const film = run(latest('ffs-run', settings), values);
    expect(film.parisonCheck).toBeUndefined();
    expect(film.each).toMatchObject({ ok: true, check: { pass: true } });
  });

  it('F20 container-issue version 3: plastic granules issued and weighed back in kg; a count stays in units by default', () => {
    const doc = { ...latest('container-issue', { material: { formula: 'ldpe' }, unit: 'kg', expected: '250 kg', enoughLimit: { low: '100.0', unit: '%' } }) };
    doc.stages[0]!.steps.push({ ...stepFrom(latestBlock('container-return')!, []), key: 'back', settings: { material: { formula: 'ldpe' }, unit: 'kg' } });
    const kg = (value: string) => ({ value, unit: 'kg' });
    expect(run(doc, { lot: 'LDPE-26-004', issued: kg('255.0') }).enough).toMatchObject({ ok: true, check: { pass: true } });
    expect(run(doc, { lot: 'LDPE-26-004', issued: kg('240.0') }).enough).toMatchObject({ ok: true, check: { pass: false } });
    const st = doc.stages[0]!.steps[0]!;
    const back = { key: parseKey('0.1.1.1')!, values: { returned: kg('12.5') }, events: [{ kind: 'done' }] } as never;
    expect(usedQuantity(doc, st, { lot: 'LDPE-26-004', issued: kg('255.0') }, {}, [back])).toEqual(kg('242.5'));
    expect(stepFrom(latestBlock('container-issue')!, []).settings).toEqual({ expected: { header: 'units' }, unit: 'units' });
    expect(stepFrom(latestBlock('container-return')!, []).settings).toEqual({ unit: 'units' });
    // Run 3, H7: its words fit a weight as a count (the unit shows with the quantity).
    const b = latestBlock('container-issue')!;
    expect([...b.settings.map((x) => x.label), ...b.fields.map((f) => f.label), ...b.calcs.map((c) => c.label)].filter((l) => /unit|count/i.test(l))).toEqual(['Unit']);
    expect(b.settings.find((x) => x.name === 'enoughLimit')!.label).toBe('Quantity issued, in % of the quantity expected');
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

  it('F20 containers or closures issued by count: against the units expected from the header; MMS gets issued less returned', () => {
    // 100 L ÷ (10.0 + 0.5) mL = 9523 units expected; the starting masters ask for at least 102 % (9714).
    const doc = one('container-issue', { what: 'stoppers', enoughLimit: { low: '102.0', unit: '%' } });
    const st = doc.stages[0]!.steps[0]!;
    expect(st).toMatchObject({ checker: true, settings: { expected: { header: 'units' } } });
    const u = (value: string) => ({ value, unit: 'units' });
    expect(run(doc, { lot: 'P26-0013', issued: u('9800') }).enough).toMatchObject({ ok: true, check: { pass: true } });
    expect(run(doc, { lot: 'P26-0013', issued: u('9600') }).enough).toMatchObject({ ok: true, check: { pass: false } });
    expect(usedQuantity(doc, st, { lot: 'P26-0013', issued: u('9800') }, {}, [])).toEqual(u('9800'));
    expect(usedQuantity(doc, st, { lot: 'P26-0013', issued: u('9800'), returned: u('150') }, {}, [])).toEqual(u('9650'));
    expect(usedQuantity(doc, st, { lot: 'P26-0013', issued: u('100'), returned: u('150') }, {}, [])).toEqual(u('0'));
  });

  it('F19 the set-up and the seal check record their machine from the Logbook in a new version; the library offers only the latest', () => {
    expect(findBlock({ id: 'aseptic-ready', version: 3 })!.fields[0]).toEqual({ name: 'isolator', label: 'Isolator or RABS', kind: 'machine', types: ['isolator', 'rabs'] });
    // Run 2, G7: version 3 has no typed glove question (the Logbook decides the glove test through the isolator field).
    // Version 4 (aseptic blow-fill-seal, 17 Nov 2026): the same, and a BFS machine is taken in the isolator's place.
    expect(latestBlock('aseptic-ready')!.version).toBe(4);
    expect(latestBlock('aseptic-ready')!.fields[0]).toEqual({ name: 'isolator', label: 'Isolator, RABS or blow-fill-seal machine', kind: 'machine', types: ['isolator', 'rabs', 'blow'] });
    expect(latestBlock('aseptic-ready')!.fields.map((f) => f.name)).toEqual(['isolator', 'people', 'apsReport', 'apsDue', 'itemsUseBy', 'airflow', 'assembly']);
    expect(findBlock({ id: 'aseptic-ready', version: 2 })!.fields.some((f) => f.name === 'gloves')).toBe(true);
    expect(latestBlock('seal-check')!.fields[0]).toEqual({ name: 'capper', label: 'Capping machine', kind: 'machine', types: ['capping', 'crimper'] });
    // Version 1 stays as it was, for the batches recorded with it.
    expect(findBlock({ id: 'aseptic-ready', version: 1 })!.fields.some((f) => f.kind === 'machine')).toBe(false);
    expect(findBlock({ id: 'seal-check', version: 1 })!.fields.some((f) => f.kind === 'machine')).toBe(false);
    expect(LIBRARY.filter((b) => ['aseptic-ready', 'seal-check', 'container-issue'].includes(b.id)).map((b) => `${b.id} ${b.version}`))
      .toEqual(['seal-check 2', 'aseptic-ready 4', 'container-issue 3']);
    expect(LIBRARY.find((b) => b.id === 'container-return')!.version).toBe(2);
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

// Ported from TrueBatch Tablets (18 Nov 2026): a formula line picked for a value per mL or per unit gave the line's
// batch quantity (kg). The bulk correction's target concentration took it, and the batch stopped at the step.
describe('a formula line is only a mass (its batch quantity)', () => {
  const adjust = (target: object | string) => one('bulk-adjust', { target, donor: '0 mg/mL', direction: 'dilute with the vehicle', tolerance: '2.0' });
  const errorsAt = (doc: MasterDoc, name: string) => masterChecks(doc).filter((p) => p.level === 'error' && p.path === `stages[0].steps[0].settings.${name}`).map((p) => p.message);

  it('the target concentration and the donor are concentrations, so the designer offers no formula line for them', () => {
    const b = findBlock({ id: 'bulk-adjust', version: 1 })!;
    expect(neededKind(b, 'target')).toBe('mass concentration');
    expect(neededKind(b, 'donor')).toBe('mass concentration');
    expect(neededKind(b, 'largestLimit')).toBe('mass');
  });

  it('engine: a typed target works the quantity out; a formula line\'s batch quantity (kg) is refused at the step', () => {
    const values = { measured: { value: '52.0', unit: 'mg/mL' }, bulk: { value: '100.0', unit: 'kg' } };
    expect(run(adjust('50.0 mg/mL'), values).toAdd).toMatchObject({ ok: true, unit: 'kg' });
    expect(run(adjust({ formula: 'x' }), values).toAdd).toMatchObject({ ok: false });
  });

  it('master check: a formula line where a concentration or a number of units is needed is refused; a mass still takes one', () => {
    expect(errorsAt(adjust({ formula: 'x' }), 'target')).toEqual(['Target concentration: a formula line gives its batch quantity (a mass), but this step needs a mass concentration: type the value']);
    expect(errorsAt(adjust('50.0 mg/mL'), 'target')).toEqual([]);
    expect(errorsAt(one('unit-reconcile', { theoretical: { formula: 'x' } }), 'theoretical')).toEqual(['Theoretical units: a formula line gives its batch quantity (a mass), but this step needs a count: type the value']);
    expect(errorsAt(one('weigh', { target: { formula: 'x' } }), 'target')).toEqual([]);
  });
});

// Ported from TrueBatch Tablets round 31 (notBatch): a value per vial or container, or a tolerance, is never a batch
// quantity. A fill target of the batch volume (100 L) made every fill weight fail; a largest change of a batch quantity
// (kilograms) let every round of drying pass.
describe('a value per container or a tolerance is never a batch quantity', () => {
  const fill = (fillTarget: object | string) => one('fill', { needles: '2', band: '2', meanLimit: { low: '10.50', high: '10.75', unit: 'g' }, fillTarget, density: { header: 'density' } });
  const dry = (maxChange: object | string) => one('dry-constant', { maxChange }, { flow: { kind: 'repeat-until', maxRounds: 5 } });
  const errorsAt = (doc: MasterDoc, name: string) => masterChecks(doc).filter((p) => p.level === 'error' && p.path === `stages[0].steps[0].settings.${name}`).map((p) => p.message);

  it('only a quantity setting is marked', () => {
    const b = findBlock({ id: 'fill', version: 1 })!;
    expect(blockProblems({ ...b, settings: b.settings.map((s) => (s.name === 'needles' ? { ...s, notBatch: 'tablet' as const } : s)) }))
      .toEqual(['setting needles: only a quantity setting is marked not a batch quantity']);
    expect(b.settings.find((s) => s.name === 'fillTarget')?.notBatch).toBe('tablet');
    expect(findBlock({ id: 'dry-constant', version: 1 })!.settings[0]!.notBatch).toBe('tolerance');
  });

  it('master check: the fill target is the header\'s fill target or nominal fill, or typed; never the batch volume or a formula line', () => {
    expect(errorsAt(fill({ header: 'fillTarget' }), 'fillTarget')).toEqual([]);
    expect(errorsAt(fill({ header: 'fillVolume' }), 'fillTarget')).toEqual([]);
    expect(errorsAt(fill('10.5 mL'), 'fillTarget')).toEqual([]);
    expect(errorsAt(fill({ header: 'batchVolume' }), 'fillTarget')).toEqual(['Fill target (fill + excess) is a value per vial or container: pick the fill target or nominal fill from the header, an earlier step\'s result, or type it (the batch volume is per batch)']);
    expect(errorsAt(fill({ formula: 'x' }), 'fillTarget')).toEqual(['Fill target (fill + excess) is a value per vial or container: pick the fill target or nominal fill from the header, an earlier step\'s result, or type it (the batch quantity of M is per batch)']);
  });

  it('master check: the largest change between rounds is typed only', () => {
    expect(errorsAt(dry('0.05 g'), 'maxChange')).toEqual([]);
    expect(errorsAt(dry({ formula: 'x' }), 'maxChange')).toEqual(['Largest change between rounds is a tolerance: type it (the batch quantity of M is not a tolerance)']);
    expect(errorsAt(dry({ header: 'batchMass' }), 'maxChange')).toEqual(['Largest change between rounds is a tolerance: type it (the batch mass is not a tolerance)']);
  });

  it('designer: the picker offers what the master check takes', () => {
    const doc = fill('10.5 mL');
    expect(quantityChoices(doc, 0, 0, undefined, 'tablet')).toMatchObject({ lines: false, headers: ['fillVolume', 'fillTarget'] });
    expect(quantityChoices(doc, 0, 0, undefined, 'tolerance')).toEqual({ lines: false, headers: [], refs: [] });
    expect(quantityChoices(doc, 0, 0, 'mass')).toMatchObject({ lines: true, headers: ['batchMass'] });
  });
});

// Ported from TrueBatch Tablets round 37: a repeat-until step whose stop check reads an optional setting the master left
// unset never passes at run time (a limit check of an unset limit is left out), so the rounds could only end at the most
// rounds allowed.
describe('a repeat-until step whose stop check can never pass', () => {
  const flow = (stop?: string) => ({ flow: { kind: 'repeat-until', maxRounds: 5, ...(stop ? { stop } : {}) } });
  const never = (doc: MasterDoc) => masterChecks(doc).filter((p) => p.level === 'error' && /never passes/.test(p.message)).map((p) => `${p.path}: ${p.message}`);

  it('the pH check stops the rounds but the pH limits are not set: refused', () => {
    expect(never(one('bulk-test', {}, flow('phCheck')))).toEqual(['stages[0].steps[0].flow: pH stops the rounds, but pH limits is not set, so it never passes: set it, or pick the check that stops the rounds under More options']);
  });

  it('the limits set: taken; the other optional limits (not the stop check) stay optional; not a repeat-until step: nothing', () => {
    expect(never(one('bulk-test', { phLimit: { low: '6.8', high: '7.2', unit: 'pH' } }, flow('phCheck')))).toEqual([]);
    expect(never(one('bulk-test', {}))).toEqual([]);
  });

  it('only a limit check is left out: the filter integrity test (I19) without a product factor, wetted with water, still stops the rounds', () => {
    const ft = one('filter-test', { test: 'bubble point', resultUnit: 'bar g', makerLimit: '3.2 bar g', wettedWith: 'water' }, flow());
    expect(findBlock({ id: 'filter-test', version: 1 })!.stop).toBe('integrity');
    expect(never(ft)).toEqual([]);
  });

  it('no block\'s own stop check is a limit check on an optional setting (each stop check of the blocks as shipped can pass)', () => {
    const optional = BLOCKS.filter((b) => b.stop).flatMap((b) => {
      const c = b.calcs.find((x) => x.name === b.stop)!;
      return c.template !== 'C1' ? [] : [...JSON.stringify(c.args).matchAll(/"\$([a-zA-Z0-9]+)\?"/g)].filter(([, n]) => b.settings.some((s) => s.name === n)).map(([, n]) => `${b.id}.${n}`);
    });
    expect(optional).toEqual([]);
  });
});
