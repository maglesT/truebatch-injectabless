/**
 * Master checks: pure checks over one master document. Each problem is an error (⛔, the version cannot be approved)
 * or a warning (⚠️), with the path to the item. Template settings are checked by the templates library itself.
 * The calculation checks (calculationChecks below) are error-proofing of the calculations, not GMP rules.
 */
import { findBlock, type Block } from '../blocks/index.js';
import { refsIn } from '../blocks/format.js';
import { Dec, c1WithinLimits, findUnit, t10Compensating, t11SaltFactor, t2Total, t8BatchScaling, type Q } from '../templates/index.js';
import { decimalsOf } from '../templates/core.js';
import { evaluate, headerValue, lineQuantity } from '../engine/values.js';
import { kindOf, kindOfUnit, neededKind } from './kinds.js';
import { materialLines, type Answer, type FormulaLine, type Limit, type MasterDoc, type SettingValue } from './schema.js';
import { isBalance } from '../engine/picks.js';
import { sterileChecks } from './sterile-checks.js';
import { packingChecks } from './packing.js';

/** A warning the author answers: one of the options, with a reason when `needsReason`. */
export interface Question { key: string; options: string[]; needsReason: boolean; answer?: Answer }
export interface Problem { level: 'error' | 'warning'; path: string; message: string; rule?: string; question?: Question }

/**
 * A message in plain words for the people who read it (as TrueBatch Tablets, 17 Nov 2026): without the internal codes
 * of the rules (TI-11, TI-P5), templates (T9, I19), failure cases (F0204) and the library's numbered checks ("library
 * check 41") the code comments use. The rule stays in `rule` for the tests and the traceability matrix.
 */
export const plainWords = (m: string) => m
  .replace(/\s*\((?:TI-P?\d+|[TI]\d+)\)/g, '')
  .replace(/\s*\(library checks? \d+(?:(?:, | and )\d+)*\)/g, '')
  .replace(/;\s*library checks? \d+(?:(?:, | and )\d+)*(?=\))/g, '')
  .replace(/\bF0\d{3}:\s*/g, '')
  .replace(/\s*\(F0\d{3}(?:, F0\d{3})*\)/g, '');

/** What stops "Send for review" and approval: an error, or a warning that needs an answer and has none. */
export const blocking = (p: Problem) => p.level === 'error' || (p.question !== undefined && !p.question.answer);

const QUANTITY = /^[+-]?(\d+(\.\d*)?|\.\d+)\s*(\S.*)?$/;
const DECIMAL = /^\d+(\.\d+)?$/;
// Neutral certificate values for checking a formula line's adjustment settings with the templates themselves.
const SAMPLE = { assay: { value: '100.0', unit: '%' }, water: { value: '0', unit: '%' }, lod: { value: '0', unit: '%' } };
const HERE = { stage: 0, sub: 1, step: 0, round: 1 };

