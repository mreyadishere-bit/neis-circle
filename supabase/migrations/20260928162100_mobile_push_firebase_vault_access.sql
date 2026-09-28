create or replace function public.get_firebase_service_account_secret()
returns text
language sql
security definer
set search_path=''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='firebase_service_account_b64'
  limit 1;
$$;

revoke execute on function public.get_firebase_service_account_secret() from public, anon, authenticated;
grant execute on function public.get_firebase_service_account_secret() to service_role;
