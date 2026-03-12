
import { handleOptions, withCors } from "../_shared/cors.ts";
import {
  applyRateLimit,
  jsonResponse,
  parseRequest,
  withHandler,
} from "../_shared/common.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withCors(await withHandler(req, async ({ adminClient, userClient, user }) => {
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

    const body = await parseRequest<{
      targetSiteId?: string | null;
      requestedSiteName: string;
      requestedRole?: "ADMIN" | "EDITOR" | "TASKER" | "VIEWER";
      message?: string | null;
    }>(req);

    if (!body.requestedSiteName?.trim()) {
      return jsonResponse({ ok: false, error: "requestedSiteName is required" }, 400);
    }

    await applyRateLimit(adminClient, user.id, body.targetSiteId ?? null, {
      actionKey: "submit_join_request",
      limit: 3,
      windowSeconds: 3600,
    });

    const { data, error } = await userClient
      .from("join_requests")
      .insert({
        requester_user_id: user.id,
        target_site_id: body.targetSiteId ?? null,
        requested_site_name: body.requestedSiteName.trim(),
        requested_role: body.requestedRole ?? "VIEWER",
        message: body.message?.trim() || null,
        status: "pending",
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id, status")
      .single();

    if (error) throw error;

    return jsonResponse({ ok: true, message: "Join request submitted", joinRequest: data }, 200);
  }));
});
