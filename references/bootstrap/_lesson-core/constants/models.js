// Models the student-facing tutor can run, in picker order.
//
// `default: true` marks the model the chat opens with (Chatbot reads the flag,
// not the array position). `key` = keyboard shortcut char; must be unique and
// avoid j/g (shadowed by Ctrl+Shift+J/G handlers in Chatbot).
//
// Opus 5 is the default: it is the recommended all-round tier and balances
// answer quality against token spend and latency. Fable 5 sits above it for
// genuinely hard reasoning; Sonnet 5 and Haiku 4.5 sit below it for fast,
// routine turns. Superseded versions (Opus 4.7/4.6, Sonnet 4.6) are
// deliberately not listed — every one of them is dominated by an entry here,
// and a long picker is worse for students than a short correct one.
export const MODELS = [
  { model: "claude-opus-5",              label: "Opus 5",     key: "o", default: true },
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
// starts on"): Opus 5 at xhigh effort.
export const DEFAULT_MODEL = (MODELS.find(m => m.default) || MODELS[0]).model;
export const DEFAULT_EFFORT = "xhigh";
