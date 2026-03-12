
import {
  applyTheme,
  ensureAuthOrRedirect,
  formatDateTime,
  getStoredSiteId,
  guardButtonByRole,
  invokeEdgeFunction,
  loadActiveNames,
  loadMemberships,
  loadPublicSiteDirectory,
  loadSelectionHistory,
  loadSelectionState,
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
  currentSiteName: null,
  settings: null,
  selectionState: null,
  names: [],
  realtimeChannel: null,
  pendingAction: null,
};

const els = {
  siteSelector: document.getElementById("siteSelector"),
  siteBadge: document.getElementById("siteBadge"),
  roleBadge: document.getElementById("roleBadge"),
  cycleCount: document.getElementById("cycleCount"),
  queueName: document.getElementById("queueName"),
  commandBanner: document.getElementById("commandBanner"),
  confirmBtn: document.getElementById("confirmBtn"),
  skipBtn: document.getElementById("skipBtn"),
  reverseBtn: document.getElementById("reverseBtn"),
  historyList: document.getElementById("historyList"),
  themeToggle: document.getElementById("themeToggle"),
  logoutBtn: document.getElementById("logoutBtn"),
  adminLink: document.getElementById("adminLink"),
  pendingJoinAlert: document.getElementById("pendingJoinAlert"),
  joinRequestForm: document.getElementById("joinRequestForm"),
  joinRequestSiteName: document.getElementById("joinRequestSiteName"),
  joinRequestSiteId: document.getElementById("joinRequestSiteId"),
  joinRequestMessage: document.getElementById("joinRequestMessage"),
  siteDirectory: document.getElementById("siteDirectory"),
  actionModal: document.getElementById("actionModalBackdrop"),
  actionTitle: document.getElementById("actionTitle"),
  actionDescription: document.getElementById("actionDescription"),
  actionComment: document.getElementById("actionComment"),
  actionCommentWrap: document.getElementById("actionCommentWrap"),
  actionWarning: document.getElementById("actionWarning"),
  actionSubmitBtn: document.getElementById("actionSubmitBtn"),
  actionCancelBtn: document.getElementById("actionCancelBtn"),
  emptyState: document.getElementById("emptyState"),
};

function getMembership(siteId) {
  return state.memberships.find((m) => m.siteId === siteId) || null;
}

function currentNextName() {
  if (!state.selectionState || !state.names.length) return null;
  return state.names[state.selectionState.current_index] || null;
}

function setLoading(loading) {
  document.body.classList.toggle("loading", loading);
}

function renderSiteSelector() {
  if (!els.siteSelector) return;
  els.siteSelector.innerHTML = "";
  for (const membership of state.memberships) {
    const option = document.createElement("option");
    option.value = membership.siteId;
    option.textContent = membership.siteName;
    els.siteSelector.appendChild(option);
  }

  const preferredSiteId = getStoredSiteId();
  const defaultSite =
    state.memberships.find((m) => m.siteId === preferredSiteId) ||
    state.memberships[0] ||
    null;

  if (defaultSite) {
    state.currentSiteId = defaultSite.siteId;
    els.siteSelector.value = defaultSite.siteId;
  }
}

function updateHeader() {
  const membership = getMembership(state.currentSiteId);
  if (!membership) return;
  state.currentRole = membership.role;
  state.currentSiteName = membership.siteName;
  els.siteBadge.textContent = membership.siteName;
  els.roleBadge.textContent = membership.role;
  els.adminLink.classList.toggle("hidden", !["ADMIN", "EDITOR"].includes(membership.role));
}

