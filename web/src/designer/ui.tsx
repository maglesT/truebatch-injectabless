// Small shared pieces of the designer: picking from master data, ordered lists, chips.
import { useState, type ReactNode } from 'react';

export interface PickItem { id: string; code: string; name: string; note?: string; off?: string }

/** Pick one item from a list (master data, other masters): type to search; "first" items are listed on top. */
export function Picker({ items, label, onPick, first = [], firstLabel, placeholder = 'Search by code or name' }: {
  items: PickItem[]; label: string; onPick: (item: PickItem) => void; first?: string[]; firstLabel?: string; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter((i) => words.every((w) => `${i.code} ${i.name} ${i.note ?? ''}`.toLowerCase().includes(w)));
  const top = found.filter((i) => first.includes(i.id));
  const rest = found.filter((i) => !first.includes(i.id));
  const row = (i: PickItem) => (
    <button key={i.id} type="button" className={i.off ? 'pick off' : 'pick'} disabled={!!i.off} onClick={() => onPick(i)} title={i.off}>
      <b>{i.code}</b> <span>{i.name}</span>{i.note && <span className="muted small">{i.note}</span>}{i.off && <span className="chip chip-warn">{i.off}</span>}
    </button>
  );
  return (
    <div className="picker">
      <input aria-label={label} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick-list" role="list">
        {top.length > 0 && <div className="pick-head">{firstLabel}</div>}
        {top.map(row)}
        {top.length > 0 && rest.length > 0 && <div className="pick-head">All</div>}
        {rest.map(row)}
        {!found.length && <p className="muted small">Nothing found.</p>}
      </div>
    </div>
  );
}

/** Up, down and remove buttons of an ordered list. */
export function Order({ index, count, onMove, onRemove, what }: { index: number; count: number; onMove: (by: -1 | 1) => void; onRemove?: () => void; what: string }) {
  return (
    <span className="order" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`Move ${what} up`} title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
      <button type="button" aria-label={`Move ${what} down`} title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
      {onRemove && <button type="button" aria-label={`Remove ${what}`} title="Remove" onClick={onRemove}>✕</button>}
    </span>
  );
}

/** A set of values picked from a list (machine types, room areas): chips with a remove button, and "Add…". */
export function ChipSet({ label, values, options, onChange, empty }: { label: string; values: string[]; options: string[]; onChange: (v: string[]) => void; empty: string }) {
  const left = options.filter((o) => !values.includes(o));
  return (
    <div className="chipset">
      <span className="chipset-label">{label}</span>
      <div className="chipset-row">
        {values.length === 0 && <span className="muted small">{empty}</span>}
        {values.map((v) => (
          <span key={v} className="vchip">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>✕</button></span>
        ))}
        {left.length > 0 && (
          <select aria-label={`Add to ${label.toLowerCase()}`} value="" onChange={(e) => e.target.value && onChange([...values, e.target.value])}>
            <option value="">Add…</option>
            {left.map((o) => <option key={o}>{o}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export const Section = ({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) => (
  <section className="d-section">
    <div className="d-section-head"><h3>{title}</h3>{aside}</div>
    {children}
  </section>
);

/** A decimal input that keeps what is typed as text (GMP numbers are never floats). */
export function Decimal({ value, onChange, label, width = 7, placeholder }: { value: string | undefined; onChange: (v: string) => void; label: string; width?: number; placeholder?: string }) {
  return <input className="dec" aria-label={label} inputMode="decimal" placeholder={placeholder} style={{ width: `${width}em` }} value={value ?? ''} onChange={(e) => onChange(e.target.value.trim())} />;
}
