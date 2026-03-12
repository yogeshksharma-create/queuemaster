
# Multi-Site Name Rotation App with RBAC

Production-minded starter project for a secure, multi-site rotating name queue built on:

- Vanilla HTML, CSS, JavaScript
- Supabase PostgreSQL
- Supabase Auth
- Row Level Security (RLS)
- Supabase Realtime
- Supabase Edge Functions
- GitHub Pages-compatible frontend

## What this app does

This app manages independent rotating name queues for multiple sites. Each site has isolated:

- users
- roles
- queue names
- rotation state
- settings
- join requests
- logs

It supports:

- confirm next name
- skip current name
- reverse the most recent queue action
- infinite looping rotation
- optional daily cycle reset
- comment policies per action type
- role-based admin/editor/tasker/viewer access
- realtime updates across connected clients
- stale-write protection via version checks and row locking
- audit logging for sensitive actions
- app-level rate limiting examples through Edge Functions

## Architecture overview

### Frontend
Static pages served from GitHub Pages:

- `index.html` - login, sign-up, password reset
- `dashboard.html` - queue operations, site selector, join requests, realtime updates
- `admin.html` - site settings, names, invites, join requests, members
- `history.html` - selection history and admin-only audit history

The frontend uses only the public anon key.

### Database
PostgreSQL stores:

- profiles
- sites
- user_site_roles
- join_requests
- name_lists
- selection_state
- selection_log
- audit_log
- site_settings
- action_throttle
- invitations

Critical queue mutations run inside secure PostgreSQL functions using:

- `FOR UPDATE` row locking
- expected version checks
- append-only logging
- atomic state and log writes

### Authorization model
Roles are site-scoped:

- `ADMIN`
- `EDITOR`
- `TASKER`
- `VIEWER`

RLS is enabled on every app table. Frontend visibility is convenience only. Real enforcement happens in:

- RLS policies
- secure SQL functions
- Edge Function role checks

### Edge Functions
Protected server-side entry points exist for:

- `confirm-next-name`
- `skip-name`
- `reverse-last-selection`
- `reset-rotation`
- `reorder-names`
- `approve-join-request`
- `invite-user-to-site`
- `submit-join-request` (extra helper for join-request rate limiting)

## Project structure

```text
/multi-site-rotation-app
  index.html
  dashboard.html
  admin.html
  history.html
  style.css
  app.js
  auth.js
  admin.js
  supabaseClient.js
  README.md
  .env.example
  /supabase
    schema.sql
    rls.sql
    seed.sql
    /functions
      /_shared
        common.ts
        cors.ts
      /confirm-next-name
        index.ts
      /skip-name
        index.ts
      /reverse-last-selection
        index.ts
      /reset-rotation
        index.ts
      /reorder-names
        index.ts
      /approve-join-request
        index.ts
      /invite-user-to-site
        index.ts
      /submit-join-request
        index.ts
  /docs
    architecture.md
    security-notes.md
```

## First-time Supabase setup

### 1) Create the Supabase project

1. Create a new Supabase project.
2. Copy:
   - project URL
   - anon public key
   - service role key
3. Keep the service role key private.

### 2) Enable authentication

In Supabase Dashboard:

1. Go to **Authentication → Providers**
2. Enable **Email**
3. Enable:
   - email/password sign-in
   - password recovery
4. Optionally enable email confirmations for production

### 3) Configure auth redirect URLs

Add your app URLs in:

**Authentication → URL Configuration**

For local development examples:

- `http://127.0.0.1:5500`
- `http://127.0.0.1:5500/index.html`
- `http://127.0.0.1:5500/dashboard.html`

For GitHub Pages examples:

- `https://YOUR_GITHUB_USERNAME.github.io`
- `https://YOUR_GITHUB_USERNAME.github.io/multi-site-rotation-app/`
- `https://YOUR_GITHUB_USERNAME.github.io/multi-site-rotation-app/index.html`
- `https://YOUR_GITHUB_USERNAME.github.io/multi-site-rotation-app/dashboard.html`

### 4) Apply database schema

In Supabase SQL Editor, run in this order:

1. `supabase/schema.sql`
2. `supabase/rls.sql`
3. `supabase/seed.sql` (optional)

### 5) Create the first admin membership

Because admin membership is site-scoped, the very first site admin must be bootstrapped once.

