-- Disable the user-facing permanent account deletion RPC.
revoke execute on function public.delete_my_account() from public, anon, authenticated;
