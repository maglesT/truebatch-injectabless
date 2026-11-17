# TrueBatch Injectables Packing: design decisions

Owner decision of 17 November 2026: "injectables packing is a separate product", built as TrueBatch Tablets Packing is
for tablets (its decisions of 15 and 16 November 2026 apply unchanged). The packing batch record: from the filled,
inspected units (vials, ampoules, syringes, bags) of a RELEASED TrueBatch Injectables batch, labelled and cartoned with
the leaflet, to QA release of the packed batch. Built the Logbook way, as TrueBatch Injectables is.

## A separate product on the same engine
- **Its own product on the platform**: its own tile, licence, database (`truebatch_injectables_packing`), app login
  (`truebatch_injectables_packing_app`), sign-on client (`truebatch_injectables_packing`) and permissions
  (`truebatch_injectables_packing.view`,
  `.master.author`, `.master.check`, `.master.approve`, `.batch.issue`, `.batch.operate`, `.batch.check`,
  `.batch.supervise`, `.qc.approve`, `.qa.release`). The platform allows only lower case and `_` in product, database and permission
  names, so the product is written `truebatch_injectables_packing`. Its own database is
  `TRUEBATCH_INJECTABLES_PACKING_DATABASE_URL`; it reads TrueBatch Injectables' released batches through the provider
  link `TRUEBATCH_INJECTABLES_DATABASE_URL` (`report.batch_fact_v1`), as Tablets Packing reads TrueBatch Tablets'.
- **The same code**: one server (`server/`), one engine, block library, templates, master document and checks
  (`shared/`), one set of screens (`web/src`). Nothing is copied. `server/product.ts` says which product a server is;
  inside the app each permission is known by its TrueBatch Injectables code, and a product's own codes in core's token
  are read as those (`truebatch_injectables_packing.batch.operate` is `truebatch_injectables.batch.operate`); every
  other code is ignored. The aseptic operator and visual inspector permissions are not packing's.
- **`packing/`** holds only what is the packing product's own: its entry points (`packing/server/index.ts`,
  `packing/web/`), its descriptor (`packing/product.ts`), its migrations (`packing/migrate.ts`: TrueBatch Injectables'
  migrations without the views it publishes, with packing's app role, then `packing/migrations/`) and its published
  views (`packing_batch_v1`, `equipment_use_v1`, `material_use_v1`, `deviation_note_v1`). `ops/packing.Dockerfile` and `ops/packing.manifest.draft.json` are its image and manifest.

## The packing master (TI-P1)
- One master document, as for injectables, with a **pack** section: the pack product (header: the standard packing
  batch in filled units), the product packed (a TrueBatch Injectables product), pack type (carton, tray, blister) and
  units per pack, packs per outer carton, the approved shelf life and expiry rule, destination
  (India domestic or export), MRP, serialisation on or off with the pack GTIN, and the packing materials picked from
  master data (kind, printed, coded, quantity per pack). The formula is empty; a step's material setting names a
  packing material.
- One master per product, pack type and size, and destination (another destination is a copy).
- The designer offers the packing blocks and an injectables packing skeleton: issue to the line (the filled units and
  each packing material: labels, trays, cartons, leaflets); labelling and cartoning (line clearance, set-up, the coding
  check of labels and cartons, on-line inspection of the labelled units and packs, the carton and leaflet check, and
  the serialisation steps when it is checked); reconciliation of the filled units and of every printed material,
  destruction of coded leftovers and line clearance after. Blister forming and the leak test stay in the library for a
  blister pack (prefilled syringes); the skeleton has them only for that pack type. The master check runs the packing
  checks (`shared/master/packing.ts`) instead of the formula, calculation and sterile checks.

## The packing record
- **Issued from a released batch of filled units** (TI-P2): the issue carries the line, the batch and the filled
  units issued, recorded as the first step's values. The batch is read live from TrueBatch Injectables'
  `batch_fact_v1`: it must be RELEASED and of the master's product packed. Its date of manufacture is the date the
  batch's FIRST processing step started, in plant time (`batch_fact_v1.manufactured_on`,
  `db/migrations/0007_batch_fact_manufactured_on.sql`), not its issue date; a batch without one is refused. Without the
  link the batch and its date of manufacture are typed from the tray or case labels ("RELEASED", the product) with a
  second-person check, and QA's review lists them; a typed date in the future is refused.
