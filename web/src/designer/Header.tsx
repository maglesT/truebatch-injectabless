// Screen 2: the header (product from master data, the batch in L, kg or units, density, fill) and the new-master dialog with
// what the master starts from: empty, a process skeleton, or a copy of another master (scaled to the batch size).
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api.js';
import { createMaster, getVersion, STATE_LABEL, type MasterData, type MasterRow, type Product, type Room } from '../api-designer.js';
import { CLAIM_PER, masterSchema, type MasterDoc } from '../../../shared/master/schema.js';
import { headerValue } from '../../../shared/engine/values.js';
import { ownProducts, scaleDoc } from './model.js';
import { defaultDispensingRooms, packingStages, PACKING_SKELETON, skeletonList, skeletonStages } from './skeletons.js';
import { NEW_PACK, PackFields } from './Pack.js';
import { product as app } from '../product.js';
import { ChipSet, Decimal, Picker } from './ui.js';

type Header = MasterDoc['header'];

export function HeaderFields({ header, onChange, products, rooms }: { header: Header; onChange: (h: Header) => void; products: Product[]; rooms: Room[] }) {
  const product = products.find((p) => p.itemId === header.productItemId);
  const [picking, setPicking] = useState(!header.productItemId);
  const set = (k: keyof Header, v: string) => onChange({ ...header, [k]: v });
  // An optional number: empty removes it.
  const opt = (k: 'densityGPerMl' | 'fillVolumeMl' | 'fillExcessMl', v: string) => onChange(v ? { ...header, [k]: v } : (({ [k]: _, ...h }) => h as Header)(header));
  const doc = { header, formula: [], stages: [] } as MasterDoc;
  const units = DECIMAL.test(header.batchSize) ? headerValue(doc, 'units') : undefined;
  const liquid = header.batchUnit !== 'units';
  return (
    <div className="header-fields">
      <div>
        <span className="field-label">Product</span>
        {header.productItemId && !picking ? (
          <dl className="fields pulled">
            <div><dt>Code</dt><dd>{header.productCode}</dd></div>
            <div><dt>Name</dt><dd>{header.productName}</dd></div>
            <div><dt>Strength</dt><dd>{product?.strength ?? '—'}</dd></div>
            <div><dt>Dosage form</dt><dd>{product?.dosageForm ?? '—'}</dd></div>
            <div><dt /><dd><button type="button" className="link dark" onClick={() => setPicking(true)}>Change product</button></dd></div>
          </dl>
        ) : (
          <Picker label="Product" items={ownProducts(products, 'bulk').map((p) => ({ id: p.itemId, code: p.code, name: p.name, note: [p.strength, p.dosageForm].filter(Boolean).join(' · '), off: p.active ? undefined : 'inactive' }))}
            onPick={(i) => { onChange({ ...header, productItemId: i.id, productCode: i.code, productName: i.name }); setPicking(false); }} />
        )}
      </div>
      <div className="form-grid">
        <label>Batch size<Decimal label="Batch size" value={header.batchSize} onChange={(v) => set('batchSize', v)} width={9} /></label>
        <label>Made in
          <select aria-label="Batch unit" value={header.batchUnit} onChange={(e) => set('batchUnit', e.target.value)}>
            <option value="L">litres (formula per mL)</option><option value="kg">kg (formula per mL, by the density)</option>
            <option value="units">units (a dry powder filled as it is; formula per unit)</option>
          </select>
        </label>
        {/* Run 3, H14: a batch made in units has no density (its formula is per unit). */}
        {liquid && <label>Density (g/mL)<Decimal label="Density" placeholder={header.batchUnit === 'kg' ? 'needed' : 'not given'} value={header.densityGPerMl} onChange={(v) => opt('densityGPerMl', v)} /></label>}
        {liquid && <label>Nominal fill (mL per container)<Decimal label="Nominal fill" value={header.fillVolumeMl} onChange={(v) => opt('fillVolumeMl', v)} /></label>}
        {liquid && <label>Fill excess (mL per container)<Decimal label="Fill excess" placeholder="none" value={header.fillExcessMl} onChange={(v) => opt('fillExcessMl', v)} /></label>}
        <label>Route (how it is made sterile)
          <select aria-label="Route" value={header.route ?? ''} onChange={(e) => onChange(e.target.value ? { ...header, route: e.target.value as Header['route'] } : (({ route: _, ...h }) => h as Header)(header))}>
            <option value="">(choose)</option><option value="terminal">Terminal sterilisation after filling</option>
            <option value="aseptic">Sterile filtration and aseptic processing</option><option value="both">Both</option>
          </select></label>
        <label>Label claim is per
          <select aria-label="Label claim is per" value={header.claimPer ?? ''} onChange={(e) => onChange(e.target.value ? { ...header, claimPer: e.target.value as Header['claimPer'] } : (({ claimPer: _, ...h }) => h as Header)(header))}>
            <option value="">(choose)</option>{CLAIM_PER.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <div className="calc-note">{units === undefined ? <span className="muted">The expected units show once the batch size and fill are set.</span>
          : typeof units === 'string' ? <>Expected units: <b>{units}</b></> : units.ok ? null : <span className="muted">{units.message}</span>}</div>
      </div>
      {/* TI-11: a balance is offered in these rooms or in a room the stage allows. */}
      <ChipSet label="Dispensing rooms (where the materials are weighed)" values={header.dispensingRooms ?? []} options={rooms.filter((r) => r.active).map((r) => r.code)}
        text={(code) => { const r = rooms.find((x) => x.code === code); return r ? `${r.code} · ${r.name}${r.area ? ` (${r.area})` : ''}` : code; }}
        onChange={(dispensingRooms) => onChange({ ...header, dispensingRooms })} empty="None chosen yet: choose the rooms of master data where the materials are weighed" />
    </div>
  );
}

const DECIMAL = /^\d+(\.\d+)?$/;

type Start = { kind: 'empty' } | { kind: 'skeleton'; id: string } | { kind: 'copy'; versionId: number };

/** New master (or a copy of one): the header, and what it starts from. */
export function NewMaster({ md, masters, copyOf, onCreated, onCancel }: {
  md: MasterData; masters: MasterRow[]; copyOf?: MasterRow; onCreated: (id: number) => void; onCancel: () => void;
}) {
  // A new master starts with the rooms of the Sterile dispensing area as its dispensing rooms (a copy: those it names).
  // A packing master: a batch in filled units, no dispensing rooms.
  const [header, setHeader] = useState<Header>({ ...(app.packing ? {} : { dispensingRooms: defaultDispensingRooms(md.rooms) }),
    ...(copyOf?.header ?? { productItemId: '', productCode: '', productName: '', batchSize: '', batchUnit: app.packing ? 'units' : 'L' }) });
  // The starting masters of the route chosen in the header (all of them before one is chosen); packing: its own.
  const skeletons = app.packing ? [PACKING_SKELETON] : skeletonList(header.route);
  const [start, setStart] = useState<Start>(copyOf ? { kind: 'copy', versionId: copyOf.id } : { kind: 'skeleton', id: skeletons[0]!.id });
  // A packing master: the pack (TI-P1), copied with the master it is copied from.
  const [pack, setPack] = useState(app.packing ? NEW_PACK : undefined);
  const [source, setSource] = useState<MasterDoc | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (start.kind !== 'copy') return setSource(null);
    void getVersion(start.versionId).then((v) => {
      setSource(v.doc);
      if (v.doc.pack) setPack(v.doc.pack);
      // A copy keeps the source's unit, density and fill; only the batch size may change (its quantities then scale).
      const { productItemId: _p, productCode: _c, productName: _n, batchSize, ...rest } = v.doc.header;
      setHeader((h) => ({ ...h, ...rest, batchSize: h.batchSize || batchSize }));
    });
  }, [start.kind === 'copy' ? start.versionId : 0]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    let doc: MasterDoc = { header, formula: [], stages: [], ...(pack ? { pack } : {}) };
    if (start.kind === 'skeleton' && !skeletons.some((k) => k.id === start.id)) return setError('Choose a starting master for this route.');
    if (start.kind === 'skeleton') doc.stages = pack ? packingStages(pack) : skeletonStages(start.id, header, md.rooms);
    if (start.kind === 'copy' && source) doc = { ...scaleDoc(source, header.batchSize), header: { ...header, batchUnit: source.header.batchUnit }, ...(pack ? { pack } : {}) };
    const parsed = masterSchema.safeParse(doc);
    if (!header.productItemId) return setError('Pick the product.');
    if (pack && !pack.bulkItemId) return setError('Pick the product packed (the filled units).');
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.at(-1) === 'batchSize' ? 'Batch size' : i.path.join('.')}: ${i.message}`).join('; '));
    setBusy(true);
    try {
      onCreated((await createMaster(parsed.data)).id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };
  const scaled = start.kind === 'copy' && source && header.batchSize !== source.header.batchSize;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={copyOf ? 'Copy a master' : 'New master'}>
      <form className="card dialog wide" onSubmit={submit}>
        <h2>{copyOf ? `Copy ${copyOf.header.productCode} version ${copyOf.versionNo}` : 'New master'}</h2>
        {pack ? <PackFields header={header} pack={pack} products={md.products} onChange={(h, p) => { setHeader(h); setPack(p); }} />
          : <HeaderFields header={header} onChange={setHeader} products={md.products} rooms={md.rooms} />}
        <fieldset className="checklist">
          <legend>Start from</legend>
          {skeletons.map((s) => (
            <label key={s.id} className="check route"><input type="radio" name="start" checked={start.kind === 'skeleton' && start.id === s.id} onChange={() => setStart({ kind: 'skeleton', id: s.id })} />
              <span>Starting master: {s.name}<small>{s.text}</small></span></label>
          ))}
          <label className="check route"><input type="radio" name="start" checked={start.kind === 'copy'} onChange={() => masters[0] && setStart({ kind: 'copy', versionId: copyOf?.id ?? masters[0].id })} disabled={!masters.length} />
            <span>A copy of another master<small>Formula and process are copied; typed batch quantities scale to the new batch size.</small></span></label>
          {start.kind === 'copy' && (
            <select aria-label="Master to copy" value={start.versionId} onChange={(e) => { setStart({ kind: 'copy', versionId: Number(e.target.value) }); }}>
              {masters.map((m) => <option key={m.id} value={m.id}>{m.header.productCode} {m.header.productName} · {m.header.batchSize} {m.header.batchUnit} · version {m.versionNo} ({STATE_LABEL[m.state]})</option>)}
            </select>
          )}
          <label className="check route"><input type="radio" name="start" checked={start.kind === 'empty'} onChange={() => setStart({ kind: 'empty' })} />
            <span>Empty<small>No formula and no stages yet.</small></span></label>
        </fieldset>
        {scaled && <p className="notice small">Copy to a new batch size: {source!.header.batchSize} → {header.batchSize} {source!.header.batchUnit}. Quantities per mL (or per unit) stay; typed batch quantities in the steps scale.</p>}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>Create draft</button>
        </div>
      </form>
    </div>
  );
}
