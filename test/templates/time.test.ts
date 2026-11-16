import { describe, expect, it } from 'vitest';
import { f8DiversionWindow, f8LotsInWindow, t13Duration } from '../../shared/templates/time.js';
import { ok, refused } from './helpers.js';

describe('T13 Duration and hold time', () => {
  it.each([
    ['2026-11-15 08:30', '2026-11-15 10:05', 'min', '95.00'], // 1 h 35 min
    ['2026-11-15 23:50', '2026-11-16 00:20', 'min', '30.00'], // across midnight
    ['2026-11-15T08:30:00', '2026-11-15T08:33:30', 'min', '3.50'], // seconds
    ['2026-11-13 09:00', '2026-11-15 09:00', 'h', '48.00'], // hold time 48 h
    ['2026-11-15 08:00+05:30', '2026-11-15 03:00Z', 'min', '30.00'], // 08:00 IST = 02:30 UTC
    ['2028-02-28 23:00', '2028-02-29 01:00', 'h', '2.00'], // leap day
  ])('T13: %s → %s = %s %s', (start, end, unit, want) => {
    expect(ok(t13Duration({ mode: 'duration', start, end, unit })).value.toFixed(2)).toBe(want);
  });

  it.each([
    ['2026-11-15 09:02', true], // 48.0333 h → 48.0 ≤ 48.0
    ['2026-11-15 09:03', false], // 48.05 h → 48.1 > 48.0 (half up)
  ])('T13: hold time NMT 48.0 h ending %s → pass %s', (end, pass) => {
    expect(ok(t13Duration({ mode: 'duration', start: '2026-11-13 09:00', end, unit: 'h', limit: { high: '48.0', unit: 'h' } })).check?.pass).toBe(pass);
  });

  it('T13: mixing time at least 5 min, limit in s converted: 4 min 50 s fails NLT 300 s', () => {
    expect(ok(t13Duration({ mode: 'duration', start: '2026-11-15 08:00:00', end: '2026-11-15 08:04:50', limit: { low: '300', unit: 's' } })).check?.pass).toBe(false);
  });

  it('T13: curing time counted only while at or above 40.0 °C (formulation 15): 24 h counted, 12 h not', () => {
    // readings every 6 h: 40.5, 41.0, 38.5 (out), 40.2, 40.8, 40.4, 40.1; intervals touching the 38.5 reading do not count:
    // 0-6 ✓, 6-12 ✗, 12-18 ✗, 18-24 ✓, 24-30 ✓, 30-36 ✓ → 24 h
    const values = ['40.5', '41.0', '38.5', '40.2', '40.8', '40.4', '40.1'];
    const times = ['2026-11-15 00:00', '2026-11-15 06:00', '2026-11-15 12:00', '2026-11-15 18:00', '2026-11-16 00:00', '2026-11-16 06:00', '2026-11-16 12:00'];
    const r = ok(t13Duration({ mode: 'accumulated', readings: times.map((time, n) => ({ time, value: `${values[n] ?? ''} °C` })), inside: { low: '40.0', unit: '°C' }, target: '24 h', unit: 'h' }));
    expect(r.value.toFixed(2)).toBe('24.00');
    expect(r.targetReached).toBe(true);
    expect(r.shown).toContain('12.00 h not counted');
  });

  it('T13: curing: a reading of 39.95 °C rounds to 40.0 and counts', () => {
    const r = ok(t13Duration({ mode: 'accumulated', readings: [{ time: '2026-11-15 00:00', value: '39.95 °C' }, { time: '2026-11-15 01:00', value: '40.3 °C' }], inside: { low: '40.0', unit: '°C' }, target: '2 h' }));
    expect(r.value.toFixed(0)).toBe('60');
    expect(r.targetReached).toBe(false);
  });

  it.each([
    [{ mode: 'duration' as const, start: '2026-11-15 10:00', end: '2026-11-15 09:00' }, /before the start/],
    [{ mode: 'duration' as const, start: '15/11/2026 10:00', end: '2026-11-15 11:00' }, /not a date and time/],
    [{ mode: 'duration' as const, start: '2026-02-30 10:00', end: '2026-03-01 11:00' }, /not a real date/],
    [{ mode: 'duration' as const, start: '2026-11-15 10:00', end: '2026-11-15 11:00', unit: 'kg' }, /must be a time/],
    [{ mode: 'accumulated' as const, readings: [{ time: '2026-11-15 10:00', value: '40 °C' }], inside: { low: '40', unit: '°C' } }, /at least two readings/],
    [{ mode: 'accumulated' as const, readings: [{ time: '2026-11-15 10:00', value: '40 °C' }, { time: '2026-11-15 09:00', value: '41 °C' }], inside: { low: '40', unit: '°C' } }, /time order/],
  ])('T13: refuses %o', (i, msg) => {
    expect(refused(t13Duration(i))).toMatch(msg);
  });
});

