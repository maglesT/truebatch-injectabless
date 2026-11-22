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

export interface I21ListsInput {
  /** The recipe in one line: phases separated by "|", each "name; duration; parameter range", e.g. "Hold; 15 to 20; 121 to 124". A range is "a to b", "at least a", "at most b" or "-" (none). */
  readonly recipe: string;
  /** Per phase, in the recipe's order: the time the phase took (min), and the lowest and highest value of the parameter. */
  readonly minutes: readonly Q[];
  readonly parameterMin: readonly Q[];
  readonly parameterMax: readonly Q[];
  /** The parameter's name and its unit ("Shelf temperature", "°C"). */
  readonly parameter: string;
  readonly unit: string;
}

const edge = (text: string, what: string) => {
  const t = text.trim();
  if (t === '-' || t === '') return {};
  let m = /^(-?[\d.]+)\s+to\s+(-?[\d.]+)$/.exec(t);
  if (m) return { low: m[1] as string, high: m[2] as string };
  m = /^at least\s+(-?[\d.]+)$/.exec(t);
  if (m) return { low: m[1] as string };
  m = /^at most\s+(-?[\d.]+)$/.exec(t);
  if (m) return { high: m[1] as string };
  return refuse(`${what}: "${text}" is not a range: write "a to b", "at least a", "at most b" or "-"`);
};

/**
 * I21 from lists (template round, 22 Nov 2026): the recipe is one text line of phases; the record is the time of each phase and
 * the lowest and highest of its key parameter, in the recipe's order (the phases run one after the other, so the order is the
 * list's). The total cycle time is the sum; a phase out of its time or band fails the check.
 */
export function i21FromLists(i: I21ListsInput): Outcome<I21Extra> {
  return run(() => {
    const phases = i.recipe.split('|').map((x) => x.trim()).filter(Boolean).map((line) => {
      const [name, dur, par] = line.split(';').map((x) => x.trim());
      if (!name || dur === undefined) refuse(`The recipe phase "${line}" needs its name and its duration: "Hold; 15 to 20; 121 to 124"`);
      const d = edge(dur, `${name}: the duration`);
      const p = edge(par ?? '-', `${name}: the ${i.parameter}`);
      return { name, ...(d.low !== undefined || d.high !== undefined ? { duration: { ...d, unit: 'min' } } : {}),
        ...(p.low !== undefined || p.high !== undefined ? { parameters: [{ name: i.parameter, unit: i.unit, ...p }] } : {}) } as I21Phase;
    });
    if (phases.length === 0) refuse('The recipe has no phases');
    if (i.minutes.length !== phases.length || i.parameterMin.length !== phases.length || i.parameterMax.length !== phases.length) {
      refuse(`The recipe has ${phases.length} phases: record the time, lowest and highest of each phase (${i.minutes.length}, ${i.parameterMin.length} and ${i.parameterMax.length} given)`);
    }
    const base = Date.UTC(2000, 0, 1) / 1000;
    const stamp = (s: Dec) => new Date((base + s.toNumber()) * 1000).toISOString().slice(0, 19) + 'Z';
    let at = new Dec(0);
    const recorded = phases.map((p, n) => {
      const mins = to(parse(i.minutes[n] as Q, `${p.name}: the time`), 'min');
      const start = at;
      at = at.plus(mins.times(60));
      return { phase: p.name, start: stamp(start), end: stamp(at), ...(p.parameters ? { parameters: [{ name: i.parameter, min: i.parameterMin[n] as Q, max: i.parameterMax[n] as Q }] } : {}) };
    });
    const o = i21Cycle({ recipe: phases, recorded });
    if (!o.ok) refuse(o.message);
    return o;
  });
}
