# The tutor's attempt-first policy, its once-per-session study record, and the prompt ceiling

Proof that `references/bootstrap/_lesson-core/chat/buildSystemPrompt.js` carries the two rules
study-coach milestone 3 asked for, and that the assembled prompt still fits on argv.

```
node tests/tutor-policy/check.cjs                       # in the gate
LESSONS_DIR=~/dev/lessons node tests/tutor-policy/sweep.mjs   # by hand: re-measure over real lessons
```

Node only. No `npm install`, no network, no browser.

1. **Attempt first.** A request for a solution, a worked step or a practice card's answer gets the
   student's attempt asked for first, in the shape the brief gave; a student who cannot start is
   taught that one step and then asked for an independent attempt; the reply labels each checked
   answer *independent* or *with help* (an answer right after seeing a solution is *with help* —
   the lessons repo's `distill-chats` reads the transcript for those two words); a later session
   re-checks the same skill with a different example. The old "Retrieval first" bullet is gone,
   not kept beside it.
2. **Study record once per session.** The rule reads a record the LESSON_CONTEXT names once at
   the start of the session and re-reads only when the student asks. It is in every prompt (it
   only fires when a record is named); the generic file-access line rides with it only when the
   context does not already name the Read/Glob/Grep tools, and the rule appears once.
3. **Ceiling.** Over a LESSON_CONTEXT as long as the longest in the sweep (`LARGEST_CONTEXT_CHARS`,
   with no file-access word so the generic line is included), in both memory modes, the prompt
   is <= 28000 chars — the argv threshold in `server/proxy.js` and the hosted tutor's `chat.py`.
   The stand-in course name and institution are longer than any real lesson's.

Each case fails without the change it is about: run against the pre-milestone file, 1 and 2 fail
on the missing text and 3 fails in isolation mode (28001 on the largest lesson). `sweep.mjs`
prints the current largest context so the constant can be bumped when a lesson grows.
