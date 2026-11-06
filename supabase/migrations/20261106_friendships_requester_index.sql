-- Performance advisor: friendships_requester_fkey had no covering index (additive, no data or RLS change).
create index if not exists friendships_requester on public.friendships (requester);
