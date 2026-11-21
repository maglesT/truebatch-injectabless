-- Fix round 21 Nov 2026 (Tablets A7, ported): material_use_v1 leaves out a weighing undone to weigh another lot until
-- it is signed done again (then its lot and quantity are the new ones: the last recorded). Same name, columns and
-- meaning (0030), replaced in place. Packing does not migrate this file (its material_use_v1 is its own; a packing step
-- is not undone).
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
  -- A7: signed done since it was last undone (an undone weighing is not used until it is signed again).
  from (select distinct d.batch_id, d.stage, d.sub, d.step, d.round from step_events d where d.kind = 'done'
    and not exists (select 1 from step_events u where u.batch_id = d.batch_id and u.stage = d.stage and u.sub = d.sub and u.step = d.step
      and u.round = d.round and u.kind = 'undone' and u.id > d.id)) s
  join batches b on b.id = s.batch_id
  join master_versions v on v.id = b.master_version_id
  cross join lateral (select v.doc->'stages'->s.stage->'steps'->s.step as step, v.doc->'stages'->s.stage->'steps'->s.step->'block'->>'id' as block,
    (v.doc->'stages'->s.stage->'steps'->s.step->'block'->>'version')::int as version) st
  cross join lateral (
    select min(x.at) filter (where x.kind = 'done' and x.id > coalesce((select max(u.id) from step_events u where u.batch_id = s.batch_id and u.stage = s.stage and u.sub = s.sub and u.step = s.step and u.round = s.round and u.kind = 'undone'), 0)) as done_at, bool_or(x.kind = 'corrected') as corrected, max(x.at) as last,
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
  where ((st.block in ('weigh', 'lubricate', 'device-assembly') and (cur.net->>'ok')::boolean)
    or (st.block = 'container-issue' and jsonb_typeof(cur.issued) = 'object'))
) w;

reset search_path;
