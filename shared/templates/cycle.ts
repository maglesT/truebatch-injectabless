/**
 * I21 Cycle against its recipe (autoclave, dry-heat oven or tunnel, SIP, washer, siliconisation bake,
 * VHP decontamination, freeze-drying).
 *
 * The recipe's phases come from the master: each with an optional duration limit and its parameters, each
 * with a set point and ± band, or low and/or high limits. Per phase the record gives the start, the end, and
 * the minimum and maximum of each parameter (typed from the printout). A phase the master leaves out is
 * simply not in the recipe.
 *
 * Checks: every recipe phase recorded, in the recipe's order (by start time); each duration within its
 * limits; each parameter's recorded minimum and maximum inside its band (pharmacopoeia rounding at the
 * band's decimals, as C1). The result value is the total cycle time, first start to last end, in min.
 * The check passes only if every item passes; `shown` lists each failing item.
 */
import { decimalsOf, Dec, num, parse, refuse, run, show, to, unitOf, type Outcome, type Q } from './core.js';
import { checkLimit, type Check, type Limit } from './rounding.js';
import { whyNot } from './units.js';
import { readTime } from './time.js';

export interface I21Parameter {
  /** As in the recipe, e.g. "Shelf temperature". */
  readonly name: string;
  /** The unit the band is written in, e.g. "°C", "mbar". */
  readonly unit: string;
  /** Either a set point with a ± band ("-25", "2") ... */
  readonly setPoint?: string;
  readonly plusMinus?: string;
  /** ... or low and/or high limits as written ("121.1", "124.0"). */
  readonly low?: string;
  readonly high?: string;
}

export interface I21Phase {
  readonly name: string;
  /** Minimum and/or maximum duration, e.g. { low: "15", unit: "min" }. */
  readonly duration?: Limit;
  readonly parameters?: readonly I21Parameter[];
}

export interface I21RecordedPhase {
  /** The recipe phase's name. */
  readonly phase: string;
  readonly start: string;
  readonly end: string;
  /** The minimum and maximum of each recipe parameter during the phase, from the printout. */
  readonly parameters?: readonly { readonly name: string; readonly min: Q; readonly max: Q }[];
}

export interface I21Input {
  readonly recipe: readonly I21Phase[];
  readonly recorded: readonly I21RecordedPhase[];
  /** Display decimals of the total cycle time (min); default 0. */
  readonly decimals?: number;
}

export interface I21Extra {
  /** Each recorded phase, in time order, with its duration (min) and its failing items (empty when it passes). */
  readonly phases: readonly { readonly name: string; readonly minutes: Dec; readonly failures: readonly string[] }[];
  /** Every failing item in plain words (empty when the cycle passes). */
  readonly failures: readonly string[];
}

/** The parameter's band as a limit, and how it is written ("-25 ± 2 °C"). */
function bandOf(phase: string, p: I21Parameter): { limit: Limit; text: string } {
  const what = `Phase "${phase}", ${p.name}`;
  unitOf(p.unit);
  if (p.setPoint !== undefined || p.plusMinus !== undefined) {
    if (p.setPoint === undefined || p.plusMinus === undefined) refuse(`${what}: a set point needs its ± band, and a ± band its set point`);
    const sp = num(p.setPoint, `${what}: the set point`);
    const pm = num(p.plusMinus, `${what}: the ± band`);
    if (pm.isNegative()) refuse(`${what}: the ± band must not be negative`);
    const d = Math.max(decimalsOf(p.setPoint), decimalsOf(p.plusMinus));
    return { limit: { low: sp.minus(pm).toFixed(d), high: sp.plus(pm).toFixed(d), unit: p.unit }, text: `${p.setPoint.trim()} ± ${p.plusMinus.trim()} ${p.unit}` };
  }
  if (p.low === undefined && p.high === undefined) refuse(`${what} needs a set point with a ± band, or low and/or high limits`);
  const text = p.low !== undefined && p.high !== undefined ? `${p.low} to ${p.high} ${p.unit}` : p.low !== undefined ? `not less than ${p.low} ${p.unit}` : `not more than ${p.high ?? ''} ${p.unit}`;
  return { limit: { ...(p.low === undefined ? {} : { low: p.low }), ...(p.high === undefined ? {} : { high: p.high }), unit: p.unit }, text };
}

