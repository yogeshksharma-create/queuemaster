const SUPABASE_URL = "https://dwgnjnljpractxstijbx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oNiHxf9sCWmw0Q5pAVpi0A_m7yUKdi_";

if (!window.supabase) {
  console.error("Supabase JS library did not load before supabaseClient.js");
} else if (
  !SUPABASE_URL ||
  SUPABASE_URL.includes("YOUR_PROJECT") ||
  !SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY.includes("PASTE_YOUR_REAL_ANON_KEY_HERE")
) {
  console.error("Frontend config is not set yet. Update the public Supabase URL and anon key before sign-in.");
} else {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
  console.log("Supabase client loaded successfully");
}
