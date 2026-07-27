// Graph color palettes. Each lesson keeps its own `let G = THEMES_G[theme]`
// module-level binding; graph components read G when they render.
//
// `light` is THE palette the Lumen shell renders against — its values are the
// Lumen tokens, so an SVG built from G sits on the same paper as the rest of
// the page. `gold` is the accent (kept under that key name because every
// existing graph component reads G.gold for its primary curve).
//
// `dark` is retained only so older lessons that still bind THEMES_G.dark keep
// rendering. The shell itself is light-only; do not build new lessons against it.
export const THEMES_G = {
  dark:  { bg: "#13151c", ax: "#6b7084", gold: "#c8a45a", blue: "#4a90d9", red: "#e06c75", grn: "#69b578", txt: "#9498ac", ltxt: "#b0b4c4", purple: "#a077d4", orange: "#e0a060" },
  light: { bg: "#F4F1EB", ax: "#9C988F", gold: "#C96442", blue: "#3E6C8F", red: "#B14B3F", grn: "#4F7A52", txt: "#6B6862", ltxt: "#3A3833", purple: "#7A5B86", orange: "#C08A3E" },
};
