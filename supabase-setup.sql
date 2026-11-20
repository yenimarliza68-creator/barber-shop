create extension if not exists pgcrypto;

create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('cashier', 'owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.barbers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint barbers_name_check check (length(btrim(name)) between 1 and 60)
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price integer not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint services_name_check check (length(btrim(name)) between 1 and 60)
);

create table if not exists public.barber_days_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  off_date date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (barber_id, off_date)
);

create table if not exists public.booking_counters (
  booking_date date primary key,
  current_value integer not null check (current_value > 0)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  phone text,
  service text not null,
  barber text not null,
  date date not null,
  time text not null,
  status text not null default 'Menunggu',
  source text not null default 'Booking',
  created_at timestamptz not null default now()
);

alter table public.bookings add column if not exists price integer not null default 0;
alter table public.bookings add column if not exists paid boolean not null default false;
alter table public.bookings drop constraint if exists bookings_service_check;
alter table public.bookings drop constraint if exists bookings_barber_check;
alter table public.bookings drop constraint if exists bookings_time_check;
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings drop constraint if exists bookings_source_check;
alter table public.bookings drop constraint if exists bookings_price_check;
alter table public.bookings add constraint bookings_price_check check (price >= 0);
alter table public.bookings add constraint bookings_status_check check (status in ('Menunggu', 'Sedang Dicukur', 'Selesai', 'Batal'));
alter table public.bookings add constraint bookings_source_check check (source in ('Booking', 'Walk-in'));
alter table public.bookings add constraint bookings_time_check check (time in ('10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'));

create unique index if not exists bookings_code_date_unique on public.bookings (date, code);
create unique index if not exists bookings_active_slot_unique
  on public.bookings (date, barber, time)
  where status <> 'Batal';
create index if not exists bookings_date_time_idx on public.bookings (date, time);

insert into public.booking_counters (booking_date, current_value)
select date, max(coalesce(nullif(substring(code from '^A-([0-9]+)$'), ''), '0')::integer)
from public.bookings
group by date
having max(coalesce(nullif(substring(code from '^A-([0-9]+)$'), ''), '0')::integer) > 0
on conflict (booking_date) do update
set current_value = greatest(public.booking_counters.current_value, excluded.current_value);

create table if not exists public.queue_public (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  code text not null,
  name text not null,
  barber text not null,
  date date not null,
  time text not null,
  status text not null,
  updated_at timestamptz not null default now()
);

insert into public.barbers (name) values ('Andi'), ('Bima'), ('Raka')
on conflict (name) do nothing;

insert into public.services (name, price) values
  ('Reguler Haircut', 35000),
  ('Haircut + Cuci', 45000),
  ('Shaving', 25000),
  ('Full Package', 65000)
on conflict (name) do nothing;

update public.bookings b
set price = s.price
from public.services s
where b.price = 0 and b.service = s.name;

do $$
begin
  if to_regclass('public.barber_admins') is not null then
    execute 'insert into public.staff_roles (user_id, role) select user_id, ''owner'' from public.barber_admins on conflict (user_id) do nothing';
  end if;
end;
$$;

alter table public.staff_roles enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.barber_days_off enable row level security;
alter table public.booking_counters enable row level security;
alter table public.bookings enable row level security;
alter table public.queue_public enable row level security;

revoke all on public.staff_roles, public.barbers, public.services, public.barber_days_off,
  public.booking_counters, public.bookings, public.queue_public from public, anon, authenticated;
grant select on public.staff_roles to authenticated;
grant select on public.barbers, public.services, public.barber_days_off,
  public.bookings to authenticated;
grant select on public.barbers, public.services, public.barber_days_off,
  public.queue_public to anon, authenticated;

drop policy if exists "Staff can read own role" on public.staff_roles;
create policy "Staff can read own role" on public.staff_roles for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.is_barber_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.staff_roles where user_id = (select auth.uid()));
$$;

create or replace function public.current_barber_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.staff_roles where user_id = (select auth.uid());
$$;

create or replace function public.is_barber_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.staff_roles where user_id = (select auth.uid()) and role = 'owner');
$$;

revoke all on function public.is_barber_staff() from public;
revoke all on function public.current_barber_role() from public;
revoke all on function public.is_barber_owner() from public;
grant execute on function public.is_barber_staff(), public.current_barber_role(), public.is_barber_owner() to authenticated;
grant execute on function public.is_barber_staff() to anon;

