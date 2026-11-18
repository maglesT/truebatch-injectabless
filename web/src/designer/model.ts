// Pure helpers of the designer over the master document: keys, units and their kinds, what an input may be picked
// from, scaling to a new batch size. No GMP maths here: numbers go through the templates library.
import { BLOCKS, blocksFor, findBlock, type Block } from '../../../shared/blocks/index.js';
import { product } from '../product.js';
import { refsIn } from '../../../shared/blocks/format.js';
import { stepTitle as title } from '../../../shared/engine/batch.js';
import { Dec, UNIT_LIST, type Kind } from '../../../shared/templates/index.js';
import type { Problem } from '../../../shared/master/checks.js';
import type { Stored } from '../../../shared/engine/index.js';
import { HEADER_VALUES, PER_UNIT_HEADERS, type MasterDoc, type SettingValue, type Stage, type Step } from '../../../shared/master/schema.js';

// The unit list as offered in pick lists: every unit of the templates' unit table (shared/templates/units.ts).
export const UNITS = UNIT_LIST;
export const unitsOf = (kind?: Kind) => UNITS.filter((u) => !kind || u.kind === kind);
export { kindOfUnit } from '../../../shared/master/kinds.js';
export const unitLabel = (s: string) => (s === '' ? 'no unit' : s);

/** A worked-out quantity as shown in the formula and the preview: 3 decimals; a mass under 0.01 kg in g, so a small
 *  excipient reads right (2.500 g, not 0.003 kg). Display only: the stored value is not changed. */
export function qtyText(r: Stored | undefined): string {
  if (!r?.ok) return '—';
  const v = new Dec(r.value);
  return r.unit === 'kg' && !v.isZero() && v.abs().lt('0.01') ? `${v.times(1000).toFixed(3)} g` : `${v.toFixed(3)} ${r.unit}`;
}

/** Whole numbers of five digits or more with Indian thousands separators, as the lists show them ("50,000 units");
 *  a number with decimals, or part of a code or date, stays as written. */
export const grouped = (text: string) => text.replace(/(?<![\w.,/-])\d{5,}(?![\w.,/-]|\.\d)/g, (n) => Number(n).toLocaleString('en-IN'));

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

/**
 * What the designer offers for a quantity setting besides "a value I type" (same rules as the master check), of the
 * kind it needs: the formula lines' batch quantities (a mass), the header values (not the batch size as written) and
 * earlier steps. Not a batch quantity (notBatch): no formula line and no batch value of the header; a value per vial or
 * container takes the header's nominal fill and fill target and earlier steps, a tolerance is typed only.
 */
export function quantityChoices(doc: MasterDoc, si: number, ti: number, kind?: Kind, notBatch?: 'tablet' | 'tolerance'): {
  lines: boolean; headers: (typeof HEADER_VALUES)[number][]; refs: RefOption[];
} {
  const fits = (k: Kind | undefined) => !kind || k === kind;
  if (notBatch === 'tolerance') return { lines: false, headers: [], refs: [] };
  return {
    lines: !notBatch && fits('mass') && doc.formula.length > 0,
    headers: HEADER_VALUES.filter((h) => fits(HEADER_LABEL[h].kind) && h !== 'batchSize' && (!notBatch || PER_UNIT_HEADERS.includes(h))),
    refs: earlierRefs(doc, si, ti).filter((r) => fits(r.kind)),
  };
}

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
  'container-issue': { expected: { header: 'units' }, unit: 'units' },
  'container-return': { unit: 'units' },
};
// The defaults a block of this version has a setting for (an older version may not have them all).
const defaultsOf = (b: Block): Step['settings'] => Object.fromEntries(Object.entries(DEFAULT_SETTINGS[b.id] ?? {}).filter(([k]) => b.settings.some((x) => x.name === k)));
/** A new step from a block, with its default instruction, signatures and settings. */
export function stepFrom(block: Block, taken: string[]): Step {
  return { key: newKey(block.id, taken), block: { id: block.id, version: block.version }, settings: defaultsOf(block), checker: block.checker,
    waitForCheck: false, critical: false, flow: block.stop ? { kind: 'repeat-until', maxRounds: block.periodic ? 200 : 10 } : block.qaHold ? { kind: 'qa-hold' } : { kind: 'none' },
    // A periodic check starts at its most allowed interval, at most every 30 min (the master may change it).
    ...(block.periodic ? { everyMinutes: Math.min(block.periodic.maxMinutes, 30) } : {}) };
}

/** What a newer version of a block records that the older does not, and what it no longer records (field labels). */
export function fieldChanges(was: Block, now: Block): { added: string[]; removed: string[] } {
  const has = (b: Block, name: string) => b.fields.some((f) => f.name === name);
  return { added: now.fields.filter((f) => !has(was, f.name)).map((f) => f.label), removed: was.fields.filter((f) => !has(now, f.name)).map((f) => f.label) };
}
/**
 * A step moved to another version of its block (run 2, G1): the settings of the same names kept, the block's defaults
 * for the new ones. A container issue's old "what" word (vials, stoppers ...) names the master's container when
 * exactly one container's name or code has it (whole-suite run, S12); else the designer picks it.
 */
export function toVersion(t: Step, b: Block, containers: MasterDoc['containers'] = []): Step {
  const kept = Object.fromEntries(Object.entries(t.settings).filter(([k]) => b.settings.some((x) => x.name === k)));
  const word = typeof t.settings.what === 'string' ? t.settings.what.toLowerCase().replace(/s$/, '') : '';
  const hits = word && b.settings.some((x) => x.name === 'material') && !kept.material
    ? (containers ?? []).filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(word)) : [];
  return { ...t, block: { id: b.id, version: b.version }, settings: { ...defaultsOf(b), ...kept, ...(hits.length === 1 ? { material: { formula: hits[0]!.key } } : {}) } };
}

export const newStage = (name: string, taken: string[]): Stage =>
  ({ key: newKey(name, taken), name, kind: 'normal', roomTypes: [], machineTypes: [], role: '', uses: [], steps: [] });

/** The latest version of each block of this product (the library offers only these for new steps). */
export const LIBRARY = blocksFor(product.packing).filter((b) => !BLOCKS.some((x) => x.id === b.id && x.version > b.version));
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

/** The products of master data this master offers: the bulk products (TrueBatch Injectables) or the packs (Packing),
 *  plus those master data gives no kind yet. */
export const ownProducts = <P extends { kind?: 'bulk' | 'pack' | null }>(products: readonly P[], kind: 'bulk' | 'pack'): P[] =>
  products.filter((p) => (p.kind ?? kind) === kind);
