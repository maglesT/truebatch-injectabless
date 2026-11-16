import { describe, expect, it } from 'vitest';
import { i21Cycle, type I21Input, type I21Phase, type I21RecordedPhase } from '../../shared/templates/cycle.js';
import { ok, refused } from './helpers.js';

/** A freeze-drying recipe: freezing, primary drying, secondary drying. */
const lyo: I21Phase[] = [
  { name: 'Freezing', duration: { low: '120', unit: 'min' }, parameters: [{ name: 'Shelf temperature', unit: '°C', setPoint: '-45', plusMinus: '3' }] },
  {
    name: 'Primary drying',
    duration: { low: '20', high: '30', unit: 'h' },
    parameters: [
      { name: 'Shelf temperature', unit: '°C', setPoint: '-25', plusMinus: '2' },
      { name: 'Chamber pressure', unit: 'µbar', low: '80', high: '120' },
    ],
  },
  {
    name: 'Secondary drying',
    duration: { low: '6', unit: 'h' },
    parameters: [
      { name: 'Shelf temperature', unit: '°C', setPoint: '30', plusMinus: '2' },
      { name: 'Chamber pressure', unit: 'µbar', high: '50' },
    ],
  },
];

const goodLyo: I21RecordedPhase[] = [
  { phase: 'Freezing', start: '2026-11-16 08:00', end: '2026-11-16 10:30', parameters: [{ name: 'Shelf temperature', min: '-46.5 °C', max: '-43.2 °C' }] },
  {
    phase: 'Primary drying',
    start: '2026-11-16 10:30',
    end: '2026-11-17 08:30',
    parameters: [
      { name: 'Shelf temperature', min: '-26.1 °C', max: '-24.0 °C' },
      { name: 'Chamber pressure', min: '0.095 mbar', max: '0.110 mbar' }, // 95 to 110 µbar, converted
    ],
  },
  {
    phase: 'Secondary drying',
    start: '2026-11-17 08:30',
    end: '2026-11-17 15:00',
    parameters: [
      { name: 'Shelf temperature', min: '29.0 °C', max: '31.4 °C' },
      { name: 'Chamber pressure', min: '20 µbar', max: '35 µbar' },
    ],
  },
];

const withParam = (phase: string, name: string, min: string, max: string): I21RecordedPhase[] =>
  goodLyo.map((r) => (r.phase !== phase ? r : { ...r, parameters: (r.parameters ?? []).map((p) => (p.name === name ? { name, min, max } : p)) }));

