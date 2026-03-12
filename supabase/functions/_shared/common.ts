
import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type SiteRole = "ADMIN" | "EDITOR" | "TASKER" | "VIEWER";

export interface RequestMeta {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RateLimitConfig {
  actionKey: string;
  limit: number;
  windowSeconds: number;
}

export interface FunctionContext {
  adminClient: SupabaseClient;
  userClient: SupabaseClient;
  user: User;
  requestMeta: RequestMeta;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required Supabase environment variables.");
}

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function parseRequest<T>(req: Request): Promise<T> {
  return req.json();
}

export function writeRequestMetadata(req: Request): RequestMeta {
  return {
    requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  };
}

export function createClients(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  return { adminClient, userClient };
}

export async function requireAuth(req: Request): Promise<FunctionContext> {
  const { adminClient, userClient } = createClients(req);
  const requestMeta = writeRequestMetadata(req);

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "Authentication required");
  }

  return { adminClient, userClient, user: data.user, requestMeta };
}

export async function requireSiteRole(
  adminClient: SupabaseClient,
  userId: string,
  siteId: string,
  allowedRoles: SiteRole[],
): Promise<SiteRole> {
  const { data, error } = await adminClient
    .from("user_site_roles")
    .select("role, is_active, deleted_at")
    .eq("user_id", userId)
    .eq("site_id", siteId)
    .single();

  if (error || !data || !data.is_active || data.deleted_at !== null) {
    throw new HttpError(403, "You do not have access to this site.");
  }

  if (!allowedRoles.includes(data.role as SiteRole)) {
    throw new HttpError(403, "You do not have permission for this action.");
  }

  return data.role as SiteRole;
}

export async function validateComment(
  adminClient: SupabaseClient,
  siteId: string,
  actionType: "confirm" | "skip" | "reverse",
  comment?: string | null,
) {
  const { data, error } = await adminClient
    .from("site_settings")
    .select("selection_comment_mode, skip_comment_mode, reverse_comment_mode, max_comment_length")
    .eq("site_id", siteId)
    .single();

  if (error || !data) {
    throw new HttpError(400, "Site settings could not be loaded.");
  }

  const modeMap: Record<string, string> = {
    confirm: data.selection_comment_mode,
    skip: data.skip_comment_mode,
    reverse: data.reverse_comment_mode,
  };

  const mode = modeMap[actionType] ?? "optional";
  const trimmed = comment?.trim() ?? "";

  if (mode === "disabled" && trimmed.length > 0) {
    throw new HttpError(400, "Comments are disabled for this action.");
  }

  if (mode === "required" && trimmed.length === 0) {
    throw new HttpError(400, "A comment is required for this action.");
  }

  if (trimmed.length > data.max_comment_length) {
    throw new HttpError(400, `Comment exceeds ${data.max_comment_length} characters.`);
  }
}

export async function applyRateLimit(
  adminClient: SupabaseClient,
  userId: string,
  siteId: string | null,
  config: RateLimitConfig,
) {
  const { data, error } = await adminClient.rpc("apply_rate_limit", {
    p_user_id: userId,
    p_site_id: siteId,
    p_action_key: config.actionKey,
    p_limit: config.limit,
    p_window_seconds: config.windowSeconds,
  });

  if (error) {
    throw new HttpError(500, `Rate limit check failed: ${error.message}`);
  }

  if (!data?.allowed) {
    throw new HttpError(
      429,
      `Rate limit exceeded. Please retry in ${data.retry_after_seconds ?? config.windowSeconds} seconds.`,
      { retryAfter: data.retry_after_seconds ?? config.windowSeconds },
    );
  }

  return data;
}

export class HttpError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function mapSupabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  if (message.includes("Queue has already changed")) {
    return new HttpError(409, "Someone else already updated the queue. Refresh and try again.");
  }
  if (message.includes("Not authorized")) {
    return new HttpError(403, "You do not have permission for this action.");
  }
  if (message.includes("Comment is required")) {
    return new HttpError(400, "A comment is required for this action.");
  }
  return new HttpError(400, message);
}

export async function withHandler(
  req: Request,
  handler: (ctx: FunctionContext) => Promise<Response>,
): Promise<Response> {
  try {
    const ctx = await requireAuth(req);
    return await handler(ctx);
  } catch (error) {
    const httpError = error instanceof HttpError ? error : mapSupabaseError(error);
    return jsonResponse(
      { ok: false, error: httpError.message, ...(httpError.details ?? {}) },
      httpError.status,
    );
  }
}
