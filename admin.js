
import {
  ensureAuthOrRedirect,
  formatDateTime,
  getStoredSiteId,
  invokeEdgeFunction,
  loadActiveNames,
  loadMemberships,
  loadSelectionHistory,
  loadSiteSettings,
  loadTheme,
  setStoredSiteId,
  showToast,
  signOut,
  supabase,
  toggleTheme,
} from "./supabaseClient.js";

const state = {
  session: null,
  memberships: [],
  currentSiteId: null,
  currentRole: null,
  names: [],
  joinRequests: [],
  members: [],
  realtimeChannel: null,
};

const els = {
  siteSelector: document.getElementById("adminSiteSelector"),
  siteBadge: document.getElementById("adminSiteBadge"),
  roleBadge: document.getElementById("adminRoleBadge"),
  themeToggle: document.getElementById("themeToggle"),
  logoutBtn: document.getElementById("logoutBtn"),
  settingsForm: document.getElementById("settingsForm"),
  membersTableBody: document.getElementById("membersTableBody"),
  joinRequestsList: document.getElementById("joinRequestsList"),
  namesList: document.getElementById("namesList"),
  nameForm: document.getElementById("nameForm"),
  nameInput: document.getElementById("nameInput"),
  nameSuggestions: document.getElementById("nameSuggestions"),
  inviteForm: document.getElementById("inviteForm"),
  inviteResult: document.getElementById("inviteResult"),
  historyList: document.getElementById("adminHistoryList"),
  adminOnlyPanels: [...document.querySelectorAll("[data-admin-only='true']")],
};

function membershipForSite(siteId) {
  return state.memberships.find((m) => m.siteId === siteId) || null;
}

function setRoleContext() {
  const membership = membershipForSite(state.currentSiteId);
  if (!membership) return;
  state.currentRole = membership.role;
  els.siteBadge.textContent = membership.siteName;
  els.roleBadge.textContent = membership.role;
  els.adminOnlyPanels.forEach((panel) => panel.classList.toggle("hidden", membership.role !== "ADMIN"));
}

