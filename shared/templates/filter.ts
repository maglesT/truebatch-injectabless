/**
 * I19 Filter integrity test (TrueBatch Injectables, library v1): pass/fail of one test against the filter maker's limit.
 * Bubble point (not less than the minimum), diffusion, pressure decay and water intrusion (not more than the maximum).
 * The limit is the maker's limit for the wetting fluid; a product- or solvent-wetted test uses it × the product
 * factor from validation (master check 39). Gauge and absolute pressure are never mixed (master check 40).
 */
import { Dec, needKind, num, parse, refuse, run, show, to, unitOf, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Check, type Limit } from './rounding.js';
import type { Kind } from './units.js';

export interface FilterId {
  /** The filter type as the maker names it, e.g. "PES sterilising grade". */
  readonly type: string;
  /** Pore size, e.g. "0.22 µm". */
  readonly poreSize: Q;
}

export interface I19Input {
  readonly mode: 'bubble point' | 'diffusion' | 'pressure decay' | 'water intrusion';
  /** The tester's result: a pressure (bubble point, pressure drop) or a flow (diffusion, water intrusion, mL/min). */
  readonly result: Q;
  /** The maker's limit for the wetting fluid: the minimum for a bubble point, the maximum for the others. */
  readonly makerLimit: Q;
  /** Default 'water'. 'product' or 'solvent' needs the product factor. */
  readonly wettedWith?: 'water' | 'alcohol' | 'product' | 'solvent';
  /** The validated product factor (product limit ÷ maker's limit), a plain number, e.g. "0.92". */
  readonly productFactor?: string;
  /** The test temperature and the range the limit holds for (e.g. 20 to 25 °C). Outside the range the test fails. */
  readonly temperature?: Q;
  readonly temperatureRange?: Limit;
  /** Pressure decay against a diffusion limit: the upstream volume, the atmospheric pressure (absolute) and the test time. */
  readonly upstreamVolume?: Q;
  readonly atmosphericPressure?: Q;
  readonly testTime?: Q;
  /** The filter tested and the filter the master names: refused when the type or pore size differs. */
  readonly filter?: FilterId;
  readonly master?: FilterId;
  readonly decimals?: number;
}

export interface I19Extra {
  /** The limit used: the maker's limit, × the product factor when product- or solvent-wetted. */
  readonly testLimit: Dec;
  readonly testLimitUnit: string;
  readonly check: Check;
}

const PRESSURE: Kind[] = ['pressure', 'gauge pressure'];
const FLOW: Kind[] = ['volume rate'];

function sameFilter(f: FilterId, m: FilterId): void {
  if (f.type.trim().toLowerCase() !== m.type.trim().toLowerCase()) {
    refuse(`The filter tested is "${f.type.trim()}" but the master names "${m.type.trim()}": use the filter the master names, or change the master`);
  }
  const fp = parse(f.poreSize, 'The pore size of the filter');
  const mp = parse(m.poreSize, "The master's pore size");
  needKind(fp, ['length'], 'The pore size of the filter');
  needKind(mp, ['length'], "The master's pore size");
  if (!to(fp, 'µm').eq(to(mp, 'µm'))) refuse(`The filter tested has a pore size of ${fp.text} but the master names ${mp.text}: use the filter the master names`);
}

function samePressureKind(r: Parsed, l: Parsed): void {
  if (r.unit.kind !== l.unit.kind) {
    const name = (p: Parsed): string => `${p.text} is ${p.unit.kind === 'gauge pressure' ? 'a gauge pressure' : 'an absolute pressure'}`;
    refuse(`Gauge and absolute pressure are never mixed: ${name(r)}, the limit ${name(l)}. Write both as gauge (for example "bar g") or both as absolute`);
  }
}

