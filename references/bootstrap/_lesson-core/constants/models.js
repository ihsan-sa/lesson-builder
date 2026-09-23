// Models the student-facing tutor can run, in picker order.
//
// `default: true` marks the model the chat opens with (Chatbot reads the flag,
// not the array position). `key` = keyboard shortcut char; must be unique and
// avoid j/g (shadowed by Ctrl+Shift+J/G handlers in Chatbot).
//
// Opus 5.5 is the default: Anthropic's own guidance for it (platform.claude.com
// /docs/en/build-with-claude/effort, .../prompt-engineering/prompting-claude-opus-5-5)
// is medium effort — see DEFAULT_EFFORT below. Opus 5 stays in the picker one
// step down for a student or the tutor itself to fall back to. Fable 5 sits
// above the default for genuinely hard reasoning; Sonnet 5 and Haiku 4.5 sit
// below it for fast, routine turns. Superseded versions (Opus 4.7/4.6, Sonnet
// 4.6) are deliberately not listed — every one of them is dominated by an
// entry here, and a long picker is worse for students than a short correct one.
export const MODELS = [
  { model: "claude-opus-5-5",            label: "Opus 5.5",   key: "u", default: true },
  { model: "claude-opus-5",              label: "Opus 5",     key: "o" },
  { model: "claude-fable-5",             label: "Fable 5",    key: "f" },
  { model: "claude-sonnet-5",            label: "Sonnet 5",   key: "s" },
  { model: "claude-opus-4-8",            label: "Opus 4.8",   key: "p" },
  { model: "claude-haiku-4-5",           label: "Haiku 4.5",  key: "h" },
];

// `xhigh` sits between `high` and `max`. It is the recommended setting for most
// agentic and reasoning work — `max` is the tier above it and is prone to
// overthinking routine questions. The proxy allowlists all five (see
// SAFE_EFFORTS in server/proxy.js); keep the two lists in sync.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

// Defaults consumed by Chatbot.jsx (single source of truth for "what the chat
// starts on"): Opus 5.5 at medium effort — Anthropic's own default for the
// model, which matches or beats Opus 5 at high in fewer tokens; low is for
// time-to-first-token and xhigh/max are for a measured gain, not routine turns.
export const DEFAULT_MODEL = (MODELS.find(m => m.default) || MODELS[0]).model;
export const DEFAULT_EFFORT = "medium";
