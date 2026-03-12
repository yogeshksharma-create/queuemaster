
import { handleOptions, withCors } from "../_shared/cors.ts";
import {
  applyRateLimit,
  jsonResponse,
  parseRequest,
  requireSiteRole,
  validateComment,
  withHandler,
} from "../_shared/common.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withCors(await withHandler(req, async ({ adminClient, userClient, user, requestMeta }) => {
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

    const body = await parseRequest<{ siteId: string; comment?: string | null }>(req);
    if (!body.siteId) return jsonResponse({ ok: false, error: "siteId is required" }, 400);

    await requireSiteRole(adminClient, user.id, body.siteId, ["ADMIN", "EDITOR", "TASKER"]);
    await validateComment(adminClient, body.siteId, "reverse", body.comment);
    await applyRateLimit(adminClient, user.id, body.siteId, {
      actionKey: "reverse_last_selection",
      limit: 5,
      windowSeconds: 300,
    });

    const { data, error } = await userClient.rpc("reverse_last_selection", {
      p_site_id: body.siteId,
      p_comment: body.comment ?? null,
      p_request_id: requestMeta.requestId,
      p_ip_address: requestMeta.ipAddress,
      p_user_agent: requestMeta.userAgent,
    });

    if (error) throw error;

    return jsonResponse(data, 200);
  }));
});
