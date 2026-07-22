export const MODELS = [
  // `default: true` marks the model the chat opens with (Chatbot reads the
  // flag, not the array position). `key` = keyboard shortcut char; must be
  // unique and avoid j/g (shadowed by Ctrl+Shift+J/G handlers in Chatbot).
  { model: "claude-fable-5",             label: "Fable 5",    key: "f", default: true },
  { model: "claude-opus-4-8",            label: "Opus 4.8",   key: "p" },
  { model: "claude-sonnet-5",            label: "Sonnet 5",   key: "n" },
  { model: "claude-opus-4-7",            label: "Opus 4.7",   key: "o" },
  { model: "claude-sonnet-4-6",          label: "Sonnet 4.6", key: "s" },
  { model: "claude-opus-4-6",            label: "Opus 4.6",   key: "k" },
  { model: "claude-haiku-4-5-20251001",  label: "Haiku 4.5",  key: "h" },
];

export const EFFORT_LEVELS = ["low", "medium", "high", "max"];

// Defaults consumed by Chatbot.jsx (single source of truth for "what the
// chat starts on"): Fable 5 at max effort.
export const DEFAULT_MODEL = (MODELS.find(m => m.default) || MODELS[0]).model;
export const DEFAULT_EFFORT = "max";
