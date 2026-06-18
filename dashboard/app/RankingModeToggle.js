"use client";

import { useState, useTransition } from "react";
import { setRankingForceRerun } from "./actions";

// Toggle that controls how the next ranking run behaves. The state is saved in
// Supabase (app_settings.ranking_force_rerun) and the Python ranking layer reads
// it at run time:
//   OFF (default) → incremental: only newly added extensions are analyzed.
//   ON            → full re-run: re-score the whole top-25, overwriting existing.
export default function RankingModeToggle({ initial }) {
  const [on, setOn] = useState(Boolean(initial)); // on = full-re-run override
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  function toggle() {
    const next = !on;
    setError(null);
    startTransition(async () => {
      const res = await setRankingForceRerun(next);
      if (!res || !res.ok) setError((res && res.error) || "Couldn't save the setting.");
      else setOn(next);
    });
  }

  return (
    <div className={`ranking-mode ${on ? "is-force" : "is-incremental"}`}>
      <div className="rm-text">
        <span className="rm-label">Ranking mode</span>
        {on ? (
          <span className="rm-badge rm-force">🔁 Full re-run (override ON)</span>
        ) : (
          <span className="rm-badge rm-incremental">⚡ Incremental — new only</span>
        )}
        <span className="rm-help">
          {on
            ? "The next run re-analyzes the whole top-25, overwriting existing scores. The deep-dive queue is always processed."
            : "Runs only score newly added extensions and process the deep-dive queue — re-running burns no tokens on extensions already scored."}
        </span>
      </div>
      <button className="btn-toggle" disabled={pending} onClick={toggle}>
        {pending ? "Saving…" : on ? "Switch to incremental" : "Force a full re-run"}
      </button>
      {error ? <span className="deepdive-error">{error}</span> : null}
    </div>
  );
}
