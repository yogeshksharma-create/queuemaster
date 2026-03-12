
# Architecture Notes

## Flow overview

1. User signs in with Supabase Auth.
2. Frontend loads site memberships from `user_site_roles`.
3. User selects a site.
4. Frontend loads:
   - `selection_state`
   - `name_lists`
   - `site_settings`
   - `selection_log`
5. Queue actions call Edge Functions.
6. Edge Functions:
   - verify JWT
   - validate site membership
   - validate role
   - apply app-level rate limit
   - pass request metadata
   - call secure SQL functions
7. SQL functions:
   - lock `selection_state`
   - verify expected version
   - mutate state atomically
   - write `selection_log`
   - write `audit_log`
8. Realtime subscriptions update all open clients.

## Why critical queue logic lives in SQL

`confirm`, `skip`, `reverse`, and `reset` must behave atomically. Centralizing them in PostgreSQL provides:

- row locking
- transactionally consistent state changes
- deterministic log writes
- lower risk of frontend race conditions
- easier RLS-aware access control

## Isolation model

Every major operational table is site-scoped by `site_id`. RLS policies ensure users only operate within their memberships.

## Logging model

- `selection_log` captures queue history
- `audit_log` captures sensitive administrative and operational events

Audit rows are append-only for normal app usage.
