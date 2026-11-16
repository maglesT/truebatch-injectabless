import { describe, expect, it } from 'vitest';
import { Dec } from '../../shared/templates/dec.js';
import { convert, findUnit, unit } from '../../shared/templates/units.js';
import { Refused } from '../../shared/templates/refuse.js';

const c = (v: string, from: string, to: string): string => convert(new Dec(v), unit(from), unit(to)).toSignificantDigits(15).toString();

describe('units: same-kind conversion', () => {
  // Every expected value is the definition of the unit (hand check in the comment).
  it.each([
    ['1', 'kg', 'g', '1000'],
    ['250', 'mg', 'g', '0.25'],
    ['12.5', 'g', 'kg', '0.0125'],
    ['25', 'µg', 'mg', '0.025'],
    ['1.5', 'L', 'mL', '1500'],
    ['500', 'µL', 'mL', '0.5'],
    ['0.85', 'mm', 'µm', '850'],
    ['1.2', 'cm', 'mm', '12'],
    ['90', 'min', 'h', '1.5'],
    ['2', 'h', 's', '7200'],
    ['1', 'kp', 'N', '9.80665'], // 1 kp = 9.80665 N exactly
    ['21.2', 'kp', 'N', '207.90098'], // 21.2 × 9.80665
    ['15', 'kN', 'N', '15000'],
    ['1', 'bar', 'kPa', '100'],
    ['50', 'mbar', 'Pa', '5000'],
    ['760', 'mmHg', 'Pa', '101325.0144354'], // 760 × 133.322387415 = 101325.01443540
    ['1', 'psi', 'Pa', '6894.75729316836'], // 0.45359237 × 9.80665 ÷ 0.0254²
    ['2.0', 'kgf/cm²', 'bar', '1.96133'], // 2 × 98066.5 Pa
    ['50', 'kN/cm²', 'MPa', '500'], // 1 kN/cm² = 10 MPa
    ['1', '%', 'ppm', '10000'],
    ['5000', 'ppm', '%', '0.5'],
    ['10', '%w/v', 'mg/mL', '100'], // 10 g/100 mL
    ['1', 'kg/L', 'g/mL', '1'],
    ['30', 'kg/h', 'g/min', '500'],
    ['1', 'L/min', 'm³/h', '0.06'],
    ['2', 'kW', 'W', '2000'],
    ['1', 'kWh/kg', 'kJ/kg', '3600'],
    ['100000', 'IU/g', 'IU/mg', '100'],
    ['45', 'U/mg', 'U/g', '45000'],
  ])('Units: %s %s = %s %s', (v, from, to, want) => {
    expect(c(v, from, to)).toBe(want);
  });

  it.each([
    ['25', '°C', 'K', '298.15'],
    ['0', '°C', '°F', '32'],
    ['100', '°C', '°F', '212'],
    ['104', '°F', '°C', '40'], // (104 − 32) × 5/9 = 40
    ['-40', '°F', '°C', '-40'],
    ['10', 'Δ°C', 'Δ°F', '18'], // a difference has no offset
  ])('Units: temperature with offsets: %s %s = %s %s', (v, from, to, want) => {
    expect(c(v, from, to)).toBe(want);
  });

  it('Units: a temperature difference compared with a limit written in °C uses the difference unit', () => {
    expect(c('1.5', 'Δ°C', '°C')).toBe('1.5');
    expect(c('9', 'Δ°F', '°C')).toBe('5');
  });

  it.each([
    ['400', 'IU', 'mg', /potency in IU, CFU or activity units is never a mass/],
    ['3', 'CFU', 'g', /never a mass/],
    ['36000', 'U', 'mg', /never a mass/],
    ['400', 'IU', 'U', /never a mass/],
    ['45', '%RH', 'g/kg', /T25/],
    ['8', 'g/kg', '%RH', /T25/],
    ['5', '%w/w', '%w/v', /cannot be converted/],
    ['1', 'kg', 'L', /cannot be converted/],
    ['25', '°C', 'Δ°C', /temperature reading/],
  ])('Units: refused: %s %s to %s', (v, from, to, msg) => {
    expect(() => convert(new Dec(v), unit(from), unit(to))).toThrow(Refused);
    expect(() => convert(new Dec(v), unit(from), unit(to))).toThrow(msg);
  });

  it.each([['mcg', 'µg'], ['ml', 'mL'], ['kP', 'kp'], ['% w/w', '%w/w'], ['cfu/g', 'CFU/g'], ['kg/cm²', 'kgf/cm²']])('Units: alias %s is %s', (a, s) => {
    expect(findUnit(a)?.symbol).toBe(s);
  });

  it('Units: an unknown unit is not found', () => {
    expect(findUnit('furlong')).toBeUndefined();
  });
});

// TrueBatch Injectables units (library v1, section 3): each value is the unit's definition.
describe('units added for injectables', () => {
  it.each([
    ['760', 'Torr', 'mbar', '1013.25'], // 760 Torr = 1 atm = 1013.25 mbar
    ['100', 'mTorr', 'µbar', '133.322368421053'], // 0.1 Torr = 13.33 Pa = 133.3 µbar
    ['1', 'kgf/cm² g', 'bar g', '0.980665'],
    ['10', 'psi g', 'kPa g', '68.9475729316836'],
    ['1', 'SCFH', 'L/min', '0.4719474432'],
    ['60', 'cm/min', 'm/h', '36'],
    ['3', '°C/min', '°C/h', '180'],
    ['1', 'particles/ft³', 'particles/m³', '35.3146667214886'],
    ['1', 'CFU/mL', 'CFU/100 mL', '100'],
    ['2.5', 'Mrad', 'kGy', '25'],
    ['500', 'nm', 'µm', '0.5'],
    ['1', 'mg/L', 'µg/mL', '1'],
    ['2', 'm²', 'cm²', '20000'],
  ])('Units: %s %s = %s in %s', (v, from, to, want) => {
    expect(c(v, from, to)).toBe(want);
  });

  it.each([
    ['1', 'bar g', 'bar'], // gauge ↔ absolute needs the barometric reading
    ['300', 'mOsm/kg', 'mOsm/L'], // osmolality and osmolarity never convert
    ['5', '%v/v', '%w/w'], // a gas fraction is not a mass fraction
    ['10', 'IU/mL', 'mg/mL'], // a potency per volume is never a mass
    ['8', 'F-min', 'min'], // lethality is not clock time
    ['5', 'CFU/plate', 'CFU/m³'], // a plate is not a volume of air
  ])('Units: refused: %s %s to %s', (v, from, to) => {
    expect(() => convert(new Dec(v), unit(from), unit(to))).toThrow(Refused);
  });

  it.each([['psig', 'psi g'], ['barg', 'bar g'], ['mM', 'mmol/L'], ['cP', 'mPa·s'], ['vial', 'vials'], ['CFU/100mL', 'CFU/100 mL'], ['% v/v', '%v/v']])('Units: alias %s is %s', (a, s) => {
    expect(findUnit(a)?.symbol).toBe(s);
  });
});
