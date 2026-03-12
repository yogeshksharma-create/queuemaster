
-- rls.sql
-- Enable and enforce RLS across all application tables

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.user_site_roles enable row level security;
alter table public.join_requests enable row level security;
alter table public.name_lists enable row level security;
alter table public.selection_state enable row level security;
alter table public.selection_log enable row level security;
alter table public.audit_log enable row level security;
alter table public.site_settings enable row level security;
alter table public.action_throttle enable row level security;
alter table public.invitations enable row level security;

-- Optional hardening: force RLS for normal sessions.
alter table public.profiles force row level security;
alter table public.sites force row level security;
alter table public.user_site_roles force row level security;
alter table public.join_requests force row level security;
alter table public.name_lists force row level security;
alter table public.selection_state force row level security;
alter table public.selection_log force row level security;
alter table public.audit_log force row level security;
alter table public.site_settings force row level security;
alter table public.action_throttle force row level security;
alter table public.invitations force row level security;

-- =========================
-- PROFILES
-- =========================
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.user_site_roles usr
    where usr.user_id = public.profiles.id
      and usr.site_id in (
        select site_id from public.user_site_roles me
        where me.user_id = auth.uid()
          and me.role = 'ADMIN'
          and me.is_active = true
          and me.deleted_at is null
      )
      and usr.deleted_at is null
  )
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

-- =========================
-- SITES
-- Users can only see sites they belong to.
-- Admins can insert/update sites for sites they administer.
-- Bootstrapping of first site/admin is documented in README using SQL editor.
-- =========================
drop policy if exists sites_select_member on public.sites;
create policy sites_select_member
on public.sites
for select
to authenticated
using (public.is_site_member(id));

drop policy if exists sites_insert_admin on public.sites;
create policy sites_insert_admin
on public.sites
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists sites_update_admin on public.sites;
create policy sites_update_admin
on public.sites
for update
to authenticated
using (public.has_site_role(id, array['ADMIN']::public.site_role[]))
with check (public.has_site_role(id, array['ADMIN']::public.site_role[]));

-- =========================
-- USER_SITE_ROLES
-- =========================
drop policy if exists user_site_roles_select_member on public.user_site_roles;
create policy user_site_roles_select_member
on public.user_site_roles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_site_role(site_id, array['ADMIN']::public.site_role[])
);

drop policy if exists user_site_roles_insert_admin on public.user_site_roles;
create policy user_site_roles_insert_admin
on public.user_site_roles
for insert
to authenticated
with check (
  public.has_site_role(site_id, array['ADMIN']::public.site_role[])
);

drop policy if exists user_site_roles_update_admin on public.user_site_roles;
create policy user_site_roles_update_admin
on public.user_site_roles
for update
to authenticated
using (
  public.has_site_role(site_id, array['ADMIN']::public.site_role[])
)
with check (
  public.has_site_role(site_id, array['ADMIN']::public.site_role[])
);

-- =========================
-- JOIN REQUESTS
-- Authenticated users can submit.
-- Requester can read own requests.
-- Site admins can read and update join requests for their sites.
-- =========================
drop policy if exists join_requests_select_owner_or_admin on public.join_requests;
create policy join_requests_select_owner_or_admin
on public.join_requests
for select
to authenticated
using (
  requester_user_id = auth.uid()
  or (
    target_site_id is not null
    and public.has_site_role(target_site_id, array['ADMIN']::public.site_role[])
  )
);

drop policy if exists join_requests_insert_authenticated on public.join_requests;
create policy join_requests_insert_authenticated
on public.join_requests
for insert
to authenticated
with check (
  requester_user_id = auth.uid()
  and created_by = auth.uid()
  and status = 'pending'
);

drop policy if exists join_requests_update_admin on public.join_requests;
create policy join_requests_update_admin
on public.join_requests
for update
to authenticated
using (
  target_site_id is not null
  and public.has_site_role(target_site_id, array['ADMIN']::public.site_role[])
)
with check (
  target_site_id is not null
  and public.has_site_role(target_site_id, array['ADMIN']::public.site_role[])
);

