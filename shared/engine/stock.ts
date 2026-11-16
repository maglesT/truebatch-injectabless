/**
 * What a step takes from a material lot, as the product publishes it to MMS in material_use_v1 (db/migrations/0011,
 * packing/migrations/0104), and that quantity in the lot's unit as MMS counts it. MMS shows a lot's available stock as
 * its own balance less what the TrueBatch products used (MMS D-57 to D-59); a lot is not used beyond it while MMS answers.
 */
import type { MasterDoc, Step } from '../master/schema.js';
import { Dec } from '../templates/index.js';
import type { Stored, Value } from './values.js';
import type { StepView } from './batch.js';

// The blocks whose material the other products read as used (material_use_v1 of both products).
export const MATERIAL_USE = ['weigh', 'lubricate', 'pack-material-issue'];

type Q = { value: string; unit: string };
const isQ = (v: Value | undefined): v is Q => typeof v === 'object' && !Array.isArray(v) && 'value' in v && 'unit' in v;
const material = (st: Step) => { const m = st.settings.material; return typeof m === 'object' && m !== null && 'formula' in m ? m.formula : undefined; };
const done = (v: StepView) => v.events.some((e) => e.kind === 'done');

/**
 * The quantity a step takes from its lot: the net weight of a weighing (when worked out), or the quantity of a packing
 * material issued less what its reconciliation returned to stores uncoded, once that reconciliation is signed done
 * (destroyed and batch-coded material is used, not returned). `steps`: the batch's steps, for the reconciliation.
 */
export function usedQuantity(doc: MasterDoc, st: Step, values: Record<string, Value>, results: Record<string, Stored>, steps: readonly StepView[]): Q | null {
  if (st.block.id === 'weigh' || st.block.id === 'lubricate') {
    const net = results.net;
    return net?.ok ? { value: net.value, unit: net.unit } : null;
  }
  if (st.block.id !== 'pack-material-issue') return null;
  const issued = values.issued;
  if (!isQ(issued)) return null;
  const rec = steps.find((v) => {
    const r = doc.stages[v.key.stage]?.steps[v.key.step];
    return r?.block.id === 'printed-reconciliation' && material(r) === material(st) && done(v);
  });
  const returned = rec?.values.returned;
  return isQ(returned) && returned.unit === issued.unit ? { value: new Dec(issued.value).minus(returned.value).toString(), unit: issued.unit } : issued;
}

/** The steps of a batch that have used a material lot (signed done, as material_use_v1 lists them), each with its quantity. */
export function usesOfLot(doc: MasterDoc, steps: readonly StepView[], lot: string): { step: StepView; quantity: Q }[] {
  return steps.flatMap((v) => {
    const st = doc.stages[v.key.stage]?.steps[v.key.step];
    if (!st || !MATERIAL_USE.includes(st.block.id) || !done(v) || typeof v.values.lot !== 'string' || v.values.lot.toLowerCase() !== lot.toLowerCase()) return [];
    const quantity = usedQuantity(doc, st, v.values, v.results, steps);
    return quantity ? [{ step: v, quantity }] : [];
  });
}

// As MMS counts a line in the lot's unit (D-59): units of one kind, by a power of ten, so exactly; the count names are
// one unit. Units of different kinds are never converted (MMS lists such a line and does not count it).
const UNIT: Record<string, [kind: string, power: number]> = {
  mg: ['mass', -3], g: ['mass', 0], kg: ['mass', 3],
  ml: ['volume', 0], l: ['volume', 3],
  nos: ['count', 0], no: ['count', 0], units: ['count', 0], unit: ['count', 0], pcs: ['count', 0], pieces: ['count', 0], ea: ['count', 0],
};
/** A quantity in the lot's unit, or null when its unit is not of the lot unit's kind. */
export function inLotUnit(q: Q, lotUnit: string): Dec | null {
  const from = UNIT[q.unit.trim().toLowerCase()];
  const to = UNIT[lotUnit.trim().toLowerCase()];
  if (!from || !to || from[0] !== to[0]) return null;
  return new Dec(q.value).times(new Dec(10).pow(from[1] - to[1]));
}
