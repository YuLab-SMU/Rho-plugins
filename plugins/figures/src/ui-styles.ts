// The figure's own styles, in the application's tokens. Highlights override the inline styles the
// R device writes on each element, so they carry !important.
const styles = `/* A figure whose marks are bound to their rows. */
.fig { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.fig-canvas { position: relative; line-height: 0; user-select: none; -webkit-user-select: none; touch-action: none; cursor: crosshair; border-radius: 6px; }
.fig-canvas svg { display: block; width: 100%; height: auto; }
.fig.fit { height: 100%; }
.fig.fit .fig-canvas { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; }
.fig.fit .fig-canvas svg { width: 100%; height: 100%; }
/* Dimming changes paint, not opacity: an opacity on each of thousands of marks makes each its own layer. */
.fig-canvas [data-rho] { cursor: pointer; }
.fig-canvas.has-sel [data-rho]:not(.fig-on) { fill-opacity: .13 !important; stroke-opacity: .13 !important; }
.fig-canvas [data-rho].fig-on { stroke: var(--color-accent-strong) !important; stroke-width: 1.6px !important; stroke-opacity: 1 !important; }
.fig-canvas text[data-rho].fig-on { fill: var(--color-accent-strong) !important; stroke: none !important; font-weight: 700; }
.fig-canvas [data-rho].fig-hover { stroke: var(--color-ink) !important; stroke-width: 1.4px !important; fill-opacity: 1 !important; stroke-opacity: 1 !important; }
.fig-canvas.agent [data-rho].fig-on { stroke: var(--color-amber-text) !important; }
.fig-canvas.agent text[data-rho].fig-on { fill: var(--color-amber-text) !important; }
.fig-canvas.arrived [data-rho].fig-on { animation: fig-arrive .9s ease-out 1; }
@keyframes fig-arrive { 0% { stroke-width: 6px; } 100% { stroke-width: 1.6px; } }
@media (prefers-reduced-motion: reduce) { .fig-canvas.arrived [data-rho].fig-on { animation: none; } }
.fig-brush { position: absolute; border: 1px solid var(--color-accent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); pointer-events: none; border-radius: 2px; }
.fig-tip { position: absolute; z-index: 6; max-width: 280px; padding: 8px 10px; border-radius: 8px; background: var(--color-surface); color: var(--color-ink);
  border: 1px solid var(--color-hairline-strong); box-shadow: 0 6px 22px rgba(15, 23, 42, .14); pointer-events: none; line-height: 1.35; font-size: 12px; }
.fig-tip b { display: block; font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.fig-tip small { display: block; color: var(--color-meta); margin-bottom: 4px; }
.fig-tip dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1px 10px; margin: 4px 0 0; }
.fig-tip dt { color: var(--color-meta); white-space: nowrap; }
.fig-tip dd { margin: 0; font-family: var(--font-mono); font-size: 11.5px; overflow-wrap: anywhere; }
.fig-hint { margin: 0; color: var(--color-meta); font-size: 12px; line-height: 1.4; }
.fig-hint b { color: var(--color-ink); font-weight: 600; }

/* Marks an Agent pointed to, with its note. */
.fig-marks { display: flex; flex-wrap: wrap; gap: 6px; }
.fig-mark-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 26px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--color-amber-line);
  background: var(--color-amber-soft); color: var(--color-ink); font: 12px var(--font-ui); text-align: left; cursor: pointer; }
.fig-mark-chip[aria-pressed="true"] { border-color: var(--color-amber-text); box-shadow: inset 0 0 0 1px var(--color-amber-text); }
.fig-mark-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fig-mark-chip strong { font-weight: 650; white-space: nowrap; }

/* What is selected: the rows behind it, and asking about it. */
.fig-sel { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--color-hairline); background: var(--color-well); line-height: 1.4; }
.fig-sel.agent { border-color: var(--color-amber-line); background: var(--color-amber-soft); }
.fig-sel-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.fig-sel-head h4 { margin: 0; font-size: 13px; font-weight: 650; color: var(--color-ink); }
.fig-sel-head p { margin: 0; flex: 1 1 12rem; min-width: 0; color: var(--color-meta); font-size: 12px; }
.fig-sel-actions { display: flex; gap: 6px; margin-left: auto; }
.fig-sel-note { margin: 0; font-size: 13px; color: var(--color-ink); }
.fig-table-wrap { overflow: auto; max-height: 240px; border-radius: 6px; border: 1px solid var(--color-hairline); background: var(--color-surface); }
.fig-table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
.fig-table th, .fig-table td { padding: 4px 10px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--color-hairline); }
.fig-table th { position: sticky; top: 0; background: var(--color-surface); color: var(--color-meta); font-weight: 600; }
.fig-table td { font-family: var(--font-mono); font-size: 11.5px; color: var(--color-ink); max-width: 18rem; overflow: hidden; text-overflow: ellipsis; }
.fig-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.fig-table tr:last-child td { border-bottom: 0; }
.fig-more { margin: 0; color: var(--color-meta); font-size: 12px; }
.fig-note { margin: 0; color: var(--color-meta); font-size: 12px; }
`;
let added = false;
export function ensureFigureStyles() {
  if (added || typeof document === 'undefined') return;
  added = true;
  const style = document.createElement('style');
  style.dataset.owner = 'rho-plugins.figures';
  style.textContent = styles;
  document.head.appendChild(style);
}
