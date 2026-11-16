import { useState } from 'react';
import { api } from '../api.js';
import { SignDialog } from '../components/SignDialog.js';
import { type BatchDetail } from '../api-floor.js';
import { ReasonDialog } from '../floor/ReasonDialog.js';

// QA terminates a batch that cannot be finished (owner, 16 Nov 2026): a reason, then a signature meaning "rejected".
// The record is kept; no more actions; its machines and rooms are freed (equipment_use_v1). On the batch screen and
// the QA "To review" list; the batch is read when the dialog opens, and the signature covers it as read then.
export function Terminate({ id, batchNo, onDone }: { id: number; batchNo: string; onDone: () => Promise<void> | void }) {
  const [step, setStep] = useState<'reason' | 'sign' | null>(null);
  const [reason, setReason] = useState('');
  const [d, setD] = useState<BatchDetail | null>(null);
  const close = () => { setStep(null); setD(null); };
  return (<>
    <button type="button" className="big soft-bad" onClick={() => setStep('reason')}>Terminate batch</button>
    {step === 'reason' && (
      <ReasonDialog title={`Terminate batch ${batchNo}`} label="Reason for terminating" submit="Continue to sign" onCancel={close}
        hint="The batch stops here and is rejected. Its record is kept; no step can be recorded any more, and its machines and rooms are freed."
        onSubmit={async (why) => { setD(await api<BatchDetail>('GET', `/api/batches/${id}`)); setReason(why); setStep('sign'); }} />
    )}
    {step === 'sign' && d && (
      <SignDialog meaning="rejected" what={`Terminate batch ${batchNo} · ${d.master.doc.header.productName} (status now: ${d.batch.status})`} onCancel={close}
        onSign={async ({ proof }) => { await api('POST', `/api/batches/${id}/terminate`, { proof, contentHash: d.batch.contentHash, reason }); close(); await onDone(); }}>
        <div className="summary-box"><p>Reason: <b>{reason}</b></p></div>
      </SignDialog>
    )}
  </>);
}

/** "Terminated by … at …: reason" for a batch QA terminated. */
export const terminatedText = (t: { personName: string; at: string; payload: { reason?: string } }, clock: (iso: string) => string) =>
  `Terminated by ${t.personName} at ${clock(t.at)}: ${t.payload.reason ?? ''}`;
