# TrueBatch Tablets: design decisions

Owner decisions of 15 November 2026. Built the Logbook way (the platform Logbook is the model for structure, patterns
and size), not the Batchwright way.

## Product
- **One product per dosage form.** TrueBatch Tablets covers manufacturing, from dispensing to QA release of bulk
  tablets. Packing is a separate product, "TrueBatch Tablets Packing", in this repository on the same engine
  (`docs/packing-design.md`).

## Platform
- Runs on the Medhanta platform. Core provides people, sign-in, permissions, e-signature re-authentication and master
  data. Normal platform sign-in (OIDC through core, one person per browser).
- Optional links: MMS (lots, status, assay, LOD), Logbook (equipment and room status), Deviations, QMS (change
  control numbers). Every link has a hand-entry fallback with a second-person check.
- Sessions as the Logbook's: 15 minutes idle (background polls never count); a tap or a key on the screen counts as
  use (at most one renewal a minute); the session ends with core's sign-on (8 hours).

## Links
Owner decisions of 15 November 2026. Built as the Logbook's link clients: one client (`server/links.ts`) reads each
provider's report views live through `<PROVIDER>_DATABASE_URL`, which the platform writes only while the link is on;
nothing is copied or cached. A read is **absent** (no URL: not licensed or switched off), **down** (refused or not
answering) or **ok**.
- **Ok: pull only.** The value comes from the provider, as read, and is kept with the record (PL-07); it cannot be
  typed over.
- **Absent or down: by hand.** The value is typed from the label or certificate, the step needs a second-person check,
  the value is stored with source `hand` (and whether the link was absent or down), and QA's review lists it.
- **Deviations** (`deviation_v1`): a note's reference must exist; while the link answers its status is Deviations'
  (closed or rejected there counts as closed) and QA cannot close it by hand. By hand: a QA person other than the one
  who typed the number closes it.
- **QMS** (`change_v1`, planned): the change control at approval must exist and be QA-approved, in a step of
  `CHANGE_STEPS`, and its products must name the master's product (code or name, without case); one that names no
  product is taken with a warning to QA. By hand: another person makes the version effective.
- **Logbook** (`equipment_status_v1`, planned): a machine or room must be fit for use and not in use by another batch;
  the Logbook's reasons are shown word for word (each without its own closing stop inside our sentence); a status
  older than 5 minutes counts as down. While the link answers, the machine and room pickers offer only what the
  Logbook has and name the ones left out (`shared/engine/picks.ts`, `inLogbook`); absent or down, every one is offered. Line clearance takes
  clean, cleaned on and cleaned by from it. By hand: the status-label questions, each answered yes.
- **MMS** (`lot_v1`, `lot_test_v1`, planned, with numbers): the lot must exist, be the line's material, released, in
  date and not past retest; assay, water, LOD and content come as numbers in %, the assay on the master's basis. By
  hand: the lot label's status and date, the certificate values and their report number. A quantity taken from a lot
  pulled from MMS (a net weight, a packing material issued) may not be more than MMS shows available (owner, 16 Nov
  2026): MMS's balance of the lot (`lot_v1.stock`, in `lot_v1.unit`, MMS D-61) less what this product already used from it as
  its `material_use_v1` gives it (`shared/engine/stock.ts`), checked when it is recorded or corrected and when the
  step is signed done. An MMS whose `lot_v1` has no stock yet, or a lot typed by hand, is not compared. What the other
  TrueBatch product used from the same lot is not read (each product uses its own kind of material).
