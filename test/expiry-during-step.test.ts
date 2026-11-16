// Engine change 6: an item that expires during a step. Taking an expired one is refused (TI-12, test/links.test.ts);
// one that expires while the step is under way needs a deviation note before the step is signed done.
import { describe, expect, it } from 'vitest';
import { doneProblems, openSteps, type StepEvent } from '../shared/engine/index.js';
import { ev, small } from './engine-fixture.js';

// A weighing of the small fixture's material, its lot taken on 15 Nov 2026 (plant time) with a use-by date.
const doc = small([{ steps: [{ key: 'weigh', block: { id: 'weigh', version: 1 }, checker: false, settings: { target: '1.000 kg', tolerance: '0.5' } }] }]);
const day = (d: string, hhmm = '10:00') => new Date(`${d}T${hhmm}:00+05:30`);
const taken = (useBy: string): StepEvent[] => [
  { ...ev('started', '0.1.0.1'), at: day('2026-11-15', '09:00') },
  { ...ev('value', '0.1.0.1', { payload: { values: { lot: 'API-1', 'lot.expiry': useBy, balance: { itemId: 'b', code: 'BAL-1', name: 'Balance', version: 1 },
    gross: { value: '1.300', unit: 'kg' }, tare: { value: '0.300', unit: 'kg' } }, results: {} } }), at: day('2026-11-15', '09:30') },
];
const problems = (events: StepEvent[], now: Date) => doneProblems(doc, openSteps(doc, events, now).steps[0]!, now).filter((p) => /expired/.test(p));

describe('engine change 6: an item expiring during a step', () => {
  it('TI-12 a lot usable on its use-by day can be signed that day; the next day the step needs a deviation note', () => {
    expect(problems(taken('2026-11-15'), day('2026-11-15', '23:30'))).toEqual([]);
    expect(problems(taken('2026-11-15'), day('2026-11-16', '00:30'))).toEqual(['Lot API-1 expired on 15 Nov 2026, during this step. Add a deviation note first.']);
    expect(problems(taken('2027-01-31'), day('2026-11-16'))).toEqual([]);
  });

  it('TI-12 a deviation note written after the expiry lets the step be signed; one written before does not', () => {
    const before = [...taken('2026-11-15'), { ...ev('note', '0.1.0.1', { payload: { text: 'Expires tonight', reference: 'DEV-26-040' } }), at: day('2026-11-15', '20:00') }];
    expect(problems(before, day('2026-11-16'))).toHaveLength(1);
    const after = [...taken('2026-11-15'), { ...ev('note', '0.1.0.1', { payload: { text: 'Lot expired before the weighing was signed', reference: 'DEV-26-041' } }), at: day('2026-11-16', '00:10') }];
    expect(problems(after, day('2026-11-16'))).toEqual([]);
  });
});
