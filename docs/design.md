# TrueBatch Injectables: design decisions

Owner decisions of 16 November 2026 (the injectables plan), on top of the TrueBatch Tablets decisions of 15 November
2026 that this copy brings. Built the TrueBatch Tablets way (and the Logbook way), never the Batchwright way: before
adding anything, look how TrueBatch Tablets does it and copy that.

## Product
- **One product per dosage form.** TrueBatch Injectables covers sterile drug product manufacture, from dispensing to
  QA release of filled, closed and inspected units: all injectable types and both routes (terminal sterilisation;
  sterile filtration and aseptic filling; or both). Labelling and packing of the units is a later product of its own,
  as TrueBatch Tablets Packing is for tablets.
- **Its own engine**: a copy of the TrueBatch Tablets engine (TrueBatch Tablets a0ec59c), changed only where injections
  need it. TrueBatch Tablets and Tablets Packing keep their shared engine; a fix in one engine is checked in the other.
- **Six engine changes, approved by the owner, each reusing a Tablets mechanism**, and nothing else without asking
  the owner: (1) a liquid batch header (litres or kg, density, fill volume, overfill, expected units, strength per mL),
  reusing the way Packing has its own header shape; (2) an event log beside filling (interventions, stoppages, time
  out of the fridge), the "rounds alongside a step" without a timer; (3) results that come days later, a parallel
  stage that starts after a named step and closes before production signs; (4) the number of readings set by the
  master step (1-24 needles or probes), the lists of readings; (5) time limits from step X (start or end) to step Y
  (start or end), the hold-time timer; (6) an item that expires during a step needs a deviation note before the step
  is signed (starting with an expired item is refused), the "out of limits needs a deviation note" rule.
- **One fixed clean-air limits table** in the product (EU GMP Annex 1 grade limits for particles and microbes), shown
  in the master review and confirmed once by QA.
- **Rules**: only the 29 rules of the minimum register (`docs/rules.md`); nothing the platform or another product
  already does.
- **Pull, don't type**: values come from master data or other products (room grade from master data, sterile status
  from the Logbook, the line's media fill from Qualification through the Logbook's links); typed by hand only while a
  link is absent or down, with a second-person check.
- Assumed until the owner confirms: one tank of solution = one filling = one batch; aseptic operators by a QA-given
  "aseptic operator" permission (no training dates here); a media fill as a TrueBatch batch comes later.

## Engine change 1: the liquid batch header (built 16 November 2026)
- The header is the product, the batch size and its unit: **litres or kg** (the formula is per mL; a batch in kg turns
  into its volume by the density) or **units** (a dry powder filled as it is; the formula is per unit). Then the
  density (g/mL; needed for kg, and for the batch mass of a batch in litres), the **nominal fill** per container and
  the **fill excess** (overfill), both in mL, and the dispensing rooms. Nothing is typed in the batch.
- Worked out, never typed: the batch volume, the batch mass, the **expected units** (volume ÷ (fill + excess), whole
  units) and the fill target (fill + excess). A step setting may name them (`HEADER_VALUES`), as Tablets' steps named
  the core batch weight.
- A formula line has its mg per mL (or per unit); the vehicle made up to volume (water for injections, "q.s.") has
  none. Its batch quantity is T8: mg/mL × the batch volume (a concentration times a volume, one more pairing of T8's
  per-unit mode). The label claim of the API is per mL ("50 mg/mL") or per unit.
- The master check: a batch in kg needs its density; a batch in L or kg its nominal fill; a fill excess needs the
  fill; only the vehicle may be q.s.; the general calculation checks of Tablets stay (label basis and claim, salt
  factor, solvent-wet API, double adjustment, ratio basis, one-sided particle size, order-critical steps, a batch
  quantity written that T8 does not give, one material twice). The tablet-only ones are not used (core and coated
  weights, coating lines, tooling, other strengths from one blend, processing aids, herbal lines).
- No new mechanism: the header is a different shape of the same master document (as Packing had its own header).

## Engine change 2: an event log beside a stage (built 16 November 2026)
- A block may be an **event log** (`log: true`): interventions, stoppages, time out of the fridge. Its entries are
  rounds of one master step that the operator adds at any time while the stage runs, each recorded and signed like a
  step (the "rounds alongside a step" of Tablets, without a timer and without a stop check).
- None is needed: the step after it does not wait for it, and an empty log does not hold the stage. An entry under way
  holds the stage until it is signed. Once the stage is closed no new entry starts.
- A later step reads a field of an event log as the list of every signed entry's values (zero in the field's unit for
  none), so a template totals it (T2: the units removed, the time out of the fridge).
- The blocks that use it (intervention, stoppage, time out of refrigeration: TI-28) come with the final library.

## Engine change 3: results that come days later (built 16 November 2026)
- EM plates, biological indicators and bioburden are read 2-7 days after sampling and belong to the batch review. A
  **preparation stage** (Tablets' parallel stages) may name the step it **starts after** ("stage/step", an earlier
  step): it opens once that step is done in every copy, runs beside the stages after it (nothing waits for it), and,
  like every stage, must be closed before production signs (TI-20).
- The master check: only a preparation starts after a step, the step is of an earlier stage, and no stage uses it.

## Engine change 4: the number of readings set by the master step (built 16 November 2026)
- A number field of a block may take its number of readings from a **number setting** of the block (`count:
  "$needles"`), as a field takes its unit from a setting (`unit: "$unit"`). The master step sets it (1-100: one
  reading per filling needle or probe), so one block serves a 1-needle and a 24-needle filler.
- The engine resolves it per step (`stepFields`): the floor shows that many boxes, the server takes exactly that many
  readings, and the worked example uses them. The master check refuses a number that is not a whole number from 1 to
  100.