#### Step A: sign up the first user
Use the frontend sign-up page or create the user in Supabase Auth.

#### Step B: find the user UUID
Use SQL:

```sql
select id, email from auth.users order by created_at desc;
```

#### Step C: create the site and admin membership
Example:

```sql
insert into public.sites (name, description, created_by, updated_by)
values (
  'Main Operations',
  'Primary site',
  'YOUR_USER_UUID'::uuid,
  'YOUR_USER_UUID'::uuid
)
returning id;
```

Then:

```sql
insert into public.user_site_roles (
  user_id,
  site_id,
  role,
  is_active,
  created_by,
  updated_by
)
values (
  'YOUR_USER_UUID'::uuid,
  'RETURNED_SITE_UUID'::uuid,
  'ADMIN',
  true,
  'YOUR_USER_UUID'::uuid,
  'YOUR_USER_UUID'::uuid
)
on conflict (user_id, site_id)
do update set
  role = 'ADMIN',
  is_active = true,
  deleted_at = null;
```

## Realtime setup

Enable database replication for these tables in Supabase Realtime:

- `selection_state`
- `selection_log`
- `join_requests`
- `name_lists`
- `user_site_roles`
- `site_settings`

In Supabase Dashboard:

1. Open **Database → Replication**
2. Add the tables above to the realtime publication

## Edge Function setup

### 1) Install Supabase CLI

Use the official Supabase CLI.

### 2) Link your project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### 3) Set Edge Function secrets

```bash
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
supabase secrets set SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

### 4) Deploy functions

```bash
supabase functions deploy confirm-next-name
supabase functions deploy skip-name
supabase functions deploy reverse-last-selection
supabase functions deploy reset-rotation
supabase functions deploy reorder-names
supabase functions deploy approve-join-request
supabase functions deploy invite-user-to-site
supabase functions deploy submit-join-request
```

## Frontend configuration

This starter intentionally does **not** embed the service role key anywhere in frontend code.

### Public frontend config
You may either:

- edit `supabaseClient.js` and replace the placeholder URL + anon key, or
- inject `window.__APP_CONFIG__` before the app scripts load

Example:

```html
<script>
  window.__APP_CONFIG__ = {
    SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
    SUPABASE_ANON_KEY: "YOUR_PUBLIC_ANON_KEY"
  };
</script>
```

### Why service role keys must never go in public frontend code
The service role key bypasses RLS and grants privileged backend access. If it is exposed in static frontend code, a browser user can extract it and fully compromise the application data.

## GitHub Pages deployment

1. Push this repository to GitHub.
2. In GitHub:
   - open **Settings → Pages**
   - deploy from the main branch root
3. Make sure your redirect URLs in Supabase Auth match the GitHub Pages URLs.
4. Configure `window.__APP_CONFIG__` or replace the placeholders in `supabaseClient.js`.
5. Verify:
   - sign in
   - sign out
   - password reset
   - realtime updates
   - Edge Function calls

## How to test RLS

### Quick checks as different roles
Create users for each role and assign memberships.

Then test:

- viewer can read queue/history but cannot mutate names/settings/roles
- tasker can confirm/skip/reverse but cannot edit names
- editor can manage names and reorder but cannot manage users/settings
- admin can manage site membership, settings, join requests, audit log

### Example direct test
With a viewer session in the browser console:

```js
const { data, error } = await supabase
  .from("site_settings")
  .update({ commands_enabled: false })
  .eq("site_id", "SITE_UUID");
console.log({ data, error });
```

Expected: RLS blocks the update.

## Recommended production hardening

- Put GitHub Pages behind a trusted domain and strict DNS ownership
- Add a real invitation acceptance flow with signed tokens
- Add CAPTCHA or bot protection for public-facing join-request submission
- Add WAF / CDN rate limiting in front of Edge Functions
- Route production audit events to SIEM / centralized monitoring
- Tune retention and archival policy for logs
- Add structured alerting for repeated failed admin actions
- Add SSO / SAML if your plan and environment require it
- Add environment-specific CSP headers if you deploy behind a gateway
- Review comment handling and retention with compliance stakeholders

## Operational notes

- Comments are intentionally limited and should never contain PHI.
- Queue action conflicts are handled with version checking and row locking.
- Reverse only affects the most recent reversible queue action for a site.
- Join requests for free-typed new site names remain pending until an admin creates or links that site.
