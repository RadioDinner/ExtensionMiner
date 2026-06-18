"use client";

import { useState, useTransition } from "react";
import { saveScraperSettings } from "../actions";
import { SCRAPER_FIELDS, DEFAULT_SCRAPER_SETTINGS, coerceScraperSettings } from "../../lib/scraperSettings";

// Turn a stored settings object into form-friendly values (csv -> string,
// nullable numbers -> "" when null).
function toFormValues(settings) {
  const v = {};
  for (const f of SCRAPER_FIELDS) {
    const raw = settings[f.key];
    if (f.type === "csv") v[f.key] = Array.isArray(raw) ? raw.join(", ") : raw || "";
    else if (f.type === "intNull" || f.type === "floatNull") v[f.key] = raw == null ? "" : String(raw);
    else if (f.type === "bool") v[f.key] = Boolean(raw);
    else v[f.key] = raw == null ? "" : String(raw);
  }
  return v;
}

export default function ScraperSettingsForm({ initial, disabled }) {
  const [values, setValues] = useState(() => toFormValues(initial));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null); // { ok, text }

  function set(key, val) {
    setValues((v) => ({ ...v, [key]: val }));
    setMsg(null);
  }

  function onSave() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveScraperSettings(coerceScraperSettings(values));
      if (!res || !res.ok) setMsg({ ok: false, text: (res && res.error) || "Couldn't save." });
      else {
        setValues(toFormValues(res.value)); // reflect the cleaned, stored values
        setMsg({ ok: true, text: "Saved. The next scraper run will use these settings." });
      }
    });
  }

  function onReset() {
    setValues(toFormValues(DEFAULT_SCRAPER_SETTINGS));
    setMsg(null);
  }

  return (
    <section className="scraper-form">
      <div className="settings-grid">
        {SCRAPER_FIELDS.map((f) => (
          <div className={`setting ${f.type === "bool" ? "setting-bool" : ""}`} key={f.key}>
            {f.type === "bool" ? (
              <label className="bool-row">
                <input
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  disabled={disabled}
                  onChange={(e) => set(f.key, e.target.checked)}
                />
                <span className="setting-label">{f.label}</span>
              </label>
            ) : (
              <label>
                <span className="setting-label">{f.label}</span>
                <input
                  type={f.type === "csv" ? "text" : "number"}
                  step={f.type === "float" || f.type === "floatNull" ? "0.1" : "1"}
                  inputMode={f.type === "csv" ? "text" : "decimal"}
                  value={values[f.key]}
                  placeholder={f.type === "intNull" || f.type === "floatNull" ? "default" : ""}
                  disabled={disabled}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </label>
            )}
            <p className="setting-help">{f.help}</p>
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button className="btn-deepdive" disabled={pending || disabled} onClick={onSave}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        <button className="btn-link" disabled={pending || disabled} onClick={onReset}>
          Reset to defaults
        </button>
        {msg ? (
          <span className={msg.ok ? "save-ok" : "deepdive-error"}>{msg.text}</span>
        ) : null}
      </div>
    </section>
  );
}
