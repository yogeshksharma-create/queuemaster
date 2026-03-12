
import {
  applyTheme,
  getSession,
  isConfigured,
  loadTheme,
  requireConfiguredClient,
  showToast,
  supabase,
} from "./supabaseClient.js";

const signInTab = document.getElementById("showSignIn");
const signUpTab = document.getElementById("showSignUp");
const signInForm = document.getElementById("signInForm");
const signUpForm = document.getElementById("signUpForm");
const resetForm = document.getElementById("resetForm");
const themeBtn = document.getElementById("themeToggle");
const configNotice = document.getElementById("configNotice");

function switchMode(mode) {
  signInForm.classList.toggle("hidden", mode !== "signin");
  signUpForm.classList.toggle("hidden", mode !== "signup");
  resetForm.classList.add("hidden");
  signInTab.classList.toggle("primary", mode === "signin");
  signInTab.classList.toggle("secondary", mode !== "signin");
  signUpTab.classList.toggle("primary", mode === "signup");
  signUpTab.classList.toggle("secondary", mode !== "signup");
}

async function handleSignIn(event) {
  event.preventDefault();
  try {
    requireConfiguredClient();
    const email = document.getElementById("signinEmail").value.trim();
    const password = document.getElementById("signinPassword").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showToast("Signed in.");
    window.location.href = "./dashboard.html";
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleSignUp(event) {
  event.preventDefault();
  try {
    requireConfiguredClient();
    const fullName = document.getElementById("signupFullName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (error) throw error;
    showToast("Check your email for confirmation if enabled.");
    switchMode("signin");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleReset(event) {
  event.preventDefault();
  try {
    requireConfiguredClient();
    const email = document.getElementById("resetEmail").value.trim();
    const redirectTo = `${window.location.origin}${window.location.pathname.replace("index.html", "dashboard.html")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    showToast("Password reset email sent.");
    switchMode("signin");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function init() {
  loadTheme(false);

  themeBtn?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  signInTab?.addEventListener("click", () => switchMode("signin"));
  signUpTab?.addEventListener("click", () => switchMode("signup"));
  signInForm?.addEventListener("submit", handleSignIn);
  signUpForm?.addEventListener("submit", handleSignUp);
  resetForm?.addEventListener("submit", handleReset);

  document.getElementById("showReset")?.addEventListener("click", () => {
    signInForm.classList.add("hidden");
    signUpForm.classList.add("hidden");
    resetForm.classList.remove("hidden");
  });

  document.getElementById("backToLogin")?.addEventListener("click", () => switchMode("signin"));

  if (!isConfigured()) {
    configNotice?.classList.remove("hidden");
  }

  const session = await getSession();
  if (session) {
    window.location.href = "./dashboard.html";
  }
}

init();
