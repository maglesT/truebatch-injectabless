/**
 * I22 Count against its sample basis and limit (TrueBatch Injectables, library v1).
 *
 * A count (CFU or particles) is turned to the basis its limit is written on, then compared:
 * - air sample: CFU per m³ of air (count ÷ the air sampled); particles: per m³ (a counter's per ft³ or per L converted);
 * - settle plate (90 mm, exposed up to 4 h), contact plate (55 mm), glove print (5 fingers): CFU per plate or glove;
 *   several plates of one session are summed;
 * - bioburden: CFU per 100 mL of product (count × 100 ÷ the mL filtered). The basis is always shown.
 * Limits: the fixed clean-air table (`shared/master/clean-air.ts`, EU GMP Annex 1) by grade, state and sample, or the
 * product's own limit (bioburden). A master may set a tighter action limit and an alert limit inside it, never looser.
 * "No growth" (grade A, table value 0): any count above zero is an action, however large the sample.
 * The check is C1's: level 'pass', 'alert' or 'fail' ('fail' = action limit exceeded).
 */
import { CLEAN_AIR, GRADES, type Grade, type ViableSample } from '../master/clean-air.js';
import { Dec, fmt, needKind, parse, refuse, run, to, unitOf, ZERO, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Check, type Limit } from './rounding.js';

export type CountSample = 'air' | 'settle plate' | 'contact plate' | 'glove print' | 'particles ≥0.5 µm' | 'particles ≥5 µm' | 'bioburden';

export interface I22Input {
  readonly sample: CountSample;
  /**
   * The count as read: "3 CFU", "2100 particles", or already on a basis ("6 CFU/m³", "100 particles/ft³", "4 CFU/mL").
   * A list: the plates of one session (settle, contact plates, glove prints), summed.
   */
  readonly counts: Q | readonly Q[];
  /** For a raw count of air or particles: the air sampled ("1000 L"); for bioburden: the product filtered ("100 mL"). */
  readonly sampled?: Q;
  /** Settle plate: how long it was exposed; refused above 4 h. */
  readonly exposure?: Q;
  /** The room grade (from the core master data). Not used for bioburden. */
  readonly grade?: Grade;
  /** Needed for particles: the table has a limit at rest and one in operation. */
  readonly state?: 'at rest' | 'in operation';
  /**
   * The master's own action limit ("3 CFU/plate"; bioburden "10 CFU/100 mL"). Required for bioburden and where the
   * table sets none (grade D in operation, glove prints in C and D); never looser than the table.
   */
  readonly actionLimit?: Q;
  /** An alert limit inside the action limit, in the same unit. */
  readonly alertLimit?: Q;
}

const SAMPLES: Record<CountSample, { unit: string; raw: string; on: readonly string[]; words: string; table?: ViableSample | '0.5' | '5' }> = {
  air: { unit: 'CFU/m³', raw: 'CFU', on: ['CFU/m³'], words: 'per m³ of air', table: 'air' },
  'settle plate': { unit: 'CFU/plate', raw: 'CFU', on: ['CFU/plate'], words: 'per settle plate (90 mm, up to 4 h)', table: 'settlePlate' },
  'contact plate': { unit: 'CFU/plate', raw: 'CFU', on: ['CFU/plate'], words: 'per contact plate (55 mm)', table: 'contactPlate' },
  'glove print': { unit: 'CFU/glove', raw: 'CFU', on: ['CFU/glove'], words: 'per glove print (5 fingers)', table: 'glovePrint' },
  'particles ≥0.5 µm': { unit: 'particles/m³', raw: 'particles', on: ['particles/m³', 'particles/ft³', 'particles/L'], words: 'particles ≥ 0.5 µm per m³ of air', table: '0.5' },
  'particles ≥5 µm': { unit: 'particles/m³', raw: 'particles', on: ['particles/m³', 'particles/ft³', 'particles/L'], words: 'particles ≥ 5 µm per m³ of air', table: '5' },
  bioburden: { unit: 'CFU/100 mL', raw: 'CFU', on: ['CFU/100 mL', 'CFU/mL'], words: 'per 100 mL of product' },
};

