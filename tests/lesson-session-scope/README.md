# One lesson's tutor chat stays on that lesson

Proof that `references/bootstrap/_lesson-core/chat/lessonSessions.js` and its wiring in
`Chatbot.jsx` keep a chat inside the lesson it was born on.

```
node tests/lesson-session-scope/check.cjs    # in the gate
```

Node only. No `npm install`, no network, no browser.

What went wrong (owner, 2026-09-20, #lessons 1789942972.715899): sessionStorage is per origin and
survives same-tab navigation, so the bare `kcSessions` key made an ECE206 lesson auto-restore a
chat born on an ECE260 lesson, and the tutor answered with ECE260's facts. The server half
(`lessons/chat.py`, iiks1 row `tutor-session-per-lesson`) records each session's lesson, filters
`/sessions` by it and refuses `session/open` for another lesson's.

1. **Scoped keys.** The kept list, the transcript and the reinforcement list all carry the
   lesson's `BASE_URL`; the same session id under two lessons is two entries, and no key written
   equals the old un-namespaced one.
2. **A stale key is ignored, not migrated.** A storage holding the old `kcSessions` and
   `chatMsgs_<sid>` restores nothing, and those keys are left untouched rather than rewritten —
   a lost chat is cheaper than a wrong answer.
3. **Restore is this lesson's only.** Its own kept chat resumes into the first tab; a kept entry
   whose session says it was born on another lesson is never even opened. The hosted tutor's real
   `/sessions` entry carries no `base` (it filters by lesson server-side), and that shape restores.
4. **Only a refusal is silent.** A refused open (the server's 404) reports `refused` — the caller
   starts a fresh session rather than showing the picker — drops that session from the kept list,
   and takes away the extra tab it had opened for it, while a chat that did open still restores.
   No answer at all (network drop, 5xx) is an `error`: the chat stays kept and the tab shows it.
5. **The picker names the lesson** and keeps the old `Chat #N (n msgs) ISO` text. It offers the
   hosted tutor's entries (no `base`, already this lesson's) and drops only a session whose `base`
   names another lesson. Under vite dev the base names no lesson, so the label is the old one
   (which is what `tests/resume-metadata` clicks).
6. **Chatbot.jsx** reads no un-namespaced key, resumes silently on the auto-restore path, starts
   a fresh session on a refusal, keeps a network error an error, and labels and narrows the picker.

Each case fails without the change: 1-5 have no module to import, and 6 fails on the old file's
`_ss.getItem("kcSessions")`.
