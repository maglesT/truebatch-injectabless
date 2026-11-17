import { describe, expect, it, vi } from 'vitest';
import { BLOCKS, findBlock, latestBlock } from '../shared/blocks/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema } from '../shared/master/schema.js';
import { describeMaster, diffMasters, stepText } from '../web/src/designer/describe.js';
import { dispensing, workedExample } from '../web/src/designer/example.js';
import { answerDoc, earlierRefs, fieldChanges, neededKind, qtyText, scaleDoc, stepFrom, toVersion, unitsOf } from '../web/src/designer/model.js';
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
    expect(said({ high: '0', unit: 'units' })).toBe('The samples must be 0: none allowed.');
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
    expect(skeletonList('aseptic').map((s) => s.id)).toEqual(['bulk-only', 'liquid-aseptic', 'lyo-aseptic', 'syringe-aseptic', 'dispersion-aseptic', 'bfs-aseptic', 'powder-aseptic']);
    expect(skeletonList('both')).toEqual(skeletonList('aseptic'));
    expect(skeletonList()).toHaveLength(9);
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
      'line-clearance aseptic-ready interventions em-filling transfer-in fill lyo-load lyo-cycle lyo-unload container-issue seal-check qa-sample container-return container-return container-return unit-reconcile']);
    // F19, F20 (owner, 17 Nov 2026): the latest set-up and seal check (the isolator or RABS, the capping machine, from the
    // Logbook); containers and closures issued by count from MMS lots: vials and stoppers with the containers, seals
    // before the seal check; a syringe's syringes and plungers in the aseptic stage.
    // Run 2 (G7, G9, G10): the set-up without the typed glove question (version 3); each issue names its material from
    // master data, left for the author (the master check asks for it); what is left is counted back at the end of filling.
    const named = (id: string, block: string) => skeletonStages(id, header('aseptic')).map((st) => st.steps.filter((t) => t.block.id === block).map((t) => t.name).join(', '));
    expect(named('lyo-aseptic', 'container-issue')).toEqual(['', 'Issue the vials, Issue the stoppers', 'Issue the seals', '', '']);
    expect(named('lyo-aseptic', 'container-return')).toEqual(['', '', 'Count back the vials, Count back the stoppers, Count back the seals', '', '']);
    expect(named('liquid-terminal', 'container-issue')).toEqual(['', 'Issue the vials, Issue the stoppers', 'Issue the seals', '', '']);
    expect(named('liquid-terminal', 'container-return')).toEqual(['', '', 'Count back the vials, Count back the stoppers, Count back the seals', '', '']);
    expect(named('syringe-aseptic', 'container-issue')).toEqual(['', 'Issue the syringes, Issue the plungers', '', '']);
    expect(named('syringe-aseptic', 'container-return')).toEqual(['', 'Count back the syringes, Count back the plungers', '', '']);
    expect(lyo.flatMap((s) => s.steps).filter((t) => ['aseptic-ready', 'seal-check', 'container-issue'].includes(t.block.id)).map((t) => `${t.block.id} ${t.block.version}`))
      .toEqual(['container-issue 3', 'container-issue 3', 'aseptic-ready 4', 'container-issue 3', 'seal-check 2']);
    expect(lyo[1]!.steps.find((t) => t.key === 'issue-vials')).toMatchObject({ name: 'Issue the vials', checker: true,
      settings: { expected: { header: 'units' }, enoughLimit: { low: '102.0', unit: '%' }, unit: 'units' } });
    expect(lyo[1]!.steps.find((t) => t.key === 'issue-vials')!.settings.material).toBeUndefined();
    const doc = masterSchema.parse({ header: header('aseptic'), formula: [], stages: lyo });
    expect(masterChecks(doc).filter((p) => p.message === 'Container or closure is not set').map((p) => p.path)).toHaveLength(6);
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

  it('the plain view leaves out an optional limit that is not set, and keeps pH as written (17 Nov 2026 run, F10)', () => {
    const d = tablet();
    const bulk = block('bulk-test');
    const said = (settings: object) => bulk.calcs.map((c) => sentenceText(d, bulk, settings as never, sentence(bulk, c))).filter(Boolean);
    expect(said({})).toEqual(['Appearance: the answer must be "yes".']);
    expect(said({ phLimit: { low: '6.5', high: '7.5', unit: 'pH' } })).toEqual(['The pH must be within 6.5 to 7.5 pH.', 'Appearance: the answer must be "yes".']);
    const ft = block('filter-test');
    const integrity = (settings: object) => sentenceText(d, ft, settings as never, sentence(ft, ft.calcs.find((c) => c.template === 'I19')!));
    const text = integrity({ test: 'bubble point', makerLimit: '3.2 bar g', wettedWith: 'water', temperatureRange: { low: '15', high: '25', unit: '°C' } });
    expect(text).not.toContain('(not set)');
    expect(text).toContain('3.2 bar g, water and the test temperature');
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

  it('TI-23 TI-25 TI-28 the blow-fill-seal and sterile powder starting masters (17 Nov 2026) are valid drafts with their stages and steps', () => {
    const header = (batchUnit: 'L' | 'units') => ({ productItemId: 'p', productCode: 'P', productName: 'Examplol', batchSize: batchUnit === 'L' ? '100' : '20000', batchUnit,
      ...(batchUnit === 'L' ? { densityGPerMl: '1.0', fillVolumeMl: '2.0', fillExcessMl: '0.1' } : {}), route: 'aseptic' as const,
      claimPer: batchUnit === 'L' ? 'mL' as const : 'container (filled content)' as const, dispensingRooms: ['RM-201'] });
    const list = (id: string, h: ReturnType<typeof header>) => skeletonStages(id, h).map((st) => `${st.name}${st.aseptic ? ' (aseptic)' : ''}: ${st.steps.map((t) => t.key).join(' ')}`);
    expect(list('bfs-aseptic', header('L'))).toEqual([
      'Compounding: line-clearance weigh-api vehicle charge-api dissolve ph-adjust make-up bulk-test filter-pre filter filter-post yield',
      'Aseptic blow-fill-seal (aseptic): line-clearance aseptic-ready interventions em-filling issue-granules ffs-run sterility back-granules unit-reconcile',
      'Results later (EM plates, bioburden): plates',
      'Inspection: line-clearance leak-test-100 visual-inspect aql-sample unit-reconcile']);
    expect(list('powder-aseptic', header('units'))).toEqual([
      'Sterile dispensing: line-clearance weigh-api',
      'Containers and closures: line-clearance issue-vials issue-stoppers wash-vials depyrogenate stoppers',
      'Aseptic filling (aseptic): line-clearance aseptic-ready interventions em-filling transfer-in powder-fill issue-seals seal-check sterility back-vials back-stoppers back-seals unit-reconcile',
      'Results later (EM plates, bioburden): plates',
      'Inspection: line-clearance visual-inspect aql-sample unit-reconcile']);
    const bfs = skeletonStages('bfs-aseptic', header('L'));
    const step = (key: string) => bfs[1]!.steps.find((t) => t.key === key)!;
    // The granules are issued and weighed back in kg from an MMS lot (the container issue by weight); the newest blocks.
    expect(step('issue-granules')).toMatchObject({ name: 'Issue the plastic granules', block: { id: 'container-issue', version: 3 }, settings: { unit: 'kg' } });
    expect(step('issue-granules').settings.expected).toBeUndefined();
    expect(step('back-granules')).toMatchObject({ name: 'Weigh back the plastic granules', block: { id: 'container-return', version: 2 }, settings: { unit: 'kg' } });
    expect([step('aseptic-ready').block.version, step('ffs-run').block.version]).toEqual([4, 2]);
    expect(bfs[1]).toMatchObject({ roomTypes: ['Aseptic filling'], uses: ['compounding'] });
    expect(bfs[2]).toMatchObject({ startsAfter: 'filling/ffs-run' });
    // The bag master takes ffs-run version 2 too.
    expect(skeletonStages('bag-terminal', { ...header('L'), route: 'terminal' }).flatMap((st) => st.steps).find((t) => t.block.id === 'ffs-run')!.block.version).toBe(2);
    const powder = skeletonStages('powder-aseptic', header('units'));
    expect(powder[0]).toMatchObject({ kind: 'preparation', roomTypes: ['Sterile dispensing'], produces: { name: 'dispensed sterile powder' } });
    expect(powder[2]).toMatchObject({ uses: ['dispensing', 'components'] });
    expect(powder[3]).toMatchObject({ startsAfter: 'filling/powder-fill' });
    // Each is a valid draft: the master check asks only for the product's own (the formula, materials and limits).
    for (const [id, h] of [['bfs-aseptic', header('L')], ['powder-aseptic', header('units')]] as const) {
      const doc = masterSchema.parse({ header: h, formula: [], stages: skeletonStages(id, h) });
      expect(masterChecks(doc).filter((p) => !/not set|no drug substance/.test(p.message)), id).toEqual([]);
    }
  });

  it('run 2 G3: a step that only moved is not changed; a step moved to a newer block version says what it now records', () => {
    const h = { productItemId: 'p', productCode: 'P', productName: 'Examplol injection', batchSize: '100', batchUnit: 'L' as const, densityGPerMl: '1.0',
      fillVolumeMl: '2.0', fillExcessMl: '0.1', route: 'aseptic' as const };
    const prev = skeletonStages('lyo-aseptic', h);
    const doc = (stages: typeof prev) => masterSchema.parse({ header: h, formula: [], stages });
    const before = doc(prev.map((s) => (s.key === 'filling' ? { ...s, steps: s.steps.map((t) => (t.block.id === 'aseptic-ready' ? { ...t, block: { id: 'aseptic-ready', version: 1 } } : t)) } : s)));
    const after = doc(prev.map((s) => (s.key === 'components' ? { ...s, steps: [s.steps[0]!, s.steps[2]!, s.steps[1]!, ...s.steps.slice(3)] } : s)));
    const changed = diffMasters(before, after).flatMap((s) => s.lines.filter((l) => l.change !== 'same').map((l) => [l.key, l.text.replace(/^.*Block version/, 'Block version')]));
    expect(changed).toEqual([['aseptic-ready', 'Block version 1 → 4: now also records Isolator, RABS or blow-fill-seal machine; no longer records Glove integrity test passed.']]);
  });

  it('run 2 G1: a step moved to the newer version of its block keeps the settings of the same names, its name and its flow', () => {
    const v1 = { ...stepFrom(findBlock({ id: 'container-issue', version: 1 })!, []), name: 'Issue the seals', settings: { what: 'seals', expected: { header: 'units' as const }, enoughLimit: { low: '102.0', unit: '%' } } };
    const v2 = toVersion(v1, latestBlock('container-issue')!);
    // Version 3 (17 Nov 2026) adds the unit: a count by default.
    expect(v2).toMatchObject({ name: 'Issue the seals', block: { id: 'container-issue', version: 3 }, settings: { expected: { header: 'units' }, enoughLimit: { low: '102.0', unit: '%' }, unit: 'units' } });
    expect(v2.settings.what).toBeUndefined();
    expect(fieldChanges(findBlock({ id: 'container-issue', version: 1 })!, latestBlock('container-issue')!)).toEqual({ added: [], removed: ['Count returned to stores at the end'] });
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
