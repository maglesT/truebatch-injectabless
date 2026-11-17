import { PACKING_LINE, type Block } from './format.js';

// Packing, TI-P2 and TI-P7: the batch facts, recorded when the packing batch is issued (server/routes/batches.ts): the
// line (one active packing order per line), the RELEASED batch of TrueBatch Injectables whose filled, inspected units
// are packed (pulled from its batch_fact_v1 with its date of manufacture, manufactured_on: the date its first
// processing step started; or typed from the labels of its trays or cases with a second-person check, never a future
// date) and the filled units issued. The expiry comes from the date of manufacture and the approved shelf life (T27,
// TI-P8). On the floor the operator confirms receipt.
export const bulkIssue: Block = {
  id: 'bulk-issue', version: 1, name: 'Filled units issued to the line', checker: true, packing: true,
  atIssue: ['line', 'bulk', 'mfgDate', 'units'],
  instruction: 'Receive the filled units (vials, ampoules, syringes or bags) at the line. Check that each tray or case is closed and intact and that its label shows this batch number and RELEASED.',
  fields: [
    { name: 'line', label: 'Packing line', kind: 'machine', types: PACKING_LINE },
    { name: 'bulk', label: 'Batch no. of the filled units', kind: 'bulk' },
    { name: 'mfgDate', label: 'Date of manufacture of the filled units', kind: 'text', date: true },
    { name: 'units', label: 'Filled units issued', kind: 'number', unit: 'units' },
    { name: 'received', label: 'Trays or cases closed and intact, labels show this batch and RELEASED', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'expiry', label: 'Expiry date', template: 'T27', args: { manufactured: '$mfgDate', months: '$pack.shelfLifeMonths', rule: '$pack.expiryRule' } },
    { name: 'packs', label: 'Theoretical packs', template: 'T6', args: { mode: 'ratio', a: '$units', b: '$pack.unitsPerPack', unit: 'packs', decimals: 0 } },
    { name: 'receivedCheck', label: 'Filled units received', template: 'C4', args: { question: 'Trays or cases intact and labelled RELEASED', answers: ['$received'], expected: ['yes'] } },
  ],
};
