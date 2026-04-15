import { useState, useCallback, useId, useEffect } from "react";

// ============================================================================
// Interactive demo primitives for lesson visualizations.
//
// All components use CSS custom properties from _lesson-core/chat/chat.css.js
// (--accent, --bg-panel, --bg-card, --border, --text-primary, --text-dim).
// No hardcoded hex. Keyboard-accessible. Focus-visible gold outlines.
//
// Every component accepts a `className` prop and merges it with its own class,
// so lesson code can compose layout without wrapping each primitive in a div.
// ============================================================================

const cx = (...parts) => parts.filter(Boolean).join(" ");

// ----- shared inline styles ------------------------------------------------
// A single <style> tag is injected once per mount. Using `data-id` so React's
// StrictMode double-mount and hot-reload don't stack duplicates.
const STYLE_TAG_ID = "core-primitives-interactive-style";
const PRIMITIVE_CSS = `
.ip-root { font-family: inherit; color: var(--text-primary); }
.ip-label { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  color: var(--accent); font-weight: 500; letter-spacing: 0.04em;
  text-transform: uppercase; margin-bottom: 4px; }
.ip-row { display: flex; align-items: center; gap: 10px; }
.ip-readout { font-family: 'IBM Plex Mono', monospace; font-size: 12px;
  color: var(--text-primary); min-width: 48px; text-align: right; }

/* Slider */
.ip-slider-wrap { display: flex; flex-direction: column; gap: 4px; }
.ip-slider { flex: 1; height: 4px; accent-color: var(--accent); cursor: pointer;
  background: transparent; }
.ip-slider:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }

/* Range slider (dual-handle) */
.ip-range-wrap { display: flex; flex-direction: column; gap: 6px; }
.ip-range-track { position: relative; height: 20px; display: flex;
  flex-direction: column; justify-content: center; }
.ip-range-slider { position: absolute; left: 0; right: 0; top: 0; bottom: 0;
  width: 100%; pointer-events: none; -webkit-appearance: none; appearance: none;
  background: transparent; accent-color: var(--accent); }
.ip-range-slider::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none;
  width: 14px; height: 14px; border-radius: 50%; background: var(--accent);
  border: 1px solid var(--border); cursor: pointer; }
.ip-range-slider::-moz-range-thumb { pointer-events: auto; width: 14px; height: 14px;
  border-radius: 50%; background: var(--accent); border: 1px solid var(--border);
  cursor: pointer; }
.ip-range-slider:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.ip-range-rail { height: 3px; background: var(--border); border-radius: 2px;
  position: relative; }
.ip-range-fill { position: absolute; top: 0; bottom: 0; background: var(--accent);
  border-radius: 2px; opacity: 0.5; }

/* Number input */
.ip-number-input { background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text-primary); font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; padding: 4px 8px; width: 90px; }
.ip-number-input:focus { outline: none; border-color: var(--accent); }
.ip-number-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Toggle */
.ip-toggle-row { display: flex; align-items: center; gap: 10px; cursor: pointer;
  user-select: none; }
.ip-toggle-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  color: var(--accent); font-weight: 500; letter-spacing: 0.04em;
  text-transform: uppercase; }
.ip-toggle { position: relative; width: 34px; height: 18px; flex-shrink: 0;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
  transition: background 0.15s, border-color 0.15s; }
.ip-toggle::after { content: ""; position: absolute; top: 1px; left: 1px;
  width: 14px; height: 14px; border-radius: 50%; background: var(--text-dim);
  transition: transform 0.15s, background 0.15s; }
.ip-toggle[data-on="true"] { border-color: var(--accent); background: var(--bg-panel); }
.ip-toggle[data-on="true"]::after { transform: translateX(16px); background: var(--accent); }
.ip-toggle-input { position: absolute; opacity: 0; width: 100%; height: 100%;
  margin: 0; cursor: pointer; }
.ip-toggle-input:focus-visible + .ip-toggle { outline: 2px solid var(--accent);
  outline-offset: 2px; }

/* Button */
.ip-btn { padding: 6px 14px; border-radius: 4px; font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase;
  cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.ip-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ip-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ip-btn-primary { background: var(--accent); color: var(--bg-main);
  border: 1px solid var(--accent); }
.ip-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
.ip-btn-secondary { background: var(--bg-card); color: var(--text-primary);
  border: 1px solid var(--border); }
.ip-btn-secondary:hover:not(:disabled) { border-color: var(--accent);
  color: var(--accent); }
.ip-btn-ghost { background: transparent; color: var(--text-dim);
  border: 1px solid transparent; }
.ip-btn-ghost:hover:not(:disabled) { color: var(--accent); }

/* Dropdown */
.ip-dropdown-wrap { display: flex; flex-direction: column; gap: 4px; }
.ip-dropdown { background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text-primary); font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; padding: 5px 8px; cursor: pointer; }
.ip-dropdown:focus { outline: none; border-color: var(--accent); }
.ip-dropdown:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ip-dropdown option { background: var(--bg-panel); color: var(--text-primary); }

/* Stepper */
.ip-stepper-wrap { display: flex; flex-direction: column; gap: 4px; }
.ip-stepper-controls { display: flex; align-items: center; gap: 6px; }
.ip-stepper-btn { width: 24px; height: 24px; padding: 0;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px;
  color: var(--text-primary); font-family: 'IBM Plex Mono', monospace; font-size: 14px;
  font-weight: 700; line-height: 1; cursor: pointer;
  transition: color 0.15s, border-color 0.15s; }
.ip-stepper-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.ip-stepper-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ip-stepper-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ip-stepper-value { font-family: 'IBM Plex Mono', monospace; font-size: 12px;
  color: var(--text-primary); min-width: 42px; text-align: center;
  padding: 0 6px; }

/* ValueReadout */
.ip-value-readout { display: flex; flex-direction: column; gap: 2px;
  padding: 8px 12px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 4px; }
.ip-value-readout-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px;
  color: var(--text-dim); letter-spacing: 0.05em; text-transform: uppercase; }
.ip-value-readout-value { font-family: 'IBM Plex Mono', monospace; font-size: 14px;
  color: var(--accent); font-weight: 600; }

/* InteractiveDemo shell */
.ip-demo { background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 6px; padding: 16px; margin: 14px 0; }
.ip-demo-title { margin: 0 0 6px; font-size: 14px; font-weight: 700;
  color: var(--accent); font-family: 'IBM Plex Mono', monospace;
  text-transform: uppercase; letter-spacing: 0.05em; }
.ip-demo-desc { margin: 0 0 12px; font-size: 13px; color: var(--text-dim);
  line-height: 1.5; }
.ip-demo-body { display: flex; flex-direction: column; gap: 12px; }
.ip-demo-controls { display: flex; flex-wrap: wrap; gap: 14px; padding: 10px 12px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; }
.ip-demo-viz { background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 6px; padding: 10px; overflow: auto; }

/* PlayPauseControls */
.ip-playpause { display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; }
.ip-playpause-speed { display: flex; align-items: center; gap: 6px;
  margin-left: auto; }
.ip-playpause-speed-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px;
  color: var(--text-dim); letter-spacing: 0.05em; text-transform: uppercase; }
`;

