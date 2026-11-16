/**
 * The batch's own status and what QA reviews, computed from the step events and the batch events (production
 * approval, QC approval, release or rejection, QA closing a deviation note). Nothing is stored but the events.
 */
import type { Permission } from '../../server/auth.js';
import { findBlock } from '../blocks/index.js';
import type { MasterDoc } from '../master/schema.js';
import { openSteps, outOfLimits, stepLabel, timers, type StepView, type Timer } from './batch.js';
import { keyId, parseKey, type State, type StepEvent } from './state.js';
import { failed } from './values.js';
import { isHand, type Source } from './links.js';

export const BATCH_EVENT_KINDS = ['production_approved', 'qc_approved', 'released', 'rejected', 'deviation_closed'] as const;
export type BatchEventKind = (typeof BATCH_EVENT_KINDS)[number];
// A batch QA terminated (stopped, not finished) is a rejection with `terminated` (owner, 16 Nov 2026): the record is kept.
export interface BatchEvent { id: number; kind: BatchEventKind; payload: { reportNo?: string; note?: number; reason?: string; terminated?: boolean }; person: number; at: Date }

export const BATCH_STATUSES = ['in production', 'manufacturing complete', 'production approved', 'QC approved', 'released', 'rejected'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export type BatchAction = 'production-approve' | 'qc-approve' | 'release' | 'reject' | 'terminate' | 'close-deviation';
export const BATCH_ACTIONS: Record<BatchAction, { event: BatchEventKind; permission: Permission; from?: BatchStatus; meaning?: 'production_approved' | 'qc_approved' | 'released' | 'rejected' }> = {
  'production-approve': { event: 'production_approved', permission: 'truebatch.batch.supervise', from: 'manufacturing complete', meaning: 'production_approved' },
  'qc-approve': { event: 'qc_approved', permission: 'truebatch.qc.approve', from: 'production approved', meaning: 'qc_approved' },
  release: { event: 'released', permission: 'truebatch.qa.release', from: 'QC approved', meaning: 'released' },
  reject: { event: 'rejected', permission: 'truebatch.qa.release', from: 'QC approved', meaning: 'rejected' },
  // QA stops a batch still in production that cannot be finished, with a reason (TB-21 rows in test/release.test.ts).
  terminate: { event: 'rejected', permission: 'truebatch.qa.release', meaning: 'rejected' },
  'close-deviation': { event: 'deviation_closed', permission: 'truebatch.qa.release' },
};

/**
 * A note with a reference is a linked deviation. While the Deviations link answers, its status is Deviations' (TB-21):
 * open until closed (or rejected) there. Otherwise it is open until QA closes it by hand with a reason.
 */
export interface Deviation { note: number; step: string; reference: string; text: string; open: boolean; by: number | null; closed?: BatchEvent; status?: string; closedAt?: string | null; where?: string }
/** A deviation as read from the Deviations system now (server/links.ts). */
export interface DeviationStatus { status: string; closedAt: string | null }
export const DEVIATION_DONE = ['closed', 'rejected'];
const DEVIATION_WORDS: Record<string, string> = { classification: 'waiting for classification', investigation: 'under investigation', capa: 'waiting for its CAPA', closure: 'waiting for closure' };
/** A status of the Deviations system in plain words (its workflow step names are not shown as keys). */
export const deviationStatusWords = (s: string) => DEVIATION_WORDS[s] ?? s.replaceAll('_', ' ');
export function deviations(events: readonly StepEvent[], batchEvents: readonly BatchEvent[], read?: ReadonlyMap<string, DeviationStatus> | null): Deviation[] {
  return events.filter((e) => e.kind === 'note' && e.payload.reference).map((e) => {
    const closed = batchEvents.find((b) => b.kind === 'deviation_closed' && b.payload.note === e.id);
    const r = read?.get(e.payload.reference!);
    const base = { note: e.id, step: keyId(e), reference: e.payload.reference!, text: e.payload.text ?? '', by: e.person, ...(closed ? { closed } : {}) };
    return r ? { ...base, open: !DEVIATION_DONE.includes(r.status), status: r.status, closedAt: r.closedAt } : { ...base, open: !closed };
  });
}

/** Every timer that ran over, with the deviation notes made after it (a hold: in the using stage; a check: on it). */
export function lateItems(doc: MasterDoc, events: readonly StepEvent[], now: Date): { timer: Timer; notes: StepEvent[] }[] {
  return timers(doc, events, now).filter((t) => t.state === 'late').map((timer) => ({
    timer,
    notes: events.filter((e) => e.kind === 'note' && e.at > timer.at && e.stage === timer.key.stage && (timer.kind === 'hold' || keyId(e) === keyId(timer.key))),
  }));
}

const FINISHED = ['done', 'checked', 'not_applicable'];
const STATE_WORDS: Record<State, string> = { waiting: 'is not started', open: 'is not started', in_progress: 'is in progress', done_awaiting_check: 'is waiting for its check', done: 'is done', checked: 'is checked', not_applicable: 'is not applicable' };
const isYield = (doc: MasterDoc, v: StepView) => findBlock(doc.stages[v.key.stage]!.steps[v.key.step]!.block)?.gmp === 'yield';

// QC approves before QA releases, for a packing record too (owner, 15 Nov 2026: "QC signs first").
export interface BatchView { status: BatchStatus; open: string[]; late: string[]; deviations: Deviation[]; yieldOut: string[] }

/** The batch status, and what stands in the way of the next signature; `read`: the deviations as Deviations has them now. */
export function batchView(doc: MasterDoc, events: readonly StepEvent[], batchEvents: readonly BatchEvent[], now: Date, read?: ReadonlyMap<string, DeviationStatus> | null): BatchView {
  const { stages, steps } = openSteps(doc, events, now);
  const open = [
    ...steps.filter((s) => !FINISHED.includes(s.state)).map((s) => `${stepLabel(doc, s.key)} ${s.needsResign ? 'needs signing again' : STATE_WORDS[s.state]}`),
    ...stages.filter((s) => !s.closed).map((s) => `Stage ${s.name} is not closed`),
  ];
  const late = lateItems(doc, events, now).filter((l) => !l.notes.length).map((l) => `${l.timer.label} ran over: a deviation note is needed`);
  const devs = deviations(events, batchEvents, read).map((d) => ({ ...d, where: stepLabel(doc, parseKey(d.step)!) }));
  const yieldOut = steps.filter((s) => isYield(doc, s) && Object.values(s.results).some(failed) && !devs.some((d) => d.step === s.id))
    .map((s) => `The yield of ${stepLabel(doc, s.key)} is out of limits: a deviation note with its reference is needed`);
  const has = (k: BatchEventKind) => batchEvents.some((e) => e.kind === k);
  const status: BatchStatus = has('released') ? 'released' : has('rejected') ? 'rejected' : has('qc_approved') ? 'QC approved'
    : has('production_approved') ? 'production approved' : open.length ? 'in production' : 'manufacturing complete';
  return { status, open, late, deviations: devs, yieldOut };
}

/** Why the person may not do the batch action now; null when they may. */
export function batchRefusal(action: BatchAction, v: BatchView, user: { id?: number; permissions: readonly string[] }, note?: number): { status: 403 | 409; error: string; problems: string[] } | null {
  const rule = BATCH_ACTIONS[action];
  if (!user.permissions.includes(rule.permission)) return { status: 403, error: 'forbidden', problems: ['You do not have the permission for this action.'] };
  const no = (...problems: string[]) => (problems.length ? { status: 409 as const, error: 'not_ready', problems } : null);
  if (action === 'close-deviation' || action === 'terminate') {
    if (v.status === 'released' || v.status === 'rejected') return no(`The batch is ${v.status}.`);
    // Still in production: production has not signed the record. After that, QC and QA decide at release.
    if (action === 'terminate') return ['in production', 'manufacturing complete'].includes(v.status) ? null : no(`Not possible while the batch is ${v.status}: QA decides at release.`);
    const d = v.deviations.find((x) => x.note === note && x.open);
    if (!d) return no('There is no open deviation note with this number.');
    if (d.status !== undefined) return no(`The status of ${d.reference} comes from the Deviations system (now ${deviationStatusWords(d.status)}): it is closed there.`);
    // By hand: a second person, who checked the closure in the deviation system or its paper record.
    if (d.by === user.id) return { status: 403, error: 'own_work', problems: ['You typed this deviation number: another QA person closes it.'] };
    return null;
  }
  // TB-20: the record is complete before production signs.
  if (action === 'production-approve' && v.status === 'in production') return no(...v.open);
  if (v.status !== rule.from) return no(`Not possible while the batch is ${v.status}.`);
  if (action === 'production-approve') return no(...v.late);
  if (action === 'qc-approve') return null;
  // TB-21: release or rejection only with every linked deviation closed; TB-18: a yield out of limits blocks release.
  const open = v.deviations.filter((d) => d.open).map((d) => `Deviation ${d.reference} (${d.where ?? `step ${d.step}`}) is ${d.status ? `still open in the Deviations system (${deviationStatusWords(d.status)}): it is closed there first` : 'open'}`);
  return no(...open, ...(action === 'release' ? v.yieldOut : []));
}

/** What QA reviews before release (TB-21): every change, departure and finding of the batch. Signatures are the server's. */
export function review(doc: MasterDoc, events: readonly StepEvent[], batchEvents: readonly BatchEvent[], now: Date, read?: ReadonlyMap<string, DeviationStatus> | null) {
  const { steps } = openSteps(doc, events, now);
  const notes = (s: StepView) => s.events.filter((e) => e.kind === 'note');
  return {
    corrections: steps.flatMap((s) => s.replaced.map((r) => ({ step: s.id, ...r }))),
    sentBack: events.filter((e) => e.kind === 'sent_back'),
    late: lateItems(doc, events, now),
    outOfLimits: steps.flatMap((s) => outOfLimits(s).map(([calc, r]) => ({ step: s.id, calc, shown: r.ok ? r.shown : '', notes: notes(s) }))),
    inputChanged: steps.filter((s) => s.inputChanged.length).map((s) => ({ step: s.id, changes: s.inputChanged })),
    deviations: deviations(events, batchEvents, read),
    // Every value typed by hand because a link was absent or down (owner 15 Nov 2026), and who typed it.
    hand: events.flatMap((e) => Object.entries(e.payload.source ?? {}).filter(([, x]) => isHand(x))
      .map(([field, x]) => ({ step: keyId(e), event: e.id, kind: e.kind, field, ...(x as Extract<Source, { from: 'hand' }>), person: e.person, at: e.at }))),
    notApplicable: events.filter((e) => e.kind === 'not_applicable'),
    // Demo installations only: every wait ended at once by a person (server/demo.ts).
    demoSkips: events.filter((e) => e.kind === 'demo_wait_skipped'),
    batchEvents,
  };
}
