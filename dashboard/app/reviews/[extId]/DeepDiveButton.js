"use client";

import { useState, useTransition } from "react";
import { queueDeepDive, removeDeepDive } from "../../actions";

// Add/remove this extension to the "Deep dive research" pool. The actual
// research runs later, when the Claude ranking layer processes the queue
// (analysis/deepdive.py) — this just flags it.
export default function DeepDiveButton({ extId, status }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  const queued = status === "queued";
  const done = status === "done";
  const errored = status === "error";

  function run(action) {
    setError(null);
    startTransition(async () => {
      const res = await action(extId);
      if (!res || !res.ok) setError((res && res.error) || "Something went wrong.");
    });
  }

  return (
    <span className="deepdive-actions">
      {queued ? (
        <>
          <span className="badge-queued" title="Waiting for the next deep-dive run">🔬 Queued for deep dive</span>
          <button className="btn-link" disabled={pending} onClick={() => run(removeDeepDive)}>
            {pending ? "…" : "remove"}
          </button>
        </>
      ) : (
        <button className="btn-deepdive" disabled={pending} onClick={() => run(queueDeepDive)}>
          {pending ? "Adding…" : done || errored ? "🔬 Re-run deep dive" : "🔬 Add to deep-dive pool"}
        </button>
      )}
      {error ? <span className="deepdive-error">{error}</span> : null}
    </span>
  );
}
