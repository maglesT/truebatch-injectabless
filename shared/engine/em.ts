/**
 * Environmental monitoring from Medhanta LIMS (owner rule 19 Nov 2026: the product that owns a job keeps it; a linked
 * one reads it; duplicates review item 10). LIMS owns the EM results (report.em_v1). While LIMS answers, QC approval of
 * an aseptic batch shows the EM samples of the rooms the batch's aseptic stages used, over the time those stages ran,
 * read-only; QC signs that it reviewed them. Not linked (or down): the EM review is typed as before.
 * Which samples are the batch's: a sample LIMS names with a batch number belongs to that batch only; one without a
 * batch number belongs to the batch when it was taken in one of its aseptic rooms within the aseptic window (at its
 * sampling time when LIMS gives one, else on one of the window's plant days).
 * Approval waits while a sample is not decided in LIMS, or an action excursion (an action level, or an excursion LIMS
 * opened without an alert level) has no deviation number there. An alert is a trend watch in LIMS with no investigation
 * and no deviation number (TI260016 demo, 19 Nov 2026): it is listed, it does not hold approval.
 */
import type { MasterDoc } from '../master/schema.js';
import type { StepEvent } from './state.js';

/** A row of LIMS em_v1 as read (sampledAt and batchNumber appended later: null from an older LIMS). */
export interface EmRow {
  sampleNumber: string; pointCode: string | null; pointName: string | null; roomCode: string | null; grade: string | null; kind: string | null;
  takenOn: string | null; sampledAt: string | null; batchNumber: string | null; value: string | null; unit: string | null; limitText: string | null;
  level: string | null; excursionStatus: string | null; deviationNumber: string | null; decision: string | null;
}
/** The batch's aseptic rooms and the time its aseptic stages ran (null: not started). */
export interface EmWindow { rooms: string[]; from: string | null; to: string | null }

/** The rooms the aseptic stages recorded (a machine's room, or the room itself) and their first start to last event. */
export function emWindow(doc: MasterDoc, events: readonly StepEvent[], now: Date): EmWindow {
  const aseptic = new Set(doc.stages.flatMap((s, i) => (s.aseptic ? [i] : [])));
  const mine = events.filter((e) => aseptic.has(e.stage));
  const rooms = new Set<string>();
  for (const e of mine) {
    for (const v of Object.values((e.payload as { values?: Record<string, unknown> }).values ?? {})) {
      const room = v && typeof v === 'object' && !Array.isArray(v) && 'itemId' in v ? (v as { room?: unknown }).room : undefined;
      if (typeof room === 'string' && room) rooms.add(room);
    }
  }
  const started = mine.filter((e) => e.kind === 'started').map((e) => e.at.getTime());
  if (!started.length) return { rooms: [...rooms].sort(), from: null, to: null };
  // At QC approval the record is complete: the window ends with the aseptic stages' last event (still running: now).
  const last = mine.some((e) => e.kind === 'done') ? Math.max(...mine.map((e) => e.at.getTime())) : now.getTime();
  return { rooms: [...rooms].sort(), from: new Date(Math.min(...started)).toISOString(), to: new Date(last).toISOString() };
}

const day = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/** Whether an em_v1 row is one of this batch's EM samples. */
export function emOfBatch(r: EmRow, batchNo: string, w: EmWindow, tz: string): boolean {
  if (r.batchNumber) return same(r.batchNumber, batchNo);
  if (!w.from || !w.to || !w.rooms.some((x) => same(r.roomCode, x))) return false;
  if (r.sampledAt) { const t = new Date(r.sampledAt).getTime(); return t >= new Date(w.from).getTime() && t <= new Date(w.to).getTime(); }
  return !!r.takenOn && r.takenOn >= day(w.from, tz) && r.takenOn <= day(w.to, tz);
}

const where = (r: EmRow) => [r.pointName ?? r.pointCode, r.roomCode].filter(Boolean).join(', ');
const excursion = (r: EmRow) => r.level === 'ACTION' || r.level === 'ALERT' || (!!r.excursionStatus && r.excursionStatus !== 'NONE');
/** An excursion LIMS investigates (a deviation number): any but an alert. */
const needsDeviation = (r: EmRow) => excursion(r) && r.level !== 'ALERT';

/** Why QC approval waits on the batch's EM in LIMS, in plain words (none: it may be signed). */
export function emProblems(rows: readonly EmRow[], w: EmWindow): string[] {
  if (!rows.length) return [`LIMS has no EM samples of ${w.rooms.join(', ') || 'the aseptic rooms'} for this batch yet: QC approval waits for them.`];
  const out: string[] = [];
  for (const r of rows) {
    if (!r.decision) out.push(`EM sample ${r.sampleNumber} (${where(r)}) is not decided in LIMS yet.`);
    else if (needsDeviation(r) && !r.deviationNumber) out.push(`EM sample ${r.sampleNumber} (${where(r)}): the ${r.level ? `${r.level.toLowerCase()} ` : ''}excursion has no deviation number in LIMS.`);
  }
  return out;
}

/** The EM QC reviewed, in words, for the record and the PDF. */
export function emText(rows: readonly EmRow[], w: EmWindow): string {
  const ex = rows.filter(excursion);
  return `EM from LIMS: ${rows.length} sample${rows.length === 1 ? '' : 's'} of ${w.rooms.join(', ')}; `
    + (ex.length ? `${ex.length} excursion${ex.length === 1 ? '' : 's'}: ${ex.map((r) => `${r.sampleNumber} ${(r.level ?? '').toLowerCase()} ${r.value ?? ''}${r.unit ? ` ${r.unit}` : ''}${r.deviationNumber ? ` (${r.deviationNumber})` : ''}`).join(', ')}` : 'no excursion');
}
