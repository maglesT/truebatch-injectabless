import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../shared/blocks/index.js';
import { masterChecks, plainWords } from '../shared/master/checks.js';
import { placeChecks } from '../shared/master/places.js';
import { masterSchema } from '../shared/master/schema.js';
import { describeMaster } from '../web/src/designer/describe.js';
import { verdictless } from '../web/src/designer/example.js';
import { grouped } from '../web/src/designer/model.js';
import { sentence, sentenceText } from '../web/src/designer/sentences.js';
import { skeletonList, skeletonStages } from '../web/src/designer/skeletons.js';
import { tablet } from './engine-fixture.js';
import { packing } from './packing-fixture.js';

// The designer findings of TrueBatch Tablets' full demo run of 17 Nov 2026 (round 19a), as they apply to injectables:
// what the master check reports, the plain view's words, and where the floor finds its machines.

const block = (id: string) => BLOCKS.find((b) => b.id === id)!;
const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100', batchUnit: 'L' as const, fillVolumeMl: '10.0', fillExcessMl: '0.5', route: 'terminal' as const, dispensingRooms: ['RM-101'] };
const room = (code: string, name: string, area: string | null, active = true) => ({ itemId: code, code, name, version: 1, active, area, grade: 'C' });
const machine = (code: string, type: string | null, at: string | null, active = true) => ({ itemId: code, code, name: code, version: 1, active, kind: 'equipment' as const, type, room: at });
const MD = {
  rooms: [room('RM-101', 'Sterile dispensing booth', 'Sterile dispensing'), room('RM-201', 'Filling room 1', 'Aseptic filling'), room('RM-202', 'Capping room', 'Capping'),
    room('RM-301', 'Autoclave room', 'Sterilisation'), room('RM-110', 'QC laboratory', 'QC')],
  equipment: [machine('IN-BAL-03', 'Balance', 'RM-101'), machine('FM-01', 'Vial filling machine', 'RM-201'), machine('CAP-01', 'Capping machine', 'RM-110'), machine('AC-01', 'Autoclave', 'RM-301')],
};
const liquid = () => masterSchema.parse({ header, formula: [], stages: skeletonStages('liquid-terminal', header) });

