// Barrel export. Each lesson imports from "@core" (vite alias → this file).
// Internals (ChatBubble, ThreadPanel, processResponse, buildSystemPrompt,
// chatState) are implementation details of Chatbot and are NOT re-exported.

export { Chatbot } from "./chat/Chatbot.jsx";
export { STYLES } from "./chat/chat.css.js";

export { Eq, M } from "./ui/Eq.jsx";
export { P, Section, KeyConcept, CollapsibleBlock, RefImg } from "./ui/primitives.jsx";

export {
  Slider, RangeSlider, NumberInput, Toggle, Button, Dropdown, Stepper,
  ValueReadout, LiveGraph, InteractiveDemo, PlayPauseControls,
} from "./ui/primitives-interactive.jsx";

export { THEMES_G } from "./constants/themes.js";
export { MODELS, EFFORT_LEVELS } from "./constants/models.js";

export { useKatex } from "./hooks/useKatex.js";
