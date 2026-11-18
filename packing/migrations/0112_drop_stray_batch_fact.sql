-- Packing does not publish batch_fact_v1 (TrueBatch Injectables does). Migration 0022 was missing from the packing skip
-- list, so it built that view in packing's report schema (no reader was granted it); 0022 is now skipped and the stray
-- view is removed, as TrueBatch Tablets Packing's 0112. The report schema is `report` for an installation in `public`,
-- <s>_report for a test schema <s> (as in 0006).

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  execute format('drop view if exists %I.batch_fact_v1', rep);
end $$;
