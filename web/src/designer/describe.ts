// A master in plain sentences, section by section (header, formula, each stage), for the review view and for the
// changes view against the previous version. Each line has a key, so two versions can be compared line by line.
import { findBlock } from '../../../shared/blocks/index.js';
import { masterChecks } from '../../../shared/master/checks.js';
import type { FormulaLine, MasterDoc, Stage, Step } from '../../../shared/master/schema.js';
import { placeLabel } from './model.js';
import { sentence, sentenceText, settingText, slotsOf } from './sentences.js';

export interface Line { key: string; text: string }
export interface Section { key: string; title: string; lines: Line[] }

const PLACE: Record<FormulaLine['place'], string> = { intragranular: 'intragranular', extragranular: 'extragranular', binder: 'in the binder solution', coating: 'coating' };
const ROLE: Record<FormulaLine['role'], string> = { api: 'API', excipient: 'excipient', solvent: 'solvent, removed in processing' };

function adjustText(doc: MasterDoc, l: FormulaLine): string {
  const a = l.adjust;
  if (!a) return '';
  const out: string[] = [];
  if (a.salt) out.push(`converted from the ${a.salt.from.name || 'formula form'} (MW ${a.salt.from.mw}${a.salt.from.moleculesPerUnit ? `, ${a.salt.from.moleculesPerUnit} per unit` : ''}) to the ${a.salt.to.name || 'dispensed form'} (MW ${a.salt.to.mw}${a.salt.to.moleculesPerUnit ? `, ${a.salt.to.moleculesPerUnit} per unit` : ''}${a.salt.to.hydrateOrSolvate ? ', with crystal water or solvent' : ''}${a.salt.factor ? `; salt factor written as ${a.salt.factor}` : ''})`);
  if (a.potency) out.push(`adjusted for the lot's assay on the ${a.potency.basis} basis${a.potency.standardIs ? `, the formula quantity being the ${a.potency.standardIs} weight` : ''}${a.potency.potencyAs ? `, potency stated as ${a.potency.potencyAs}` : ''}${a.potency.assayAbove100 === 'treat as 100' ? ', an assay above 100 % taken as 100 %' : ''}`);
  if (a.content) out.push(`adjusted for the ${a.content.contentSource === 'in-process result' ? 'in-process' : "lot's"} content, the formula quantity being of the ${a.content.formulaQuantityIs === 'dry' ? 'pure material' : 'material as supplied'}${a.content.nominalContent ? ` (nominal ${a.content.nominalContent} %)` : ''}${a.content.resultType ? `, the result being ${a.content.resultType === 'content' ? 'the content' : '% of theoretical'}` : ''}`);
  if (a.overage) out.push(`with ${a.overage.percent} % overage${a.overage.maxPercent ? ` (at most ${a.overage.maxPercent} %)` : ''}`);
  if (a.compensates?.length) out.push(`reduced or increased to make up for the adjusted quantity of ${a.compensates.map((k) => doc.formula.find((x) => x.key === k)?.name ?? k).join(' and ')}`);
  return `; at dispensing ${out.join(', then ')}`;
}

function stageText(doc: MasterDoc, s: Stage): string {
  const kind = s.kind === 'preparation' ? 'A preparation' : s.kind === 'sub-batch' ? `Done in ${s.count ?? '?'} sub-batches` : 'A stage';
  const uses = s.uses.map((k) => doc.stages.find((x) => x.key === k)).filter(Boolean).map((x) => `${x!.produces?.name ?? x!.name} from ${x!.name}`);
  return [`${kind}, the responsibility of the ${s.role || '(role not set)'}.`,
    `Machine types: ${s.machineTypes.join(', ') || 'any'}. Rooms: ${s.roomTypes.join(', ') || 'any'}.`,
    uses.length ? `Uses ${uses.join(' and ')}.` : '',
    s.produces ? `Produces ${s.produces.name}, to be used within ${s.produces.holdHours ?? '(not set)'} hours.` : 'Produces no intermediate.'].filter(Boolean).join(' ');
}

