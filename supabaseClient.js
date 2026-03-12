
const SUPABASE_URL = window.__APP_CONFIG__?.SUPABASE_URL || "https://dwgnjnljpractxstijbx.supabase.co";
const SUPABASE_ANON_KEY = window.__APP_CONFIG__?.SUPABASE_ANON_KEY || "sb_publishable_oNiHxf9sCWmw0Q5pAVpi0A_m7yUKdi_";

if (!window.supabase) {
  throw new Error("Supabase browser client CDN must be loaded before supabaseClient.js");
}

export const appConfig = { SUPABASE_URL, SUPABASE_ANON_KEY };
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function isConfigured() {
  return !SUPABASE_URL.includes("YOUR_PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_PUBLIC_ANON_KEY");
}

export function requireConfiguredClient() {
  if (!isConfigured()) {
    throw new Error(
      "Set your Supabase project URL and public anon key in window.__APP_CONFIG__ or edit supabaseClient.js placeholders.",
    );
  }
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function ensureAuthOrRedirect() {
  requireConfiguredClient();
  const session = await getSession();
  if (!session) {
    window.location.href = "./index.html";
    return null;
  }
  return session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function getStoredSiteId() {
  return window.localStorage.getItem("selected_site_id");
}

export function setStoredSiteId(siteId) {
  if (siteId) window.localStorage.setItem("selected_site_id", siteId);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem("theme", theme);
}

export function loadTheme(defaultDark = false) {
  const stored = window.localStorage.getItem("theme");
  if (stored) {
    applyTheme(stored);
    return stored;
  }
  const theme = defaultDark ? "dark" : "light";
  applyTheme(theme);
  return theme;
}

export function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

export function showToast(message, type = "success") {
  let wrap = document.getElementById("toastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toastWrap";
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : "success"}`;
  toast.textContent = message;
  wrap.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 4200);
}

export async function invokeEdgeFunction(functionName, payload) {
  requireConfiguredClient();
  const session = await getSession();
  if (!session?.access_token) {
    throw new Error("You are not signed in.");
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.error || "Request failed.");
  }

  return json;
}

export async function loadMemberships() {
  const { data, error } = await supabase
    .from("user_site_roles")
    .select("id, site_id, role, is_active, deleted_at, sites(id, name, is_active, deleted_at)")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("site_id", { ascending: true });

  if (error) throw error;
  return (data || [])
    .filter((row) => row.sites && row.sites.deleted_at === null && row.sites.is_active)
    .map((row) => ({
      membershipId: row.id,
      siteId: row.site_id,
      role: row.role,
      siteName: row.sites.name,
    }));
}

export async function loadPublicSiteDirectory() {
  const { data, error } = await supabase.from("public_site_directory").select("id, name").order("name");
  if (error) throw error;
  return data || [];
}

export async function loadSiteSettings(siteId) {
  const { data, error } = await supabase
    .from("site_settings")
    .select("*")
    .eq("site_id", siteId)
    .single();

  if (error) throw error;
  return data;
}

export async function loadSelectionState(siteId) {
  const { data, error } = await supabase
    .from("selection_state")
    .select("*")
    .eq("site_id", siteId)
    .single();

  if (error) throw error;
  return data;
}

export async function loadActiveNames(siteId) {
  const { data, error } = await supabase
    .from("name_lists")
    .select("id, display_name, sort_order, is_active, deleted_at")
    .eq("site_id", siteId)
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function loadSelectionHistory(siteId, limit = 20) {
  const { data, error } = await supabase
    .from("selection_log")
    .select("id, action_type, free_text_name_snapshot, comment, created_at, is_reversed, acted_by, profiles:profiles!selection_log_acted_by_fkey(full_name, email)")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function loadAuditHistory(siteId, limit = 50) {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action_type, entity_type, comment, created_at, actor_user_id, profiles:profiles!audit_log_actor_user_id_fkey(full_name, email)")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export function guardButtonByRole(button, role, allowedRoles) {
  if (!button) return;
  button.disabled = !allowedRoles.includes(role);
}
