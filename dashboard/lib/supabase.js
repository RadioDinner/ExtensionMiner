import { createClient } from "@supabase/supabase-js";

// Server-side only. The schema enables RLS with no policies, so the dashboard
// reads with the SERVICE ROLE key. Keep it server-side (no NEXT_PUBLIC_).
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isConfigured = Boolean(url && serviceRoleKey);

export function getServerClient() {
  if (!isConfigured) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
