/**
 * I20 Lethality (F-value) from timed temperature readings, per probe; the result is the lowest probe.
 *
 * F = Σ Δt × 10^((T − Tref) ÷ z), in F-min (minutes at the reference temperature). Defaults are F0:
 * Tref 121.1 °C, z 10 °C; the master may set others from the validation (dry heat FH: 170 °C, 20 °C).
 * Readings below the cut-in temperature (default 100 °C) count zero.
 *
 * Integration: the trapezoid rule. Each interval between two consecutive readings counts
 * (t2 − t1) × (L1 + L2) ÷ 2, where L = 10^((T − Tref) ÷ z) is the lethal rate of a reading (0 below the cut-in).
 * So 16 one-minute readings at 121.1 °C (0 to 15 min) give 15.0 F-min. Exact decimals throughout.
 *
 * Times are read as in T13 (`readTime`). A printed F-value is checked with C1 instead.
 */
import { Dec, needKind, parse, refuse, run, show, to, unitOf, ZERO, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Limit } from './rounding.js';
import { differenceUnitOf } from './units.js';
import { readTime } from './time.js';

export interface I20Probe {
  /** As on the printout, e.g. "Probe 3 (cold spot)". */
  readonly name: string;
  readonly readings: readonly { readonly time: string; readonly value: Q }[];
}

export interface I20Input {
  readonly probes: readonly I20Probe[];
  /** Reference temperature; default "121.1 °C" (F0). */
  readonly tref?: Q;
  /** z-value, a temperature difference ("10 °C" or "10 Δ°C"); default "10 °C". */
  readonly z?: Q;
  /** Readings below this temperature count zero; default "100 °C". */
  readonly cutIn?: Q;
  /** The largest allowed time between two consecutive readings of a probe (from the validation), e.g. "1 min". */
  readonly maxInterval: Q;
  /** Optional limit on the lowest probe, in F-min, e.g. { low: "15.0", unit: "F-min" }. */
  readonly limit?: Limit;
  /** Display decimals; default 1. */
  readonly decimals?: number;
}

export interface I20Extra {
  /** Each probe's F-value (F-min), in the order given. */
  readonly probes: readonly { readonly name: string; readonly value: Dec; readonly shown: string }[];
  /** The name of the probe with the lowest F-value (the result). */
  readonly lowest: string;
}

function temperature(q: Q, what: string): Parsed {
  const p = parse(q, what);
  needKind(p, ['temperature'], what);
  return p;
}

/** I20 Lethality: F per probe by the trapezoid rule; the result is the lowest probe's F. */
export function i20Lethality(i: I20Input): Outcome<I20Extra> {
  return run(() => {
    const tref = temperature(i.tref ?? '121.1 °C', 'The reference temperature');
    const zp = parse(i.z ?? '10 °C', 'The z-value');
    needKind(zp, ['temperature', 'temperature difference'], 'The z-value');
    const z = to({ v: zp.v, unit: differenceUnitOf(zp.unit), text: '' }, 'Δ°C');
    if (!z.isPositive() || z.isZero()) refuse(`The z-value must be more than zero; "${zp.text}" is not`);
    const cut = temperature(i.cutIn ?? '100 °C', 'The cut-in temperature');
    const gap = parse(i.maxInterval, 'The maximum interval between readings');
    needKind(gap, ['time'], 'The maximum interval between readings');
    if (!gap.v.isPositive() || gap.v.isZero()) refuse('The maximum interval between readings must be more than zero');
    const gapS = to(gap, 's');
    if (i.limit !== undefined) {
      const lu = unitOf(i.limit.unit);
      if (lu.kind === 'time') refuse(`The minimum F-value must be written in F-min (minutes at the reference temperature), not in clock time "${lu.symbol}"`);
      if (lu.kind !== 'lethality') refuse(`The minimum F-value must be written in F-min; "${lu.symbol}" is not a lethality`);
    }
    if (i.probes.length === 0) refuse('Lethality needs at least one probe');

    const trefC = to(tref, '°C');
    const cutC = to(cut, '°C');
    const rate = (tC: Dec): Dec => (tC.lt(cutC) ? ZERO : Dec.pow(10, tC.minus(trefC).div(z)));
    const dp = i.decimals ?? 1;

    const probes = i.probes.map((pr) => {
      const name = typeof pr.name === 'string' && pr.name.trim() !== '' ? pr.name.trim() : refuse('Every probe needs a name');
      if (pr.readings.length < 2) refuse(`${name} needs at least two readings`);
      const rs = pr.readings.map((r, n) => ({ t: readTime(r.time, `${name}, reading ${n + 1} time`), c: to(temperature(r.value, `${name}, reading ${n + 1}`), '°C') }));
      let f = ZERO;
      for (let n = 1; n < rs.length; n += 1) {
        const a = rs[n - 1];
        const b = rs[n];
        if (a === undefined || b === undefined) continue;
        if (b.t < a.t) refuse(`${name}: reading ${n + 1} is earlier than reading ${n}; readings must be in time order`);
        const dt = new Dec(b.t - a.t);
        if (dt.gt(gapS)) refuse(`${name}: readings ${n} and ${n + 1} are ${show(dt.div(60), 'min', 2)} apart, more than the set maximum interval of ${gap.text}; the lethality cannot be worked out across the gap`);
        f = f.plus(dt.div(60).times(rate(a.c).plus(rate(b.c))).div(2));
      }
      return { name, value: f, shown: `${name} ${show(f, 'F-min', dp)}` };
    });

    let low = probes[0];
    for (const p of probes) if (low === undefined || p.value.lt(low.value)) low = p;
    if (low === undefined) refuse('Lethality needs at least one probe');
    const head = `F-value (Tref ${tref.text}, z ${zp.text}, readings below ${cut.text} count zero; trapezoid rule): ${probes.map((p) => p.shown).join(', ')}; lowest: ${low.name} = ${show(low.value, 'F-min', dp)}`;
    const check = i.limit === undefined ? undefined : checkLimit(low.value, 'F-min', i.limit);
    return { ok: true, value: low.value, unit: 'F-min', probes, lowest: low.name, shown: head, ...(check === undefined ? {} : { check }) };
  });
}