export function masterChecks(doc: MasterDoc): Problem[] {
  const out: Problem[] = [];
  const error = (path: string, message: string, rule?: string) => out.push({ level: 'error', path, message, ...(rule ? { rule } : {}) });
  const warn = (path: string, message: string) => out.push({ level: 'warning', path, message });
  const twice = (keys: string[], path: string) => keys.forEach((k, i) => keys.indexOf(k) !== i && error(`${path}[${i}]`, `The key ${k} is used twice`));

  // A packing master (it has a pack) has its own checks instead of the formula, calculation and sterile checks.
  if (doc.pack) out.push(...packingChecks(doc));
  else formulaChecks(doc, out, error);

  twice(doc.stages.map((s) => s.key), 'stages');
  // Engine change 5: each time limit names steps of this master (TI-17).
  twice((doc.timeLimits ?? []).map((l) => l.key), 'timeLimits');
  (doc.timeLimits ?? []).forEach((l, i) => {
    for (const p of [l.from, l.to]) {
      const [sk, tk] = p.step.split('/') as [string, string];
      if (!p.step) error(`timeLimits[${i}]`, `${l.name || 'A time limit'}: choose its ${p === l.from ? 'first' : 'last'} step`, 'TI-17');
      else if (!doc.stages.find((s) => s.key === sk)?.steps.some((t) => t.key === tk)) error(`timeLimits[${i}]`, `${l.name || 'A time limit'}: ${p.step} is not a step of this master`, 'TI-17');
    }
    if (!l.name.trim()) error(`timeLimits[${i}]`, 'A time limit needs its name', 'TI-17');
    if (l.from.step === l.to.step && l.from.at === l.to.at) error(`timeLimits[${i}]`, `${l.name}: it starts and ends at the same point`, 'TI-17');
  });
  // TI-11: a master that weighs names the rooms its materials are weighed in (its balances are offered there).
  const weighs = doc.stages.some((s) => s.steps.some((t) => findBlock(t.block)?.fields.some((f) => f.kind === 'machine' && isBalance(f))));
  if (weighs && !doc.header.dispensingRooms?.length) error('header.dispensingRooms', 'The master weighs but names no dispensing rooms: choose them in the header (rooms of master data)', 'TI-11');
  doc.stages.forEach((s, si) => {
    const path = `stages[${si}]`;
    twice(s.steps.map((t) => t.key), `${path}.steps`);
    if (s.kind === 'sub-batch' && !s.count) error(path, 'A sub-batch stage needs the number of sub-batches');
    if (s.produces && !s.produces.holdHours) error(`${path}.produces`, `The intermediate ${s.produces.name} has no hold time`, 'TI-01');
    // Everything the plain view would show as "(not set)" is reported here (the plain view's sentences, describe.ts).
    if (!s.role.trim()) warn(path, `Stage ${s.name} names no responsible role`);
    if (!doc.pack && s.kind !== 'preparation' && !s.steps.some((t) => findBlock(t.block)?.gmp === 'yield')) error(path, `Stage ${s.name} has no yield step`);
    if (s.kind === 'preparation' && !s.startsAfter && !doc.stages.some((x) => x.uses.includes(s.key))) warn(path, `No stage uses the preparation ${s.name}`);
    // Engine change 3: results that come later start after an earlier step, in a preparation stage nothing uses.
    if (s.startsAfter) {
      const [sk, tk] = s.startsAfter.split('/') as [string, string];
      const pi = doc.stages.findIndex((x) => x.key === sk);
      if (s.kind !== 'preparation') error(`${path}.startsAfter`, `Only a preparation stage starts after a step (results that come later): ${s.name} is not one`);
      else if (pi < 0 || pi >= si || !doc.stages[pi]!.steps.some((t) => t.key === tk)) error(`${path}.startsAfter`, `${s.startsAfter} is not a step of an earlier stage`);
      if (doc.stages.some((x) => x.uses.includes(s.key))) error(`${path}.startsAfter`, `${s.name} starts after a step, so no stage can wait for it; it only has to close before production signs`);
    }
    // TI-10: a stage worked in a room starts with line clearance.
    const clearance = s.steps.findIndex((t) => findBlock(t.block)?.gmp === 'line-clearance');
    if (s.roomTypes.length && clearance < 0) error(path, `Stage ${s.name} is worked in a room but has no line clearance step`, 'TI-10');
    if (clearance > 0 && !doc.pack) warn(`${path}.steps[${clearance}]`, `Line clearance is not the first step of ${s.name}`);
    // TI-11: a stage that works machines (not balances, nor the line a packing batch is issued to) or names a room
    // runs only in the rooms it allows (shared/engine/picks.ts).
    const placed = s.steps.some((t) => { const b = findBlock(t.block); return !b?.atIssue && b?.fields.some((f) => f.kind === 'room' || (f.kind === 'machine' && !isBalance(f))); });
    if (placed && !s.roomTypes.length) error(`${path}.roomTypes`, `Stage ${s.name}: choose the rooms this stage may run in (an area or a room of master data, in the stage settings)`, 'TI-11');
    for (const u of s.uses) {
      const pi = doc.stages.findIndex((x) => x.key === u);
      if (pi < 0 || pi >= si) error(`${path}.uses`, `${u} is not an earlier stage`);
      else if (!doc.stages[pi]!.produces) error(`${path}.uses`, `Stage ${doc.stages[pi]!.name} produces no intermediate`);
    }
    s.steps.forEach((st, ti) => {
      const p = `${path}.steps[${ti}]`;
      const block = findBlock(st.block);
      if (!block) return void error(`${p}.block`, `No block ${st.block.id} version ${st.block.version}`);
      if (block.packing && !doc.pack) error(p, `${block.name} is a packing step: an injectables master cannot use it`);
      if (!st.checker && (block.gmp || st.critical)) error(p, `${block.gmp ? `A ${block.gmp.replace('line-clearance', 'line clearance')} step` : 'A critical step'} needs a second-person check`, 'TI-08');
      if (st.critical && st.flow.kind === 'optional-with-reason') error(`${p}.flow`, 'A critical step cannot be optional');
      if (st.waitForCheck && !st.checker) warn(p, 'The next step waits for a check this step does not have');
      for (const bs of block.settings) if (!bs.optional && st.settings[bs.name] === undefined) error(`${p}.settings.${bs.name}`, `${bs.label} is not set`);
      // Engine change 4: a number of readings the step sets is a whole number from 1 to 100.
      for (const f of block.fields) {
        const n = typeof f.count === 'string' ? st.settings[f.count.slice(1)] : undefined;
        if (typeof n === 'string' && !/^([1-9]\d?|100)$/.test(n)) error(`${p}.settings.${String(f.count).slice(1)}`, `${f.label}: the number of readings must be a whole number from 1 to 100`);
      }
      for (const [name, v] of Object.entries(st.settings)) {
        const bs = block.settings.find((x) => x.name === name);
        const listed = !bs?.options || (typeof v === 'string' && bs.options.includes(v));
        const why = !bs ? `The block ${block.name} has no setting ${name}` : listed ? settingProblem(doc, si, ti, bs.kind, v) : `${bs.label}: choose one of ${bs.options!.join(', ')}`;
        if (why) error(`${p}.settings.${name}`, why);
        // A limit of another kind than what it limits (a lethality written in minutes): the designer offers only the
        // right kinds; a master written otherwise is refused here (found in the first Injectables batch run).
        else if (bs?.kind === 'limit' && typeof v === 'object' && 'unit' in v) {
          // Only a plain limit check (C1: one value against this limit) says exactly what kind the limit must be.
          const c1 = block.calcs.find((c) => c.template === 'C1' && typeof c.args.limit === 'string' && c.args.limit.replace(/^\$|\?$/g, '') === name);
          const value = c1 && typeof c1.args.value === 'string' ? c1.args.value.replace(/^\$|\?$/g, '') : undefined;
          // And I19's test temperature range: a temperature, whatever the result unit is (F5 of the 17 Nov 2026 run).
          const i19 = block.calcs.some((c) => c.template === 'I19' && refsIn(c.args.temperatureRange).includes(name));
          const needed = value ? kindOf(block, value, st.settings) : i19 ? neededKind(block, name, st.settings) : undefined, has = kindOfUnit(v.unit);
          if (needed && has && needed !== has) error(`${p}.settings.${name}`, `${bs.label}: a ${needed} limit is needed here, not ${has} (${v.unit})`);
        }
      }
      // A temperature recorded with optional limits left empty is recorded without a check (as TrueBatch Tablets, 17 Nov
      // 2026): a warning, so the author sets them or leaves them knowingly.
      for (const c of block.calcs) {
        const a = c.args as { value?: unknown; limit?: unknown };
        const lim = c.template === 'C1' && typeof a.limit === 'string' ? block.settings.find((x) => x.name === a.limit!.toString().slice(1) && x.optional) : undefined;
        const f = typeof a.value === 'string' ? block.fields.find((x) => x.name === (a.value as string).slice(1)) : undefined;
        if (lim && f && findUnit(f.unit ?? '')?.kind === 'temperature' && st.settings[lim.name] === undefined) warn(`${p}.settings.${lim.name}`, `${f.label} is recorded but not checked: set the ${lim.label.toLowerCase()}`);
      }
      // A stage's yield on an earlier stage's output while this stage adds formula materials (as TrueBatch Tablets, 17 Nov
      // 2026; here e.g. an API or excipient charged into a vehicle made in an earlier stage): the base leaves out what the
      // stage adds, so the yield reads above 100 %.
      const base = block.id === 'stage-yield' ? st.settings.theoretical : undefined;
      const from = base && typeof base === 'object' && 'ref' in base ? doc.stages.find((x) => x.key === base.ref.split('/')[0]) : undefined;
      if (from && from !== s && !doc.pack) {
        const added = [...new Set(s.steps.flatMap((x) => Object.values(x.settings)).flatMap((v) => (typeof v === 'object' && 'formula' in v ? [v.formula] : [])))]
          .map((k) => doc.formula.find((l) => l.key === k)?.name).filter((n): n is string => !!n);
        if (added.length) error(`${p}.settings.theoretical`, `The yield of ${s.name} is worked out on the output of ${from.name} only, but ${s.name} adds ${added.join(' and ')}: the yield would read above 100 %. Take the batch quantity from the header (or a quantity that includes what this stage adds) as the theoretical quantity`);
      }
      // A calculation that needs no recorded value is worked out now (e.g. a liquid make-up, T17): a refusal must be fixed.
      const now = evaluate(doc, [], { stage: si, sub: 1, step: ti, round: 1 }, {});
      for (const c of block.calcs) { const r = now[c.name]; if (r && !r.ok) error(p, `${c.label}: ${r.message}`); }
      if (st.flow.kind === 'repeat-until') {
        if (!st.flow.maxRounds) error(`${p}.flow`, 'A repeat-until step needs the most rounds allowed');
        const stop = st.flow.stop ?? block.stop;
        if (!stop || !block.calcs.some((c) => c.name === stop)) error(`${p}.flow`, 'A repeat-until step needs a stop check (a calculation of its block)');
      }
      if (st.everyMinutes && st.flow.kind !== 'repeat-until') error(`${p}.everyMinutes`, 'Checks every N minutes need a repeat-until step');
      const later = st.everyMinutesLater;
      if (later && !st.everyMinutes) error(`${p}.everyMinutesLater`, 'A later interval needs the interval of the first checks');
      if (later && block.periodic && later.everyMinutes > block.periodic.maxMinutes) error(`${p}.everyMinutesLater`, `Periodic checks every ${later.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, 'TI-15');
      if (st.onlyIf) {
        const unit = { batchSize: doc.header.batchUnit, batchVolume: 'L', batchMass: 'kg', units: 'units', fillVolume: 'mL', fillTarget: 'mL', density: 'g/mL' }[st.onlyIf.header];
        const r = c1WithinLimits({ value: { value: '0', unit }, limit: st.onlyIf.limit });
        if (!r.ok) error(`${p}.onlyIf`, `The rule for leaving the step out: ${r.message}`);
      }
      if (block.periodic && !st.everyMinutes) error(`${p}.everyMinutes`, `${block.name} needs the interval of its periodic checks`, 'TI-15');
      if (block.periodic && st.everyMinutes && st.everyMinutes > block.periodic.maxMinutes) {
        error(`${p}.everyMinutes`, `Periodic checks every ${st.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, 'TI-15');
      }
    });
  });
  return out.map((p) => ({ ...p, message: plainWords(p.message) }));
}

