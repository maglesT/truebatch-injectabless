// A master in plain sentences, section by section (header, formula, each stage), for the review view and for the
// changes view against the previous version. Each line has a key, so two versions can be compared line by line.
import { findBlock } from '../../../shared/blocks/index.js';
import { masterChecks } from '../../../shared/master/checks.js';
import { batchText, HEADER_WORDS } from '../../../shared/engine/values.js';
import { fieldChanges, grouped, placeLabel } from './model.js';
import { masterSchema, materialLines, type FormulaLine, type MasterDoc, type Stage, type Step } from '../../../shared/master/schema.js';
import { perPackText, unitName } from '../../../shared/engine/stock.js';
import { stepTitle } from '../../../shared/engine/batch.js';
import { neededText } from '../../../shared/engine/training.js';
import { limitText, sentence, sentenceText, settingText, slotsOf } from './sentences.js';

export interface Line { key: string; text: string }
export interface Section { key: string; title: string; lines: Line[] }

const ROLE: Record<FormulaLine['role'], string> = { api: 'API', excipient: 'excipient', solvent: 'vehicle or solvent' };
const ROUTE: Record<NonNullable<MasterDoc['header']['route']>, string> = { terminal: 'terminal sterilisation after filling', aseptic: 'sterile filtration and aseptic processing', both: 'terminal sterilisation and aseptic processing' };

type Form = NonNullable<NonNullable<FormulaLine['adjust']>['salt']>['from'];
/** A salt form in words: "Examplol hydrochloride (MW 399.9, 1 per unit, with crystal water or solvent, ion charge 1)". */
const formText = (f: Form, or: string) => `${f.name || or} (MW ${f.mw}${f.moleculesPerUnit ? `, ${f.moleculesPerUnit} per unit` : ''}${f.hydrateOrSolvate ? ', with crystal water or solvent' : ''}${f.charge ? `, ion charge ${f.charge}` : ''})`;

function adjustText(doc: MasterDoc, l: FormulaLine): string {
  const a = l.adjust;
  if (!a) return '';
  const out: string[] = [];
  if (a.salt) out.push(`converted from the ${formText(a.salt.from, 'formula form')} to the ${formText(a.salt.to, 'dispensed form')}${a.salt.factor ? ` (salt factor written as ${a.salt.factor})` : ''}`);
  if (a.potency) out.push(`adjusted for the lot's assay on the ${a.potency.basis} basis${a.potency.assayExpressedAs ? ` (the assay expressed on the ${a.potency.assayExpressedAs})` : ''}${a.potency.standardIs ? `, the formula quantity being the ${a.potency.standardIs} weight` : ''}${a.potency.potencyAs ? `, potency stated as ${a.potency.potencyAs}` : ''}${a.potency.assayAbove100 === 'treat as 100' ? ', an assay above 100 % taken as 100 %' : a.potency.assayAbove100 === 'use' ? ', an assay above 100 % used as found' : ''}`);
  if (a.content) out.push(`adjusted for the ${a.content.contentSource === 'in-process result' ? 'in-process' : "lot's"} content${a.content.contentSource === 'certificate' ? ' from its certificate' : ''}, the formula quantity being of the ${a.content.formulaQuantityIs === 'dry' ? 'pure material' : 'material as supplied'}${a.content.nominalContent ? ` (nominal ${a.content.nominalContent} %)` : ''}${a.content.resultType ? `, the result being ${a.content.resultType === 'content' ? 'the content' : '% of theoretical'}` : ''}`);
  if (a.overage) out.push(`with ${a.overage.percent} % overage${a.overage.maxPercent ? ` (at most ${a.overage.maxPercent} %)` : ''}`);
  if (a.compensates?.length) out.push(`reduced or increased to make up for the adjusted quantity of ${a.compensates.map((k) => doc.formula.find((x) => x.key === k)?.name ?? k).join(' and ')}`);
  return `; at dispensing ${out.join(', then ')}`;
}

