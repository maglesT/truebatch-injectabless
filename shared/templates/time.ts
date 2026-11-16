/**
 * T13 Duration and hold time (also time counted only while a value is inside limits), and the
 * pure calculation of F8 (continuous lines): the diversion window and the lots in the line in a window.
 *
 * Times are written "2026-11-15 08:30" or "2026-11-15T08:30:15" in the plant's clock (one clock for the
 * whole record), optionally with "Z" or an offset such as "+05:30". Whole seconds only.
 */
import { checkOf, Dec, defaultDecimals, fmt, needKind, parse, refuse, run, show, to, unitOf, ZERO, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Limit } from './rounding.js';

const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

/** Seconds since 1970 (integer), from a written time. */
export function readTime(text: string, what: string): number {
  if (typeof text !== 'string') refuse(`${what} must be written as a date and time, e.g. "2026-11-15 08:30"`);
  const m = STAMP.exec(text.trim());
  if (m === null) refuse(`${what} "${text}" is not a date and time like "2026-11-15 08:30"`);
  const [, y, mo, d, h, mi, s, zone] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'));
  const check = new Date(ms);
  if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59 || Number(s ?? '0') > 59) refuse(`${what} "${text}" is not a real date and time`);
  let offset = 0;
  if (zone !== undefined && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    offset = sign * (Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(4, 6)) * 60);
  }
  return ms / 1000 - offset;
}

/** Writes seconds back as "YYYY-MM-DD HH:MM:SS" (same clock as the input). */
export function writeTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------- T13 Duration and hold time

