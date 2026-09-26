-- NEIS Circle v30: grant the requested production administrator account.
-- Idempotent: safe to re-run, and the allowlist also covers a future signup.

insert into public.admin_allowlist(email)
values (lower('rereekh175@gmail.com'))
on conflict (email) do nothing;

update public.profiles p
set role = 'admin', updated_at = now()
from auth.users u
where u.id = p.id
  and lower(u.email) = lower('rereekh175@gmail.com');