async function loadMembers() {
  const { data, error } = await supabase
    .from("user_site_roles")
    .select("id, user_id, role, is_active, deleted_at, profiles:profiles!user_site_roles_user_id_fkey(full_name, email)")
    .eq("site_id", state.currentSiteId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  state.members = data || [];
}

async function loadJoinRequests() {
  const { data, error } = await supabase
    .from("join_requests")
    .select("id, requester_user_id, requested_site_name, requested_role, message, status, created_at, profiles:profiles!join_requests_requester_user_id_fkey(full_name, email)")
    .eq("target_site_id", state.currentSiteId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  state.joinRequests = data || [];
}

async function loadAdminData() {
  const [settings, names, history] = await Promise.all([
    loadSiteSettings(state.currentSiteId),
    loadActiveNames(state.currentSiteId),
    loadSelectionHistory(state.currentSiteId, 30),
  ]);

  state.names = names;
  await Promise.all([loadMembers(), loadJoinRequests()]);
  renderSettings(settings);
  renderMembers();
  renderJoinRequests();
  renderNames();
  renderHistory(history);
}

function renderSettings(settings) {
  if (!els.settingsForm) return;
  els.settingsForm.selectionCommentMode.value = settings.selection_comment_mode;
  els.settingsForm.skipCommentMode.value = settings.skip_comment_mode;
  els.settingsForm.reverseCommentMode.value = settings.reverse_comment_mode;
  els.settingsForm.dailyCycleResetEnabled.checked = settings.daily_cycle_reset_enabled;
  els.settingsForm.commandsEnabled.checked = settings.commands_enabled;
  els.settingsForm.darkModeDefault.checked = settings.dark_mode_default;
  els.settingsForm.allowFreeTextNames.checked = settings.allow_free_text_names;
  els.settingsForm.maxCommentLength.value = settings.max_comment_length;
}

function renderMembers() {
  els.membersTableBody.innerHTML = "";
  for (const member of state.members) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${member.profiles?.full_name || "—"}<div class="muted small">${member.profiles?.email || member.user_id}</div></td>
      <td>
        <select data-role-select="${member.id}" ${state.currentRole !== "ADMIN" ? "disabled" : ""}>
          ${["ADMIN", "EDITOR", "TASKER", "VIEWER"].map((role) => `<option value="${role}" ${member.role === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>
      </td>
      <td>
        <label class="small">
          <input type="checkbox" data-active-toggle="${member.id}" ${member.is_active ? "checked" : ""} ${state.currentRole !== "ADMIN" ? "disabled" : ""}>
          Active
        </label>
      </td>
      <td>${member.deleted_at ? "Soft deleted" : "Current"}</td>
      <td>
        <button class="secondary small-action" data-member-save="${member.id}" ${state.currentRole !== "ADMIN" ? "disabled" : ""}>Save</button>
      </td>
    `;
    els.membersTableBody.appendChild(row);
  }
}

function renderJoinRequests() {
  els.joinRequestsList.innerHTML = "";
  const pending = state.joinRequests.filter((r) => r.status === "pending");

  if (!pending.length) {
    els.joinRequestsList.innerHTML = `<div class="empty-state">No pending join requests.</div>`;
    return;
  }

  for (const request of pending) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <strong>${request.profiles?.full_name || request.profiles?.email || request.requester_user_id}</strong>
      <div class="muted small">${formatDateTime(request.created_at)} • requested ${request.requested_role}</div>
      <div>${request.message || "No request note provided."}</div>
      <div class="button-row">
        <select data-approve-role="${request.id}">
          ${["VIEWER", "TASKER", "EDITOR", "ADMIN"].map((role) => `<option value="${role}" ${request.requested_role === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>
        <button class="primary" data-approve-request="${request.id}">Approve</button>
        <button class="danger" data-deny-request="${request.id}">Deny</button>
      </div>
    `;
    els.joinRequestsList.appendChild(item);
  }
}

function renderNames() {
  els.namesList.innerHTML = "";
  els.nameSuggestions.innerHTML = "";

  if (!state.names.length) {
    els.namesList.innerHTML = `<div class="empty-state">No names configured yet.</div>`;
  }

  for (const name of state.names) {
    const option = document.createElement("option");
    option.value = name.display_name;
    els.nameSuggestions.appendChild(option);

    const item = document.createElement("div");
    item.className = "draggable-item";
    item.draggable = ["ADMIN", "EDITOR"].includes(state.currentRole);
    item.dataset.id = name.id;
    item.innerHTML = `
      <div class="form-row">
        <input type="text" value="${name.display_name}" data-name-edit="${name.id}" aria-label="Edit name ${name.display_name}">
        <button class="secondary" data-name-save="${name.id}">Save</button>
        <button class="danger" data-name-delete="${name.id}">Soft delete</button>
      </div>
      <div class="muted small">Sort order: ${name.sort_order}</div>
    `;
    els.namesList.appendChild(item);
  }

  setupDragAndDrop();
}

function renderHistory(history) {
  els.historyList.innerHTML = "";
  if (!history.length) {
    els.historyList.innerHTML = `<div class="empty-state">No recent queue history.</div>`;
    return;
  }

  for (const item of history) {
    const card = document.createElement("div");
    card.className = "list-item";
    card.innerHTML = `
      <div class="badge-row"><span class="badge">${item.action_type}</span></div>
      <strong>${item.free_text_name_snapshot || "System action"}</strong>
      <div class="muted small">${formatDateTime(item.created_at)}</div>
      <div>${item.comment || "No comment provided."}</div>
    `;
    els.historyList.appendChild(card);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  if (state.currentRole !== "ADMIN") return;

  const payload = {
    selection_comment_mode: els.settingsForm.selectionCommentMode.value,
    skip_comment_mode: els.settingsForm.skipCommentMode.value,
    reverse_comment_mode: els.settingsForm.reverseCommentMode.value,
    daily_cycle_reset_enabled: els.settingsForm.dailyCycleResetEnabled.checked,
    commands_enabled: els.settingsForm.commandsEnabled.checked,
    dark_mode_default: els.settingsForm.darkModeDefault.checked,
    allow_free_text_names: els.settingsForm.allowFreeTextNames.checked,
    max_comment_length: Number(els.settingsForm.maxCommentLength.value || 280),
    updated_by: state.session.user.id,
  };

  const { error } = await supabase
    .from("site_settings")
    .update(payload)
    .eq("site_id", state.currentSiteId);

  if (error) throw error;
  showToast("Settings updated.");
}

async function saveMember(memberId) {
  const role = document.querySelector(`[data-role-select='${memberId}']`)?.value;
  const isActive = document.querySelector(`[data-active-toggle='${memberId}']`)?.checked;

  const { error } = await supabase
    .from("user_site_roles")
    .update({
      role,
      is_active: isActive,
      updated_by: state.session.user.id,
    })
    .eq("id", memberId);

  if (error) throw error;
  showToast("Membership updated.");
  await loadMembers();
  renderMembers();
}

async function submitInvite(event) {
  event.preventDefault();
  if (state.currentRole !== "ADMIN") return;

  const invitedEmail = document.getElementById("inviteEmail").value.trim();
  const invitedRole = document.getElementById("inviteRole").value;

  const result = await invokeEdgeFunction("invite-user-to-site", {
    siteId: state.currentSiteId,
    invitedEmail,
    invitedRole,
  });

  els.inviteResult.textContent = `Invite token (dev only): ${result.inviteToken}`;
  event.target.reset();
  showToast("Invitation created.");
}

async function submitJoinRequestAction(action, requestId) {
  const approvedRole = document.querySelector(`[data-approve-role='${requestId}']`)?.value || "VIEWER";
  await invokeEdgeFunction("approve-join-request", {
    joinRequestId: requestId,
    action,
    role: approvedRole,
  });
  showToast(`Join request ${action}d.`);
  await loadJoinRequests();
  renderJoinRequests();
  await loadMembers();
  renderMembers();
}

async function submitName(event) {
  event.preventDefault();
  if (!["ADMIN", "EDITOR"].includes(state.currentRole)) return;

  const displayName = els.nameInput.value.trim();
  if (!displayName) throw new Error("Name is required.");

  const existing = state.names.find((name) => name.display_name.toLowerCase() === displayName.toLowerCase());
  if (existing) throw new Error("That name already exists in this site.");

  const nextOrder = state.names.length ? Math.max(...state.names.map((n) => n.sort_order)) + 1 : 0;

  const { error } = await supabase.from("name_lists").insert({
    site_id: state.currentSiteId,
    display_name: displayName,
    sort_order: nextOrder,
    is_active: true,
    created_by: state.session.user.id,
    updated_by: state.session.user.id,
  });

  if (error) throw error;
  els.nameForm.reset();
  showToast("Name added.");
  state.names = await loadActiveNames(state.currentSiteId);
  renderNames();
}

async function saveName(nameId) {
  const input = document.querySelector(`[data-name-edit='${nameId}']`);
  const { error } = await supabase
    .from("name_lists")
    .update({
      display_name: input.value.trim(),
      updated_by: state.session.user.id,
    })
    .eq("id", nameId);

  if (error) throw error;
  showToast("Name updated.");
  state.names = await loadActiveNames(state.currentSiteId);
  renderNames();
}

async function softDeleteName(nameId) {
  if (!confirm("Soft delete this name?")) return;

  const { error } = await supabase
    .from("name_lists")
    .update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      updated_by: state.session.user.id,
    })
    .eq("id", nameId);

  if (error) throw error;
  showToast("Name soft deleted.");
  state.names = await loadActiveNames(state.currentSiteId);
  renderNames();
}

function setupDragAndDrop() {
  const items = [...els.namesList.querySelectorAll(".draggable-item")];
  let draggedItem = null;

  items.forEach((item) => {
    item.addEventListener("dragstart", () => {
      draggedItem = item;
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      draggedItem = null;
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!draggedItem || draggedItem === item) return;
      const rect = item.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      els.namesList.insertBefore(draggedItem, before ? item : item.nextSibling);
    });
  });
}

async function persistReorder() {
  const orderedIds = [...els.namesList.querySelectorAll(".draggable-item")].map((item) => item.dataset.id);
  await invokeEdgeFunction("reorder-names", {
    siteId: state.currentSiteId,
    orderedIds,
  });
  showToast("Name order saved.");
  state.names = await loadActiveNames(state.currentSiteId);
  renderNames();
}

async function resetRotation() {
  if (!confirm("Reset rotation for this site?")) return;
  await invokeEdgeFunction("reset-rotation", {
    siteId: state.currentSiteId,
    comment: "Manual administrative reset",
  });
  showToast("Rotation reset.");
}

async function refreshAll() {
  setStoredSiteId(state.currentSiteId);
  setRoleContext();
  await loadAdminData();
  subscribeAdminRealtime();
}


function subscribeAdminRealtime() {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }

  state.realtimeChannel = supabase
    .channel(`site-${state.currentSiteId}-admin`)
    .on("postgres_changes", { event: "*", schema: "public", table: "name_lists", filter: `site_id=eq.${state.currentSiteId}` }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "join_requests", filter: `target_site_id=eq.${state.currentSiteId}` }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "user_site_roles", filter: `site_id=eq.${state.currentSiteId}` }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "site_settings", filter: `site_id=eq.${state.currentSiteId}` }, refreshAll)
    .subscribe();
}