describe('designer findings of the TrueBatch Tablets 17 Nov 2026 run', () => {
  it('TI-11 the master check warns when no machine of a step\'s type stands in the rooms its stage allows, and says where it stands', () => {
    const doc = liquid();
    const filling = doc.stages.findIndex((s) => s.key === 'filling');
    const seal = doc.stages[filling]!.steps.findIndex((t) => t.block.id === 'seal-check');
    const at = (md: typeof MD) => placeChecks(doc, md).filter((p) => p.path.startsWith(`stages[${filling}]`));
    expect(at(MD)).toEqual([{ level: 'warning', rule: 'TI-11', path: `stages[${filling}].steps[${seal}]`,
      message: 'No capping machine stands in a room this stage allows (Aseptic filling, Capping): CAP-01 stands in RM-110. Allow its room in the stage settings, or engineering moves it in master data' }]);
    // The filling machine stands in the filling room: no warning for it; with the capper moved, none.
    expect(at({ ...MD, equipment: MD.equipment.map((m) => (m.code === 'CAP-01' ? { ...m, room: 'RM-202' } : m)) })).toEqual([]);
    // A type master data does not have at all.
    expect(at({ ...MD, equipment: MD.equipment.filter((m) => m.code !== 'CAP-01') })[0]!.message).toMatch(/^Master data has no capping machine/);
    // A balance in a dispensing room of the master is found there.
    const weigh = doc.stages[0]!.steps.findIndex((t) => t.block.id === 'weigh');
    expect(placeChecks(doc, MD).some((p) => p.path === `stages[0].steps[${weigh}]`)).toBe(false);
  });

  it('a stage\'s yield on an earlier stage\'s output is refused when the stage adds formula materials', () => {
    const d = tablet();
    const ci = d.stages.findIndex((s) => s.key === 'compression');
    const yi = d.stages[ci]!.steps.findIndex((t) => t.key === 'yield');
    d.stages[ci]!.steps[yi]!.settings.theoretical = { ref: 'granulation/yield/output' };
    expect(masterChecks(d).filter((p) => p.path === `stages[${ci}].steps[${yi}].settings.theoretical`)).toEqual([]);
    d.stages[ci]!.steps.unshift({ key: 'weigh-mgst', block: { id: 'weigh', version: 1 }, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' }, settings: { target: { formula: 'mgst' }, tolerance: '0.5' } });
    expect(masterChecks(d).filter((p) => p.path === `stages[${ci}].steps[${yi + 1}].settings.theoretical`).map((p) => [p.level, p.message])).toEqual([['error',
      'The yield of Compression is worked out on the output of Granulation only, but Compression adds Magnesium stearate: the yield would read above 100 %. Take the batch quantity from the header (or a quantity that includes what this stage adds) as the theoretical quantity']]);
    // No starting master meets it.
    for (const s of skeletonList()) {
      const doc = masterSchema.parse({ header, formula: [], stages: skeletonStages(s.id, header) });
      expect(masterChecks(doc).filter((p) => /above 100 %/.test(p.message)), s.id).toEqual([]);
    }
  });

  it('the master check reports a stage without a responsible role, and a temperature recorded with its optional limits empty', () => {
    const doc = liquid();
    expect(masterChecks({ ...doc, stages: doc.stages.map((s, i) => (i === 0 ? { ...s, role: '' } : s)) }).filter((p) => p.path === 'stages[0]').map((p) => [p.level, p.message]))
      .toContainEqual(['warning', 'Stage Compounding names no responsible role']);
    // Injectables Packing: a blister pack's forming temperature, recorded with its limits left empty, is not checked.
    const blister = packing({ type: 'blister', unitsPerPack: 1 });
    const fi = blister.stages.findIndex((s) => s.steps.some((t) => t.block.id === 'forming-check'));
    const ti = blister.stages[fi]!.steps.findIndex((t) => t.block.id === 'forming-check');
    const warned = masterChecks(blister).filter((p) => /recorded but not checked/.test(p.message));
    expect(warned).toEqual([{ level: 'warning', path: `stages[${fi}].steps[${ti}].settings.formLimit`, message: 'Forming temperature is recorded but not checked: set the forming temperature limits' }]);
    const set = { ...blister, stages: blister.stages.map((s, i) => (i !== fi ? s : { ...s, steps: s.steps.map((t, j) => (j === ti ? { ...t, settings: { ...t.settings, formLimit: { low: '120', high: '140', unit: '°C' } } } : t)) })) };
    expect(masterChecks(set).filter((p) => /recorded but not checked/.test(p.message))).toEqual([]);
  });

  it('the plain view: none allowed, hours in days, separators in large numbers', () => {
    const rec = block('unit-reconcile');
    expect(sentenceText(tablet(), rec, {}, sentence(rec, { name: 'x', label: 'x', template: 'C1', args: { value: '$samples', limit: { high: '0', unit: 'units' } } }))).toBe('The samples must be 0: none allowed.');
    const doc = masterSchema.parse({ header: { ...header, batchSize: '50000', batchUnit: 'units' }, formula: [], stages: skeletonStages('liquid-terminal', header).map((s, i) => (i === 0 ? { ...s, produces: { name: 'bulk solution', holdHours: 720 } } : s)) });
    const lines = describeMaster(doc).flatMap((s) => s.lines.map((l) => l.text));
    expect(lines.find((l) => l.includes('Produces bulk solution'))).toMatch(/to be used within 720 hours \(30 days\)\./);
    expect(grouped('10.0 mL × 50000 units = 500.000 L')).toBe('10.0 mL × 50,000 units = 500.000 L');
    expect(grouped('CC-2026-0016, 49225.7 units, 100000 units')).toBe('CC-2026-0016, 49225.7 units, 1,00,000 units');
  });

  it('no internal codes of rules, templates, failure cases or library checks in what the master check says; the rule stays', () => {
    expect(plainWords('A line is adjusted for potency (T9) or for content (T18), not both')).toBe('A line is adjusted for potency or for content, not both');
    expect(plainWords('stop at that net weight (F0339: spraying all of it gives about 4.5 % more drug)')).toBe('stop at that net weight (spraying all of it gives about 4.5 % more drug)');
    expect(plainWords('carbon adsorbs the API (library check 36)')).toBe('carbon adsorbs the API');
    expect(plainWords('give the measured density (1-40 % in the formulation test; library check 26)')).toBe('give the measured density (1-40 % in the formulation test)');
    expect(plainWords('a heat treatment is not sterilisation (TI-24)')).toBe('a heat treatment is not sterilisation');
    // A terminal route without a terminal sterilisation step: the rule stays in `rule`, the message has no codes.
    const doc = liquid();
    const noSteriliser = { ...doc, stages: doc.stages.filter((s) => s.key !== 'sterilisation') };
    const p = masterChecks(noSteriliser).find((x) => x.rule === 'TI-24')!;
    expect(p.message).toBe('The route is terminal but no terminal sterilisation step has a minimum F0: a heat treatment or pasteurisation is not sterilisation');
    for (const x of masterChecks(tablet())) expect(x.message).not.toMatch(/\bT\d+\b|\bTI-\w+|\bF0\d{3}\b|library check/);
  });

  it('an answer given to a warning as it read before plain words still counts', () => {
    const d = tablet();
    d.formula[0]!.adjust = {};
    d.formula[0]!.name = 'Examplol wet cake';
    const wet = masterChecks(d).find((p) => p.question?.key === 'solvent-wet/api')!;
    expect(wet.message).toContain('(an assay adjustment on the dried or solvent-free basis, or a content adjustment)');
    expect(wet.message).not.toContain('F0204');
    const before = wet.message.replace('(about 23 %)', '(F0204: about 23 %)');
    d.answers = { 'solvent-wet/api': { about: before, choice: 'weighed dry', reason: 'dried lot' } };
    expect(masterChecks(d).find((p) => p.question?.key === 'solvent-wet/api')!.question!.answer).toMatchObject({ choice: 'weighed dry' });
  });

  it('the worked example gives its verdict once, in the chip', () => {
    expect(verdictless('All 20 units within limits: PASS')).toBe('All 20 units within limits');
    expect(verdictless('6.0 within limits')).toBe('6.0 within limits');
  });
});
