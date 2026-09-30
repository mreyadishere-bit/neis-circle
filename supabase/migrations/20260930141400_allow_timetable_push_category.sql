alter table public.push_notification_outbox
drop constraint if exists push_notification_outbox_category_check;

alter table public.push_notification_outbox
add constraint push_notification_outbox_category_check
check (category in ('messages','replies','circles','social','announcements','reactions','timetable'));