function ensureStyleTag() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_TAG_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_TAG_ID;
  tag.textContent = PRIMITIVE_CSS;
  document.head.appendChild(tag);
}

function useStyleInjection() {
  // Called inside every primitive. Cheap idempotent check.
  if (typeof document !== "undefined" && !document.getElementById(STYLE_TAG_ID)) {
    ensureStyleTag();
  }
}

// ----- format helpers for ValueReadout -------------------------------------
function formatValue(v, format, unit) {
  let out;
  if (typeof format === "function") out = format(v);
  else if (format === "sci") out = Number(v).toExponential(3);
  else if (format === "fixed") out = Number(v).toFixed(3);
  else out = String(v);
  return unit ? `${out} ${unit}` : out;
}

// ============================================================================
// 1. Slider
// ============================================================================
export function Slider({ label, value, onChange, min, max, step, unit, id, className }) {
  useStyleInjection();
  const autoId = useId();
  const inputId = id || autoId;
  const handle = useCallback((e) => onChange(Number(e.target.value)), [onChange]);
  return (
    <div className={cx("ip-root", "ip-slider-wrap", className)}>
      {label && <label htmlFor={inputId} className="ip-label">{label}</label>}
      <div className="ip-row">
        <input
          id={inputId}
          type="range"
          className="ip-slider"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handle}
          aria-label={label}
        />
        <span className="ip-readout">{value}{unit ? ` ${unit}` : ""}</span>
      </div>
    </div>
  );
}