/** start + k calendar months, same time of day; a day the month lacks becomes its last day (31 Jan + 1 month = 28 or 29 Feb). */
function addMonths(seconds: number, k: number): number {
  const d = new Date(seconds * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + k;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000;
}

/**
 * Calendar months from s to e: the whole months completed (each counted from the start's day of the month), plus the
 * part of the next month as a fraction of that month's length. 2026-01-31 to 2026-02-28 is exactly 1 month.
 */
function calendarMonths(s: number, e: number): { whole: number; at: number; value: Dec } {
  const a = new Date(s * 1000);
  const b = new Date(e * 1000);
  let k = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  while (k > 0 && addMonths(s, k) > e) k -= 1;
  const at = addMonths(s, k);
  const next = addMonths(s, k + 1);
  return { whole: k, at, value: new Dec(k).plus(new Dec(e - at).div(next - at)) };
}

/** The validated maximum hold (master check 49); a limit whose maximum is above it is refused. */
function validated(limit: Limit | undefined, validatedMax: Q | undefined): Parsed | undefined {
  if (validatedMax === undefined) return undefined;
  const max = parse(validatedMax, 'The validated maximum hold');
  needKind(max, ['time', 'calendar months'], 'The validated maximum hold');
  if (limit?.high === undefined) return max;
  const high = parse(`${limit.high} ${limit.unit}`, "The hold's maximum");
  if (high.unit.kind !== max.unit.kind) refuse(`The hold's maximum ${high.text} and the validated maximum ${max.text} must both be in calendar months or both in time units`);
  if (to(high, max.unit).gt(max.v)) refuse(`The hold's maximum ${high.text} is above the validated maximum ${max.text} (master check 49): use the validated maximum, or the shorter one where two are given`);
  return max;
}

/** A hold above the validated maximum is refused, compared exactly (no rounding: 6.2 months is past 6 months). */
function notAboveMax(value: Dec, unit: string, max: Parsed | undefined, shown: string): void {
  if (max === undefined) return;
  const u = unitOf(unit);
  if (u.kind !== max.unit.kind) refuse(`The hold is counted in ${unit} but the validated maximum is ${max.text}: use the same kind of unit (calendar months or time)`);
  if (to({ v: value, unit: u, text: '' }, max.unit).gt(max.v)) refuse(`${shown}: above the validated maximum ${max.text}. Do not use it; raise a deviation`);
}
export type T13Input = (
  | {
      readonly mode: 'duration';
      readonly start: string;
      /** A time, or 'now': the step's own time, given in `now`. */
      readonly end: string;
      /** The step's own time (passed in by the engine) when `end` is 'now'. */
      readonly now?: string;
    }
  | {
      /** Time counted only while the monitored value (read in F6 rounds) is inside `inside`. */
      readonly mode: 'accumulated';
      readonly readings: readonly { readonly time: string; readonly value: Q }[];
      readonly inside: Limit;
      /** The time that must be reached (e.g. "24 h" of curing at temperature). */
      readonly target?: Q;
    }
) & {
  /** Result unit: s, min, h, d, or 'months' (calendar months, duration mode only). */
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
  /**
   * The validated maximum hold named in the master (master check 49). A limit whose maximum is above it is refused,
   * and so is a hold above it (compared exactly, not rounded).
   */
  readonly validatedMax?: Q;
};

/**
 * T13 Duration: end − start, checked against a maximum and/or minimum.
 * Accumulated mode: an interval between two consecutive readings counts only when BOTH readings are inside
 * the limits (a conservative rule: time next to an out-of-limit reading never counts).
 */
export function t13Duration(i: T13Input): Outcome<{ readonly targetReached?: boolean }> {
  return run(() => {
    const u = unitOf(i.unit ?? 'min');
    needKind({ v: ZERO, unit: u, text: '' }, ['time', 'calendar months'], 'The result unit');
    const dp = i.decimals ?? (u.symbol === 'h' ? 2 : defaultDecimals(u.symbol));
    const limit = i.limit;
    const max = validated(i.limit, i.validatedMax);
    if (i.mode === 'duration') {
      const endText = i.end === 'now' ? i.now : i.end;
      if (endText === undefined) refuse("The end is 'now': give the step's own time");
      const endShown = i.end === 'now' ? `now (${endText})` : endText;
      const s = readTime(i.start, 'The start time');
      const e = readTime(endText, i.end === 'now' ? "The step's own time" : 'The end time');
      if (e < s) refuse(`The end (${endShown}) is before the start (${i.start})`);
      if (u.symbol === 'months') {
        const m = calendarMonths(s, e);
        const days = fmt(new Dec(e - m.at).div(86400), 2);
        const shown = `${endShown} − ${i.start} = ${m.whole} calendar month${m.whole === 1 ? '' : 's'} + ${days} d = ${show(m.value, 'months', dp)} (a month ends on the same day of the month, or on the last day of a shorter month)`;
        notAboveMax(m.value, 'months', max, shown);
        return { ok: true, value: m.value, unit: 'months', shown, ...checkOf(m.value, 'months', limit) };
      }
      const value = to({ v: new Dec(e - s), unit: unitOf('s'), text: '' }, u);
      const shown = `${endShown} − ${i.start} = ${show(value, u.symbol, dp)}`;
      notAboveMax(value, u.symbol, max, shown);
      return { ok: true, value, unit: u.symbol, shown, ...checkOf(value, u.symbol, limit) };
    }
    if (u.symbol === 'months') refuse('Calendar months are counted only between a start and an end (duration)');
    if (i.readings.length < 2) refuse('Accumulated time needs at least two readings');
    const rs = i.readings.map((r, n) => ({ t: readTime(r.time, `Reading ${n + 1} time`), p: parse(r.value, `Reading ${n + 1}`) }));
    for (let n = 1; n < rs.length; n += 1) if ((rs[n]?.t ?? 0) < (rs[n - 1]?.t ?? 0)) refuse(`Reading ${n + 1} is earlier than reading ${n}; readings must be in time order`);
    const ok = rs.map((r) => checkLimit(r.p.v, r.p.unit, i.inside).pass);
    let secs = 0;
    let outside = 0;
    for (let n = 1; n < rs.length; n += 1) {
      const dt = (rs[n]?.t ?? 0) - (rs[n - 1]?.t ?? 0);
      if (ok[n] === true && ok[n - 1] === true) secs += dt;
      else outside += dt;
    }
    const value = to({ v: new Dec(secs), unit: unitOf('s'), text: '' }, u);
    const out = to({ v: new Dec(outside), unit: unitOf('s'), text: '' }, u);
    let targetReached: boolean | undefined;
    let tText = '';
    if (i.target !== undefined) {
      const t = parse(i.target, 'The target time');
      needKind(t, ['time'], 'The target time');
      targetReached = value.gte(to(t, u));
      tText = `; target ${t.text}: ${targetReached ? 'reached' : 'NOT reached'}`;
    }
    const shown = `${show(value, u.symbol, dp)} counted inside the limits from ${rs.length} readings (${show(out, u.symbol, dp)} not counted, next to readings out of limits)${tText}`;
    notAboveMax(value, u.symbol, max, shown);
    return { ok: true, value, unit: u.symbol, ...(targetReached === undefined ? {} : { targetReached }), shown, ...checkOf(value, u.symbol, limit) };
  });
}

// ---------------------------------------------------------------- F8 Diversion window (calculation only)
export interface F8Input {
  readonly excursionStart: string;
  readonly excursionEnd: string;
  /** Shortest and longest delay from the excursion point to the press (validated residence time). */
  readonly shortestDelay: Q;
  readonly longestDelay: Q;
  /** Line rate (kg/h or tablets/h) to give the quantity to divert. */
  readonly rate?: Q;
  readonly decimals?: number;
}

export interface F8Extra {
  readonly divertFrom: string;
  readonly divertTo: string;
  readonly windowMinutes: Dec;
}

/** F8 diversion window: divert from start + shortest delay to end + longest delay; quantity = rate × window. */
export function f8DiversionWindow(i: F8Input): Outcome<F8Extra> {
  return run(() => {
    const s = readTime(i.excursionStart, 'The excursion start');
    const e = readTime(i.excursionEnd, 'The excursion end');
    if (e < s) refuse('The excursion ends before it starts');
    const lo = parse(i.shortestDelay, 'The shortest delay');
    const hi = parse(i.longestDelay, 'The longest delay');
    needKind(lo, ['time'], 'The shortest delay');
    needKind(hi, ['time'], 'The longest delay');
    if (lo.v.isNegative() || to(hi, 's').lt(to(lo, 's'))) refuse('The delays must be 0 or more, and the longest not shorter than the shortest');
    const loS = to(lo, 's');
    const hiS = to(hi, 's');
    if (!loS.isInteger() || !hiS.isInteger()) refuse('Delays must be whole seconds');
    const from = s + loS.toNumber();
    const toT = e + hiS.toNumber();
    const windowMinutes = new Dec(toT - from).div(60);
    const head = `divert from ${i.excursionStart} + ${lo.text} = ${writeTime(from)} to ${i.excursionEnd} + ${hi.text} = ${writeTime(toT)} (${fmt(windowMinutes, 1)} min)`;
    if (i.rate === undefined) return { ok: true, value: windowMinutes, unit: 'min', divertFrom: writeTime(from), divertTo: writeTime(toT), windowMinutes, shown: head };
    const r = parse(i.rate, 'The line rate');
    const kinds: Record<string, { per: string; result: string }> = { 'mass rate': { per: 'kg/h', result: 'kg' }, 'count rate': { per: 'units/h', result: 'units' }, 'volume rate': { per: 'L/h', result: 'L' } };
    const k = kinds[r.unit.kind];
    if (k === undefined) refuse(`The line rate must be a mass, count or volume per time; "${r.text}" is not`);
    const value = to(r, k.per).times(windowMinutes).div(60);
    const dp = i.decimals ?? defaultDecimals(k.result);
    return { ok: true, value, unit: k.result, divertFrom: writeTime(from), divertTo: writeTime(toT), windowMinutes, shown: `${head}; quantity = ${r.text} × ${fmt(windowMinutes, 1)} min = ${show(value, k.result, dp)}` };
  });
}

export interface F8LotsInput {
  /** When each lot was fed into the line (from the feeder refill records). */
  readonly lots: readonly { readonly lot: string; readonly from: string; readonly to: string }[];
  readonly shortestDelay: Q;
  readonly longestDelay: Q;
  /** The window at the press (e.g. a complaint or OOS window). */
  readonly windowFrom: string;
  readonly windowTo: string;
}

/** F8 reverse: which material lots could be in the tablets made in a window at the press. */
export function f8LotsInWindow(i: F8LotsInput): Outcome<{ readonly lots: readonly string[] }> {
  return run(() => {
    const lo = to(parse(i.shortestDelay, 'The shortest delay'), 's');
    const hi = to(parse(i.longestDelay, 'The longest delay'), 's');
    if (hi.lt(lo) || lo.isNegative()) refuse('The delays must be 0 or more, and the longest not shorter than the shortest');
    const wf = readTime(i.windowFrom, 'The window start');
    const wt = readTime(i.windowTo, 'The window end');
    if (wt < wf) refuse('The window ends before it starts');
    const lots = i.lots
      .filter((l) => {
        const a = readTime(l.from, `Lot ${l.lot} start`) + lo.toNumber();
        const b = readTime(l.to, `Lot ${l.lot} end`) + hi.toNumber();
        return a <= wt && b >= wf;
      })
      .map((l) => l.lot);
    return { ok: true, value: new Dec(lots.length), unit: 'units', lots, shown: `Lots that could be in the tablets made ${i.windowFrom} to ${i.windowTo}: ${lots.length === 0 ? 'none' : lots.join(', ')}` };
  });
}
