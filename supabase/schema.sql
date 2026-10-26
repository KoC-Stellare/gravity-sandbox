-- Gravity SandBox database (already applied to the Supabase project "gravity-sanbox").
-- Kept here for reference / to recreate the project. Run in the SQL editor of an EMPTY project.

-- PROFILES -------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  color text not null default '#4fc3d9' check (color ~ '^#[0-9a-fA-F]{6}$'),
  settings jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 16384),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));
alter table public.profiles enable row level security;

-- FRIENDSHIPS ----------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee on public.friendships (addressee);
alter table public.friendships enable row level security;

-- MAPS -----------------------------------------------------------------
create table public.maps (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  data jsonb not null,
  object_count int not null default 0 check (object_count between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pg_column_size(data) < 1000000)
);
create index maps_owner on public.maps (owner);
alter table public.maps enable row level security;

create table public.map_links (
  map_id uuid primary key references public.maps(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.map_links enable row level security;

create table public.map_shares (
  map_id uuid not null references public.maps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (map_id, user_id)
);
create index map_shares_user on public.map_shares (user_id);
alter table public.map_shares enable row level security;

-- HELPERS (private schema, not exposed by the API) -------------------
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;
create or replace function private.owns_map(m uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.maps where id = m and owner = (select auth.uid()));
$$;
create or replace function private.map_shared_with_me(m uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.map_shares where map_id = m and user_id = (select auth.uid()));
$$;
revoke execute on function private.are_friends(uuid, uuid), private.owns_map(uuid), private.map_shared_with_me(uuid) from public, anon;
grant execute on function private.are_friends(uuid, uuid), private.owns_map(uuid), private.map_shared_with_me(uuid) to authenticated;

-- New user -> profile (username from sign-up metadata, fallback if taken/invalid)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uname text;
begin
  uname := coalesce(new.raw_user_meta_data->>'username', '');
  if uname !~ '^[A-Za-z0-9_]{3,20}$' or exists (select 1 from public.profiles where lower(username) = lower(uname)) then
    uname := 'player_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, username, color)
  values (new.id, uname, coalesce(nullif(new.raw_user_meta_data->>'color', ''), '#4fc3d9'));
  return new;
end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end; $$;
create trigger maps_touch before update on public.maps for each row execute function public.touch_updated_at();

create or replace function public.friendship_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.requester <> old.requester or new.addressee <> old.addressee then raise exception 'cannot change friendship participants'; end if;
  return new;
end; $$;
create trigger friendships_guard before update on public.friendships for each row execute function public.friendship_guard();

-- ROW LEVEL SECURITY ----------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy friendships_select on public.friendships for select to authenticated using ((select auth.uid()) in (requester, addressee));
create policy friendships_insert on public.friendships for insert to authenticated with check (requester = (select auth.uid()) and status = 'pending');
create policy friendships_accept on public.friendships for update to authenticated using (addressee = (select auth.uid())) with check (addressee = (select auth.uid()) and status = 'accepted');
create policy friendships_delete on public.friendships for delete to authenticated using ((select auth.uid()) in (requester, addressee));

create policy maps_select on public.maps for select to authenticated using (owner = (select auth.uid()) or private.map_shared_with_me(id));
create policy maps_insert on public.maps for insert to authenticated with check (owner = (select auth.uid()));
create policy maps_update on public.maps for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy maps_delete on public.maps for delete to authenticated using (owner = (select auth.uid()));

create policy map_links_all on public.map_links for all to authenticated using (private.owns_map(map_id)) with check (private.owns_map(map_id));

create policy map_shares_select on public.map_shares for select to authenticated using (user_id = (select auth.uid()) or private.owns_map(map_id));
create policy map_shares_insert on public.map_shares for insert to authenticated with check (private.owns_map(map_id) and private.are_friends((select auth.uid()), user_id));
create policy map_shares_delete on public.map_shares for delete to authenticated using (user_id = (select auth.uid()) or private.owns_map(map_id));

-- Open a map by its secret link (works without an account)
create or replace function public.get_map_by_token(t text)
returns table (id uuid, name text, data jsonb, owner_name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.name, m.data, p.username
  from public.map_links l join public.maps m on m.id = l.map_id join public.profiles p on p.id = m.owner
  where l.token = t and char_length(t) >= 24;
$$;
revoke execute on function public.get_map_by_token(text) from public;
grant execute on function public.get_map_by_token(text) to anon, authenticated;

-- EXPLICIT TABLE PERMISSIONS (auto-expose is off) ------------------------
revoke all on public.profiles, public.friendships, public.maps, public.map_links, public.map_shares from anon, authenticated;
grant select, update (username, color, settings) on public.profiles to authenticated;
grant select, insert, update (status), delete on public.friendships to authenticated;
grant select, insert, update (name, data, object_count), delete on public.maps to authenticated;
grant select, insert, delete on public.map_links to authenticated;
grant select, insert, delete on public.map_shares to authenticated;