// ============================================================================
// 2. RangeSlider (dual-handle)
// ============================================================================
export function RangeSlider({ label, value, onChange, min, max, step, className }) {
  useStyleInjection();
  const [lo, hi] = value;
  const autoId = useId();
  const loId = `${autoId}-lo`;
  const hiId = `${autoId}-hi`;
  const handleLo = useCallback((e) => {
    const v = Number(e.target.value);
    onChange([Math.min(v, hi), hi]);
  }, [hi, onChange]);
  const handleHi = useCallback((e) => {
    const v = Number(e.target.value);
    onChange([lo, Math.max(v, lo)]);
  }, [lo, onChange]);
  const span = max - min;
  const loPct = span > 0 ? ((lo - min) / span) * 100 : 0;
  const hiPct = span > 0 ? ((hi - min) / span) * 100 : 100;
  return (
    <div className={cx("ip-root", "ip-range-wrap", className)}>
      {label && <div className="ip-label">{label}</div>}
      <div className="ip-range-track">
        <div className="ip-range-rail">
          <div
            className="ip-range-fill"
            style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
          />
        </div>
        <input
          id={loId}
          type="range"
          className="ip-range-slider"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={handleLo}
          aria-label={label ? `${label} minimum` : "minimum"}
        />
        <input
          id={hiId}
          type="range"
          className="ip-range-slider"
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={handleHi}
          aria-label={label ? `${label} maximum` : "maximum"}
        />
      </div>
      <div className="ip-row" style={{ justifyContent: "space-between" }}>
        <span className="ip-readout">{lo}</span>
        <span className="ip-readout">{hi}</span>
      </div>
    </div>
  );
}

// ============================================================================
// 3. NumberInput
// ============================================================================
export function NumberInput({ label, value, onChange, min, max, step, unit, className }) {
  useStyleInjection();
  const autoId = useId();
  const [draft, setDraft] = useState(String(value));
  // Keep local draft synced when the parent updates value externally, but
  // don't stomp on what the user is currently typing.
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement?.id === autoId) return;
    setDraft(String(value));
  }, [value, autoId]);
  const handleChange = useCallback((e) => setDraft(e.target.value), []);
  const handleBlur = useCallback(() => {
    const n = Number(draft);
    if (Number.isNaN(n)) { setDraft(String(value)); return; }
    let clamped = n;
    if (typeof min === "number") clamped = Math.max(min, clamped);
    if (typeof max === "number") clamped = Math.min(max, clamped);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  }, [draft, min, max, value, onChange]);
  return (
    <div className={cx("ip-root", "ip-slider-wrap", className)}>
      {label && <label htmlFor={autoId} className="ip-label">{label}</label>}
      <div className="ip-row">
        <input
          id={autoId}
          type="number"
          className="ip-number-input"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-label={label}
        />
        {unit && <span className="ip-readout" style={{ textAlign: "left" }}>{unit}</span>}
      </div>
    </div>
  );
}

// ============================================================================
// 4. Toggle
// ============================================================================
export function Toggle({ label, checked, onChange, className }) {
  useStyleInjection();
  const autoId = useId();
  const handle = useCallback((e) => onChange(e.target.checked), [onChange]);
  return (
    <label htmlFor={autoId} className={cx("ip-root", "ip-toggle-row", className)}>
      <span style={{ position: "relative", display: "inline-block", width: 34, height: 18 }}>
        <input
          id={autoId}
          type="checkbox"
          className="ip-toggle-input"
          checked={!!checked}
          onChange={handle}
          aria-label={label}
        />
        <span className="ip-toggle" data-on={String(!!checked)} />
      </span>
      {label && <span className="ip-toggle-label">{label}</span>}
    </label>
  );
}

// ============================================================================
// 5. Button
// ============================================================================
export function Button({ label, onClick, variant = "primary", disabled, className, children }) {
  useStyleInjection();
  const variantClass = `ip-btn-${variant}`;
  return (
    <button
      type="button"
      className={cx("ip-btn", variantClass, className)}
      onClick={onClick}
      disabled={disabled}
    >
      {label ?? children}
    </button>
  );
}

