
-- seed.sql
-- Example data for local/dev usage.
-- Replace the placeholder UUID below with a real auth.users id from your project
-- before running the membership inserts.

begin;

-- Example site
insert into public.sites (id, name, description, created_by, updated_by)
values (
  '11111111-1111-1111-1111-111111111111',
  'Example General Hospital Ops',
  'Example multi-site operational queue for testing',
  null,
  null
)
on conflict (id) do nothing;

-- Example settings
insert into public.site_settings (
  site_id,
  selection_comment_mode,
  skip_comment_mode,
  reverse_comment_mode,
  daily_cycle_reset_enabled,
  commands_enabled,
  dark_mode_default,
  allow_free_text_names,
  max_comment_length
)
values (
  '11111111-1111-1111-1111-111111111111',
  'optional',
  'required',
  'required',
  false,
  true,
  true,
  true,
  280
)
on conflict (site_id) do update
set
  selection_comment_mode = excluded.selection_comment_mode,
  skip_comment_mode = excluded.skip_comment_mode,
  reverse_comment_mode = excluded.reverse_comment_mode,
  daily_cycle_reset_enabled = excluded.daily_cycle_reset_enabled,
  commands_enabled = excluded.commands_enabled,
  dark_mode_default = excluded.dark_mode_default,
  allow_free_text_names = excluded.allow_free_text_names,
  max_comment_length = excluded.max_comment_length;

-- Example queue state
insert into public.selection_state (site_id, current_index, cycle_count, last_reset_date, version)
values (
  '11111111-1111-1111-1111-111111111111',
  0,
  0,
  current_date,
  0
)
on conflict (site_id) do nothing;

-- Example names
insert into public.name_lists (site_id, display_name, sort_order, created_by, updated_by)
values
  ('11111111-1111-1111-1111-111111111111', 'Alex Carter', 0, null, null),
  ('11111111-1111-1111-1111-111111111111', 'Blair Jordan', 1, null, null),
  ('11111111-1111-1111-1111-111111111111', 'Casey Morgan', 2, null, null),
  ('11111111-1111-1111-1111-111111111111', 'Drew Taylor', 3, null, null)
on conflict do nothing;

-- OPTIONAL: create an initial admin membership after you sign up the first user.
-- Replace the UUID with a real auth.users / profiles.id value from your project.
-- insert into public.user_site_roles (user_id, site_id, role, is_active, created_by, updated_by)
-- values (
--   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
--   '11111111-1111-1111-1111-111111111111',
--   'ADMIN',
--   true,
--   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
--   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- )
-- on conflict (user_id, site_id)
-- do update set role = 'ADMIN', is_active = true, deleted_at = null;

commit;
