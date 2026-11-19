# TrueBatch Injectables rules

The 30 TrueBatch Injectables rules: the 29 of the owner's minimum register for sterile drug products (16 November 2026:
`injectables-minimum-register.md`; 14 carried over from TrueBatch Tablets unchanged, 6 changed, 9 new) and TI-32,
only trained people sign (owner, 17 November 2026, as TrueBatch Tablets TB-23); the numbers
TI-15 and TI-16 (compression; sieves, punches and dies) are not used. Each rule is checked once, in the app. Each test
that proves a rule starts its name with the rule ID, e.g. `TI-08 the person who performed a step cannot check it`.
`npm run traceability` prints the rule-to-test list; CI (`npm run traceability -- --check`) fails when a rule has no
test, unless its feature comes later (marked "later" in the Tests column, with the feature it waits for).

Clauses: the binding clauses each rule rests on (US: 21 CFR 211 and Part 11; EU: EudraLex Vol 4 Part I chapters C2,
C4, C5, Annex 1 (A1, 2022) and Annex 11 (A11); IN: Revised Schedule M Part I (SCHM) and Part II sterile products
(SCHM-II)), from the minimum register. QA should confirm them before validation. The sterile parts of the changed rules are tested with the sterile blocks and master checks (test/sterile-*.test.ts).

