
import { handleOptions, withCors } from "../_shared/cors.ts";
import {
  applyRateLimit,
  jsonResponse,
  parseRequest,
  requireSiteRole,
  withHandler,
} from "../_shared/common.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withCors(await withHandler(req, async ({ adminClient, user, requestMeta }) => {
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

    const body = await parseRequest<{
      siteId: string;
      invitedEmail: string;
      invitedRole: "ADMIN" | "EDITOR" | "TASKER" | "VIEWER";
    }>(req);

    if (!body.siteId || !body.invitedEmail || !body.invitedRole) {
      return jsonResponse({ ok: false, error: "siteId, invitedEmail, and invitedRole are required" }, 400);
    }

    await requireSiteRole(adminClient, user.id, body.siteId, ["ADMIN"]);
    await applyRateLimit(adminClient, user.id, body.siteId, {
      actionKey: "invite_user_to_site",
      limit: 10,
      windowSeconds: 3600,
    });

    const { data: existingInvite } = await adminClient
      .from("invitations")
      .select("id, status")
      .eq("site_id", body.siteId)
      .ilike("invited_email", body.invitedEmail)
      .eq("status", "pending")
      .maybeSingle();

    if (existingInvite) {
      return jsonResponse({
        ok: true,
        message: "An active invitation already exists.",
        invitationId: existingInvite.id,
      }, 200);
    }

    const { data, error } = await adminClient
      .from("invitations")
      .insert({
        site_id: body.siteId,
        invited_email: body.invitedEmail.toLowerCase(),
        invited_role: body.invitedRole,
        invited_by: user.id,
      })
      .select("id, invite_token, expires_at")
      .single();

    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }

    // TODO: Replace with your transactional email provider.
    // This starter returns the invite token so admins can deliver the link securely in development.
    return jsonResponse({
      ok: true,
      message: "Invitation created.",
      invitationId: data.id,
      inviteToken: data.invite_token,
      inviteUrlHint: `https://YOUR-GITHUB-PAGES-URL/?invite=${data.invite_token}`,
      expiresAt: data.expires_at,
      requestId: requestMeta.requestId,
    }, 200);
  }));
});
