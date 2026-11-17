import { masterSchema, type MasterDoc, type Pack } from '../shared/master/schema.js';
import { packingStages } from '../web/src/designer/skeletons.js';

// An invented pack: Examplocin 1 g injection, the filled and inspected vials of TrueBatch Injectables' product PRD-001,
// labelled and packed 10 vials to a carton with a tray and a leaflet, 10 cartons per shipper, for India domestic (MRP
// Rs. 125.00), shelf life 24 months. Its process is the designer's packing skeleton with the product's limits filled in.
export const GTIN = '08901234567890';
export const pack = (x: Partial<Pack> = {}): Pack => ({
  bulkItemId: 'prd-1', bulkCode: 'PRD-001', bulkName: 'Examplocin 1 g injection (filled vials)', type: 'carton', unitsPerPack: 10, packsPerCarton: 10, shelfLifeMonths: 24,
  expiryRule: 'month before', destination: 'India domestic', mrp: '125.00', serialisation: false,
  materials: [
    { key: 'label', materialItemId: 'pm-lbl', code: 'PM-101', name: 'Vial label', kind: 'label', printed: true, coded: true, perPack: '10', unit: 'units' },
    { key: 'tray', materialItemId: 'pm-try', code: 'PM-102', name: 'Vial tray', kind: 'tray', printed: false, coded: false, perPack: '1', unit: 'units' },
    { key: 'carton', materialItemId: 'pm-ctn', code: 'PM-103', name: 'Carton', kind: 'carton', printed: true, coded: true, perPack: '1', unit: 'units' },
    { key: 'leaflet', materialItemId: 'pm-lft', code: 'PM-104', name: 'Leaflet', kind: 'leaflet', printed: true, coded: false, perPack: '1', unit: 'units' },
  ],
  ...x,
});

/** The packing master: the skeleton for the pack, its limits set. */
export function packing(x: Partial<Pack> = {}): MasterDoc {
  const p = pack(x);
  const stages = packingStages(p);
  for (const s of stages) for (const t of s.steps) {
    if (t.block.id === 'forming-check') t.settings.sealLimit = { low: '160', high: '190', unit: '°C' };
    if (t.block.id === 'leak-test') t.settings.vacuumLimit = { low: '400', high: '600', unit: 'mbar' };
    if (t.block.id === 'bulk-issue') t.checker = true;
  }
  stages[0]!.machineTypes = ['labelling line'];
  return masterSchema.parse({ header: { productItemId: 'pk-1', productCode: 'PK-001', productName: 'Examplocin 1 g injection, 10 vials per carton', batchSize: '10000', batchUnit: 'units' },
    formula: [], stages, pack: p });
}

/** A valid GS1 code of this batch. */
export const code = (serial: string, batch = 'TI260001', expiry = '281031', gtin = GTIN) => `(01)${gtin}(17)${expiry}(10)${batch}(21)${serial}`;
