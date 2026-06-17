"use server";

import { revalidatePath } from "next/cache";
import { getServerClient } from "../lib/supabase";

// Resolve a Chrome Web Store ext_id to its internal extensions.id (PK).
async function extPk(supabase, extId) {
  const { data } = await supabase
    .from("extensions")
    .select("id")
    .eq("ext_id", extId)
    .maybeSingle();
  return data ? data.id : null;
}

// Add an extension to the deep-dive pool (or re-queue a finished/errored one).
// Server-side only, so the service-role key never reaches the browser.
export async function queueDeepDive(extId) {
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const id = await extPk(supabase, extId);
    if (!id) return { ok: false, error: "Extension not found." };
    const { error } = await supabase
      .from("deep_dives")
      .upsert({ extension_id: id, status: "queued", error: null }, { onConflict: "extension_id" });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/reviews/${extId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Remove an extension from the deep-dive pool entirely.
export async function removeDeepDive(extId) {
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const id = await extPk(supabase, extId);
    if (!id) return { ok: false, error: "Extension not found." };
    const { error } = await supabase.from("deep_dives").delete().eq("extension_id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/reviews/${extId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
