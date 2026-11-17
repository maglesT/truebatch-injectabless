-- material_use_v1 (owner, 17 Nov 2026, demo finding F20): containers and closures (vials, stoppers, seals, syringes,
-- plungers ...) issued by count from an MMS lot (block container-issue) are uses too, beside the weighings, so MMS
-- takes them off the lot's stock as it does for a weighing. Same columns, in the same order; only new rows:
--   quantity = the count issued less the count returned unused at the end (the step's current values, corrections
--              included), never below 0; less what a terminated batch gave back, as 0012;
--   unit     = 'units' (MMS counts units as nos, D-59); material_code and material_master_id are null (the step names
--              what it issues in words, not a master-data material): MMS matches the row to its lot by lot_number.
-- The app works out the same quantities (shared/engine/stock.ts usedQuantity).
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view material_use_v1 with (security_barrier) as
select w.batch_number, w.lot_number, w.material_code, w.material_master_id,
  w.quantity - least(w.quantity, greatest(coalesce(w.returned, 0) - coalesce(sum(w.quantity) over (partition by w.batch_id, lower(w.lot_number), w.unit
    order by w.stage desc, w.sub desc, w.step_no desc, w.round desc rows between unbounded preceding and 1 preceding), 0), 0)) as quantity,
  w.unit, w.dispensed_at, w.step, w.event_id, w.status, w.read_at,
  case when w.returned > 0 then greatest(w.data_as_of, w.returned_at) else w.data_as_of end as data_as_of, w.step_name
from (
  select s.batch_id, s.stage, s.sub, s.step as step_no, s.round,
    b.batch_no as batch_number, cur.lot as lot_number, line.l->>'code' as material_code, line.l->>'materialItemId' as material_master_id,
    q.quantity, q.unit, ev.done_at as dispensed_at,
    (v.doc->'stages'->s.stage->>'key') || '/' || (st.step->>'key') as step, cur.event_id,
    case when ev.corrected then 'corrected' else 'dispensed' end as status, now() as read_at, ev.last as data_as_of,
    coalesce(ev.place, (v.doc->'stages'->s.stage->>'name') || ' › ' || (st.step->>'key')) as step_name,
    ret.n as returned, ret.at as returned_at
  from (select distinct batch_id, stage, sub, step, round from step_events where kind = 'done') s
  join batches b on b.id = s.batch_id
  join master_versions v on v.id = b.master_version_id
  cross join lateral (select v.doc->'stages'->s.stage->'steps'->s.step as step, v.doc->'stages'->s.stage->'steps'->s.step->'block'->>'id' as block) st
  cross join lateral (
    select min(x.at) filter (where x.kind = 'done') as done_at, bool_or(x.kind = 'corrected') as corrected, max(x.at) as last,
      (array_agg(x.payload->>'where' order by x.id) filter (where x.kind = 'started'))[1] as place,
      (array_agg(x.payload->>'stockUnit' order by x.id desc) filter (where x.payload ? 'stockUnit'))[1] as stock_unit
    from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.round = s.round
  ) ev
  -- The step's current values: a weighing's net weight (its last result), a container issue's counts, and the lot.
  cross join lateral (
    select (array_agg(x.id order by x.id desc) filter (where x.payload->'results' ? 'net'
        or (x.kind in ('value', 'corrected') and x.payload->'values' ?| array['issued', 'returned'])))[1] as event_id,
      (array_agg(x.payload->'results'->'net' order by x.id desc) filter (where x.payload->'results' ? 'net'))[1] as net,
      (array_agg(x.payload->'values'->'issued' order by x.id desc) filter (where x.kind in ('value', 'corrected') and x.payload->'values' ? 'issued'))[1] as issued,
      (array_agg(x.payload->'values'->'returned' order by x.id desc) filter (where x.kind in ('value', 'corrected') and x.payload->'values' ? 'returned'))[1] as back,
      (array_agg(x.payload->'values'->>'lot' order by x.id desc) filter (where x.kind in ('value', 'corrected') and x.payload->'values' ? 'lot'))[1] as lot
    from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.round = s.round
  ) cur
  cross join lateral (select
    case when st.block = 'container-issue'
      then greatest((cur.issued->>'value')::numeric - case when jsonb_typeof(cur.back) = 'object' and cur.back->>'unit' = cur.issued->>'unit'
        then (cur.back->>'value')::numeric else 0 end, 0)
      else (cur.net->>'value')::numeric end as n,
    case when st.block = 'container-issue' then cur.issued->>'unit' else cur.net->>'unit' end as u, ev.stock_unit as su) r
  cross join lateral (select
    case when lower(r.su) = 'kg' and r.u = 'g' then r.n * 0.001 when lower(r.su) = 'kg' and r.u = 'mg' then r.n * 0.000001 else r.n end as quantity,
    case when lower(r.su) = 'kg' and r.u in ('kg', 'g', 'mg') then r.su
         when r.u = 'units' and lower(r.su) in ('nos', 'no', 'nos.', 'no.', 'units', 'unit', 'pcs', 'pc', 'pieces', 'each', 'ea', 'numbers') then r.su
         else r.u end as unit) q
  left join lateral (
    select l from jsonb_array_elements(v.doc->'formula') l where l->>'key' = (
      select z.value->>'formula' from jsonb_each(st.step->'settings') z where jsonb_typeof(z.value) = 'object' and z.value ? 'formula' limit 1)
  ) line on true
  -- what QA said went back to stores of this lot when terminating the batch
  left join lateral (
    select (x->>'value')::numeric as n, t.at from batch_events t cross join jsonb_array_elements(t.payload->'returns') x
    where t.batch_id = s.batch_id and t.kind = 'rejected' and t.payload ? 'returns' and lower(x->>'lot') = lower(cur.lot) and x->>'unit' = q.unit
    limit 1
  ) ret on true
  where ((st.block in ('weigh', 'lubricate') and (cur.net->>'ok')::boolean)
    or (st.block = 'container-issue' and jsonb_typeof(cur.issued) = 'object'))
) w;

reset search_path;
