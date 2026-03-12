
-- schema.sql
-- Multi-Site Name Rotation App with RBAC
-- Production-minded starter schema for Supabase PostgreSQL

create extension if not exists pgcrypto;
create extension if not exists citext;

-- =========================
-- ENUMS
-- =========================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'site_role') then
    create type public.site_role as enum ('ADMIN', 'EDITOR', 'TASKER', 'VIEWER');
  end if;

  if not exists (select 1 from pg_type where typname = 'comment_mode') then
    create type public.comment_mode as enum ('disabled', 'optional', 'required');
  end if;

  if not exists (select 1 from pg_type where typname = 'queue_action_type') then
    create type public.queue_action_type as enum (
      'confirm',
      'skip',
      'reverse',
      'reset',
      'reorder',
      'role_change',
      'user_activation',
      'user_deactivation',
      'user_soft_delete',
      'user_restore',
      'name_add',
      'name_edit',
      'name_delete',
      'name_restore',
      'site_setting_change',
      'join_request_submit',
      'join_request_approve',
      'join_request_deny',
      'invite_create'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'join_request_status') then
    create type public.join_request_status as enum ('pending', 'approved', 'denied', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'invitation_status') then
    create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
  end if;
end $$;

-- =========================
-- HELPERS
-- =========================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.normalize_name(input_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(input_text, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.current_request_actor()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.current_actor_site_role(p_site_id uuid)
returns public.site_role
language sql
stable
as $$
  select usr.role
  from public.user_site_roles usr
  where usr.site_id = p_site_id
    and usr.user_id = auth.uid()
    and usr.is_active = true
    and usr.deleted_at is null
  limit 1;
$$;

create or replace function public.has_site_role(p_site_id uuid, p_allowed_roles public.site_role[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_site_roles usr
    where usr.site_id = p_site_id
      and usr.user_id = auth.uid()
      and usr.role = any(p_allowed_roles)
      and usr.is_active = true
      and usr.deleted_at is null
  );
$$;

create or replace function public.is_site_member(p_site_id uuid)
returns boolean
language sql
stable
as $$
  select public.has_site_role(p_site_id, array['ADMIN','EDITOR','TASKER','VIEWER']::public.site_role[]);
$$;

create or replace function public.append_audit_log(
  p_site_id uuid,
  p_actor_user_id uuid,
  p_actor_role public.site_role,
  p_action_type public.queue_action_type,
  p_entity_type text,
  p_entity_id uuid,
  p_old_values jsonb default '{}'::jsonb,
  p_new_values jsonb default '{}'::jsonb,
  p_comment text default null,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    site_id,
    actor_user_id,
    actor_role,
    action_type,
    entity_type,
    entity_id,
    old_values,
    new_values,
    comment,
    request_id,
    ip_address,
    user_agent
  )
  values (
    p_site_id,
    p_actor_user_id,
    p_actor_role,
    p_action_type,
    p_entity_type,
    p_entity_id,
    coalesce(p_old_values, '{}'::jsonb),
    coalesce(p_new_values, '{}'::jsonb),
    p_comment,
    p_request_id,
    p_ip_address,
    p_user_agent
  );
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- =========================
-- TABLES
-- =========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext unique not null,
  full_name text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text generated always as (regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) stored,
  description text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  constraint uq_sites_name unique (name),
  constraint uq_sites_slug unique (slug)
);

create table if not exists public.user_site_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  role public.site_role not null,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  constraint uq_user_site_roles unique (user_id, site_id)
);

create table if not exists public.site_settings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references public.sites(id) on delete cascade,
  selection_comment_mode public.comment_mode not null default 'optional',
  skip_comment_mode public.comment_mode not null default 'optional',
  reverse_comment_mode public.comment_mode not null default 'required',
  daily_cycle_reset_enabled boolean not null default false,
  commands_enabled boolean not null default true,
  dark_mode_default boolean not null default false,
  allow_free_text_names boolean not null default true,
  max_comment_length integer not null default 280,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  constraint chk_site_settings_max_comment_length check (max_comment_length between 0 and 2000)
);

create table if not exists public.name_lists (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  display_name text not null,
  normalized_name text generated always as (public.normalize_name(display_name)) stored,
  sort_order integer not null,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);

create unique index if not exists uq_name_lists_site_normalized_active
  on public.name_lists(site_id, normalized_name)
  where deleted_at is null;

create unique index if not exists uq_name_lists_site_sort_order_active
  on public.name_lists(site_id, sort_order)
  where deleted_at is null;