function renderQueue() {
  const nextName = currentNextName();
  els.queueName.textContent = nextName?.display_name || "No active names";
  els.cycleCount.textContent = String(state.selectionState?.cycle_count ?? 0);
  els.emptyState.classList.toggle("hidden", !!state.names.length);

  const commandsDisabled = state.settings && state.settings.commands_enabled === false;
  const canAct = ["ADMIN", "EDITOR", "TASKER"].includes(state.currentRole || "");
  guardButtonByRole(els.confirmBtn, state.currentRole, ["ADMIN", "EDITOR", "TASKER"]);
  guardButtonByRole(els.skipBtn, state.currentRole, ["ADMIN", "EDITOR", "TASKER"]);
  guardButtonByRole(els.reverseBtn, state.currentRole, ["ADMIN", "EDITOR", "TASKER"]);

  els.confirmBtn.disabled = els.confirmBtn.disabled || !state.names.length || commandsDisabled;
  els.skipBtn.disabled = els.skipBtn.disabled || !state.names.length || commandsDisabled;
  els.reverseBtn.disabled = els.reverseBtn.disabled || commandsDisabled;

  if (!canAct) {
    els.commandBanner.className = "banner warning";
    els.commandBanner.textContent = "Read-only mode: your role does not permit confirm, skip, or reverse actions.";
    els.commandBanner.classList.remove("hidden");
  } else if (commandsDisabled) {
    els.commandBanner.className = "banner danger";
    els.commandBanner.textContent = "Commands are currently disabled by site administration.";
    els.commandBanner.classList.remove("hidden");
  } else {
    els.commandBanner.classList.add("hidden");
  }
}

function renderHistory(history) {
  if (!els.historyList) return;
  els.historyList.innerHTML = "";
  if (!history.length) {
    els.historyList.innerHTML = `<div class="empty-state">No queue activity yet.</div>`;
    return;
  }

  for (const item of history) {
    const card = document.createElement("div");
    card.className = "list-item";
    const actorName = item.profiles?.full_name || item.profiles?.email || item.acted_by;
    card.innerHTML = `
      <div class="badge-row">
        <span class="badge">${item.action_type}</span>
        ${item.is_reversed ? '<span class="badge warning">Reversed</span>' : ""}
      </div>
      <strong>${item.free_text_name_snapshot || "System action"}</strong>
      <div class="muted small">${formatDateTime(item.created_at)} • ${actorName || "Unknown user"}</div>
      <div class="small">${item.comment ? item.comment : "No comment provided."}</div>
    `;
    els.historyList.appendChild(card);
  }
}

async function loadPendingJoinAlert() {
  if (!els.pendingJoinAlert || state.currentRole !== "ADMIN") {
    els.pendingJoinAlert?.classList.add("hidden");
    return;
  }

  const { data, error } = await supabase
    .from("join_requests")
    .select("id", { count: "exact", head: false })
    .eq("target_site_id", state.currentSiteId)
    .eq("status", "pending");

  if (error) {
    console.error(error);
    return;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    els.pendingJoinAlert.textContent = `${count} pending join request(s) need admin review.`;
    els.pendingJoinAlert.classList.remove("hidden");
  } else {
    els.pendingJoinAlert.classList.add("hidden");
  }
}

function syncJoinRequestSiteId() {
  const typed = els.joinRequestSiteName?.value?.trim().toLowerCase() || "";
  const option = [...(els.siteDirectory?.options || [])].find((opt) => opt.value.trim().toLowerCase() === typed);
  els.joinRequestSiteId.value = option?.dataset.siteId || "";
}

async function loadSiteDirectory() {
  if (!els.siteDirectory) return;
  const sites = await loadPublicSiteDirectory();
  els.siteDirectory.innerHTML = "";
  for (const site of sites) {
    const option = document.createElement("option");
    option.value = site.name;
    option.dataset.siteId = site.id;
    els.siteDirectory.appendChild(option);
  }
}

