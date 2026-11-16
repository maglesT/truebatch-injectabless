# TrueBatch Tablets Packing: design decisions

Owner decisions of 15 November 2026. The packing batch record: from the RELEASED bulk tablets of TrueBatch Tablets to
QA release of the packed batch. Built the Logbook way, as TrueBatch Tablets is.

## A separate product on the same engine
- **Its own product on the platform**: its own tile, licence, database (`truebatch_packing`), app login
  (`truebatch_packing_app`), sign-on client (`truebatch_packing`) and permissions (`truebatch_packing.view`,
  `.master.author`, `.master.check`, `.master.approve`, `.batch.issue`, `.batch.operate`, `.batch.check`,
  `.batch.supervise`, `.qc.approve`, `.qa.release`). The platform allows only lower case and `_` in product, database and permission
  names, so the product is written `truebatch_packing`, not `truebatch-packing`.
- **The same code**: one server (`server/`), one engine, block library, templates, master document and checks
  (`shared/`), one set of screens (`web/src`). Nothing is copied. `server/product.ts` says which product a server is;
  inside the app each permission is known by its TrueBatch code, and a product's own codes in core's token are read as
  those (`truebatch_packing.batch.operate` is `truebatch.batch.operate`); every other code is ignored.
- **`packing/`** holds only what is the packing product's own: its entry points (`packing/server/index.ts`,
  `packing/web/`), its descriptor (`packing/product.ts`), its migrations (`packing/migrate.ts`: TrueBatch Tablets'
  migrations without the views it publishes, with packing's app role, then `packing/migrations/`) and its published
  views (`packing_batch_v1`, `equipment_use_v1`, `material_use_v1`, `deviation_note_v1`). `ops/packing.Dockerfile` and `ops/packing.manifest.draft.json` are its image and manifest.

## The packing master (TB-P1)
- One master document, as for tablets, with a **pack** section: the pack product (header), the bulk product, pack
  type (blister, strip, bottle) and size, packs per carton, the approved shelf life and expiry rule, destination
  (India domestic or export), MRP, serialisation on or off with the pack GTIN, and the packing materials picked from
  master data (kind, printed, coded, quantity per pack). The formula is empty; a step's material setting names a
  packing material.
- One master per product, pack type and size, and destination (another destination is a copy).
- The designer offers the packing blocks and a packing skeleton (issue to the line; packing; reconciliation and line
  clearance after). The master check runs the packing checks (`shared/master/packing.ts`) instead of the formula and
  calculation checks.

## The packing record
- **Issued from a released bulk batch** (TB-P2): the issue carries the line, the bulk batch and the tablets issued,
  recorded as the first step's values. The bulk batch is read live from TrueBatch Tablets' `batch_fact_v1`: it must
  be RELEASED and of the master's bulk product. Its date of manufacture (owner, 15 November 2026) is the date the
  bulk batch's FIRST processing step started, in plant time: TrueBatch Tablets publishes it as
  `batch_fact_v1.manufactured_on` (`db/migrations/0007_batch_fact_manufactured_on.sql`), not its issue date; a bulk
  batch without one is refused. Without the link the bulk and its date of manufacture are typed from the bulk labels
  ("RELEASED", the product) with a second-person check, and QA's review lists them; a typed date in the future is
  refused.
- **One active packing order per line** (TB-P7): a line with a batch still being packed takes no other.
- **Batch facts and pack facts**: block calculations read the issue values (`$batch.bulk`, `$batch.mfgDate`,
  `$batch.tablets`, `$batch.packs`) and the master's pack (`$pack.shelfLifeMonths`, `$pack.mrp` …), so the coding
  checks compare the print with the record, never with a typed copy.
- **Checks alongside the line**: the periodic checks (coding, forming and sealing, leak test, on-line inspection,
  cartons, serialisation sample) open the next check after their first round and go on side by side; the stage
  closes when each has its end round.
- **Coded batch number**: the bulk batch number is printed on the packs; the packing record has its own number
  (`TP` + year + counter).
- **Expiry** (TB-P8): worked out from the date of manufacture (above) and the approved shelf life (T27), never typed.
- **Reconciliation** (TB-P6): tablets (count by weight) and every printed material (issued = used + destroyed +
  returned, zero gap); a gap is out of limits, needs a deviation note and blocks release until its number is linked.
- **Serialisation** (optional per product): checked, never generated. Serial numbers received (typed, with the order
  or file reference), camera challenge at the start, sample codes at the start, at intervals and at the end (GTIN,
  batch, expiry of this batch; well-formed serial; no serial twice in the batch), and reconciliation (received =
  printed OK + rejected + destroyed + unused). No serial register, no regulator reporting.
- **Release** (owner, 15 November 2026: "QC signs first", as for tablets): production approval, then QC approval by
  e-signature (`truebatch_packing.qc.approve`, meaning `qc_approved`, with the QC report number: the finished packed
  product was tested and complies), then QA release or rejection by e-signature. QA cannot release or reject before
  QC has approved. `packing_batch_v1` shows QC_APPROVED in between (`packing/migrations/0101_packing_qc_status.sql`).
- **Published**: `packing_batch_v1` (packing order, coded batch number, products, pack, dates, packs and cartons,
  status) for MMS finished goods later; `equipment_use_v1` (the line and rooms used, for the Logbook) and
  `material_use_v1` (per signed issue step its lot, packing material and quantity issued in the material's unit, for
  MMS to reduce the lot's stock) with TrueBatch Tablets' names and columns
  (`packing/migrations/0102_packing_equipment_and_material_use.sql`). `0103`: one use of the line per packing batch:
  it is in use by the batch through its packing and its reconciliation and line clearance (stages in the line's
  rooms), and dirty after the batch (the line named at issue, the line clearance after packing and a balance do not start a use;
  that clearance is not refused because the line is dirty), `step_name` at the end of both, quantities in the material's
  master-data unit (a count in e.g. nos), and `deviation_note_v1` with TrueBatch Tablets' columns (source_ref
  `truebatch_packing:note:<id>`), so the Deviations system files packing's notes too (late periodic checks).
  `0104` (owner, 16 Nov 2026): `material_use_v1.quantity` is what the batch used of the lot: the quantity issued less
  what the reconciliation of the same material returned to stores uncoded, once that reconciliation is signed done
  (before it, the quantity issued). Destroyed and batch-coded material stays used. MMS takes the quantity off the lot,
  so the uncoded material returned to stores is available again in MMS with no change there.

## Left for later
- An issue screen (as for TrueBatch Tablets, batches are issued through the API for now) and a read-only line display.
- Reading the serialisation system's file (the count is typed with the file reference).
- Artwork specimens as attachments (the line set-up confirms they are attached to the paper annex).
