-- batch_fact_v1: the good output and yield of 0017 are null again while the reconciliation is sent back (as TrueBatch
-- Tablets' 0015, 17 Nov 2026): a copy (sub-batch) counts once it is signed done and not sent back since; signed again,
-- it counts again with its current values (a correction counts). Every column as 0017, in the same order, names and
-- types; create or replace keeps the grants the platform's set_link gave.
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view batch_fact_v1 with (security_barrier) as
select md5('truebatch:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  null::text as strength, md5('truebatch:master_version:' || v.id)::uuid as mbr_version_id, v.version_no::text as family_code,
  'PROCESSING'::text as record_kind,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.qc then 'QC_APPROVED'
       when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released,
  now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of,
  (s.started at time zone 'Asia/Kolkata')::date as manufactured_on,
  v.doc->'header'->>'productName' as product_name, v.version_no as master_version,
  gq.good as good_quantity,
  coalesce((select k.w from (values (1, 'syringe', 'syringes'), (2, 'cartridge', 'cartridges'), (3, 'nebule', 'nebules'), (4, 'ampoule', 'ampoules'),
      (5, 'bag', 'bags'), (6, 'bottle', 'bottles'), (7, 'vial', 'vials')) k(n, s, w)
    where lower(v.doc->'header'->>'productName') ~ ('\m' || k.s) order by k.n limit 1), 'units') as good_unit,
  gq.yield as yield_percent
from batches b
join master_versions v on v.id = b.master_version_id
left join lateral (
  select bool_or(x.kind = 'released') as released, bool_or(x.kind = 'rejected') as rejected, bool_or(x.kind = 'qc_approved') as qc,
    min(x.at) filter (where x.kind = 'production_approved') as produced, max(x.at) as last
  from batch_events x where x.batch_id = b.id
) e on true
left join lateral (
  select max(x.at) as last, min(x.at) filter (where x.kind = 'started') as started from step_events x where x.batch_id = b.id
) s on true
-- The master's last reconciliation of units.
left join lateral (
  select (st.i - 1)::int as stage, (sp.j - 1)::int as step
  from jsonb_array_elements(v.doc->'stages') with ordinality st(x, i), jsonb_array_elements(st.x->'steps') with ordinality sp(y, j)
  where sp.y->'block'->>'id' = 'unit-reconcile' order by st.i desc, sp.j desc limit 1
) rc on true
-- Its good units and yield, per signed copy (sub-batch) not sent back since, then for the batch.
left join lateral (
  select sum(c.good) as good,
    case when count(*) = 1 then max(c.yield) when bool_and(c.yield > 0) then round(sum(c.good) * 100 / sum(c.good * 100 / c.yield), 2) end as yield
  from (select x.sub from step_events x where x.batch_id = b.id and x.stage = rc.stage and x.step = rc.step and x.round = 1 and x.kind in ('done', 'sent_back')
          group by x.sub having (array_agg(x.kind order by x.id desc))[1] = 'done') d
  cross join lateral (
    select (select (y.payload->'values'->'good'->>'value')::numeric from step_events y
              where y.batch_id = b.id and y.stage = rc.stage and y.sub = d.sub and y.step = rc.step and y.round = 1
                and y.kind in ('value', 'corrected') and y.payload->'values' ? 'good' order by y.id desc limit 1) as good,
           (select (y.payload->'results'->'yield'->>'value')::numeric from step_events y
              where y.batch_id = b.id and y.stage = rc.stage and y.sub = d.sub and y.step = rc.step and y.round = 1
                and y.payload->'results' ? 'yield' order by y.id desc limit 1) as yield
  ) c
) gq on true;

reset search_path;
