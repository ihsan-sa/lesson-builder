// Graph color palettes. Each lesson keeps its own `let G = THEMES_G[theme]`
// module-level binding; graph components read G when they render.
//
// `light` is THE palette the Lumen shell renders against — its values are the
// Lumen tokens, so an SVG built from G sits on the same paper as the rest of
// the page. `gold` is the accent (kept under that key name because every
// existing graph component reads G.gold for its primary curve).
//
// `dark` is the palette a lesson binds when the shell's DARK button is on. It
// predates the shell -- it is what the 39 pre-shell lessons use -- and its
// values are frozen for them, so the shell's dark tokens in chat/shell.css.js
// were picked to sit with it: --surface there is THEMES_G.dark.bg, so a graph's
// own background disappears into the page it is drawn on. Its accent stays the
// gold those lessons draw their primary curve in, not the shell's terracotta.
export const THEMES_G = {
  dark:  { bg: "#13151c", ax: "#6b7084", gold: "#c8a45a", blue: "#4a90d9", red: "#e06c75", grn: "#69b578", txt: "#9498ac", ltxt: "#b0b4c4", purple: "#a077d4", orange: "#e0a060" },
  light: { bg: "#F4F1EB", ax: "#9C988F", gold: "#C96442", blue: "#3E6C8F", red: "#B14B3F", grn: "#4F7A52", txt: "#6B6862", ltxt: "#3A3833", purple: "#7A5B86", orange: "#C08A3E" },
};
