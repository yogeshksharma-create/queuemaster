const SUPABASE_URL = "https://dwgnjnljpractxstijbx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3Z25qbmxqcHJhY3R4c3RpamJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNzg2MzUsImV4cCI6MjA4ODg1NDYzNX0.i0NA3K9GOIFl1zLlzisoesp9W9oGl_AMOWU0rIGTUJQ";

if (!window.supabase) {
  console.error("Supabase JS library did not load before supabaseClient.js");
} else if (
  !SUPABASE_URL ||
  SUPABASE_URL.includes("multi-site-rotation-app") ||
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
