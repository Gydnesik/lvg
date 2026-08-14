-- ШКОЛЬНЫЙ ПОМОЩНИК — Supabase schema
-- Выполнить целиком в SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  class_name text not null,
  role text not null default 'user' check (role in ('user','admin')),
  tamagotchi_points integer not null default 0,
  created_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username) between 2 and 30),
  constraint profiles_class_length check (char_length(class_name) between 2 and 10)
);

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));

create table if not exists public.schedules (
  class_name text primary key,
  lessons jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.schedules enable row level security;

-- Profiles: пользователь видит только себя.
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

-- Пользователь может менять только свой ник/класс и не может сам выдать себе admin.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id and role = 'user');

-- Админ может менять роли и данные профилей.
drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Админ может видеть все профили.
drop policy if exists "Admins can view profiles" on public.profiles;
create policy "Admins can view profiles"
on public.profiles for select to authenticated
using (public.is_admin());

-- Расписание могут читать авторизованные пользователи.
drop policy if exists "Authenticated users can read schedules" on public.schedules;
create policy "Authenticated users can read schedules"
on public.schedules for select to authenticated
using (true);

-- Только админ может добавлять/обновлять/удалять расписание.
drop policy if exists "Admins can insert schedules" on public.schedules;
create policy "Admins can insert schedules"
on public.schedules for insert to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update schedules" on public.schedules;
create policy "Admins can update schedules"
on public.schedules for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete schedules" on public.schedules;
create policy "Admins can delete schedules"
on public.schedules for delete to authenticated
using (public.is_admin());

-- Автоматически создаём профиль после регистрации.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, class_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'Ученик'),
    coalesce(new.raw_user_meta_data->>'class_name', 'Не указан'),
    'user'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- После создания ТВОЕГО первого аккаунта выполни:
-- update public.profiles set role = 'admin' where username = 'ТВОЙ_НИК';


-- Атомарная полная замена расписания при импорте файла.
-- Edge Function вызывает эту функцию от имени текущего администратора.
-- Внутри одной транзакции старые строки удаляются, затем вставляются только новые.
create or replace function public.replace_schedules(p_schedules jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Доступ только для администратора';
  end if;

  delete from public.schedules
  where true;

  insert into public.schedules (class_name, lessons, updated_at, updated_by)
  select
    key,
    value,
    now(),
    auth.uid()
  from jsonb_each(coalesce(p_schedules, '{}'::jsonb))
  where jsonb_typeof(value) = 'array';
end;
$$;

revoke all on function public.replace_schedules(jsonb) from public;
grant execute on function public.replace_schedules(jsonb) to authenticated;
