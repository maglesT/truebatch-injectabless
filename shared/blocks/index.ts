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
import { containerIssue, containerIssue2, containerIssue3, containerReturn, containerReturn2 } from './container-issue.js';
import { deviceAssembly } from './device-assembly.js';
import { bulkIssue } from './bulk-issue.js';
import { cartonCheck } from './carton-check.js';
import { codingCheck } from './coding-check.js';
import { destruction } from './destruction.js';
import { finishedGoods } from './finished-goods.js';
import { formingCheck } from './forming-check.js';
import { leakTest } from './leak-test.js';
import { lineSetup } from './line-setup.js';
import { onlineInspection } from './online-inspection.js';
import { packClearance } from './pack-clearance.js';
import { packClearanceAfter } from './pack-clearance-after.js';
import { packMaterialIssue } from './pack-material-issue.js';
import { printedReconciliation } from './printed-reconciliation.js';
import { serialReceived } from './serial-received.js';
import { serialReconciliation } from './serial-reconciliation.js';
import { serialSample } from './serial-sample.js';
import { visionChallenge } from './vision-challenge.js';

export type { Block, BlockField, BlockSetting } from './format.js';
// The eleven blocks the injectables library reuses from TrueBatch Tablets, then the sterile blocks of library v1:
// section 4.2 (dispensing, compounding, filtration, components, filling, sterilisation, inspection) and 4.3-4.8.
export const BLOCKS: readonly Block[] = [
  weigh, charge, mix, check, lineClearance, subBatchCombine, qaSample, stageYield, blendUniformity, sieve, dryConstant,
  ...Object.values(common),
  ...Object.values(special),
  containerIssue, containerIssue2, containerIssue3, containerReturn, containerReturn2,
  // Round 46 (Tablets, any edition): assembling devices (autoinjectors, safety syringes) from a component lot.
  deviceAssembly,
  // TrueBatch Injectables Packing, in the order of a packing record (forming and leak test: a blister pack only).
  bulkIssue, packMaterialIssue, packClearance, lineSetup, visionChallenge, serialReceived, codingCheck, formingCheck, leakTest, onlineInspection,
  cartonCheck, serialSample, finishedGoods, printedReconciliation, serialReconciliation, destruction, packClearanceAfter,
];
// The blocks either product's masters may use besides its own.
export const GENERAL_BLOCKS = ['check', 'qa-sample'];
/** The blocks a master offers: a packing master's (it has a pack) or an injectables master's. */
export const blocksFor = (packing: boolean) => BLOCKS.filter((b) => GENERAL_BLOCKS.includes(b.id) || !!b.packing === packing);

export function findBlock(ref: { id: string; version: number }): Block | undefined {
  return BLOCKS.find((b) => b.id === ref.id && b.version === ref.version);
}
/** The latest version of a block: what a new step uses (a recorded batch keeps the version its master named). */
export const latestBlock = (id: string): Block | undefined =>
  BLOCKS.filter((b) => b.id === id).reduce<Block | undefined>((a, b) => (!a || b.version > a.version ? b : a), undefined);
