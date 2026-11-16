import { describe, expect, it } from 'vitest';
import { i22Count, type I22Input } from '../../shared/templates/counts.js';
import { ok, refused } from './helpers.js';

// Limits are the clean-air table (EU GMP Annex 1 (2022), Tables 5 and 6) in shared/master/clean-air.ts.

describe('I22 Count against its sample basis and limit', () => {
  it('I22: active air sample, grade B: 3 CFU in 500 L = 6 CFU/m³, action limit 10: pass', () => {
    // 500 L = 0.5 m³; 3 ÷ 0.5 = 6 CFU/m³ ≤ 10 (Table 6, grade B)
    const r = ok(i22Count({ sample: 'air', counts: '3 CFU', sampled: '500 L', grade: 'B' }));
    expect(r.value.toString()).toBe('6');
    expect(r.unit).toBe('CFU/m³');
    expect(r.check.level).toBe('pass');
    expect(r.shown).toContain('per m³ of air');
    expect(r.shown).toContain('clean-air table');
  });

  it('I22: grade B air with the master alert limit 5 CFU/m³: 6 CFU/m³ is an alert', () => {
    const r = ok(i22Count({ sample: 'air', counts: '3 CFU', sampled: '500 L', grade: 'B', alertLimit: '5 CFU/m³' }));
    expect(r.check.level).toBe('alert');
    expect(r.check.pass).toBe(true);
  });

  it('I22: grade A "no growth": 1 CFU in 3000 L is 0.33 CFU/m³ (rounds to 0) but is still an action', () => {
    const r = ok(i22Count({ sample: 'air', counts: '1 CFU', sampled: '3000 L', grade: 'A' }));
    expect(r.check.level).toBe('fail');
    expect(r.check.shown).toMatch(/no growth allowed.*ACTION/);
  });

  it('I22: grade A, no colony: pass', () => {
    expect(ok(i22Count({ sample: 'settle plate', counts: '0 CFU', exposure: '240 min', grade: 'A' })).check.level).toBe('pass');
  });

  it('I22: settle plates of one filling session, grade B: 2 + 1 + 3 = 6 CFU against 5 per plate: action', () => {
    const r = ok(i22Count({ sample: 'settle plate', counts: ['2 CFU', '1 CFU', '3 CFU'], exposure: '4 h', grade: 'B' }));
    expect(r.value.toString()).toBe('6');
    expect(r.unit).toBe('CFU/plate');
    expect(r.check.level).toBe('fail');
    expect(r.shown).toContain('3 plates of one session');
    expect(r.check.shown).toContain('ACTION');
  });

  it('I22: contact plate grade C: 20 CFU against 25: pass; glove print grade B 5 CFU/glove: pass at the limit', () => {
    expect(ok(i22Count({ sample: 'contact plate', counts: '20 CFU', grade: 'C' })).check.level).toBe('pass');
    expect(ok(i22Count({ sample: 'glove print', counts: '5 CFU/glove', grade: 'B' })).check.level).toBe('pass');
  });

  it('I22: glove print in grade C: the table sets none, the master gives 10 CFU/glove', () => {
    const r = ok(i22Count({ sample: 'glove print', counts: '3 CFU', grade: 'C', actionLimit: '10 CFU/glove' }));
    expect(r.check.level).toBe('pass');
    expect(r.shown).toContain('action limit from the master');
  });

  it('I22: particles ≥0.5 µm, grade A in operation: 100 per ft³ = 3531.47 per m³, above 3520: action', () => {
    // 1 ft³ = 0.028316846592 m³; 100 ÷ 0.028316846592 = 3531.4667 particles/m³ → 3531 > 3520
    const r = ok(i22Count({ sample: 'particles ≥0.5 µm', counts: '100 particles/ft³', grade: 'A', state: 'in operation' }));
    expect(r.value.toFixed(2)).toBe('3531.47');
    expect(r.unit).toBe('particles/m³');
    expect(r.check.level).toBe('fail');
  });

  it('I22: particles ≥5 µm, grade B at rest: 12 particles in 1 m³ against 29: pass', () => {
    expect(ok(i22Count({ sample: 'particles ≥5 µm', counts: '12 particles', sampled: '1 m³', grade: 'B', state: 'at rest' })).check.level).toBe('pass');
  });

  it('I22: grade D in operation: the master sets the particle limit', () => {
    const r = ok(i22Count({ sample: 'particles ≥0.5 µm', counts: '2500000 particles/m³', grade: 'D', state: 'in operation', actionLimit: '3520000 particles/m³' }));
    expect(r.check.level).toBe('pass');
  });

  it('I22: bioburden before sterile filtration: 12 CFU in 100 mL against 10 CFU/100 mL: action; the basis is shown', () => {
    const r = ok(i22Count({ sample: 'bioburden', counts: '12 CFU', sampled: '100 mL', actionLimit: '10 CFU/100 mL' }));
    expect(r.value.toString()).toBe('12');
    expect(r.unit).toBe('CFU/100 mL');
    expect(r.check.level).toBe('fail');
    expect(r.shown).toContain('per 100 mL of product');
  });

  it('I22: bioburden 4 CFU/mL from the lab = 400 CFU/100 mL; 3 CFU in 250 mL = 1.2 CFU/100 mL', () => {
    expect(ok(i22Count({ sample: 'bioburden', counts: '4 CFU/mL', actionLimit: '10 CFU/100 mL' })).value.toString()).toBe('400');
    expect(ok(i22Count({ sample: 'bioburden', counts: '3 CFU', sampled: '250 mL', actionLimit: '10 CFU/100 mL' })).value.toString()).toBe('1.2');
  });

  it.each<[I22Input, RegExp]>([
    [{ sample: 'settle plate', counts: '1 CFU', exposure: '4.5 h', grade: 'B' }, /at most 4 hours/],
    [{ sample: 'air', counts: '3 CFU', sampled: '500 L', grade: 'B', actionLimit: '20 CFU/m³' }, /looser than the clean-air table/],
    [{ sample: 'air', counts: '3 CFU', sampled: '500 L', grade: 'A', actionLimit: '1 CFU/m³' }, /looser.*no growth/],
    [{ sample: 'air', counts: '3 CFU', sampled: '500 L', grade: 'B', alertLimit: '12 CFU/m³' }, /alert limit .* is above the action limit/],
    [{ sample: 'glove print', counts: '3 CFU', grade: 'D' }, /sets no limit for glove prints in grade D/],
    [{ sample: 'particles ≥0.5 µm', counts: '2500000 particles/m³', grade: 'D', state: 'in operation' }, /sets no limit for grade D in operation/],
    [{ sample: 'particles ≥0.5 µm', counts: '100 particles/ft³', grade: 'A' }, /at rest or in operation/],
    [{ sample: 'air', counts: '3 CFU', sampled: '500 L' }, /room grade/],
    [{ sample: 'air', counts: '3 CFU', grade: 'B' }, /volume of air sampled/],
    [{ sample: 'air', counts: ['3 CFU', '2 CFU'], sampled: '500 L', grade: 'B' }, /only for the plates/],
    [{ sample: 'bioburden', counts: '12 CFU', sampled: '100 mL' }, /product's limit/],
    [{ sample: 'bioburden', counts: '12 CFU', sampled: '100 mL', actionLimit: '10 CFU/m³' }, /per 100 mL of product/],
    [{ sample: 'settle plate', counts: '2.5 CFU', grade: 'B' }, /whole number/],
    [{ sample: 'settle plate', counts: '-1 CFU', grade: 'B' }, /cannot be negative/],
    [{ sample: 'settle plate', counts: '3 CFU/glove', grade: 'B' }, /not a count for this sample/],
  ])('I22: refuses %o', (i, msg) => {
    expect(refused(i22Count(i))).toMatch(msg);
  });
});