async function init() {
  state.session = await ensureAuthOrRedirect();
  if (!state.session) return;
  loadTheme(false);

  state.memberships = await loadMemberships();
  const allowed = state.memberships.filter((m) => ["ADMIN", "EDITOR"].includes(m.role));

  if (!allowed.length) {
    showToast("You do not have editor or admin access.", "error");
    window.location.href = "./dashboard.html";
    return;
  }

  els.siteSelector.innerHTML = "";
  for (const membership of allowed) {
    const option = document.createElement("option");
    option.value = membership.siteId;
    option.textContent = membership.siteName;
    els.siteSelector.appendChild(option);
  }

  const preferred = getStoredSiteId();
  state.currentSiteId = allowed.find((m) => m.siteId === preferred)?.siteId || allowed[0].siteId;
  els.siteSelector.value = state.currentSiteId;
  await refreshAll();

  els.siteSelector.addEventListener("change", async (event) => {
    state.currentSiteId = event.target.value;
    await refreshAll();
  });

  els.settingsForm?.addEventListener("submit", async (event) => {
    try {
      await saveSettings(event);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  els.nameForm?.addEventListener("submit", async (event) => {
    try {
      await submitName(event);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  document.getElementById("saveReorderBtn")?.addEventListener("click", async () => {
    try {
      await persistReorder();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  document.getElementById("resetRotationBtn")?.addEventListener("click", async () => {
    try {
      await resetRotation();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  els.inviteForm?.addEventListener("submit", async (event) => {
    try {
      await submitInvite(event);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  els.membersTableBody?.addEventListener("click", async (event) => {
    const memberId = event.target.dataset.memberSave;
    if (!memberId) return;
    try {
      await saveMember(memberId);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  els.joinRequestsList?.addEventListener("click", async (event) => {
    const approveId = event.target.dataset.approveRequest;
    const denyId = event.target.dataset.denyRequest;
    if (approveId) {
      try {
        await submitJoinRequestAction("approve", approveId);
      } catch (error) {
        showToast(error.message, "error");
      }
    }
    if (denyId) {
      try {
        await submitJoinRequestAction("deny", denyId);
      } catch (error) {
        showToast(error.message, "error");
      }
    }
  });

  els.namesList?.addEventListener("click", async (event) => {
    const saveId = event.target.dataset.nameSave;
    const deleteId = event.target.dataset.nameDelete;
    try {
      if (saveId) await saveName(saveId);
      if (deleteId) await softDeleteName(deleteId);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  els.logoutBtn?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "./index.html";
  });

  els.themeToggle?.addEventListener("click", () => {
    const next = toggleTheme();
    showToast(`Theme set to ${next}.`);
  });
}

document.addEventListener("DOMContentLoaded", init);
