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
