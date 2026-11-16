// Pure helpers of the designer over the master document: keys, units and their kinds, what an input may be picked
// from, scaling to a new batch size. No GMP maths here: numbers go through the templates library.
import { BLOCKS, findBlock, type Block } from '../../../shared/blocks/index.js';
import { refsIn } from '../../../shared/blocks/format.js';
import { stepTitle as title } from '../../../shared/engine/batch.js';
import { Dec, findUnit, type Kind } from '../../../shared/templates/index.js';
import type { Problem } from '../../../shared/master/checks.js';
import type { HEADER_VALUES, MasterDoc, SettingValue, Stage, Step } from '../../../shared/master/schema.js';

// The unit list as offered in pick lists (shared/templates/units.ts holds the same symbols with their kinds).
const SYMBOLS = ['', 'units', 'tablets', 'µg', 'mg', 'g', 'kg', 'µL', 'mL', 'L', 'm³', 'µm', 'mm', 'cm', 'm', 'mm²', 'cm²', 's', 'min', 'h', 'd',
  '°C', 'K', 'Δ°C', 'N', 'kN', 'kp', 'Pa', 'hPa', 'kPa', 'MPa', 'bar', 'mbar', 'psi', 'mmHg', '%', '%w/w', 'ppm', 'µg/mg', 'mg/g', '%w/v', 'mg/mL',
  'g/L', 'g/mL', 'g/cm³', 'rpm', '°', 'mg/cm²', 'g/h', 'g/min', 'kg/h', 'mL/min', 'L/min', 'm³/h', 'tablets/min', 'mA', 'A', 'W', 'kW', 'kWh/kg',
  '%RH', 'g/kg', 'IU', 'CFU', 'U', 'IU/g', 'IU/mg', 'CFU/g', 'U/mg'];
export const UNITS = SYMBOLS.filter((s) => findUnit(s)).map((s) => ({ symbol: s, kind: findUnit(s)!.kind }));
export const unitsOf = (kind?: Kind) => UNITS.filter((u) => !kind || u.kind === kind);
export { kindOfUnit } from '../../../shared/master/kinds.js';
export const unitLabel = (s: string) => (s === '' ? 'no unit' : s);

/** A new key, unique among the given ones: "weigh", "weigh-2" … */
export function newKey(base: string, taken: string[]): string {
  const b = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'item';
  let k = b;
  for (let i = 2; taken.includes(k); i++) k = `${b}-${i}`;
  return k;
}

export const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

export { kindOf, neededKind, CHECKS } from '../../../shared/master/kinds.js';
import { kindOf, kindOfUnit, CHECKS } from '../../../shared/master/kinds.js';

export interface RefOption { ref: string; label: string; kind: Kind | undefined }
/** Earlier steps' recorded numbers and worked-out values this step may use (same rules as the master check). */
export function earlierRefs(doc: MasterDoc, si: number, ti: number): RefOption[] {
  const out: RefOption[] = [];
  doc.stages.forEach((s, i) => {
    if (i > si || (i !== si && s.kind === 'sub-batch')) return;
    s.steps.forEach((t, j) => {
      if (i === si && j >= ti) return;
      const b = findBlock(t.block);
      if (!b) return;
      const where = `${s.name} › ${stepTitle(doc, t, j)}`;
      for (const f of b.fields) if (f.kind === 'number' && !f.count) out.push({ ref: `${s.key}/${t.key}/${f.name}`, label: `${where} › ${f.label} (recorded)`, kind: kindOf(b, f.name, t.settings) });
      for (const c of b.calcs) if (!CHECKS.test(c.template)) out.push({ ref: `${s.key}/${t.key}/${c.name}`, label: `${where} › ${c.label} (worked out)`, kind: kindOf(b, c.name, t.settings) });
    });
  });
  return out;
}

export const HEADER_LABEL: Record<(typeof HEADER_VALUES)[number], { label: string; kind: Kind }> = {
  batchSize: { label: 'the batch size as written', kind: 'volume' },
  batchVolume: { label: 'the batch volume (L)', kind: 'volume' },
  batchMass: { label: 'the batch mass (kg, by the density)', kind: 'mass' },
  units: { label: 'the expected units', kind: 'count' },
  fillVolume: { label: 'the nominal fill (mL)', kind: 'volume' },
  fillTarget: { label: 'the fill target (fill + excess, mL)', kind: 'volume' },
  density: { label: 'the density (g/mL)', kind: 'density' },
};

export const stepTitle = (doc: MasterDoc, t: Step, j?: number) => `${j === undefined ? '' : `${j + 1}. `}${title(doc, t)}`;

