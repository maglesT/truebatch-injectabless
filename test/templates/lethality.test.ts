import { describe, expect, it } from 'vitest';
import { i20Lethality, type I20Input } from '../../shared/templates/lethality.js';
import { ok, refused } from './helpers.js';

/** One reading a minute from 10:00, at the given temperatures (°C). */
function probe(name: string, temps: readonly string[], everySeconds = 60): I20Input['probes'][number] {
  const start = Date.UTC(2026, 10, 16, 10, 0, 0);
  return { name, readings: temps.map((t, n) => ({ time: new Date(start + n * everySeconds * 1000).toISOString().slice(0, 19), value: `${t} °C` })) };
}
const flat = (t: string, n: number): string[] => Array.from({ length: n }, () => t);

describe('I20 Lethality (F-value)', () => {
  it.each([
    ['121.1', 16, '15.0000'], // 15 one-minute intervals at Tref: F0 15
    ['111.1', 11, '1.0000'], // 10 °C below Tref: a tenth per minute, 10 min → 1.0
    ['131.1', 4, '30.0000'], // 10 °C above: 10 per minute, 3 min → 30
    ['99.9', 30, '0.0000'], // below the 100 °C cut-in: counts zero
  ])('I20: a probe at %s °C, %i one-minute readings → F0 %s', (t, n, want) => {
    expect(ok(i20Lethality({ probes: [probe('P1', flat(t, n))], maxInterval: '1 min' })).value.toFixed(4)).toBe(want);
  });

  it('I20: trapezoid rule: a ramp 121.1 → 131.1 °C over one minute counts (1 + 10) ÷ 2 = 5.5', () => {
    expect(ok(i20Lethality({ probes: [probe('P1', ['121.1', '131.1'])], maxInterval: '1 min' })).value.toFixed(4)).toBe('5.5000');
  });

  it('I20: an interval from below the cut-in counts half of the reading above it', () => {
    // 95 °C counts 0, 121.1 °C counts 1: (0 + 1) ÷ 2 × 1 min = 0.5
    expect(ok(i20Lethality({ probes: [probe('P1', ['95.0', '121.1'])], maxInterval: '1 min' })).value.toFixed(4)).toBe('0.5000');
  });

  it('I20: the lowest of three probes is the result, each probe in the extras, limit NLT 15.0 F-min', () => {
    const r = ok(
      i20Lethality({
        probes: [probe('Probe 1', flat('121.5', 16)), probe('Probe 2 (cold spot)', flat('120.8', 16)), probe('Probe 3', flat('122.0', 16))],
        maxInterval: '1 min',
        limit: { low: '15.0', unit: 'F-min' },
      }),
    );
    expect(r.lowest).toBe('Probe 2 (cold spot)');
    expect(r.probes.map((p) => p.value.toFixed(2))).toEqual(['16.45', '14.00', '18.45']); // 15 × 10^(0.04), 10^(-0.03), 10^(0.09)
    expect(r.value.toFixed(2)).toBe('14.00');
    expect(r.unit).toBe('F-min');
    expect(r.check?.pass).toBe(false);
    expect(r.shown).toContain('lowest: Probe 2 (cold spot) = 14.0 F-min');
    expect(r.shown).toContain('trapezoid rule');
  });

  it('I20: all probes at 121.1 °C for 15 min pass NLT 15.0 F-min', () => {
    const r = ok(i20Lethality({ probes: [probe('A', flat('121.1', 16)), probe('B', flat('121.3', 16))], maxInterval: '1 min', limit: { low: '15.0', unit: 'F-min' } }));
    expect(r.lowest).toBe('A');
    expect(r.check?.pass).toBe(true);
  });

  it('I20: dry heat FH, Tref 170 °C, z 20 °C, cut-in 150 °C: 190 °C for 30 min → 300 F-min', () => {
    const r = ok(i20Lethality({ probes: [probe('Oven 1', flat('190', 31))], tref: '170 °C', z: '20 °C', cutIn: '150 °C', maxInterval: '1 min' }));
    expect(r.value.toFixed(4)).toBe('300.0000');
  });

  it('I20: readings every 30 s, maximum interval 30 s: 31 readings at 121.1 °C → 15.0', () => {
    expect(ok(i20Lethality({ probes: [probe('P1', flat('121.1', 31), 30)], maxInterval: '30 s' })).value.toFixed(4)).toBe('15.0000');
  });

  it('I20: readings in °F (250 °F = 121.11 °C) and z in Δ°C', () => {
    const r = ok(i20Lethality({ probes: [{ name: 'P1', readings: [{ time: '2026-11-16 10:00', value: '250 °F' }, { time: '2026-11-16 10:01', value: '250 °F' }] }], z: '10 Δ°C', maxInterval: '1 min' }));
    expect(r.value.toFixed(4)).toBe('1.0026'); // 10^(0.0111…/10)
  });

  const one = [probe('P1', flat('121.1', 3))];
  it.each([
    [{ probes: [], maxInterval: '1 min' }, /at least one probe/],
    [{ probes: [probe('P1', ['121.1'])], maxInterval: '1 min' }, /at least two readings/],
    [{ probes: [{ name: 'P1', readings: [{ time: '2026-11-16 10:01', value: '121 °C' }, { time: '2026-11-16 10:00', value: '121 °C' }] }], maxInterval: '1 min' }, /P1: reading 2 is earlier than reading 1; readings must be in time order/],
    [{ probes: [{ name: 'P1', readings: [{ time: '2026-11-16 10:00', value: '121 °C' }, { time: '2026-11-16 10:03', value: '121 °C' }] }], maxInterval: '2 min' }, /P1: readings 1 and 2 are 3.00 min apart, more than the set maximum interval of 2 min/],
    [{ probes: one, maxInterval: '1 min', limit: { low: '15', unit: 'min' } }, /must be written in F-min .*not in clock time "min"/],
    [{ probes: one, maxInterval: '1 min', limit: { low: '15', unit: 'kg' } }, /"kg" is not a lethality/],
    [{ probes: [{ name: 'P1', readings: [{ time: '2026-11-16 10:00', value: '2 bar' }, { time: '2026-11-16 10:01', value: '2 bar' }] }], maxInterval: '1 min' }, /must be a temperature/],
    [{ probes: one, maxInterval: '0 min' }, /maximum interval .* more than zero/],
    [{ probes: one, maxInterval: '1 kg' }, /must be a time/],
    [{ probes: one, z: '0 °C', maxInterval: '1 min' }, /z-value must be more than zero/],
    [{ probes: [{ name: '', readings: [] }], maxInterval: '1 min' }, /needs a name/],
    [{ probes: [{ name: 'P1', readings: [{ time: '16/11/2026 10:00', value: '121 °C' }, { time: '2026-11-16 10:01', value: '121 °C' }] }], maxInterval: '1 min' }, /not a date and time/],
  ] as [I20Input, RegExp][])('I20: refuses %o', (i, msg) => {
    expect(refused(i20Lethality(i))).toMatch(msg);
  });
});
