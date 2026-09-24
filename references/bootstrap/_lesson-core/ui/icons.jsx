// Icons (Lucide geometry, stroke 1.6) — the small SVGs the shell and the tutor
// panel share.
//
// They live here rather than in LessonShell.jsx because Chatbot needs six of
// them and every one of the 41 lessons imports Chatbot, so a lesson that wanted
// an icon had to import a component file to get one.
//
// Moving them did NOT take LessonShell.jsx out of the 41 import graphs: index.js
// re-exports it and every lesson imports index.js. What keeps the shell out of
// the 39 classic lessons' bundles, before this move and after it, is Rollup
// dropping an export nothing reaches — measured on built bundles by
// tests/shell-reach.
//
// Keep new shared icons here, not in a component file.
//
// Every export is a function; nothing here runs at import time.

const ico = (d, extra = {}) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...extra}>{d}</svg>
);
export const IconPanelLeft = () => ico(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>);
export const IconExternal = () => ico(<><path d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>);
export const IconDockSide = () => ico(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>, { width: 14, height: 14 });
export const IconDockBottom = () => ico(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 14h18" /></>, { width: 14, height: 14 });
export const IconSettings = () => ico(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
export const IconArrowRight = () => ico(<><path d="M5 12h14M13 6l6 6-6 6" /></>, { width: 16, height: 16, strokeWidth: 1.5 });
export const IconClose = () => ico(<><path d="M6 6l12 12M18 6L6 18" /></>);
// Phone layout (LessonShell below 720px, and the tutor's bottom sheet).
export const IconList = () => ico(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>, { width: 20, height: 20 });
export const IconChevronDown = () => ico(<><path d="M6 9l6 6 6-6" /></>, { width: 16, height: 16 });
export const IconChevronLeft = () => ico(<><path d="M15 18l-6-6 6-6" /></>, { width: 18, height: 18 });
export const IconChevronRight = () => ico(<><path d="M9 18l6-6-6-6" /></>, { width: 18, height: 18 });
export const IconMaximize = () => ico(<><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></>);
export const IconMinimize = () => ico(<><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></>);