/** A hold time in hours, and in days when it is whole days of two or more: "720 hours (30 days)". */
const holdText = (h: number | undefined) => (h === undefined ? '(not set)' : `${h} hours${h >= 48 && h % 24 === 0 ? ` (${h / 24} days)` : ''}`);

function stageText(doc: MasterDoc, s: Stage): string {
  const kind = s.kind === 'preparation' ? 'A preparation' : s.kind === 'sub-batch' ? `Done in ${s.count ?? '?'} sub-batches` : 'A stage';
  const uses = s.uses.map((k) => doc.stages.find((x) => x.key === k)).map((x, n) => (x ? `${x.produces?.name ?? x.name} from ${x.name}` : `a stage no longer in this master (${s.uses[n]})`));
  return [`${kind}, the responsibility of the ${s.role || '(role not set)'}.`, s.aseptic ? 'Aseptic: its steps only for aseptic operators.' : '',
    `Machine types: ${s.machineTypes.join(', ') || 'any'}. Rooms: ${s.roomTypes.join(', ') || 'any'}.`,
    uses.length ? `Uses ${uses.join(' and ')}.` : '',
    s.startsAfter ? `Results that come later: starts after ${s.startsAfter.replace('/', ' › ')} is done, runs beside the next stages and closes before production signs.` : '',
    s.produces ? `Produces ${s.produces.name}, to be used within ${holdText(s.produces.holdHours)}.` : 'Produces no intermediate.'].filter(Boolean).join(' ');
}

/** Master data's units of the materials, by item id: a unit is named as master data names it when the same (nos for units). */
export type Units = ReadonlyMap<string, string>;

export function stepText(doc: MasterDoc, t: Step, j: number, units?: Units): string {
  const b = findBlock(t.block);
  if (!b) return `${j + 1}. Unknown block ${t.block.id} version ${t.block.version}.`;
  const slots = slotsOf(b);
  const m = Object.values(t.settings).find((v): v is { formula: string } => typeof v === 'object' && 'formula' in v);
  const stock = m && units?.get(materialLines(doc).find((l) => l.key === m.formula)?.materialItemId ?? '');
  const shown = (name: string) => {
    const v = t.settings[name];
    if (name === 'unit' && typeof v === 'string' && v) return unitName(v, stock);
    // A material picked from the formula by its name and code, as the floor names it (not "the batch quantity of").
    const line = b.settings.find((x) => x.name === name)?.kind === 'material' && typeof v === 'object' && 'formula' in v ? materialLines(doc).find((l) => l.key === v.formula) : undefined;
    return line ? `${line.name} (${line.code})` : settingText(doc, v);
  };
  const loose = b.settings.filter((s) => !slots.has(s.name) && t.settings[s.name] !== undefined).map((s) => `${s.label.replace(/ \(formula line\)$/, '')}: ${shown(s.name)}.`);
  const calcs = b.calcs.map((c) => sentenceText(doc, b, t.settings, sentence(b, c)));
  const flow = t.flow.kind === 'repeat-until' ? `Repeated until the check "${b.calcs.find((c) => c.name === ((t.flow.kind === 'repeat-until' && t.flow.stop) || b.stop))?.label ?? '(not chosen)'}" passes, at most ${t.flow.maxRounds ?? '?'} rounds${t.everyMinutes ? `, a round every ${t.everyMinutes} minutes` : ''}.`
    : t.flow.kind === 'optional-with-reason' ? 'Optional: it may be skipped with a reason.' : t.flow.kind === 'qa-hold' ? 'QA hold: QA releases it before the next step.' : '';
  // A round time on a step that does not repeat is still shown (the repeat-until sentence says it otherwise).
  const every = t.everyMinutes && t.flow.kind !== 'repeat-until' ? `A round every ${t.everyMinutes} minutes.` : '';
  // A step by its title as on the floor (with its material's name and code), never its internal key.
  const steps = doc.stages.find((s) => s.steps.includes(t))?.steps ?? [];
  const after = steps.findIndex((x) => x.key === t.orderAfter);
  // A block's later version is named (each version is its own description); the first one is not.
  return [`${j + 1}. ${stepTitle(doc, t)}${t.block.version > 1 ? ` (block version ${t.block.version})` : ''}: ${t.instruction ?? b.instruction}`, ...loose, ...calcs,
    `Signed by the operator${t.checker ? ' and checked by a second person' : ''}${t.waitForCheck ? '; the next step waits for the check' : ''}.`,
    t.training ? neededText(t.training, t.checker) : '',
    t.critical ? 'Critical step.' : '', t.minMinutes ? `Takes at least ${t.minMinutes} minutes.` : '', flow, every,
    t.everyMinutesLater ? `After ${t.everyMinutesLater.afterMinutes} minutes, a round every ${t.everyMinutesLater.everyMinutes} minutes.` : '',
    t.onlyIf ? `Done only when the ${HEADER_WORDS[t.onlyIf.header]} is ${limitText(t.onlyIf.limit)}; otherwise left out.` : '',
    t.orderAfter ? `Order-critical: after step ${after < 0 ? '(no longer in this stage)' : `${after + 1}. ${stepTitle(doc, steps[after]!)}`}.` : ''].filter(Boolean).join(' ');
}

