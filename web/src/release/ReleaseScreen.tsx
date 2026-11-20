import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, can, MEANING_LABEL, type Me } from '../api.js';
import { SignDialog } from '../components/SignDialog.js';
import {
  blockOf, changed, go, headline, pdfLink, plainClock, plainError, statusText, stepOf, tone, useBlocks, useLims, valueText, words,
  type BatchDetail, type Block, type FloorEvent, type Source, type TimerRow, type Value,
} from '../api-floor.js';
import { fieldLabel as labelOf, handWhy, PROVIDER_NAME } from '../../../shared/engine/links.js';
import { stepLabel } from '../../../shared/engine/batch.js';
import { Exceptions } from '../components/Exceptions.js';
import type { ExceptionRow } from '../api-floor.js';
import { deviationNumber, deviationStatusWords, qcReportText } from '../../../shared/engine/release.js';
import { plantText } from '../../../shared/plant-time.js';
import { skillText } from '../../../shared/engine/training.js';
import { BatchHeader } from '../floor/BatchScreen.js';
import { ReasonDialog } from '../floor/ReasonDialog.js';
import { terminatedText } from './Terminate.js';
import { SterileSummary } from './SterileSummary.js';
import { product } from '../product.js';
import '../floor/floor.css';
import './release.css';

// What QA reviews (GET /api/batches/:id/review). Owner decision: this review is the audit-trail review of the batch,
// done here and covered by the release signature.
interface Review {
  status: string;
  corrections: { step: string; field: string; was: Value; now: Value; reason: string; personName: string | null; at: string }[];
  sentBack: FloorEvent[];
  late: { timer: TimerRow; notes: FloorEvent[] }[];
  outOfLimits: { step: string; calc: string; shown: string; notes: FloorEvent[] }[];
  inputChanged: { step: string; changes: FloorEvent[] }[];
  deviations: { note: number; step: string; reference: string; text: string; open: boolean; status?: string; closedAt?: string | null; filed?: boolean; typed?: boolean; closed?: { personName: string; at: string; payload: { reason?: string } } }[];
  // Owner 15 Nov 2026: every value typed by hand because a link was absent or down, and the Deviations link's state.
  hand: (Extract<Source, { from: 'hand' }> & { step: string; field: string; event: number; personName: string | null; at: string })[];
  unlinked: { number: string; status: string; title: string | null }[];
  // Owner 17 Nov 2026: signatures whose training was ticked by the signer because Recruitment was not reachable.
  trainingTyped: { step: string; event: number; kind: string; code: string; title?: string; state: 'absent' | 'down'; personName: string | null; at: string }[];
  // Packing (whole-suite run, S24): the bulk batch's deviations still open in the Deviations system; release waits for them.
  bulkOpen: { bulk: string; open: { number: string; status: string; title: string | null }[] } | null;
  deviationsLink: string;
  exceptions: ExceptionRow[];
  notApplicable: FloorEvent[];
  // Demo installations only: the waits ended at once (server/demo.ts).
  demoSkips: FloorEvent[];
  batchEvents: { id: number; kind: string; payload: { reportNo?: string; emReview?: string; reason?: string; terminated?: boolean; source?: Source }; personName: string; at: string }[];
  signatures: { objectType: string; printedName: string; meaning: string; signedAt: string; step: string | null }[];
}
type Signing = { meaning: 'qc_approved' | 'released' | 'rejected'; action: 'qc-approve' | 'release' | 'reject' };

