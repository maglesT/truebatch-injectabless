-- steriliser_cycle_v1 (19 Nov 2026, duplicates review item 24; owner rule: the product that owns a job keeps it, the
-- linked one reads it): TrueBatch Injectables owns the sterilisation cycles run for its batches. The batch records the
-- cycle's figures and checks them against the master's validated limits; this view publishes each cycle so the
-- Logbook lists it read-only in the steriliser's (or isolator's) history and types only cycles not made for a batch.
-- One row per signed round of a sterilise (items, equipment, product bulk), terminal-sterilise (each load) or
-- isolator-decon (VHP) step, once it is signed as performed; nothing new is stored (the step events stay insert-only).
--   cycle_id: '<batch number>/<step key>' (stage.sub-batch.step.round), unique; load: the load ID or load number typed;
--   controller_record_ref: the cycle printout reference; cycle_type: steam | dry_heat | sip | vhp (from the block, the
--   machine's type and the terminal step's medium); programme: what the master step sterilises (its setting);
--   result: pass when every check of the step that could be worked out passed, else fail (as the batch shows it);
--   the figures as recorded (corrections included): exposure_min, lowest_temp_c, lowest_f0 (F-min, a terminal load),
--   max_product_temp_c, h2o2_ppm and leak_rate (VHP), units (a terminal load), bi_id (its result is read later),
--   use_by (the load's or the decontamination's); signed: performed, and checked once the second person signed.
-- Lyophilisation and the depyrogenation tunnel stay in the batch record only (continuous product steps, not cycles).
-- Columns are only ever added at the end (0006). Packing does not migrate it (no cycles there).
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create view steriliser_cycle_v1 with (security_barrier) as
select b.batch_no || '/' || k.step_key as cycle_id, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  k.step_key, s.payload->>'where' as step_name, m.value->>'code' as equipment_code, m.value->>'name' as equipment_name,
  m.value->>'type' as equipment_type, m.value->>'room' as room_code,
  case when k.block = 'isolator-decon' then 'vhp'
       when lower(coalesce(m.value->>'type', '')) like '%sip%' then 'sip'
       when lower(coalesce(k.settings->>'medium', '')) like 'dry heat%' or lower(coalesce(m.value->>'type', '')) ~ '(oven|dry heat|hot air)' then 'dry_heat'
       else 'steam' end as cycle_type,
  coalesce(k.settings->>'what', k.settings->>'medium') as programme,
  coalesce(c.v->>'loadId', c.v->>'loadNo') as load, c.v->>'printout' as controller_record_ref,
  s.at as started_at, d.at as ended_at,
  case when exists (select 1 from jsonb_each(c.results) r where r.value->'check'->>'pass' = 'false') then 'fail' else 'pass' end as result,
  (c.v->'exposure'->>'value')::numeric as exposure_min, (c.v->'lowest'->>'value')::numeric as lowest_temp_c,
  (c.v->'lowestF'->>'value')::numeric as lowest_f0, (c.v->'maxProduct'->>'value')::numeric as max_product_temp_c,
  (c.v->'h2o2'->>'value')::numeric as h2o2_ppm, (c.v->'leakRate'->>'value')::numeric as leak_rate,
  (c.v->'units'->>'value')::numeric as units, c.v->>'bi' as bi_id, nullif(c.v->>'useBy', '')::date as use_by,
  case when ck.at is not null then array['performed', 'checked'] else array['performed'] end as signed,
  now() as read_at, greatest(s.at, d.at, ck.at, c.last) as data_as_of
from step_events s
join batches b on b.id = s.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (
  select concat_ws('.', s.stage, s.sub, s.step, s.round) as step_key, v.doc->'stages'->s.stage->'steps'->s.step->'block'->>'id' as block,
    coalesce(v.doc->'stages'->s.stage->'steps'->s.step->'settings', '{}') as settings
) k
-- the step's values now (each field as last recorded or corrected) and the results of its checks as last worked out
cross join lateral (
  select coalesce(jsonb_object_agg(f.key, f.value), '{}') as v, max(f.at) as last,
    coalesce((select x.payload->'results' from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
      and x.round = s.round and x.kind in ('value', 'corrected') order by x.id desc limit 1), '{}') as results
  from (
    select distinct on (f.key) f.key, f.value, e.at from step_events e cross join lateral jsonb_each(e.payload->'values') f
    where e.batch_id = s.batch_id and e.stage = s.stage and e.sub = s.sub and e.step = s.step and e.round = s.round and e.kind in ('value', 'corrected')
    order by f.key, e.id desc
  ) f
) c
cross join lateral (select coalesce(c.v->'steriliser', c.v->'isolator') as value) m
join lateral (
  select max(x.at) as at from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
    and x.round = s.round and x.kind = 'done'
) d on d.at is not null
left join lateral (
  select max(x.at) as at from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
    and x.round = s.round and x.kind = 'checked'
) ck on true
where s.kind = 'started' and k.block in ('sterilise', 'terminal-sterilise', 'isolator-decon') and m.value is not null;

revoke all on steriliser_cycle_v1 from public;

reset search_path;
