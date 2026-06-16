#!/bin/bash
# ---------------------------------------------------------------------------
# SessionStart hook for ExtensionMiner.
#
# Runs at the start of every Claude Code session. It injects the project's
# "new session" protocol (see NEW_SESSION_INSTRUCTIONS.md / CLAUDE.md) into
# the session context and surfaces the most recent session handoff log so the
# agent picks up exactly where the last session left off.
#
# It does NOT create folders or write files itself — the agent performs those
# steps (creating the session folder, logging prompts verbatim, writing the
# handoff) because only the agent sees the prompts as they arrive. This hook
# just makes sure the protocol "occurs" by putting it front-and-center every
# session and pre-computing the next session number.
#
# Output: structured JSON with hookSpecificOutput.additionalContext, which
# Claude Code adds to the session context.
# ---------------------------------------------------------------------------
set -euo pipefail

# Resolve the repo root. Claude Code provides CLAUDE_PROJECT_DIR; fall back to
# the script's location (two levels up from .claude/hooks/) for manual testing.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Read the hook payload from stdin and extract the session source. Sources:
#   startup  -> a brand new session  (create a new Session folder)
#   clear    -> context was cleared  (treat like a fresh session)
#   resume   -> resuming a session   (continue the current Session folder)
#   compact  -> context compacted    (continue the current Session folder)
INPUT="$(cat 2>/dev/null || true)"
SOURCE="$(printf '%s' "$INPUT" | jq -r '.source // "startup"' 2>/dev/null || echo "startup")"

SESSION_LOG_DIR="$PROJECT_DIR/Session log"

# Find the highest existing "Session N" number and the latest handoff log.
LATEST_NUM=0
if [ -d "$SESSION_LOG_DIR" ]; then
  while IFS= read -r dir; do
    n="$(basename "$dir" | sed -n 's/^Session \([0-9][0-9]*\)$/\1/p')"
    [ -n "$n" ] || continue
    if [ "$n" -gt "$LATEST_NUM" ]; then
      LATEST_NUM="$n"
    fi
  done < <(find "$SESSION_LOG_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
fi
NEXT_NUM=$((LATEST_NUM + 1))

# Grab the most recent handoff log (if any), capped so we never flood context.
LATEST_LOG_PATH=""
LATEST_LOG_BODY="(none yet — this is the first session.)"
if [ "$LATEST_NUM" -gt 0 ] && [ -f "$SESSION_LOG_DIR/Session $LATEST_NUM/session_log.txt" ]; then
  LATEST_LOG_PATH="Session log/Session $LATEST_NUM/session_log.txt"
  LATEST_LOG_BODY="$(head -c 8000 "$SESSION_LOG_DIR/Session $LATEST_NUM/session_log.txt")"
  if [ "$(wc -c < "$SESSION_LOG_DIR/Session $LATEST_NUM/session_log.txt")" -gt 8000 ]; then
    LATEST_LOG_BODY="$LATEST_LOG_BODY"$'\n...[truncated — read the full file with the Read tool].'
  fi
fi

# Decide the session-folder instruction based on the source.
case "$SOURCE" in
  resume|compact)
    SESSION_LINE="This is a ${SOURCE} of an existing session. CONTINUE \"Session ${LATEST_NUM}\" — do NOT create a new session folder. Keep appending verbatim prompts to its prompt_history.txt."
    ;;
  *)
    SESSION_LINE="This is a new session: \"Session ${NEXT_NUM}\". Create the folder \"Session log/Session ${NEXT_NUM}/\" and a \"prompt_history.txt\" inside it."
    ;;
esac

# Assemble the context payload.
read -r -d '' CONTEXT <<EOF || true
ExtensionMiner — START-OF-SESSION PROTOCOL (injected by .claude/hooks/session-start.sh)

Full protocol: NEW_SESSION_INSTRUCTIONS.md and CLAUDE.md. Do this now and throughout the session:

1. SESSION LOG: ${SESSION_LINE}
2. PROMPT HISTORY: Log EVERY user prompt VERBATIM (exact words, no paraphrasing) into prompt_history.txt as each one arrives — numbered, with a blank line between entries. Update it after every prompt, not just at the end.
3. HANDOFF: When the session wraps up, write "session_log.txt" in the session folder documenting changes made, directional decisions, open items, key context for the next session, and current project state.
4. MIGRATIONS: Supabase migrations in supabase/migrations/ count DOWN from 999. The new migration number = (lowest existing number) − 1. Never use highest + 1.
5. GIT: Commit & push the session logs before ending the session. Push to main unless a feature branch was designated for this session; do not open a PR unless asked.

MOST RECENT HANDOFF LOG (${LATEST_LOG_PATH:-none}):
${LATEST_LOG_BODY}
EOF

# Emit valid JSON regardless of special characters in the context.
jq -n --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
