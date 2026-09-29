-- Make every mobile push category opt-out by default for new preference rows.
-- Existing user choices are preserved.

alter table public.push_preferences
  alter column messages set default true,
  alter column replies set default true,
  alter column circles set default true,
  alter column social set default true,
  alter column announcements set default true,
  alter column reactions set default true,
  alter column sound set default true;
