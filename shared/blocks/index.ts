/** The block library: each block is a description file; a new block (or a new version of one) is a new file here. */
import type { Block } from './format.js';
import * as common from './common.js';
import * as special from './special.js';
import { binderSolution } from './binder-solution.js';
import { blendUniformity } from './blend-uniformity.js';
import { charge } from './charge.js';
import { check } from './check.js';
import { coat } from './coat.js';
import { coatingSuspension } from './coating-suspension.js';
import { compress } from './compress.js';
import { compressionRelease } from './compression-release.js';
import { contentUniformity } from './content-uniformity.js';
import { densityFlow } from './density-flow.js';
import { disintegration } from './disintegration.js';
import { dryConstant } from './dry-constant.js';
import { dryMix } from './dry-mix.js';
import { dry } from './dry.js';
import { friability } from './friability.js';
import { granulate } from './granulate.js';
import { lineClearance } from './line-clearance.js';
import { lubricate } from './lubricate.js';
import { mix } from './mix.js';
import { polishPrint } from './polish-print.js';
import { pressSetup } from './press-setup.js';
import { punchDieCheck } from './punch-die-check.js';
import { qaSample } from './qa-sample.js';
import { sieveAnalysis } from './sieve-analysis.js';
import { sieve } from './sieve.js';
import { sift } from './sift.js';
import { sprayCoat } from './spray-coat.js';
import { stageYield } from './stage-yield.js';
import { subBatchCombine } from './sub-batch-combine.js';
import { tabletReconciliation } from './tablet-reconciliation.js';
import { uniformityByWeight } from './uniformity-by-weight.js';
import { weigh } from './weigh.js';

export type { Block, BlockField, BlockSetting } from './format.js';
// In the order of a process: dispensing and preparation, granulation and blending, compression and its tests,
// coating, then the steps of any stage.
export const BLOCKS: readonly Block[] = [
  weigh, charge, sift, binderSolution, coatingSuspension, dryMix, mix, granulate, dry, dryConstant, sieve, lubricate,
  subBatchCombine, blendUniformity, densityFlow, sieveAnalysis, punchDieCheck, pressSetup, compressionRelease, compress,
  friability, disintegration, uniformityByWeight, contentUniformity, coat, sprayCoat, polishPrint, check, qaSample,
  stageYield, tabletReconciliation, lineClearance,
  // TrueBatch Injectables library v1 (phase E): section 4.2.
  ...Object.values(common),
  // Sections 4.3 to 4.8.
  ...Object.values(special),
];
// The blocks a new injectables master may use: the eleven the draft library reuses from TrueBatch Tablets. The other
// tablet blocks stay in the engine copy only as fixtures of the engine tests, until the sterile blocks of the final
// library (phase E) replace them there; the designer does not offer them.
export const OFFERED = ['weigh', 'charge', 'mix', 'check', 'line-clearance', 'sub-batch-combine', 'qa-sample', 'stage-yield', 'blend-uniformity', 'sieve', 'dry-constant',
  ...[...Object.values(common), ...Object.values(special)].map((b) => b.id)];

export function findBlock(ref: { id: string; version: number }): Block | undefined {
  return BLOCKS.find((b) => b.id === ref.id && b.version === ref.version);
}