/**
 * The master in sentences. `items`: also the master data item of the product and of each material (an id, so only for
 * the changes view, where it shows only when it changed: the same code and name picked as another item).
 */
export function describeMaster(doc: MasterDoc, units?: Units, { items = false } = {}): Section[] {
  const h = doc.header;
  const p = doc.pack;
  // The header lines of an injection master that a packing master shows too when it has them (it does not use them).
  const sterile: Line[] = [
    ...(h.route || h.claimPer ? [{ key: 'route', text: `${h.route ? `Made sterile by ${ROUTE[h.route]}` : 'Sterilisation route not chosen'}${h.claimPer ? `; label claim per ${h.claimPer}` : ''}.` }] : []),
    ...(h.dispensingRooms?.length ? [{ key: 'dispensing', text: `Weighed in the dispensing rooms ${h.dispensingRooms.join(', ')}.` }] : []),
  ];
  const formula: Section = { key: 'formula', title: 'Formula', lines: doc.formula.map((l) => ({ key: l.key,
    text: `${l.name} (${l.code}), ${ROLE[l.role]}: ${l.mg === undefined ? 'to volume (q.s.)' : `${l.mg} mg per ${h.batchUnit === 'units' ? 'unit' : 'mL'}`}${l.labelClaim ? ` (label claim ${l.labelClaim})` : ''}${l.batchQuantity ? ` (batch quantity written as ${l.batchQuantity})` : ''}${adjustText(doc, l)}.` })) };
  // A packing master (TI-P1) in packing words: the pack and its packing materials, no formula.
  const top: Section[] = p ? [
    { key: 'header', title: 'Pack', lines: [
      { key: 'product', text: `Pack product ${h.productCode}, ${h.productName}.` },
      { key: 'bulk', text: `Packs the filled units of ${p.bulkCode}, ${p.bulkName} (a released TrueBatch Injectables batch).` },
      { key: 'batch', text: `Standard packing batch ${Number(h.batchSize).toLocaleString('en-IN')} filled units.` },
      // The injection header a packing master does not use, shown when it has it.
      ...(h.batchUnit !== 'units' || h.densityGPerMl || h.fillVolumeMl || h.fillExcessMl ? [{ key: 'liquid', text: `Also set in the header: batch ${batchText(doc)}.` }] : []),
      ...sterile,
      { key: 'pack', text: `${p.type[0]!.toUpperCase()}${p.type.slice(1)} of ${p.unitsPerPack} ${p.unitsPerPack === 1 ? 'filled unit' : 'filled units'}; ${p.packsPerCarton} ${p.packsPerCarton === 1 ? 'pack' : 'packs'} per outer carton (shipper).` },
      { key: 'expiry', text: `Approved shelf life ${p.shelfLifeMonths} months; expiry ${p.expiryRule === 'same month' ? 'month of manufacture + shelf life' : 'month of manufacture + shelf life − 1'}.` },
      { key: 'market', text: `For ${p.destination}${p.mrp ? `; MRP Rs. ${p.mrp} per pack` : ''}.` },
      // The GTIN is shown even without serialisation: it is part of the master.
      ...(p.serialisation || p.gtin ? [{ key: 'serialisation', text: `${p.serialisation ? 'Serialisation checked' : 'No serialisation'}${p.gtin ? `; pack GTIN ${p.gtin}` : ''}.` }] : []),
    ] },
    { key: 'materials', title: 'Packing materials', lines: p.materials.map((m) => ({ key: m.key,
      text: `${m.name} (${m.code}), ${m.kind}: ${perPackText(m, units?.get(m.materialItemId))}${m.printed ? '; printed, issued with a second person and reconciled' : ''}${m.coded ? '; coded with the batch details' : ''}.` })) },
    // A packing master has no formula; one that has formula lines still shows them.
    ...(doc.formula.length ? [formula] : []),
  ] : [
    { key: 'header', title: 'Header', lines: [
      { key: 'product', text: `Product ${h.productCode}, ${h.productName}.` },
      { key: 'batch', text: `Batch ${batchText(doc)}; formula per ${h.batchUnit === 'units' ? 'unit' : 'mL'}.` },
      ...sterile,
    ] },
    formula,
  ];
  return [
    ...top,
    // The containers and closures the issue steps name (run 2, G9), only when there are some.
    ...(doc.containers?.length ? [{ key: 'containers', title: 'Containers and closures', lines: doc.containers.map((c) => ({ key: c.key,
      text: `${c.name} (${c.code}), issued by count from its MMS lots.` })) }] : []),
    // Engine change 5: the time limits (TI-17), only when there are some.
    ...(doc.timeLimits?.length ? [{ key: 'time-limits', title: 'Time limits', lines: doc.timeLimits.map((l) => ({ key: l.key,
      text: `${l.name}: at most ${l.hours} h from the ${l.from.at} of ${l.from.step.replace('/', ' › ')} to the ${l.to.at} of ${l.to.step.replace('/', ' › ')}; an overrun needs a deviation note.` })) }] : []),
    ...doc.stages.map((s, i) => ({ key: `stage:${s.key}`, title: `Stage ${i + 1}: ${s.name}`, lines: [
      { key: 'about', text: stageText(doc, s) },
      ...s.steps.map((t, j) => ({ key: t.key, text: stepText(doc, t, j, units) })),
    ] })),

    // The calculation checks the author answered (or not yet), for the checker and QA; only when there are some.
    ...[{ key: 'answers', title: 'Calculation checks', lines: masterChecks(doc).flatMap((p) => (p.question ? [{ key: p.question.key,
      text: `${placeLabel(doc, p.path)}: ${p.message} ${p.question.answer ? `Answered: ${p.question.answer.choice}${p.question.answer.reason ? `. Reason: ${p.question.answer.reason}` : ''}.` : 'Not answered yet.'}` }] : [])) }].filter((s) => s.lines.length),
    ...(items ? [{ key: 'items', title: 'Master data items', lines: [
      { key: 'product', text: `Product ${h.productCode}: master data item ${h.productItemId}.` },
      ...(p ? [{ key: 'bulk', text: `Filled units ${p.bulkCode}: master data item ${p.bulkItemId}.` }] : []),
      ...materialLines(doc).map((l) => ({ key: `item:${l.key}`, text: `${l.name} (${l.code}): master data item ${l.materialItemId}.` })),
    ] }] : []),
  ];
}

