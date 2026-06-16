NEW SESSION INSTRUCTIONS
========================

At the beginning of each new session, follow these instructions:

1. SESSION LOG FOLDER
   - Navigate to the "Session log/" folder in the repo root.
   - Determine the next session number by checking existing session folders.
   - Create a new folder: "Session log/Session N/" (where N is the next number).

2. PROMPT HISTORY
   - Inside the new session folder, create a file called "prompt_history.txt".
   - Log EVERY prompt the user sends during the session into this file, in order.
   - Update the file after each prompt is received.
   - Format: number each prompt sequentially with a blank line between entries.
   - CRITICAL: Save prompts VERBATIM — copy the user's exact words. Do NOT
     summarize, paraphrase, or shorten them. The user's exact phrasing matters.

3. SESSION HANDOFF LOG
   - At the END of the session (when the user indicates they are done, or wraps up),
     create a file called "session_log.txt" in the session folder.
   - This file should document:
     a. All changes made during the session (files created, modified, deleted)
     b. Directional decisions discussed (architecture, tech stack, design choices)
     c. Any unresolved questions or open items
     d. Key context the next session needs to know
     e. Current state of the project
   - This serves as a handoff document from session to session.

4. READING PREVIOUS SESSION LOGS
   - At the start of each session, read the most recent session_log.txt to
     understand where things left off.
   - Review any open items or unresolved decisions from prior sessions.

5. GIT WORKFLOW
   - Always merge and push to main in this session unless told to create a branch.
   - Always commit and push session logs before ending a session.

6. SUPABASE MIGRATION NUMBERING (IMPORTANT)
   - Migration files in supabase/migrations/ count DOWN from 999, NOT up.
   - 999 is the OLDEST foundational migration. Newer migrations get LOWER
     numbers.
   - Before creating a new migration, run `ls supabase/migrations/` and find
     the LOWEST existing number. The new migration gets that number minus 1.
   - Example: if the lowest existing migration is 965_foo.sql, the next new
     migration is 964_<your_name>.sql.
   - Do NOT reach for "one higher than the highest" — that collides with
     existing files and is wrong.
   - When creating multiple migrations in a single session, keep decrementing
     (964, then 963, then 962, ...).

7. GENERAL
   - Keep prompt_history.txt updated throughout the session, not just at the end.
   - These instructions may be updated by the user at any time.