/**
 * The liquid header (engine change 1) and the formula: a batch in kg needs its density; a batch in L or kg is filled
 * at a nominal fill; every line but a vehicle made up to volume has its mg per mL (or per unit).
 */
function formulaChecks(doc: MasterDoc, out: Problem[], error: (path: string, message: string, rule?: string) => void): void {
  const twice = (keys: string[], path: string) => keys.forEach((k, i) => keys.indexOf(k) !== i && error(`${path}[${i}]`, `The key ${k} is used twice`));
  twice(doc.formula.map((l) => l.key), 'formula');
  const h = doc.header;
  if (new Dec(h.batchSize).isZero()) error('header.batchSize', 'The batch size cannot be zero');
  if (h.batchUnit === 'kg' && !h.densityGPerMl) error('header.densityGPerMl', 'A batch in kg needs the density (g/mL): the formula is per mL', 'TI-01');
  if (h.densityGPerMl && new Dec(h.densityGPerMl).isZero()) error('header.densityGPerMl', 'The density cannot be zero');
  if (h.batchUnit !== 'units' && (!h.fillVolumeMl || new Dec(h.fillVolumeMl).isZero())) error('header.fillVolumeMl', 'A batch in L or kg needs the nominal fill per container (mL)', 'TI-01');
  if (h.batchUnit === 'units' && (h.fillVolumeMl || h.fillExcessMl)) error('header.fillVolumeMl', 'A batch in units is filled as units: it has no fill volume');
  if (h.fillExcessMl && !h.fillVolumeMl) error('header.fillExcessMl', 'A fill excess needs the nominal fill');
  if (!doc.formula.some((l) => l.role !== 'solvent')) error('formula', 'The formula has no drug substance or excipient');
  doc.formula.forEach((l, i) => {
    if (l.mg === undefined && l.role !== 'solvent') error(`formula[${i}].mg`, `${l.name} has no quantity per ${h.batchUnit === 'units' ? 'unit' : 'mL'}; only the vehicle made up to volume (q.s.) may have none`);
  });
  if (doc.formula.filter((l) => l.mg === undefined).length > 1) error('formula', 'Only one line can make the batch up to volume (q.s.)');
  doc.formula.forEach((l, i) => {
    const a = l.adjust;
    if (!a) return;
    if (a.potency && a.content) error(`formula[${i}].adjust`, 'A line is adjusted for potency (T9) or for content (T18), not both');
    for (const k of a.compensates ?? []) if (k === l.key || !doc.formula.some((x) => x.key === k)) error(`formula[${i}].adjust.compensates`, `No other formula line ${k} to compensate`);
    const values = { ...SAMPLE, content: nominal(l) };
    if (a.content?.contentSource === 'in-process result' && !a.content.resultType) {
      error(`formula[${i}].adjust`, `State what the in-process result for ${l.name} is: the content (% w/w) or a relative assay in % of theoretical (F0205: a % of theoretical read as the content gives about a third of the dose)`);
    }
    const r = lineQuantity(doc, [], HERE, { ...l, adjust: { ...a, compensates: undefined } }, true, values);
    if (!r.ok) error(`formula[${i}].adjust`, r.message, a.potency ? 'TI-13' : undefined);
    // A compensating filler that would go below zero even at the nominal certificate values (salt factor, overage).
    const others = (a.compensates ?? []).map((k) => doc.formula.find((x) => x.key === k)).filter((x): x is FormulaLine => !!x && x.key !== l.key);
    const quantity = (x: FormulaLine, adjusted: boolean) => {
      const r = lineQuantity(doc, [], HERE, x, adjusted, { ...SAMPLE, content: nominal(x) });
      return r.ok ? { value: r.value, unit: r.unit } : undefined;
    };
    const std = quantity(l, false);
    const adj = others.map((x) => ({ name: x.name, standard: quantity(x, false), adjusted: quantity(x, true) }));
    if (std && adj.length && adj.every((x) => x.standard && x.adjusted)) {
      const t10 = t10Compensating({ fillers: [{ name: l.name, standard: std }], adjusted: adj as { name: string; standard: Q; adjusted: Q }[] });
      if (!t10.ok) error(`formula[${i}].adjust.compensates`, `At the nominal certificate values: ${t10.message.replace(/; raise a deviation$/, '')}`, 'TI-13');
    }
  });
  formulaSums(doc, error);
  calculationChecks(doc, out);
  sterileChecks(doc, (path, key, message, options, needsReason = false) => askOf(doc, out, path, key, message, options, needsReason), error);
  // Owner, 17 Nov 2026: a fill's mean fill-weight limits contain the master's own fill target (a syringe master once had a
  // vial's limits, and every needle of its first batch was out of limits).
  const fh = doc.header;
  if (fh.fillVolumeMl && fh.densityGPerMl) {
    const target = new Dec(fh.fillVolumeMl).plus(fh.fillExcessMl ?? '0').times(fh.densityGPerMl);
    doc.stages.forEach((s, si) => s.steps.forEach((t, ti) => {
      const l = t.settings.meanLimit;
      if (!['fill', 'ffs-run'].includes(t.block.id) || !l || typeof l !== 'object' || !('unit' in l)) return;
      const k = ({ g: '1', kg: '1000', mg: '0.001' } as Record<string, string>)[l.unit];
      if (!k) return;
      const low = l.low !== undefined ? new Dec(l.low).times(k) : undefined, high = l.high !== undefined ? new Dec(l.high).times(k) : undefined;
      if ((low && target.lt(low)) || (high && target.gt(high))) {
        out.push({ level: 'warning', path: `stages[${si}].steps[${ti}].settings.meanLimit`, message: `The mean fill weight limits (${l.low ?? '…'} to ${l.high ?? '…'} ${l.unit}) do not contain the fill target ${target.toFixed(3)} g (${fh.fillVolumeMl} mL fill + ${fh.fillExcessMl ?? '0'} mL excess × ${fh.densityGPerMl} g/mL): check they are this product's limits` });
      }
    }));
  }
}

