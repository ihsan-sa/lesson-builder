import { useState } from "react";

export function Section({ title, children }) {
  return <div className="section"><h3 className="section-title">{title}</h3>{children}</div>;
}

export function P({ children }) { return <p className="para">{children}</p>; }

export function KeyConcept({ label, children, tested }) {
  return (
    <div className={`key-concept${tested ? " hw-tested" : ""}`}>
      <span className="kc-label">{label}</span>
      <div className="kc-body">{children}</div>
    </div>
  );
}

// FormulaSheetBox: highlights a formula that appears on the official exam
// formula sheet, with a "how to use it on the exam" note. Green accent.
export function FormulaSheetBox({ label = "ON FORMULA SHEET", children }) {
  return (
    <div className="formula-sheet-box">
      <span className="fsb-label">{label}</span>
      <div className="fsb-body">{children}</div>
    </div>
  );
}

// SummaryBox: distills a relevant passage from an official course summary
// or instructor-provided reference. Pink accent.
export function SummaryBox({ label = "COURSE SUMMARY", children }) {
  return (
    <div className="summary-box">
      <span className="sb-label">{label}</span>
      <div className="sb-body">{children}</div>
    </div>
  );
}

export function RefImg({ data, alt, caption }) {
  return (
    <div style={{ margin: "14px 0", background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: 6, padding: 12, textAlign: "center" }}>
      <img src={`data:image/png;base64,${data}`} alt={alt}
           style={{ maxWidth: "100%", borderRadius: 4 }} />
      {caption && <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-dim)",
        fontFamily: "'IBM Plex Mono', monospace", fontStyle: "italic" }}>{caption}</p>}
    </div>
  );
}

export function CollapsibleBlock({ title, label, children, defaultOpen = false }) {
  // Accept `label` as an alias for `title` \u2014 generated lessons pass label=, and
  // the caption silently vanished when only title was destructured.
  const caption = title ?? label;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-block">
      <button className="collapsible-toggle" onClick={() => setOpen(o => !o)}>
        {open ? "\u25BC" : "\u25BA"} {caption}
      </button>
      {open && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

// PracticeProblem: attributed practice problem with collapsible solution.
// provenance="official"  -> gold badge, no sources list.
// provenance="ai-worked" -> muted badge, aiSources list required (>=2 entries).
export function PracticeProblem({
  source,
  difficulty,
  provenance = "official",
  aiSources,
  statement,
  solution,
  solutionTitle = "Show solution",
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOfficial = provenance === "official";
  const badgeLabel = isOfficial ? "OFFICIAL SOLUTION" : "AI-WORKED SOLUTION";
  const badgeClass = `pp-badge ${isOfficial ? "pp-badge-official" : "pp-badge-ai"}`;
  return (
    <div className="practice-problem">
      <div className="pp-header">
        <span className={badgeClass}>{badgeLabel}</span>
        {source && <span className="pp-source">{source}</span>}
        {difficulty && (
          <span className={`pp-difficulty pp-diff-${difficulty}`}>{difficulty}</span>
        )}
      </div>
      <div className="pp-statement">{statement}</div>
      <div className="pp-solution-wrap">
        <button className="pp-solution-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "\u25BC" : "\u25BA"} {solutionTitle}
        </button>
        {open && (
          <div className="pp-solution-body">
            {solution}
            {!isOfficial && Array.isArray(aiSources) && aiSources.length > 0 && (
              <div className="pp-ai-sources">
                <div className="pp-ai-sources-label">Verified against:</div>
                <ul className="pp-ai-sources-list">
                  {aiSources.map((src, i) => (
                    <li key={i}>
                      {typeof src === "string" ? (
                        src.startsWith("http") ? (
                          <a href={src} target="_blank" rel="noreferrer">{src}</a>
                        ) : (
                          <span>{src}</span>
                        )
                      ) : (
                        src
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
