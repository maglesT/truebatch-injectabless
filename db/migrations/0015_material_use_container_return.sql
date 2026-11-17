-- material_use_v1 (owner, 17 Nov 2026, run 2 findings G9 and G10): version 2 of the container issue (block
-- container-issue) names its container or closure from the master's containers (master data), and what is left at the
-- end is counted back in its own step (block container-return), as TrueBatch Injectables Packing counts back a printed
-- material (packing/migrations/0104). Same columns, same rows; only:
--   quantity = for a version 2 issue: the count issued less "Count returned to stores" of the container-return step of
--              the same material in the same batch, once that step is signed done (before it: the count issued), never
--              below 0; a version 1 issue as 0013 (less its own "returned at the end"); then less what a terminated
--              batch gave back, as 0012;
--   material_code, material_master_id = of the formula line or, now, of the master's container or closure the step
--              names (null for a version 1 issue, which names what it issues in words);
--   data_as_of = the later of the issue's and the count back's last event.
-- MMS matches each row to its lot by lot_number, as before. The app works out the same (shared/engine/stock.ts).
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
  case when w.returned > 0 then greatest(w.data_as_of, w.returned_at, w.back_at) else greatest(w.data_as_of, w.back_at) end as data_as_of, w.step_name
from (
  select s.batch_id, s.stage, s.sub, s.step as step_no, s.round,
    b.batch_no as batch_number, cur.lot as lot_number, line.l->>'code' as material_code, line.l->>'materialItemId' as material_master_id,
    q.quantity, q.unit, ev.done_at as dispensed_at,
    (v.doc->'stages'->s.stage->>'key') || '/' || (st.step->>'key') as step, cur.event_id,
    case when ev.corrected then 'corrected' else 'dispensed' end as status, now() as read_at, ev.last as data_as_of,
    coalesce(ev.place, (v.doc->'stages'->s.stage->>'name') || ' › ' || (st.step->>'key')) as step_name,
    ret.n as returned, ret.at as returned_at, back.last as back_at
  from (select distinct batch_id, stage, sub, step, round from step_events where kind = 'done') s
  join batches b on b.id = s.batch_id
  join master_versions v on v.id = b.master_version_id
  cross join lateral (select v.doc->'stages'->s.stage->'steps'->s.step as step, v.doc->'stages'->s.stage->'steps'->s.step->'block'->>'id' as block,
    (v.doc->'stages'->s.stage->'steps'->s.step->'block'->>'version')::int as version) st
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
  -- A version 2 container issue: the count back of the same material, signed done: its current "Count returned to stores".
  left join lateral (
    select (rv.returned->>'value')::numeric as n, rv.last
    from jsonb_array_elements(v.doc->'stages') with ordinality rs(stage, si)
    cross join lateral jsonb_array_elements(rs.stage->'steps') with ordinality rt(step, ti)
    cross join lateral (
      select (array_agg(y.payload->'values'->'returned' order by y.id desc) filter (where y.kind in ('value', 'corrected') and y.payload->'values' ? 'returned'))[1] as returned,
        bool_or(y.kind = 'done') as done, max(y.at) as last
      from step_events y where y.batch_id = s.batch_id and y.stage = rs.si - 1 and y.step = rt.ti - 1
    ) rv
    where st.block = 'container-issue' and st.version > 1 and rt.step->'block'->>'id' = 'container-return'
      and rt.step->'settings'->'material'->>'formula' = st.step->'settings'->'material'->>'formula'
      and rv.done and jsonb_typeof(rv.returned) = 'object' and rv.returned->>'unit' = cur.issued->>'unit'
    limit 1
  ) back on true
  cross join lateral (select
    case when st.block = 'container-issue'
      then greatest((cur.issued->>'value')::numeric - case when st.version = 1 and jsonb_typeof(cur.back) = 'object' and cur.back->>'unit' = cur.issued->>'unit'
        then (cur.back->>'value')::numeric when st.version > 1 then coalesce(back.n, 0) else 0 end, 0)
      else (cur.net->>'value')::numeric end as n,
    case when st.block = 'container-issue' then cur.issued->>'unit' else cur.net->>'unit' end as u, ev.stock_unit as su) r
  cross join lateral (select
    case when lower(r.su) = 'kg' and r.u = 'g' then r.n * 0.001 when lower(r.su) = 'kg' and r.u = 'mg' then r.n * 0.000001 else r.n end as quantity,
    case when lower(r.su) = 'kg' and r.u in ('kg', 'g', 'mg') then r.su
         when r.u = 'units' and lower(r.su) in ('nos', 'no', 'nos.', 'no.', 'units', 'unit', 'pcs', 'pc', 'pieces', 'each', 'ea', 'numbers') then r.su
         else r.u end as unit) q
  left join lateral (
    select l from jsonb_array_elements(coalesce(v.doc->'formula', '[]') || coalesce(v.doc->'containers', '[]')) l where l->>'key' = (
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