- **Published** (`db/migrations/0006_report_views.sql`): `batch_fact_v1` and `equipment_use_v1` with Batchwright's
  names and columns, so the Logbook and Deviations read TrueBatch as they read Batchwright, and `deviation_note_v1`
  for Deviations to file notes later. `batch_fact_v1` has one more column at its end (`0007`): `manufactured_on`, the
  date of manufacture, the plant-time date the batch's first processing step started (null before), which TrueBatch
  Tablets Packing reads; readers of Batchwright's columns select them by name and are not affected. `0008` adds
  `product_name` and `master_version` at the end (family_code is the master version's number) and publishes
  `material_use_v1`: per signed weighing step its lot, material and net quantity (status dispensed, or corrected with
  the corrected quantity); MMS reduces the lot's stock by reading it (owner decision), nothing is sent. `0011`: a
  machine or room is in use by its **batch**, not its step or stage (cleaning is due between batches, not between the
  stages of one batch): `equipment_use_v1` has one row per batch and machine or room (sub-batches included), from the
  first start of a step of the batch that names it until every stage of the batch that names it, or whose rooms allow
  its room (by code or area), has closed (the batch event `stage_closed`, recorded once by the action that closes it,
  `0010`), or the production approval or rejection if earlier. So the binder preparation and the granulation in RM-104
  are one use, not dirty between them, and the Logbook marks it dirty after the last; another batch is another use. A
  picked machine or room keeps its room's area for this. A weighing instrument (a balance, by the type rule of
  `shared/engine/picks.ts`) is never a use: shared by the batches weighing on it, it is neither in use by a batch nor
  dirty between weighings; the record keeps which balance was used and the Logbook checks its calibration as before. Both views add `step_name` at the end ("Granulation › Granulate to
  an end point", kept with the step's start); `step` stays the keys. `material_use_v1` gives the quantity in the
  material's unit in master data, read when the step is signed done (g and mg exactly in kg for a kg material).
- **QA terminates a batch** (owner, 16 Nov 2026): a batch still in production (before production approval) that
  cannot be finished is terminated by QA (`qa.release`) from the batch screen or the "To review" list, with a reason
  and an e-signature meaning "rejected". It is a rejection (batch event `rejected` with `terminated`), so the status is
  rejected (`batch_fact_v1`: REJECTED), the record is kept and takes no more actions, and `equipment_use_v1` ends every
  open use of the batch then (machines and rooms dirty, no longer in use). Screens, review and PDF say "Terminated by
  … at …: reason".
- **Where machines are**: a stage that works machines or names a room chooses the rooms it may run in (master check,
  TB-11); the floor is offered the machines of the field's type standing in those rooms. A balance is offered where
  the weighing is done: in one of the master's **dispensing rooms** (header, picked from master data's rooms; a new
  tablet master starts with the rooms whose area is exactly "Dispensing"; a master that weighs and names none is ⛔),
  or in a room the stage allows, never in a QC or laboratory area (`shared/engine/picks.ts`, the same rule on the
  server and the screen). Not every area called dispensing: a liquids block's "Liquid dispensing" balance is not
  offered to a tablet weighing. A version approved before the setting reads the rooms of the Dispensing area.

## Rules and where they are enforced
- 22 TrueBatch GMP rules (EU GMP Part I and Annex 11, 21 CFR 211 and Part 11, Revised Schedule M), listed in
  `rules.md`. Each is checked **once, in the app**.
- The database only protects records: an insert-only audit trail, locked signed records, and only the app may write.

## Engine
- About 40 calculation and check templates, each a small pure function. No formula language.
- Step blocks are **data**: a description of their fields, templates, signatures and limits. One engine runs all blocks.
  The library holds the standard tablet steps, from sifting to the reconciliation of tablets (`shared/blocks/`). A text
  setting may have a fixed list the author picks from.
- A fixed, short list of units.
- A master version is stored as one JSON document.
- The designer is forms and ordered lists.
- Server timers as the Logbook does them. In a demo installation only (`TRUEBATCH_DEMO=1`, set by the platform for the
  demo customer alone) a person with the demo permission may end a running wait at once; the skip is an insert-only
  step event the timers count as the wait satisfied (owner, 15 November 2026; README "Demo installations"). A mixing
  time (T13 from a start timer to an end timer) is such a wait too: once skipped, its lower limit counts as met, the
  recorded duration and the upper limit are kept, and the result says "DEMO: wait skipped" (16 November 2026).
- The second-person checker signs on their own device.
- Version 1: weights are typed (no balance connection).
- PDF output as the Logbook does its exports.

## Calculation checks
Owner decision of 15 November 2026. The master check also runs calculation checks: error-proofing of the
calculations while a master is built. They are **not GMP rules** and are not among the 22. A **refusal** (⛔) is a
clear maths error: a calculation the templates library refuses (water or solvent counted twice, a salt factor up to
the weighed form with a potency stated as parent or element, molecules per salt unit ignored, a negative filler or
solvent, IU or CFU turned into a mass, weight variation on coated tablets other than film-coated, a property that does
not mix by mass), or the master's own numbers disagreeing (a batch quantity against per tablet × batch size, one
material twice with two quantities, the coating lines against coated − core, the API per tablet against the label
claim for each strength, mEq without the ion charge, an in-process result without its type, a liquid made in excess
without the amount to apply per charge); it shows on its item and must be fixed. A **warning** (⚠️) is an "it depends"
question only the author can answer (label basis per market and strength, herbal line, ratio basis, double
adjustment, a written salt factor, a weight that does not fit the tooling, a weight target without its stage, a
solvent-wet API, a removed processing aid, a one-sided particle-size limit, a moved order-critical step): the author
picks an answer, with a reason where asked, and the answer is kept in the master document and shown to the checker
and QA. An unanswered warning blocks "Send for review" like a refusal. The list, with the formulation each comes from
(1,000-formulation test, waves 1-5), is in `shared/templates/README.md`.

## Testing
- Tests per rule and per template, and a few browser journeys.
- No Batchwright machinery: no control register, mutation testing, golden batches, API contract package, CLI, sandbox,
  continuity or markets.
