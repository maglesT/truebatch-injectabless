import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { batchLink, go, pdfLink, plainClock, plainError, releaseLink, statusText, STATUS_CHIP } from '../api-floor.js';
import './floor.css';

interface Row { id: number; batchNo: string; productCode: string; productName: string; status: string; issuedAt: string }

// "All batches": every batch, newest first (the latest 200), so a released or closed batch is found from the menu.
// Filter by status, product or batch number; each row links to the batch, its release screen and the batch record PDF.
export function AllBatches() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { void api<Row[]>('GET', '/api/batches/all').then(setRows, (e) => setError(plainError(e))); }, []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (rows ?? []).filter((b) => (!status || b.status === status) && words.every((w) => `${b.batchNo} ${b.productCode} ${b.productName}`.toLowerCase().includes(w)));
  const statuses = [...new Set((rows ?? []).map((b) => b.status))];
  return (
    <div className="fl">
      <h1>All batches</h1>
      <p className="greeting">Newest first, the latest 200. Times are plant time (IST).</p>
      {error && <p className="notice bad" role="alert">{error}</p>}
      {rows === null && !error && <div className="dash-panel" aria-label="Loading"><div className="skel skel-line w30" />{[0, 1].map((i) => <div key={i} className="skel skel-row" />)}</div>}
      {rows && rows.length === 0 && <p className="notice">No batch has been issued yet.</p>}
      {rows && rows.length > 0 && (
        <section className="dash-panel" aria-label="All batches">
          <div className="all-filter">
            <input className="search" placeholder="Search by batch number, product code or name" aria-label="Search batches" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {statuses.map((s) => <option key={s} value={s}>{statusText(s, true)}</option>)}
            </select>
          </div>
          {shown.length === 0 && <p className="notice">No batch matches.</p>}
          <div className="pending-list">
            {shown.map((b) => (
              <div key={b.id} className="pending-row">
                <span className="age-dot" aria-hidden="true" />
                <span className="pending-what">
                  <strong><a href={batchLink(b.id)}>{b.batchNo} · {b.productName}</a></strong>
                  <small>{b.productCode} · issued {plainClock(b.issuedAt)}</small>
                </span>
                <span className="all-go">
                  <span className={`chip ${STATUS_CHIP[b.status] ?? ''}`}>{statusText(b.status, true)}</span>
                  <button className="link" onClick={() => go(batchLink(b.id))}>Batch</button>
                  {b.status !== 'in production' && <button className="link" onClick={() => go(releaseLink(b.id))}>Release</button>}
                  <a className="link" href={pdfLink(b.id)} target="_blank" rel="noopener">PDF</a>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
