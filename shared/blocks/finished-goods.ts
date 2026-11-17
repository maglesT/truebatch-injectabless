import type { Block } from './format.js';

// Packing, TI-P2 and TI-P6: the finished goods quantity, and the reconciliation of the filled units issued: the units
// in good packs and in samples (packs × units per pack, T8), the good units returned and the units rejected, counted
// (filled containers are counted, never weighed), the yield in packs (T3) and the accountability of every unit
// issued (T4). Always checked.
export const finishedGoods: Block = {
  id: 'finished-goods', version: 1, name: 'Finished goods and reconciliation of filled units', gmp: 'yield', checker: true, packing: true,
  instruction: 'Count the good packs in finished cartons and the packs taken as samples. Count the good filled units returned and the units rejected on the line.',
  fields: [
    { name: 'packs', label: 'Good packs in finished cartons', kind: 'number', unit: 'packs' },
    { name: 'cartons', label: 'Finished cartons', kind: 'number', unit: 'nos' },
    // packing_batch_v1.shippers: MMS takes it when stores receive the packed batch (whole-suite run, S26: the label says
    // so, as stores asked for the count again). Only the words changed, so the same version.
    { name: 'shippers', label: 'Shippers (outer cases; MMS takes this count at receipt)', kind: 'number', unit: 'nos', optional: true },
    { name: 'samples', label: 'Packs taken as reserve and QC samples', kind: 'number', unit: 'packs' },
    { name: 'returned', label: 'Good filled units returned (not packed)', kind: 'number', unit: 'units' },
    { name: 'rejects', label: 'Filled units rejected on the line (damaged, mislabelled)', kind: 'number', unit: 'units' },
  ],
  settings: [
    { name: 'yieldLimit', label: 'Yield limits (packs)', kind: 'limit' },
    { name: 'accountabilityLimit', label: 'Accountability limits (filled units)', kind: 'limit' },
  ],
  calcs: [
    { name: 'packed', label: 'Units in good packs', template: 'T8', args: { mode: 'per unit', perUnit: '$pack.unitsPerPack', count: '$packs' } },
    { name: 'sampled', label: 'Units in samples', template: 'T8', args: { mode: 'per unit', perUnit: '$pack.unitsPerPack', count: '$samples' } },
    { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$packs', theoretical: '$batch.packs', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability of the filled units issued', template: 'T4', args: { input: '$batch.units',
      parts: [{ name: 'in packs', value: '$packed' }, { name: 'samples', value: '$sampled' }, { name: 'returned', value: '$returned' }, { name: 'rejects', value: '$rejects' }],
      limit: '$accountabilityLimit' } },
  ],
};