// ============================================================================
// 6. Dropdown
// ============================================================================
export function Dropdown({ label, value, onChange, options, className }) {
  useStyleInjection();
  const autoId = useId();
  const handle = useCallback((e) => onChange(e.target.value), [onChange]);
  return (
    <div className={cx("ip-root", "ip-dropdown-wrap", className)}>
      {label && <label htmlFor={autoId} className="ip-label">{label}</label>}
      <select
        id={autoId}
        className="ip-dropdown"
        value={value}
        onChange={handle}
        aria-label={label}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

// ============================================================================
// 7. Stepper
// ============================================================================
export function Stepper({ label, value, onChange, min, max, step, className }) {
  useStyleInjection();
  const stepSize = step ?? 1;
  const canDec = typeof min !== "number" || value - stepSize >= min;
  const canInc = typeof max !== "number" || value + stepSize <= max;
  const dec = useCallback(() => {
    if (canDec) onChange(Number((value - stepSize).toPrecision(12)));
  }, [value, stepSize, canDec, onChange]);
  const inc = useCallback(() => {
    if (canInc) onChange(Number((value + stepSize).toPrecision(12)));
  }, [value, stepSize, canInc, onChange]);
  return (
    <div className={cx("ip-root", "ip-stepper-wrap", className)}>
      {label && <div className="ip-label">{label}</div>}
      <div className="ip-stepper-controls">
        <button
          type="button"
          className="ip-stepper-btn"
          onClick={dec}
          disabled={!canDec}
          aria-label={label ? `decrease ${label}` : "decrease"}
        >-</button>
        <span className="ip-stepper-value" aria-live="polite">{value}</span>
        <button
          type="button"
          className="ip-stepper-btn"
          onClick={inc}
          disabled={!canInc}
          aria-label={label ? `increase ${label}` : "increase"}
        >+</button>
      </div>
    </div>
  );
}

// ============================================================================
// 8. ValueReadout
// ============================================================================
export function ValueReadout({ label, value, format, unit, className }) {
  useStyleInjection();
  return (
    <div className={cx("ip-root", "ip-value-readout", className)}>
      {label && <span className="ip-value-readout-label">{label}</span>}
      <span className="ip-value-readout-value">
        {formatValue(value, format, unit)}
      </span>
    </div>
  );
}

// ============================================================================
// 9. LiveGraph — wrapper that participates in the visual feedback loop
// ============================================================================
export function LiveGraph({ graphKey, renderId, children, className }) {
  useStyleInjection();
  return (
    <div
      className={cx("ip-root", "ip-live-graph", className)}
      data-graph-key={graphKey}
      data-graph-render-id={renderId}
    >
      {children}
    </div>
  );
}

// ============================================================================
// 10. InteractiveDemo — layout shell (title + description + controls + viz)
// ============================================================================
export function InteractiveDemo({ title, description, controls, visualization, className }) {
  useStyleInjection();
  return (
    <div className={cx("ip-root", "ip-demo", className)}>
      {title && <h4 className="ip-demo-title">{title}</h4>}
      {description && <p className="ip-demo-desc">{description}</p>}
      <div className="ip-demo-body">
        {controls && <div className="ip-demo-controls">{controls}</div>}
        {visualization && <div className="ip-demo-viz">{visualization}</div>}
      </div>
    </div>
  );
}

// ============================================================================
// 11. PlayPauseControls
// ============================================================================
export function PlayPauseControls({
  playing,
  onTogglePlay,
  onReset,
  speed,
  onSpeedChange,
  speedOptions,
  className,
}) {
  useStyleInjection();
  const handleSpeed = useCallback(
    (e) => onSpeedChange && onSpeedChange(Number(e.target.value)),
    [onSpeedChange]
  );
  const defaultSpeeds = [
    { value: "0.25", label: "0.25x" },
    { value: "0.5", label: "0.5x" },
    { value: "1", label: "1x" },
    { value: "2", label: "2x" },
    { value: "4", label: "4x" },
  ];
  const speedList = speedOptions
    ? speedOptions.map((s) =>
        typeof s === "object" ? s : { value: String(s), label: `${s}x` }
      )
    : defaultSpeeds;
  return (
    <div className={cx("ip-root", "ip-playpause", className)}>
      <Button
        label={playing ? "Pause" : "Play"}
        onClick={onTogglePlay}
        variant="primary"
      />
      {onReset && (
        <Button label="Reset" onClick={onReset} variant="secondary" />
      )}
      {onSpeedChange && (
        <div className="ip-playpause-speed">
          <span className="ip-playpause-speed-label">Speed</span>
          <select
            className="ip-dropdown"
            value={String(speed ?? 1)}
            onChange={handleSpeed}
            aria-label="playback speed"
          >
            {speedList.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
