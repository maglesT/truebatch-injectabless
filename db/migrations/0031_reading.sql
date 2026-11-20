-- Round 46 (Tablets, ported; lead, for Operations' continued process verification, CPV): reading_v1, one row per recorded number of a
-- step signed done: every process parameter and in-process check value, as the record holds it now (a correction
-- replaces the value; `corrected` says so). A list of readings (10 fill weights) gives one row per reading
-- (reading_no 1..n, in order); a single number reading_no 1. Its limits are the master step's, from the setting the
-- block checks it against (shared/engine/readings.ts): limit_of 'each' (a C1 on the value) or 'mean' (a T7 on the
-- list: the limit is the mean's, not each reading's); a limit the block writes itself (no device failing its
-- function test: not more than 0 units); null when the block has no limit for it, the master left an optional limit unset, or the limit is not
-- a written one (an earlier step's result). low_limit and high_limit are in limit_unit, which may differ from unit
-- (a limit in kN, a reading in N): the reader converts, or compares only rows of one unit.
--   reading_id: '<batch number>/<stage.sub-batch.step.round>/<field>/<reading_no>';
--   stage: the stage's name; step: '<stage key>/<step key>' (as material_use_v1); step_name: "Stage › step", kept with
--   the step's start (as the other views); block: the block id ('fill', 'seal-check', 'device-assembly');
--   parameter: the field's label (a "check a value" step: what the master says it checks); field: the field's name.
-- Nothing new is stored: derived from the insert-only step events. reading_parameters (not published) is the
-- list of the number fields of the blocks an injectables master may use (a block with
-- several versions once, as its latest version has it) with their limit settings; a test compares it with
-- the blocks (test/readings.test.ts), so a new number field needs a migration replacing it. Columns are only ever
-- added at the end (0006). Injectables only: packing does not migrate this file.

-- In the product's own schema (created before the report schema is put first in search_path): not published.
create or replace view reading_parameters (block, field, label, limit_setting, fixed_limit, limit_of) as values
  ('weigh', 'assay', 'Assay (certificate)', null, null::jsonb, null),
  ('weigh', 'water', 'Water content (certificate)', null, null::jsonb, null),
  ('weigh', 'lod', 'Loss on drying (certificate)', null, null::jsonb, null),
  ('weigh', 'content', 'Content (certificate)', null, null::jsonb, null),
  ('weigh', 'gross', 'Gross weight', null, null::jsonb, null),
  ('weigh', 'tare', 'Tare weight', null, null::jsonb, null),
  ('mix', 'speed', 'Speed', 'speedLimit', null::jsonb, 'each'),
  ('check', 'reading', 'Reading', 'limit', null::jsonb, 'each'),
  ('sub-batch-combine', 'sub1', 'Sub-batch 1', null, null::jsonb, null),
  ('sub-batch-combine', 'sub2', 'Sub-batch 2', null, null::jsonb, null),
  ('sub-batch-combine', 'sub3', 'Sub-batch 3', null, null::jsonb, null),
  ('sub-batch-combine', 'sub4', 'Sub-batch 4', null, null::jsonb, null),
  ('sub-batch-combine', 'sub5', 'Sub-batch 5', null, null::jsonb, null),
  ('sub-batch-combine', 'sub6', 'Sub-batch 6', null, null::jsonb, null),
  ('sub-batch-combine', 'sub7', 'Sub-batch 7', null, null::jsonb, null),
  ('sub-batch-combine', 'sub8', 'Sub-batch 8', null, null::jsonb, null),
  ('sub-batch-combine', 'sub9', 'Sub-batch 9', null, null::jsonb, null),
  ('sub-batch-combine', 'sub10', 'Sub-batch 10', null, null::jsonb, null),
  ('sub-batch-combine', 'output', 'Combined weight', null, null::jsonb, null),
  ('qa-sample', 'taken', 'Units taken', 'sampleLimit', null::jsonb, 'each'),
  ('stage-yield', 'output', 'Output', null, null::jsonb, null),
  ('stage-yield', 'samples', 'Samples', null, null::jsonb, null),
  ('stage-yield', 'rejects', 'Rejects', null, null::jsonb, null),
  ('blend-uniformity', 'results', 'Content at 10 locations (% of label claim)', 'meanLimit', null::jsonb, 'mean'),
  ('dry-constant', 'weight', 'Sample weight', null, null::jsonb, null),
  ('aql-sample', 'lotSize', 'Lot size (good units)', null, null::jsonb, null),
  ('aql-sample', 'critical', 'Critical defects found', null, null::jsonb, null),
  ('aql-sample', 'major', 'Major defects found', null, null::jsonb, null),
  ('aql-sample', 'minor', 'Minor defects found', null, null::jsonb, null),
  ('bulk-adjust', 'measured', 'Measured concentration', null, null::jsonb, null),
  ('bulk-adjust', 'bulk', 'Bulk quantity in the vessel', null, null::jsonb, null),
  ('bulk-adjust', 'added', 'Quantity added', null, null::jsonb, null),
  ('bulk-test', 'ph', 'pH', 'phLimit', null::jsonb, 'each'),
  ('bulk-test', 'density', 'Density', 'densityLimit', null::jsonb, 'each'),
  ('bulk-test', 'assay', 'Assay (% of target)', 'assayLimit', null::jsonb, 'each'),
  ('bulk-test', 'osmolality', 'Osmolality', 'osmolalityLimit', null::jsonb, 'each'),
  ('bulk-test', 'oxygen', 'Dissolved oxygen', 'oxygenLimit', null::jsonb, 'each'),
  ('bulk-test', 'solvent', 'Residual solvent', 'solventLimit', null::jsonb, 'each'),
  ('component-wash', 'count', 'Components or parts washed', null, null::jsonb, null),
  ('component-wash', 'conductivity', 'Final rinse conductivity', 'conductivityLimit', null::jsonb, 'each'),
  ('depyrogenate', 'hotZone', 'Hot-zone temperature', 'hotZoneLimit', null::jsonb, 'each'),
  ('depyrogenate', 'beltSpeed', 'Belt speed', 'beltSpeedLimit', null::jsonb, 'each'),
  ('depyrogenate', 'particles', 'Particles ≥ 0.5 µm at the exit', 'particleLimit', null::jsonb, 'each'),
  ('depyrogenate', 'count', 'Containers through', null, null::jsonb, null),
  ('dissolve', 'speed', 'Speed', 'speedLimit', null::jsonb, 'each'),
  ('dissolve', 'temperature', 'Temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('dry-probe', 'reading', 'Probe reading', 'endPointLimit', null::jsonb, 'each'),
  ('dry-probe', 'temperature', 'Product temperature', null, null::jsonb, null),
  ('ds-thaw-pool', 'containers', 'Containers pooled', null, null::jsonb, null),
  ('ds-thaw-pool', 'net', 'Net weight of each container', null, null::jsonb, null),
  ('ds-thaw-pool', 'thawTemp', 'Thaw temperature', 'thawTempLimit', null::jsonb, 'each'),
  ('ds-thaw-pool', 'concentration', 'Concentration (certificate)', 'concentrationLimit', null::jsonb, 'each'),
  ('ds-thaw-pool', 'density', 'Density (certificate or measured)', null, null::jsonb, null),
  ('fill', 'weights', 'Net fill weight per needle', 'meanLimit', null::jsonb, 'mean'),
  ('fill', 'headspace', 'Headspace oxygen', 'headspaceLimit', null::jsonb, 'each'),
  ('fill', 'counter', 'Counter', null, null::jsonb, null),
  ('filter-test', 'temperature', 'Test temperature', null, null::jsonb, null),
  ('filter-test', 'result', 'Result', null, null::jsonb, null),
  ('filtration', 'pressure', 'Highest pressure difference', 'pressureLimit', null::jsonb, 'each'),
  ('filtration', 'filtered', 'Filtered quantity', 'filteredLimit', null::jsonb, 'each'),
  ('filtration-clarifying', 'pressure', 'Highest pressure difference', 'pressureLimit', null::jsonb, 'each'),
  ('headspace-gas', 'tested', 'Units tested', null, null::jsonb, null),
  ('headspace-gas', 'rejected', 'Units rejected', null, null::jsonb, null),
  ('headspace-gas', 'passed', 'Units passed', null, null::jsonb, null),
  ('heat-treatment', 'units', 'Units', null, null::jsonb, null),
  ('heat-treatment', 'temperature', 'Lowest product temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('heat-treatment', 'time', 'Time at temperature', 'timeLimit', null::jsonb, 'each'),
  ('irradiation', 'boxes', 'Boxes sent', null, null::jsonb, null),
  ('irradiation', 'unitsSent', 'Units sent', null, null::jsonb, null),
  ('irradiation', 'minDose', 'Minimum dose per box', null, null::jsonb, null),
  ('irradiation', 'maxDose', 'Maximum dose per box', null, null::jsonb, null),
  ('irradiation', 'unitsBack', 'Units back', null, null::jsonb, null),
  ('leak-test-100', 'tested', 'Units tested', null, null::jsonb, null),
  ('leak-test-100', 'rejected', 'Units rejected', null, null::jsonb, null),
  ('leak-test-100', 'passed', 'Units passed', null, null::jsonb, null),
  ('make-up', 'gross', 'Vessel gross weight', null, null::jsonb, null),
  ('make-up', 'tare', 'Vessel tare weight', null, null::jsonb, null),
  ('make-up', 'temperature', 'Temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('nitrogen', 'flow', 'Gas flow', null, null::jsonb, null),
  ('nitrogen', 'oxygen', 'Oxygen (dissolved mg/L, or headspace % v/v)', 'oxygenLimit', null::jsonb, 'each'),
  ('ph-adjust', 'ph', 'pH', 'phLimit', null::jsonb, 'each'),
  ('ph-adjust', 'temperature', 'Temperature', null, null::jsonb, null),
  ('ph-adjust', 'added', 'Volume added this round', null, null::jsonb, null),
  ('powder-fill', 'weights', 'Net fill weight per unit', 'meanLimit', null::jsonb, 'mean'),
  ('powder-fill', 'humidity', 'Room relative humidity', 'humidityLimit', null::jsonb, 'each'),
  ('powder-fill', 'counter', 'Counter', null, null::jsonb, null),
  ('room-status', 'pressure', 'Differential pressure', 'pressureLimit', null::jsonb, 'each'),
  ('room-status', 'temperature', 'Temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('room-status', 'humidity', 'Relative humidity', 'humidityLimit', null::jsonb, 'each'),
  ('seal-check', 'checked', 'Units checked', null, null::jsonb, null),
  ('seal-check', 'defects', 'Defective units', 'defectLimit', null::jsonb, 'each'),
  ('seal-check', 'force', 'Seal force or removal torque', 'forceLimit', null::jsonb, 'each'),
  ('solvent-strip', 'flow', 'Gas flow this stage', 'flowLimit', null::jsonb, 'each'),
  ('solvent-strip', 'solvent', 'Residual solvent', 'solventLimit', null::jsonb, 'each'),
  ('sterilise', 'exposure', 'Time at sterilising temperature', 'exposureLimit', null::jsonb, 'each'),
  ('sterilise', 'lowest', 'Lowest probe temperature in exposure', 'lowestLimit', null::jsonb, 'each'),
  ('terminal-sterilise', 'units', 'Units in the load', null, null::jsonb, null),
  ('terminal-sterilise', 'lowestF', 'Lowest probe lethality (printout)', 'lethalityLimit', null::jsonb, 'each'),
  ('terminal-sterilise', 'exposure', 'Exposure time', 'exposureLimit', null::jsonb, 'each'),
  ('terminal-sterilise', 'maxProduct', 'Highest product temperature', 'maxProductLimit', null::jsonb, 'each'),
  ('treat-until-clear', 'added', 'Added this round', null, null::jsonb, null),
  ('unit-reconcile', 'good', 'Good units', null, null::jsonb, null),
  ('unit-reconcile', 'fillRejects', 'Filling rejects', null, null::jsonb, null),
  ('unit-reconcile', 'inspectionRejects', 'Inspection and leak-test rejects', null, null::jsonb, null),
  ('unit-reconcile', 'samples', 'Samples', null, null::jsonb, null),
  ('unit-reconcile', 'removed', 'Units removed at interventions', null, null::jsonb, null),
  ('unit-reconcile', 'other', 'Other losses', null, null::jsonb, null),
  ('vehicle', 'temperature', 'Temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('vehicle', 'quantity', 'Quantity collected', 'quantityLimit', null::jsonb, 'each'),
  ('visual-inspect', 'unitsIn', 'Units in', null, null::jsonb, null),
  ('visual-inspect', 'particles', 'Rejects: particles', null, null::jsonb, null),
  ('visual-inspect', 'glass', 'Rejects: glass or container defects', null, null::jsonb, null),
  ('visual-inspect', 'fillLevel', 'Rejects: fill level', null, null::jsonb, null),
  ('visual-inspect', 'closure', 'Rejects: closure', null, null::jsonb, null),
  ('visual-inspect', 'other', 'Rejects: other', null, null::jsonb, null),
  ('visual-inspect', 'samples', 'Samples', null, null::jsonb, null),
  ('visual-inspect', 'unitsOut', 'Good units out', null, null::jsonb, null),
  ('chamber-seal', 'readings', 'Position or peel strength per unit', null, null::jsonb, null),
  ('column', 'volume', 'Fraction volume', null, null::jsonb, null),
  ('column', 'conductivity', 'Conductivity', 'conductivityLimit', null::jsonb, 'each'),
  ('em-filling', 'particles05', 'Particles ≥ 0.5 µm', 'particles05Limit', null::jsonb, 'each'),
  ('em-filling', 'particles5', 'Particles ≥ 5 µm', 'particles5Limit', null::jsonb, 'each'),
  ('evaporate', 'pressure', 'Absolute pressure', 'pressureLimit', null::jsonb, 'each'),
  ('evaporate', 'bath', 'Bath temperature', 'bathLimit', null::jsonb, 'each'),
  ('ffs-run', 'weights', 'Net fill weight per unit', 'meanLimit', null::jsonb, 'mean'),
  ('ffs-run', 'counter', 'Counter', null, null::jsonb, null),
  ('ffs-run', 'parison', 'Parison (extrusion) temperature (BFS)', 'parisonLimit', null::jsonb, 'each'),
  ('harden', 'temperature', 'Temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('harden', 'speed', 'Stirring speed', null, null::jsonb, null),
  ('harden', 'washes', 'Wash rounds', null, null::jsonb, null),
  ('homogenise', 'pressure', 'Pressure', 'pressureLimit', null::jsonb, 'each'),
  ('homogenise', 'speed', 'Speed', 'speedLimit', null::jsonb, 'each'),
  ('homogenise', 'outlet', 'Outlet temperature', 'outletLimit', null::jsonb, 'each'),
  ('incubate', 'temperature', 'Temperature (product, for a freeze)', 'temperatureLimit', null::jsonb, 'each'),
  ('incubate', 'ph', 'pH', null, null::jsonb, null),
  ('incubate', 'extent', 'Extent (encapsulated or adsorbed)', 'extentLimit', null::jsonb, 'each'),
  ('incubated-em', 'count', 'Count', 'countLimit', null::jsonb, 'each'),
  ('incubated-lab', 'count', 'Count (CFU; a BI: 0 = no growth)', 'countLimit', null::jsonb, 'each'),
  ('incubated-results', 'count', 'Count (CFU; a BI: 0 = no growth)', 'countLimit', null::jsonb, 'each'),
  ('interventions', 'removed', 'Units removed', null, null::jsonb, null),
  ('isolator-decon', 'leakRate', 'Leak test', 'leakLimit', null::jsonb, 'each'),
  ('isolator-decon', 'h2o2', 'H2O2 at the end of aeration', 'h2o2Limit', null::jsonb, 'each'),
  ('lyo-cycle', 'freezeShelfMin', 'Freezing: lowest shelf temperature', 'freezeLimit', null::jsonb, 'each'),
  ('lyo-cycle', 'primaryPressureMax', 'Primary drying: highest chamber pressure', 'primaryPressureLimit', null::jsonb, 'each'),
  ('lyo-cycle', 'primaryShelfMax', 'Primary drying: highest shelf temperature', 'primaryShelfLimit', null::jsonb, 'each'),
  ('lyo-cycle', 'secondaryShelfMax', 'Secondary drying: highest shelf temperature', 'secondaryShelfLimit', null::jsonb, 'each'),
  ('lyo-cycle', 'productMax', 'Highest product probe temperature', 'productLimit', null::jsonb, 'each'),
  ('lyo-cycle', 'pressureRise', 'End of primary: pressure rise (or Pirani − capacitance)', 'riseLimit', null::jsonb, 'each'),
  ('lyo-load', 'leakRate', 'Chamber leak rate', 'leakLimit', null::jsonb, 'each'),
  ('lyo-load', 'shelfTemp', 'Shelf temperature', 'shelfLimit', null::jsonb, 'each'),
  ('lyo-load', 'loaded', 'Vials or trays loaded', null, null::jsonb, null),
  ('lyo-load', 'probes', 'Product probes placed', null, null::jsonb, null),
  ('lyo-unload', 'stopperPressure', 'Stoppering pressure (absolute)', 'stopperLimit', null::jsonb, 'each'),
  ('lyo-unload', 'unloaded', 'Units or trays unloaded', null, null::jsonb, null),
  ('lyo-unload', 'damaged', 'Not stoppered or damaged', null, null::jsonb, null),
  ('phase-prep', 'temperature', 'Temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('plunger-check', 'position', 'Plunger position per unit', null, null::jsonb, null),
  ('plunger-check', 'bubble', 'Largest bubble', 'bubbleLimit', null::jsonb, 'each'),
  ('rtu-bags', 'carriers', 'Carriers', null, null::jsonb, null),
  ('rtu-bags', 'decay', 'Pressure decay per carrier', null, null::jsonb, null),
  ('rtu-tubs', 'received', 'Tubs received', null, null::jsonb, null),
  ('rtu-tubs', 'used', 'Tubs used', null, null::jsonb, null),
  ('size-check', 'size', 'd50 or Z-average', 'sizeLimit', null::jsonb, 'each'),
  ('size-check', 'd90', 'd90', 'd90Limit', null::jsonb, 'each'),
  ('size-check', 'pdi', 'PDI', 'pdiLimit', null::jsonb, 'each'),
  ('size-check', 'pfat5', 'PFAT5 (% fat > 5 µm)', 'pfat5Limit', null::jsonb, 'each'),
  ('spray-dry', 'inlet', 'Inlet temperature', 'inletLimit', null::jsonb, 'each'),
  ('spray-dry', 'outlet', 'Outlet temperature', 'outletLimit', null::jsonb, 'each'),
  ('spray-dry', 'feed', 'Feed rate', null, null::jsonb, null),
  ('spray-dry', 'gas', 'Atomising gas', null, null::jsonb, null),
  ('spray-dry', 'solvent', 'Residual solvent', 'solventLimit', null::jsonb, 'each'),
  ('spray-dry', 'lod', 'Loss on drying', 'lodLimit', null::jsonb, 'each'),
  ('spray-dry', 'powder', 'Powder collected', null, null::jsonb, null),
  ('tff', 'retentate', 'Retentate volume', null, null::jsonb, null),
  ('tff', 'permeate', 'Permeate collected so far', null, null::jsonb, null),
  ('tff', 'tmp', 'Transmembrane pressure', 'tmpLimit', null::jsonb, 'each'),
  ('tff', 'temperature', 'Temperature', null, null::jsonb, null),
  ('tff', 'endValue', 'Ethanol or conductivity at the end', 'endLimit', null::jsonb, 'each'),
  ('container-issue', 'issued', 'Quantity issued', null, null::jsonb, null),
  ('container-issue', 'returned', 'Count returned to stores at the end', null, null::jsonb, null),
  ('container-return', 'returned', 'Quantity returned to stores', null, null::jsonb, null),
  ('device-assembly', 'issued', 'Components issued', null, null::jsonb, null),
  ('device-assembly', 'unitsIn', 'Filled units fed to the line', null, null::jsonb, null),
  ('device-assembly', 'tested', 'Devices tested for function', null, null::jsonb, null),
  ('device-assembly', 'failed', 'Devices that failed the function test', null, '{"high":"0","unit":"units"}'::jsonb, 'each'),
  ('device-assembly', 'force', 'Activation force (mean of the tested devices)', 'forceLimit', null::jsonb, 'each'),
  ('device-assembly', 'inspected', 'Devices inspected (AQL sample)', null, null::jsonb, null),
  ('device-assembly', 'critical', 'Critical defects found', null, null::jsonb, null),
  ('device-assembly', 'major', 'Major defects found', null, null::jsonb, null),
  ('device-assembly', 'minor', 'Minor defects found', null, null::jsonb, null),
  ('device-assembly', 'good', 'Good devices assembled', null, null::jsonb, null),
  ('device-assembly', 'rejected', 'Devices rejected', null, null::jsonb, null),
  ('device-assembly', 'samples', 'Devices taken as samples (QC and reserve)', null, null::jsonb, null),
  ('device-assembly', 'componentRejects', 'Components rejected (damaged, not assembled)', null, null::jsonb, null),
  ('device-assembly', 'returned', 'Components returned to stores', null, null::jsonb, null)
;

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view reading_v1 with (security_barrier) as
select b.batch_no || '/' || concat_ws('.', c.stage, c.sub, c.step, c.round) || '/' || c.field || '/' || r.n as reading_id,
  b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  v.doc->'stages'->c.stage->>'name' as stage, (v.doc->'stages'->c.stage->>'key') || '/' || (st.step->>'key') as step,
  coalesce(d.place, (v.doc->'stages'->c.stage->>'name') || ' › ' || (st.step->>'key')) as step_name, c.sub as sub_batch, c.round,
  p.block, case when p.block = 'check' and st.step->'settings'->>'what' <> '' then st.step->'settings'->>'what' else p.label end as parameter,
  p.field, r.n::int as reading_no, (r.x->>'value')::numeric as value, r.x->>'unit' as unit,
  case when coalesce(lim.l, p.fixed_limit)->>'low' ~ '^-?[0-9]+(\.[0-9]+)?$' then (coalesce(lim.l, p.fixed_limit)->>'low')::numeric end as low_limit,
  case when coalesce(lim.l, p.fixed_limit)->>'high' ~ '^-?[0-9]+(\.[0-9]+)?$' then (coalesce(lim.l, p.fixed_limit)->>'high')::numeric end as high_limit,
  coalesce(lim.l, p.fixed_limit)->>'unit' as limit_unit, case when coalesce(lim.l, p.fixed_limit) is null then null else p.limit_of end as limit_of,
  c.at as recorded_at, c.kind = 'corrected' as corrected, now() as read_at, c.at as data_as_of
from (
  -- The current value of each field of each round of a step: the last value or correction that recorded it.
  select distinct on (x.batch_id, x.stage, x.sub, x.step, x.round, f.key) x.batch_id, x.stage, x.sub, x.step, x.round, f.key as field, f.value, x.kind, x.at
  from step_events x cross join jsonb_each(x.payload->'values') f
  where x.kind in ('value', 'corrected') and jsonb_typeof(x.payload->'values') = 'object'
  order by x.batch_id, x.stage, x.sub, x.step, x.round, f.key, x.id desc
) c
join batches b on b.id = c.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (select v.doc->'stages'->c.stage->'steps'->c.step as step) st
join reading_parameters p on p.block = st.step->'block'->>'id' and p.field = c.field
-- Signed done (this round), with the step's place in words as kept with its start.
cross join lateral (
  select bool_or(e.kind = 'done') as done, (array_agg(e.payload->>'where' order by e.id) filter (where e.kind = 'started'))[1] as place
  from step_events e where e.batch_id = c.batch_id and e.stage = c.stage and e.sub = c.sub and e.step = c.step and e.round = c.round
) d
-- One reading, or each reading of a list in order.
cross join lateral (
  select c.value as x, 1::bigint as n where jsonb_typeof(c.value) = 'object'
  union all
  select a.x, a.n from jsonb_array_elements(case when jsonb_typeof(c.value) = 'array' then c.value else '[]' end) with ordinality a(x, n)
) r
-- The master step's limit, when it is a written one (low and/or high with a unit; not an earlier step's result).
left join lateral (
  select st.step->'settings'->p.limit_setting as l
  where p.limit_setting is not null and jsonb_typeof(st.step->'settings'->p.limit_setting) = 'object' and st.step->'settings'->p.limit_setting ? 'unit'
) lim on true
where d.done and jsonb_typeof(r.x) = 'object' and r.x->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$';

revoke all on reading_v1 from public;
comment on view reading_v1 is 'One row per recorded number of a step signed done (process parameters and in-process checks), with the master''s limits; for continued process verification (Operations).';
comment on column reading_v1.limit_of is 'each: the limit applies to each reading; mean: to the mean of the list (T7). Null without a limit.';

reset search_path;
