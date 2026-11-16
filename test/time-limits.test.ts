// Engine change 5: time limits from step X (start or end) to step Y (start or end), at most N hours, on the hold-time
// timer: the same display, due soon and late, and a deviation note when overrun (TI-17).
import { describe, expect, it } from 'vitest';
import { batchView, lateItems, openSteps, timers, type StepEvent } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import type { MasterDoc } from '../shared/master/schema.js';
import { at, ev, small, unplaced } from './engine-fixture.js';

// Stage 0 "Compounding" (t0, t1), stage 1 "Filtration" (t0, t1): from the end of compounding's t0 to the start of
// filtration's t1, at most 2 h.
const doc = (): MasterDoc => ({ ...small([{ name: 'Compounding', steps: [{}, {}] }, { name: 'Filtration', steps: [{}, {}] }]),
  timeLimits: [{ key: 'compound-filter', name: 'Compounding to filtration', from: { step: 's0/t0', at: 'end' }, to: { step: 's1/t1', at: 'start' }, hours: 2 }] });
const step = (key: string, start: number, end: number): StepEvent[] => [ev('started', key, { min: start }),
  ev('value', key, { min: start, payload: { values: { reading: { value: '6.0', unit: '' } }, results: {} } }), ev('done', key, { min: end })];
const limit = (events: StepEvent[], now: number) => timers(doc(), events, at(now)).filter((t) => t.id === 'limit:compound-filter');

describe('engine change 5: time limits from step X to step Y', () => {
  it('TI-17 the timer starts at the end of X and runs on the server clock: running, due soon, late', () => {
    const events = [...step('0.1.0.1', 0, 10), ...step('0.1.1.1', 11, 20), ...step('1.1.0.1', 21, 30)];
    expect(limit([], 5)).toEqual([]);
    expect(limit(events, 60)).toEqual([expect.objectContaining({ kind: 'hold', state: 'running', from: at(10), at: at(130),
      label: 'Compounding to filtration (at most 2 h, from the end of “Check a value against limits: pH” to the start of “Check a value against limits: pH”)' })]);
    expect(limit(events, 120)[0]!.state).toBe('due soon');
    expect(limit(events, 131)[0]!.state).toBe('late');
  });

  it('TI-17 reached in time: no timer; reached late: a deviation note is needed before production signs', () => {
    const base = [...step('0.1.0.1', 0, 10), ...step('0.1.1.1', 11, 20), ...step('1.1.0.1', 21, 30)];
    expect(limit([...base, ...step('1.1.1.1', 100, 110)], 200)).toEqual([]);
    const late = [...base, ...step('1.1.1.1', 140, 150)];
    expect(limit(late, 200)).toEqual([expect.objectContaining({ state: 'late' })]);
    expect(batchView(doc(), late, [], at(200)).late).toEqual(['Compounding to filtration (at most 2 h, from the end of “Check a value against limits: pH” to the start of “Check a value against limits: pH”) ran over: a deviation note is needed']);
    const noted = [...late, ev('note', '1.1.1.1', { min: 160, payload: { text: 'Filter change took longer', reference: 'DEV-26-031' } })];
    expect(lateItems(doc(), noted, at(200))[0]!.notes).toHaveLength(1);
    expect(batchView(doc(), noted, [], at(200)).late).toEqual([]);
  });

  it('TI-17 the master check: steps of this master, a name, two different points', () => {
    const d = doc();
    expect(unplaced(masterChecks(d)).filter((p) => p.path.startsWith('timeLimits'))).toEqual([]);
    d.timeLimits = [{ ...d.timeLimits![0]!, name: '', to: { step: 's9/t0', at: 'start' } }];
    expect(unplaced(masterChecks(d)).filter((p) => p.path.startsWith('timeLimits')).map((p) => p.message))
      .toEqual(['A time limit: s9/t0 is not a step of this master', 'A time limit needs its name']);
    d.timeLimits = [{ ...d.timeLimits[0]!, name: 'Same', from: { step: 's0/t0', at: 'end' }, to: { step: 's0/t0', at: 'end' } }];
    expect(unplaced(masterChecks(d)).filter((p) => p.path.startsWith('timeLimits')).map((p) => p.message)).toEqual(['Same: it starts and ends at the same point']);
  });

  it('TI-17 a limit that ran out before Y started holds Y\'s stage until a deviation note', () => {
    const d: MasterDoc = { ...doc(), timeLimits: [{ key: 'to-stage', name: 'Compounding to filtration start', from: { step: 's0/t0', at: 'end' }, to: { step: 's1/t0', at: 'start' }, hours: 1 }] };
    const events = [...step('0.1.0.1', 0, 10), ...step('0.1.1.1', 11, 20)];
    expect(openSteps(d, events, at(100)).stages[1]!.blocked).toMatch(/Compounding to filtration start .* ran out: a deviation note is needed/);
  });
});
