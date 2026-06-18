"use client";

import { useRef, useState, useTransition } from "react";
import { queueStudy, removeStudy, uploadStudyReport } from "../../actions";

// One skill-driven deep-dive layer (Layer 2 or 3). Lifecycle:
//   not started → "Generate research prompt" (gated on the prior layer)
//   queued      → copy the prompt, run deep research, upload the PDF
//   done        → report rendered above; offer re-upload / remove
//
// The prompt is generated server-side (stable per extension+layer) and passed in.
export default function StudyLayer({ extId, layer, meta, status, prompt, locked, lockMsg, uploadedAt, sourceFilename }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);
  const textRef = useRef(null);

  const queued = status === "queued";
  const done = status === "done";
  const active = queued || done; // a prompt exists to copy / a report can be uploaded

  function run(fn) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res || !res.ok) setError((res && res.error) || "Something went wrong.");
      else if (res.parse_warning) setNotice(res.parse_warning);
    });
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy — select the prompt below and copy manually.");
    }
  }

  function onUpload(e) {
    e.preventDefault();
    const fd = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) fd.set("file", file);
    if (textRef.current?.value) fd.set("text", textRef.current.value);
    run(() => uploadStudyReport(extId, layer, fd));
  }

  return (
    <div className={`study-layer${locked ? " locked" : ""}`}>
      <div className="study-layer-head">
        <span className="study-icon">{meta.icon}</span>
        <span className="study-name">
          <strong>{meta.short}</strong> · {meta.name}
        </span>
        <span className={`study-status ${done ? "is-done" : queued ? "is-queued" : "is-none"}`}>
          {done ? "✅ report uploaded" : queued ? "⏳ awaiting your report" : locked ? "🔒 locked" : "○ not started"}
        </span>
      </div>
      <p className="study-blurb muted">{meta.blurb}</p>

      {locked ? (
        <p className="study-lock muted">🔒 {lockMsg}</p>
      ) : !active ? (
        <button className="btn-deepdive" disabled={pending} onClick={() => run(() => queueStudy(extId, layer))}>
          {pending ? "Generating…" : `${meta.icon} Generate research prompt`}
        </button>
      ) : (
        <div className="study-active">
          <div className="study-actions">
            <button className="btn-deepdive" disabled={pending || !prompt} onClick={copyPrompt}>
              {copied ? "Copied ✓" : "📋 Copy research prompt"}
            </button>
            <button className="btn-link" disabled={pending} onClick={() => run(() => removeStudy(extId, layer))}>
              {pending ? "…" : done ? "remove" : "cancel"}
            </button>
            {done && uploadedAt ? (
              <span className="muted study-meta">
                uploaded {String(uploadedAt).slice(0, 10)}
                {sourceFilename ? ` · ${sourceFilename}` : ""}
              </span>
            ) : null}
          </div>

          <details className="study-prompt">
            <summary>Show the prompt</summary>
            <p className="muted study-howto">
              Paste this into a Claude session with the deep-research skill, run it, then export the
              report as a PDF and upload it below.
            </p>
            <textarea className="study-prompt-text" readOnly value={prompt || ""} rows={10} />
          </details>

          <form className="study-upload" onSubmit={onUpload}>
            <label className="study-field">
              <span>{done ? "Replace the report" : "Upload the exported report"} (PDF)</span>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" />
            </label>
            <details className="study-paste">
              <summary>…or paste the report text instead</summary>
              <textarea ref={textRef} rows={6} placeholder="Paste the full deep-research report here (including the JSON block at the end)." />
            </details>
            <button className="btn-deepdive" type="submit" disabled={pending}>
              {pending ? "Uploading…" : done ? "Re-upload report" : "Upload report"}
            </button>
          </form>
        </div>
      )}

      {notice ? <p className="study-notice">⚠ {notice}</p> : null}
      {error ? <span className="deepdive-error">{error}</span> : null}
    </div>
  );
}
