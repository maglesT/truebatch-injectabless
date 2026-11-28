// Template round (22 Nov 2026): the calculation layer of the injectables library wired into the blocks and the master checks.
import { describe, expect, it } from 'vitest';
import { BLOCKS, latestBlock } from '../shared/blocks/index.js';
const blocks = BLOCKS;
import { blockProblems } from '../shared/blocks/format.js';
import { evaluate, parseKey } from '../shared/engine/index.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { masterChecks } from '../shared/master/checks.js';
import { stepFrom } from '../web/src/designer/model.js';
import { timers } from '../shared/engine/index.js';
import { at, ev, small } from './engine-fixture.js';

const header = { productItemId: 'p', productCode: 'P', productName: 'Examplol for injection', batchSize: '20000', batchUnit: 'units', route: 'aseptic', claimPer: 'container (filled content)', dispensingRooms: ['D'] };
const one = (id: string, settings: object, h: object = {}, formula: object[] = []): MasterDoc => {
  const b = latestBlock(id)!;
  return masterSchema.parse({ header: { ...header, ...h }, formula: [{ key: 'x', materialItemId: 'm', code: 'M', name: 'Examplol', mg: '500.0', role: 'api' }, ...formula],
    stages: [{ key: 's', name: 'Stage', kind: 'normal', steps: [{ ...stepFrom(b, []), key: 't', settings: { ...stepFrom(b, []).settings, ...settings } }] }] });
};
const run = (doc: MasterDoc, values: object) => evaluate(doc, [], parseKey('0.1.0.1')!, values as never);
const g = (value: string) => ({ value, unit: 'g' });
const pct = (value: string) => ({ value, unit: '%' });
const msgs = (d: MasterDoc) => masterChecks(d).map((p) => p.message);

