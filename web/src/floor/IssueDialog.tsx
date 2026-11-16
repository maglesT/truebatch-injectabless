import { batchText } from '../../../shared/engine/values.js';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { SignDialog } from '../components/SignDialog.js';
import { getVersion, type MasterRow, type Version } from '../api-designer.js';
import { batchLink, go, plainError } from '../api-floor.js';

// TI-03: issue a batch from the effective master version, signed "issued".
export function IssueDialog({ row, onCancel }: { row: MasterRow; onCancel: () => void }) {
  const [v, setV] = useState<Version | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [signing, setSigning] = useState(false);
  useEffect(() => { getVersion(row.id).then(setV, (e) => setProblems([plainError(e)])); }, [row.id]);
  const doc = v?.doc;
  if (!doc) return null;
  const issue = async ({ proof }: { proof: string }) => {
    try {
      const b = await api<{ id: number }>('POST', '/api/batches', { masterVersionId: row.id, proof });
      go(batchLink(b.id));
    } catch (e) {
      if (!(e instanceof ApiError && e.problems.length)) throw e;
      setSigning(false);
      setProblems(e.problems);
    }
  };
  return (<>
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Issue a batch">
      <form className="card dialog fl" onSubmit={(e) => { e.preventDefault(); setSigning(true); }}>
        <h2>Issue a batch</h2>
        <p>{doc.header.productCode} · {doc.header.productName}, version {row.versionNo}: {batchText(doc)}. The batch number is given by the server.</p>
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