// QC approval (with the QC report number), and QA release or rejection (with a reason), after the review.
export function ReleaseScreen({ me, id }: { me: Me; id: number }) {
  const [d, setD] = useState<BatchDetail | null>(null);
  const [r, setR] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reportNo, setReportNo] = useState('');
  const [emReview, setEmReview] = useState('');
  const [rejectWhy, setRejectWhy] = useState('');
  const [signing, setSigning] = useState<Signing | null>(null);
  const [closing, setClosing] = useState<Review['deviations'][number] | null>(null);
  const blocks = useBlocks();
  // LIMS (readers round 2): the approved CoAs of this batch, picked for QC approval while LIMS answers (typing is refused
  // then); null while LIMS is absent or down: the report number is typed.
  // EM from LIMS (owner rule 19 Nov 2026: LIMS owns EM): the batch's EM samples, read-only, while LIMS answers.
  const [em, setEm] = useState<BatchEm | null>(null);
  useEffect(() => {
    if (product.packing || d?.batch.status !== 'production approved') return;
    let live = true;
    void api<BatchEm>('GET', `/api/batches/${id}/em`).then((x) => live && setEm(x), () => live && setEm(null));
    return () => { live = false; };
  }, [id, d?.batch.status]);
  const emPulled = !!em?.pulled;
  const lims = useLims(d?.batch.status === 'production approved' ? `/api/batches/${id}/lims` : null);
  const reload = useCallback(async (background = false) => {
    try {
      const [b, v] = await Promise.all([api<BatchDetail>('GET', `/api/batches/${id}`, undefined, background), api<Review>('GET', `/api/batches/${id}/review`, undefined, background)]);
      setD(b); setR(v); setError('');
    } catch (e) { setError(plainError(e)); }
  }, [id]);
  // Read on opening and after every action; a background poll every 20 s shows what others did meanwhile.
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(true), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const back = <button className="back" onClick={() => go('#/release')}>← To review</button>;
  if (!d || !r || !blocks) return <div className="fl">{back}{error ? <p className="notice bad" role="alert">{error}</p> : <div className="dash-panel"><div className="skel skel-line w40" /><div className="skel skel-block" /></div>}</div>;

  const doc = d.master.doc;
  const name = (step: string) => stepName(d, step);
  // A note's deviation number: the one written with it, or the one Deviations filed from it (read live).
  const numberOf = (n: { id: number; payload: { reference?: string } }) => r.deviations.find((x) => x.note === n.id)?.reference ?? n.payload.reference;
  // Server messages name steps by their position; people see the step's name.
  const plain = (t: string) => words(t.replace(/(?:step|Step) \S+ \((\d+\.\d+\.\d+\.\d+)\)|\(step (\d+\.\d+\.\d+\.\d+)\)/g, (m, a, b) => (a ? `step ${name(a)}` : `(${name(b)})`)));
  const fieldLabel = (step: string, field: string) => fieldOf(d, blocks, step, field);
  const decided = d.batch.status === 'released' || d.batch.status === 'rejected';
  const yields = d.steps.filter((s) => s.results.yield?.ok);
  const openDevs = r.deviations.filter((x) => x.open);
  const bulkOpen = r.bulkOpen?.open ?? [];
  const qcTurn = d.batch.status === 'production approved';
  const qaTurn = d.batch.status === 'QC approved';
  const blockers = [...openDevs.map((x) => `Deviation ${x.reference} (${name(x.step)}) is ${x.status ? `still open in the Deviations system (${deviationStatusWords(x.status)}): it is closed there first.` : 'open: close it first.'}`),
    ...d.batch.exceptions.filter((x) => x.decision !== 'closed').map((x) => `Deviation note “${x.text}” (${x.where ?? name(x.step)}) ${x.decision === 'open' ? 'waits for a decision: close it here or send it to Deviations.' : 'was sent to Deviations and is not filed there yet.'}`),
    ...bulkOpen.map((x) => `Deviation ${x.number} of the bulk batch ${r.bulkOpen!.bulk} is still open in the Deviations system (${deviationStatusWords(x.status)}): it is closed there first.`), ...d.batch.yieldOut.map(plain)];
  const handLabel = (step: string, field: string) => field === 'reference' ? 'deviation number' : fieldLabel(step, field);

  const sign = async ({ proof }: { proof: string }) => {
    if (!signing) return;
    const extra = signing.action === 'qc-approve' ? { reportNo: reportNo.trim(), ...(product.packing || emPulled ? {} : { emReview: emReview.trim() }) } : signing.action === 'reject' ? { reason: rejectWhy.trim() } : {};
    try {
      await api('POST', `/api/batches/${id}/${signing.action}`, { proof, contentHash: d.batch.contentHash, ...extra });
      setSigning(null);
      setNotice({ 'qc-approve': 'QC approval signed. The batch now waits for QA release.', release: 'The batch is released.', reject: 'The batch is rejected.' }[signing.action]);
    } catch (e) {
      if (!changed(e)) throw e;
      setSigning(null);
      setNotice('The record changed while you were signing (a note was added or a deviation closed). It has been reloaded: review it and sign again.');
    }
    await reload();
  };

  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return (
    <div className="fl">
      {back}
      {error && <p className="notice bad" role="alert">{error}</p>}
      <BatchHeader d={d} />
      <div className="kpis">
        <Kpi n={r.corrections.length} label="Corrections" tone="warn" />
        <Kpi n={r.sentBack.length} label="Sent back by the checker" tone="warn" />
        <Kpi n={r.late.length} label="Late (timers ran over)" tone="bad" />
        <Kpi n={r.outOfLimits.length} label="Out of limits" tone="bad" />
        <Kpi n={openDevs.length + bulkOpen.length} label={r.deviations.length ? `Open deviations (${r.deviations.length} in all)` : 'Open deviations'} tone="bad" />
        <Kpi n={r.hand.length} label="Typed by hand, not pulled through a link" tone="warn" />
      </div>
      {r.deviationsLink === 'down' && <p className="notice warn">The Deviations link is down: the deviation statuses shown are TrueBatch's own (closed by hand).</p>}

      {!product.packing && <SterileSummary d={d} blocks={blocks} />}
      <section className="dash-panel" aria-label="Review of the record and its audit trail">
        <div className="panel-head"><h2>Review of the record and its audit trail</h2>
          <span className="muted">every change, departure and finding of the batch; QA's release signature covers this review</span></div>
        <h3>Stage yields</h3>
        <ul className="rv-list">{yields.map((s) => <li key={s.id} className={tone(s.results.yield) === 'bad' ? 'bad' : 'ok'}><b>{headline(s.results.yield!)}</b> {name(s.id)}
          <small>{tone(s.results.yield) === 'bad' ? 'out of limits' : 'within limits'}</small></li>)}</ul>
        <Group title="Corrections" empty="No value was corrected.">{r.corrections.map((c, i) => (
          <li key={i}><b>{name(c.step)} · {fieldLabel(c.step, c.field)}</b>
            <span><s>{valueText(c.was)}</s> → {valueText(c.now)}</span><small>Reason: {c.reason} · {c.personName}, {plainClock(c.at)}</small></li>))}</Group>
        <Group title="Sent back by the checker" empty="No step was sent back.">{r.sentBack.map((e) => (
          <li key={e.id}><b>{name(idOf(e))}</b><span>{e.payload.reason}</span><small>{e.personName}, {plainClock(e.at)}</small></li>))}</Group>
        <Group title="Late: timers that ran over" empty="No timer ran over.">{r.late.map((l) => (
          <li key={l.timer.id} className={l.notes.length ? '' : 'bad'}><b>{l.timer.label}</b><span>Due {plainClock(l.timer.at)}</span>
            <small>{l.notes.length ? l.notes.map((n) => `${numberOf(n) ? `${numberOf(n)}: ` : ''}${n.payload.text} (${n.personName})`).join(' · ') : 'No deviation note'}</small></li>))}</Group>
        <Group title="Out of limits" empty="Every value was within its limits.">{r.outOfLimits.map((o, i) => (
          <li key={i} className="bad"><b>{name(o.step)}</b><span>{words(o.shown)}</span>
            <small>{o.notes.length ? o.notes.map((n) => `Note${numberOf(n) ? ` ${numberOf(n)}` : ''}: ${n.payload.text} (${n.personName}, ${plainClock(n.at)})`).join(' · ') : 'No note'}</small></li>))}</Group>
        {r.inputChanged.length > 0 && <Group title="Worked out again after an input changed" empty="">{r.inputChanged.map((x) => (
          <li key={x.step}><b>{name(x.step)}</b><small>{x.changes.map((e) => `${e.personName}, ${plainClock(e.at)}`).join(' · ')}</small></li>))}</Group>}
        <Group title="Deviation notes" empty="No deviation note has a deviation number.">{r.deviations.map((x) => (
          <li key={x.note} className={x.open ? 'bad' : 'ok'}><b>{deviationNumber(x)} · {name(x.step)}</b><span>{x.text}</span>
            <small>{x.status ? `${deviationStatusWords(x.status)} in the Deviations system${x.closedAt ? `, ${plainClock(x.closedAt)}` : ''}` : x.open ? 'Open: QA closes it before release' : `Closed by ${x.closed?.personName}, ${plainClock(x.closed?.at ?? '')}: ${x.closed?.payload.reason ?? ''}`}</small>
            {x.open && !x.status && !decided && can(me, 'qa.release') && <button onClick={() => setClosing(x)}>Close the deviation…</button>}</li>))}</Group>
        <h3>Deviation notes without a number</h3>
        <Exceptions me={me} batchId={id} batchNo={d.batch.batchNo} exceptions={d.batch.exceptions} contentHash={d.batch.contentHash} deviationsLink={d.batch.deviationsLink}
          ended={decided} stepName={name} onDone={async (t) => { setNotice(t); await reload(); }} />
        {r.unlinked.length > 0 && <Group title="Deviations naming this batch that no note links" empty="">{r.unlinked.map((x) => (
          <li key={x.number} className="bad"><b>{x.number}</b><span>{x.title}</span><small>{deviationStatusWords(x.status)} in the Deviations system</small></li>))}</Group>}
        {r.bulkOpen && <Group title={`Open deviations of the bulk batch ${r.bulkOpen.bulk}`} empty="">{r.bulkOpen.open.map((x) => (
          <li key={x.number} className="bad"><b>{x.number}</b><span>{x.title}</span><small>{deviationStatusWords(x.status)} in the Deviations system: closed there before release</small></li>))}</Group>}
        <Group title="Typed by hand (a link was off or down)" empty="Every linked value came through its link.">{r.hand.map((h, i) => (
          <li key={i}><b>{name(h.step)} · {handLabel(h.step, h.field)}</b><span>{handWhy(h, 'link was down')}</span>
            <small>{h.personName}, {plainClock(h.at)}</small></li>))}</Group>
        {(r.trainingTyped.length > 0 || d.master.doc.stages.some((s) => s.steps.some((t) => t.training))) && <Group title="Training typed by hand (Recruitment not reachable)" empty="Every training was read from Recruitment.">{r.trainingTyped.map((x) => (
          <li key={x.event} className="bad"><b>{name(x.step)}</b><span>{x.personName} ({x.kind === 'checked' ? 'checked' : 'performed'}) ticked “I am trained in {skillText(x)}”: Recruitment {x.state === 'down' ? 'link was down' : 'not linked'}</span>
            <small>{plainClock(x.at)}</small></li>))}</Group>}
        <Group title="Steps not applicable" empty="Every step was done.">{r.notApplicable.map((e) => (
          <li key={e.id}><b>{name(idOf(e))}</b><span>{e.payload.reason}</span><small>{e.personName}, {plainClock(e.at)}</small></li>))}</Group>
        {r.demoSkips.length > 0 && <Group title="DEMO: waits skipped" empty="">{r.demoSkips.map((e) => (
          <li key={e.id} className="bad"><b>{name(idOf(e))}</b><span>DEMO: wait skipped by {e.personName} at {plainClock(e.at)}</span><small>{String(e.payload.label ?? '')}</small></li>))}</Group>}
        <Group title={`Signatures (${r.signatures.length})`} empty="No signatures.">{r.signatures.map((s, i) => (
          <li key={i} className="sig"><b>{MEANING_LABEL[s.meaning] ?? s.meaning}</b><span>{s.printedName}</span>
            <small>{plainClock(s.signedAt)} · {s.step ? name(s.step) : s.objectType === 'batch' ? `Batch ${d.batch.batchNo} issued` : product.packing ? 'The packing record' : 'The batch record'}</small></li>))}</Group>
      </section>

      <section className="dash-panel" aria-label="Decision">
        <div className="panel-head"><h2>{qcTurn ? 'QC approval' : 'QA release'}</h2>
          <a className="button" href={pdfLink(id)} download>{product.packing ? 'Packing record' : 'Batch record'} (PDF)</a></div>
        {notice && <p className="notice info" role="status">{notice}</p>}
        {r.batchEvents.filter((b) => !['deviation_closed', 'exception_closed', 'exception_sent'].includes(b.kind)).map((b) => (
          <p key={b.id} className={b.kind === 'rejected' ? 'notice bad' : 'all-good'}><span aria-hidden="true">{b.kind === 'rejected' ? '✕' : '✓'}</span>
            {b.payload.terminated ? terminatedText(b, plainClock) : <>{MEANING_LABEL[b.kind] ?? b.kind} by {b.personName}, {plainClock(b.at)}{b.payload.reportNo ? ` · ${plantText(qcReportText(b.payload))}` : ''}{b.payload.emReview ? ` · EM review: ${b.payload.emReview}` : ''}{b.payload.reason ? ` · ${b.payload.reason}` : ''}</>}</p>))}
        {qcTurn && (can(me, 'qc.approve') ? (
          <div className="decide">
            {lims ? (<>
              <p className="lbl">Certificate of analysis of batch {d.batch.batchNo} in LIMS</p>
              {lims.coas.length === 0 ? <p className="notice">LIMS has no approved CoA of this batch yet: QC approves the sample in LIMS first.</p> : (
                <div className="picks" role="group" aria-label="Certificate of analysis">
                  {lims.coas.map((c) => (
                    <button key={c.coaNumber} type="button" className={reportNo === c.coaNumber ? 'on' : ''} aria-pressed={reportNo === c.coaNumber} onClick={() => setReportNo(c.coaNumber)}>
                      <b>{c.coaNumber}</b><small>{plantText(c.shown)}</small>
                    </button>
                  ))}
                </div>
              )}
            </>) : <label>QC report number<input value={reportNo} onChange={(e) => setReportNo(e.target.value)} maxLength={60} placeholder="e.g. QC-26-0042" /></label>}
            {product.packing ? <p className="why">Your signature means: the finished packed product was tested and complies with its specification, as in the QC report.</p> : <>
              {em?.pulled ? <EmFromLims em={em} /> : <label>EM review of the batch (report numbers; the Deviations number of each action-limit excursion, or "no excursion")<input value={emReview} onChange={(e) => setEmReview(e.target.value)} maxLength={500} placeholder="e.g. EM-26-118, EM-26-119: no excursion" /></label>}
              <p className="why">Your signature means: the release tests meet the specification as in the QC report, including sterility (each sub-batch or load), bacterial endotoxins and the bioburden results; and the environmental monitoring of the batch was reviewed, every action-limit excursion with its deviation.</p></>}
            <button className="big primary" disabled={!reportNo.trim() || (!product.packing && (emPulled ? em!.problems.length > 0 : !emReview.trim()))} onClick={() => setSigning({ meaning: 'qc_approved', action: 'qc-approve' })}>Sign: QC approved</button>
          </div>
        ) : <p className="notice">QC approval comes first: it needs the QC approval permission.</p>)}
        {qaTurn && (can(me, 'qa.release') ? (<>
          {blockers.length > 0 && <div className="notice bad" role="note"><p><b>Release is not possible yet:</b></p><ul>{blockers.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          <div className="decide">
            <p className="why">Your signature means: you reviewed the record and its audit trail above ({count(r.corrections.length, 'correction')}, {count(r.sentBack.length, 'step')} sent back,
              {' '}{count(r.late.length, 'late timer')}, {count(r.outOfLimits.length, 'value')} out of limits, {count(r.deviations.length, 'deviation')}) and the batch is released.</p>
            <button className="big ok" disabled={blockers.length > 0} onClick={() => setSigning({ meaning: 'released', action: 'release' })}>Sign: released</button>
          </div>
          <div className="decide reject">
            <label>Reason for rejection<textarea value={rejectWhy} onChange={(e) => setRejectWhy(e.target.value)} maxLength={1000} /></label>
            <button className="big soft-bad" disabled={!rejectWhy.trim() || openDevs.length > 0} onClick={() => setSigning({ meaning: 'rejected', action: 'reject' })}>Sign: rejected</button>
          </div>
        </>) : <p className="notice">The batch waits for QA release: it needs the QA release permission.</p>)}
        {!qcTurn && !qaTurn && !decided && <p className="notice">The batch is {statusText(d.batch.status)}: production approves it before QC and QA.</p>}
      </section>

      {signing && (
        <SignDialog meaning={signing.meaning} what={`Batch ${d.batch.batchNo} · ${doc.header.productName}`} onCancel={() => setSigning(null)} onSign={sign}>
          <div className="summary-box">
            {signing.action === 'qc-approve' && <p>QC report <b>{reportNo.trim()}</b>{product.packing ? '' : emPulled ? <> · EM from LIMS: <b>{em!.rows.length} samples reviewed</b></> : <> · EM review <b>{emReview.trim()}</b></>}</p>}
            {signing.action === 'reject' && <p>Reason: <b>{rejectWhy.trim()}</b></p>}
            {signing.action !== 'qc-approve' && <p>This signature also records your review of the batch's audit trail: {count(r.corrections.length, 'correction')}, {count(r.sentBack.length, 'step')} sent back,
              {' '}{count(r.late.length, 'late timer')}, {count(r.outOfLimits.length, 'value')} out of limits, {count(r.deviations.length, 'deviation')}, {count(r.notApplicable.length, 'step')} not applicable.</p>}
          </div>
        </SignDialog>
      )}
      {closing && (
        <ReasonDialog title={`Close deviation ${closing.reference}`} label="Reason for closing" hint={closing.text} submit="Close the deviation" onCancel={() => setClosing(null)}
          onSubmit={async (reason) => { await api('POST', `/api/batches/${id}/close-deviation`, { note: closing.note, reason }); setClosing(null); setNotice(`Deviation ${closing.reference} is closed.`); await reload(); }} />
      )}
    </div>
  );
}

const idOf = (e: FloorEvent) => `${e.stage}.${e.sub}.${e.step}.${e.round}`;
function blockFor(d: BatchDetail, blocks: Block[], step: string) {
  const s = d.steps.find((x) => x.id === step);
  return s ? blockOf(blocks, stepOf(d.master.doc, s.key)) : undefined;
}
function fieldOf(d: BatchDetail, blocks: Block[], step: string, field: string) {
  return labelOf(blockFor(d, blocks, step)?.fields ?? [], field);
}
/** "Granulation › Weigh a material: Examplol (sub-batch 2, round 3)". */
function stepName(d: BatchDetail, step: string): string {
  const s = d.steps.find((x) => x.id === step);
  return s ? stepLabel(d.master.doc, s.key) : `step ${step}`;
}

function Kpi({ n, label, tone: t }: { n: number; label: string; tone: 'warn' | 'bad' }) {
  return <div className={`kpi ${n ? t : 'ok'}`}><b>{n}</b><span>{label}</span></div>;
}
function Group({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (<>
    <h3>{title}</h3>
    {children.length ? <ul className="rv-list">{children}</ul> : <p className="muted rv-none">{empty}</p>}
  </>);
}

/** The batch's EM samples as LIMS has them (GET /api/batches/:id/em), with why QC approval waits. */
interface BatchEm { link: string; pulled: boolean; window: { rooms: string[]; from: string | null; to: string | null }; problems: string[];
  rows: { sampleNumber: string; pointCode: string | null; pointName: string | null; roomCode: string | null; grade: string | null; kind: string | null; takenOn: string | null;
    value: string | null; unit: string | null; limitText: string | null; level: string | null; excursionStatus: string | null; deviationNumber: string | null; decision: string | null }[] }
function EmFromLims({ em }: { em: BatchEm }) {
  return (
    <div className="em-lims">
      <p className="lbl">Environmental monitoring of {em.window.rooms.join(', ')} from LIMS{em.window.from && em.window.to ? ` (${plainClock(em.window.from)} to ${plainClock(em.window.to)})` : ''}: read-only</p>
      {em.rows.length > 0 && (
        <table className="small"><thead><tr><th>Sample</th><th>Point</th><th>Kind</th><th>Taken</th><th>Result</th><th>Level</th><th>Deviation</th></tr></thead>
          <tbody>{em.rows.map((r) => (
            <tr key={r.sampleNumber} className={r.level === 'ACTION' || r.level === 'ALERT' ? 'bad' : undefined}>
              <td>{r.sampleNumber}</td><td>{r.pointName ?? r.pointCode} ({r.roomCode}{r.grade ? `, grade ${r.grade}` : ''})</td><td>{r.kind}</td><td>{r.takenOn}</td>
              <td>{r.decision ? `${r.value ?? ''} ${r.unit ?? ''}` : 'not decided'}</td><td>{r.level ?? ''}</td><td>{r.deviationNumber ?? ''}</td>
            </tr>))}</tbody></table>
      )}
      {em.problems.length > 0 && <div className="notice bad" role="note"><p><b>QC approval waits:</b></p><ul>{em.problems.map((t) => <li key={t}>{t}</li>)}</ul></div>}
    </div>
  );
}
