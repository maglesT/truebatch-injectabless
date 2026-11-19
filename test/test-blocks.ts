// Test-only blocks: the TrueBatch Tablets steps the engine's shared test master (engine-fixture.ts) is built from.
// They are not in the product (no injectables master can use them); the engine tests use them to exercise the same
// mechanisms as before: repeat until, periodic rounds, a later step reading an earlier result, mixing times.
// A test file that uses them adds `vi.mock('../shared/blocks/index.js', withTestBlocks)`.
import type { Block } from '../shared/blocks/format.js';

// Wet granulation to an end point (e.g. the impeller power reading).
export const granulate: Block = {
  id: 'granulate', version: 1, name: 'Granulate to an end point', checker: false,
  instruction: 'Add the binder and granulate until the end point is reached. Record the reading at the end point.',
  fields: [
    { name: 'machine', label: 'Granulator', kind: 'machine', types: ['granulat', 'rmg'] },
    { name: 'endPoint', label: 'End-point reading', kind: 'number', unit: 'kW' },
    { name: 'endPointAt', label: 'End point reached at', kind: 'timer' },
  ],
  settings: [{ name: 'endPointLimit', label: 'End-point limits', kind: 'limit' }],
  calcs: [{ name: 'endPointCheck', label: 'End point against limits', template: 'C1', args: { value: '$endPoint', limit: '$endPointLimit' } }],
};

// Dry to an LOD limit: used as repeat-until, a new round of drying until the LOD is within the limit.
export const dry: Block = {
  id: 'dry', version: 1, name: 'Dry to an LOD limit', checker: false, stop: 'lodCheck',
  instruction: 'Dry the granules, take a sample and record the loss on drying.',
  fields: [
    { name: 'machine', label: 'Dryer', kind: 'machine', types: ['dryer', 'drier', 'fbd', 'fluid bed'] },
    { name: 'inletTemp', label: 'Inlet temperature', kind: 'number', unit: '°C' },
    { name: 'lod', label: 'Loss on drying', kind: 'number', unit: '%' },
  ],
  settings: [{ name: 'lodLimit', label: 'LOD limit', kind: 'limit' }],
  calcs: [{ name: 'lodCheck', label: 'LOD against limit', template: 'C1', args: { value: '$lod', limit: '$lodLimit' } }],
};