| Rule | Requirement | Clauses | Tests |
|------|-------------|---------|-------|
| TI-01 | A master is complete before it can be approved; for sterile products also the route, room grades, validated cycles, the sterilising filter and its limits, every time limit, the micro sampling points, allowed interventions, the CCI method and the defect list | US 211.186(a),(b); 211.101(a); 211.110(a); 211.111; 211.113(b); EU C4 4.17, 4.18; A1 8.5, 8.7, 8.16, 8.18, 8.38, 8.40, 8.79, 8.126(i); IN SCHM 17.3.6.1, 17.3.6.2(a)-(k); SCHM-II 1.3, 5.14, 6.9 | `test/master-checks.test.ts` |
| TI-02 | A master is checked by a second person and approved by QA; one effective version; a new version needs a change control number | US 211.186(a); 211.100(a); 211.68(b); EU C4 4.3; A11 10; IN SCHM 17.2.4; 8.3; 17.3.6.1 | `test/master-review.test.ts`, `test/links.test.ts` (QMS change control) |
| TI-03 | A batch is issued from the effective master, with a unique number never reused | US 211.188(a); 211.186(a); EU C4 4.2, 4.20 (lead-in); IN SCHM 17.3.8.1; 17.3.10.8-17.3.10.11; 14.32 (new number for rework) | `test/batches.test.ts` |
| TI-04 | Entries are saved at once, with the person and the server time; late entries need a reason | US 211.100(b); 211.188(b)(1); 11.10(e); EU C4 4.8, 4.20(b); A11 12.4; IN SCHM 17.2.7; 17.3.8.3 (lead-in, (c)); 20.4 (omissions) | `test/batches.test.ts`, `test/release.test.ts` |
| TI-05 | TrueBatch keeps its own audit trail | US 11.10(e); EU A11 9, 12.4; IN SCHM 20.4; 17.2.8 ("record of changes and deletions") | `test/batches.test.ts` |
| TI-06 | A correction keeps the original value and its reason, and reaches the steps that used it; nothing is deleted | US 11.10(e); 211.180(a); EU C4 4.9, 4.11; A11 9; IN SCHM 17.2.6, 17.2.7 (retention: expiry + 1 year) | `test/engine.test.ts`, `test/batches.test.ts` |
| TI-07 | E-signatures carry the name, time and meaning, linked to what was signed | US 11.50(a),(b); 11.70; 11.200(a); 211.186(a); 211.188(a); EU A11 14; C4 4.20(h),(i); IN SCHM 17.3.8.3 ("dated and signed"); 17.2.8 | `test/batches.test.ts` |
| TI-08 | Significant steps have a second-person check; the checker is not the performer | US 211.188(b)(11); 211.101(c),(d); 211.103; 211.68(c); EU C4 4.20(c); C5 5.38; A11 6; IN SCHM 14.19; 17.2.8 ("critical data independently checked"); 17.3.8.3(e); 20.6 | `test/engine.test.ts`, `test/batches.test.ts`, `test/master-checks.test.ts`, `test/mywork.test.ts` |
| TI-09 | Steps are done in order; a departure needs a deviation note | US 211.100(b); 11.10(f); EU C5 5.15; C4 4.20(h); IN SCHM 18.2.2; 17.3.8.3(k) | `test/engine.test.ts` |
| TI-10 | Line clearance before each stage | US 211.67(b)(6); 211.100(a); EU C4 4.18(c); C5 5.40, 5.14; IN SCHM 17.3.8.2; 18.4.1; 18.4.7 | `test/master-checks.test.ts`, `test/engine.test.ts`, `test/designer.test.ts`, `test/links.test.ts` (cleaning facts from the Logbook; typed from the label without it) |
| TI-11 | Equipment and rooms are fit for use; the room's grade is at least the step's; isolators and RABS decontaminated with the glove test done | US 211.67; 211.68(a); 211.105(b); 211.160(b)(4); 211.188(b)(2); 211.42(c); 211.42(c)(10)(v),(vi); EU C4 4.20(e); C5 5.9, 5.12; A1 4.4, 4.20, 5.6, 8.1, 8.3, 8.4, 8.10, 8.12-8.14, 8.20, 8.27; IN SCHM 18.4.3, 18.4.4, 18.4.9; 18.2.4; 17.3.6.2(e); SCHM-II 1.2, 4.11.1.1-4.11.1.4, 4.11.2.1-4.11.2.5, 9.5 | `test/batches.test.ts` (master data), `test/picks.test.ts` (the machines offered: balances of the master's dispensing rooms, lines in the stage's rooms), `test/master-checks.test.ts` (a stage names its rooms), `test/links.test.ts` (Logbook status; the label questions without it) |
| TI-12 | Only released, in-date lots are used | US 211.84(a); 211.86; 211.87; 211.101(c)(1); EU C5 5.34; IN SCHM 14.14, 14.16, 14.17 | `test/links.test.ts` (MMS lot status, material and dates; the label without it), `test/lims.test.ts` (a lot typed by hand: its CoA from LIMS) |
| TI-13 | The dispensing target comes from the master, adjusted by assay and LOD | US 211.101(a),(b),(d); 211.188(b)(3),(4); EU C5 5.37, 5.39; C4 4.20(d), 4.8; IN SCHM 14.18, 14.20; 17.3.8.3(f); 7 (recalls) | `test/engine.test.ts`, `test/master-checks.test.ts` |
| TI-14 | In-process checks and parameters against the master's limits, periodic checks on the server timer at the master's interval (fill weight or volume); out of limits or a missed check needs a deviation note | US 211.110(a)-(c); 211.188(b)(5),(10); 211.192; EU C4 4.18(d),(e), 4.20(f); C5 5.43; A1 8.67, 8.86, 8.101, 8.102, 8.115, 8.116; IN SCHM 17.3.6.2(g),(h); 17.3.8.3(i); 18.4.2; 19.7.5 | `test/engine.test.ts`, `e2e/floor.spec.ts`, `test/lims.test.ts` (in-process results of the step's own lab request: the bulk test, blend uniformity) |
| TI-17 | Hold times and time limits run on the server clock; a sterilised item past its hold time cannot be used; any other overrun needs a deviation note | US 211.111; EU C4 4.18(f); C5 5.41; A1 8.5, 8.18(i)-(vii), 8.36, 8.46, 8.122; IN SCHM 17.3.6.2(k); 17.3.8.3(h); 18.4.4; SCHM-II 4.11, 5.13, 5.14, 6.11.2.3(e), 10.2 | `test/engine.test.ts`, `test/batches.test.ts` |
| TI-18 | Yield and unit reconciliation are calculated (units filled, inspected, rejected, sampled); out of limits needs a deviation note and blocks release | US 211.103; 211.186(b)(7); 211.188(b)(7); 211.192; EU C4 4.17(d), 4.20(g); C5 5.44; IN SCHM 17.3.6.2(d); 17.3.8.3(j); 18.2.3; 18.4.6 | `test/engine.test.ts`, `test/release.test.ts` |
| TI-19 | Rework only as a new batch issued from an approved master | US 211.115(a),(b); EU C5 5.67, 5.68, 5.69; C4 4.20(d); IN SCHM 14.32, 14.33, 14.34; 17.3.8.3(f) | `test/batches.test.ts` |
| TI-20 | The record is complete before production signs | US 211.188(b); EU C4 4.20(i); IN SCHM 17.3.8.3 (lead-in, (d)); 18.5.12 | `test/release.test.ts`, `test/batches.test.ts` |
| TI-21 | QC approval (sterility, endotoxin, bioburden comply), then QA review and release or rejection by e-signature; all changes, deviations and sterile evidence shown; release blocked until linked deviations are closed | US 211.22(a); 211.192; 211.165(a); 211.167(a); EU C4 4.27; A11 9, 15; A1 3.2, 8.16, 8.45, 8.124, 9.3, 10.3, 10.5, 10.10; IN SCHM 1 PQS (i); 11.3.6-11.3.9; 18.5.12; 19.8.1; SCHM-II 2.1, 2.3, 4.8, 6.10 | `test/release.test.ts`, `test/batches.test.ts`, `test/links.test.ts` (Deviations status), `test/lims.test.ts` (QC approval with the batch's CoA from LIMS) |
| TI-22 | A complete copy (PDF) with its signatures and changes | US 11.10(b); 211.180(c); EU A11 8.1, 8.2; C4 4.27; IN SCHM 17.2.8 ("readily available") | `test/batches.test.ts`, `e2e/release.spec.ts` |
| TI-23 | An aseptic stage starts only on a line whose media fill is in date and not failed | US 211.113(b); EU A1 9.38, 9.46(v),(vii), 9.49; IN SCHM-II 2.3, 5.5 | `test/sterile-rules.test.ts` (aseptic stages begin with the set-up; aseptic operator permission; media fill due date as a use-by) |
| TI-24 | Every sterilisation and depyrogenation run has its record against the validated cycle, and only accepted loads are used | US 211.67(a); 211.94(c),(d); 211.113(b); 211.188(b); EU A1 5.5, 8.35, 8.40, 8.41, 8.44-8.46, 8.48, 8.50, 8.56, 8.57, 8.59, 8.63, 8.67, 8.68; IN SCHM-II 5.12, 5.17, 6.8-6.10, 6.11.1.1, 6.11.1.4 | `test/sterile-blocks.test.ts` (terminal sterilisation lethality, irradiation dose), `test/sterile-checks.test.ts` (route and heat steps), `test/sterile-rules.test.ts` (a load past its use-by), `test/steriliser-cycles.test.ts` (each cycle published for the Logbook, steriliser_cycle_v1) |
| TI-25 | Sterile filtration: the master's filter, integrity tested before and after use | US 211.113(b); EU A1 6.19, 8.79, 8.86-8.88, 8.91, 8.92, 8.94; IN SCHM-II 5.15, 6.11.2.7, 6.11.2.8 | `test/sterile-rules.test.ts`, `test/sterile-blocks.test.ts` (product factor), `test/sterile-checks.test.ts` (nothing added after the filter; gauge and absolute), `test/templates/filter.test.ts` |
| TI-26 | Microbiological samples are taken where the master says, and the results reach release | US 211.110(a)(6); 211.165(a); 211.167(a); 211.188(b)(10); EU A1 8.93, 10.3, 10.6; IN SCHM-II 2.2(i),(ii), 2.4, 5.16 | `test/sterile-rules.test.ts` (sterility and endotoxin samples; results later), `test/results-later.test.ts`, `test/batches.test.ts` (QC's sign) |
| TI-27 | Environmental monitoring for the batch is reviewed before release; every excursion has a deviation number | US 211.42(c)(10)(iv); 211.192; EU A1 3.2, 9.3, 9.5, 9.13, 9.16, 9.24, 9.30, 10.10; IN SCHM-II 2.3, 4.7.1, 4.8, 4.10 | `test/sterile-rules.test.ts` (an EM count against its action limit), `test/batches.test.ts` (the EM review in QC's sign), `test/templates/counts.test.ts`, `test/clean-air.test.ts`, `test/em.test.ts` (with LIMS linked: the batch's EM read from LIMS at QC approval; alone or down: typed) |
| TI-28 | Interventions and stoppages during aseptic work are recorded; a non-qualified one needs QA and a deviation number | US 211.100(b); 211.188(b); EU A1 8.16, 8.17; IN SCHM 17.3.8.3(k); SCHM-II 2.2(i) | `test/sterile-rules.test.ts` (the interventions log in aseptic filling), `test/event-log.test.ts` |
| TI-29 | Containers are closed and checked for integrity as the master says | US 211.94(b); 211.192; EU A1 8.22-8.24, 8.27, 8.28; IN SCHM-II 10.1, 10.2, 10.4, 10.5, 10.7 | `test/sterile-rules.test.ts`, `test/sterile-blocks.test.ts` |
| TI-30 | Every filled unit is inspected, with rejects recorded by defect category | US 211.165(a); 211.192; EU A1 8.30, 8.32, 8.33; IN SCHM-II 10.8 | `test/sterile-rules.test.ts` (inspection required; visual inspector permission) |
| TI-31 | Freeze-drying is recorded against the validated cycle | US 211.100(b); 211.113(b); EU A1 8.122-8.124, 8.126; IN SCHM-II 4.11.2.4 | `test/sterile-rules.test.ts`, `test/templates/cycle.test.ts` |
| TI-32 | A step that names a training is signed (performed or checked) only by a person Recruitment shows trained in it; while Recruitment cannot be reached the signer confirms it and QA sees it | US 211.25(a); 11.10(i); EU C2 2.11 | `test/training.test.ts`, `e2e/floor.spec.ts` |

## Packing rules (TrueBatch Injectables Packing)

The 9 packing rules (owner, 17 November 2026: injectables packing is a separate product, "TrueBatch Injectables
Packing", with the shared engine, as TrueBatch Tablets Packing is for tablets; the same rules and numbers as Tablets'
TB-P1 to TB-P9). They are not rules of the injectables minimum register: they are the packing product's own, for
labelling and packing the filled, inspected units (vials, ampoules, syringes, bags) of a released TrueBatch
Injectables batch. Each uses the mechanisms of the rules above: the master and its check (TI-01, TI-02), issue
(TI-03), entries, signatures and second-person checks (TI-04 to TI-08), the training a step names (TI-32), deviation notes (TI-09), in-process and
periodic checks (TI-14), reconciliation that blocks release (TI-18) and QC approval and QA release (TI-21, TI-22),
which apply to the packing record unchanged (QC approves it, then QA releases it). The sterile rules (TI-23 to TI-31)
do not apply to packing. The tests name the packing rule; the tests of the shared rules cover the packing record
through the same engine and routes.

| Rule | Requirement | Clauses | Tests |
|------|-------------|---------|-------|
| TI-P1 | A packing master per product, pack type and size (and destination): its packing materials with codes, where the batch number, dates and MRP are printed, line clearance before and after, and IPCs with limits | US 211.186(b); EU C4 4.19; IN SCHM 17.3.7 | `test/packing.test.ts`, `test/packing-api.test.ts` (its own permission codes) |
| TI-P2 | A packing record per packing batch, linked to the RELEASED batch of filled units: quantities, responsible people, checks, specimens and problems | US 211.188(b)(6),(8),(9),(13); EU C4 4.21; IN SCHM 17.3.9 | `test/packing.test.ts`, `test/packing-api.test.ts` (batch released, read from TrueBatch Injectables; typed from its tray or case labels without the link), `e2e/packing.spec.ts` |
| TI-P3 | Line clearance before and after packing, checked by a second person; a blister pack (prefilled syringes) formed and sealed within limits and leak tested periodically | US 211.130(e); 211.188(b)(6); EU C4 4.19(f),(g), C5 5.50; IN SCHM 17.3.9.2, 18.5.2; SCHM-VIII 7.1-7.4 | `test/packing.test.ts` |
| TI-P4 | Printed and other packing materials (labels, cartons, leaflets, trays) issued only by their signed and checked step, from a released lot of the master's material; every component checked against the packing master at line start | US 211.125(a),(b),(f), 211.130(d); EU C5 5.52 | `test/packing.test.ts`, `test/stock.test.ts` (not beyond MMS's stock) |
| TI-P5 | Coding (batch number, dates, MRP) on the labels and cartons checked at the start and at intervals; the camera challenged; labelled units and packs inspected on line; line samples never returned; the customer's serialisation checked (codes of this batch, no serial twice, reconciled), never generated | US 211.122(g), 211.130(c), 211.134; EU C5 5.55-5.60; IN SCHM 18.5.4-18.5.9 | `test/packing.test.ts` |
| TI-P6 | Filled units and every printed material reconciled (issued = used + destroyed + returned); a gap needs a deviation note and blocks release until its number is linked; batch-coded leftovers destroyed and recorded | US 211.125(c)-(e), 211.192; EU C4 4.21(h), C5 5.61, 5.62; IN SCHM 18.2.3, 18.5.10, 18.5.11 | `test/packing.test.ts`, `test/packing-api.test.ts` |
| TI-P7 | One active packing order per line; the line is named on the record, with the product and batch | US 211.130(a); EU C5 5.49, 5.51; IN SCHM 18.5.1, 18.5.3 | `test/packing-api.test.ts` |
| TI-P8 | The expiry is worked out from the approved shelf life and the date of manufacture of the filled units, never typed | US 211.137; EU C4 4.16; IN SCHM 17.3.1.2 | `test/packing.test.ts`, `test/links.test.ts` (`batch_fact_v1.manufactured_on`: the date the first step started), `test/packing-api.test.ts` (read from it; a typed date in the future refused) |
| TI-P9 | Label data per destination (India domestic: dates and MRP); the coding check compares the printed data with the batch record | IN SCHM 17.3.1.2; US 211.137 (expiry) | `test/packing.test.ts` |

## Notes: safety rules built into the calculation templates

These notes record which TrueBatch rule each template safety rule protects. They are not rule rows, and they add no
rules to the table above. Each safety rule refuses with a plain-English message. Each has its own tests in
`test/templates/` (the test names start with the template ID). The templates are described in
`shared/templates/README.md`.

- **TI-13 (dispensing):**
  - **Same basis (C5, built into T9).** A hydrate or solvate molecular weight in the salt factor (T11) together with
    a water, LOD or solvent correction of the assay (T9) is refused, because it counts the water twice (about 6.7 %
    too much pantoprazole).
    A salt, ester, hydrate or compound factor is also refused when the certificate states the potency "as parent"
    (µg of parent drug per mg of material) or "as element" (% Ca, % Zn, % Fe), because that factor is already
    inside the potency.
  - **Molecules per salt formula unit (T11).** The salt factor uses the MW of the salt divided by the number of drug
    molecules per formula unit (2 for hemifumarates and for calcium salts with two anions), so a hemi-salt cannot
    double the dose. A hemi-salt left at 1 molecule per unit with the MW of the whole formula unit (at least twice
    the other form's) is refused.
  - **No negative filler (T10).** A compensating excipient that would go below zero is refused: the batch weight
    cannot be kept, and a deviation is needed.
  - **Potency units are never a mass.** IU, CFU and activity units never convert to a mass. They become a weight
    only through the lot's content per gram (T18).
- **TI-14 (in-process checks against the master's limits):**
  - **No weight-variation method for coated tablets other than film-coated (T14).** Uniformity of dosage units by
    weight variation is refused for sugar-coated and other coated tablets. It is also refused below 25 mg or 25 %
    of the unit, and for products set to "individual results only".
- **TI-13 (liquid make-up):**
  - **No negative water or solvent (T17).** A liquid make-up whose water or solvent to add would be negative (the
    target solids are higher than the ingredients allow) is refused.
