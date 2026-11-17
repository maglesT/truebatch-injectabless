-- deviation_note_v1: source_ref names this product, 'truebatch_injectables:note:<note_id>' (whole-suite run, S22: it
-- said 'truebatch:note:<note_id>', TrueBatch Tablets' name, copied with the view). Deviations files a note by its own
-- ref built from note_id and the product, and TrueBatch Injectables reads it back by this same ref, so only the value
-- changes. Every column as 0008, in the same order, names and types; create or replace keeps the grants the
-- platform's set_link gave. TrueBatch Injectables Packing's view (packing 0103) already names its product.
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view deviation_note_v1 with (security_barrier) as
select n.id as note_id, 'truebatch_injectables:note:' || n.id as source_ref, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  coalesce(n.payload->>'where', (v.doc->'stages'->n.stage->>'key') || '/' || (v.doc->'stages'->n.stage->'steps'->n.step->>'key')) as step,
  n.payload->>'text' as note, n.payload->>'reference' as reference,
  case when n.payload->>'reference' is null then null when c.at is not null then 'closed' else 'open' end as status,
  n.at as noted_at, now() as read_at, greatest(n.at, c.at) as data_as_of
from step_events n
join batches b on b.id = n.batch_id
join master_versions v on v.id = b.master_version_id
left join lateral (
  select min(x.at) as at from batch_events x where x.batch_id = n.batch_id and x.kind = 'deviation_closed' and x.payload->>'note' = n.id::text
) c on true
where n.kind = 'note';

reset search_path;
