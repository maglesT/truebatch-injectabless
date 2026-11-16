// The master calculation checks of the injectables library (v1 section 6, v1.1): refusals (⛔) and answered warnings
// (⚠️), each with the library's check number.
import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { stepFrom } from '../web/src/designer/model.js';
import { unplaced } from './engine-fixture.js';

type Change = (d: MasterDoc) => void;
const step = (id: string, key: string, settings: object = {}, extra: object = {}) => ({ ...stepFrom(findBlock({ id, version: 1 })!, []), key, settings: { ...stepFrom(findBlock({ id, version: 1 })!, []).settings, ...settings }, ...extra });
// A solution for injection, 50 mg/mL, 100 L at 1.012 g/mL, 10.0 mL + 0.5 mL, made aseptically.
const base = (): MasterDoc => masterSchema.parse({
  header: { productItemId: 'p', productCode: 'INJ-1', productName: 'Examplol 50 mg/mL injection', batchSize: '100', batchUnit: 'L', densityGPerMl: '1.012',
    fillVolumeMl: '10.0', fillExcessMl: '0.5', route: 'aseptic', claimPer: 'mL', dispensingRooms: ['D'] },
  formula: [
    { key: 'api', materialItemId: 'a', code: 'API', name: 'Examplol', mg: '50.0', role: 'api', labelClaim: '50 mg/mL' },
    { key: 'nacl', materialItemId: 'n', code: 'NACL', name: 'Sodium chloride', mg: '6.0', role: 'excipient' },
    { key: 'wfi', materialItemId: 'w', code: 'WFI', name: 'Water for injections', role: 'solvent' },
  ],
  stages: [{ key: 'make', name: 'Compounding', kind: 'normal', steps: [step('weigh', 'weigh-api', { target: { formula: 'api' } }), step('charge', 'charge-api', { material: { formula: 'api' } }),
    step('filtration', 'filter'), step('fill', 'fill', { needles: '4', meanLimit: { low: '10.5', high: '10.8', unit: 'g' }, band: '2' })] }],
});
const msgs = (change: Change, level?: 'error' | 'warning') => { const d = base(); change(d); return unplaced(masterChecks(d)).filter((p) => !level || p.level === level).map((p) => p.message); };
const has = (change: Change, re: RegExp, level?: 'error' | 'warning') => expect(msgs(change, level).some((m) => re.test(m))).toBe(true);
const hasNot = (change: Change, re: RegExp) => expect(msgs(change).some((m) => re.test(m))).toBe(false);

