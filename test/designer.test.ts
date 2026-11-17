import { describe, expect, it, vi } from 'vitest';
import { BLOCKS, findBlock } from '../shared/blocks/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema } from '../shared/master/schema.js';
import { describeMaster, diffMasters, stepText } from '../web/src/designer/describe.js';
import { dispensing, workedExample } from '../web/src/designer/example.js';
import { answerDoc, earlierRefs, neededKind, qtyText, scaleDoc, stepFrom, unitsOf } from '../web/src/designer/model.js';
import { sentence, sentenceText } from '../web/src/designer/sentences.js';
import { stepTitle } from '../shared/engine/batch.js';
import { defaultDispensingRooms, skeletonList, skeletonStages } from '../web/src/designer/skeletons.js';
import { tablet, unplaced } from './engine-fixture.js';

// The shared test master is built from test-only blocks (test/test-blocks.ts).
vi.mock('../shared/blocks/index.js', async (original) => (await import('./test-blocks.js')).withTestBlocks(original as never));

// The designer's pure parts: sentences instead of formulas, inputs offered by kind, worked examples and the
// calculation preview through the engine, skeletons, copying to a new batch size, and the changes view.

const block = (id: string) => BLOCKS.find((b) => b.id === id)!;

describe('master designer', () => {
  it('every calculation of the block library reads as a sentence, never a formula', () => {
    for (const b of BLOCKS) for (const c of b.calcs) {
      const words = sentence(b, c).filter((p) => typeof p === 'string').join('');
      expect(words, `${b.id}.${c.name}`).not.toMatch(/[×÷=]|\$|T\d|C\d/);
    }
    const d = tablet();
    const weigh = d.stages[1]!.steps[0]!;
    expect(sentenceText(d, block('weigh'), weigh.settings, sentence(block('weigh'), block('weigh').calcs[1]!)))
      .toBe('The net weight must be within ± 0.5 % of the batch quantity of Examplol, adjusted for the lot.');
  });

  it('every block reads in words with its default settings: a limit written in the block too, never [object Object]', () => {
    const d = tablet();
    for (const b of BLOCKS) {
      const t = stepFrom(b, []);
      const text = [stepText(d, t, 0), ...b.calcs.map((c) => sentenceText(d, b, t.settings, sentence(b, c)))].join(' ');
      expect(text, `${b.id} v${b.version}`).not.toMatch(/\[object Object\]|undefined|NaN/);
    }
    // A limit written into a block, in any shape, reads in words too.
    const rec = block('unit-reconcile');
    const said = (limit: unknown) => sentenceText(d, rec, {}, sentence(rec, { name: 'x', label: 'x', template: 'C1', args: { value: '$samples', limit } }));
    expect(said({ max: 0 })).toBe('The samples must be at most 0.');
    expect(said({ high: '0', unit: 'units' })).toBe('The samples must be at most 0 units.');
    expect(said({ low: '2', high: '5', unit: 'kg' })).toBe('The samples must be within 2 to 5 kg.');
  });

  it('a quantity or limit is offered only from values of a compatible kind', () => {
    expect(neededKind(block('stage-yield'), 'theoretical')).toBe('mass');
    expect(neededKind(block('stage-yield'), 'yieldLimit')).toBe('fraction');
    expect(neededKind(block('compress'), 'hardnessLimit')).toBe('force');
    const masses = earlierRefs(tablet(), 3, 0).filter((r) => r.kind === 'mass').map((r) => r.ref);
    expect(masses).toContain('compression/compress/meanWeight');
    expect(masses).not.toContain('compression/yield/yield');
    // A later step, or a step inside another sub-batch stage, is never offered.
    expect(earlierRefs(tablet(), 2, 0).map((r) => r.ref).some((r) => r.startsWith('compression/') || r.startsWith('coating/'))).toBe(false);
  });

  it('worked examples run the engine on example values: the weighing meets its adjusted target, the yield is in limits', () => {
    const d = tablet();
    const api = workedExample(d, 1, 0);
    expect(api.results.target).toMatchObject({ ok: true, shown: expect.stringContaining('10.000 kg × 100 ÷ 98.505 % = 10.152 kg') });
    expect(api.results.netCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(workedExample(d, 1, 1).results.target).toMatchObject({ ok: true, shown: expect.stringContaining('11.848 kg Lactose monohydrate') });
    expect(workedExample(d, 3, 0).results.gain).toMatchObject({ ok: true, check: { pass: true } });
    expect(workedExample(d, 2, 1, { output: { value: '20.000', unit: 'kg' } }).results.yield).toMatchObject({ ok: true, check: { pass: false } });
  });

  it('TI-13 the calculation preview adjusts the API for the lot and compensates the filler', () => {
    const rows = dispensing(tablet(), { api: { assay: '98.0', lod: '2.0' } });
    expect(rows[0]!.adjusted).toMatchObject({ ok: true, value: expect.stringMatching(/^10\.41232/) });
    expect(rows[1]!.adjusted).toMatchObject({ ok: true, value: expect.stringMatching(/^11\.58767/) });
    expect(rows[2]!.adjusted).toBeUndefined();
  });

  it('TI-10 TI-23 each starting master (by type and route) is a valid draft with the steps its route\'s rules need; the master check lists only the product\'s own', () => {
    const header = (route: 'terminal' | 'aseptic' | 'both') => ({ productItemId: 'p', productCode: 'P', productName: 'Examplol injection', batchSize: '100', batchUnit: 'L' as const,
      densityGPerMl: '1.02', fillVolumeMl: '10.0', fillExcessMl: '0.5', route, claimPer: 'mL' as const, dispensingRooms: ['RM-101'] });
    expect(skeletonList('terminal').map((s) => s.id)).toEqual(['bulk-only', 'liquid-terminal', 'bag-terminal']);
    expect(skeletonList('aseptic').map((s) => s.id)).toEqual(['bulk-only', 'liquid-aseptic', 'lyo-aseptic', 'syringe-aseptic', 'dispersion-aseptic']);
    expect(skeletonList('both')).toEqual(skeletonList('aseptic'));
    expect(skeletonList()).toHaveLength(7);
    expect(skeletonStages('bulk-only', header('aseptic'))[0]!.steps.map((t) => t.block.id)).toEqual(['line-clearance', 'weigh', 'charge', 'mix', 'check', 'stage-yield']);
    for (const route of ['terminal', 'aseptic'] as const) {
      for (const s of skeletonList(route)) {
        const h = header(route);
        const doc = masterSchema.parse({ header: h, formula: [], stages: skeletonStages(s.id, h) });
        // TI-10: a stage worked in a room starts with line clearance; every step is a block of the library.
        expect(doc.stages.every((st) => !st.roomTypes.length || st.steps[0]!.block.id === 'line-clearance'), s.id).toBe(true);
        expect(doc.stages.every((st) => st.steps.every((t) => findBlock(t.block))), s.id).toBe(true);
        // Left for the author: the formula and the product's limits and values.
        expect(masterChecks(doc).filter((p) => !/not set|no drug substance/.test(p.message)), s.id).toEqual([]);
      }
    }
    // An aseptic starting master marks its filling stage aseptic and reads the EM plates in a stage of results that come later.
    const lyo = skeletonStages('lyo-aseptic', header('aseptic'));
    expect(lyo.filter((s) => s.aseptic).map((s) => s.steps.map((t) => t.block.id).join(' '))).toEqual([
      'line-clearance aseptic-ready interventions em-filling transfer-in fill lyo-load lyo-cycle lyo-unload seal-check qa-sample unit-reconcile']);
    expect(lyo.find((s) => s.startsAfter)).toMatchObject({ kind: 'preparation', startsAfter: 'filling/fill', roomTypes: [] });
    // The bulk yield on the batch mass by the density (engine change 1); the units from the header.
    expect(lyo[0]!.steps.at(-1)!.settings.theoretical).toEqual({ header: 'batchMass' });
    expect(lyo.at(-1)!.steps.at(-1)!.settings.theoretical).toEqual({ header: 'units' });
    // TI-11: a master that weighs names its dispensing rooms; a new one starts with the rooms of the Sterile dispensing area
    // exactly (not the tablet "Dispensing" booth, nor the liquids block's "Liquid dispensing" booth, nor an inactive room).
    const h = header('aseptic');
    const bare = masterSchema.parse({ header: { ...h, dispensingRooms: undefined }, formula: [], stages: skeletonStages('liquid-aseptic', h) });
    expect(masterChecks(bare).filter((p) => p.path === 'header.dispensingRooms')).toEqual([{ level: 'error', path: 'header.dispensingRooms', rule: 'TI-11',
      message: 'The master weighs but names no dispensing rooms: choose them in the header (rooms of master data)' }]);
    expect(defaultDispensingRooms([{ code: 'RM-101', area: 'Dispensing', active: true }, { code: 'RM-102', area: 'Dispensing', active: false },
      { code: 'RM-301', area: 'Liquid dispensing', active: true }, { code: 'RM-103', area: 'Granulation', active: true },
      { code: 'RM-201', area: 'Sterile dispensing', active: true }, { code: 'RM-202', area: 'Sterile dispensing', active: false }])).toEqual(['RM-201']);
  });

  it('the plain view titles each step as the floor does and never shows a step\'s internal key', () => {
    const h = { productItemId: 'p', productCode: 'P', productName: 'Examplol injection', batchSize: '100', batchUnit: 'L' as const, densityGPerMl: '1.02',
      fillVolumeMl: '10.0', fillExcessMl: '0.5', route: 'aseptic' as const, dispensingRooms: ['RM-101'] };
    const d = masterSchema.parse({ header: h, formula: [], stages: skeletonStages('liquid-aseptic', h) });
    d.stages[0]!.steps[3]!.orderAfter = d.stages[0]!.steps[2]!.key;
    const lines = describeMaster(d).filter((s) => s.key.startsWith('stage:')).flatMap((s) => s.lines.filter((l) => l.key !== 'about'));
    expect(lines.map((l) => /^\d+\. ([^:]+):/.exec(l.text)?.[1])).toEqual(d.stages.flatMap((s) => s.steps.map((t) => stepTitle(d, t))));
    for (const l of lines) for (const t of d.stages.flatMap((s) => s.steps)) expect(l.text, l.key).not.toContain(`(${t.key})`);
    expect(lines.map((l) => l.text).filter((x) => /Order-critical/.test(x)).map((x) => /Order-critical: [^.]*\.[^.]*\./.exec(x)![0]))
      .toEqual([`Order-critical: after step 3. ${stepTitle(d, d.stages[0]!.steps[2]!)}.`]);
  });

  it('a limit on a T6 result is of its own kind: diavolumes (a ratio of two volumes) have no unit, not litres', () => {
    expect(neededKind(block('tff'), 'diavolumeLimit')).toBe('number');
    expect(neededKind(block('tff'), 'tmpLimit')).not.toBe('number');
  });

  it('the unit pick lists offer every unit of the unit table: gauge pressure, pH, particles/m³ (17 Nov 2026 run, F6)', () => {
    const symbols = (k?: Parameters<typeof unitsOf>[0]) => unitsOf(k).map((u) => u.symbol);
    expect(symbols('gauge pressure')).toEqual(expect.arrayContaining(['bar g', 'mbar g', 'psi g', 'kPa g']));
    expect(symbols('pH')).toEqual(['pH']);
    expect(symbols()).toEqual(expect.arrayContaining(['pH', 'particles/m³', 'bar g', '°C']));
    // The filter test's maker's limit (a quantity) is of the result's kind, so its unit list offers bar g.
    const ft = BLOCKS.find((b) => b.id === 'filter-test')!;
    expect(symbols(neededKind(ft, 'makerLimit', { resultUnit: 'bar g' }))).toContain('bar g');
    expect(symbols(neededKind(ft, 'temperatureRange', { resultUnit: 'bar g' }))).toContain('°C');
  });

  it('a batch quantity under 0.01 kg reads in g, so a small excipient is not rounded away', () => {
    expect(qtyText({ ok: true, value: '0.0025', unit: 'kg', shown: '' })).toBe('2.500 g');
    expect(qtyText({ ok: true, value: '1.2625', unit: 'kg', shown: '' })).toBe('1.263 kg');
    expect(qtyText({ ok: true, value: '0', unit: 'kg', shown: '' })).toBe('0.000 kg');
    expect(qtyText({ ok: false, message: 'x' })).toBe('—');
  });

  it('a weigh step added from the library starts with the usual tolerance', () => {
    expect(stepFrom(block('weigh'), []).settings).toEqual({ tolerance: '0.5' });
    expect(stepFrom(block('mix'), []).settings).toEqual({});
  });

  it('copy to a new batch size scales typed batch quantities, not limits or quantities per mL', () => {
    const d = scaleDoc(tablet(), '50');
    expect(d.header.batchSize).toBe('50');
    expect(d.stages[1]!.steps[6]!.settings.theoretical).toBe('11.500 kg');
    expect(d.stages[1]!.steps[6]!.settings.yieldLimit).toEqual({ low: '97.0', high: '100.5', unit: '%' });
    expect(d.formula[0]!.mg).toBe('100.0');
  });

  it('the changes view shows what changed, was added or removed since the previous version', () => {
    const prev = tablet();
    const next = tablet();
    next.formula[4]!.mg = '18.0';
    next.stages[2]!.steps.pop();
    next.stages[1]!.produces!.holdHours = 48;
    const diff = diffMasters(prev, next);
    const lines = diff.flatMap((s) => s.lines.filter((l) => l.change !== 'same').map((l) => `${s.title} ${l.key} ${l.change}`));
    expect(lines).toEqual(['Formula mcc changed', 'Stage 2: Granulation about changed', 'Stage 3: Compression yield removed']);
    expect(describeMaster(prev).map((s) => s.title)).toEqual(['Header', 'Formula', 'Stage 1: Binder solution', 'Stage 2: Granulation', 'Stage 3: Compression', 'Stage 4: Coating']);
  });

  it('calculation checks: the author answers a warning; the answer is kept in the master and shown in the review and changes views', () => {
    const prev = tablet();
    prev.formula[0]!.name = 'Examplol hydrochloride';
    const warning = masterChecks(prev).find((p) => p.question?.key === 'label-basis/api')!;
    expect(blocking(warning)).toBe(true);
    expect(describeMaster(prev).at(-1)).toMatchObject({ title: 'Calculation checks', lines: [{ text: expect.stringMatching(/Not answered yet\.$/) }] });
    const next = answerDoc(prev, warning, 'as Examplol hydrochloride', 'The label for this market states the salt');
    expect(next.answers).toEqual({ 'label-basis/api': { about: warning.message, choice: 'as Examplol hydrochloride', reason: 'The label for this market states the salt' } });
    expect(masterSchema.parse(next).answers).toEqual(next.answers);
    expect(unplaced(masterChecks(next).filter(blocking))).toEqual([]);
    const line = describeMaster(next).at(-1)!.lines[0]!.text;
    expect(line).toMatch(/^Formula › Examplol hydrochloride: Label claim .* Answered: as Examplol hydrochloride\. Reason: The label for this market states the salt\.$/);
    expect(diffMasters(prev, next).flatMap((s) => s.lines.filter((l) => l.change !== 'same').map((l) => `${s.title} ${l.change}: ${l.text}`))).toEqual([`Calculation checks changed: ${line}`]);
    // A changed item asks again: the answer was for the warning as it read then.
    const changed = { ...next, formula: next.formula.map((l, i) => (i === 0 ? { ...l, mg: '90.0' } : l)) };
    expect(masterChecks(changed).find((p) => p.question?.key === 'label-basis/api')?.question?.answer).toBeUndefined();
  });
});
