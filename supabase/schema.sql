-- Pennywise cloud sync. Paste this whole file into Supabase > SQL Editor > Run.
-- It is safe to run more than once.
--
-- One table holds every record of every household. The table itself is locked down
-- (row level security on, no policies), so the public "anon" key cannot read or write it
-- directly. The app only talks to the two functions below, and both require the
-- household code: a long random secret generated on your phone. Whoever has the
-- pairing code can read and write that household's data, so share it only with your partner.

create sequence if not exists public.pw_seq;

create table if not exists public.pw_records (
  household  text    not null,
  id         text    not null,
  kind       text    not null,
  data       jsonb   not null default '{}'::jsonb,
  updated_at bigint  not null,
  deleted    boolean not null default false,
  seq        bigint  not null default nextval('public.pw_seq'),
  primary key (household, id)
);
create index if not exists pw_records_seq on public.pw_records (household, seq);
alter table public.pw_records enable row level security;

-- Returns rows changed since the caller's cursor, oldest change first.
create or replace function public.pw_pull(p_household text, p_since bigint, p_limit int default 1000)
returns table (id text, kind text, data jsonb, updated_at bigint, deleted boolean, seq bigint)
language sql security definer set search_path = public as $$
  select r.id, r.kind, r.data, r.updated_at, r.deleted, r.seq
  from pw_records r
  where r.household = p_household and length(p_household) >= 20 and r.seq > p_since
  order by r.seq
  limit least(greatest(p_limit, 1), 1000);
$$;

-- Upserts a batch of rows. A row only overwrites the stored one if it was edited later.
create or replace function public.pw_push(p_household text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if length(p_household) < 20 then raise exception 'invalid household code'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'too many rows in one batch'; end if;
  insert into pw_records as r (household, id, kind, data, updated_at, deleted)
  select p_household, x.id, x.kind, coalesce(x.data, '{}'::jsonb), x.updated_at, coalesce(x.deleted, false)
  from jsonb_to_recordset(p_rows) as x(id text, kind text, data jsonb, updated_at bigint, deleted boolean)
  on conflict (household, id) do update
    set kind = excluded.kind, data = excluded.data, updated_at = excluded.updated_at,
        deleted = excluded.deleted, seq = nextval('pw_seq')
    where excluded.updated_at > r.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.pw_pull(text, bigint, int) from public;
revoke all on function public.pw_push(text, jsonb) from public;
grant execute on function public.pw_pull(text, bigint, int) to anon, authenticated;
grant execute on function public.pw_push(text, jsonb) to anon, authenticated;