- **One active packing order per line** (TI-P7): a line with a batch still being packed takes no other.
- **Batch facts and pack facts**: block calculations read the issue values (`$batch.bulk`, `$batch.mfgDate`,
  `$batch.units`, `$batch.packs`) and the master's pack (`$pack.shelfLifeMonths`, `$pack.mrp` …), so the coding
  checks compare the print with the record, never with a typed copy.
- **Checks alongside the line**: the periodic checks (coding, on-line inspection, cartons and leaflets, serialisation
  sample; forming and leak test for a blister pack) open the next check after their first round and go on side by side; the stage
  closes when each has its end round.
- **Coded batch number**: the TrueBatch Injectables batch number is printed on the labels and cartons; the packing
  record has its own number (`TIP` + year + counter).
- **Expiry** (TI-P8): worked out from the date of manufacture (above) and the approved shelf life (T27), never typed.
- **Reconciliation** (TI-P6): the filled units (counted, never weighed: packed, sampled, returned, rejected) and
  every printed material (issued = used + destroyed +
  returned, zero gap); a gap is out of limits, needs a deviation note and blocks release until its number is linked.
- **Serialisation** (optional per product): checked, never generated. Serial numbers received (typed, with the order
  or file reference), camera challenge at the start, sample codes at the start, at intervals and at the end (GTIN,
  batch, expiry of this batch; well-formed serial; no serial twice in the batch), and reconciliation (received =
  printed OK + rejected + destroyed + unused). No serial register, no regulator reporting.
- **Release** ("QC signs first", as for Tablets Packing): production approval, then QC approval by e-signature
  (`truebatch_injectables_packing.qc.approve`, meaning `qc_approved`, with the QC report number: the finished packed
  product was tested and complies), then QA release or rejection by e-signature. QA cannot release or reject before
  QC has approved. The injectables EM review asked at QC approval is not asked for a packing record. `packing_batch_v1` shows QC_APPROVED in between (`packing/migrations/0101_packing_qc_status.sql`).
- **Published**: `packing_batch_v1` (packing order, coded batch number, products, pack, dates, packs and cartons,
  status, and at its end `shippers`, the shippers counted at the finished goods step or null, `0108`) for MMS finished
  goods; the line named only in the line clearance has the stage as its `step_name` ("Labelling and cartoning",
  `0107`); `equipment_use_v1` (the line and rooms used, for the Logbook) and
  `material_use_v1` (per signed issue step its lot, packing material and quantity issued in the material's unit, for
  MMS to reduce the lot's stock) with TrueBatch Injectables' names and columns
  (`packing/migrations/0102_packing_equipment_and_material_use.sql`). `0103`: one use of the line per packing batch:
  it is in use by the batch through its packing and its reconciliation and line clearance (stages in the line's
  rooms), and dirty after the batch (the line named at issue, the line clearance after packing and a balance do not start a use;
  that clearance is not refused because the line is dirty), `step_name` at the end of both, quantities in the material's
  master-data unit (a count in e.g. nos), and `deviation_note_v1` with TrueBatch Injectables' columns (source_ref
  `truebatch_injectables_packing:note:<id>`), so the Deviations system files packing's notes too (late periodic checks).
  `0104` (owner, 16 Nov 2026): `material_use_v1.quantity` is what the batch used of the lot: the quantity issued less
  what the reconciliation of the same material returned to stores uncoded, once that reconciliation is signed done
  (before it, the quantity issued). Destroyed and batch-coded material stays used. MMS takes the quantity off the lot,
  so the uncoded material returned to stores is available again in MMS with no change there.
  `0105` (owner, 16 Nov 2026): when QA terminates a packing batch that has packing material issued, the "Terminate
  batch" window asks, per lot issued, how much went back to stores unused (0 up to what the batch still counts as used
  of it); the rest counts as used (destroyed or coded). The quantities are kept in the terminate event
  (`payload.returns`: lot, material, quantity and unit as `material_use_v1` publishes them) and `material_use_v1`
  takes them off the batch's issues of that lot, the last first, never below 0: same columns and rows, MMS shows the
  returned material available again with no change there. Shared with TrueBatch Injectables (`db/migrations/0012`,
  `shared/engine/stock.ts`); see docs/design.md.

## Left for later
- A read-only line display.
- Reading the serialisation system's file (the count is typed with the file reference).
- Artwork specimens as attachments (the line set-up confirms they are attached to the paper annex).
