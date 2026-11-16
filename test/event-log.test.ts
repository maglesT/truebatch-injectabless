// Engine change 2: an event log beside a stage (interventions, stoppages, time out of the fridge). The sterile blocks
// that use it come with the final library (phase E); here a fixture block, added for these tests only.
import { describe, expect, it, vi } from 'vitest';
import type { Block } from '../shared/blocks/format.js';

vi.mock('../shared/blocks/index.js', async (original) => {
  const m = await original<typeof import('../shared/blocks/index.js')>();
  const log: Block = {
    id: 'test-log', version: 1, name: 'Record an event', instruction: 'Record what happened, when, and the units removed.', checker: false, log: true,
    fields: [{ name: 'what', label: 'What happened', kind: 'text' }, { name: 'removed', label: 'Units removed', kind: 'number', unit: 'units' }],
    settings: [], calcs: [],
  };
  const total: Block = {
    id: 'test-total', version: 1, name: 'Units removed in the stage', instruction: 'Confirm the total.', checker: false,
    fields: [{ name: 'confirmed', label: 'Total confirmed', kind: 'yes-no' }],
    settings: [{ name: 'removed', label: 'Units removed', kind: 'quantity' }],
    calcs: [{ name: 'total', label: 'Total units removed', template: 'T2', args: { values: '$removed' } }],
  };
  const BLOCKS = [...m.BLOCKS, log, total];
  return { ...m, BLOCKS, OFFERED: [...m.OFFERED, 'test-log'], findBlock: (r: { id: string; version: number }) => BLOCKS.find((b) => b.id === r.id && b.version === r.version) };
});

const { evaluate, openSteps, parseKey } = await import('../shared/engine/index.js');
const { masterChecks } = await import('../shared/master/checks.js');
const { at, ev, small, unplaced } = await import('./engine-fixture.js');
type StepEvent = import('../shared/engine/index.js').StepEvent;

// Stage 0: the event log, then a check (the filling); stage 1: the total of the units removed.
const doc = small([
  { steps: [{ key: 'log', block: { id: 'test-log', version: 1 }, settings: {} }, {}] },
  { steps: [{ key: 'total', block: { id: 'test-total', version: 1 }, settings: { removed: { ref: 's0/log/removed' } } }] },
]);
const entry = (round: number, what: string, removed: string): StepEvent[] => {
  const key = `0.1.0.${round}`;
  return [ev('started', key), ev('value', key, { payload: { values: { what, removed: { value: removed, unit: 'units' } }, results: {} } }), ev('done', key)];
};
const filled = [ev('started', '0.1.1.1'), ev('value', '0.1.1.1', { payload: { values: { reading: { value: '6.0', unit: '' } }, results: {} } }), ev('done', '0.1.1.1')];
const view = (events: StepEvent[]) => openSteps(doc, events, at(10_000));
const ids = (events: StepEvent[]) => view(events).steps.map((s) => `${s.id} ${s.state}`);

describe('engine change 2: an event log beside a stage', () => {
  it('event log: the master check takes an event log as any step', () => {
    expect(unplaced(masterChecks(doc)).filter((p) => !/has no yield step/.test(p.message))).toEqual([]);
  });

  it('event log: an entry can be added at any time while the stage runs; what follows does not wait for it', () => {
    expect(ids([])).toEqual(['0.1.0.1 open', '0.1.1.1 open', '1.1.0.1 waiting']);
  });

  it('event log: each finished entry offers the next; an entry under way holds the stage', () => {
    const one = entry(1, 'Stopper bowl jam cleared', '3');
    expect(ids(one)).toEqual(['0.1.0.1 done', '0.1.0.2 open', '0.1.1.1 open', '1.1.0.1 waiting']);
    const underWay = [...one, ...filled, ev('started', '0.1.0.2')];
    expect(view(underWay).stages[0]!.closed).toBe(false);
  });

  it('event log: with no entry the stage closes when its other steps are done, and then no new entry starts', () => {
    const v = view(filled);
    expect(v.stages[0]!.closed).toBe(true);
    expect(v.steps.map((s) => `${s.id} ${s.state}`)).toEqual(['0.1.1.1 done', '1.1.0.1 open']);
    const after = view([...entry(1, 'Needle change', '5'), ...filled]);
    expect(after.stages[0]!.closed).toBe(true);
    expect(after.steps.map((s) => s.id)).toEqual(['0.1.0.1', '0.1.1.1', '1.1.0.1']);
  });

  it('TI-18 a later step reads every entry of a field: the units removed add up (zero when there is none)', () => {
    const events = [...entry(1, 'Stopper bowl jam cleared', '3'), ...entry(2, 'Needle change', '5'), ...filled];
    expect(evaluate(doc, events, parseKey('1.1.0.1')!, {}).total).toMatchObject({ ok: true, value: '8', unit: 'units' });
    expect(evaluate(doc, filled, parseKey('1.1.0.1')!, {}).total).toMatchObject({ ok: true, value: '0', unit: 'units' });
  });
});