/** I21 Cycle against its recipe: phases, order, durations and parameter bands; value = total cycle time in min. */
export function i21Cycle(i: I21Input): Outcome<I21Extra> {
  return run(() => {
    if (i.recipe.length === 0) refuse('The recipe has no phases');
    if (i.recorded.length === 0) refuse('No phase is recorded');
    const index = new Map(i.recipe.map((p, n) => [p.name, n]));
    const seen = new Set<string>();
    const recs = i.recorded.map((r) => {
      const n = index.get(r.phase);
      if (n === undefined) refuse(`The recorded phase "${r.phase}" is not in the recipe (${i.recipe.map((p) => p.name).join(', ')})`);
      if (seen.has(r.phase)) refuse(`The phase "${r.phase}" is recorded twice`);
      seen.add(r.phase);
      const s = readTime(r.start, `Phase "${r.phase}": the start`);
      const e = readTime(r.end, `Phase "${r.phase}": the end`);
      if (e < s) refuse(`Phase "${r.phase}": the end (${r.end}) is before the start (${r.start})`);
      return { r, n, s, e, recipe: i.recipe[n] as I21Phase };
    });
    recs.sort((a, b) => a.s - b.s);

    const failures: string[] = [];
    for (const p of i.recipe) if (!seen.has(p.name)) failures.push(`${p.name}: not recorded`);
    for (let k = 1; k < recs.length; k += 1) {
      const a = recs[k - 1];
      const b = recs[k];
      if (a !== undefined && b !== undefined && b.n < a.n) failures.push(`${b.r.phase}: run before ${a.r.phase}, against the recipe's order`);
    }

    const phases = recs.map(({ r, s, e, recipe }) => {
      const own: string[] = [];
      const minutes = new Dec(e - s).div(60);
      if (recipe.duration !== undefined) {
        const c = checkLimit(new Dec(e - s), 's', recipe.duration);
        if (!c.pass) own.push(`${r.phase}: duration ${show(minutes, 'min', 1)} is out of limits (${limitText(recipe.duration)})`);
      }
      const got = new Map((r.parameters ?? []).map((q) => [q.name, q]));
      for (const q of r.parameters ?? []) {
        if (!(recipe.parameters ?? []).some((p) => p.name === q.name)) refuse(`Phase "${r.phase}": the parameter "${q.name}" is not in the recipe for this phase`);
      }
      for (const p of recipe.parameters ?? []) {
        const { limit, text } = bandOf(r.phase, p);
        const q = got.get(p.name);
        if (q === undefined) refuse(`Phase "${r.phase}": the minimum and maximum of ${p.name} are not recorded`);
        const lo = parse(q.min, `Phase "${r.phase}", ${p.name} minimum`);
        const hi = parse(q.max, `Phase "${r.phase}", ${p.name} maximum`);
        const bu = unitOf(p.unit);
        for (const x of [lo, hi]) {
          if (whyNot(x.unit, bu) !== undefined) refuse(`Phase "${r.phase}", ${p.name}: the recorded unit "${x.unit.symbol}" does not convert to the band's unit "${bu.symbol}"`);
        }
        if (to(lo, bu).gt(to(hi, bu))) refuse(`Phase "${r.phase}", ${p.name}: the recorded minimum ${lo.text} is above the maximum ${hi.text}`);
        const cLo = checkLimit(lo.v, lo.unit, limit);
        const cHi = checkLimit(hi.v, hi.unit, limit);
        if (!cLo.pass) own.push(`${r.phase}: ${p.name} minimum ${lo.text} is out of limits (${text})`);
        if (!cHi.pass) own.push(`${r.phase}: ${p.name} maximum ${hi.text} is out of limits (${text})`);
      }
      failures.push(...own);
      return { name: r.phase, minutes, failures: own };
    });

    const first = recs[0];
    const last = recs.reduce((m, x) => (x.e > m ? x.e : m), first?.e ?? 0);
    const value = new Dec(last - (first?.s ?? 0)).div(60);
    const dp = i.decimals ?? 0;
    const total = show(value, 'min', dp);
    const pass = failures.length === 0;
    const verdict = pass ? `all ${i.recipe.length} phases within the recipe` : `NOT within the recipe: ${failures.join('; ')}`;
    const shown = `Cycle of ${recs.length} phase${recs.length === 1 ? '' : 's'} (${phases.map((p) => `${p.name} ${show(p.minutes, 'min', 1)}`).join(', ')}), total ${total}: ${verdict}`;
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: total, shown: verdict };
    return { ok: true, value, unit: 'min', phases, failures, shown, check };
  });
}

function limitText(l: Limit): string {
  if (l.low !== undefined && l.high !== undefined) return `${l.low} to ${l.high} ${l.unit}`;
  if (l.low !== undefined) return `not less than ${l.low} ${l.unit}`;
  return `not more than ${l.high ?? ''} ${l.unit}`;
}
