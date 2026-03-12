
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

  return withCors(await withHandler(req, async ({ adminClient, userClient, user, requestMeta }) => {
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

    const body = await parseRequest<{ siteId: string; orderedIds: string[] }>(req);
    if (!body.siteId || !Array.isArray(body.orderedIds)) {
      return jsonResponse({ ok: false, error: "siteId and orderedIds[] are required" }, 400);
    }

    await requireSiteRole(adminClient, user.id, body.siteId, ["ADMIN", "EDITOR"]);
    await applyRateLimit(adminClient, user.id, body.siteId, {
      actionKey: "reorder_names",
      limit: 12,
      windowSeconds: 300,
    });

    const { data, error } = await userClient.rpc("reorder_names", {
      p_site_id: body.siteId,
      p_ordered_ids: body.orderedIds,
      p_request_id: requestMeta.requestId,
      p_ip_address: requestMeta.ipAddress,
      p_user_agent: requestMeta.userAgent,
    });

    if (error) throw error;

    return jsonResponse(data, 200);
  }));
});
