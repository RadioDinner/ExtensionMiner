"use server";

import { revalidatePath } from "next/cache";
import { getServerClient } from "../lib/supabase";
import { coerceScraperSettings } from "../lib/scraperSettings";
import { buildStudyPrompt } from "../lib/layerPrompts";
import { parseStudyReport } from "../lib/layerReport";

// Resolve a Chrome Web Store ext_id to its internal extensions.id (PK).
async function extPk(supabase, extId) {
  const { data } = await supabase
    .from("extensions")
    .select("id")
    .eq("ext_id", extId)
    .maybeSingle();
  return data ? data.id : null;
}

// Page-ready extension fields used to build a study prompt.
async function extForPrompt(supabase, extId) {
  const { data } = await supabase
    .from("extensions")
    .select("id,ext_id,name,developer,store_category,rating,rating_count,install_count,listing_url")
    .eq("ext_id", extId)
    .maybeSingle();
  return data || null;
}

// Layer gating: Layer 2 needs Layer 1 done; Layer 3 needs Layer 2 done.
async function prereqDone(supabase, extPkId, layer) {
  const requires = Number(layer) === 3 ? 2 : Number(layer) === 2 ? 1 : 0;
  if (!requires) return true;
  if (requires === 1) {
    const { data } = await supabase
      .from("deep_dives")
      .select("status")
      .eq("extension_id", extPkId)
      .maybeSingle();
    return Boolean(data && data.status === "done");
  }
  const { data } = await supabase
    .from("deep_dive_studies")
    .select("status")
    .eq("extension_id", extPkId)
    .eq("layer", requires)
    .maybeSingle();
  return Boolean(data && data.status === "done");
}

const PREREQ_MSG = {
  2: "Run Layer 1 first — the deep-dive layers are sequential.",
  3: "Finish Layer 2 first — the deep-dive layers are sequential.",
};

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

// Toggle the ranking-layer override. Persisted in Supabase (app_settings) so the
// Python ranking layer reads it at run time: ON = full re-run across the top-N,
// OFF = incremental (only newly added extensions). Server-side only.
export async function setRankingForceRerun(value) {
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "ranking_force_rerun", value: Boolean(value) }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/");
    return { ok: true, value: Boolean(value) };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Save the "Scraper settings" tab. Persisted in Supabase (app_settings.
// scraper_settings) so the Python scraper reads it with --use-saved-settings.
// Coerced server-side so only clean, typed values are stored.
export async function saveScraperSettings(input) {
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const value = coerceScraperSettings(input);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "scraper_settings", value }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/scraper-settings");
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Dismiss an extension from the opportunity zone with a reason. The zone backfills
// with the next candidate so the working list stays at 25. Server-side only.
export async function dismissFromZone(extId, reason) {
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const id = await extPk(supabase, extId);
    if (!id) return { ok: false, error: "Extension not found." };
    const { error } = await supabase
      .from("zone_exclusions")
      .upsert({ extension_id: id, reason: reason || null }, { onConflict: "extension_id" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Bring a dismissed extension back into the opportunity zone.
export async function restoreToZone(extId) {
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const id = await extPk(supabase, extId);
    if (!id) return { ok: false, error: "Extension not found." };
    const { error } = await supabase.from("zone_exclusions").delete().eq("extension_id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/");
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

// --- Layer 2 / 3 ("deep dive study") — skill-driven, gated, upload-backed ----

// Queue an extension for a study layer: store a generated, stable research prompt
// the user pastes into a Claude deep-research session. Gated on the prior layer.
export async function queueStudy(extId, layer) {
  const lyr = Number(layer);
  if (lyr !== 2 && lyr !== 3) return { ok: false, error: "Unknown layer." };
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const ext = await extForPrompt(supabase, extId);
    if (!ext) return { ok: false, error: "Extension not found." };
    if (!(await prereqDone(supabase, ext.id, lyr))) {
      return { ok: false, error: PREREQ_MSG[lyr] };
    }
    const prompt = buildStudyPrompt(ext, lyr);
    const { error } = await supabase
      .from("deep_dive_studies")
      .upsert(
        { extension_id: ext.id, layer: lyr, status: "queued", prompt, error: null },
        { onConflict: "extension_id,layer" }
      );
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/reviews/${extId}`);
    return { ok: true, prompt };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Remove a study layer entirely (re-queueable later).
export async function removeStudy(extId, layer) {
  const lyr = Number(layer);
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const id = await extPk(supabase, extId);
    if (!id) return { ok: false, error: "Extension not found." };
    const { error } = await supabase
      .from("deep_dive_studies")
      .delete()
      .eq("extension_id", id)
      .eq("layer", lyr);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/reviews/${extId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Extract text from an uploaded PDF (serverless-friendly, lazy-loaded).
async function pdfToText(file) {
  const buf = Buffer.from(await file.arrayBuffer());
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return typeof text === "string" ? text : Array.isArray(text) ? text.join("\n\n") : "";
}

// Upload a finished deep-research report (PDF export, or pasted text) for a study
// layer. Parses the narrative + the structured JSON block and stores both.
export async function uploadStudyReport(extId, layer, formData) {
  const lyr = Number(layer);
  if (lyr !== 2 && lyr !== 3) return { ok: false, error: "Unknown layer." };
  const supabase = getServerClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  try {
    const id = await extPk(supabase, extId);
    if (!id) return { ok: false, error: "Extension not found." };
    if (!(await prereqDone(supabase, id, lyr))) {
      return { ok: false, error: PREREQ_MSG[lyr] };
    }

    const file = formData.get("file");
    const pasted = formData.get("text");
    let raw = "";
    let source_filename = null;
    if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
      source_filename = file.name || "upload.pdf";
      try {
        raw = await pdfToText(file);
      } catch (e) {
        return { ok: false, error: `Couldn't read that PDF (${e && e.message ? e.message : e}). You can paste the report text instead.` };
      }
    } else if (typeof pasted === "string" && pasted.trim()) {
      raw = pasted;
    } else {
      return { ok: false, error: "Attach the exported PDF, or paste the report text." };
    }
    if (!raw.trim()) {
      return { ok: false, error: "The upload came through empty — try pasting the report text instead." };
    }

    const parsed = parseStudyReport(raw);
    const row = {
      extension_id: id,
      layer: lyr,
      status: "done",
      uploaded_at: new Date().toISOString(),
      model: "deep-research",
      report_md: parsed.report_md,
      summary: parsed.summary || null,
      recommendation: parsed.recommendation || null,
      target_strengths: parsed.target_strengths,
      target_weaknesses: parsed.target_weaknesses,
      competitors: parsed.competitors,
      opportunities: parsed.opportunities,
      financials: parsed.financials,
      sources: parsed.sources,
      details: parsed.details,
      source_filename,
      parse_warning: parsed.parse_warning,
      error: null,
    };
    const { error } = await supabase
      .from("deep_dive_studies")
      .upsert(row, { onConflict: "extension_id,layer" });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/reviews/${extId}`);
    return { ok: true, parse_warning: parsed.parse_warning };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
