import type { Permission } from '../server/auth.js';

// Overridable so two working copies can run their browser tests side by side.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 8291);
export const E2E_SCHEMA = process.env.E2E_SCHEMA ?? 'e2e';
// Invented test people and the TrueBatch permissions core gives them.
export const USERS: Record<string, Permission[]> = {
  op1: ['truebatch_injectables.batch.operate'],
  // The filling screen: an aseptic operator (QA-given permission, TI-23).
  asep1: ['truebatch_injectables.batch.operate', 'truebatch_injectables.batch.aseptic'],
  chk1: ['truebatch_injectables.batch.check'],
  qa1: ['truebatch_injectables.qa.release', 'truebatch_injectables.master.approve'],
  // Makes a version effective when the change control was typed by hand (no QMS link).
  qa2: ['truebatch_injectables.master.approve'],
  // The release journey: production supervisor and QC.
  sup1: ['truebatch_injectables.batch.supervise'],
  qc1: ['truebatch_injectables.qc.approve'],
  // Writes the fixture master and issues the batch of the floor journey.
  iss1: ['truebatch_injectables.master.author', 'truebatch_injectables.batch.issue'],
  // The master designer journey: an author and a second-person checker (qa1 approves).
  author1: ['truebatch_injectables.master.author'],
  mcheck1: ['truebatch_injectables.master.check'],
  norole: [],
};
