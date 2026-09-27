-- Allow Study resources to use the existing report and admin moderation pipeline.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
check (target_type in ('post','comment','profile','circle','message','circle_message','gallery','article','meeting','study_resource'));