async function refreshSiteData() {
  if (!state.currentSiteId) return;
  setStoredSiteId(state.currentSiteId);
  updateHeader();
  setLoading(true);

  try {
    const [settings, selectionState, names, history] = await Promise.all([
      loadSiteSettings(state.currentSiteId),
      loadSelectionState(state.currentSiteId),
      loadActiveNames(state.currentSiteId),
      loadSelectionHistory(state.currentSiteId, 20),
    ]);

    state.settings = settings;
    state.selectionState = selectionState;
    state.names = names;

    loadTheme(!!settings.dark_mode_default);
    renderQueue();
    renderHistory(history);
    await loadPendingJoinAlert();
    subscribeRealtime();
  } catch (error) {
    console.error(error);
    showToast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

function closeActionModal() {
  state.pendingAction = null;
  els.actionComment.value = "";
  els.actionModal.classList.add("hidden");
}

function openActionModal(action) {
  const modes = {
    confirm: state.settings?.selection_comment_mode,
    skip: state.settings?.skip_comment_mode,
    reverse: state.settings?.reverse_comment_mode,
  };
  const mode = modes[action] || "optional";
  state.pendingAction = action;

  const labels = {
    confirm: "Confirm next name",
    skip: "Skip current name",
    reverse: "Reverse most recent action",
  };

  els.actionTitle.textContent = labels[action];
  els.actionDescription.textContent = "Comments should not contain patient identifiers or unnecessary sensitive operational details.";
  els.actionWarning.textContent =
    mode === "required"
      ? "A comment is required for this action."
      : mode === "disabled"
        ? "Comments are disabled for this action."
        : "A comment is optional for this action.";
  els.actionCommentWrap.classList.toggle("hidden", mode === "disabled");
  els.actionComment.required = mode === "required";
  els.actionModal.classList.remove("hidden");
}

async function submitAction() {
  if (!state.pendingAction) return;
  const mapping = {
    confirm: "confirm-next-name",
    skip: "skip-name",
    reverse: "reverse-last-selection",
  };
  const payload = {
    siteId: state.currentSiteId,
    comment: els.actionCommentWrap.classList.contains("hidden") ? null : els.actionComment.value.trim() || null,
    expectedVersion: state.selectionState?.version ?? null,
  };

  try {
    setLoading(true);
    await invokeEdgeFunction(mapping[state.pendingAction], payload);
    closeActionModal();
    showToast("Action completed.");
    await refreshSiteData();
  } catch (error) {
    if ((error.message || "").includes("already updated the queue")) {
      showToast("Someone else already updated the queue. Refreshing now.", "error");
      await refreshSiteData();
    } else {
      showToast(error.message, "error");
    }
  } finally {
    setLoading(false);
  }
}

async function submitJoinRequest(event) {
  event.preventDefault();
  try {
    syncJoinRequestSiteId();
    const requestedSiteName = els.joinRequestSiteName.value.trim();
    if (!requestedSiteName) throw new Error("Please enter a site name.");

    const siteId = els.joinRequestSiteId.value || null;
    const message = els.joinRequestMessage.value.trim();

    await invokeEdgeFunction("submit-join-request", {
      targetSiteId: siteId,
      requestedSiteName,
      requestedRole: "VIEWER",
      message: message || null,
    });

    showToast("Join request submitted.");
    event.target.reset();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function subscribeRealtime() {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }

  state.realtimeChannel = supabase
    .channel(`site-${state.currentSiteId}-dashboard`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "selection_state", filter: `site_id=eq.${state.currentSiteId}` },
      () => refreshSiteData(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "selection_log", filter: `site_id=eq.${state.currentSiteId}` },
      () => refreshSiteData(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "name_lists", filter: `site_id=eq.${state.currentSiteId}` },
      () => refreshSiteData(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "join_requests", filter: `target_site_id=eq.${state.currentSiteId}` },
      () => loadPendingJoinAlert(),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") console.log("Realtime subscribed");
    });
}

async function initDashboard() {
  state.session = await ensureAuthOrRedirect();
  if (!state.session) return;

  try {
    state.memberships = await loadMemberships();
    if (!state.memberships.length) {
      document.getElementById("noMembershipState")?.classList.remove("hidden");
      await loadSiteDirectory();
      return;
    }

    renderSiteSelector();
    await loadSiteDirectory();
    await refreshSiteData();
  } catch (error) {
    showToast(error.message, "error");
  }

  els.siteSelector?.addEventListener("change", async (event) => {
    state.currentSiteId = event.target.value;
    await refreshSiteData();
  });

  els.confirmBtn?.addEventListener("click", () => openActionModal("confirm"));
  els.skipBtn?.addEventListener("click", () => openActionModal("skip"));
  els.reverseBtn?.addEventListener("click", () => openActionModal("reverse"));
  els.actionCancelBtn?.addEventListener("click", closeActionModal);
  els.actionSubmitBtn?.addEventListener("click", submitAction);
  els.joinRequestForm?.addEventListener("submit", submitJoinRequest);
  els.joinRequestSiteName?.addEventListener("input", syncJoinRequestSiteId);
  els.logoutBtn?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "./index.html";
  });
  els.themeToggle?.addEventListener("click", () => {
    const next = toggleTheme();
    showToast(`Theme set to ${next}.`);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeActionModal();
  });

  window.addEventListener("beforeunload", () => {
    if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  });
}

