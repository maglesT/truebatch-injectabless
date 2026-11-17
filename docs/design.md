# TrueBatch Injectables: design decisions

Owner decisions of 16 November 2026 (the injectables plan), on top of the TrueBatch Tablets decisions of 15 November
2026 that this copy brings. Built the TrueBatch Tablets way (and the Logbook way), never the Batchwright way: before
adding anything, look how TrueBatch Tablets does it and copy that.

## Product
- **One product per dosage form.** TrueBatch Injectables covers sterile drug product manufacture, from dispensing to
  QA release of filled, closed and inspected units: all injectable types and both routes (terminal sterilisation;
  sterile filtration and aseptic filling; or both). Labelling and packing of the units is a product of its own
  (owner, 17 November 2026), TrueBatch Injectables Packing, in this repository on the same engine, as TrueBatch Tablets
  Packing is for tablets (`docs/packing-design.md`).
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
- The blocks that use it: interventions and stoppages (TI-28), time out of refrigeration.

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
- People (confirmed by the owner, 16 November 2026): QA grants "aseptic operator" and "visual inspector"; a stage marked aseptic
  is only for aseptic operators, visual inspection only for visual inspectors. No training dates are kept here.
- QC's sign at release states that the release tests (sterility, endotoxin, bioburden) comply as in the QC report and
  records the EM review of the batch (report numbers, the deviation number of each action-limit excursion).
- A field may be an item's use-by date (engine change 6): refused when past, a deviation note when it passes during
  the step.
- **Isolator, capping machine, containers and closures** (owner, 17 November 2026, demo findings F19 and F20; no new
  mechanism): the aseptic set-up (`aseptic-ready` version 2) records the isolator or RABS first and the seal check
  (`seal-check` version 2) its capping machine, both machine fields pulled from master data and refused while the
  Logbook says they are not fit (its glove test and decontamination checks decide). Version 1 of each stays for the
  recorded batches; the library and the starting masters take the latest version (`latestBlock`). Containers and
  closures are issued by count from an MMS lot (block `container-issue`, as Packing's material issue: lot, count
  issued, count returned at the end, a second-person check; issued at least 102 % of the header's units in the
  starting masters). The starting masters issue vials and stoppers in the containers stage (a syringe: syringes and
  plungers in the aseptic stage) and seals before the seal check. `material_use_v1` (`db/migrations/0013`) lists each
  signed issue beside the weighings: issued less returned, in units (MMS counts them as nos), material code empty, so
  MMS matches it to its lot by lot number; the app counts the same against MMS's stock (`shared/engine/stock.ts`).