export function stepText(doc: MasterDoc, t: Step, j: number): string {
  const b = findBlock(t.block);
  if (!b) return `${j + 1}. Unknown block ${t.block.id}.`;
  const slots = slotsOf(b);
  const loose = b.settings.filter((s) => !slots.has(s.name) && t.settings[s.name] !== undefined).map((s) => `${s.label}: ${settingText(doc, t.settings[s.name])}.`);
  const calcs = b.calcs.map((c) => sentenceText(doc, b, t.settings, sentence(b, c)));
  const flow = t.flow.kind === 'repeat-until' ? `Repeated until the check "${b.calcs.find((c) => c.name === ((t.flow.kind === 'repeat-until' && t.flow.stop) || b.stop))?.label ?? '(not chosen)'}" passes, at most ${t.flow.maxRounds ?? '?'} rounds${t.everyMinutes ? `, a round every ${t.everyMinutes} minutes` : ''}.`
    : t.flow.kind === 'optional-with-reason' ? 'Optional: it may be skipped with a reason.' : t.flow.kind === 'qa-hold' ? 'QA hold: QA releases it before the next step.' : '';
  return [`${j + 1}. ${b.name} (${t.key}): ${t.instruction ?? b.instruction}`, ...loose, ...calcs,
    `Signed by the operator${t.checker ? ' and checked by a second person' : ''}${t.waitForCheck ? '; the next step waits for the check' : ''}.`,
    t.critical ? 'Critical step.' : '', t.minMinutes ? `Takes at least ${t.minMinutes} minutes.` : '', flow,
    t.everyMinutesLater ? `After ${t.everyMinutesLater.afterMinutes} minutes, a round every ${t.everyMinutesLater.everyMinutes} minutes.` : '',
    t.onlyIf ? `Done only when the ${t.onlyIf.header === 'batchSize' ? 'batch size' : 'core batch weight'} is ${t.onlyIf.limit.low ? `at least ${t.onlyIf.limit.low}` : ''}${t.onlyIf.limit.low && t.onlyIf.limit.high ? ' and ' : ''}${t.onlyIf.limit.high ? `at most ${t.onlyIf.limit.high}` : ''} ${t.onlyIf.limit.unit}; otherwise left out.` : '',
    t.orderAfter ? `Order-critical: after step ${t.orderAfter}.` : '',
    t.applyPerCharge ? `Apply ${t.applyPerCharge.liquid} of the liquid per ${t.applyPerCharge.charge} charged, then stop.` : ''].filter(Boolean).join(' ');
}

export function describeMaster(doc: MasterDoc): Section[] {
  const h = doc.header;
  return [
    { key: 'header', title: 'Header', lines: [
      { key: 'product', text: `Product ${h.productCode}, ${h.productName}.` },
      { key: 'batch', text: `Batch size ${h.batchSize} tablets.` },
      { key: 'weights', text: `Theoretical core weight ${h.coreWeightMg} mg per tablet${h.coatedWeightMg ? `; coated weight ${h.coatedWeightMg} mg` : '; uncoated'}${h.dieAreaMm2 ? `; die bore area ${h.dieAreaMm2} mm²` : ''}.` },
      ...(h.dispensingRooms?.length ? [{ key: 'dispensing', text: `Weighed in the dispensing rooms ${h.dispensingRooms.join(', ')}.` }] : []),
      ...(h.otherStrengths ?? []).map((x, n) => ({ key: `strength:${n}`, text: `Also compressed from the same blend: ${x.name}, label claim ${x.labelClaim}, core weight ${x.coreWeightMg} mg.` })),
    ] },
    { key: 'formula', title: 'Formula', lines: doc.formula.map((l) => ({ key: l.key,
      text: `${l.name} (${l.code}), ${ROLE[l.role]}, ${PLACE[l.place]}${l.place === 'coating' ? ` layer ${l.layer ?? 1}` : ''}: ${l.mgPerTablet} mg per tablet${l.labelClaim ? ` (label claim ${l.labelClaim})` : ''}${l.batchQuantity ? ` (batch quantity written as ${l.batchQuantity})` : ''}${adjustText(doc, l)}.` })) },
    ...doc.stages.map((s, i) => ({ key: `stage:${s.key}`, title: `Stage ${i + 1}: ${s.name}`, lines: [
      { key: 'about', text: stageText(doc, s) },
      ...s.steps.map((t, j) => ({ key: t.key, text: stepText(doc, t, j) })),
    ] })),

    // The calculation checks the author answered (or not yet), for the checker and QA; only when there are some.
    ...[{ key: 'answers', title: 'Calculation checks', lines: masterChecks(doc).flatMap((p) => (p.question ? [{ key: p.question.key,
      text: `${placeLabel(doc, p.path)}: ${p.message} ${p.question.answer ? `Answered: ${p.question.answer.choice}${p.question.answer.reason ? `. Reason: ${p.question.answer.reason}` : ''}.` : 'Not answered yet.'}` }] : [])) }].filter((s) => s.lines.length),
  ];
}

export type Change = 'same' | 'added' | 'changed' | 'removed';
export interface DiffLine extends Line { change: Change; was?: string }
export interface DiffSection { key: string; title: string; change: Change; lines: DiffLine[] }

/** The changes from the previous version, line by line (by key; a step that moved shows its new number). */
export function diffMasters(prev: MasterDoc, next: MasterDoc): DiffSection[] {
  const before = new Map(describeMaster(prev).map((s) => [s.key, s]));
  const after = describeMaster(next);
  const out: DiffSection[] = after.map((s) => {
    const old = before.get(s.key);
    const lines: DiffLine[] = s.lines.map((l) => {
      const was = old?.lines.find((x) => x.key === l.key)?.text;
      return { ...l, change: was === undefined ? 'added' : was === l.text ? 'same' : 'changed', ...(was !== undefined && was !== l.text ? { was } : {}) };
    });
    for (const l of old?.lines ?? []) if (!s.lines.some((x) => x.key === l.key)) lines.push({ ...l, change: 'removed' });
    return { key: s.key, title: s.title, change: !old ? 'added' : lines.some((l) => l.change !== 'same') ? 'changed' : 'same', lines };
  });
  for (const s of before.values()) if (!after.some((x) => x.key === s.key)) out.push({ ...s, change: 'removed', lines: s.lines.map((l) => ({ ...l, change: 'removed' })) });
  return out;
}