describe('F8 diversion window (calculation only, formulation 50)', () => {
  it('F8: excursion 10:00-10:04, delays 2 to 7.5 min, 10 kg/h → divert 10:02:00-10:11:30, 9.5 min, 1.583 kg', () => {
    // 10 kg/h × 9.5/60 h = 1.58333 kg
    const r = ok(f8DiversionWindow({ excursionStart: '2026-11-15 10:00', excursionEnd: '2026-11-15 10:04', shortestDelay: '2 min', longestDelay: '450 s', rate: '10 kg/h' }));
    expect(r.divertFrom).toBe('2026-11-15 10:02:00');
    expect(r.divertTo).toBe('2026-11-15 10:11:30');
    expect(r.windowMinutes.toFixed(1)).toBe('9.5');
    expect(r.value.toFixed(3)).toBe('1.583');
  });

  it('F8: by tablets: 16667 tablets/h × 9.5 min = 2638.9 tablets', () => {
    const r = ok(f8DiversionWindow({ excursionStart: '2026-11-15 10:00', excursionEnd: '2026-11-15 10:04', shortestDelay: '2 min', longestDelay: '7.5 min', rate: '16667 tablets/h' }));
    expect(r.value.toFixed(1)).toBe('2638.9');
    expect(r.unit).toBe('units');
  });

  it.each([
    ['2026-11-15 10:02', '2026-11-15 10:05', ['lot A', 'lot B']],
    ['2026-11-15 10:09', '2026-11-15 10:10', ['lot B']], // lot A can reach the press until 10:01 + 7.5 min = 10:08:30
    ['2026-11-15 08:00', '2026-11-15 08:01', []], // lot A first reaches the press at 08:02
  ])('F8: lots in the line for the window %s-%s', (windowFrom, windowTo, want) => {
    const r = ok(f8LotsInWindow({ lots: [{ lot: 'lot A', from: '2026-11-15 08:00', to: '2026-11-15 10:01' }, { lot: 'lot B', from: '2026-11-15 10:01', to: '2026-11-15 12:00' }], shortestDelay: '2 min', longestDelay: '7.5 min', windowFrom, windowTo }));
    expect(r.lots).toEqual(want);
  });

  it.each([
    [{ excursionStart: '2026-11-15 10:04', excursionEnd: '2026-11-15 10:00', shortestDelay: '2 min', longestDelay: '7 min' }, /ends before it starts/],
    [{ excursionStart: '2026-11-15 10:00', excursionEnd: '2026-11-15 10:04', shortestDelay: '8 min', longestDelay: '7 min' }, /not shorter than the shortest/],
    [{ excursionStart: '2026-11-15 10:00', excursionEnd: '2026-11-15 10:04', shortestDelay: '2 min', longestDelay: '7 min', rate: '10 kg' }, /per time/],
  ])('F8: refuses %o', (i, msg) => {
    expect(refused(f8DiversionWindow(i))).toMatch(msg);
  });
});

