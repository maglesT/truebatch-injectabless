import type { Block } from './format.js';

// Issue of containers or closures to the batch by count (owner, 17 Nov 2026, demo finding F20), as Packing issues a
// packing material: a released MMS lot (or the lot label with a second person), the count issued and, at the end, the
// count returned unused. material_use_v1 gives MMS issued less returned, so the lot's stock goes down.
export const containerIssue: Block = {
  id: 'container-issue', version: 1, name: 'Issue containers or closures', checker: true,
  instruction: 'Issue the containers or closures shown from a released lot and count them. At the end, count what goes back to stores unused.',
  fields: [
    { name: 'lot', label: 'Lot', kind: 'lot' },
    { name: 'issued', label: 'Count issued', kind: 'number', unit: 'units' },
    { name: 'returned', label: 'Count returned to stores at the end', kind: 'number', unit: 'units', optional: true },
  ],
  settings: [
    { name: 'what', label: 'What is issued', kind: 'text', options: ['vials', 'ampoules', 'stoppers', 'seals', 'syringes', 'plungers', 'cartridges', 'bags'] },
    { name: 'expected', label: 'Units expected', kind: 'quantity' },
    { name: 'enoughLimit', label: 'Count issued, in % of the units expected', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'enough', label: 'Count issued against the units expected', template: 'T3', args: { actual: '$issued', theoretical: '$expected', limit: '$enoughLimit?' } },
  ],
};

// Version 2 (owner, 17 Nov 2026, run 2 findings G9 and G10), as Packing's issue of a packing material: the step names
// its container or closure from the master's materials (master data), so the lot is picked from MMS lots of that
// material and another material's lot is refused; what is left at the end is counted back in its own step
// (container-return), as Packing's reconciliation does, so the signed issue is never re-opened. Version 1 stays for
// the recorded batches.
export const containerIssue2: Block = {
  ...containerIssue, version: 2, title: 'Issue {material}',
  instruction: 'Issue the container or closure shown from a released lot of it and count them. What is left at the end is counted back in its own step.',
  fields: containerIssue.fields.filter((f) => f.name !== 'returned'),
  settings: [{ name: 'material', label: 'Container or closure', kind: 'material' }, ...containerIssue.settings.filter((s) => s.name !== 'what')],
};

// The count of a container or closure returned to stores unused at the end (G10), as Packing's reconciliation records
// what goes back: material_use_v1 gives MMS the count issued less this count, once this step is signed done.
export const containerReturn: Block = {
  id: 'container-return', version: 1, name: 'Count back containers or closures', checker: true, title: 'Count back {material}',
  instruction: 'At the end, count the containers or closures of this material left unused and send them back to stores. Give 0 if none are left.',
  fields: [{ name: 'returned', label: 'Count returned to stores', kind: 'number', unit: 'units' }],
  settings: [{ name: 'material', label: 'Container or closure', kind: 'material' }],
  calcs: [],
};

// Version 3 of the issue and version 2 of the count back (owner, 17 Nov 2026, aseptic blow-fill-seal): the unit is the
// master step's, as Packing's issue of a packing material: units (counted) or kg (weighed: the plastic granules a
// blow-fill-seal machine forms its containers from). material_use_v1 and the stock check take the step's unit as they
// are. Version 2 and version 1 stay for the recorded batches.
const UNIT = { name: 'unit', label: 'Unit', kind: 'text' as const, options: ['units', 'kg'] };
export const containerIssue3: Block = {
  ...containerIssue2, version: 3,
  instruction: 'Issue the container, closure or granules shown from a released lot of it; count or weigh them. What is left at the end is counted or weighed back in its own step.',
  fields: containerIssue2.fields.map((f) => (f.name === 'issued' ? { ...f, label: 'Quantity issued', unit: '$unit' } : f)),
  settings: [...containerIssue2.settings, UNIT],
};
export const containerReturn2: Block = {
  ...containerReturn, version: 2,
  instruction: 'At the end, count or weigh what is left unused of this material and send it back to stores. Give 0 if none is left.',
  fields: [{ name: 'returned', label: 'Quantity returned to stores', kind: 'number', unit: '$unit' }],
  settings: [...containerReturn.settings, UNIT],
};
