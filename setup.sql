-- Jalankan SEKALI di Supabase: SQL Editor -> New query -> paste -> Run
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'trader',
  avatar text,
  monthly_target numeric not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trade_date date not null,
  side text not null check (side in ('buy','sell')),
  entry numeric, tp numeric, sl numeric, lot numeric,
  pnl numeric not null default 0,
  session text, note text,
  created_at timestamptz not null default now()
);
create table if not exists public.cashflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  flow_date date not null,
  kind text not null check (kind in ('deposit','withdraw')),
  usd numeric not null,
  idr numeric,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists trades_user_date on public.trades(user_id, trade_date);
create index if not exists cash_user_date on public.cashflows(user_id, flow_date);

alter table public.profiles enable row level security;
alter table public.trades enable row level security;
alter table public.cashflows enable row level security;

create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own trades" on public.trades for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own cash" on public.cashflows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
