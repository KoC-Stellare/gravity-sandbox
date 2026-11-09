-- Sign-up: lets a visitor check whether a username is free before creating the account.
-- Visitors cannot read public.profiles, so the game's check found nothing and a taken name
-- silently became "player_1a2b3c4d" (the fallback in handle_new_user).
-- Additive: one new function; no table, data or policy is changed. It answers only yes/no.
create or replace function public.username_available(uname text) returns boolean
language sql stable security definer set search_path = '' as $$
  select uname ~ '^[A-Za-z0-9_]{3,20}$'
    and not exists (select 1 from public.profiles p where lower(p.username) = lower(uname));
$$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