create table if not exists public.selection_state (
  site_id uuid primary key references public.sites(id) on delete cascade,
  current_index integer not null default 0,
  cycle_count integer not null default 0,
  last_reset_date date not null default current_date,
  version bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles(id),
  constraint chk_selection_state_non_negative check (current_index >= 0 and cycle_count >= 0 and version >= 0)
);

create table if not exists public.selection_log (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  selected_name_id uuid references public.name_lists(id),
  free_text_name_snapshot text,
  action_type public.queue_action_type not null,
  acted_by uuid not null references public.profiles(id),
  comment text,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  request_id uuid,
  is_reversed boolean not null default false,
  reversed_by uuid references public.profiles(id),
  reversed_at timestamptz,
  reverse_of_log_id uuid references public.selection_log(id),
  created_at timestamptz not null default timezone('utc', now()),
  constraint chk_selection_log_action_type check (action_type in ('confirm', 'skip', 'reverse', 'reset'))
);

create index if not exists idx_selection_log_site_created_at
  on public.selection_log(site_id, created_at desc);

create index if not exists idx_selection_log_site_request
  on public.selection_log(site_id, request_id);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  actor_role public.site_role,
  action_type public.queue_action_type not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  comment text,
  request_id uuid,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_audit_log_site_created_at
  on public.audit_log(site_id, created_at desc);

create index if not exists idx_audit_log_site_action
  on public.audit_log(site_id, action_type, created_at desc);

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  target_site_id uuid references public.sites(id) on delete set null,
  requested_site_name text not null,
  requested_role public.site_role not null default 'VIEWER',
  message text,
  status public.join_request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);

create index if not exists idx_join_requests_target_site_status
  on public.join_requests(target_site_id, status, created_at desc);

create index if not exists idx_join_requests_requester
  on public.join_requests(requester_user_id, created_at desc);

create table if not exists public.action_throttle (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  action_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  last_request_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint uq_action_throttle unique(user_id, site_id, action_key, window_started_at),
  constraint chk_action_throttle_request_count check (request_count >= 0)
);

create index if not exists idx_action_throttle_lookup
  on public.action_throttle(user_id, site_id, action_key, window_started_at desc);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  invited_email citext not null,
  invited_role public.site_role not null,
  invited_by uuid not null references public.profiles(id),
  invite_token uuid not null default gen_random_uuid(),
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default (timezone('utc', now()) + interval '7 days'),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (site_id, invited_email, status)
);

-- =========================
-- PUBLIC SITE DIRECTORY VIEW
-- Allows authenticated users to see a minimal site list for join-request suggestions
-- without exposing full site records.
-- =========================
drop view if exists public.public_site_directory;
create view public.public_site_directory as
select
  s.id,
  s.name
from public.sites s
where s.is_active = true
  and s.deleted_at is null;

grant select on public.public_site_directory to authenticated;