const nominal = (l: FormulaLine) => (l.adjust?.content?.resultType === 'percent of theoretical' ? SAMPLE.assay : l.adjust?.content?.nominalContent ?? SAMPLE.assay);
const quantityOf = (text: string | undefined) => { const m = QUANTITY.exec(text ?? ''); const u = m && findUnit(m[3] ?? ''); return m && u ? { v: new Dec(m[1]!), u, text: text! } : undefined; };
const isMass = (text: string) => quantityOf(text)?.u.kind === 'mass';
const off = (a: Dec, b: Dec) => a.minus(b).abs().div(b).times(100);

/**
 * Calculation checks on the formula's own numbers (refusals): a batch quantity written that the quantity per mL ×
 * the batch volume (T8) does not give (F0303, F0388), and one material twice with two quantities (F0250).
 */
function formulaSums(doc: MasterDoc, error: (path: string, message: string) => void): void {
  const per = doc.header.batchUnit === 'units' ? 'unit' : 'mL';
  doc.formula.forEach((l, i) => {
    if (l.batchQuantity !== undefined && l.mg !== undefined) {
      const w = quantityOf(l.batchQuantity);
      const r = lineQuantity(doc, [], HERE, { ...l, adjust: undefined }, false, {});
      if (!w || w.u.kind !== 'mass') error(`formula[${i}].batchQuantity`, `"${l.batchQuantity}" is not a mass with a unit, e.g. "12.000 kg"`);
      else if (r.ok) {
        const want = new Dec(r.value).times(findUnit(r.unit)!.factor).div(w.u.factor).toDecimalPlaces(decimalsOf(l.batchQuantity.split(/\s/)[0]!), Dec.ROUND_HALF_UP);
        if (!want.eq(w.v)) error(`formula[${i}].batchQuantity`, `The batch quantity ${l.batchQuantity} written for ${l.name} is not ${r.shown}: every batch quantity comes from the quantity per ${per} × the batch (T8). Correct the batch column or the mg per ${per}`);
      }
    }
    const twin = doc.formula.findIndex((x, j) => j < i && x.materialItemId === l.materialItemId);
    if (twin >= 0 && doc.formula[twin]!.mg !== l.mg) {
      error(`formula[${i}]`, `${l.name} appears twice with two quantities (${doc.formula[twin]!.mg ?? 'q.s.'} and ${l.mg ?? 'q.s.'} mg per ${per}): keep one line with the quantity that is charged`);
    }
  });
}