// Compression with periodic in-process checks: one round every N minutes (at most 30, TI-15) until compression is
// finished. Each round: 20 tablet weights (T7 mean, C3 individual weights), hardness and thickness (T7).
export const compress: Block = {
  id: 'compress', version: 1, name: 'Compress with periodic checks', checker: false, stop: 'finished',
  periodic: { maxMinutes: 30 },
  instruction: 'Take 20 tablets and record their weights, then the hardness and thickness of 5 tablets.',
  fields: [
    { name: 'machine', label: 'Tablet press', kind: 'machine', types: ['press', 'compression'], notTypes: ['filter', 'compressor'] },
    { name: 'weights', label: 'Weights of 20 tablets', kind: 'number', unit: 'mg', count: 20 },
    { name: 'hardness', label: 'Hardness of 5 tablets', kind: 'number', unit: 'N', count: 5 },
    { name: 'thickness', label: 'Thickness of 5 tablets', kind: 'number', unit: 'mm', count: 5 },
    { name: 'compressionDone', label: 'Compression finished', kind: 'yes-no' },
  ],
  settings: [
    { name: 'meanLimit', label: 'Mean weight limits', kind: 'limit' },
    { name: 'weightBand', label: 'Individual weights (± % of the mean)', kind: 'number' },
    { name: 'weightOuterBand', label: 'No tablet outside (± % of the mean)', kind: 'number' },
    { name: 'hardnessLimit', label: 'Hardness limits', kind: 'limit' },
    { name: 'thicknessLimit', label: 'Thickness limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'meanWeight', label: 'Mean weight', template: 'T7', args: { readings: '$weights', limit: '$meanLimit' } },
    { name: 'individualWeights', label: 'Individual weights', template: 'C3', args: { readings: '$weights', band: { plusMinusPercent: '$weightBand', of: 'mean' }, allowedOutside: 2, outer: { plusMinusPercent: '$weightOuterBand', of: 'mean' } } },
    { name: 'meanHardness', label: 'Hardness', template: 'T7', args: { readings: '$hardness', limit: '$hardnessLimit' } },
    { name: 'meanThickness', label: 'Thickness', template: 'T7', args: { readings: '$thickness', limit: '$thicknessLimit' } },
    { name: 'finished', label: 'Compression finished', template: 'C4', args: { question: 'Compression finished', answers: ['$compressionDone'], expected: ['yes'] } },
  ],
};

// Coat to a weight gain: used as repeat-until, spraying continues in rounds until the gain on the core weight (T5)
// is within its limits.
export const coat: Block = {
  id: 'coat', version: 1, name: 'Coat to a weight gain', checker: false, stop: 'gain',
  instruction: 'Spray the coating, then weigh a sample of tablets and record the mean weight.',
  fields: [
    { name: 'machine', label: 'Coater', kind: 'machine', types: ['coat'] },
    { name: 'meanWeight', label: 'Mean weight of coated tablets', kind: 'number', unit: 'mg' },
  ],
  settings: [
    { name: 'coreWeight', label: 'Core weight', kind: 'quantity' },
    { name: 'gainLimit', label: 'Weight gain limits', kind: 'limit' },
  ],
  calcs: [{ name: 'gain', label: 'Weight gain', template: 'T5', args: { before: '$coreWeight', after: '$meanWeight', mode: 'gain', base: 'start', limit: '$gainLimit' } }],
};

// Dry mix for a time: the mixing time is the time from start to end as recorded on the server clock (T13), within
// the master's limits (too short does not mix, too long can segregate). Speed as in the mix block.
export const dryMix: Block = {
  id: 'dry-mix', version: 1, name: 'Dry mix for a time', checker: false,
  instruction: 'Load the materials, record the start, mix at the speed shown, and record the end when the time is up.',
  fields: [
    { name: 'machine', label: 'Mixer or blender', kind: 'machine', types: ['mix', 'blend', 'granulat', 'rmg'] },
    { name: 'speed', label: 'Speed', kind: 'number', unit: 'rpm' },
    { name: 'mixStart', label: 'Start of mixing', kind: 'timer' },
    { name: 'mixEnd', label: 'End of mixing', kind: 'timer' },
  ],
  settings: [
    { name: 'speedLimit', label: 'Speed limits', kind: 'limit', optional: true },
    { name: 'mixTimeLimit', label: 'Mixing time limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'speedCheck', label: 'Speed against limits', template: 'C1', args: { value: '$speed', limit: '$speedLimit' } },
    { name: 'mixTime', label: 'Mixing time', template: 'T13', args: { mode: 'duration', start: '$mixStart', end: '$mixEnd', limit: '$mixTimeLimit' } },
  ],
};

// A QC result of the batch from the QC report (TrueBatch Tablets' uniformity by weight assay): `qc`, so it is picked
// from the batch's approved CoA in LIMS while LIMS answers (no injectables block has a release-CoA result in a step).
export const qcAssay: Block = {
  id: 'qc-assay', version: 1, name: 'Assay from the QC report', checker: true,
  instruction: 'Record the assay from the QC report.',
  fields: [{ name: 'assay', label: 'Assay (% of label claim, QC report)', kind: 'number', unit: '%', qc: true }],
  settings: [{ name: 'assayLimit', label: 'Assay limits', kind: 'limit' }],
  calcs: [{ name: 'assayCheck', label: 'Assay against limits', template: 'C1', args: { value: '$assay', limit: '$assayLimit' } }],
};

// Content uniformity in two stages (TrueBatch Tablets' block, round 42): a staged in-process list from LIMS (10, then 20
// more), its figure the acceptance value. No injectables block is staged; the LIMS rules for it are tested on this one.
export const contentUniformity: Block = {
  id: 'content-uniformity', version: 1, name: 'Content uniformity sampling', checker: true,
  instruction: 'Take the units for content uniformity as the sampling plan says and send them to QC. Pick the content of each from LIMS once QC has approved it; if the first 10 do not pass and QC tested 20 more, pick those too.',
  fields: [
    { name: 'results', label: 'Content of 10 tablets (% of label claim)', kind: 'number', unit: '%', count: 10, qc: 'in_process', figure: 'AV', nextStage: 'moreResults' },
    { name: 'moreResults', label: 'Content of 20 more tablets (% of label claim)', kind: 'number', unit: '%', count: 20, optional: true, qc: 'in_process', figure: 'AV' },
  ],
  settings: [{ name: 'coating', label: 'Coating', kind: 'text', options: ['uncoated', 'film-coated', 'sugar-coated', 'other coated'] }],
  calcs: [
    { name: 'acceptance', label: 'Content uniformity', template: 'C6', args: { test: 'content uniformity', coating: '$coating', stages: ['$results', '$moreResults?'] } },
  ],
};

export const TEST_BLOCKS: Block[] = [granulate, dry, compress, coat, dryMix, qcAssay, contentUniformity];

/** The mock factory: the product's blocks plus the test blocks, found by the same findBlock. */
export async function withTestBlocks(original: () => Promise<typeof import('../shared/blocks/index.js')>) {
  const m = await original();
  const BLOCKS = [...m.BLOCKS, ...TEST_BLOCKS];
  return { ...m, BLOCKS, findBlock: (r: { id: string; version: number }) => BLOCKS.find((b) => b.id === r.id && b.version === r.version) };
}
