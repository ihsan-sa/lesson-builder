// Barrel export. Each lesson imports from "@core" (vite alias → this file).
// Internals (ChatBubble, ThreadPanel, processResponse, buildSystemPrompt,
// chatState) are implementation details of Chatbot and are NOT re-exported.

export { Chatbot } from "./chat/Chatbot.jsx";
export { STYLES } from "./chat/chat.css.js";
// Canonical tutoring policy (exported for tooling that needs the text, e.g.
// the Lumen packager appending it to a bridged lessonContext). Lessons do NOT
// paste it into LESSON_CONTEXT — buildSystemPrompt injects it automatically.
export { PEDAGOGY_POLICY } from "./chat/buildSystemPrompt.js";

export { Eq, M } from "./ui/Eq.jsx";
export { P, Section, KeyConcept, CollapsibleBlock, RefImg, PracticeProblem, FormulaSheetBox, SummaryBox } from "./ui/primitives.jsx";
export { DesmosGraph } from "./ui/DesmosGraph.jsx";

export {
  Slider, RangeSlider, NumberInput, Toggle, Button, Dropdown, Stepper,
  ValueReadout, LiveGraph, InteractiveDemo, PlayPauseControls,
} from "./ui/primitives-interactive.jsx";

export { THEMES_G } from "./constants/themes.js";
export { MODELS, EFFORT_LEVELS, DEFAULT_MODEL, DEFAULT_EFFORT } from "./constants/models.js";

export { useKatex } from "./hooks/useKatex.js";
export { useDesmos } from "./hooks/useDesmos.js";