// Calculation checks (owner decision of 15 November 2026). Not GMP rules: error-proofing of the calculations while the
// master is built. The refusals (water counted twice, potency as parent or element with a salt factor, molecules per
// salt unit, negative filler, IU or CFU as a mass) come from the templates through the formula checks above. These
// warnings need an answer, kept in the master document under their key; the answer counts while the warning reads the
// same as when it was answered.
const SALT_WORD = /\b(hydrochloride|hcl|hydrobromide|sodium|potassium|calcium|magnesium|zinc|maleate|fumarate|hemifumarate|succinate|tartrate|besylate|besilate|mesylate|mesilate|citrate|phosphate|sulfate|sulphate|acetate|bromide|chloride|nitrate|lactate|gluconate|tosylate|oxalate|malate|carbonate|oxide)\b/i;
// (Tablet-only checks of the copy — processing aids, herbal lines, weights against the core weight, tooling, other
// strengths from one blend — are not used for injectables.)
const WET = /\b(wet|cake|damp|solvent-wet)\b/i;
const SIZE = /\b(d\s?\(?0?\.?[159]0?\)?|d10|d50|d90|dv\d+|particle size|surface area|polymorph|crystal form)\b/i;
const RATIO = /\d+(\.\d+)?\s*(:\s*\d+(\.\d+)?|%(\s*w\/w)?)/;