## Engine change 5: time limits from step X to step Y (built 16 November 2026)
- The master lists its **time limits** (TI-17): a name, from step X (its start or its end) to step Y (its start or its
  end), at most N hours. Start of compounding to filtration, end of sterilisation to the start of filling, the total
  aseptic time, stoppering to crimping…
- Each runs on the **hold-time timer** of Tablets (the same display, due soon at 85 %, late, the demo skip): a start
  is the step's first start, an end its first time done (any copy or round). Reached in time, it is gone; reached
  late, a deviation note is needed before production signs; run out before Y's stage started, that stage waits for
  the note, as after a hold time.
- The master check: two steps of this master, a name, not the same point twice. The designer has a "Time limits" list
  on the Process tab; the plain-sentence review lists them.

## Engine change 6: an item that expires during a step (built 16 November 2026)
- Taking an expired item is refused, as in Tablets (TI-12: an MMS lot past its expiry or retest date, a label date
  typed in the past).
- A lot's use-by date (expiry or retest, whichever is first) is kept with the step: pulled from MMS with the lot, or
  typed from the label without the link (`<field>.expiry`). If it has passed when the step is signed done (the item
  expired while the step was under way), the step needs a deviation note written after the expiry first: the "out of
  limits needs a deviation note" rule of Tablets (TI-14), on this date. A lot is usable through its use-by day (plant
  time).
- The sterilised items' "use by" (TI-17, TI-24) will use the same field when the sterile blocks come (phase E).

## The clean-air limits table (built 16 November 2026)
- One fixed table in the product (`shared/master/clean-air.ts`), from EU GMP Annex 1 (2022): Table 5, total particles
  per m³ for monitoring (at rest and in operation, ≥ 0.5 µm and ≥ 5 µm), and Table 6, the action limits for viable
  particles (air sample CFU/m³, settle plate CFU per 4 h, contact plate CFU per plate, glove print CFU per glove;
  grade A no growth). Where Annex 1 sets none (grade D in operation; glove prints in C and D) the plant sets it.
- Shown with every master in the review screen (checker and QA). The count template of the sterile library checks
  environmental readings against it (phase E); a master may set stricter limits, never looser.
- **QA confirms the table once** (owner, 16 Nov 2026): the plant's **QA head** checks it against the plant's copy of
  Annex 1 when the product is installed, as part of the plant's validation, and signs that record with name and
  date. On the demo, the demo admin (who holds every right) confirms it in the plant's place.

## Phase E: templates, blocks, master checks and the sterile rules (built 16 November 2026)
- From the final library (v1, 260 products; v1.1 master checks): units, templates I18-I22 (and T12 offered as I23),
  setting changes of reused templates (`shared/templates/README.md`), the sterile blocks as data (`shared/blocks/common.ts`,
  `shared/blocks/special.ts`). A library "block setting" is a pick-list setting of the block; where it changes which
  fields are needed the block has a variant with its own plain name (sterilising vs clarifying filtration, terminal
  sterilisation vs heat treatment, leak vs headspace gas test, …), never a conditional field. A variant never counts
  for another: a clarifying filtration is not the sterile filtration of TI-25, a heat treatment is not terminal
  sterilisation (TI-24, library check 42).
- The header names the route and what the label claim is per. The master checks of the library run in the master
  check (`shared/master/sterile-checks.ts`, each with its library number); the structure the sterile rules need
  (aseptic set-up, filtration and filter tests, samples, interventions log, closing, inspection, freeze-drying steps)
  applies to a master that fills product.
- People (owner's assumption, CHECK-I1): QA grants "aseptic operator" and "visual inspector"; a stage marked aseptic
  is only for aseptic operators, visual inspection only for visual inspectors. No training dates are kept here.
- QC's sign at release states that the release tests (sterility, endotoxin, bioburden) comply as in the QC report and
  records the EM review of the batch (report numbers, the deviation number of each action-limit excursion).
- A field may be an item's use-by date (engine change 6): refused when past, a deviation note when it passes during
  the step.

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
  TrueBatch Tablets Packing read; readers of Batchwright's columns select them by name and are not affected. `0008` adds
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
  … at …: reason", followed by what went back to stores.
  **Material of a terminated batch** (owner, 16 Nov 2026; ported from TrueBatch Tablets 6f812b4): when the batch has used material
  (signed weighings), the "Terminate batch" window also asks, for each lot it used, how much went
  back to stores unused; the rest counts as used (destroyed or in the batch). Refused unless every lot is answered,
  from 0 up to what the batch counts as used of the lot (as published), and only for lots it used. The answers are
  kept in the terminate event, `payload.returns` [{lot, material, value, unit}], in the unit `material_use_v1`
  publishes for the lot, and signed with it. `material_use_v1` (`db/migrations/0012`) takes them off:
  same columns and rows, `quantity` is now the quantity as before less what was returned of the same lot and unit,
  taken off the batch's uses of that lot from its last step back (stage, sub-batch, step, round), never below 0;
  `data_as_of` is then the later of the step's last event and the termination. So MMS shows the returned material
  available again with no change there. The app counts the same when it compares a lot with MMS's stock
  (`shared/engine/stock.ts`: materialUses, issuedLots, returnProblems). A batch that used no material is asked nothing.
- **Where machines are**: a stage that works machines or names a room chooses the rooms it may run in (master check,
  TI-11); the floor is offered the machines of the field's type standing in those rooms. A balance is offered where
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
  The library (`shared/blocks/`) still holds the TrueBatch Tablets steps of the copy; the sterile blocks come from the
  final injectables library (phase E). A text setting may have a fixed list the author picks from.
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
