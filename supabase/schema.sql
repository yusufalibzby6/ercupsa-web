-- Run once in Supabase SQL Editor. Application tables are accessible only by server service_role.
create table if not exists public.members (id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 1 and 120), class text not null check(class in ('Hazırlık','1','2','3','4','5','Mezun')), created_at timestamptz not null default now());
create table if not exists public.submissions (id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('suggestion','experience')), title text not null check(char_length(title) between 1 and 150), content text not null check(char_length(content) between 1 and 3000), status text not null default 'pending' check(status in ('pending','approved','rejected')), created_at timestamptz not null default now());
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, name text not null check(char_length(name) between 1 and 120), public_name boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.ticket_batches (id uuid primary key, event_id text not null, event_title text not null, codes jsonb not null, created_at timestamptz not null default now());
create table if not exists public.tickets (id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.ticket_batches(id), event_id text not null, code_hash text not null unique, claimed_by uuid references public.profiles(id) on delete set null, claimed_at timestamptz, revoked boolean not null default false);
create table if not exists public.attendance (user_id uuid not null references public.profiles(id) on delete cascade, event_id text not null, event_title text not null, ticket_id uuid not null unique references public.tickets(id), created_at timestamptz not null default now(), primary key(user_id,event_id));
create table if not exists public.request_limits (key text primary key, starts_at timestamptz not null default now(), hits integer not null default 1);
alter table public.members enable row level security;
alter table public.submissions enable row level security;
alter table public.profiles enable row level security;
alter table public.ticket_batches enable row level security;
alter table public.tickets enable row level security;
alter table public.attendance enable row level security;
alter table public.request_limits enable row level security;
revoke all on public.members,public.submissions,public.profiles,public.ticket_batches,public.tickets,public.attendance,public.request_limits from anon,authenticated;
grant all on public.members,public.submissions,public.profiles,public.ticket_batches,public.tickets,public.attendance,public.request_limits to service_role;
create or replace function public.check_rate(p_key text, p_max integer, p_seconds integer) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into request_limits(key) values(p_key) on conflict(key) do update set hits=case when request_limits.starts_at<now()-make_interval(secs=>p_seconds) then 1 else request_limits.hits+1 end, starts_at=case when request_limits.starts_at<now()-make_interval(secs=>p_seconds) then now() else request_limits.starts_at end returning hits into n;
 return n<=p_max;
end; $$;
create or replace function public.create_ticket_batch(p_id uuid,p_event text,p_title text,p_codes jsonb) returns uuid language plpgsql security definer set search_path=public as $$
begin
 if jsonb_array_length(p_codes)<1 or jsonb_array_length(p_codes)>200 then raise exception 'Invalid batch'; end if;
 insert into ticket_batches(id,event_id,event_title,codes) values(p_id,p_event,p_title,p_codes);
 insert into tickets(batch_id,event_id,code_hash) select p_id,p_event,encode(sha256(convert_to(value,'UTF8')),'hex') from jsonb_array_elements_text(p_codes);
 return p_id;
end; $$;
create or replace function public.claim_ticket(p_user uuid,p_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare t tickets%rowtype; title text;
begin
 -- Serialize claims by user, then lock the ticket; neither two tickets for one event nor two users for one ticket can win.
 perform 1 from profiles where id=p_user for update;
 if not found then return jsonb_build_object('error','Önce ad-soyad bilgini kaydet.'); end if;
 select * into t from tickets where code_hash=p_hash for update;
 if not found or t.revoked then return jsonb_build_object('error','Bilet geçersiz veya iptal edilmiş.'); end if;
 if t.claimed_at is not null then return jsonb_build_object('error','Bu bilet daha önce kullanılmış.'); end if;
 if exists(select 1 from attendance where user_id=p_user and event_id=t.event_id) then return jsonb_build_object('error','Bu etkinlik zaten hesabında kayıtlı.'); end if;
 select event_title into title from ticket_batches where id=t.batch_id;
 insert into attendance(user_id,event_id,event_title,ticket_id) values(p_user,t.event_id,title,t.id);
 update tickets set claimed_by=p_user,claimed_at=now() where id=t.id;
 return jsonb_build_object('ok',true);
end; $$;
create or replace function public.badge_board() returns table(name text,total bigint) language sql security definer set search_path=public as $$
 select p.name,count(*) from profiles p join attendance a on a.user_id=p.id where p.public_name=true group by p.id,p.name having count(*)>=3 order by count(*) desc,p.name limit 200;
$$;
revoke execute on function public.check_rate(text,integer,integer), public.create_ticket_batch(uuid,text,text,jsonb),public.claim_ticket(uuid,text),public.badge_board() from public,anon,authenticated;
grant execute on function public.check_rate(text,integer,integer), public.create_ticket_batch(uuid,text,text,jsonb),public.claim_ticket(uuid,text),public.badge_board() to service_role;