/** I19 Filter integrity test. */
export function i19FilterIntegrity(i: I19Input): Outcome<I19Extra> {
  return run(() => {
    if (i.filter !== undefined && i.master !== undefined) sameFilter(i.filter, i.master);
    const wet = i.wettedWith ?? 'water';
    const byProduct = wet === 'product' || wet === 'solvent';
    if (byProduct && i.productFactor === undefined) {
      refuse(`A ${wet}-wetted test needs the product factor from validation: the maker's limit is for water or alcohol, not for the ${wet}`);
    }
    if (!byProduct && i.productFactor !== undefined) refuse('A product factor applies only to a product- or solvent-wetted test');

    let r = parse(i.result, 'The test result');
    const l = parse(i.makerLimit, "The maker's limit");
    if (r.v.isNegative()) refuse('The test result cannot be negative');
    if (!l.v.isPositive() || l.v.isZero()) refuse("The maker's limit must be more than zero");
    let line = '';
    if (i.mode === 'bubble point') {
      needKind(r, PRESSURE, 'A bubble point');
      needKind(l, PRESSURE, 'The bubble point limit');
      samePressureKind(r, l);
    } else if (i.mode === 'pressure decay' && l.unit.kind === 'volume rate') {
      // Pressure decay turned into a diffusion flow: decay × upstream volume ÷ (atmospheric pressure × test time).
      needKind(r, PRESSURE, 'A pressure decay');
      if (i.upstreamVolume === undefined || i.atmosphericPressure === undefined || i.testTime === undefined) {
        refuse('To compare a pressure decay with a diffusion limit, give the upstream volume, the atmospheric pressure and the test time');
      }
      const v = parse(i.upstreamVolume, 'The upstream volume');
      const pa = parse(i.atmosphericPressure, 'The atmospheric pressure');
      const t = parse(i.testTime, 'The test time');
      needKind(v, ['volume'], 'The upstream volume');
      needKind(pa, ['pressure'], 'The atmospheric pressure (absolute)');
      needKind(t, ['time'], 'The test time');
      if (!v.v.isPositive() || v.v.isZero() || !pa.v.isPositive() || pa.v.isZero() || !t.v.isPositive() || t.v.isZero()) {
        refuse('The upstream volume, the atmospheric pressure and the test time must be more than zero');
      }
      // A pressure drop is a difference: the same in gauge or absolute, so its own unit factor gives it in Pa.
      const decayPa = r.v.times(r.unit.factor);
      const flow = decayPa.times(to(v, 'mL')).div(to(pa, 'Pa').times(to(t, 'min')));
      line = `diffusion = ${r.text} × ${v.text} ÷ (${pa.text} × ${t.text}) = ${show(flow, 'mL/min', i.decimals ?? 2)}; `;
      r = { v: flow, unit: unitOf('mL/min'), text: '' };
    } else if (i.mode === 'pressure decay') {
      needKind(r, PRESSURE, 'A pressure decay');
      needKind(l, [...PRESSURE, ...FLOW], 'The pressure decay limit');
      samePressureKind(r, l);
    } else {
      needKind(r, FLOW, i.mode === 'diffusion' ? 'A diffusion result' : 'A water intrusion result');
      needKind(l, FLOW, i.mode === 'diffusion' ? 'The diffusion limit' : 'The water intrusion limit');
    }

    const factor = byProduct ? num(i.productFactor, 'The product factor') : undefined;
    if (factor !== undefined && (!factor.isPositive() || factor.isZero())) refuse('The product factor must be more than zero');
    const limitV = factor === undefined ? l.v : l.v.times(factor);
    const limitText = limitV.toFixed();
    const min = i.mode === 'bubble point';
    const limit: Limit = min ? { low: limitText, unit: l.unit.symbol } : { high: limitText, unit: l.unit.symbol };
    const limitLine = factor === undefined ? `maker's limit ${l.text}` : `limit ${l.text} × product factor ${i.productFactor?.trim() ?? ''} = ${limitText} ${l.unit.symbol}`;
    const resultText = r.text === '' ? show(r.v, r.unit.symbol, i.decimals ?? 2) : r.text;
    let check = checkLimit(r.v, r.unit, limit);
    let shown = `${line}${i.mode} ${resultText}, ${min ? 'not less than' : 'not more than'} the ${limitLine}: ${check.pass ? 'PASS' : 'FAIL'} (${check.shown})`;

    if (i.temperature !== undefined || i.temperatureRange !== undefined) {
      if (i.temperature === undefined || i.temperatureRange === undefined) refuse('Give both the test temperature and the range the limit holds for');
      const tp = parse(i.temperature, 'The test temperature');
      needKind(tp, ['temperature'], 'The test temperature');
      const tc = checkLimit(tp.v, tp.unit, i.temperatureRange);
      if (!tc.pass) {
        check = { pass: false, level: 'fail', rounded: check.rounded, shown: `test temperature ${tc.shown}: the test is not valid` };
        shown = `${shown}; test temperature ${tp.text} is outside the range of the limit: the test is not valid, FAIL; repeat it inside the range`;
      }
    }
    return { ok: true, value: r.v, unit: r.unit.symbol, testLimit: limitV, testLimitUnit: l.unit.symbol, check, shown };
  });
}