describe('T13 (I11) days, calendar months, "now", validated maximum', () => {
  it('T13: bulk hold in days: 2026-11-01 08:00 to 2026-11-16 20:00 = 15.50 d', () => {
    const r = ok(t13Duration({ mode: 'duration', start: '2026-11-01 08:00', end: '2026-11-16 20:00', unit: 'd' }));
    expect(r.value.toFixed(2)).toBe('15.50');
    expect(r.unit).toBe('d');
  });

  it('T13: end "now" is the step\'s own time: 2026-11-15 22:00 to now (2026-11-16 10:00) = 12 h', () => {
    const r = ok(t13Duration({ mode: 'duration', start: '2026-11-15 22:00', end: 'now', now: '2026-11-16 10:00', unit: 'h' }));
    expect(r.value.toString()).toBe('12');
    expect(r.shown).toContain('now (2026-11-16 10:00)');
  });

  it('T13: calendar months (media fill validity): 2026-05-10 to 2026-11-16 = 6 months + 6 d = 6.20 months', () => {
    // 6 whole months to 2026-11-10; 6 d of the 30 days to 2026-12-10 = 0.2 month
    const r = ok(t13Duration({ mode: 'duration', start: '2026-05-10 08:00', end: '2026-11-16 08:00', unit: 'months' }));
    expect(r.value.toFixed(2)).toBe('6.20');
    expect(r.unit).toBe('months');
    expect(r.shown).toContain('6 calendar months + 6.00 d');
    expect(r.shown).toContain('last day of a shorter month');
  });

  it('T13: month ends: 31 Jan + 1 month is 28 Feb (exactly 1.00); 1 Mar is 1 + 1/31 month', () => {
    expect(ok(t13Duration({ mode: 'duration', start: '2026-01-31 08:00', end: '2026-02-28 08:00', unit: 'months' })).value.toString()).toBe('1');
    // the month after 28 Feb runs to 31 Mar (31 days): 1 day = 1/31
    expect(ok(t13Duration({ mode: 'duration', start: '2026-01-31 08:00', end: '2026-03-01 08:00', unit: 'months' })).value.toFixed(4)).toBe('1.0323');
  });

  it('T13: validated maximum: APS valid 6 months; 6.20 months is refused although it would round to "6"; 5.97 months is fine', () => {
    expect(refused(t13Duration({ mode: 'duration', start: '2026-05-10 08:00', end: 'now', now: '2026-11-16 08:00', unit: 'months', validatedMax: '6 months' }))).toMatch(/6.20 months.*above the validated maximum 6 months/);
    // 2026-05-10 to 2026-11-09: 5 months + 30 of the 31 days to 2026-11-10 = 5.9677
    expect(ok(t13Duration({ mode: 'duration', start: '2026-05-10 08:00', end: '2026-11-09 08:00', unit: 'months', validatedMax: '6 months' })).value.toFixed(4)).toBe('5.9677');
  });

  it('T13: bulk hold of 50 h against a validated maximum of 48 h is refused (no rounding); 24 h is fine', () => {
    expect(refused(t13Duration({ mode: 'duration', start: '2026-11-14 08:00', end: '2026-11-16 10:00', unit: 'h', validatedMax: '48 h' }))).toMatch(/above the validated maximum 48 h/);
    expect(refused(t13Duration({ mode: 'duration', start: '2026-11-14 08:00', end: '2026-11-16 08:01', unit: 'h', validatedMax: '2 d' }))).toMatch(/above the validated maximum 2 d/);
  });

  it('T13: a hold limit inside the validated maximum is used as it is', () => {
    const r = ok(t13Duration({ mode: 'duration', start: '2026-11-15 08:00', end: '2026-11-16 06:00', unit: 'h', limit: { high: '24', unit: 'h' }, validatedMax: '48 h' }));
    expect(r.check?.pass).toBe(true);
  });

  it.each([
    [{ mode: 'duration' as const, start: '2026-11-15 08:00', end: '2026-11-16 06:00', unit: 'h', limit: { high: '72', unit: 'h' }, validatedMax: '48 h' }, /above the validated maximum 48 h/],
    [{ mode: 'duration' as const, start: '2026-11-15 08:00', end: '2026-11-16 06:00', unit: 'd', limit: { high: '5', unit: 'd' }, validatedMax: '72 h' }, /above the validated maximum/],
    [{ mode: 'duration' as const, start: '2026-01-01 08:00', end: '2026-11-16 06:00', unit: 'months', limit: { high: '5', unit: 'd' }, validatedMax: '6 months' }, /both be in calendar months/],
    [{ mode: 'duration' as const, start: '2026-11-15 08:00', end: 'now' }, /step's own time/],
    [{ mode: 'duration' as const, start: '2026-11-15 08:00', end: '2026-11-16 06:00', unit: 'h', validatedMax: '6 months' }, /same kind of unit/],
    [{ mode: 'accumulated' as const, readings: [{ time: '2026-11-15 08:00', value: '40 °C' }, { time: '2026-11-15 09:00', value: '40 °C' }], inside: { low: '35', unit: '°C' }, unit: 'months' }, /only between a start and an end/],
  ])('T13: refuses %o', (i, msg) => {
    expect(refused(t13Duration(i))).toMatch(msg);
  });
});