- **Run 2 findings** (owner, 17 November 2026, G1 to G14; no new mechanism): `aseptic-ready` version 3 drops the typed
  "glove integrity test passed" (the Logbook decides the glove test through the isolator or RABS field; the media fill
  stays typed). `container-issue` version 2 names its container or closure (a material setting, as Packing's issue):
  the master lists its containers and closures from master data (`containers`, on the Formula screen, as a packing
  master's packing materials), so the floor offers MMS lots of that material and refuses another material's lot. What
  is left is counted back in its own step (`container-return`, as Packing's printed reconciliation), never by
  re-opening the signed issue; `material_use_v1` (`db/migrations/0015`) gives MMS issued less that count once it is
  signed, with the material code. (Run 3 replaced the rule on the line clearance's room by the stage's own rooms:
  see "Where machines are".) The release summary names the machines a step used with
  their Logbook status at use. The designer offers "update to version N" for a step of an older block (settings of
  the same names kept), asks before removing a step, moves steps by their key, and the changes view ignores a step's
  new number and names the fields a newer block version records. The change control list offers those naming the
  product (QMS's products or the code in the title; a pack's code no longer names its bulk).
- **Aseptic blow-fill-seal and sterile powder filling** (owner, 17 Nov 2026; no new mechanism, no new rule): two
  starting masters, as data. "Ampoules or nebules, blow-fill-seal, aseptic": compounding with the sterile filtration
  and filter tests, an aseptic blow-fill-seal stage in the Aseptic filling area (set-up, interventions, clean-air
  checks, the plastic granules issued, the run, sterility samples, the granules weighed back, reconciliation), the EM
  plates read later, and inspection with the 100 % leak test; no washing, depyrogenation, stoppers or seals. "Sterile
  powder in vials, aseptic powder filling": the sterile powder weighed in the Sterile dispensing area (a preparation
  stage, as the containers are: the filling stage reconciles the units), the containers stage, an aseptic filling
  stage as the liquid's with `powder-fill` in place of `fill`, the plates read later, and inspection; no compounding or
  filtration. The blocks, each a new version as before (the older stays for the recorded batches; new steps take the
  latest):
  - `ffs-run` version 2: per round the parison (extrusion) temperature with optional limits (optional: a film
    form-fill-seal has none), the mould or tool ID and "air shower or blow air filter checked"; it also takes the LVP
    bag filling machine. The bag master takes it too.
  - `powder-fill` version 1, as `fill`: the powder filling machine (auger or vacuum drum), the net powder of the units
    per round with the mean and each unit within their limits, the room's humidity against its limit, stoppers seated;
    periodic, beside the stage's fill card on the filling screen.
  - `aseptic-ready` version 4: the machine field also takes a blow-fill-seal machine (it has no isolator or RABS; the
    Logbook decides its cleaning and sterilisation in place).
  - `container-issue` version 3 and `container-return` version 2: a unit setting, units (counted) or kg (weighed), as
    Packing's issue of a packing material. The plastic granules (LDPE or PP) are a container material of the master
    issued by weight from an MMS lot and weighed back; `material_use_v1` and the stock check take the step's unit as
    they are (no migration). Not a formula line: the granules are not in the product, and the formula is mg per mL.
  The sterile structure rules (`shared/master/sterile-checks.ts`) count `powder-fill` as a fill; the sterile filtration
  (TI-25) is needed when a liquid is filled (`fill`, `ffs-run`), and its filter tests whenever there is a filtration;
  the interventions log (TI-28) is needed in an aseptic stage with any fill; nothing may be added between the
  filtration and a blow-fill-seal run either (library check 37). The sterile powder's lot comes from MMS as any formula
  material, released and in date (TI-12); the sterility of the lot is part of its QC release in MMS, not a certificate
  value here (the certificate values are numbers in %: assay, water, LOD, content). Cleaning between products (an
  antibiotic line) is the Logbook's: a machine or room the Logbook says is not clean is refused (TI-11) and line
  clearance takes its cleaning from it.
- **Run 3 findings** (17 Nov 2026; no new mechanism, no block version): the bag starting master issues its plastic
  film or granules by kg from an MMS lot and weighs it back, as the blow-fill-seal one (`container-issue` 3,
  `container-return` 2), and its form-fill-seal stage names only the Aseptic filling area (no capping; master data has
  no area of its own for a terminally sterilised large-volume line, and its room RM-219 is in Aseptic filling). The
  aseptic filling stage names Lyophilisation only for freeze-dried vials, Capping only where seals are put on. The
  Formula screen adds a weighing for each excipient no step weighs yet (a copy of the master's first weighing, after
  the last one of that stage), as the packing materials' steps are added. `container-issue` 3 is worded for a count
  or a weight ("Quantity expected", "Quantity issued, in % of the quantity expected"); the washer of `component-wash`
  is a washing machine or washer, never a stopper processor (types of the same field, same version, as the filter
  test's tester). The release's sterility summary lists the fill rounds (`fill`, `ffs-run`, `powder-fill`). A
  correction counts once per field a person changed: the values a link gives with it (a room's cleaning facts, a
  lot's certificate values) stay in the step's history but are not listed again. The density is asked only for a
  batch in L or kg.

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
  clean, cleaned on and cleaned by from it; the previous product and batch is offered from this product's own batches
  that named the room or line before (one tap; typed only when another product used it since). An empty picker says
  why: where the machines of its type stand, or that master data has none (owner, 17 Nov 2026). By hand: the status-label questions, each answered yes.
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
  an end point", kept with the step's start); `step` stays the keys. `0014` (17 Nov 2026): the use's `step` and
  `step_name` are the step that names it **last** (the latest started), so the Logbook's "last used by … (stage ›
  step)" names where it was last used. `0016`: a machine or room named only in line clearance steps (a room, the
  filling line) was used by the stage, so its `step_name` is the stage's name ("Compounding"); a machine operated in
  a process step keeps that step. `material_use_v1` gives the quantity in the
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
  The master check warns (⚠️, TI-11; `shared/master/places.ts`, run by the designer with master data) when no machine
  of a step's type stands in the rooms its stage allows, naming where the machines of that type stand: the floor's
  picker would be empty. A warning, not ⛔: master data changes without a new master version, and the floor checks it
  again; an empty picker on the floor says why (as TrueBatch Tablets, 17 Nov 2026).
  **A stage names its line's own room** (run 3, H2, owner 17 Nov 2026; no format change: a stage's rooms were already
  areas or room codes). Two lines share an area (the vial, syringe and bag filling rooms are all "Aseptic filling"), so
  a stage that names only the area would let its line clearance take another line's room. A starting master names the
  usual areas; when the master is made, an area of master data with exactly one active room becomes that room, and an
  area of several stays: the master check warns "<stage>: pick the line's room" until the author picks it in the stage
  settings (the room list shows each room's name and area). The dispensing rooms follow the same rule: a new master
  starts with the sterile dispensing room when master data has exactly one, else none (⛔ until the author picks).
  On the floor the line clearance offers only the stage's rooms, and every machine has one rule: it stands in a room
  the stage names (by code or by area), and a refusal says where it stands and that the master names the stage's
  rooms (H10). The earlier rule (a machine of the cleared room's area stands in that room, run 2 G6) is gone: it held
  only within one area, so a washer or capper of another area passed while a filler was refused.
- **What the master check reports** (as TrueBatch Tablets, 17 Nov 2026): everything the plain view would show as not
  set (a required setting, a hold time, a stage's responsible role); an optional setting left empty is left out of
  the plain view's sentences, as the engine leaves it out. A temperature recorded with its optional limits left empty
  is a warning (the packing forming temperature). A stage's yield on an earlier stage's output is ⛔ when the stage
  adds formula materials (the yield would read above 100 %). The messages carry no internal codes (rules, templates,
  failure cases, the library's check numbers); the rule stays with the problem for the tests, and an answer given to
  a warning as it read before still counts.

## Rules and where they are enforced
- 22 TrueBatch GMP rules (EU GMP Part I and Annex 11, 21 CFR 211 and Part 11, Revised Schedule M), listed in
  `rules.md`. Each is checked **once, in the app**.
- The database only protects records: an insert-only audit trail, locked signed records, and only the app may write.

## Engine
- About 40 calculation and check templates, each a small pure function. No formula language.
- Step blocks are **data**: a description of their fields, templates, signatures and limits. One engine runs all blocks.
  The library (`shared/blocks/`) holds the 11 blocks the injectables library reuses from TrueBatch Tablets and the
  sterile blocks of library v1; the tablet steps are not in the product. A text setting may have a fixed list the
  author picks from.
- A fixed, short list of units. Counts are whole (owner, 17 Nov 2026, as TrueBatch Tablets): packs from filled units
  are whole packs (rounded down); a count is named as people count it (units, packs, nos).
- A result is shown by its figure and its limit in a few words, with one verdict (the screen's chip, the PDF's
  verdict line); its worked line stays with it ("How it was worked out"; in the PDF under the figure)
  (`shared/engine/plain.ts`, owner 17 Nov 2026). Times are shown to the minute.
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
