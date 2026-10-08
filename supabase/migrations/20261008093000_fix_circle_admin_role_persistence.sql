-- Circle Admin must be a persistent membership role.
alter table public.circle_members
  drop constraint if exists circle_members_member_role_check;

alter table public.circle_members
  add constraint circle_members_member_role_check
  check (role = any (array['member'::text,'moderator'::text,'admin'::text,'owner'::text]));

-- Only Circle managers (or platform admins) may change another member's role.
-- The Circle owner's membership row cannot be demoted through this policy.
drop policy if exists circle_members_manage on public.circle_members;

create policy circle_members_manage
on public.circle_members
for update
to authenticated
using (
  (
    public.is_admin()
    or public.circle_role(circle_id) in ('owner','admin')
  )
  and not exists (
    select 1
    from public.circles c
    where c.id = circle_members.circle_id
      and c.owner_id = circle_members.user_id
  )
)
with check (
  (
    public.is_admin()
    or public.circle_role(circle_id) in ('owner','admin')
  )
  and role in ('member','moderator','admin')
  and not exists (
    select 1
    from public.circles c
    where c.id = circle_members.circle_id
      and c.owner_id = circle_members.user_id
  )
);