/** A warning the author answers; its answer counts while the warning reads the same as when it was answered. */
function askOf(doc: MasterDoc, out: Problem[], path: string, key: string, message: string, options: string[], needsReason = false): string | undefined {
  const a = doc.answers?.[key];
  // An answer given to the message as it read before plain words still counts.
  const ok = a && (a.about === message || a.about === plainWords(message)) && options.includes(a.choice) && (!needsReason || a.reason.trim() !== '');
  out.push({ level: 'warning', path, message, question: { key, options, needsReason, ...(ok ? { answer: a } : {}) } });
  return ok ? a.choice : undefined;
}

function calculationChecks(doc: MasterDoc, out: Problem[]): void {
  const ask = (path: string, key: string, message: string, options: string[], needsReason = false) => askOf(doc, out, path, key, message, options, needsReason);
  const refuse = (path: string, message: string) => out.push({ level: 'error', path, message });
  const apis = doc.formula.filter((l) => l.role === 'api');
  const per = doc.header.batchUnit === 'units' ? 'unit' : 'mL';
  // A claim per container is checked against mg/mL × the nominal fill (sterile check 14), not per mL.
  const perMl = doc.header.claimPer !== 'container (filled content)';
  // (d) the API adjusted for potency at dispensing, then set again from an in-process granule or blend assay
  const atDispensing = apis.find((l) => l.adjust?.potency || (l.adjust?.content && l.adjust.content.contentSource !== 'in-process result'));
  doc.formula.forEach((l, i) => {
    const salt = l.adjust?.salt;
    // (a) the label basis for this master's market
    if (l.role === 'api' && (salt || SALT_WORD.test(l.name))) {
      const formulaForm = salt?.from.name || l.name;
      const other = salt ? salt.to.name || 'the dispensed form' : 'the base, acid or element';
      const basis = ask(`formula[${i}]`, `label-basis/${l.key}`, `Label claim for this master's market: is the strength of ${l.name} stated as ${formulaForm} or as ${other}? The formula gives ${l.mg ?? 'q.s.'} mg of ${formulaForm} per ${per}.`, [`as ${formulaForm}`, `as ${other}`]);
      if (l.labelClaim && l.mg && perMl) labelClaim(`formula[${i}].labelClaim`, l, l.labelClaim, new Dec(l.mg), basis, l.name);
    } else if (l.role === 'api') {
      if (l.labelClaim && l.mg && perMl) labelClaim(`formula[${i}].labelClaim`, l, l.labelClaim, new Dec(l.mg), `as ${l.name}`, l.name);
    }
    // A solvent-wet API weighed as if dry (F0204: about 23 % too little); answered, or corrected with the lot's solvent.
    const corrected = l.adjust?.potency?.basis === 'dried' || l.adjust?.potency?.basis === 'anhydrous and solvent-free' || l.adjust?.content?.formulaQuantityIs === 'wet';
    if (l.role === 'api' && WET.test(l.name) && !corrected) {
      ask(`formula[${i}]`, `solvent-wet/${l.key}`, `${l.name} looks solvent-wet: its quantity needs the lot's measured solvent content (an assay adjustment on the dried or solvent-free basis, or a content adjustment). Weighed as dry API it gives too little drug (F0204: about 23 %). Is it weighed dry?`, ['weighed dry'], true);
    }
    if (atDispensing && l.adjust?.content?.contentSource === 'in-process result') {
      ask(`formula[${i}].adjust`, `double-adjustment/${l.key}`, `${atDispensing.name} is adjusted for its potency at dispensing, and ${l.name} is set again from an in-process granule or blend assay (T18): the potency would be corrected twice. Confirm that this is intended, with a reason, or remove one of the adjustments.`, ['intended'], true);
    }
    // (e) a salt factor written in the formula that differs from the molecular weights by more than 0.5 %
    const t11 = salt?.factor ? t11SaltFactor({ quantity: '1 kg', from: salt.from, to: salt.to }) : undefined;
    if (salt?.factor && t11?.ok) {
      const off = new Dec(salt.factor).minus(t11.factor).abs().div(t11.factor).times(100);
      if (off.gt('0.5')) {
        ask(`formula[${i}].adjust.salt`, `salt-factor/${l.key}`, `The salt factor ${salt.factor} written for ${l.name} differs by ${off.toFixed(1, Dec.ROUND_HALF_UP)} % from the molecular weights of ${salt.from.name} and ${salt.to.name} (factor ${t11.factor.toFixed(4, Dec.ROUND_HALF_UP)}), which the batch quantity uses. Confirm with a reason, or correct the factor or the molecular weights.`, ['confirmed'], true);
      }
    }
  });
  // (c) a ratio or % in a step instruction that involves the API
  doc.stages.forEach((s, si) => s.steps.forEach((t, ti) => {
    const m = RATIO.exec(t.instruction ?? '');
    const text = (t.instruction ?? '').toLowerCase();
    const api = m && apis.find((l) => Object.values(t.settings).some((v) => typeof v === 'object' && 'formula' in v && v.formula === l.key) || text.includes(l.name.toLowerCase()));
    if (m && api) {
      ask(`stages[${si}].steps[${ti}]`, `ratio-basis/${s.key}/${t.key}`, `The instruction gives "${m[0]}" with ${api.name}: on which basis is the ${api.name} quantity taken?`, ['as weighed', 'as base', 'as anhydrous']);
    }
    const p = `stages[${si}].steps[${ti}]`;
    const block = findBlock(t.block);
    const limits = Object.entries(t.settings).filter((e): e is [string, Limit] => typeof e[1] === 'object' && 'unit' in e[1]);
    // An API lot test of particle size, surface area or crystal form needs both limits (F0490: Cmax 67.5-130 %).
    const words = Object.values(t.settings).filter((v): v is string => typeof v === 'string').join(' ') + ` ${t.instruction ?? ''}`;
    const oneSide = limits.find(([, l]) => (l.low === undefined) !== (l.high === undefined));
    if (oneSide && SIZE.test(words)) {
      ask(`${p}.settings.${oneSide[0]}`, `two-sided/${s.key}/${t.key}`, `Step ${t.key} tests particle size, surface area or crystal form with only ${oneSide[1].low === undefined ? 'an upper' : 'a lower'} limit: both sides can change the dose taken up (F0490: Cmax 67.5-130 % with the API's surface area). Confirm that one side is enough, with the reason, or add the other limit.`, ['one side is enough'], true);
    }
    // An order-critical step stays after the step it must follow (F0318: 37 % of the drug converted in the wrong order).
    if (t.orderAfter && !s.steps.slice(0, ti).some((x) => x.key === t.orderAfter)) {
      ask(p, `order/${s.key}/${t.key}`, `Step ${t.key} is order-critical: it must come after step ${t.orderAfter} in ${s.name}, and it no longer does. Put it back, or confirm the new order with the reason.`, ['new order confirmed'], true);
    }
  }));

  /** The API per tablet against a label claim (refusal), on the basis answered: the formula form, or the other form by the MWs. */
  function labelClaim(path: string, l: FormulaLine, claim: string, mg: Dec, basis: string | undefined, what: string): void {
    const q = quantityOf(claim);
    const salt = l.adjust?.salt;
    const form = salt?.from.name || l.name;
    // Per mL a claim is written "50 mg/mL" (or "50 mg" per mL); per unit "500 mg".
    if (!q || (q.u.kind !== 'mass' && q.u.kind !== 'charge' && !(q.u.kind === 'mass concentration' && per === 'mL'))) return void refuse(path, `"${claim}" is not a label claim with a unit, e.g. ${per === 'mL' ? '"50 mg/mL"' : '"500 mg"'} or "10 mEq"`);
    let expected: Dec | undefined;
    if (q.u.kind === 'charge') {
      if (!salt?.from.charge) return void refuse(path, `The label claim ${claim} is in mEq: give the salt form from the ion with its charge from the material record (F0393: 10 mEq K read as mmol of the salt is 3 times the potassium)`);
      expected = q.v.div(salt.from.charge).times(salt.from.mw);
    } else {
      const claimMg = q.u.kind === 'mass concentration' ? q.v.times(q.u.factor) : q.v.times(q.u.factor).times(1000);
      if (basis === `as ${form}`) expected = claimMg;
      else if (salt && basis === `as ${salt.to.name || 'the dispensed form'}`) expected = claimMg.times(new Dec(salt.from.mw).div(salt.from.moleculesPerUnit ?? 1)).div(new Dec(salt.to.mw).div(salt.to.moleculesPerUnit ?? 1));
    }
    if (expected && !expected.isZero() && off(mg, expected).gt('0.5')) {
      refuse(path, `${what}: ${mg.toFixed(3, Dec.ROUND_HALF_UP)} mg of ${form} per ${per} does not give the label claim ${claim} (${expected.toFixed(3, Dec.ROUND_HALF_UP)} mg of ${form}). Write the label quantity in the formula; an excess is an overage (T16), which the batch quantity adds (F0122: 22 mg in a 20 mg tablet); the fill excess is the header's, not the formula's`);
    }
  }
}

