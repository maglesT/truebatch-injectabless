/** The block library: each block is data; one engine runs them all. */
import type { Block } from './format.js';
import * as common from './common.js';
import * as special from './special.js';
import { blendUniformity } from './blend-uniformity.js';
import { charge } from './charge.js';
import { check } from './check.js';
import { dryConstant } from './dry-constant.js';
import { lineClearance } from './line-clearance.js';
import { mix } from './mix.js';
import { qaSample } from './qa-sample.js';
import { sieve } from './sieve.js';
import { stageYield } from './stage-yield.js';
import { subBatchCombine } from './sub-batch-combine.js';
import { weigh } from './weigh.js';

export type { Block, BlockField, BlockSetting } from './format.js';
// The eleven blocks the injectables library reuses from TrueBatch Tablets, then the sterile blocks of library v1:
// section 4.2 (dispensing, compounding, filtration, components, filling, sterilisation, inspection) and 4.3-4.8.
export const BLOCKS: readonly Block[] = [
  weigh, charge, mix, check, lineClearance, subBatchCombine, qaSample, stageYield, blendUniformity, sieve, dryConstant,
  ...Object.values(common),
  ...Object.values(special),
];

export function findBlock(ref: { id: string; version: number }): Block | undefined {
  return BLOCKS.find((b) => b.id === ref.id && b.version === ref.version);
}