// Settings a new step starts with (the author may change them): the usual dispensing tolerance.
const DEFAULT_SETTINGS: Record<string, Step['settings']> = { weigh: { tolerance: '0.5' },
  // Injectables: pulled from the liquid header, never typed (engine change 1).
  fill: { fillTarget: { header: 'fillTarget' }, density: { header: 'density' } },
  'make-up': { volume: { header: 'batchVolume' }, density: { header: 'density' }, tolerance: '0.5' },
  'unit-reconcile': { theoretical: { header: 'units' } },
};
/** A new step from a block, with its default instruction, signatures and settings. */
export function stepFrom(block: Block, taken: string[]): Step {
  return { key: newKey(block.id, taken), block: { id: block.id, version: block.version }, settings: { ...DEFAULT_SETTINGS[block.id] }, checker: block.checker,
    waitForCheck: false, critical: false, flow: block.stop ? { kind: 'repeat-until', maxRounds: block.periodic ? 200 : 10 } : block.qaHold ? { kind: 'qa-hold' } : { kind: 'none' },
    // A periodic check starts at its most allowed interval, at most every 30 min (the master may change it).
    ...(block.periodic ? { everyMinutes: Math.min(block.periodic.maxMinutes, 30) } : {}) };
}

export const newStage = (name: string, taken: string[]): Stage =>
  ({ key: newKey(name, taken), name, kind: 'normal', roomTypes: [], machineTypes: [], role: '', uses: [], steps: [] });

/** The latest version of each block of this product (the library offers only these for new steps). */
export const LIBRARY = BLOCKS.filter((b) => !BLOCKS.some((x) => x.id === b.id && x.version > b.version));
/** Blocks found by plain words in their name, instruction, fields and settings. */
export function searchBlocks(q: string): Block[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return LIBRARY.filter((b) => {
    const text = [b.name, b.instruction, ...b.fields.map((f) => f.label), ...b.settings.map((s) => s.label)].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

const QUANTITY = /^(\d+(?:\.(\d+))?)\s*(\S.*)$/;
/** "Copy to a new batch size": typed quantities of mass or count in step settings scale with the batch size. */
export function scaleDoc(doc: MasterDoc, batchSize: string): MasterDoc {
  if (doc.header.batchSize === batchSize || !/^[1-9]\d*$/.test(batchSize)) return { ...doc, header: { ...doc.header, batchSize } };
  const factor = new Dec(batchSize).div(doc.header.batchSize);
  const scale = (v: SettingValue, kind: string | undefined): SettingValue => {
    const m = typeof v === 'string' && kind === 'quantity' ? QUANTITY.exec(v.trim()) : null;
    const k = m ? kindOfUnit(m[3]) : undefined;
    if (!m || (k !== 'mass' && k !== 'count')) return v;
    return `${new Dec(m[1]!).times(factor).toFixed(m[2]?.length ?? 0, Dec.ROUND_HALF_UP)} ${m[3]}`;
  };
  return {
    ...doc,
    header: { ...doc.header, batchSize },
    stages: doc.stages.map((s) => ({ ...s, steps: s.steps.map((t) => {
      const b = findBlock(t.block);
      return { ...t, settings: Object.fromEntries(Object.entries(t.settings).map(([n, v]) => [n, scale(v, b?.settings.find((x) => x.name === n)?.kind)])) };
    }) })),
  };
}

/** Where a master-check path points: the tab and the item to select. */
export interface Place { tab: 'header' | 'formula' | 'process'; line?: number; stage?: number; step?: number }
export function placeOf(path: string): Place {
  const n = (re: RegExp) => { const m = re.exec(path); return m ? Number(m[1]) : undefined; };
  if (path.startsWith('header')) return { tab: 'header' };
  if (path.startsWith('formula')) return { tab: 'formula', line: n(/^formula\[(\d+)\]/) };
  return { tab: 'process', stage: n(/^stages\[(\d+)\]/), step: n(/\.steps\[(\d+)\]/) };
}

/** A short label for a master-check path: "Granulation › 3. Charge a material". */
export function placeLabel(doc: MasterDoc, path: string): string {
  const p = placeOf(path);
  if (p.tab === 'header') return 'Header';
  if (p.tab === 'formula') return p.line === undefined ? 'Formula' : `Formula › ${doc.formula[p.line]?.name || `line ${p.line + 1}`}`;
  const s = p.stage === undefined ? undefined : doc.stages[p.stage];
  if (!s) return 'Process';
  const t = p.step === undefined ? undefined : s.steps[p.step];
  return t ? `${s.name} › ${stepTitle(doc, t, p.step)}` : s.name;
}

/** The author's answer to a calculation warning, kept in the master document with the warning as answered. */
export function answerDoc(doc: MasterDoc, p: Problem, choice: string, reason: string): MasterDoc {
  if (!p.question) return doc;
  return { ...doc, answers: { ...doc.answers, [p.question.key]: { about: p.message, choice, reason: reason.trim() } } };
}
