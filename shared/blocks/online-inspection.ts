import type { Block } from './format.js';

// Packing, TI-P5: on-line inspection of the packs' appearance and completeness, alongside the line; line samples are
// never returned to the line.
export const onlineInspection: Block = {
  id: 'online-inspection', version: 1, name: 'On-line inspection', checker: false, packing: true, stop: 'finished',
  periodic: { maxMinutes: 60, alongside: true },
  instruction: 'Take labelled units and packs from the line and inspect them.',
  fields: [
    { name: 'appearance', label: 'Packs and labels look right: the right label, straight and complete, print legible, no damage or stains', kind: 'yes-no' },
    { name: 'complete', label: 'Packs complete: every unit labelled and in place, the right count, leaflet in, nothing missing', kind: 'yes-no' },
    { name: 'samplesKept', label: 'Line samples taken out are kept aside, never returned to the line', kind: 'yes-no' },
    { name: 'packingDone', label: 'Packing of the batch is finished (end check)', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'inspection', label: 'Packs as they should be', template: 'C4', args: { question: 'Packs as they should be', answers: ['$appearance', '$complete', '$samplesKept'], expected: ['yes'] } },
    { name: 'finished', label: 'Packing finished', template: 'C4', args: { question: 'Packing finished', answers: ['$packingDone'], expected: ['yes'] } },
  ],
};
