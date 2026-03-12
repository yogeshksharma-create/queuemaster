
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

    const body = await parseRequest<{
      joinRequestId: string;
      role?: "ADMIN" | "EDITOR" | "TASKER" | "VIEWER";
      action?: "approve" | "deny";
    }>(req);

    if (!body.joinRequestId) return jsonResponse({ ok: false, error: "joinRequestId is required" }, 400);

    const { data: joinRequest, error: joinReqError } = await adminClient
      .from("join_requests")
      .select("id, target_site_id")
      .eq("id", body.joinRequestId)
      .single();

    if (joinReqError || !joinRequest) {
      return jsonResponse({ ok: false, error: "Join request not found" }, 404);
    }

    if (!joinRequest.target_site_id) {
      return jsonResponse({ ok: false, error: "Join request is not linked to a site yet" }, 400);
    }

    await requireSiteRole(adminClient, user.id, joinRequest.target_site_id, ["ADMIN"]);
    await applyRateLimit(adminClient, user.id, joinRequest.target_site_id, {
      actionKey: "approve_join_request",
      limit: 20,
      windowSeconds: 300,
    });

    if (body.action === "deny") {
      const { data, error } = await userClient.rpc("deny_join_request", {
        p_join_request_id: body.joinRequestId,
        p_request_id: requestMeta.requestId,
        p_ip_address: requestMeta.ipAddress,
        p_user_agent: requestMeta.userAgent,
      });
      if (error) throw error;
      return jsonResponse(data, 200);
    }

    const approvedRole = body.role ?? "VIEWER";
    const { data, error } = await userClient.rpc("approve_join_request", {
      p_join_request_id: body.joinRequestId,
      p_role: approvedRole,
      p_request_id: requestMeta.requestId,
      p_ip_address: requestMeta.ipAddress,
      p_user_agent: requestMeta.userAgent,
    });

    if (error) throw error;

    return jsonResponse(data, 200);
  }));
});
