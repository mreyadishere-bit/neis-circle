
revoke all on function public.join_private_circle_by_key(text,text) from public, anon;
revoke all on function public.private_circle_key_status(uuid) from public, anon;
revoke all on function public.rotate_private_circle_key(uuid) from public, anon;
revoke all on function public.set_private_circle_key_enabled(uuid,boolean) from public, anon;

grant execute on function public.join_private_circle_by_key(text,text) to authenticated;
grant execute on function public.private_circle_key_status(uuid) to authenticated;
grant execute on function public.rotate_private_circle_key(uuid) to authenticated;
grant execute on function public.set_private_circle_key_enabled(uuid,boolean) to authenticated;
