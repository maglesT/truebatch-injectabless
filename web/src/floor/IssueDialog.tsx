import { batchText } from '../../../shared/engine/values.js';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';
import { SignDialog } from '../components/SignDialog.js';
import { getVersion, type MasterRow, type Version } from '../api-designer.js';
import { batchLink, go, plainError, useLogbookItems, type PickItem } from '../api-floor.js';
import { FieldInput } from './Fields.js';
import { findBlock } from '../../../shared/blocks/index.js';
import { handFields, type Source } from '../../../shared/engine/links.js';
import { emptyNote, inLogbook, machineRefusal } from '../../../shared/engine/picks.js';

// TI-03: issue a batch from the effective master version, signed "issued". A packing master's first step is recorded
// at issue: the line, the released batch of filled units (picked from TrueBatch Injectables; typed from its labels
// without the link) and the units issued (what is left of its good units, pulled with it when TrueBatch Injectables
// gives them: all of it, or less typed for a part issue). A value the server finds typed by hand (a link absent or
// down) asks its label questions.
export function IssueDialog({ row, onCancel }: { row: MasterRow; onCancel: () => void }) {
  const [v, setV] = useState<Version | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [signing, setSigning] = useState(false);
  const [lines, setLines] = useState<PickItem[]>([]);
  const [machines, setMachines] = useState<PickItem[]>([]);
  const [rooms, setRooms] = useState<PickItem[]>([]);
  const [bulk, setBulk] = useState<{ link: string; batches: { batchNo: string; mfgDate: string | null; goodQuantity?: string | null; issued?: string; left?: string }[] } | null>(null);
  useEffect(() => { getVersion(row.id).then(setV, (e) => setProblems([plainError(e)])); }, [row.id]);
  const doc = v?.doc;
  const block = doc?.stages[0]?.steps[0] ? findBlock(doc.stages[0].steps[0].block) : undefined;
  const atIssue = (block?.atIssue ?? []).map((n) => block!.fields.find((f) => f.name === n)!);
  useEffect(() => {
    if (!doc || !atIssue.length) return;
    if (doc.pack) void api<typeof bulk>('GET', `/api/bulk-batches?product=${encodeURIComponent(doc.pack.bulkCode)}`).then(setBulk, () => setBulk({ link: 'down', batches: [] }));
    void Promise.all([api<PickItem[]>('GET', '/api/master/equipment'), api<PickItem[]>('GET', '/api/master/rooms')])
      .then(([all, rooms]) => { setMachines(all); setRooms(rooms); setLines(all.filter((m) => m.active && atIssue.some((f) => f.kind === 'machine' && !machineRefusal(doc.stages[0]!, f, m, rooms)))); }, () => {});
  }, [doc]);

  // While the Logbook is linked, only the lines it has (shared/engine/picks.ts).
  const logbook = useLogbookItems(atIssue.some((f) => f.kind === 'machine'));
  const offer = inLogbook(lines, logbook?.items ?? null);
  const linePicks = offer.offered.map((p) => ({ ...p, notFit: logbook?.notFit[p.itemId] }));
  // The notice under the units (what is left of the batch) is scrolled into sight once a batch is picked (display backlog 30).
  const left = useRef<HTMLParagraphElement>(null);
  useEffect(() => { left.current?.scrollIntoView?.({ block: 'nearest' }); }, [values.bulk, bulk]);
  if (!doc) return null;
  // The label questions of a value the server found typed by hand ("… is not recorded").
  const asked = handFields(block?.fields ?? [], Object.fromEntries((block?.fields ?? []).map((f) => [f.name, { from: 'hand', link: 'mms', state: 'absent' } as Source])))
    .filter((f) => problems.some((p) => p.startsWith(`${f.label} is not recorded`)));
  // The date of manufacture comes with the batch while TrueBatch Injectables answers, and so do the units issued when
  // it gives them (pull, don't type): what is left of its good units, offered; less may be typed (a part issue).
  const picked = bulk?.link === 'ok' ? bulk.batches.find((x) => x.batchNo === String(values.bulk ?? '').trim()) : undefined;
  // Fix round 21 Nov 2026 (A6): offered is the packing master's batch (or what is left of the bulk when less), not all of it.
  const leftQty = picked?.goodQuantity ? picked.left ?? picked.goodQuantity : undefined;
  const offered = leftQty === undefined ? undefined : Number(leftQty) > Number(doc.header.batchSize) ? doc.header.batchSize : leftQty;
  const fields = [...atIssue.filter((f) => f.name !== 'mfgDate' || (bulk && bulk.link !== 'ok')), ...asked];
  const sent = Object.fromEntries(Object.entries(values).filter(([k]) => fields.some((f) => f.name === k)));
  // Another batch: the units typed for the previous one go.
  const set = (name: string) => (raw: unknown) => setValues((x) => (name === 'bulk' ? { ...Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'units')), bulk: raw } : { ...x, [name]: raw }));
  const issue = async ({ proof }: { proof: string }) => {
    try {
      const b = await api<{ id: number }>('POST', '/api/batches', { masterVersionId: row.id, proof, ...(fields.length ? { values: sent } : {}) });
      go(batchLink(b.id));
    } catch (e) {
      if (!(e instanceof ApiError && e.problems.length)) throw e;
      setSigning(false);
      setProblems(e.problems);
    }
  };
  return (<>
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Issue a batch">
      <form className="card dialog wide fl" onSubmit={(e) => { e.preventDefault(); setSigning(true); }}>
        <h2>Issue a batch</h2>
        <p>{doc.header.productCode} · {doc.header.productName}, version {row.versionNo}: {doc.pack ? `${Number(doc.header.batchSize).toLocaleString('en-IN')} filled units, packed from ${doc.pack.bulkCode}` : batchText(doc)}. The batch number is given by the server.</p>
        {fields.map((f) => (
          <FieldInput key={f.name === 'units' ? `units-${picked?.batchNo ?? ''}` : f.name} f={f} unit={f.unit ?? ''} saved={f.name === 'units' && offered ? { value: offered, unit: f.unit ?? 'units' } : undefined} picks={f.kind === 'machine' ? linePicks : []} note={[f.kind === 'machine' && machines.length && !lines.length ? emptyNote(doc.stages[0]!, f, machines, rooms) : null, f.kind === 'machine' ? offer.note : null]} onChange={set(f.name)}
            options={f.kind === 'bulk' ? (bulk?.batches ?? []).map((x) => x.batchNo) : []} />
        ))}
        {picked?.goodQuantity && <p ref={left} className="notice">Left to issue of {picked.batchNo}: {Number(leftQty).toLocaleString('en-IN')} units ({Number(picked.goodQuantity).toLocaleString('en-IN')} good units in TrueBatch Injectables{Number(picked.issued ?? 0) > 0 ? `, ${Number(picked.issued).toLocaleString('en-IN')} already issued to other packing batches` : ''}). {offered === leftQty ? 'Shown: all that is left.' : `Shown: the packing batch of the master, ${Number(offered).toLocaleString('en-IN')} units.`} Type the units actually issued.</p>}
        {doc.pack && bulk && bulk.link !== 'ok' && <p className="notice warn">TrueBatch Injectables is not linked or not answering: type the batch from the labels of its trays or cases; a second person checks it.</p>}
        {problems.length > 0 && <div className="notice bad" role="alert">{problems.map((p, i) => <p key={i}>{p}</p>)}</div>}
        <div className="actions">
          <button type="button" className="big" onClick={onCancel}>Cancel</button>
          <button className="big primary" type="submit">Next: sign</button>
        </div>
      </form>
    </div>
    {signing && <SignDialog meaning="issued" what={`A new batch of ${doc.header.productCode} ${doc.header.productName} from master version ${row.versionNo}.`} onCancel={() => setSigning(false)} onSign={issue} />}
  </>);
}