const PLATES: readonly CountSample[] = ['settle plate', 'contact plate', 'glove print'];

/** The number as written ("10" of "10 CFU/100 mL"), for the limit's decimals. */
const written = (q: Q): string => (typeof q === 'string' ? (q.trim().split(/\s+/)[0] ?? '') : q.value.trim());

/** I22 Count against its sample basis and limit. */
export function i22Count(i: I22Input): Outcome<{ readonly check: Check }> {
  return run(() => {
    const s = SAMPLES[i.sample];
    if (s === undefined) refuse(`Unknown sample "${String(i.sample)}": air, settle plate, contact plate, glove print, particles ≥0.5 µm, particles ≥5 µm or bioburden`);
    const plate = PLATES.includes(i.sample);
    const list = Array.isArray(i.counts) ? (i.counts as readonly Q[]) : [i.counts as Q];
    if (list.length === 0) refuse('Give the count');
    if (list.length > 1 && !plate) refuse('Several counts are summed only for the plates of one session (settle plates, contact plates, glove prints); give one count per air or bioburden sample');
    const basis = unitOf(s.unit);

    // The counts, each raw (CFU, particles, plain number) or already on an allowed basis.
    const ps = list.map((q, n) => parse(q, list.length > 1 ? `Plate ${n + 1}` : 'The count'));
    for (const p of ps) {
      const raw = p.unit.symbol === s.raw || p.unit.kind === 'number';
      if (!raw && !s.on.includes(p.unit.symbol)) refuse(`${p.text} is not a count for this sample: give it in ${s.raw} or ${s.on.join(' or ')}`);
      if (p.v.isNegative()) refuse('A count cannot be negative');
      if (raw && !p.v.isInteger()) refuse(`A count of colonies or particles is a whole number; "${p.text}" is not`);
    }
    const total = ps.reduce((a, p) => a.plus(p.v), ZERO);
    const first = ps[0] as Parsed;
    const raw = first.unit.symbol === s.raw || first.unit.kind === 'number';

    // Settle plate: the basis is up to 4 hours of exposure.
    if (i.exposure !== undefined) {
      const e = parse(i.exposure, 'The exposure time');
      needKind(e, ['time'], 'The exposure time');
      if (i.sample !== 'settle plate') refuse('An exposure time belongs to a settle plate');
      if (to(e, 'h').gt(4)) refuse(`A settle plate is exposed for at most 4 hours; ${e.text} is longer: use a new plate for each 4 hours (Annex 1)`);
    }

    // To the basis.
    let value: Dec;
    let line: string;
    if (plate) {
      value = total;
      line = ps.length > 1 ? `${ps.map((p) => fmt(p.v, 0)).join(' + ')} CFU (${ps.length} plates of one session) = ${fmt(total, 0)} ${s.unit}` : `${fmt(total, 0)} ${s.unit}`;
    } else if (!raw) {
      value = to(first, basis);
      line = first.unit.symbol === s.unit ? `${first.text}` : `${first.text} = ${fmt(value, 2)} ${s.unit}`;
    } else {
      if (i.sampled === undefined) refuse(i.sample === 'bioburden' ? `A count of ${first.text} needs the volume of product filtered (for example "100 mL")` : `A count of ${first.text} needs the volume of air sampled (for example "1000 L")`);
      const v = parse(i.sampled, i.sample === 'bioburden' ? 'The volume filtered' : 'The air sampled');
      needKind(v, ['volume'], i.sample === 'bioburden' ? 'The volume filtered' : 'The air sampled');
      if (!v.v.isPositive() || v.v.isZero()) refuse('The volume sampled must be more than zero');
      if (i.sample === 'bioburden') {
        value = total.times(100).div(to(v, 'mL'));
        line = `${first.text} in ${v.text}: ${fmt(total, 0)} × 100 mL ÷ ${v.text} = ${fmt(value, 2)} ${s.unit}`;
      } else {
        value = total.div(to(v, 'm³'));
        line = `${first.text} in ${v.text} (${fmt(to(v, 'm³'), 4)} m³) = ${fmt(value, 2)} ${s.unit}`;
      }
    }
    line += ` (${s.words})`;

    // The action limit: the table's, or the master's own (never looser than the table).
    let tableValue: number | null | undefined;
    let where = '';
    if (s.table !== undefined) {
      if (i.grade === undefined || !GRADES.includes(i.grade)) refuse('Give the room grade (A, B, C or D) for the clean-air table');
      if (s.table === '0.5' || s.table === '5') {
        if (i.state !== 'at rest' && i.state !== 'in operation') refuse('Say whether the room was at rest or in operation: the particle limits differ');
        tableValue = CLEAN_AIR.particles[i.grade][i.state === 'at rest' ? 'atRest' : 'inOperation'][s.table];
        where = `grade ${i.grade} ${i.state}`;
      } else {
        tableValue = CLEAN_AIR.viable[i.grade][s.table];
        where = `grade ${i.grade}`;
      }
    }
    const own = (q: Q, what: string): Parsed => {
      const p = parse(q, what);
      if (!s.on.includes(p.unit.symbol)) refuse(`${what} must be written ${s.words}, in ${s.on.join(' or ')}; "${p.text}" is not`);
      if (p.v.isNegative()) refuse(`${what} cannot be negative`);
      return p;
    };
    let limit: Limit;
    let source: string;
    if (i.actionLimit !== undefined) {
      const m = own(i.actionLimit, "The master's action limit");
      if (tableValue !== undefined && tableValue !== null && to(m, basis).gt(tableValue)) {
        refuse(`The master's action limit ${m.text} is looser than the clean-air table (${where}: ${tableValue === 0 ? 'no growth' : `${tableValue} ${s.unit}`}, EU GMP Annex 1): a master may only set a tighter limit`);
      }
      limit = { high: written(i.actionLimit), unit: m.unit.symbol };
      source = 'the master';
    } else if (tableValue === undefined) {
      refuse("A bioburden count needs the product's limit (for example \"10 CFU/100 mL\") from the master");
    } else if (tableValue === null) {
      refuse(`The clean-air table sets no limit for ${i.sample === 'glove print' ? `glove prints in grade ${i.grade ?? ''}` : `${where}`} (EU GMP Annex 1): the master must give its own action limit, from its risk assessment`);
    } else {
      limit = { high: String(tableValue), unit: s.unit };
      source = 'the clean-air table (EU GMP Annex 1)';
    }
    if (i.alertLimit !== undefined) {
      const a = own(i.alertLimit, 'The alert limit');
      if (a.unit.symbol !== limit.unit) refuse(`Write the alert limit in the same unit as the action limit (${limit.unit})`);
      if (a.v.gt(new Dec(limit.high ?? '0'))) refuse(`The alert limit ${a.text} is above the action limit ${limit.high ?? ''} ${limit.unit}: an alert limit sits inside the action limit`);
      limit = { ...limit, alertHigh: written(i.alertLimit) };
    }

    // No growth: any colony is an action, whatever the sample size (the per-m³ figure could round to 0).
    const zero = new Dec(limit.high ?? '0').isZero();
    let check: Check;
    if (zero && total.gt(0)) {
      const sh = `no growth allowed; ${fmt(total, 0)} ${s.raw} found: ACTION`;
      check = { pass: false, level: 'fail', rounded: `${fmt(total, 0)} ${s.raw}`, shown: sh };
    } else {
      check = checkLimit(value, basis, limit);
      if (!check.pass) check = { ...check, shown: `${check.shown}: ACTION` };
    }
    const shown = `${line}; ${where !== '' ? `${where}, ` : ''}action limit from ${source}: ${check.shown}`;
    return { ok: true, value, unit: s.unit, shown, check };
  });
}