describe('I21 Cycle against its recipe', () => {
  it('I21: freeze-drying cycle within its recipe: total 31 h = 1860 min, passes', () => {
    const r = ok(i21Cycle({ recipe: lyo, recorded: goodLyo }));
    expect(r.value.toFixed(0)).toBe('1860');
    expect(r.unit).toBe('min');
    expect(r.check?.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.phases.map((p) => p.minutes.toFixed(0))).toEqual(['150', '1320', '390']);
    expect(r.shown).toContain('all 3 phases within the recipe');
  });

  it('I21: phases typed in any order are put in time order', () => {
    expect(ok(i21Cycle({ recipe: lyo, recorded: [...goodLyo].reverse() })).check?.pass).toBe(true);
  });

  it.each([
    ['Primary drying', 'Shelf temperature', '-26.0 °C', '-22.4 °C', 'Primary drying: Shelf temperature maximum -22.4 °C is out of limits (-25 ± 2 °C)'],
    ['Primary drying', 'Shelf temperature', '-27.6 °C', '-24.0 °C', 'Primary drying: Shelf temperature minimum -27.6 °C is out of limits (-25 ± 2 °C)'],
    ['Primary drying', 'Chamber pressure', '0.095 mbar', '0.125 mbar', 'Primary drying: Chamber pressure maximum 0.125 mbar is out of limits (80 to 120 µbar)'],
    ['Secondary drying', 'Chamber pressure', '20 µbar', '51 µbar', 'Secondary drying: Chamber pressure maximum 51 µbar is out of limits (not more than 50 µbar)'],
  ])('I21: %s %s %s to %s fails', (phase, name, min, max, msg) => {
    const r = ok(i21Cycle({ recipe: lyo, recorded: withParam(phase, name, min, max) }));
    expect(r.check?.pass).toBe(false);
    expect(r.failures).toEqual([msg]);
    expect(r.shown).toContain(`NOT within the recipe: ${msg}`);
  });

  it('I21: a band edge rounds as written: -22.6 °C rounds to -23 and passes -25 ± 2 °C', () => {
    expect(ok(i21Cycle({ recipe: lyo, recorded: withParam('Primary drying', 'Shelf temperature', '-26.0 °C', '-22.6 °C') })).check?.pass).toBe(true);
  });

  it('I21: a short freezing phase and a missing secondary drying both fail and are both listed', () => {
    const rec = goodLyo.slice(0, 2).map((r) => (r.phase === 'Freezing' ? { ...r, end: '2026-11-16 09:45' } : r));
    const r = ok(i21Cycle({ recipe: lyo, recorded: rec }));
    expect(r.check?.pass).toBe(false);
    expect(r.failures).toEqual(['Secondary drying: not recorded', 'Freezing: duration 105.0 min is out of limits (not less than 120 min)']);
  });

  it('I21: phases run out of the recipe order fail', () => {
    const vhp: I21Phase[] = [{ name: 'Conditioning' }, { name: 'Decontamination', duration: { low: '30', unit: 'min' }, parameters: [{ name: 'H2O2 concentration', unit: 'ppm', low: '250' }] }, { name: 'Aeration' }];
    const rec: I21RecordedPhase[] = [
      { phase: 'Conditioning', start: '2026-11-16 09:00', end: '2026-11-16 09:20' },
      { phase: 'Aeration', start: '2026-11-16 09:20', end: '2026-11-16 09:30' },
      { phase: 'Decontamination', start: '2026-11-16 09:30', end: '2026-11-16 10:10', parameters: [{ name: 'H2O2 concentration', min: '310 ppm', max: '420 ppm' }] },
    ];
    const r = ok(i21Cycle({ recipe: vhp, recorded: rec }));
    expect(r.value.toFixed(0)).toBe('70');
    expect(r.failures).toEqual(["Decontamination: run before Aeration, against the recipe's order"]);
  });

  it('I21: autoclave exposure 121.0 to 124.0 °C for 15 to 20 min passes; a phase the recipe leaves out is not recorded', () => {
    const recipe: I21Phase[] = [{ name: 'Exposure', duration: { low: '15', high: '20', unit: 'min' }, parameters: [{ name: 'Chamber temperature', unit: '°C', low: '121.0', high: '124.0' }] }];
    const r = ok(i21Cycle({ recipe, recorded: [{ phase: 'Exposure', start: '2026-11-16 10:00:00', end: '2026-11-16 10:16:30', parameters: [{ name: 'Chamber temperature', min: '121.3 °C', max: '122.1 °C' }] }], decimals: 1 }));
    expect(r.check?.pass).toBe(true);
    expect(r.shown).toContain('total 16.5 min');
  });

  const rec1 = (over: Partial<I21RecordedPhase>): I21RecordedPhase[] => [{ ...(goodLyo[0] as I21RecordedPhase), ...over }];
  it.each([
    [{ recipe: [], recorded: goodLyo }, /recipe has no phases/],
    [{ recipe: lyo, recorded: [] }, /No phase is recorded/],
    [{ recipe: lyo, recorded: [...goodLyo, { phase: 'Annealing', start: '2026-11-17 15:00', end: '2026-11-17 16:00' }] }, /The recorded phase "Annealing" is not in the recipe/],
    [{ recipe: lyo, recorded: [...goodLyo, goodLyo[0] as I21RecordedPhase] }, /"Freezing" is recorded twice/],
    [{ recipe: lyo, recorded: rec1({ end: '2026-11-16 07:00' }) }, /Phase "Freezing": the end \(2026-11-16 07:00\) is before the start/],
    [{ recipe: lyo, recorded: rec1({ parameters: [{ name: 'Shelf temperature', min: '-46 mbar', max: '-43 °C' }] }) }, /Phase "Freezing", Shelf temperature: the recorded unit "mbar" does not convert to the band's unit "°C"/],
    [{ recipe: lyo, recorded: rec1({ parameters: [] }) }, /the minimum and maximum of Shelf temperature are not recorded/],
    [{ recipe: lyo, recorded: rec1({ parameters: [{ name: 'Shelf temperature', min: '-40 °C', max: '-46 °C' }] }) }, /recorded minimum -40 °C is above the maximum -46 °C/],
    [{ recipe: lyo, recorded: rec1({ parameters: [{ name: 'Shelf temperature', min: '-46 °C', max: '-43 °C' }, { name: 'Condenser', min: '-70 °C', max: '-65 °C' }] }) }, /the parameter "Condenser" is not in the recipe for this phase/],
    [{ recipe: [{ name: 'Freezing', parameters: [{ name: 'Shelf temperature', unit: '°C', setPoint: '-45' }] }], recorded: rec1({}) }, /a set point needs its ± band/],
    [{ recipe: [{ name: 'Freezing', parameters: [{ name: 'Shelf temperature', unit: '°C' }] }], recorded: rec1({}) }, /needs a set point with a ± band, or low and\/or high limits/],
    [{ recipe: lyo, recorded: rec1({ start: '2026-11-16 25:00' }) }, /not a real date and time/],
  ] as [I21Input, RegExp][])('I21: refuses %o', (i, msg) => {
    expect(refused(i21Cycle(i))).toMatch(msg);
  });
});
