import { describe, expect, it } from 'vitest';
import { BLOCKS, findBlock } from '../shared/blocks/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema } from '../shared/master/schema.js';
import { describeMaster, diffMasters, stepText } from '../web/src/designer/describe.js';
import { dispensing, workedExample } from '../web/src/designer/example.js';
import { answerDoc, earlierRefs, neededKind, scaleDoc, stepFrom } from '../web/src/designer/model.js';
import { sentence, sentenceText } from '../web/src/designer/sentences.js';
import { defaultDispensingRooms, SKELETON_LIST, skeletonStages } from '../web/src/designer/skeletons.js';
import { tablet, unplaced } from './engine-fixture.js';

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
    const punch = block('punch-die-check');
    expect(sentenceText(d, punch, {}, sentence(punch, punch.calcs[1]!))).toBe('The punches or dies damaged must be at most 0 units.');
    // Any other shape written into a block reads in words too.
    const said = (limit: unknown) => sentenceText(d, punch, {}, sentence(punch, { name: 'x', label: 'x', template: 'C1', args: { value: '$damaged', limit } }));
    expect(said({ max: 0 })).toBe('The punches or dies damaged must be at most 0.');
    expect(said({ low: '2', high: '5', unit: 'kg' })).toBe('The punches or dies damaged must be within 2 to 5 kg.');
    expect(said([{ high: '$toolingCheck', highStrict: true }, { min: 1 }])).toBe('The punches or dies damaged must be less than the punches and dies and at least 1.');
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

  it('TB-13 the calculation preview adjusts the API for the lot and compensates the filler', () => {
    const rows = dispensing(tablet(), { api: { assay: '98.0', lod: '2.0' } });
    expect(rows[0]!.adjusted).toMatchObject({ ok: true, value: expect.stringMatching(/^10\.41232/) });
    expect(rows[1]!.adjusted).toMatchObject({ ok: true, value: expect.stringMatching(/^11\.58767/) });
    expect(rows[2]!.adjusted).toBeUndefined();
  });

  it('TB-10 both process skeletons are valid drafts and start every stage with line clearance; what they leave open is listed by the master check', () => {
    const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100000', coreWeightMg: '250.0', coatedWeightMg: '257.5', dispensingRooms: ['RM-101'] };
    for (const s of SKELETON_LIST) {
      const doc = masterSchema.parse({ header, formula: [], stages: skeletonStages(s.id, header) });
      expect(doc.stages.every((st) => st.steps.every((t) => findBlock(t.block)))).toBe(true);
      expect(masterChecks(doc).every((p) => /not set|no core materials|choose the rooms/.test(p.message))).toBe(true);
    }
    // TB-11: a master that weighs names its dispensing rooms; a new one starts with the rooms of the Dispensing area
    // exactly (not the liquids block's "Liquid dispensing" booth, nor an inactive room).
    const bare = masterSchema.parse({ header: { ...header, dispensingRooms: undefined }, formula: [], stages: skeletonStages(SKELETON_LIST[0]!.id, header) });
    expect(masterChecks(bare).filter((p) => p.path === 'header.dispensingRooms')).toEqual([{ level: 'error', path: 'header.dispensingRooms', rule: 'TB-11',
      message: 'The master weighs but names no dispensing rooms: choose them in the header (rooms of master data)' }]);
    expect(defaultDispensingRooms([{ code: 'RM-101', area: 'Dispensing', active: true }, { code: 'RM-102', area: 'Dispensing', active: false },
      { code: 'RM-301', area: 'Liquid dispensing', active: true }, { code: 'RM-103', area: 'Granulation', active: true }])).toEqual(['RM-101']);
    // The rooms: the usual areas where every plant has them; a preparation and blending are left for the author (TB-11).
    const rooms = (id: string) => masterChecks(masterSchema.parse({ header, formula: [], stages: skeletonStages(id, header) })).filter((p) => p.rule === 'TB-11').map((p) => p.message.split(':')[0]);
    expect(rooms('wet-granulation-film-coated')).toEqual(['Stage Binder solution', 'Stage Blending', 'Stage Coating suspension']);
    expect(skeletonStages('wet-granulation-film-coated', header).map((s) => s.roomTypes.join())).toEqual(['', 'Granulation', '', 'Compression', '', 'Coating']);
    const dc = skeletonStages('direct-compression-uncoated', header);
    expect(dc.map((s) => s.steps.map((t) => t.block.id).join(' '))).toEqual(['line-clearance weigh sift dry-mix stage-yield',
      'line-clearance punch-die-check compress friability disintegration punch-die-check tablet-reconciliation']);
    expect(dc[1]!.steps[2]!.settings.meanLimit).toEqual({ low: '237.5', high: '262.5', unit: 'mg' });
    expect(dc[1]!.steps.filter((t) => t.block.id === 'punch-die-check').map((t) => t.name)).toEqual(['Punch and die check — before compression', 'Punch and die check — after compression']);
    expect(dc[0]!.steps[1]!.settings).toEqual({ tolerance: '0.5' });
    const wg = skeletonStages('wet-granulation-film-coated', header);
    const at = (stage: string, step: string) => wg.find((s) => s.key === stage)!.steps.find((t) => t.key === step)!;
    expect(at('coating', 'coat')).toMatchObject({ block: { id: 'spray-coat' }, everyMinutes: 30, flow: { kind: 'repeat-until' } });
    // Later stages' yields on the actual input; the coating gain on the actual core mean; the end point checked.
    expect(at('blending', 'yield').settings.theoretical).toEqual({ ref: 'granulation/yield/output' });
    expect(at('coating', 'yield')).toMatchObject({ block: { id: 'tablet-reconciliation' }, settings: { theoretical: { ref: 'compression/yield/goodTablets' }, meanWeight: { ref: 'coating/coat/meanWeight' } } });
    expect(at('coating', 'coat').settings.coreWeight).toEqual({ ref: 'compression/compress/meanWeight' });
    expect(at('granulation', 'granulate').checker).toBe(true);
  });

  it('a weigh step added from the library starts with the usual tolerance', () => {
    expect(stepFrom(block('weigh'), []).settings).toEqual({ tolerance: '0.5' });
    expect(stepFrom(block('sift'), []).settings).toEqual({});
  });

  it('copy to a new batch size scales typed batch quantities, not limits or quantities per tablet', () => {
    const d = scaleDoc(tablet(), '50000');
    expect(d.header.batchSize).toBe('50000');
    expect(d.stages[1]!.steps[6]!.settings.theoretical).toBe('11.500 kg');
    expect(d.stages[1]!.steps[6]!.settings.yieldLimit).toEqual({ low: '97.0', high: '100.5', unit: '%' });
    expect(d.formula[0]!.mgPerTablet).toBe('100.0');
  });

  it('the changes view shows what changed, was added or removed since the previous version', () => {
    const prev = tablet();
    const next = tablet();
    next.formula[4]!.mgPerTablet = '18.0';
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
    const changed = { ...next, formula: next.formula.map((l, i) => (i === 0 ? { ...l, mgPerTablet: '90.0' } : l)) };
    expect(masterChecks(changed).find((p) => p.question?.key === 'label-basis/api')?.question?.answer).toBeUndefined();
  });
});