-- =========================
-- NAME LISTS
-- viewers/read-only for members
-- editors/admins create/update
-- =========================
drop policy if exists name_lists_select_member on public.name_lists;
create policy name_lists_select_member
on public.name_lists
for select
to authenticated
using (public.is_site_member(site_id));

drop policy if exists name_lists_insert_editor_admin on public.name_lists;
create policy name_lists_insert_editor_admin
on public.name_lists
for insert
to authenticated
with check (
  public.has_site_role(site_id, array['ADMIN','EDITOR']::public.site_role[])
  and created_by = auth.uid()
);

drop policy if exists name_lists_update_editor_admin on public.name_lists;
create policy name_lists_update_editor_admin
on public.name_lists
for update
to authenticated
using (
  public.has_site_role(site_id, array['ADMIN','EDITOR']::public.site_role[])
)
with check (
  public.has_site_role(site_id, array['ADMIN','EDITOR']::public.site_role[])
);

-- =========================
-- SELECTION STATE
-- Read only for members.
-- Mutations happen through SECURITY DEFINER functions.
-- =========================
drop policy if exists selection_state_select_member on public.selection_state;
create policy selection_state_select_member
on public.selection_state
for select
to authenticated
using (public.is_site_member(site_id));

-- no direct insert/update/delete policy on selection_state

-- =========================
-- SELECTION LOG
-- Members can read log for their own sites.
-- Inserts happen only via secure functions.
-- =========================
drop policy if exists selection_log_select_member on public.selection_log;
create policy selection_log_select_member
on public.selection_log
for select
to authenticated
using (public.is_site_member(site_id));

-- no direct insert/update/delete policies

-- =========================
-- AUDIT LOG
-- Read only by site admins
-- No direct insert/update/delete for regular users
-- =========================
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin
on public.audit_log
for select
to authenticated
using (public.has_site_role(site_id, array['ADMIN']::public.site_role[]));

-- no direct insert/update/delete policies

-- =========================
-- SITE SETTINGS
-- Members can read settings
-- Admins can update
-- =========================
drop policy if exists site_settings_select_member on public.site_settings;
create policy site_settings_select_member
on public.site_settings
for select
to authenticated
using (public.is_site_member(site_id));

drop policy if exists site_settings_update_admin on public.site_settings;
create policy site_settings_update_admin
on public.site_settings
for update
to authenticated
using (public.has_site_role(site_id, array['ADMIN']::public.site_role[]))
with check (public.has_site_role(site_id, array['ADMIN']::public.site_role[]));

-- =========================
-- ACTION THROTTLE
-- Only the acting user can read their own rows if needed.
-- No public insert/update from frontend.
-- =========================
drop policy if exists action_throttle_select_own on public.action_throttle;
create policy action_throttle_select_own
on public.action_throttle
for select
to authenticated
using (user_id = auth.uid());

-- no direct insert/update/delete policies

-- =========================
-- INVITATIONS
-- Admins can read/insert invitations for their site.
-- Invite acceptance flow is intentionally left to privileged backend extension work.
-- =========================
drop policy if exists invitations_select_admin_or_target on public.invitations;
create policy invitations_select_admin_or_target
on public.invitations
for select
to authenticated
using (
  public.has_site_role(site_id, array['ADMIN']::public.site_role[])
  or lower(invited_email::text) = lower(coalesce((select email::text from public.profiles where id = auth.uid()), ''))
);

drop policy if exists invitations_insert_admin on public.invitations;
create policy invitations_insert_admin
on public.invitations
for insert
to authenticated
with check (
  public.has_site_role(site_id, array['ADMIN']::public.site_role[])
  and invited_by = auth.uid()
);

-- =========================
-- Realtime publication note:
-- Add these tables to supabase_realtime publication in dashboard:
-- selection_state, selection_log, join_requests, name_lists, user_site_roles, site_settings
-- =========================
