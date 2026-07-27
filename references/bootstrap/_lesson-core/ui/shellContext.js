import { createContext, useContext } from "react";

// Seam between LessonShell (owns placement) and Chatbot (owns the tutor UI).
// LessonShell decides where the panel lives — side dock, bottom dock, in-app
// window, or a real browser popup — and hands the controls to Chatbot so the
// dock switcher can render inside the panel header where the design puts it.
//
// Chatbot works with no provider at all (context is null): it falls back to a
// floating panel plus the round toggle button, which is what the Lumen
// packager's embed shape and any standalone mount need.
export const ShellContext = createContext(null);

export function useShell() {
  return useContext(ShellContext);
}
