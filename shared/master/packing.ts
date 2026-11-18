/**
 * Packing master checks (TrueBatch Injectables Packing, docs/rules.md TI-P1 to TI-P9): what a packing master must hold
 * before it can be approved. Each problem is an error. The formula, calculation and sterile checks do not apply to it.
 */
import { findBlock, GENERAL_BLOCKS } from '../blocks/index.js';
import type { Problem } from './checks.js';
import type { MasterDoc, Stage, Step } from './schema.js';

interface At { s: Stage; si: number; t: Step; ti: number; path: string }
const SERIAL = ['vision-challenge', 'serial-received', 'serial-sample', 'serial-reconciliation'];
const nameOf = (id: string) => findBlock({ id, version: 1 })?.name.toLowerCase() ?? id;
const material = (x: At | undefined, key = 'material') => { const v = x?.t.settings[key]; return typeof v === 'object' && 'formula' in v ? v.formula : undefined; };

export function packingChecks(doc: MasterDoc): Problem[] {
  const out: Problem[] = [];
  const p = doc.pack;
  if (!p) return out;
  const error = (path: string, message: string, rule: string) => out.push({ level: 'error', path, message, rule });
  const steps: At[] = doc.stages.flatMap((s, si) => s.steps.map((t, ti) => ({ s, si, t, ti, path: `stages[${si}].steps[${ti}]` })));
  const of = (id: string) => steps.filter((x) => x.t.block.id === id);
  const pos = (x: At) => x.si * 1000 + x.ti;
  const refTo = (x: At, setting: string) => {
    const v = x.t.settings[setting];
    const [sk, tk, name] = (typeof v === 'object' && 'ref' in v ? v.ref : '').split('/');
    return { at: steps.find((y) => y.s.key === sk && y.t.key === tk), name };
  };

  // TI-P1: the pack, its materials and where the batch coding goes.
  if (doc.formula.length) error('formula', 'A packing master has no formula: its materials are the packing materials', 'TI-P1');
  if (!p.materials.length) error('pack.materials', 'The packing master lists no packing materials', 'TI-P1');
  else if (!p.materials.some((m) => m.coded)) error('pack.materials', 'No packing material carries the batch coding: mark the materials the batch number, dates and MRP are printed on', 'TI-P1');
  p.materials.forEach((m, i) => p.materials.findIndex((x) => x.key === m.key) !== i && error(`pack.materials[${i}]`, `The key ${m.key} is used twice`, 'TI-P1'));
  if (p.destination === 'India domestic' && !p.mrp) error('pack.mrp', 'A pack for India domestic needs its MRP: it is printed on the pack and checked', 'TI-P9');
  if (p.serialisation && !p.gtin) error('pack.gtin', 'Checking serialisation needs the pack GTIN', 'TI-P5');
  for (const x of steps) {
    const b = findBlock(x.t.block);
    if (b && !b.packing && !GENERAL_BLOCKS.includes(b.id)) error(x.path, `${b.name} is an injectables manufacturing step: a packing master uses the packing steps`, 'TI-P1');
  }

  // TI-P2: the record starts from the released bulk batch.
  if (doc.stages[0]?.steps[0]?.block.id !== 'bulk-issue') error('stages', 'The packing record starts with the filled units issued to the line: it links the record to the released batch of TrueBatch Injectables', 'TI-P2');
  of('bulk-issue').slice(1).forEach((x) => error(x.path, 'The filled units are issued once, as the first step', 'TI-P2'));

  // TI-P3: line clearance before and after; a blister pack formed, sealed and leak tested.
  const setup = of('line-setup')[0];
  if (!of('pack-clearance').some((c) => !setup || pos(c) < pos(setup))) error('stages', 'Line clearance before packing is missing, or comes after the line set-up', 'TI-P3');
  if (doc.stages.at(-1)?.steps.at(-1)?.block.id !== 'pack-clearance-after') error('stages', 'The packing record ends with line clearance after packing', 'TI-P3');
  if (p.type === 'blister') for (const id of ['forming-check', 'leak-test']) if (!of(id).length) error('stages', `A ${p.type} pack needs the ${nameOf(id)} step`, 'TI-P3');

  // TI-P4: every material issued before the line set-up, and the components checked against this master there.
  if (!setup) error('stages', 'The line set-up and component check is missing', 'TI-P4');
  p.materials.forEach((m, i) => {
    const issue = of('pack-material-issue').find((x) => material(x) === m.key);
    if (!issue) error(`pack.materials[${i}]`, `${m.name} has no issue step`, 'TI-P4');
    else if (setup && pos(issue) > pos(setup)) error(issue.path, `${m.name} is issued after the line set-up`, 'TI-P4');
    if (m.printed && !of('printed-reconciliation').some((x) => material(x) === m.key)) error(`pack.materials[${i}]`, `The printed ${m.name} has no reconciliation step`, 'TI-P6');
    // Its steps count in the material's unit (a unit changed after the steps were added left them in the old one).
    for (const x of [...of('pack-material-issue'), ...of('printed-reconciliation')].filter((y) => material(y) === m.key && y.t.settings.unit !== m.unit)) {
      error(`${x.path}.settings.unit`, `${m.name} is counted in ${m.unit} in the packing materials, but this step in ${String(x.t.settings.unit)}: make them the same`, 'TI-P4');
    }
  });

  // TI-P5: coding checked at the start and at intervals; packs inspected on line.
  if (!of('coding-check').length) error('stages', 'The coding check (at the start and at intervals) is missing', 'TI-P5');
  if (!of('online-inspection').length) error('stages', 'The on-line inspection is missing', 'TI-P5');

  // TI-P6: finished goods and filled units reconciled, every printed material reconciled from its own issue, coded
  // leftovers destroyed; the checks alongside the line end before the reconciliation.
  const finish = of('finished-goods');
  if (!finish.length) error('stages', 'The finished goods and reconciliation of filled units step is missing', 'TI-P6');
  if (p.materials.some((m) => m.coded) && !of('destruction').length) error('stages', 'Batch-coded leftovers need the destruction step', 'TI-P6');
  for (const x of of('printed-reconciliation')) {
    const r = refTo(x, 'issued');
    if (r.at?.t.block.id !== 'pack-material-issue' || r.name !== 'issued' || material(r.at) !== material(x)) error(`${x.path}.settings.issued`, 'The quantity issued comes from the issue step of the same material', 'TI-P6');
  }
  for (const x of steps) {
    if (findBlock(x.t.block)?.periodic?.alongside && finish.some((f) => f.si <= x.si)) error(x.path, `${findBlock(x.t.block)!.name} runs alongside the line: put it in a stage before the finished goods`, 'TI-P6');
  }

  // Serialisation (optional per product): checked, never generated.
  for (const id of SERIAL) {
    const has = of(id).length > 0;
    if (p.serialisation && !has) error('stages', `Serialisation is checked for this pack: the ${nameOf(id)} step is missing`, 'TI-P5');
    if (!p.serialisation && has && id !== 'vision-challenge') error(of(id)[0]!.path, `Serialisation is not checked for this pack: remove the ${nameOf(id)} step, or switch serialisation on`, 'TI-P1');
  }
  for (const x of of('serial-reconciliation')) {
    const r = refTo(x, 'received');
    if (r.at?.t.block.id !== 'serial-received' || r.name !== 'received') error(`${x.path}.settings.received`, 'The serial numbers received come from the serial numbers received step', 'TI-P5');
  }
  return out;
}