async function initHistoryPage() {
  state.session = await ensureAuthOrRedirect();
  if (!state.session) return;

  const historySiteSelector = document.getElementById("historySiteSelector");
  const selectionHistoryTable = document.getElementById("selectionHistoryTableBody");
  const auditHistoryTable = document.getElementById("auditHistoryTableBody");
  const auditSection = document.getElementById("auditSection");
  const logoutBtn = document.getElementById("logoutBtn");
  const themeBtn = document.getElementById("themeToggle");

  state.memberships = await loadMemberships();

  for (const membership of state.memberships) {
    const option = document.createElement("option");
    option.value = membership.siteId;
    option.textContent = membership.siteName;
    historySiteSelector.appendChild(option);
  }

  const preferred = getStoredSiteId();
  state.currentSiteId = state.memberships.find((m) => m.siteId === preferred)?.siteId || state.memberships[0]?.siteId;
  historySiteSelector.value = state.currentSiteId;
  state.currentRole = getMembership(state.currentSiteId)?.role;
  loadTheme(false);

  async function renderHistoryPageSite() {
    setStoredSiteId(state.currentSiteId);
    state.currentRole = getMembership(state.currentSiteId)?.role;

    const [selectionRows, auditRows] = await Promise.all([
      loadSelectionHistory(state.currentSiteId, 100),
      ["ADMIN"].includes(state.currentRole) ? loadAuditHistory(state.currentSiteId, 100) : Promise.resolve([]),
    ]);

    selectionHistoryTable.innerHTML = "";
    for (const row of selectionRows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${formatDateTime(row.created_at)}</td>
        <td>${row.action_type}</td>
        <td>${row.free_text_name_snapshot || "System action"}</td>
        <td>${row.profiles?.full_name || row.profiles?.email || row.acted_by}</td>
        <td>${row.comment || "—"}</td>
      `;
      selectionHistoryTable.appendChild(tr);
    }

    if (auditSection) {
      auditSection.classList.toggle("hidden", !["ADMIN"].includes(state.currentRole));
    }

    if (auditHistoryTable) {
      auditHistoryTable.innerHTML = "";
      for (const row of auditRows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatDateTime(row.created_at)}</td>
          <td>${row.action_type}</td>
          <td>${row.entity_type}</td>
          <td>${row.profiles?.full_name || row.profiles?.email || row.actor_user_id || "Unknown"}</td>
          <td>${row.comment || "—"}</td>
        `;
        auditHistoryTable.appendChild(tr);
      }
    }
  }

  await renderHistoryPageSite();

  historySiteSelector.addEventListener("change", async (event) => {
    state.currentSiteId = event.target.value;
    await renderHistoryPageSite();
  });

  logoutBtn?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "./index.html";
  });

  themeBtn?.addEventListener("click", () => {
    const next = toggleTheme();
    showToast(`Theme set to ${next}.`);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  loadTheme(false);

  if (document.body.dataset.page === "dashboard") {
    await initDashboard();
  } else if (document.body.dataset.page === "history") {
    await initHistoryPage();
  }
});
