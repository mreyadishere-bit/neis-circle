create or replace function public.enforce_community_safety()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  content text;
  bad public.moderation_terms%rowtype;
  actor uuid := auth.uid();
begin
  -- System/admin operations (for example Auth user deletion cascades) do not
  -- have an authenticated end-user JWT. They must not be blocked by the
  -- end-user account-access/content moderation guard.
  if actor is null then
    return new;
  end if;

  if not public.account_is_allowed(actor) then
    raise exception 'account_access_disabled';
  end if;

  content := lower(concat_ws(' ',
    to_jsonb(new)->>'title',to_jsonb(new)->>'body',to_jsonb(new)->>'name',
    to_jsonb(new)->>'description',to_jsonb(new)->>'caption_en',to_jsonb(new)->>'caption_ar',
    to_jsonb(new)->>'title_en',to_jsonb(new)->>'title_ar',to_jsonb(new)->>'excerpt_en',
    to_jsonb(new)->>'excerpt_ar',to_jsonb(new)->>'content_en',to_jsonb(new)->>'content_ar',
    to_jsonb(new)->>'bio',to_jsonb(new)->>'full_name'
  ));

  select * into bad
  from public.moderation_terms m
  where m.active
    and length(trim(m.term))>1
    and position(lower(m.term) in content)>0
  limit 1;

  if found then
    raise exception 'community_content_rejected:%',bad.category;
  end if;

  return new;
end;
$function$;