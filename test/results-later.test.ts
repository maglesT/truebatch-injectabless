// Engine change 3: results that come days later (EM plates, BIs, bioburden) in a preparation stage that starts after
// a named step, runs beside the stages after it and must close before production signs.
import { describe, expect, it } from 'vitest';
import { batchView, openSteps, type StepEvent } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import { at, ev, small, unplaced } from './engine-fixture.js';

// Stage 0: filling (two checks); stage 1: plates read later, after filling's first check; stage 2: inspection.
const doc = () => small([{ name: 'Filling', steps: [{ key: 'fill' }, {}] }, { name: 'Plates read', kind: 'preparation', startsAfter: 's0/fill' }, { name: 'Inspection' }]);
const done = (key: string): StepEvent[] => [ev('started', key), ev('value', key, { payload: { values: { reading: { value: '6.0', unit: '' } }, results: {} } }), ev('done', key)];
const state = (events: StepEvent[]) => openSteps(doc(), events, at(10_000)).steps.map((s) => `${s.id} ${s.state}${s.blocked ? ` (${s.blocked})` : ''}`);

describe('engine change 3: results that come later', () => {
  it('results later: the stage of results starts only after the named step is done', () => {
    expect(state([])).toEqual(['0.1.0.1 open', '0.1.1.1 waiting (Waits for “Check a value against limits: pH”)', '1.1.0.1 waiting (Starts after “Check a value against limits: pH”)', '2.1.0.1 waiting (Waits for stage Filling to close)']);
    expect(state(done('0.1.0.1'))[2]).toBe('1.1.0.1 open');
  });

  it('results later: the next stages do not wait for it; production cannot sign until it is closed (TI-20)', () => {
    const filled = [...done('0.1.0.1'), ...done('0.1.1.1')];
    expect(state(filled).at(-1)).toBe('2.1.0.1 open');
    const inspected = [...filled, ...done('2.1.0.1')];
    expect(batchView(doc(), inspected, [], at(10_000)).open).toContain('Stage Plates read is not closed');
    expect(batchView(doc(), [...inspected, ...done('1.1.0.1')], [], at(10_000))).toMatchObject({ open: [], status: 'manufacturing complete' });
  });

  it('TI-01 the master check: only a preparation starts after a step, of an earlier stage, and no stage uses it', () => {
    const d = doc();
    expect(unplaced(masterChecks(d)).filter((p) => !/yield step/.test(p.message))).toEqual([]);
    d.stages[1]!.startsAfter = 's2/t0';
    expect(unplaced(masterChecks(d)).map((p) => p.message)).toContain('s2/t0 is not a step of an earlier stage');
    d.stages[1]!.startsAfter = 's0/fill';
    d.stages[2]!.uses = ['s1'];
    expect(unplaced(masterChecks(d)).map((p) => p.message)).toContain('Plates read starts after a step, so no stage can wait for it; it only has to close before production signs');
    const n = doc();
    n.stages[1]!.kind = 'normal';
    expect(unplaced(masterChecks(n)).map((p) => p.message)).toContain('Only a preparation stage starts after a step (results that come later): Plates read is not one');
  });
});