/** Whether a step setting fits its kind, and a reference points at something earlier that exists. */
function settingProblem(doc: MasterDoc, si: number, ti: number, kind: Block['settings'][number]['kind'], v: SettingValue): string | null {
  if (typeof v === 'string') {
    if (kind === 'number') return DECIMAL.test(v) ? null : `"${v}" is not a plain decimal`;
    if (kind === 'quantity') {
      const m = QUANTITY.exec(v);
      return m && findUnit(m[3] ?? '') ? null : `"${v}" is not a number with a unit from the unit list`;
    }
    return kind === 'text' ? null : `A ${kind} cannot be written as text`;
  }
  if ('unit' in v) {
    if (kind !== 'limit') return `A limit is given where a ${kind} is wanted`;
    const r = c1WithinLimits({ value: { value: '0', unit: v.unit }, limit: v });
    return r.ok ? null : r.message;
  }
  if ('formula' in v) {
    if (kind !== 'material' && kind !== 'quantity') return `A formula line is given where a ${kind} is wanted`;
    return materialLines(doc).some((l) => l.key === v.formula) ? null : `No formula line ${v.formula}`;
  }
  if ('header' in v) {
    if (kind !== 'quantity') return `A header value is given where a ${kind} is wanted`;
    const h = headerValue(doc, v.header);
    return typeof h === 'string' || h.ok ? null : h.message;
  }
  const [sk, tk, name] = v.ref.split('/') as [string, string, string];
  const ri = doc.stages.findIndex((x) => x.key === sk);
  const target = doc.stages[ri];
  const rt = target?.steps.findIndex((t) => t.key === tk) ?? -1;
  if (!target || rt < 0) return `${v.ref}: no such stage and step`;
  if (ri > si || (ri === si && rt >= ti)) return `${v.ref} comes later than this step`;
  if (ri !== si && target.kind === 'sub-batch') return `${v.ref} is inside the sub-batch stage ${target.name}: refer to it from that stage only`;
  const b = findBlock(target.steps[rt]!.block);
  const names = b ? [...b.fields, ...b.calcs].map((x) => x.name) : [];
  if (!names.includes(name)) return `${v.ref}: step ${tk} has no field or calculation ${name}`;
  return null;
}