-- =========================
-- SITE BOOTSTRAP
-- =========================
create or replace function public.initialize_site_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.site_settings (site_id, created_by, updated_by)
  values (new.id, new.created_by, new.updated_by)
  on conflict (site_id) do nothing;

  insert into public.selection_state (site_id, current_index, cycle_count, last_reset_date, version, updated_by)
  values (new.id, 0, 0, current_date, 0, new.created_by)
  on conflict (site_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_initialize_site_defaults on public.sites;
create trigger trg_initialize_site_defaults
after insert on public.sites
for each row execute procedure public.initialize_site_defaults();

-- =========================
-- AUDIT TRIGGERS FOR ADMIN-MANAGED TABLES
-- =========================
create or replace function public.audit_name_list_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_action public.queue_action_type;
begin
  v_role := public.current_actor_site_role(coalesce(new.site_id, old.site_id));

  if tg_op = 'INSERT' then
    v_action := 'name_add';
    perform public.append_audit_log(new.site_id, v_actor, v_role, v_action, 'name_lists', new.id, null, to_jsonb(new), null, null, null, null);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      v_action := 'name_delete';
    elsif old.deleted_at is not null and new.deleted_at is null then
      v_action := 'name_restore';
    else
      v_action := 'name_edit';
    end if;

    perform public.append_audit_log(new.site_id, v_actor, v_role, v_action, 'name_lists', new.id, to_jsonb(old), to_jsonb(new), null, null, null, null);
    return new;
  end if;

  return null;
end;
$$;

create or replace function public.audit_site_settings_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
begin
  v_role := public.current_actor_site_role(coalesce(new.site_id, old.site_id));

  if tg_op = 'UPDATE' then
    perform public.append_audit_log(new.site_id, v_actor, v_role, 'site_setting_change', 'site_settings', new.id, to_jsonb(old), to_jsonb(new), null, null, null, null);
  end if;

  return new;
end;
$$;

create or replace function public.audit_user_site_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_action public.queue_action_type;
begin
  v_role := public.current_actor_site_role(coalesce(new.site_id, old.site_id));

  if tg_op = 'INSERT' then
    v_action := 'role_change';
    perform public.append_audit_log(new.site_id, v_actor, v_role, v_action, 'user_site_roles', new.id, null, to_jsonb(new), null, null, null, null);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active = true and new.is_active = false then
      v_action := 'user_deactivation';
    elsif old.is_active = false and new.is_active = true then
      v_action := 'user_activation';
    elsif old.deleted_at is null and new.deleted_at is not null then
      v_action := 'user_soft_delete';
    elsif old.deleted_at is not null and new.deleted_at is null then
      v_action := 'user_restore';
    else
      v_action := 'role_change';
    end if;

    perform public.append_audit_log(new.site_id, v_actor, v_role, v_action, 'user_site_roles', new.id, to_jsonb(old), to_jsonb(new), null, null, null, null);
    return new;
  end if;

  return null;
end;
$$;

create or replace function public.audit_join_request_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_action public.queue_action_type;
begin
  v_role := case
    when coalesce(new.target_site_id, old.target_site_id) is null then null
    else public.current_actor_site_role(coalesce(new.target_site_id, old.target_site_id))
  end;

  if tg_op = 'INSERT' then
    if new.target_site_id is not null then
      v_action := 'join_request_submit';
      perform public.append_audit_log(
        new.target_site_id,
        v_actor,
        v_role,
        v_action,
        'join_requests',
        new.id,
        null,
        to_jsonb(new),
        new.message,
        null,
        null,
        null
      );
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status <> new.status and new.status = 'approved' then
      v_action := 'join_request_approve';
    elsif old.status <> new.status and new.status = 'denied' then
      v_action := 'join_request_deny';
    else
      return new;
    end if;

    if new.target_site_id is not null then
      perform public.append_audit_log(
        new.target_site_id,
        v_actor,
        v_role,
        v_action,
        'join_requests',
        new.id,
        to_jsonb(old),
        to_jsonb(new),
        new.message,
        null,
        null,
        null
      );
    end if;
    return new;
  end if;

  return null;
end;
$$;

create or replace function public.audit_invitation_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
begin
  v_role := public.current_actor_site_role(new.site_id);

  if tg_op = 'INSERT' then
    perform public.append_audit_log(new.site_id, v_actor, v_role, 'invite_create', 'invitations', new.id, null, to_jsonb(new), null, null, null, null);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_profiles on public.profiles;
create trigger trg_set_updated_at_profiles before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_set_updated_at_sites on public.sites;
create trigger trg_set_updated_at_sites before update on public.sites
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_set_updated_at_user_site_roles on public.user_site_roles;
create trigger trg_set_updated_at_user_site_roles before update on public.user_site_roles
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_set_updated_at_site_settings on public.site_settings;
create trigger trg_set_updated_at_site_settings before update on public.site_settings
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_set_updated_at_name_lists on public.name_lists;
create trigger trg_set_updated_at_name_lists before update on public.name_lists
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_set_updated_at_join_requests on public.join_requests;
create trigger trg_set_updated_at_join_requests before update on public.join_requests
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_set_updated_at_invitations on public.invitations;
create trigger trg_set_updated_at_invitations before update on public.invitations
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_set_updated_at_action_throttle on public.action_throttle;
create trigger trg_set_updated_at_action_throttle before update on public.action_throttle
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_audit_name_lists on public.name_lists;
create trigger trg_audit_name_lists
after insert or update on public.name_lists
for each row execute procedure public.audit_name_list_changes();

drop trigger if exists trg_audit_site_settings on public.site_settings;
create trigger trg_audit_site_settings
after update on public.site_settings
for each row execute procedure public.audit_site_settings_changes();

drop trigger if exists trg_audit_user_site_roles on public.user_site_roles;
create trigger trg_audit_user_site_roles
after insert or update on public.user_site_roles
for each row execute procedure public.audit_user_site_role_changes();

drop trigger if exists trg_audit_join_requests on public.join_requests;
create trigger trg_audit_join_requests
after insert or update on public.join_requests
for each row execute procedure public.audit_join_request_changes();

drop trigger if exists trg_audit_invitations on public.invitations;
create trigger trg_audit_invitations
after insert on public.invitations
for each row execute procedure public.audit_invitation_changes();

-- =========================
-- RATE LIMITING
-- =========================
create or replace function public.apply_rate_limit(
  p_user_id uuid,
  p_site_id uuid,
  p_action_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_bucket timestamptz;
  v_count integer;
begin
  if p_limit <= 0 then
    return jsonb_build_object('allowed', true, 'request_count', 0, 'limit', p_limit, 'window_seconds', p_window_seconds);
  end if;

  v_bucket := to_timestamp(floor(extract(epoch from v_now) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1));

  insert into public.action_throttle(user_id, site_id, action_key, window_started_at, request_count, last_request_at)
  values (p_user_id, p_site_id, p_action_key, v_bucket, 1, v_now)
  on conflict (user_id, site_id, action_key, window_started_at)
  do update
    set request_count = public.action_throttle.request_count + 1,
        last_request_at = excluded.last_request_at,
        updated_at = excluded.last_request_at
  returning request_count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'request_count', v_count,
    'limit', p_limit,
    'window_seconds', p_window_seconds,
    'retry_after_seconds', case when v_count <= p_limit then 0 else greatest(1, extract(epoch from ((v_bucket + make_interval(secs => p_window_seconds)) - v_now))::integer) end
  );
end;
$$;

-- =========================
-- INTERNAL VALIDATION HELPERS
-- =========================
create or replace function public.assert_site_permission(
  p_site_id uuid,
  p_allowed_roles public.site_role[]
)
returns public.site_role
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.site_role;
begin
  select usr.role
    into v_role
  from public.user_site_roles usr
  where usr.site_id = p_site_id
    and usr.user_id = auth.uid()
    and usr.role = any(p_allowed_roles)
    and usr.is_active = true
    and usr.deleted_at is null
  limit 1;

  if v_role is null then
    raise exception 'Not authorized for site %', p_site_id
      using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.assert_comment_policy(
  p_comment text,
  p_comment_mode public.comment_mode,
  p_max_length integer
)
returns void
language plpgsql
as $$
begin
  if p_comment_mode = 'disabled' and nullif(trim(coalesce(p_comment, '')), '') is not null then
    raise exception 'Comments are disabled for this action' using errcode = '22023';
  end if;

  if p_comment_mode = 'required' and nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception 'Comment is required for this action' using errcode = '22023';
  end if;

  if char_length(coalesce(p_comment, '')) > p_max_length then
    raise exception 'Comment exceeds max length of % characters', p_max_length using errcode = '22023';
  end if;
end;
$$;

create or replace function public.get_active_name_by_index(p_site_id uuid, p_index integer)
returns public.name_lists
language sql
stable
as $$
  select nl.*
  from public.name_lists nl
  where nl.site_id = p_site_id
    and nl.is_active = true
    and nl.deleted_at is null
  order by nl.sort_order asc, nl.created_at asc
  offset p_index
  limit 1;
$$;

create or replace function public.active_name_count(p_site_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.name_lists nl
  where nl.site_id = p_site_id
    and nl.is_active = true
    and nl.deleted_at is null;
$$;

create or replace function public.maybe_apply_daily_reset(
  p_site_id uuid,
  p_actor_user_id uuid
)
returns public.selection_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.selection_state;
  v_settings public.site_settings;
begin
  select * into v_state
  from public.selection_state
  where site_id = p_site_id
  for update;

  select * into v_settings
  from public.site_settings
  where site_id = p_site_id;

  if v_settings.daily_cycle_reset_enabled = true and v_state.last_reset_date < current_date then
    update public.selection_state
    set cycle_count = 0,
        last_reset_date = current_date,
        version = version + 1,
        updated_at = timezone('utc', now()),
        updated_by = p_actor_user_id
    where site_id = p_site_id
    returning * into v_state;
  end if;

  return v_state;
end;
$$;

-- =========================
-- CRITICAL QUEUE FUNCTIONS
-- =========================
create or replace function public.confirm_next_name(
  p_site_id uuid,
  p_comment text default null,
  p_expected_version bigint default null,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_state public.selection_state;
  v_state_before jsonb;
  v_state_after jsonb;
  v_name public.name_lists;
  v_name_count integer;
  v_next_index integer;
  v_new_cycle_count integer;
  v_settings public.site_settings;
  v_log_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := public.assert_site_permission(p_site_id, array['ADMIN','EDITOR','TASKER']::public.site_role[]);

  select * into v_settings
  from public.site_settings
  where site_id = p_site_id;

  if v_settings.commands_enabled = false then
    raise exception 'Commands are disabled for this site' using errcode = '22023';
  end if;

  perform public.assert_comment_policy(p_comment, v_settings.selection_comment_mode, v_settings.max_comment_length);

  select * into v_state
  from public.selection_state
  where site_id = p_site_id
  for update;

  if v_settings.daily_cycle_reset_enabled = true and v_state.last_reset_date < current_date then
    update public.selection_state
    set cycle_count = 0,
        last_reset_date = current_date,
        version = version + 1,
        updated_at = timezone('utc', now()),
        updated_by = v_actor
    where site_id = p_site_id
    returning * into v_state;
  end if;

  if p_expected_version is not null and v_state.version <> p_expected_version then
    raise exception 'Queue has already changed. Please refresh and try again.' using errcode = '40001';
  end if;

  v_name_count := public.active_name_count(p_site_id);
  if v_name_count = 0 then
    raise exception 'No active names configured for this site' using errcode = '22023';
  end if;

  v_name := public.get_active_name_by_index(p_site_id, least(v_state.current_index, greatest(v_name_count - 1, 0)));
  if v_name.id is null then
    raise exception 'Current name could not be resolved' using errcode = '22023';
  end if;

  v_state_before := jsonb_build_object(
    'current_index', v_state.current_index,
    'cycle_count', v_state.cycle_count,
    'last_reset_date', v_state.last_reset_date,
    'version', v_state.version
  );

  if v_state.current_index + 1 >= v_name_count then
    v_next_index := 0;
    v_new_cycle_count := v_state.cycle_count + 1;
  else
    v_next_index := v_state.current_index + 1;
    v_new_cycle_count := v_state.cycle_count;
  end if;

  update public.selection_state
  set current_index = v_next_index,
      cycle_count = v_new_cycle_count,
      version = v_state.version + 1,
      updated_at = timezone('utc', now()),
      updated_by = v_actor
  where site_id = p_site_id
  returning * into v_state;

  v_state_after := jsonb_build_object(
    'current_index', v_state.current_index,
    'cycle_count', v_state.cycle_count,
    'last_reset_date', v_state.last_reset_date,
    'version', v_state.version
  );

  insert into public.selection_log (
    site_id,
    selected_name_id,
    free_text_name_snapshot,
    action_type,
    acted_by,
    comment,
    previous_state,
    new_state,
    request_id
  )
  values (
    p_site_id,
    v_name.id,
    v_name.display_name,
    'confirm',
    v_actor,
    nullif(trim(coalesce(p_comment, '')), ''),
    v_state_before,
    v_state_after,
    p_request_id
  )
  returning id into v_log_id;

  perform public.append_audit_log(
    p_site_id,
    v_actor,
    v_role,
    'confirm',
    'selection_state',
    p_site_id,
    v_state_before,
    jsonb_build_object('state', v_state_after, 'selected_name', to_jsonb(v_name)),
    p_comment,
    p_request_id,
    p_ip_address,
    p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Confirmed next name',
    'selected_name', jsonb_build_object('id', v_name.id, 'display_name', v_name.display_name),
    'state', v_state_after,
    'log_id', v_log_id
  );
end;
$$;

create or replace function public.skip_name(
  p_site_id uuid,
  p_comment text default null,
  p_expected_version bigint default null,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_state public.selection_state;
  v_state_before jsonb;
  v_state_after jsonb;
  v_name public.name_lists;
  v_name_count integer;
  v_next_index integer;
  v_new_cycle_count integer;
  v_settings public.site_settings;
  v_log_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := public.assert_site_permission(p_site_id, array['ADMIN','EDITOR','TASKER']::public.site_role[]);

  select * into v_settings
  from public.site_settings
  where site_id = p_site_id;

  if v_settings.commands_enabled = false then
    raise exception 'Commands are disabled for this site' using errcode = '22023';
  end if;

  perform public.assert_comment_policy(p_comment, v_settings.skip_comment_mode, v_settings.max_comment_length);

  select * into v_state
  from public.selection_state
  where site_id = p_site_id
  for update;

  if v_settings.daily_cycle_reset_enabled = true and v_state.last_reset_date < current_date then
    update public.selection_state
    set cycle_count = 0,
        last_reset_date = current_date,
        version = version + 1,
        updated_at = timezone('utc', now()),
        updated_by = v_actor
    where site_id = p_site_id
    returning * into v_state;
  end if;

  if p_expected_version is not null and v_state.version <> p_expected_version then
    raise exception 'Queue has already changed. Please refresh and try again.' using errcode = '40001';
  end if;

  v_name_count := public.active_name_count(p_site_id);
  if v_name_count = 0 then
    raise exception 'No active names configured for this site' using errcode = '22023';
  end if;

  v_name := public.get_active_name_by_index(p_site_id, least(v_state.current_index, greatest(v_name_count - 1, 0)));
  if v_name.id is null then
    raise exception 'Current name could not be resolved' using errcode = '22023';
  end if;

  v_state_before := jsonb_build_object(
    'current_index', v_state.current_index,
    'cycle_count', v_state.cycle_count,
    'last_reset_date', v_state.last_reset_date,
    'version', v_state.version
  );

  if v_state.current_index + 1 >= v_name_count then
    v_next_index := 0;
    v_new_cycle_count := v_state.cycle_count + 1;
  else
    v_next_index := v_state.current_index + 1;
    v_new_cycle_count := v_state.cycle_count;
  end if;

  update public.selection_state
  set current_index = v_next_index,
      cycle_count = v_new_cycle_count,
      version = v_state.version + 1,
      updated_at = timezone('utc', now()),
      updated_by = v_actor
  where site_id = p_site_id
  returning * into v_state;

  v_state_after := jsonb_build_object(
    'current_index', v_state.current_index,
    'cycle_count', v_state.cycle_count,
    'last_reset_date', v_state.last_reset_date,
    'version', v_state.version
  );

  insert into public.selection_log (
    site_id,
    selected_name_id,
    free_text_name_snapshot,
    action_type,
    acted_by,
    comment,
    previous_state,
    new_state,
    request_id
  )
  values (
    p_site_id,
    v_name.id,
    v_name.display_name,
    'skip',
    v_actor,
    nullif(trim(coalesce(p_comment, '')), ''),
    v_state_before,
    v_state_after,
    p_request_id
  )
  returning id into v_log_id;

  perform public.append_audit_log(
    p_site_id,
    v_actor,
    v_role,
    'skip',
    'selection_state',
    p_site_id,
    v_state_before,
    jsonb_build_object('state', v_state_after, 'skipped_name', to_jsonb(v_name)),
    p_comment,
    p_request_id,
    p_ip_address,
    p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Skipped current name',
    'skipped_name', jsonb_build_object('id', v_name.id, 'display_name', v_name.display_name),
    'state', v_state_after,
    'log_id', v_log_id
  );
end;
$$;

create or replace function public.reverse_last_selection(
  p_site_id uuid,
  p_comment text default null,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_settings public.site_settings;
  v_state public.selection_state;
  v_state_before jsonb;
  v_target_state jsonb;
  v_last_log public.selection_log;
  v_reverse_log_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := public.assert_site_permission(p_site_id, array['ADMIN','EDITOR','TASKER']::public.site_role[]);

  select * into v_settings
  from public.site_settings
  where site_id = p_site_id;

  if v_settings.commands_enabled = false then
    raise exception 'Commands are disabled for this site' using errcode = '22023';
  end if;

  perform public.assert_comment_policy(p_comment, v_settings.reverse_comment_mode, v_settings.max_comment_length);

  select * into v_state
  from public.selection_state
  where site_id = p_site_id
  for update;

  select *
    into v_last_log
  from public.selection_log
  where site_id = p_site_id
    and action_type in ('confirm', 'skip', 'reset')
    and is_reversed = false
  order by created_at desc
  limit 1
  for update;

  if v_last_log.id is null then
    raise exception 'No reversible action found for this site' using errcode = '22023';
  end if;

  v_state_before := jsonb_build_object(
    'current_index', v_state.current_index,
    'cycle_count', v_state.cycle_count,
    'last_reset_date', v_state.last_reset_date,
    'version', v_state.version
  );

  v_target_state := v_last_log.previous_state;

  update public.selection_state
  set current_index = coalesce((v_target_state ->> 'current_index')::integer, 0),
      cycle_count = coalesce((v_target_state ->> 'cycle_count')::integer, 0),
      last_reset_date = coalesce((v_target_state ->> 'last_reset_date')::date, current_date),
      version = v_state.version + 1,
      updated_at = timezone('utc', now()),
      updated_by = v_actor
  where site_id = p_site_id
  returning * into v_state;

  update public.selection_log
  set is_reversed = true,
      reversed_by = v_actor,
      reversed_at = timezone('utc', now())
  where id = v_last_log.id;

  insert into public.selection_log (
    site_id,
    selected_name_id,
    free_text_name_snapshot,
    action_type,
    acted_by,
    comment,
    previous_state,
    new_state,
    request_id,
    reverse_of_log_id
  )
  values (
    p_site_id,
    v_last_log.selected_name_id,
    v_last_log.free_text_name_snapshot,
    'reverse',
    v_actor,
    nullif(trim(coalesce(p_comment, '')), ''),
    v_state_before,
    jsonb_build_object(
      'current_index', v_state.current_index,
      'cycle_count', v_state.cycle_count,
      'last_reset_date', v_state.last_reset_date,
      'version', v_state.version
    ),
    p_request_id,
    v_last_log.id
  )
  returning id into v_reverse_log_id;

  perform public.append_audit_log(
    p_site_id,
    v_actor,
    v_role,
    'reverse',
    'selection_log',
    v_last_log.id,
    jsonb_build_object('state_before_reverse', v_state_before, 'reversed_log', to_jsonb(v_last_log)),
    jsonb_build_object('state_after_reverse', jsonb_build_object(
      'current_index', v_state.current_index,
      'cycle_count', v_state.cycle_count,
      'last_reset_date', v_state.last_reset_date,
      'version', v_state.version
    )),
    p_comment,
    p_request_id,
    p_ip_address,
    p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Reversed most recent queue action',
    'reversed_log_id', v_last_log.id,
    'reverse_log_id', v_reverse_log_id,
    'state', jsonb_build_object(
      'current_index', v_state.current_index,
      'cycle_count', v_state.cycle_count,
      'last_reset_date', v_state.last_reset_date,
      'version', v_state.version
    )
  );
end;
$$;

create or replace function public.reset_rotation(
  p_site_id uuid,
  p_comment text default null,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_settings public.site_settings;
  v_state public.selection_state;
  v_before jsonb;
  v_after jsonb;
  v_log_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := public.assert_site_permission(p_site_id, array['ADMIN']::public.site_role[]);

  select * into v_settings
  from public.site_settings
  where site_id = p_site_id;

  if v_settings.max_comment_length > 0 then
    perform public.assert_comment_policy(p_comment, 'optional', v_settings.max_comment_length);
  end if;

  select * into v_state
  from public.selection_state
  where site_id = p_site_id
  for update;

  v_before := jsonb_build_object(
    'current_index', v_state.current_index,
    'cycle_count', v_state.cycle_count,
    'last_reset_date', v_state.last_reset_date,
    'version', v_state.version
  );

  update public.selection_state
  set current_index = 0,
      cycle_count = 0,
      last_reset_date = current_date,
      version = v_state.version + 1,
      updated_at = timezone('utc', now()),
      updated_by = v_actor
  where site_id = p_site_id
  returning * into v_state;

  v_after := jsonb_build_object(
    'current_index', v_state.current_index,
    'cycle_count', v_state.cycle_count,
    'last_reset_date', v_state.last_reset_date,
    'version', v_state.version
  );

  insert into public.selection_log (
    site_id,
    action_type,
    acted_by,
    comment,
    previous_state,
    new_state,
    request_id
  )
  values (
    p_site_id,
    'reset',
    v_actor,
    nullif(trim(coalesce(p_comment, '')), ''),
    v_before,
    v_after,
    p_request_id
  )
  returning id into v_log_id;

  perform public.append_audit_log(
    p_site_id,
    v_actor,
    v_role,
    'reset',
    'selection_state',
    p_site_id,
    v_before,
    v_after,
    p_comment,
    p_request_id,
    p_ip_address,
    p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Rotation reset',
    'log_id', v_log_id,
    'state', v_after
  );
end;
$$;

create or replace function public.reorder_names(
  p_site_id uuid,
  p_ordered_ids uuid[],
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.site_role;
  v_count_expected integer;
  v_count_provided integer;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_id uuid;
  v_position integer := 0;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := public.assert_site_permission(p_site_id, array['ADMIN','EDITOR']::public.site_role[]);

  select count(*)::integer
    into v_count_expected
  from public.name_lists
  where site_id = p_site_id
    and deleted_at is null
    and is_active = true;

  v_count_provided := coalesce(array_length(p_ordered_ids, 1), 0);

  if v_count_expected <> v_count_provided then
    raise exception 'Provided order does not match active name count' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'sort_order', sort_order) order by sort_order asc)
    into v_old_snapshot
  from public.name_lists
  where site_id = p_site_id
    and deleted_at is null
    and is_active = true;

  foreach v_id in array p_ordered_ids loop
    update public.name_lists
    set sort_order = v_position,
        updated_by = v_actor,
        updated_at = timezone('utc', now())
    where site_id = p_site_id
      and id = v_id
      and deleted_at is null
      and is_active = true;

    if not found then
      raise exception 'Invalid name id in reorder list: %', v_id using errcode = '22023';
    end if;

    v_position := v_position + 1;
  end loop;

  select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'sort_order', sort_order) order by sort_order asc)
    into v_new_snapshot
  from public.name_lists
  where site_id = p_site_id
    and deleted_at is null
    and is_active = true;

  perform public.append_audit_log(
    p_site_id,
    v_actor,
    v_role,
    'reorder',
    'name_lists',
    null,
    v_old_snapshot,
    v_new_snapshot,
    null,
    p_request_id,
    p_ip_address,
    p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Names reordered',
    'names', v_new_snapshot
  );
end;
$$;

create or replace function public.approve_join_request(
  p_join_request_id uuid,
  p_role public.site_role,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_join_request public.join_requests;
  v_role_for_site public.site_role;
  v_membership_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_join_request
  from public.join_requests
  where id = p_join_request_id
  for update;

  if v_join_request.id is null then
    raise exception 'Join request not found' using errcode = '22023';
  end if;

  if v_join_request.status <> 'pending' then
    raise exception 'Join request has already been processed' using errcode = '22023';
  end if;

  if v_join_request.target_site_id is null then
    raise exception 'Join request is not linked to a site yet' using errcode = '22023';
  end if;

  v_role_for_site := public.assert_site_permission(v_join_request.target_site_id, array['ADMIN']::public.site_role[]);

  insert into public.user_site_roles (
    user_id, site_id, role, is_active, deleted_at, created_by, updated_by
  )
  values (
    v_join_request.requester_user_id, v_join_request.target_site_id, p_role, true, null, v_actor, v_actor
  )
  on conflict (user_id, site_id)
  do update set
    role = excluded.role,
    is_active = true,
    deleted_at = null,
    updated_by = excluded.updated_by,
    updated_at = timezone('utc', now())
  returning id into v_membership_id;

  update public.join_requests
  set status = 'approved',
      reviewed_by = v_actor,
      reviewed_at = timezone('utc', now()),
      updated_by = v_actor
  where id = p_join_request_id;

  perform public.append_audit_log(
    v_join_request.target_site_id,
    v_actor,
    v_role_for_site,
    'join_request_approve',
    'join_requests',
    v_join_request.id,
    to_jsonb(v_join_request),
    jsonb_build_object('approved_role', p_role, 'membership_id', v_membership_id),
    v_join_request.message,
    p_request_id,
    p_ip_address,
    p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Join request approved',
    'membership_id', v_membership_id
  );
end;
$$;

create or replace function public.deny_join_request(
  p_join_request_id uuid,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_join_request public.join_requests;
  v_role_for_site public.site_role;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_join_request
  from public.join_requests
  where id = p_join_request_id
  for update;

  if v_join_request.id is null then
    raise exception 'Join request not found' using errcode = '22023';
  end if;

  if v_join_request.status <> 'pending' then
    raise exception 'Join request has already been processed' using errcode = '22023';
  end if;

  if v_join_request.target_site_id is null then
    raise exception 'Join request is not linked to a site yet' using errcode = '22023';
  end if;

  v_role_for_site := public.assert_site_permission(v_join_request.target_site_id, array['ADMIN']::public.site_role[]);

  update public.join_requests
  set status = 'denied',
      reviewed_by = v_actor,
      reviewed_at = timezone('utc', now()),
      updated_by = v_actor
  where id = p_join_request_id;

  perform public.append_audit_log(
    v_join_request.target_site_id,
    v_actor,
    v_role_for_site,
    'join_request_deny',
    'join_requests',
    v_join_request.id,
    to_jsonb(v_join_request),
    jsonb_build_object('status', 'denied'),
    v_join_request.message,
    p_request_id,
    p_ip_address,
    p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Join request denied',
    'join_request_id', p_join_request_id
  );
end;
$$;

-- =========================
-- GRANTS
-- =========================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on public.profiles to authenticated;
grant select on public.public_site_directory to authenticated;

grant select on public.sites to authenticated;
grant select, insert, update on public.user_site_roles to authenticated;
grant select, insert, update on public.join_requests to authenticated;
grant select, insert, update on public.name_lists to authenticated;
grant select on public.selection_state to authenticated;
grant select on public.selection_log to authenticated;
grant select on public.audit_log to authenticated;
grant select, update on public.site_settings to authenticated;
grant select on public.invitations to authenticated;
grant insert on public.invitations to authenticated;
grant execute on function public.confirm_next_name(uuid, text, bigint, uuid, inet, text) to authenticated;
grant execute on function public.skip_name(uuid, text, bigint, uuid, inet, text) to authenticated;
grant execute on function public.reverse_last_selection(uuid, text, uuid, inet, text) to authenticated;
grant execute on function public.reset_rotation(uuid, text, uuid, inet, text) to authenticated;
grant execute on function public.reorder_names(uuid, uuid[], uuid, inet, text) to authenticated;
grant execute on function public.approve_join_request(uuid, public.site_role, uuid, inet, text) to authenticated;
grant execute on function public.deny_join_request(uuid, uuid, inet, text) to authenticated;
grant execute on function public.apply_rate_limit(uuid, uuid, text, integer, integer) to authenticated, service_role;
