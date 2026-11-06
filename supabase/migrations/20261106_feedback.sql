-- Feedback box (additive migration: nothing existing is changed).
-- Players may only INSERT message + category; nobody can read feedback through the public API.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null check (char_length(message) between 5 and 1000),
  category text not null default 'altro' check (category in ('bug', 'idea', 'altro')),
  status text not null default 'new' check (status in ('new', 'in_progress', 'in_review', 'done', 'rejected', 'needs_review')),
  result_note text,
  pr_url text,
  handled_at timestamptz,
  -- not just spaces: at least 5 visible characters
  constraint feedback_message_not_blank check (char_length(btrim(message)) >= 5)
);
comment on table public.feedback is 'Player feedback from the in-game Send feedback panel. Insert-only for anon/authenticated; processed later with a server-side key.';

-- for the rate-limit count and for processing the newest first
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status);

alter table public.feedback enable row level security;

-- Permissions: nothing by default, then only INSERT on the two user-facing columns.
revoke all on table public.feedback from public, anon, authenticated;
grant insert (message, category) on table public.feedback to anon, authenticated;

-- Insert-only policies (no SELECT / UPDATE / DELETE policies at all).
-- Logged-in players use the "authenticated" role, so they get the same insert-only rights.
create policy feedback_insert_anon on public.feedback
  for insert to anon
  with check (status = 'new' and result_note is null and pr_url is null and handled_at is null);
create policy feedback_insert_authenticated on public.feedback
  for insert to authenticated
  with check (status = 'new' and result_note is null and pr_url is null and handled_at is null);

-- Anti-spam: at most 30 messages in total per 60 minutes.
-- SECURITY DEFINER so the count sees every row (callers have no SELECT permission and RLS would make it 0);
-- empty search_path + qualified names; an advisory lock makes concurrent inserts count correctly.
create or replace function private.feedback_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(hashtext('public.feedback rate limit'));
  if (select count(*) from public.feedback where created_at > pg_catalog.now() - interval '60 minutes') >= 30 then
    raise exception 'feedback_rate_limited' using errcode = 'P0001', hint = 'Too many feedback messages, try again later.';
  end if;
  return new;
end; $$;
revoke execute on function private.feedback_rate_limit() from public, anon, authenticated;

create trigger feedback_rate_limit before insert on public.feedback
  for each row execute function private.feedback_rate_limit();