drop policy if exists "Public can read active barbers" on public.barbers;
create policy "Public can read active barbers" on public.barbers for select to anon, authenticated
using (active or (select public.is_barber_staff()));

drop policy if exists "Public can read active services" on public.services;
create policy "Public can read active services" on public.services for select to anon, authenticated
using (active or (select public.is_barber_staff()));

drop policy if exists "Public can read barber days off" on public.barber_days_off;
create policy "Public can read barber days off" on public.barber_days_off for select to anon, authenticated
using (off_date >= (now() at time zone 'Asia/Jakarta')::date and off_date <= (now() at time zone 'Asia/Jakarta')::date + 60
  or (select public.is_barber_staff()));

drop policy if exists "Public can read today's public queue" on public.queue_public;
create policy "Public can read today's public queue" on public.queue_public for select to anon, authenticated
using (date = (now() at time zone 'Asia/Jakarta')::date);

drop policy if exists "Staff can read bookings" on public.bookings;
create policy "Staff can read bookings" on public.bookings for select to authenticated
using ((select public.is_barber_staff()));

create or replace function public.sync_public_queue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.queue_public (booking_id, code, name, barber, date, time, status, updated_at)
  values (new.id, new.code, new.name, new.barber, new.date, new.time, new.status, now())
  on conflict (booking_id) do update set
    code = excluded.code, name = excluded.name, barber = excluded.barber,
    date = excluded.date, time = excluded.time, status = excluded.status, updated_at = now();
  return new;
end;
$$;

drop trigger if exists bookings_sync_public_queue on public.bookings;
create trigger bookings_sync_public_queue after insert or update of code, name, barber, date, time, status
on public.bookings for each row execute function public.sync_public_queue();

