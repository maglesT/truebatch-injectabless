import type { Product } from '../server/product.js';

// TrueBatch Injectables Packing: the packing batch record, from the filled, inspected units of a RELEASED TrueBatch
// Injectables batch (vials, ampoules, syringes, bags) to QA release of the packed batch. Its permissions are its own
// (the platform's code format allows no "-"); the app reads each as the TrueBatch Injectables code of the same thing
// (server/product.ts). QC approves the packed batch (the finished packed product tested and complies, with the QC
// report number) before QA releases it, as TrueBatch Tablets Packing does.
export const PACKING: Product = {
  id: 'truebatch_injectables_packing',
  name: 'TrueBatch Injectables Packing',
  batchPrefix: 'TIP',
  permissions: {
    'truebatch_injectables_packing.master.author': 'Write packing master record versions',
    'truebatch_injectables_packing.master.check': 'Check a packing master record version written by another person',
    'truebatch_injectables_packing.master.approve': 'Approve a checked packing master record version (QA)',
    'truebatch_injectables_packing.batch.issue': 'Issue a packing batch record from a released batch of filled units',
    'truebatch_injectables_packing.batch.operate': 'Record and sign packing steps as performed',
    'truebatch_injectables_packing.batch.check': 'Check packing steps performed by another person (second person)',
    'truebatch_injectables_packing.batch.supervise': 'Production approval of a completed packing record',
    'truebatch_injectables_packing.qc.approve': 'QC approval of the finished packed product (tested and complies)',
    'truebatch_injectables_packing.qa.release': 'QA review and release of packed batches',
    'truebatch_injectables_packing.view': 'View packing records and packing master versions',
    'truebatch_injectables_packing.demo.skip': 'Skip a running wait (demo installations only)',
    'truebatch_injectables_packing.exception.decide': 'Decide a deviation note without a number: close it here (reason and e-signature) or send it to DIVE',
  },
};