export type Change = 'same' | 'added' | 'changed' | 'removed';
export interface DiffLine extends Line { change: Change; was?: string }
export interface DiffSection { key: string; title: string; change: Change; lines: DiffLine[] }

/**
 * The changes from the previous version, line by line (by key; a step that moved shows its new number). A step whose
 * only change is its number is not changed (run 2, G3); a step moved to a newer version of its block says what it now
 * records and no longer records, which its sentence does not show.
 */
export function diffMasters(prev: MasterDoc, next: MasterDoc, units?: Units): DiffSection[] {
  const before = new Map(describeMaster(prev, units, { items: true }).map((s) => [s.key, s]));
  const after = describeMaster(next, units, { items: true });
  const unnumbered = (t: string) => t.replace(/^\d+\. /, '');
  const stepOf = (d: MasterDoc, section: string, key: string) => d.stages.find((s) => `stage:${s.key}` === section)?.steps.find((t) => t.key === key);
  const out: DiffSection[] = after.map((s) => {
    const old = before.get(s.key);
    // A section renamed (a stage's name, or its number when one is added or moved before it) is a change too.
    const title: DiffLine[] = old && old.title !== s.title ? [{ key: ':title', text: `Now called "${s.title}".`, change: 'changed', was: `"${old.title}"` }] : [];
    const lines: DiffLine[] = [...title, ...s.lines.map((l): DiffLine => {
      const was = old?.lines.find((x) => x.key === l.key)?.text;
      const a = stepOf(prev, s.key, l.key);
      const b = stepOf(next, s.key, l.key);
      const fa = a && findBlock(a.block);
      const fb = b && findBlock(b.block);
      const version = fa && fb && fa.id === fb.id && fa.version !== fb.version ? fieldChanges(fa, fb) : undefined;
      const text = version ? `${l.text} Block version ${fa!.version} → ${fb!.version}${version.added.length ? `: now also records ${version.added.join(', ')}` : ''}${version.removed.length ? `${version.added.length ? ';' : ':'} no longer records ${version.removed.join(', ')}` : ''}.` : l.text;
      const same = was !== undefined && !version && unnumbered(was) === unnumbered(l.text);
      return { ...l, text, change: was === undefined ? 'added' : same ? 'same' : 'changed', ...(was !== undefined && !same ? { was } : {}) };
    })];
    for (const l of old?.lines ?? []) if (!s.lines.some((x) => x.key === l.key)) lines.push({ ...l, change: 'removed' });
    return { key: s.key, title: s.title, change: !old ? 'added' : lines.some((l) => l.change !== 'same') ? 'changed' : 'same', lines };
  });
  for (const s of before.values()) if (!after.some((x) => x.key === s.key)) out.push({ ...s, change: 'removed', lines: s.lines.map((l) => ({ ...l, change: 'removed' })) });
  // The safety net: the two versions differ but no line above shows it (a field without a line). Never "No changes"
  // then: the changed fields are listed by their path, for the checker and QA to look at in the designer.
  if (out.every((s) => s.change === 'same')) {
    const paths = changedPaths(stored(prev), stored(next));
    if (paths.length) out.push({ key: UNDESCRIBED, title: 'Changed (not described)', change: 'changed', lines: [{ key: 'paths', text: notDescribedText(paths), change: 'changed' }] });
  }
  return out;
}

/** The key of the safety net's section in the changes view. */
export const UNDESCRIBED = 'undescribed';
/** A master as the schema reads it (the defaults filled in), so a default the stored version leaves out is no change. */
const stored = (doc: MasterDoc): unknown => { const r = masterSchema.safeParse(doc); return r.success ? r.data : doc; };
const SHOWN_PATHS = 20;
export const notDescribedText = (paths: string[]) =>
  `Changed (not described): ${paths.slice(0, SHOWN_PATHS).join(', ')}${paths.length > SHOWN_PATHS ? ` and ${paths.length - SHOWN_PATHS} more` : ''}.`;

/** The paths of the values that differ between two JSON values ("stages[1].steps[0].flow.maxRounds"); a missing key is undefined. */
export function changedPaths(a: unknown, b: unknown, at = ''): string[] {
  if (a === b) return [];
  const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (Array.isArray(a) && Array.isArray(b)) {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => changedPaths(a[i], b[i], `${at}[${i}]`)).flat();
  }
  if (object(a) && object(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => changedPaths(a[k], b[k], at ? `${at}.${k}` : k));
  }
  return [at || '(the whole master)'];
}