describe('master checks of the injectables library', () => {
  it('TI-01 the route and what the label claim is per are required', () => {
    has((d) => { delete d.header.route; }, /Choose the route/, 'error');
    has((d) => { delete d.header.claimPer; }, /what the label claim is per/, 'error');
  });

  it('TI-01 check 14 ⛔ mg/mL × the nominal fill must give the label claim per container', () => {
    const per = (claim: string): Change => (d) => { d.header.claimPer = 'container (filled content)'; d.formula[0]!.labelClaim = claim; };
    has(per('550 mg'), /50\.0 mg\/mL × 10\.0 mL nominal fill = 500 mg, not the label claim 550 mg/);
    hasNot(per('500 mg'), /label claim/);
  });

  it('TI-01 check 15 ⛔ the fill excess counted as an API overage; check 16 ⚠️ no fill excess', () => {
    has((d) => { d.formula[0]!.adjust = { overage: { percent: '5.0' } }; }, /the overage 5\.0 % is the fill excess/);
    hasNot((d) => { d.formula[0]!.adjust = { overage: { percent: '2.0' } }; }, /is the fill excess/);
    has((d) => { delete d.header.fillExcessMl; }, /The fill has no excess/, 'warning');
  });

  it('TI-13 checks 26, 31, 34: water\'s density with many solutes; a solution named pure; an excipient without its hydrate', () => {
    has((d) => { d.header.densityGPerMl = '1.000'; }, /density is water's \(1\.000 g\/mL\) but the solutes are 56/);
    has((d) => { d.formula.push({ key: 'hcl', materialItemId: 'h', code: 'HCL', name: 'Hydrochloric acid', mg: '0.1', role: 'excipient' }); }, /usually dispensed as a solution/, 'warning');
    hasNot((d) => { d.formula.push({ key: 'hcl', materialItemId: 'h', code: 'HCL', name: 'Hydrochloric acid 1 M solution', mg: '0.1', role: 'excipient' }); }, /usually dispensed as a solution/);
    has((d) => { d.formula.push({ key: 'po4', materialItemId: 'p4', code: 'PO4', name: 'Sodium dihydrogen phosphate', mg: '1.0', role: 'excipient' }); }, /exists as several hydrates/, 'warning');
    hasNot((d) => { d.formula.push({ key: 'po4', materialItemId: 'p4', code: 'PO4', name: 'Sodium dihydrogen phosphate dihydrate', mg: '1.0', role: 'excipient' }); }, /several hydrates/);
  });

  it('TI-25 check 37 ⛔ nothing added between the sterile filtration and filling in an aseptic master; ⚠️ 38 when terminal', () => {
    const after: Change = (d) => { d.stages[0]!.steps.splice(3, 0, step('ph-adjust', 'ph', { phLimit: { low: '6.5', high: '7.5', unit: 'pH' } })); };
    has(after, /comes between the sterile filtration and filling/, 'error');
    has((d) => { after(d); d.header.route = 'terminal'; d.stages[0]!.steps.push(step('terminal-sterilise', 'ts', { lethalityLimit: { low: '15', unit: 'F-min' } })); }, /bioburden sample is taken after the last addition/, 'warning');
  });

  it('TI-25 checks 39, 40 ⛔ a product-wetted filter test needs its factor; gauge and absolute never mixed', () => {
    const ft = (s: object): Change => (d) => { d.stages[0]!.steps.splice(2, 0, step('filter-test', 'ft', { test: 'bubble point', resultUnit: 'bar g', makerLimit: '3.45 bar g', wettedWith: 'water', temperatureRange: { low: '15', high: '25', unit: '°C' }, ...s })); };
    hasNot(ft({}), /product factor|gauge and absolute/);
    has(ft({ wettedWith: 'product' }), /needs the validated product factor/);
    has(ft({ makerLimit: '3.45 bar' }), /gauge and absolute pressure are never mixed/);
  });

  it('TI-24 checks 41, 42, 43 ⛔⚠️ a terminal route needs terminal sterilisation; a heat treatment is not; a low F0 is answered', () => {
    has((d) => { d.header.route = 'terminal'; }, /route is terminal but no terminal sterilisation step/);
    has((d) => { d.header.route = 'terminal'; d.stages[0]!.steps.push(step('terminal-sterilise', 'ts', { lethalityLimit: { low: '15', unit: 'F-min' } }), step('heat-treatment', 'ht')); }, /heat step below sterilising lethality/);
    has((d) => { d.header.route = 'terminal'; d.stages[0]!.steps.push(step('terminal-sterilise', 'ts', { lethalityLimit: { low: '8', unit: 'F-min' } })); }, /below the 15 min reference/, 'warning');
  });

  it('TI-24 v1.1 ⛔ moist heat on a sealed non-aqueous fill; check 44 ⛔ a sterilising dose written as a range', () => {
    has((d) => { d.formula[2]!.name = 'Sesame oil'; d.header.route = 'terminal'; d.stages[0]!.steps.push(step('terminal-sterilise', 'ts', { medium: 'moist heat', lethalityLimit: { low: '15', unit: 'F-min' } })); }, /Moist heat cannot reach a sealed non-aqueous fill/);
    has((d) => { d.stages[0]!.steps.push(step('irradiation', 'irr', { minDoseLimit: { low: '20', high: '70', unit: 'kGy' } })); }, /a minimum, not a range/);
  });

  it('TI-14 checks 47, 48 ⛔ dissolved oxygen above saturation; nitrogen not optional with an antioxidant', () => {
    has((d) => { d.stages[0]!.steps.push(step('nitrogen', 'n2', { oxygenUnit: 'mg/L', oxygenLimit: { high: '500', unit: 'mg/L' } })); }, /above saturation/);
    has((d) => { d.formula.push({ key: 'smb', materialItemId: 's', code: 'SMB', name: 'Sodium metabisulfite', mg: '1.0', role: 'excipient' }); d.stages[0]!.steps.push(step('nitrogen', 'n2', { oxygenUnit: 'mg/L', oxygenLimit: { high: '1.0', unit: 'mg/L' } }, { flow: { kind: 'optional-with-reason' } })); }, /cannot be optional in a product with an antioxidant/);
  });

  it('TI-26 check 50 ⛔ a suspension is sampled at the start, middle and end of filling; check 36 ⛔ API before carbon', () => {
    has((d) => { d.header.productName = 'Examplol 50 mg/mL suspension for injection'; }, /start, middle and end of filling/);
    has((d) => { d.stages[0]!.steps.splice(2, 0, step('treat-until-clear', 'carbon')); }, /charged before the carbon treatment/);
  });
});
