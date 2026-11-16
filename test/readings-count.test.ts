// Engine change 4: the number of readings set by the master step (one fill weight per filling needle). The sterile
// blocks that use it come with the final library (phase E); here a fixture block, added for these tests only.
import { describe, expect, it, vi } from 'vitest';
import type { Block } from '../shared/blocks/format.js';

vi.mock('../shared/blocks/index.js', async (original) => {
  const m = await original<typeof import('../shared/blocks/index.js')>();
  const fill: Block = {
    id: 'test-fill', version: 1, name: 'Fill weight check', instruction: 'Weigh one filled unit from each needle.', checker: false,
    fields: [{ name: 'weights', label: 'Fill weight per needle', kind: 'number', unit: 'g', count: '$needles' }],
    settings: [{ name: 'needles', label: 'Number of filling needles', kind: 'number' }, { name: 'meanLimit', label: 'Mean limits', kind: 'limit' }],
    calcs: [{ name: 'mean', label: 'Mean fill weight', template: 'T7', args: { readings: '$weights', limit: '$meanLimit' } }],
  };
  const BLOCKS = [...m.BLOCKS, fill];
  return { ...m, BLOCKS, findBlock: (r: { id: string; version: number }) => BLOCKS.find((b) => b.id === r.id && b.version === r.version) };
});

const { blockProblems } = await import('../shared/blocks/format.js');
const { findBlock } = await import('../shared/blocks/index.js');
const { evaluate, parseKey, readValue, stepFields } = await import('../shared/engine/index.js');
const { masterChecks } = await import('../shared/master/checks.js');
const { small, unplaced } = await import('./engine-fixture.js');

const block = () => findBlock({ id: 'test-fill', version: 1 })!;
const doc = (needles: string) => small([{ steps: [{ key: 'fill', block: { id: 'test-fill', version: 1 }, settings: { needles, meanLimit: { low: '2.10', high: '2.20', unit: 'g' } } }] }]);
const weights = (n: number) => Array.from({ length: n }, () => '2.150');

describe('engine change 4: the number of readings set by the master step', () => {
  it('readings count: a block may take its number of readings from a number setting, never from another kind', () => {
    expect(blockProblems(block())).toEqual([]);
    expect(blockProblems({ ...block(), settings: [{ name: 'needles', label: 'Needles', kind: 'text' }, block().settings[1]!] }))
      .toEqual(['field weights: its count $needles is not a number setting']);
  });

  it('readings count: the step sets the number (1 to 24 needles here), and exactly that many readings are taken', () => {
    for (const n of [1, 8, 24]) {
      const f = stepFields(block(), doc(String(n)).stages[0]!.steps[0]!)[0]!;
      expect(f.count).toBe(n);
      expect(readValue(f, weights(n), 'g')).toHaveLength(n);
      expect(readValue(f, weights(n + 1), 'g')).toEqual({ error: `Fill weight per needle: give exactly ${n} readings` });
    }
    const values = { weights: weights(8).map((value) => ({ value, unit: 'g' })) };
    expect(evaluate(doc('8'), [], parseKey('0.1.0.1')!, values).mean).toMatchObject({ ok: true, check: { pass: true } });
  });

  it('TI-01 the master check refuses a number of readings that is not a whole number from 1 to 100', () => {
    const problems = (n: string) => unplaced(masterChecks(doc(n))).filter((p) => !/yield step/.test(p.message)).map((p) => p.message);
    expect(problems('8')).toEqual([]);
    for (const n of ['0', '2.5', '101']) expect(problems(n)).toContain('Fill weight per needle: the number of readings must be a whole number from 1 to 100');
    const f = stepFields(block(), doc('0').stages[0]!.steps[0]!)[0]!;
    expect(readValue(f, weights(1), 'g')).toEqual({ error: 'Fill weight per needle: the master step sets no number of readings' });
  });
});
