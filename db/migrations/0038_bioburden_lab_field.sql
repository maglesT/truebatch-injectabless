-- Template round (22 Nov 2026, part 4): the bioburden block's count is an in-process lab test too (a new in-process field replaces
-- lab_field_parameters, as test/lims.test.ts requires; master_lab_field_v1 reads it).

create or replace view lab_field_parameters (block, block_name, field, code, label, label_setting, unit, unit_setting, individual) as values
  ('blend-uniformity', 'Blend uniformity sampling', 'results', 'blend-uniformity.results', 'Content at 10 locations (% of label claim)', null, '%', null, 10),
  ('lab-tests', 'In-process lab tests (QC lab)', 'test1', 'lab-tests.test1', 'Lab test 1', 'what1', null, 'unit1', null::int),
  ('lab-tests', 'In-process lab tests (QC lab)', 'test2', 'lab-tests.test2', 'Lab test 2', 'what2', null, 'unit2', null::int),
  ('lab-tests', 'In-process lab tests (QC lab)', 'test3', 'lab-tests.test3', 'Lab test 3', 'what3', null, 'unit3', null::int),
  ('bulk-test', 'In-process bulk test (hold)', 'ph', 'bulk-test.ph', 'pH', null, 'pH', null, null::int),
  ('bulk-test', 'In-process bulk test (hold)', 'density', 'bulk-test.density', 'Density', null, 'g/mL', null, null::int),
  ('bulk-test', 'In-process bulk test (hold)', 'assay', 'bulk-test.assay', 'Assay (% of target)', null, '%', null, null::int),
  ('bulk-test', 'In-process bulk test (hold)', 'osmolality', 'bulk-test.osmolality', 'Osmolality', null, 'mOsm/kg', null, null::int),
  ('bulk-test', 'In-process bulk test (hold)', 'oxygen', 'bulk-test.oxygen', 'Dissolved oxygen', null, 'mg/L', null, null::int),
  ('bulk-test', 'In-process bulk test (hold)', 'solvent', 'bulk-test.solvent', 'Residual solvent', null, 'ppm', null, null::int),
  ('incubated-bioburden', 'Bioburden results (per 100 mL)', 'count', 'incubated-bioburden.count', 'Count', null, 'CFU', null, null::int),
  ('incubated-lab', 'Biological indicator and bioburden results', 'count', 'incubated-lab.count', 'Count (CFU; a BI: 0 = no growth)', null, 'CFU', null, null::int)
;