create or replace function public.get_taken_slots(p_date date, p_barber text)
returns table(time text, is_taken boolean, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  local_today date := (now() at time zone 'Asia/Jakarta')::date;
  barber_active boolean;
  day_off boolean;
begin
  if p_date is null or p_date < local_today or p_date > local_today + 60 or p_barber is null then
    raise exception 'INVALID_BOOKING';
  end if;
  select b.active into barber_active from public.barbers b where b.name = p_barber;
  if not coalesce(barber_active, false) then raise exception 'INVALID_BOOKING'; end if;
  select exists (
    select 1 from public.barber_days_off d join public.barbers b on b.id = d.barber_id
    where b.name = p_barber and d.off_date = p_date
  ) into day_off;
  return query
    select slots.time,
      (day_off or exists (
        select 1 from public.bookings booked
        where booked.date = p_date and booked.barber = p_barber
          and booked.time = slots.time and booked.status <> 'Batal'
      )) as is_taken,
      case when day_off then 'Libur kapster' when exists (
        select 1 from public.bookings booked where booked.date = p_date
          and booked.barber = p_barber and booked.time = slots.time and booked.status <> 'Batal'
      ) then 'Penuh' else '' end as reason
    from unnest(array['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00']) slots(time);
end;
$$;

create or replace function public.create_booking_record(
  p_name text, p_phone text, p_service text, p_barber text,
  p_date date, p_time text, p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_number integer;
  new_id uuid;
  new_code text;
  service_price integer;
  clean_name text := btrim(p_name);
  clean_phone text := coalesce(btrim(p_phone), '');
  local_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if p_source = 'Walk-in' and not public.is_barber_staff() then raise exception 'NOT_STAFF'; end if;
  if clean_name is null or clean_name = '' or length(clean_name) > 60
     or p_time is null or p_time not in ('10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00')
     or p_date is null or p_date < local_today or p_date > local_today + 60
     or p_source is null or p_source not in ('Booking','Walk-in')
     or (p_source = 'Booking' and length(regexp_replace(clean_phone, '\D', '', 'g')) not between 8 and 15)
     or (clean_phone <> '' and length(regexp_replace(clean_phone, '\D', '', 'g')) not between 8 and 15) then
    raise exception 'INVALID_BOOKING';
  end if;
  select s.price into service_price from public.services s where s.name = p_service and s.active;
  if service_price is null then raise exception 'INVALID_BOOKING'; end if;
  if not exists (select 1 from public.barbers b where b.name = p_barber and b.active) then
    raise exception 'INVALID_BOOKING';
  end if;
  if exists (select 1 from public.barber_days_off d join public.barbers b on b.id = d.barber_id
    where b.name = p_barber and d.off_date = p_date) then raise exception 'BARBER_DAY_OFF'; end if;

  insert into public.booking_counters (booking_date, current_value) values (p_date, 1)
  on conflict (booking_date) do update set current_value = public.booking_counters.current_value + 1
  returning current_value into next_number;
  new_code := 'A-' || lpad(next_number::text, 2, '0');
  insert into public.bookings (code, name, phone, service, barber, date, time, status, source, price)
  values (new_code, clean_name, nullif(clean_phone, ''), p_service, p_barber, p_date, p_time, 'Menunggu', p_source, service_price)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'code', new_code, 'price', service_price);
exception
  when unique_violation then raise exception 'SLOT_TAKEN';
end;
$$;

create or replace function public.create_booking(
  p_name text, p_phone text, p_service text, p_barber text, p_date date, p_time text
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.create_booking_record(p_name, p_phone, p_service, p_barber, p_date, p_time, 'Booking');
$$;

create or replace function public.create_walkin(
  p_name text, p_phone text, p_service text, p_barber text, p_date date, p_time text
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.create_booking_record(p_name, p_phone, p_service, p_barber, p_date, p_time, 'Walk-in');
$$;

create or replace function public.transition_booking(p_booking_id uuid, p_next_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_status text;
begin
  if not public.is_barber_staff() then raise exception 'NOT_STAFF'; end if;
  select status into current_status from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  if not ((current_status = 'Menunggu' and p_next_status in ('Sedang Dicukur','Batal'))
    or (current_status = 'Sedang Dicukur' and p_next_status in ('Selesai','Batal'))) then
    raise exception 'INVALID_TRANSITION';
  end if;
  update public.bookings set status = p_next_status where id = p_booking_id;
end;
$$;

create or replace function public.mark_booking_paid(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_barber_staff() then raise exception 'NOT_STAFF'; end if;
  update public.bookings set paid = true
  where id = p_booking_id and status = 'Selesai' and not paid;
  if not found then raise exception 'PAYMENT_NOT_ALLOWED'; end if;
end;
$$;

create or replace function public.lookup_bookings(p_query text)
returns table(code text, date date, time text, barber text, service text, status text, people_ahead integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  search_text text := btrim(coalesce(p_query, ''));
  digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  local_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if length(search_text) < 3 or length(search_text) > 30 then raise exception 'INVALID_QUERY'; end if;
  if upper(search_text) ~ '^A-[0-9]{1,6}$' then
    return query select b.code, b.date, b.time, b.barber, b.service, b.status,
      (select count(*)::integer from public.bookings earlier where earlier.date = b.date
        and earlier.barber = b.barber and earlier.time < b.time
        and earlier.status in ('Menunggu','Sedang Dicukur'))
    from public.bookings b where upper(b.code) = upper(search_text) and b.date >= local_today - 30
    order by b.date desc limit 10;
  elsif length(digits) between 8 and 15 then
    return query select b.code, b.date, b.time, b.barber, b.service, b.status,
      (select count(*)::integer from public.bookings earlier where earlier.date = b.date
        and earlier.barber = b.barber and earlier.time < b.time
        and earlier.status in ('Menunggu','Sedang Dicukur'))
    from public.bookings b where regexp_replace(b.phone, '\D', '', 'g') = digits and b.date >= local_today - 30
    order by b.date desc, b.time limit 10;
  else raise exception 'INVALID_QUERY'; end if;
end;
$$;

create or replace function public.owner_save_barber(p_name text, p_id uuid default null)
returns public.barbers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result public.barbers;
begin
  if not public.is_barber_owner() then raise exception 'NOT_OWNER'; end if;
  if btrim(coalesce(p_name,'')) = '' or length(btrim(p_name)) > 60 then raise exception 'INVALID_MASTER'; end if;
  if p_id is null then
    insert into public.barbers (name) values (btrim(p_name)) returning * into result;
  else
    update public.barbers set name = btrim(p_name) where id = p_id returning * into result;
    if not found then raise exception 'MASTER_NOT_FOUND'; end if;
  end if;
  return result;
end;
$$;

create or replace function public.owner_set_barber_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_barber_owner() then raise exception 'NOT_OWNER'; end if;
  update public.barbers set active = p_active where id = p_id;
  if not found then raise exception 'MASTER_NOT_FOUND'; end if;
end;
$$;

create or replace function public.owner_save_service(p_name text, p_price integer, p_id uuid default null)
returns public.services
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result public.services;
begin
  if not public.is_barber_owner() then raise exception 'NOT_OWNER'; end if;
  if btrim(coalesce(p_name,'')) = '' or length(btrim(p_name)) > 60 or p_price is null or p_price < 0 then
    raise exception 'INVALID_MASTER';
  end if;
  if p_id is null then
    insert into public.services (name, price) values (btrim(p_name), p_price) returning * into result;
  else
    update public.services set name = btrim(p_name), price = p_price where id = p_id returning * into result;
    if not found then raise exception 'MASTER_NOT_FOUND'; end if;
  end if;
  return result;
end;
$$;

create or replace function public.owner_set_service_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_barber_owner() then raise exception 'NOT_OWNER'; end if;
  update public.services set active = p_active where id = p_id;
  if not found then raise exception 'MASTER_NOT_FOUND'; end if;
end;
$$;

create or replace function public.owner_set_day_off(p_barber_id uuid, p_date date, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result_id uuid;
begin
  if not public.is_barber_owner() then raise exception 'NOT_OWNER'; end if;
  if p_date is null or p_date < (now() at time zone 'Asia/Jakarta')::date
     or p_date > (now() at time zone 'Asia/Jakarta')::date + 60 then raise exception 'INVALID_MASTER'; end if;
  insert into public.barber_days_off (barber_id, off_date, note)
  values (p_barber_id, p_date, left(coalesce(p_note,''), 120))
  on conflict (barber_id, off_date) do update set note = excluded.note
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.owner_remove_day_off(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_barber_owner() then raise exception 'NOT_OWNER'; end if;
  delete from public.barber_days_off where id = p_id;
  if not found then raise exception 'MASTER_NOT_FOUND'; end if;
end;
$$;

create or replace function public.owner_daily_report(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_barber_owner() then raise exception 'NOT_OWNER'; end if;
  if p_date is null then raise exception 'INVALID_QUERY'; end if;
  select jsonb_build_object(
    'total_revenue', coalesce(sum(b.price) filter (where b.paid), 0),
    'paid_customers', count(*) filter (where b.paid),
    'per_barber', coalesce((
      select jsonb_agg(jsonb_build_object('barber', report.barber, 'customers', report.customers, 'revenue', report.revenue) order by report.barber)
      from (
        select b2.barber, count(*)::integer as customers,
          coalesce(sum(b2.price) filter (where b2.paid), 0)::integer as revenue
        from public.bookings b2 where b2.date = p_date and b2.status <> 'Batal'
        group by b2.barber
      ) report
    ), '[]'::jsonb)
  ) into result
  from public.bookings b where b.date = p_date and b.status <> 'Batal';
  return result;
end;
$$;

revoke all on function public.get_taken_slots(date,text) from public;
revoke all on function public.create_booking_record(text,text,text,text,date,text,text) from public;
revoke all on function public.create_booking(text,text,text,text,date,text) from public;
revoke all on function public.create_walkin(text,text,text,text,date,text) from public;
revoke all on function public.transition_booking(uuid,text) from public;
revoke all on function public.mark_booking_paid(uuid) from public;
revoke all on function public.lookup_bookings(text) from public;
revoke all on function public.owner_save_barber(text,uuid) from public;
revoke all on function public.owner_set_barber_active(uuid,boolean) from public;
revoke all on function public.owner_save_service(text,integer,uuid) from public;
revoke all on function public.owner_set_service_active(uuid,boolean) from public;
revoke all on function public.owner_set_day_off(uuid,date,text) from public;
revoke all on function public.owner_remove_day_off(uuid) from public;
revoke all on function public.owner_daily_report(date) from public;

grant execute on function public.get_taken_slots(date,text) to anon, authenticated;
grant execute on function public.create_booking(text,text,text,text,date,text) to anon, authenticated;
grant execute on function public.create_walkin(text,text,text,text,date,text) to authenticated;
grant execute on function public.transition_booking(uuid,text), public.mark_booking_paid(uuid) to authenticated;
grant execute on function public.lookup_bookings(text) to anon, authenticated;
grant execute on function public.owner_save_barber(text,uuid), public.owner_set_barber_active(uuid,boolean),
  public.owner_save_service(text,integer,uuid), public.owner_set_service_active(uuid,boolean),
  public.owner_set_day_off(uuid,date,text), public.owner_remove_day_off(uuid),
  public.owner_daily_report(date) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='queue_public') then
    alter publication supabase_realtime add table public.queue_public;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='barbers') then
    alter publication supabase_realtime add table public.barbers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='services') then
    alter publication supabase_realtime add table public.services;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='barber_days_off') then
    alter publication supabase_realtime add table public.barber_days_off;
  end if;
end;
$$;