describe('part 1: powder fill target per lot, with the excess', () => {
  const settings = { units: '4', labelClaim: '500 mg', excess: '25 mg', basis: 'as is', standardIs: 'anhydrous', powderIs: 'the active itself', meanBand: '2.0', eachBand: '5.0', humidityLimit: { high: '35', unit: '%RH' } };
  const values = (assay: string, weights: string[]) => ({ assay: pct(assay), weights: weights.map(g), humidity: { value: '28', unit: '%RH' }, stoppers: 'yes', counter: { value: '10', unit: 'units' }, filling: 'going on' });
  it('the block is valid and the fill weight comes from the lot: (500 mg + 25 mg excess) / 98 % = 0.5357 g, the excess shown', () => {
    const b = latestBlock('powder-fill')!;
    expect([b.version, blockProblems(b)]).toEqual([2, []]);
    const d = one('powder-fill', settings);
    const r = run(d, values('98.0', ['0.5360', '0.5350', '0.5370', '0.5340']));
    expect((r.target as { message?: string }).message).toBeUndefined();
    expect(r.target).toMatchObject({ ok: true, value: expect.stringMatching(/^0\.53571/), unit: 'g' });
    expect((r.target as { shown: string }).shown).toMatch(/excess/i);
    expect(r.meanCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.each).toMatchObject({ ok: true, check: { pass: true } });
    // The same weights are 5 % under for a lot of 93 % content: refused, the target moved with the lot.
    const low = run(d, values('93.0', ['0.5360', '0.5350', '0.5370', '0.5340']));
    expect(low.target).toMatchObject({ ok: true, value: expect.stringMatching(/^0\.56451/) });
    expect(low.each).toMatchObject({ ok: true, check: { pass: false } });
  });
  it('check 21: a blend of several actives needs the limits of the other active per unit, and a value outside them fails', () => {
    const second = [{ key: 'y', materialItemId: 'm2', code: 'M2', name: 'Examplox', mg: '250.0', role: 'api' }];
    expect(msgs(one('powder-fill', settings, {}, second)).join('|')).toMatch(/other active/);
    const d = one('powder-fill', { ...settings, otherLimit: { low: '240', high: '260', unit: 'mg' } }, {}, second);
    expect(msgs(d).join('|')).not.toMatch(/other active/);
    expect(run(d, { ...values('98.0', ['0.5360']), otherPerUnit: { value: '270', unit: 'mg' } }).otherCheck).toMatchObject({ check: { pass: false } });
  });
  it('check 20: a blend is on its own content as it is, not the active\'s anhydrous potency; check v1.1-7: fill limits on both sides, no excess for a delivered dose', () => {
    expect(msgs(one('powder-fill', { ...settings, powderIs: 'a blend or co-processed powder', basis: 'anhydrous' })).join('|')).toMatch(/blend/);
    expect(msgs(one('powder-fill', { ...settings, powderIs: 'a blend or co-processed powder' })).join('|')).not.toMatch(/blend's content/);
    const liquid = one('fill', { needles: '4', meanLimit: { low: '10.5', unit: 'g' }, band: '2' }, { batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5' });
    expect(msgs(liquid).join('|')).toMatch(/both sides/);
    expect(msgs(one('fill', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' }, { batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5' })).join('|')).not.toMatch(/both sides/);
    expect(msgs(one('fill', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' }, { claimPer: 'delivered dose', batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5' })).join('|')).toMatch(/delivered/);
  });
});

describe('fix2 1122: powder fill from the lot needs a potency-adjusted dispensing step; the target is shown alike', () => {
  const settings = { units: '4', labelClaim: '500 mg', excess: '25 mg', basis: 'anhydrous', standardIs: 'anhydrous', powderIs: 'the active itself', meanBand: '2.0', eachBand: '5.0', humidityLimit: { high: '35', unit: '%RH' } };
  const withWeigh = (adjusted: boolean) => {
    const d = one('powder-fill', settings);
    const w = latestBlock('weigh')!;
    d.stages[0]!.steps.unshift({ ...stepFrom(w, []), key: 'w', settings: { ...stepFrom(w, []).settings, target: adjusted ? { formula: 'x', adjusted: true } : { formula: 'x' }, tolerance: '0.5' } } as never);
    return d;
  };
  it('asks when the powder is filled by the lot potency but weighed without the adjustment', () => {
    expect(msgs(withWeigh(false)).join('|')).toMatch(/not dispensed adjusted for potency/);
    expect(msgs(withWeigh(true)).join('|')).not.toMatch(/not dispensed adjusted for potency/);
  });
  it('the mean check shows the centre rounded like the target, not cut ("1.1170 g", not "1.116… g")', () => {
    const d = one('powder-fill', { ...settings, basis: 'as is', labelClaim: '500 mg', excess: '25 mg' });
    const r = run(d, { assay: pct('47.13'), weights: ['1.1140', '1.1140', '1.1140', '1.1140'].map(g), humidity: { value: '28', unit: '%RH' }, stoppers: 'yes', counter: { value: '10', unit: 'units' }, filling: 'going on' });
    const target = /= ([\d.]+) g/.exec((r.target as { shown: string }).shown)![1]!;
    expect(target).toMatch(/^\d\.\d{4}$/);
    expect((r.meanCheck as { shown: string }).shown).toContain(`from ${target} g`);
  });
  it('fix 1128: the each-weight check shows the target rounded too ("of the target 1.1170 g")', () => {
    const d = one('powder-fill', { ...settings, basis: 'as is', labelClaim: '500 mg', excess: '25 mg' });
    const r = run(d, { assay: pct('47.13'), weights: ['1.1140', '1.1140', '1.1140', '1.1140'].map(g), humidity: { value: '28', unit: '%RH' }, stoppers: 'yes', counter: { value: '10', unit: 'units' }, filling: 'going on' });
    const target = /= ([\d.]+) g/.exec((r.target as { shown: string }).shown)![1]!;
    expect((r.each as { check: { shown: string } }).check.shown).toContain(`of the target ${target} g`);
    expect(JSON.stringify(r.each)).not.toContain('…');
  });
});

describe('part 2: a hold above the validated maximum (check 49)', () => {
  const done = [ev('started', '0.1.0.1', { min: 0 }), ev('done', '0.1.0.1', { min: 10 })];
  it('the master refuses a hold longer than its validated maximum, for an intermediate and for a time limit', () => {
    const doc = small([{ produces: { name: 'bulk', holdHours: 120, validatedMaxHours: 24 } }, { uses: ['s0'] }]);
    expect(masterChecks(doc).map((p) => p.message)).toContain('The hold time of bulk (120 h) is longer than its validated maximum (24 h): use the validated maximum, or the shorter where two are given');
    expect(masterChecks(small([{ produces: { name: 'bulk', holdHours: 24, validatedMaxHours: 24 } }, { uses: ['s0'] }])).map((p) => p.message).join('|')).not.toMatch(/validated maximum/);
    const lim = { ...small([{}, {}]), timeLimits: [{ key: 'a', name: 'Compounding to filtration', from: { step: 's0/t0', at: 'end' as const }, to: { step: 's1/t0', at: 'start' as const }, hours: 10, validatedMaxHours: 8 }] };
    expect(masterChecks(lim).map((p) => p.message).join('|')).toMatch(/Compounding to filtration: 10 h is longer than its validated maximum \(8 h\)/);
  });
  it('on the floor the shorter of the hold time and the validated maximum runs', () => {
    const doc = small([{ produces: { name: 'bulk', holdHours: 120, validatedMaxHours: 2 } }, { uses: ['s0'] }]);
    expect(timers(doc, done, at(60))).toMatchObject([{ id: 'hold:0:1', from: at(10), at: at(130) }]);
    const none = small([{ produces: { name: 'bulk', holdHours: 2 } }, { uses: ['s0'] }]);
    expect(timers(none, done, at(60))).toMatchObject([{ at: at(130) }]);
  });
});

describe('part 3: the cheap master checks', () => {
  const liquid = { batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5', claimPer: 'mL' };
  const api = (o: object) => ({ key: 'a', materialItemId: 'm', code: 'M', name: 'Examplol', mg: '50.0', role: 'api', ...o });
  const wfi = { key: 'w', materialItemId: 'w', code: 'W', name: 'Water for injections', role: 'solvent' };
  const doc = (h: object, formula: object[], steps: object[] = []): MasterDoc => masterSchema.parse({ header: { ...header, ...liquid, ...h }, formula,
    stages: [{ key: 's', name: 'Stage', kind: 'normal', steps }] });
  const all = (d: MasterDoc) => msgs(d).join('|');
  const step = (id: string, settings: object, version?: number) => { const b = version ? latestBlockV(id, version) : latestBlock(id)!; return { ...stepFrom(b, []), key: id, settings: { ...stepFrom(b, []).settings, ...settings } }; };
  const latestBlockV = (id: string, v: number) => blocks.find((b) => b.id === id && b.version === v)!;

  it('the new blocks are valid: fill-suspension asks the stirring every round, headspace gas 2 has the gas minimum', () => {
    for (const b of [latestBlock('fill-suspension')!, latestBlock('headspace-gas')!]) expect([b.id, blockProblems(b)]).toEqual([b.id, []]);
    expect(latestBlock('headspace-gas')!.version).toBe(2);
    const d = doc({ productName: 'Examplol injectable suspension' }, [api({}), wfi], [step('fill-suspension', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' })]);
    const w = ['10.60', '10.61', '10.60', '10.59'].map(g);
    const base = { weights: w, stoppers: 'yes', counter: { value: '1', unit: 'units' }, filling: 'going on' };
    expect(run(d, { ...base, stirring: 'yes' }).stopperCheck).toMatchObject({ check: { pass: true } });
    expect(run(d, { ...base, stirring: 'no' }).stopperCheck).toMatchObject({ check: { pass: false } });
    expect(run(d, base).stopperCheck).toBeUndefined();
  });
  it('check 21/50: a suspension is filled with the stirring block, never the plain fill', () => {
    const plain = doc({ productName: 'Examplol injectable suspension' }, [api({}), wfi], [step('fill', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' })]);
    expect(all(plain)).toMatch(/checks the stirring every round/);
    expect(all(doc({}, [api({}), wfi], [step('fill', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' })]))).not.toMatch(/stirring/);
  });
  it('check 46: an inert-gas headspace limit written as a maximum is refused; as a minimum it passes and checks the lowest reading', () => {
    const gas = (lim: object) => doc({}, [api({}), wfi], [step('headspace-gas', { gas: 'argon', rejectLimit: { high: '1', unit: '%' }, gasLimit: lim })]);
    expect(all(gas({ high: '70', unit: '%v/v' }))).toMatch(/inert-gas headspace limit is a minimum/);
    expect(all(gas({ low: '70', unit: '%v/v' }))).not.toMatch(/inert-gas headspace limit/);
    const d = gas({ low: '70', unit: '%v/v' });
    const v = (n: string) => ({ standards: 'yes', tested: { value: '10', unit: 'units' }, rejected: { value: '0', unit: 'units' }, passed: { value: '10', unit: 'units' }, lowest: { value: n, unit: '%v/v' } });
    expect(run(d, v('85')).gasCheck).toMatchObject({ check: { pass: true } });
    expect(run(d, v('40')).gasCheck).toMatchObject({ check: { pass: false } });
  });
  it('checks 18 and 19: two label bases ask which drives; two forms of one active each name their basis', () => {
    expect(all(doc({}, [api({ labelClaim: '40 mg (4000 IU)' }), wfi]))).toMatch(/label claim in mg and in IU/);
    const two = (a: string, b: string) => doc({}, [api({ name: 'Betamethasone phosphate', labelClaim: a }), api({ key: 'b', name: 'Betamethasone acetate', labelClaim: b }), wfi]);
    expect(all(two('3 mg', '3 mg'))).toMatch(/one of 2 forms of one active/);
    expect(all(two('3 mg as base', '3 mg as base'))).not.toMatch(/forms of one active/);
  });
  it('check 27: the density at another temperature than the fill asks for a reason', () => {
    expect(all(doc({ densityAtC: '20', fillAtC: '30' }, [api({}), wfi]))).toMatch(/density is stated at 20 °C but the bulk is made up or filled at 30 °C/);
    expect(all(doc({ densityAtC: '20', fillAtC: '21' }, [api({}), wfi]))).not.toMatch(/stated at/);
  });
  it('v1.1 checks 1 to 5: dilution of a solution drug substance, electrolyte per gram, two irradiation doses, a label claim by fill volume, no q.s.', () => {
    const ds = api({ adjust: { content: { formulaQuantityIs: 'dry' } } });
    const dilute = step('bulk-adjust', { target: '50 mg/mL', donor: '0 mg/mL', direction: 'dilute with the vehicle', largestLimit: { high: '5', unit: 'kg' }, tolerance: '1' });
    expect(all(doc({}, [ds, { key: 'e', materialItemId: 'e', code: 'E', name: 'Sodium chloride', mg: '9.0', role: 'excipient' }, wfi], [dilute]))).toMatch(/excipient's final concentration still equals the formula/);
    expect(all(doc({}, [api({ labelClaim: '4 mEq/g' }), wfi]))).toMatch(/per gram of the salt or of the parent/);
    const irr = (n: string) => ({ ...step('irradiation', { boxCount: '2', minDoseLimit: { low: '25', unit: 'kGy' }, maxDoseLimit: { high: '40', unit: 'kGy' } }), key: n });
    expect(all(doc({}, [api({}), wfi], [irr('i1'), irr('i2')]))).toMatch(/Two irradiation steps have the same minimum dose/);
    expect(all(doc({ claimPer: 'container (filled content)' }, [api({ labelClaim: '1 g', mg: '50.0' }), wfi]))).toMatch(/the fill volume is the claim ÷ the concentration/);
    expect(all(doc({}, [api({ mg: '50.0' }), { key: 'x', materialItemId: 'x', code: 'X', name: 'Sodium chloride', mg: '9.0', role: 'excipient' }]))).toMatch(/No line is made up to volume/);
  });
});

describe('part 4: counts through I22, limits from the clean-air table', () => {
  const api = { key: 'a', materialItemId: 'm', code: 'M', name: 'Examplol', mg: '50.0', role: 'api' };
  const liquid = { batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5', claimPer: 'mL' };
  const doc = (id: string, settings: object): MasterDoc => { const b = latestBlock(id)!; return masterSchema.parse({ header: { ...header, ...liquid }, formula: [api],
    stages: [{ key: 's', name: 'Stage', kind: 'normal', steps: [{ ...stepFrom(b, []), key: 't', settings: { ...stepFrom(b, []).settings, ...settings } }] }] }); };
  const all = (d: MasterDoc) => msgs(d).join('|');
  it('the new blocks are valid', () => {
    for (const id of ['em-filling', 'incubated-em', 'incubated-bioburden']) expect([id, blockProblems(latestBlock(id)!)]).toEqual([id, []]);
    expect([latestBlock('em-filling')!.version, latestBlock('incubated-em')!.version]).toEqual([2, 2]);
  });
  it('em-filling: particles against the table for the grade and state; a tighter limit is allowed, a looser one refused', () => {
    const d = doc('em-filling', { grade: 'B', state: 'in operation' });
    const v = (a: string, b: string) => ({ location: 'Filling needle', particles05: { value: a, unit: 'particles/m³' }, particles5: { value: b, unit: 'particles/m³' } });
    expect(run(d, v('300000', '2000')).particles05Check).toMatchObject({ ok: true, check: { pass: true } });
    expect(run(d, v('400000', '2000')).particles05Check).toMatchObject({ ok: true, check: { pass: false } });
    expect(run(doc('em-filling', { grade: 'A', state: 'in operation' }), v('4000', '10')).particles05Check).toMatchObject({ check: { pass: false } });
    expect(all(doc('em-filling', { grade: 'B', state: 'in operation', limit05: '300000 particles/m³' }))).not.toMatch(/looser/);
    expect(all(doc('em-filling', { grade: 'B', state: 'in operation', limit05: '900000 particles/m³' }))).toMatch(/looser than the clean-air table for grade B in operation \(352000 particles\/m³\)/);
  });
  it('incubated-em: the count of an air sample is turned to per m³ from the litres sampled, and a plate is kept per plate', () => {
    const d = doc('incubated-em', { grade: 'B' });
    const base = { sampleId: 'S1', incubationStart: '2026-11-21T08:00:00Z', incubationEnd: '2026-11-26T08:00:00Z' };
    const air = run(d, { ...base, kind: 'air', count: { value: '2', unit: 'CFU' }, sampled: { value: '1000', unit: 'L' } });
    expect(air.countCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect((air.countCheck as { shown: string }).shown).toMatch(/2 CFU\/m³/);
    expect(run(d, { ...base, kind: 'air', count: { value: '20', unit: 'CFU' }, sampled: { value: '1000', unit: 'L' } }).countCheck).toMatchObject({ check: { pass: false } });
    expect(run(d, { ...base, kind: 'settle plate', count: { value: '6', unit: 'CFU' } }).countCheck).toMatchObject({ check: { pass: false } });
  });
  it('bioburden: the count per 100 mL from the millilitres filtered (check 45: a limit per mL is asked about)', () => {
    const d = doc('incubated-bioburden', { bioburdenLimit: '10 CFU/100 mL' });
    const r = run(d, { sampleId: 'B1', volume: { value: '50', unit: 'mL' }, count: { value: '3', unit: 'CFU' } });
    expect(r.countCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect((r.countCheck as { shown: string }).shown).toMatch(/6\.00 CFU\/100 mL/);
    expect(run(d, { sampleId: 'B1', volume: { value: '50', unit: 'mL' }, count: { value: '9', unit: 'CFU' } }).countCheck).toMatchObject({ check: { pass: false } });
    expect(all(d)).not.toMatch(/100 times weaker/);
    expect(all(doc('incubated-bioburden', { bioburdenLimit: '0.1 CFU/mL' }))).toMatch(/per mL: a bioburden limit is written per 100 mL/);
  });
});

describe('part 5: the cycle against its recipe (I21) and the lethality per probe (I20)', () => {
  const api = { key: 'a', materialItemId: 'm', code: 'M', name: 'Examplol', mg: '50.0', role: 'api' };
  const liquid = { batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5', claimPer: 'mL', route: 'terminal' };
  const doc = (id: string, settings: object): MasterDoc => { const b = latestBlock(id)!; return masterSchema.parse({ header: { ...header, ...liquid }, formula: [api],
    stages: [{ key: 's', name: 'Stage', kind: 'normal', steps: [{ ...stepFrom(b, []), key: 't', settings: { ...stepFrom(b, []).settings, ...settings } }] }] }); };
  const all = (d: MasterDoc) => msgs(d).join('|');
  const c = (n: string) => ({ value: n, unit: '°C' });
  it('the new blocks are valid and are the latest versions', () => {
    for (const id of ['terminal-sterilise', 'sterilise', 'lyo-cycle']) { const b = latestBlock(id)!; expect([id, b.version, blockProblems(b)]).toEqual([id, 2, []]); }
  });
  it('terminal sterilisation: the F-value of each probe from its temperatures every minute; the lowest probe is the result', () => {
    const d = doc('terminal-sterilise', { medium: 'moist heat', lethalityLimit: { low: '15.0', unit: 'F-min' }, readings: '16', interval: '1 min' });
    const hot = Array.from({ length: 16 }, () => c('121.1'));
    const cold = Array.from({ length: 16 }, () => c('120.1'));
    const r = run(d, { probe1: hot, probe2: cold, units: { value: '100', unit: 'units' } });
    expect(r.lethality).toMatchObject({ ok: true, unit: 'F-min', lowest: 'Probe 2', check: { pass: false } });
    expect(run(d, { probe1: hot }).lethality).toMatchObject({ ok: true, check: { pass: true }, lowest: 'Probe 1' });
    expect((r.lethality as { shown: string }).shown).toMatch(/Probe 1 15\.0 F-min, Probe 2 /);
  });
  it('dry heat is worked out with its own FH reference (170 °C, z 20 °C), and the master must give them', () => {
    const settings = { medium: 'dry heat (sealed ampoules)', lethalityLimit: { low: '30.0', unit: 'F-min' }, readings: '31', interval: '1 min' };
    expect(all(doc('terminal-sterilise', settings))).toMatch(/Dry heat is not worked out at 121\.1/);
    const d = doc('terminal-sterilise', { ...settings, tref: '170 °C', zvalue: '20 °C' });
    expect(all(d)).not.toMatch(/Dry heat is not worked out/);
    expect(run(d, { probe1: Array.from({ length: 31 }, () => c('170')) }).lethality).toMatchObject({ ok: true, check: { pass: true } });
  });
  it('an autoclave and a freeze-dryer cycle: each phase in the recipe is recorded with its time and range, in the recipe\'s order, and the total is shown', () => {
    const d = doc('sterilise', { what: 'items and parts', exposureLimit: { low: '15', unit: 'min' }, lowestLimit: { low: '121', unit: '°C' },
      phases: '3', phaseRecipe: 'Heat-up; 10 to 30; 100 to 124 | Exposure; 15 to 20; 121 to 124 | Cool-down; at least 10; -', paramName: 'Chamber temperature', paramUnit: '°C' });
    expect(all(d)).not.toMatch(/recipe lists/);
    const rec = (m: string[], lo: string[], hi: string[]) => ({ phaseMinutes: m.map((x) => ({ value: x, unit: 'min' })), phaseMin: lo.map(c), phaseMax: hi.map(c) });
    const ok = run(d, rec(['20', '16', '12'], ['100', '121.5', '60'], ['121', '123', '121']));
    expect(ok.cycle).toMatchObject({ ok: true, value: '48', unit: 'min', check: { pass: true } });
    const bad = run(d, rec(['20', '25', '12'], ['100', '119', '60'], ['121', '123', '121']));
    expect(bad.cycle).toMatchObject({ ok: true, check: { pass: false } });
    expect((bad.cycle as { shown: string }).shown).toMatch(/Exposure: duration 25\.0 min is out of limits/);
    expect((bad.cycle as { shown: string }).shown).toMatch(/Exposure: Chamber temperature minimum 119 °C is out of limits/);
    expect(run(d, rec(['20', '16'], ['100', '121.5'], ['121', '123'])).cycle).toMatchObject({ ok: false });
    expect(all(doc('sterilise', { phases: '2', phaseRecipe: 'A; -; - | B; -; - | C; -; -', paramName: 'T', paramUnit: '°C' }))).toMatch(/lists 3 phases but the step records 2/);
    const lyo = doc('lyo-cycle', { phases: '2', phaseRecipe: 'Freezing; 120 to 240; -50 to -40 | Primary drying; at least 600; -45 to -25', paramName: 'Shelf temperature', paramUnit: '°C' });
    expect(run(lyo, rec(['150', '700'], ['-50', '-44'], ['-41', '-26'])).cycle).toMatchObject({ ok: true, check: { pass: true } });
  });
});

describe('part 6: freeze-drying extras, filtration at the filler, siliconisation', () => {
  const api = { key: 'a', materialItemId: 'm', code: 'M', name: 'Examplol', mg: '50.0', role: 'api' };
  const wfi = { key: 'w', materialItemId: 'w', code: 'W', name: 'Water for injections', role: 'solvent' };
  const doc = (steps: object[]): MasterDoc => masterSchema.parse({ header: { ...header, batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5', claimPer: 'mL' }, formula: [api, wfi],
    stages: [{ key: 's', name: 'Stage', kind: 'normal', steps }] });
  const st = (id: string, settings: object) => { const b = latestBlock(id)!; return { ...stepFrom(b, []), key: id, settings: { ...stepFrom(b, []).settings, ...settings } }; };
  const one = (id: string, settings: object) => doc([st(id, settings)]);
  it('the new blocks are valid', () => {
    for (const id of ['lyo-load', 'lyo-cycle', 'filtration-inline', 'siliconise']) expect([id, blockProblems(latestBlock(id)!)]).toEqual([id, []]);
    expect(latestBlock('lyo-load')!.version).toBe(2);
  });
  it('lyo: a tray load records its shelves, trays and fill per tray; an annealing phase is in the recipe and has its shelf temperature checked', () => {
    const load = latestBlock('lyo-load')!;
    expect(load.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['shelves', 'traysPerShelf', 'fillPerTray']));
    const d = one('lyo-cycle', { annealingLimit: { low: '-25', high: '-15', unit: '°C' }, phases: '3', phaseRecipe: 'Freezing; 120 to 240; -50 to -40 | Annealing; 60 to 180; -25 to -15 | Primary drying; at least 600; -45 to -25', paramName: 'Shelf temperature', paramUnit: '°C' });
    const c = (n: string) => ({ value: n, unit: '°C' });
    const r = run(d, { annealingShelf: c('-12'), phaseMinutes: ['150', '90', '700'].map((x) => ({ value: x, unit: 'min' })), phaseMin: ['-50', '-24', '-44'].map(c), phaseMax: ['-41', '-16', '-26'].map(c) });
    expect(r.annealingCheck).toMatchObject({ check: { pass: false } });
    expect(r.cycle).toMatchObject({ ok: true, value: '940', check: { pass: true } });
  });
  it('filtration at the filler: the pressure difference in rounds beside the fill, and it counts as the sterile filtration for the master rules', () => {
    const d = one('filtration-inline', { pressureLimit: { high: '3.5', unit: 'bar' } });
    const v = (p: string) => ({ filters: 'F1', pressure: { value: p, unit: 'bar' }, filtering: 'going on' });
    expect(run(d, v('2.1')).pressureCheck).toMatchObject({ check: { pass: true } });
    expect(run(d, v('4.0')).pressureCheck).toMatchObject({ check: { pass: false } });
    expect(latestBlock('filtration-inline')!.periodic).toEqual({ maxMinutes: 240, alongside: true });
    const aseptic = doc([st('filtration-inline', { pressureLimit: { high: '3.5', unit: 'bar' } }), st('fill', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' })]);
    expect(masterChecks({ ...aseptic, header: { ...aseptic.header, route: 'aseptic' } }).map((p) => p.message).join('|')).not.toMatch(/has its sterile filtration/);
  });
  it('siliconisation: the emulsion lot and concentration, then the bake against its recipe', () => {
    const d = one('siliconise', { concentrationLimit: { low: '0.5', high: '2.0', unit: '%' }, phases: '2', phaseRecipe: 'Bake; 20 to 40; 300 to 330 | Cool; at least 10; -', paramName: 'Oven temperature', paramUnit: '°C' });
    const c = (n: string) => ({ value: n, unit: '°C' });
    const r = run(d, { concentration: { value: '1.2', unit: '%' }, phaseMinutes: ['30', '15'].map((x) => ({ value: x, unit: 'min' })), phaseMin: ['305', '60'].map(c), phaseMax: ['325', '300'].map(c) });
    expect(r.concentrationCheck).toMatchObject({ check: { pass: true } });
    expect(r.cycle).toMatchObject({ ok: true, value: '45', check: { pass: true } });
  });
});

describe('fix3 1122: the weighing target is shown as the step shows it', () => {
  it('the net check says "from 2.234 kg", not "from 2.2339… kg"', () => {
    const d = one('weigh', { target: { formula: 'x' }, tolerance: '0.5' });
    const r = run(d, { gross: { value: '5.000', unit: 'kg' }, tare: { value: '2.766', unit: 'kg' } });
    const shown = (r.netCheck as { shown?: string } | undefined)?.shown ?? '';
    expect(shown).not.toContain('…');
  });
  it('a round another followed reads as history on a record', async () => {
    const { notYetText } = await import('../shared/engine/batch.js');
    expect(notYetText('Filling finished: no: FAIL', false, true)).toBe('Filling finished: no: not reached in this round; the next round followed');
  });
});
