import { describe, expect, it } from 'vitest';
import { i19FilterIntegrity, type I19Input } from '../../shared/templates/filter.js';
import { ok, refused } from './helpers.js';

const filter = { type: 'PES sterilising grade', poreSize: '0.22 µm' };

describe('I19 Filter integrity test', () => {
  it.each<[string, I19Input, boolean, string]>([
    ['bubble point 3.2 bar g, product-wetted, against 3.45 bar g × 0.92 = 3.174 bar g → pass', { mode: 'bubble point', result: '3.2 bar g', makerLimit: '3.45 bar g', wettedWith: 'product', productFactor: '0.92' }, true, '3.174'],
    ['bubble point 3.5 bar g, water-wetted, against 3.45 bar g → pass', { mode: 'bubble point', result: '3.5 bar g', makerLimit: '3.45 bar g' }, true, '3.45'],
    ['bubble point 3.3 bar g, water-wetted, against 3.45 bar g → fail', { mode: 'bubble point', result: '3.3 bar g', makerLimit: '3.45 bar g' }, false, '3.45'],
    ['bubble point 50 psi g against 3.45 bar g: 3.447… bar g rounds to 3.45 (the limit\'s decimals) → pass', { mode: 'bubble point', result: '50 psi g', makerLimit: '3.45 bar g' }, true, '3.45'],
    ['bubble point 49 psi g against 3.45 bar g: 3.378… bar g → fail', { mode: 'bubble point', result: '49 psi g', makerLimit: '3.45 bar g' }, false, '3.45'],
    ['bubble point, alcohol-wetted 1.2 bar g against 1.1 bar g → pass', { mode: 'bubble point', result: '1.2 bar g', makerLimit: '1.1 bar g', wettedWith: 'alcohol' }, true, '1.1'],
    ['diffusion 12.5 mL/min against 18 mL/min → pass', { mode: 'diffusion', result: '12.5 mL/min', makerLimit: '18 mL/min' }, true, '18'],
    ['diffusion 20.0 mL/min against 18 mL/min → fail', { mode: 'diffusion', result: '20.0 mL/min', makerLimit: '18 mL/min' }, false, '18'],
    ['diffusion, solvent-wetted 25 mL/min against 18 mL/min × 1.5 = 27 mL/min → pass', { mode: 'diffusion', result: '25 mL/min', makerLimit: '18 mL/min', wettedWith: 'solvent', productFactor: '1.5' }, true, '27'],
    ['pressure decay 12 mbar against 20 mbar → pass', { mode: 'pressure decay', result: '12 mbar', makerLimit: '20 mbar' }, true, '20'],
    ['water intrusion of a vent filter 0.25 mL/min against 0.33 mL/min → pass', { mode: 'water intrusion', result: '0.25 mL/min', makerLimit: '0.33 mL/min' }, true, '0.33'],
    ['water intrusion 0.40 mL/min against 0.33 mL/min → fail', { mode: 'water intrusion', result: '0.40 mL/min', makerLimit: '0.33 mL/min' }, false, '0.33'],
  ])('I19: %s', (_case, i, pass, limit) => {
    const r = ok(i19FilterIntegrity(i));
    expect(r.check.pass).toBe(pass);
    expect(r.check.level).toBe(pass ? 'pass' : 'fail');
    expect(r.testLimit.toFixed()).toBe(limit);
    expect(r.shown).toContain(pass ? 'PASS' : 'FAIL');
  });

  it('I19: shows the worked line with the product factor', () => {
    const r = ok(i19FilterIntegrity({ mode: 'bubble point', result: '3.2 bar g', makerLimit: '3.45 bar g', wettedWith: 'product', productFactor: '0.92' }));
    expect(r.shown).toBe(
      'bubble point 3.2 bar g, not less than the limit 3.45 bar g × product factor 0.92 = 3.174 bar g: PASS (3.20000 bar g rounded to 3 decimals (as the limit is written) = 3.200 bar g; limit not less than 3.174 bar g: within limits)',
    );
  });

  it('I19: pressure decay converted to diffusion: 0.050 bar over 5 min, 2000 mL upstream, 1013.25 mbar → 19.74 mL/min, against 25 mL/min → pass', () => {
    const r = ok(i19FilterIntegrity({ mode: 'pressure decay', result: '0.050 bar', makerLimit: '25 mL/min', upstreamVolume: '2000 mL', atmosphericPressure: '1013.25 mbar', testTime: '5 min' }));
    expect(r.value.toFixed(2)).toBe('19.74');
    expect(r.unit).toBe('mL/min');
    expect(r.check.pass).toBe(true);
    expect(r.shown).toMatch(/^diffusion = 0.050 bar × 2000 mL ÷ \(1013.25 mbar × 5 min\) = 19.74 mL\/min; /);
  });

  it('I19: the same filter as the master (pore size in another unit) is accepted', () => {
    expect(ok(i19FilterIntegrity({ mode: 'bubble point', result: '3.5 bar g', makerLimit: '3.45 bar g', filter, master: { type: 'pes sterilising grade', poreSize: '220 nm' } })).check.pass).toBe(true);
  });

  it('I19: test temperature inside the range passes; outside it the test fails as not valid', () => {
    const base: I19Input = { mode: 'diffusion', result: '12.5 mL/min', makerLimit: '18 mL/min', temperatureRange: { low: '15', high: '25', unit: '°C' } };
    expect(ok(i19FilterIntegrity({ ...base, temperature: '22 °C' })).check.pass).toBe(true);
    const r = ok(i19FilterIntegrity({ ...base, temperature: '28 °C' }));
    expect(r.check.pass).toBe(false);
    expect(r.shown).toMatch(/the test is not valid, FAIL/);
  });

  it.each<[I19Input, RegExp]>([
    [{ mode: 'bubble point', result: '3.2 bar g', makerLimit: '3.45 bar g', wettedWith: 'product' }, /product-wetted test needs the product factor/],
    [{ mode: 'diffusion', result: '12 mL/min', makerLimit: '18 mL/min', wettedWith: 'solvent' }, /solvent-wetted test needs the product factor/],
    [{ mode: 'bubble point', result: '3.5 bar g', makerLimit: '3.45 bar g', productFactor: '0.92' }, /only to a product- or solvent-wetted test/],
    [{ mode: 'bubble point', result: '3.2 bar g', makerLimit: '3.45 bar g', wettedWith: 'product', productFactor: '0' }, /product factor must be more than zero/],
    [{ mode: 'bubble point', result: '3.2 bar g', makerLimit: '3.45 bar' }, /Gauge and absolute pressure are never mixed: 3.2 bar g is a gauge pressure, the limit 3.45 bar is an absolute pressure/],
    [{ mode: 'pressure decay', result: '12 mbar', makerLimit: '20 mbar g' }, /never mixed/],
    [{ mode: 'bubble point', result: '12 mL/min', makerLimit: '3.45 bar g' }, /bubble point must be a pressure or a gauge pressure/],
    [{ mode: 'diffusion', result: '12 mbar', makerLimit: '18 mL/min' }, /diffusion result must be a volume rate/],
    [{ mode: 'pressure decay', result: '0.050 bar', makerLimit: '25 mL/min' }, /give the upstream volume, the atmospheric pressure and the test time/],
    [{ mode: 'pressure decay', result: '0.050 bar', makerLimit: '25 mL/min', upstreamVolume: '2000 mL', atmosphericPressure: '0 mbar g', testTime: '5 min' }, /atmospheric pressure \(absolute\) must be a pressure/],
    [{ mode: 'bubble point', result: '3.5 bar g', makerLimit: '3.45 bar g', filter, master: { type: 'PVDF sterilising grade', poreSize: '0.22 µm' } }, /names "PVDF sterilising grade"/],
    [{ mode: 'bubble point', result: '3.5 bar g', makerLimit: '3.45 bar g', filter, master: { type: 'PES sterilising grade', poreSize: '0.45 µm' } }, /pore size of 0.22 µm but the master names 0.45 µm/],
    [{ mode: 'diffusion', result: '12.5 mL/min', makerLimit: '18 mL/min', temperature: '22 °C' }, /both the test temperature and the range/],
    [{ mode: 'diffusion', result: '-1 mL/min', makerLimit: '18 mL/min' }, /cannot be negative/],
    [{ mode: 'diffusion', result: '12 mL/min', makerLimit: '0 mL/min' }, /limit must be more than zero/],
  ])('I19: refuses %o', (i, msg) => {
    expect(refused(i19FilterIntegrity(i))).toMatch(msg);
  });
});
