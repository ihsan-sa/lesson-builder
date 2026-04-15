// Graph color palettes. Each lesson keeps its own `let G = THEMES_G[theme]`
// module-level binding; graph components read G when they render.
export const THEMES_G = {
  dark:  { bg: "#13151c", ax: "#6b7084", gold: "#c8a45a", blue: "#4a90d9", red: "#e06c75", grn: "#69b578", txt: "#9498ac", ltxt: "#b0b4c4", purple: "#a077d4", orange: "#e0a060" },
  light: { bg: "#f0efe8", ax: "#888",    gold: "#9a7b2e", blue: "#2a6abf", red: "#c0392b", grn: "#2d8a4e", txt: "#555",    ltxt: "#333",    purple: "#7b5bb5", orange: "#c4822e" },
};
