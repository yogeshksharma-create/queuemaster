
# Security Notes

## Key design protections

- RLS enabled on every application table
- No service role key in static frontend
- Privileged actions go through Edge Functions and/or secure SQL functions
- Site membership and role are validated on every protected action
- Queue mutations use row locks and expected version checks
- Audit logging records actor, role, site, request metadata, and change snapshots
- Comments are configurable and length-limited
- Soft delete used for names and memberships where practical

## Rate limiting limitations

The included rate limiting is application-level and stored in Postgres. It is useful but not sufficient alone for hostile internet traffic.

### Add external protection in production
Recommended:
- CDN / WAF rate limiting
- bot protection or CAPTCHA for public-ish endpoints
- API gateway throttling
- anomaly monitoring

## PHI / privacy guidance

This starter intentionally warns users not to place patient information into comments. If you are operating in healthcare-adjacent settings, review:

- retention policy
- audit visibility
- incident response
- access reviews
- least privilege role assignment
- whether comments should be disabled entirely

## TODOs for a production team

- invitation acceptance workflow
- stronger request fingerprinting
- SIEM export
- structured audit retention/archival
- optional SSO/SAML integration
- stronger CSP and origin controls behind a reverse proxy
