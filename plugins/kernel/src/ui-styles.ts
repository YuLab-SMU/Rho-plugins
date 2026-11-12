// The Notebook's and its views' own styles, in the application's tokens (its colors, type and
// spacing variables). They are added to the page once, with the first view that needs them.
const styles = `/* The Notebook: cells in the order they ran beside the live sessions, their variables and plots. */
.nb-page { display: grid; grid-template-columns: minmax(0, 1fr) 17.5rem; gap: 28px; align-items: start; }
.nb-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.nb-cells { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }

/* One cell: its count in the gutter beside its code; above the code, who ran it and why where that
   is to be said; under it how it ended, then what it printed. Nothing is said twice: the language
   and the session are the notebook's, and a cell names its language only among cells of both. */
.nb-page { --nb-gutter: 3rem; --nb-gap: 8px; }
.nb-cell { padding: 8px 0 8px calc(var(--nb-gutter) + var(--nb-gap)); border-radius: 8px; scroll-margin-top: 16px; }
.nb-gutter { position: absolute; top: 0; right: calc(100% + var(--nb-gap)); width: var(--nb-gutter); padding-top: 8px; text-align: right; }
.nb-number { display: block; color: var(--color-meta); font: 12px/19px var(--font-mono); font-variant-numeric: tabular-nums; white-space: pre; }
.nb-number::before { content: "["; opacity: .55; }
.nb-number::after { content: "]"; opacity: .55; }
.nb-cell:is(.error, .interrupted, .unknown) .nb-number { color: var(--color-failed); }
.nb-cell.running .nb-number { color: var(--color-accent); font-weight: 600; }
.nb-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.nb-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding-left: 1px; }
.nb-who { flex: none; color: var(--color-meta); font-size: 12px; font-weight: 600; white-space: nowrap; }
.nb-who .text-button { min-height: 0; padding: 0; color: var(--color-accent-strong); font-size: 12px; font-weight: 600; }
.nb-who .text-button:hover { text-decoration: underline; background: none; }
.nb-cell.mine .nb-who { color: var(--color-ink); }
.nb-purpose { min-width: 0; color: var(--color-ink); font-size: 13px; font-weight: 600; line-height: 1.4; }
.nb-input { position: relative; min-width: 0; }
/* How the cell ended and when, under its code as a notebook's cell status is. */
.nb-status { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; margin: -2px 0 0; padding-left: 12px; color: var(--color-meta); font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.nb-cell-lang { margin-left: auto; padding-right: 2px; }
.nb-elsewhere { padding: 0 7px; border-radius: 999px; background: var(--color-well); }
.nb-ending { display: inline-flex; align-items: center; gap: 6px; }
.nb-ending.running { color: var(--color-accent); font-weight: 600; }
.nb-ending.waiting { color: var(--color-amber-text); font-weight: 600; }
.nb-ending.failed { color: var(--color-failed); font-weight: 600; }

.nb-code { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; align-self: stretch; }
.nb-code pre { width: 100%; margin: 0; padding: 9px 12px; overflow-x: auto; border-radius: 8px; background: var(--color-well); font: 12.5px/1.5 var(--font-mono); color: var(--color-ink); tab-size: 4; }
.nb-more { min-height: 0; padding: 2px 0; color: var(--color-accent-strong); font-size: 12px; font-weight: 600; }
.nb-out-more { align-self: flex-start; margin-left: 12px; }
/* What it printed reads as the session wrote it: fixed columns keep R's tables aligned. */
.nb-out { margin: 0; padding: 2px 12px; max-height: 26em; overflow: auto; font: 12.5px/1.45 var(--font-mono); color: var(--color-ink); white-space: pre; }
.nb-out.stderr { color: var(--color-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.nb-out.warning { padding: 6px 12px; border-left: 3px solid var(--color-amber-line); background: var(--color-amber-soft); color: var(--color-amber-text); white-space: pre-wrap; overflow-wrap: anywhere; }
.nb-out.error { padding: 7px 12px; border-left: 3px solid var(--color-failed); background: color-mix(in srgb, var(--color-failed) 7%, var(--color-surface)); color: var(--color-failed-strong); white-space: pre-wrap; overflow-wrap: anywhere; }
.nb-plot { margin: 4px 0 2px 12px; }
.nb-plot img { display: block; width: 100%; height: auto; border: 1px solid var(--color-hairline); border-radius: 6px; background: #fff; }
.nb-plot-wait { display: block; width: 100%; border-radius: 6px; background: var(--color-well); }
.nb-note { color: var(--color-meta); font-size: 12px; }
.nb-saved { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 6px 0; font-size: 12px; color: var(--color-meta); }
.nb-saved > span:first-child { font-weight: 600; color: var(--color-ink); }
.nb-saved .text-button { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; overflow-wrap: anywhere; }
.nb-saved-what { overflow-wrap: anywhere; }
.nb-body > .nb-note { padding-left: 12px; }
.nb-problem { padding-left: 12px; color: var(--color-amber-text); font-size: 12.5px; }
/* Running a cell again: a small bar over the corner of its code, shown with the pointer or the focus. */
.nb-actions { position: absolute; top: 5px; right: 6px; display: flex; gap: 1px; padding: 2px; border: 1px solid var(--color-hairline); border-radius: 7px; background: var(--color-surface); box-shadow: 0 1px 3px rgb(0 0 0 / 8%); opacity: 0; transition: opacity .12s; }
.nb-cell:hover .nb-actions, .nb-cell:focus-within .nb-actions { opacity: 1; }
@media (hover: none) { .nb-actions { opacity: 1; } }
.nb-actions button { display: grid; place-content: center; width: 24px; height: 22px; min-height: 0; padding: 0; border: 0; border-radius: 5px; background: none; box-shadow: none; color: var(--color-muted); }
.nb-actions button:hover { background: var(--color-hover); color: var(--color-accent-strong); }
.nb-cell.running .nb-code pre { box-shadow: inset 3px 0 0 var(--color-accent); }
.nb-cell.queued .nb-code pre { box-shadow: inset 3px 0 0 var(--color-amber-line); }

/* Where a session started or ended, among the cells. */
.nb-mark { display: flex; flex-direction: column; gap: 2px; padding: 6px 0 6px calc(var(--nb-gutter) + var(--nb-gap)); color: var(--color-meta); font-size: 11.5px; }
.nb-mark > span { display: flex; align-items: center; gap: 10px; padding-left: 1px; }
.nb-mark > span::after { content: ""; flex: 1; height: 1px; background: var(--color-divider); }
.nb-mark.problem > span { color: var(--color-amber-text); }
.nb-mark small { padding-left: 1px; color: var(--color-meta); font-size: 11.5px; }

.nb-empty { display: flex; flex-direction: column; gap: 8px; padding: 28px 0 20px; }
.nb-empty h2 { font-size: 18px; }
.nb-empty p { max-width: 62ch; color: var(--color-muted); font-size: 14px; line-height: 1.55; }
.nb-empty-line { color: var(--color-meta); font-size: 13px; }

/* The new cell stays at the foot of the page while the cells scroll, drawn as a cell: the
   gutter's empty count, the code, and under the code its language and Run. */
.nb-composer { position: sticky; bottom: 0; z-index: 2; display: flex; flex-direction: column; gap: 6px; margin-top: 2px; padding: 8px 0 12px calc(var(--nb-gutter) + var(--nb-gap)); }
.nb-view .nb-composer { background: var(--color-surface); }
.nb-view .nb-composer::before { content: ""; position: absolute; right: 0; bottom: 100%; left: 0; height: 12px; background: linear-gradient(to top, var(--color-surface), transparent); pointer-events: none; }
.nb-new { position: relative; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--color-hairline-strong); border-radius: 8px; background: var(--color-surface); }
.nb-new:focus-within { border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.nb-new { --nb-pad: 8px 11px 2px; }
.nb-editor { position: relative; display: flex; min-width: 0; }
.nb-new textarea, .nb-ink { margin: 0; padding: var(--nb-pad); border: 0; border-radius: 0; background: none; font: 12.5px/1.5 var(--font-mono); letter-spacing: 0; tab-size: 4; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; }
.nb-new textarea { display: block; width: 100%; min-height: 0; outline: 0; resize: none; box-shadow: none; color: var(--color-ink); }
.nb-ink { position: absolute; inset: 0; overflow: hidden; color: var(--color-ink); pointer-events: none; }
.nb-ink code { font: inherit; }
.nb-editor.inked textarea { color: transparent; caret-color: var(--color-ink); scrollbar-width: none; }
.nb-editor.inked textarea::placeholder { color: var(--color-meta); }
.nb-compose-foot { display: flex; align-items: center; gap: 2px; min-width: 0; padding: 2px 5px 5px 5px; }
.nb-compose-foot small { margin-left: auto; padding: 0 8px; overflow: hidden; color: var(--color-meta); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.nb-compose-foot > button { flex: none; min-height: 26px; padding: 2px 11px 2px 9px; gap: 5px; border-radius: 6px; font-size: 12.5px; font-weight: 600; }
.nb-tabs { display: inline-flex; flex: none; padding: 2px; border-radius: 8px; background: var(--color-well); }
.nb-tabs button { min-height: 0; padding: 3px 10px; border: 0; border-radius: 6px; background: none; color: var(--color-muted); font-size: 12px; font-weight: 600; box-shadow: none; }
.nb-tabs button[aria-pressed="true"] { background: var(--color-surface); color: var(--color-ink); box-shadow: 0 1px 2px rgb(0 0 0 / 10%); }

/* The sessions, the variables of one and the latest plots, beside the cells. */
.nb-rail { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 22px; max-height: calc(100vh - 32px); overflow-y: auto; padding-bottom: 8px; }
.nb-rail-section { display: flex; flex-direction: column; gap: 8px; }
.nb-rail-section > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nb-rail-section h2 { color: var(--color-meta); font-size: 12px; font-weight: 650; letter-spacing: .3px; text-transform: uppercase; }
.nb-session { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid var(--color-hairline); border-radius: 10px; background: var(--color-surface); }
.nb-session > div:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }
.nb-session strong { font-size: 13px; }
.nb-session small { color: var(--color-meta); font-size: 12px; }
.nb-session.off { background: none; border-style: dashed; }
.nb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-offline); }
.nb-session.idle .nb-dot { background: var(--color-verified); }
.nb-session.busy .nb-dot { background: var(--color-accent); animation: pulse 1.6s ease-out infinite; }
.nb-session.starting .nb-dot { background: var(--color-amber); }
.nb-session.off .nb-dot { background: none; border: 1.5px solid var(--color-control-border); }
.nb-session-actions { display: flex; align-items: center; gap: 8px; }
.nb-session-actions button { min-height: 28px; padding: 3px 10px; font-size: 12px; }
.nb-session-actions .text-button { padding: 3px 4px; color: var(--color-meta); }
.nb-session-actions .text-button:hover { color: var(--color-failed); background: none; }
.nb-vars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nb-vars li { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); column-gap: 8px; padding: 6px 2px; border-top: 1px solid var(--color-divider); }
.nb-vars li:first-child { border-top: 0; }
.nb-var-name { overflow: hidden; font: 600 12.5px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
button.nb-var-name { min-height: 0; padding: 0; border: 0; background: none; color: var(--color-accent-strong); text-align: left; }
button.nb-var-name:hover { text-decoration: underline; background: none; }
/* The values a cell made or changed, each opening as it is now. */
.nb-values { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding-left: 12px; color: var(--color-meta); font-size: 12px; }
.nb-values > span + .nb-value { margin-left: 2px; }
.nb-values > .nb-value + span { margin-left: 8px; }
.nb-value { min-height: 0; padding: 1px 7px; border: 1px solid var(--color-hairline-strong); border-radius: 999px; background: var(--color-surface); color: var(--color-accent-strong); font: 600 12px var(--font-mono); }
button.nb-value:hover { border-color: var(--color-accent); background: var(--color-hover); }
code.nb-value { border-color: transparent; background: var(--color-well); color: var(--color-ink); font-weight: 500; }
.nb-value.gone { color: var(--color-meta); text-decoration: line-through; }
/* What a cell read and from which cell, and which later cells read what it made. */
.nb-values > .nb-rel + span { margin-left: 8px; }
.nb-rel { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; }
.nb-rel + .nb-rel { margin-left: 4px; }
.nb-cell-link { min-height: 0; padding: 0 2px; border: 0; border-radius: 4px; background: none; box-shadow: none; color: var(--color-meta); font: 500 11.5px var(--font-mono); white-space: nowrap; }
button.nb-cell-link { color: var(--color-accent-strong); }
button.nb-cell-link:hover { background: var(--color-hover); text-decoration: underline; }
.nb-var-made { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 0 3px; color: var(--color-meta); font-size: 11.5px; }
.nb-var-made .nb-cell-link { font-size: 11px; }
.nb-cell-links { display: inline-flex; align-items: baseline; }
@keyframes nb-flash { from { background: var(--color-accent-soft); } to { background: transparent; } }
.nb-cell.flash { animation: nb-flash 1.6s ease-out; }
.nb-var-type { overflow: hidden; color: var(--color-meta); font-size: 12px; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.nb-var-summary { grid-column: 1 / -1; overflow: hidden; color: var(--color-muted); font: 11.5px/1.4 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.nb-thumbs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nb-thumb { display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-height: 0; padding: 4px; border: 1px solid var(--color-hairline); border-radius: 8px; background: var(--color-surface); font-weight: 400; text-align: left; }
.nb-thumb:hover { border-color: var(--color-hairline-strong); background: var(--color-surface); }
.nb-thumb img, .nb-thumb .nb-plot-wait { width: 100%; aspect-ratio: 7 / 5; object-fit: contain; border-radius: 4px; background: #fff; }
.nb-thumb > span:last-child { overflow: hidden; color: var(--color-muted); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }

/* As a view of a Studio page it measures itself: wide, the sessions sit beside the cells. */
.nb-view { flex: 1; min-height: 0; overflow-y: auto; container-type: inline-size; }
.nb-page.in-view { padding: 12px 18px 0; }
.nb-page.in-view .nb-rail { top: 12px; max-height: none; overflow: visible; }
.nb-compose-note { margin: 0; padding: 8px 12px 0; color: var(--color-meta); font-size: 12px; }
/* Narrow: the cells fill the view, the sessions fold into one line above them. */
.nb-page.compact { display: block; padding: 10px 14px 0; }
.nb-page.compact { --nb-gutter: 2.4rem; }
/* There the new cell is one line that grows as they write: the code, its language, Run. */
.nb-page.compact:not(.roomy) .nb-new { flex-direction: row; flex-wrap: wrap; align-items: flex-end; }
.nb-page.compact:not(.roomy) .nb-new { --nb-pad: 8px 11px; }
.nb-page.compact:not(.roomy) .nb-editor { flex: 1 1 8rem; }
.nb-page.compact:not(.roomy) .nb-compose-foot { flex: none; max-width: 100%; margin-left: auto; padding: 4px 5px; }
.nb-page.compact:not(.roomy) .nb-compose-foot small { display: none; }
.nb-page.compact:not(.roomy) .nb-compose-note { flex-basis: 100%; }
.nb-strip { margin-bottom: 6px; border-bottom: 1px solid var(--color-divider); }
.nb-strip > summary { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 4px 0 8px; color: var(--color-meta); font-size: 12px; cursor: pointer; }
.nb-strip-session { display: inline-flex; align-items: center; gap: 6px; }
.nb-strip-session.idle .nb-dot { background: var(--color-verified); }
.nb-strip-session.busy .nb-dot { background: var(--color-accent); animation: pulse 1.6s ease-out infinite; }
.nb-strip > .nb-rail-section { padding-bottom: 10px; }
/* A very narrow view puts the code on a line of its own, above its language and Run. */
@container (max-width: 420px) {
  .nb-page.compact:not(.roomy) .nb-new { --nb-pad: 8px 11px 2px; }
  .nb-page.compact:not(.roomy) .nb-editor { flex-basis: 100%; }
}
@container (max-width: 820px) {
  .nb-page { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .nb-rail { position: static; order: -1; max-height: none; overflow: visible; display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 16px; }
}
@container (max-width: 560px) {
  .nb-page, .nb-page.compact { --nb-gutter: 0rem; --nb-gap: 0px; }
  .nb-gutter { display: none; }
  .nb-plot { margin-left: 0; }
}

/* The sessions' variables and plots as views of their own, beside a script and the Notebook. */
.nb-pane { flex: 1; display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow-y: auto; padding: 12px 16px; }
.nb-pane-state { display: inline-flex; align-items: center; gap: 7px; color: var(--color-muted) !important; font-size: 12px !important; font-weight: 600 !important; letter-spacing: 0 !important; text-transform: none !important; }
.nb-pane-state .nb-dot.idle { background: var(--color-verified); }
.nb-pane-state .nb-dot.busy { background: var(--color-accent); animation: pulse 1.6s ease-out infinite; }
.nb-pane-state .nb-dot.starting { background: var(--color-amber); }
.nb-pane-section .nb-vars li { grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr); }
.nb-pane-section .nb-var-name { justify-self: start; }
.nb-plots { gap: 8px; padding-bottom: 10px; overflow: hidden; }
.nb-plots-head { display: flex; flex: none; align-items: center; gap: 10px; min-width: 0; }
.nb-plots-head .text-button { display: inline-flex; align-items: center; min-height: 0; padding: 3px 4px; color: var(--color-meta); font-size: 12px; font-weight: 600; }
.nb-plots-head .text-button:hover:not(:disabled) { color: var(--color-accent-strong); background: none; }
.nb-plots-head .text-button:disabled { opacity: .35; }
.nb-plots-nav { display: inline-flex; flex: none; align-items: center; gap: 2px; color: var(--color-meta); font-size: 12px; font-variant-numeric: tabular-nums; }
.nb-plots-nav .nb-next svg { transform: rotate(180deg); }
.nb-plots-from { flex: 1; min-width: 0; margin: 0; overflow: hidden; color: var(--color-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.nb-plots-fit { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; margin: 0; }
.nb-plots-fit img { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid var(--color-hairline); border-radius: 6px; background: #fff; }
.nb-plots-fit .nb-plot-wait { width: min(100%, 504px); aspect-ratio: 7 / 5; }
.nb-plots-figure { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.nb-plots-figure > .fig { flex: 1; min-height: 0; }
.nb-plots-strip { display: flex; flex: none; gap: 6px; overflow-x: auto; padding: 2px; }
.nb-plots-thumb { flex: none; width: 72px; min-height: 0; padding: 2px; border: 1px solid var(--color-hairline); border-radius: 6px; background: var(--color-surface); }
.nb-plots-thumb[aria-current="true"] { border-color: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent); }

/* On a page of views the Notebook is the cells and the line to run one: a wide view leaves room
   around them, a plot is a picture that opens in Plots, and the session's state opens Sessions. */
.nb-page.compact.roomy { padding: 14px 24px 0; }
.nb-page.compact.roomy .nb-main { max-width: 74rem; }
.nb-plot-link { display: inline-flex; flex-direction: column; align-items: stretch; gap: 4px; width: 15rem; max-width: 100%; min-height: 0; margin: 4px 8px 2px 12px; padding: 4px; border: 1px solid var(--color-hairline); border-radius: 8px; background: var(--color-surface); color: var(--color-muted); font: 500 12px var(--font-ui); text-align: left; }
.nb-plot-link + .nb-plot-link { margin-left: 0; }
.nb-plot-link:hover { border-color: var(--color-accent); background: var(--color-surface); color: var(--color-accent-strong); }
.nb-plot-link img, .nb-plot-link .nb-plot-wait { display: block; width: 100%; aspect-ratio: 7 / 5; object-fit: contain; border-radius: 5px; background: #fff; }
.nb-plot-link .nb-plot-wait.gone { display: grid; place-content: center; color: var(--color-meta); }
.nb-plot-link > span:last-child { display: inline-flex; align-items: center; gap: 5px; padding: 0 2px; }
.nb-session-chip { display: inline-flex; flex: none; align-items: center; gap: 6px; min-height: 24px; padding: 0 7px; border: 0; border-radius: 6px; background: none; box-shadow: none; color: var(--color-muted); font: 500 12px var(--font-ui); white-space: nowrap; }
.nb-session-chip:hover { background: var(--color-hover); color: var(--color-ink); }
/* In the bar of the page that shows the notebook, the session's controls come before its other controls. */
.nb-kernel { display: inline-flex; align-items: center; gap: 2px; order: -1; min-width: 0; }
.nb-kernel .sv-chip > summary, .nb-compose-foot .sv-chip > summary { min-height: 24px; padding: 0 7px; border: 0; border-radius: 6px; font-size: 12px; font-weight: 500; }
.nb-kernel .sv-chip > summary:hover, .nb-compose-foot .sv-chip > summary:hover { background: var(--color-hover); }
.nb-kernel .sv-chip-menu { top: calc(100% + 4px); right: 0; bottom: auto; left: auto; }
.nb-session-chip.idle .nb-dot, .nb-env-state.idle .nb-dot, .nb-proc.idle .nb-dot { background: var(--color-verified); }
.nb-session-chip.busy .nb-dot, .nb-env-state.busy .nb-dot, .nb-proc.busy .nb-proc-state .nb-dot { background: var(--color-accent); animation: pulse 1.6s ease-out infinite; }
.nb-session-chip.starting .nb-dot, .nb-env-state.starting .nb-dot, .nb-proc.starting .nb-dot { background: var(--color-amber); }
.nb-session-chip.off .nb-dot, .nb-proc.off .nb-dot { background: none; border: 1.5px solid var(--color-control-border); }
.nbc-bar-state { font-weight: 500 !important; }

/* The values of a session as an environment pane: a table of them by kind, each unfolding in place. */
.nb-env { gap: 8px; padding: 10px 12px; container-type: inline-size; }
.nb-env-head { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; }
.nb-env-state { display: inline-flex; align-items: center; gap: 7px; min-width: 0; min-height: 0; padding: 2px 4px; border: 0; border-radius: 6px; background: none; color: var(--color-muted); font: 600 12px var(--font-ui); text-align: left; }
button.nb-env-state:hover { background: var(--color-hover); color: var(--color-ink); }
.nb-env-find { display: flex; align-items: center; gap: 5px; flex: 0 1 11rem; min-width: 6rem; margin-left: auto; padding: 0 8px; border: 1px solid var(--color-hairline); border-radius: 7px; color: var(--color-meta); }
.nb-env-find:focus-within { border-color: var(--color-accent); }
.nb-env-find input { flex: 1; width: auto; min-width: 0; height: 26px; min-height: 26px; padding: 0; border: 0; outline: 0; background: none; box-shadow: none; font-size: 12.5px; }
.nb-env-total { margin: 0; color: var(--color-meta); font-size: 11.5px; }
.nb-env-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; }
.nb-env-name-head { width: 34%; } th.nb-env-type { width: 6.5rem; } th.nb-env-bytes { width: 4.8rem; }
.nb-env-table thead th { position: sticky; top: -10px; z-index: 1; padding: 0 6px 4px; border-bottom: 1px solid var(--color-hairline); background: var(--color-surface); text-align: left; }
.nb-env-sort { display: inline-flex; align-items: center; gap: 3px; min-height: 0; padding: 2px 0; border: 0; background: none; color: var(--color-meta); font: 600 11px var(--font-ui); letter-spacing: .3px; text-transform: uppercase; }
button.nb-env-sort:hover, .nb-env-sort.on { color: var(--color-ink); background: none; }
.nb-env-group th { padding: 10px 6px 3px; color: var(--color-ink); font-size: 12px; font-weight: 650; text-align: left; }
.nb-env-row td { padding: 3px 6px; border-top: 1px solid var(--color-divider); vertical-align: baseline; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-env-group + .nb-env-row td { border-top: 0; }
.nb-env-row:hover td { background: var(--color-hover); }
.nb-env-name { display: flex; align-items: baseline; gap: 2px; }
.nb-env-twisty { flex: none; display: inline-grid; place-content: center; width: 16px; height: 16px; min-height: 0; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--color-meta); }
.nb-env-twisty[aria-expanded="true"] svg { transform: rotate(90deg); }
.nb-env-twisty:hover { background: var(--color-well); color: var(--color-ink); }
.nb-env-open { min-width: 0; min-height: 0; padding: 0; overflow: hidden; border: 0; background: none; color: var(--color-ink); font: 600 12.5px var(--font-mono); text-align: left; text-overflow: ellipsis; white-space: nowrap; }
button.nb-env-open { color: var(--color-accent-strong); }
button.nb-env-open:hover { text-decoration: underline; background: none; }
.nb-env-value code { color: var(--color-ink); font: 12px var(--font-mono); }
.nb-env-value small, .nb-env-dims { color: var(--color-muted); font-size: 12px; }
.nb-env-type { color: var(--color-meta); font-size: 12px; }
.nb-env-bytes { color: var(--color-meta); font-size: 12px; font-variant-numeric: tabular-nums; text-align: right !important; }
th.nb-env-bytes .nb-env-sort { margin-left: auto; }
.nb-env-detail td { padding: 2px 6px 8px 26px; }
.nb-env-inside { display: flex; flex-direction: column; gap: 4px; }
.nb-env-parts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.nb-env-parts li { display: grid; grid-template-columns: minmax(5rem, max-content) minmax(3.5rem, max-content) minmax(0, 1fr); gap: 8px; align-items: baseline; font-size: 12px; }
.nb-env-part { overflow: hidden; color: var(--color-ink); font: 600 11.5px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.nb-env-part-type { color: var(--color-meta); font-size: 11.5px; white-space: nowrap; }
.nb-env-part-values, .nb-env-summary { overflow: hidden; color: var(--color-muted); font: 11.5px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.nb-env-summary { white-space: pre-wrap; overflow-wrap: anywhere; }
.nb-env-made { margin: 2px 0 0; color: var(--color-meta); font-size: 11.5px; }
.nb-env-table:not(:has(th.nb-env-type)) .nb-env-name-head { width: 42%; }

/* The sessions' processes: one card for each language, then those that ended. */
.nb-procs { gap: 12px; padding: 12px 14px; }
.nb-proc { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; background: var(--color-surface); }
.nb-proc.off { border-style: dashed; background: none; }
.nb-proc-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.nb-proc-head h3 { margin: 0; color: var(--color-ink); font-size: 13.5px; font-weight: 650; }
.nb-proc-book { display: flex; flex-direction: column; gap: 8px; }
.nb-proc-book + .nb-proc-book { margin-top: 6px; }
.nb-proc-book-name { margin: 0; color: var(--color-ink); font-size: 12.5px; font-weight: 650; }
.nb-proc-book-name small { color: var(--color-meta); font-weight: 400; }
.nb-proc-book.shown > .nb-proc-book-name::before { content: ''; display: inline-block; width: 6px; height: 6px; margin: 0 6px 1px 0; border-radius: 50%; background: var(--color-accent); }
.nb-proc-book.quiet .nb-proc-off { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nb-notebook-pick { flex: none; max-width: 14rem; height: 26px; padding: 0 6px; border: 1px solid var(--color-hairline); border-radius: 6px; background: var(--color-surface); color: var(--color-ink); font: inherit; font-size: 12px; }
.nb-proc-state { display: inline-flex; align-items: center; gap: 6px; color: var(--color-muted); font-size: 12px; }
.nb-proc-actions { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.nb-proc-actions button { min-height: 28px; padding: 3px 10px; font-size: 12px; }
.nb-proc-stop { color: var(--color-meta); }
.nb-proc-stop:hover:not(:disabled) { color: var(--color-failed); background: none; }
.nb-proc-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 14px; margin: 0; font-size: 12.5px; }
.nb-proc-facts > div { display: contents; }
.nb-proc-facts dt { color: var(--color-meta); }
.nb-proc-facts dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--color-ink); }
.nb-proc-facts dd small { color: var(--color-meta); font-size: 12px; }
.nb-proc-facts code { font: 12px var(--font-mono); }
.nb-proc-where { display: inline-flex; margin-left: 8px; vertical-align: middle; }
.nb-proc-running { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; padding: 6px 8px; border-radius: 8px; background: var(--color-accent-soft); font-size: 12.5px; }
.nb-proc-running .text-button { min-height: 0; padding: 0; color: var(--color-accent-strong); font: 600 12px var(--font-mono); }
.nb-proc-running > span:nth-of-type(2) { min-width: 0; color: var(--color-ink); font-weight: 600; }
.nb-proc-running small { color: var(--color-muted); font-size: 12px; }
.nb-proc-off { margin: 0; color: var(--color-muted); font-size: 12.5px; }
.nb-proc-ended summary { color: var(--color-meta); font-size: 12px; font-weight: 600; cursor: pointer; }
.nb-proc-ended ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.nb-proc-ended li { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; }
.nb-proc-ended-what { display: flex; flex-direction: column; min-width: 0; color: var(--color-ink); }
.nb-proc-ended-what small { color: var(--color-meta); font-size: 12px; }
.nb-plots-thumb img, .nb-plots-thumb .nb-plot-wait { display: block; width: 100%; aspect-ratio: 7 / 5; object-fit: contain; border-radius: 4px; background: #fff; }

/* The console form: one transcript of prompts and what they printed, the prompt under it. */
.nb-form button { padding: 2px 9px; }
.nb-console { display: flex; flex-direction: column; min-height: 100%; color: var(--color-ink); font: 12.5px/1.5 var(--font-mono); cursor: text; }
.nbc-bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 16px; padding: 5px 14px; border-bottom: 1px solid var(--color-divider); background: var(--color-surface); color: var(--color-muted); font: 12px/1.6 var(--font-ui); cursor: default; }
.nbc-bar-session { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.nbc-bar-session.idle .nb-dot { background: var(--color-verified); }
.nbc-bar-session.busy .nb-dot { background: var(--color-accent); animation: pulse 1.6s ease-out infinite; }
.nbc-bar-session.starting .nb-dot { background: var(--color-amber); }
.nbc-bar-session.off .nb-dot { background: none; border: 1.5px solid var(--color-control-border); }
.nbc-bar .text-button { min-height: 0; padding: 0 2px; color: var(--color-meta); font-size: 12px; font-weight: 600; }
.nbc-bar .text-button:hover:not(:disabled) { color: var(--color-accent-strong); background: none; }
.nbc-bar .nbc-stop:hover:not(:disabled) { color: var(--color-failed); }
.nbc-clear { margin-left: auto; }
.nbc-log { display: flex; flex-direction: column; padding: 8px 14px 0; }
.nbc-quiet { margin: 2px 0 6px; color: var(--color-meta); font: 12px/1.5 var(--font-ui); }
.nbc-quiet .text-button { min-height: 0; padding: 0; color: var(--color-accent-strong); font-size: 12px; font-weight: 600; }
.nbc-cell { display: flex; flex-direction: column; padding: 3px 0; scroll-margin-top: 36px; }
.nbc-who { margin: 6px 0 0; color: var(--color-meta); white-space: pre-wrap; }
.nbc-who .text-button { min-height: 0; padding: 0; color: var(--color-accent-strong); font: inherit; font-weight: 600; }
.nbc-code { display: flex; min-width: 0; }
.nbc-prompt { flex: none; margin: 0; padding-right: 1ch; color: var(--color-accent-strong); font: inherit; white-space: pre; user-select: none; }
.nbc-input { flex: 1; min-width: 0; margin: 0; overflow-x: auto; font: inherit; white-space: pre; }
.nbc-cell.python .nbc-prompt { color: var(--color-hue-clay-ink); }
.nbc-out { margin: 0; overflow-x: auto; font: inherit; white-space: pre; }
.nbc-out.stderr { color: var(--color-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.nbc-out.warning { color: var(--color-amber-text); white-space: pre-wrap; overflow-wrap: anywhere; }
.nbc-out.error { color: var(--color-failed-strong); white-space: pre-wrap; overflow-wrap: anywhere; }
.nbc-state { display: inline-flex; align-items: center; gap: 6px; margin: 0; color: var(--color-meta); font: 12px/1.6 var(--font-ui); }
.nbc-state.running { color: var(--color-accent); font-weight: 600; }
.nbc-cell.queued .nbc-input, .nbc-cell.not-run .nbc-input { color: var(--color-muted); }
.nbc-plot { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 2px 0; }
.nbc-plot-line { display: inline-flex; align-items: center; gap: 5px; min-height: 0; padding: 0; color: var(--color-meta); font: 12px var(--font-ui); font-weight: 600; }
.nbc-plot-line:hover { color: var(--color-accent-strong); background: none; }
.nbc-plot-img { display: block; width: min(100%, 420px); aspect-ratio: 7 / 5; object-fit: contain; border: 1px solid var(--color-hairline); border-radius: 6px; background: #fff; }
.nbc-mark { display: flex; align-items: center; gap: 10px; margin: 8px 0 4px; color: var(--color-meta); font: 12px/1.5 var(--font-ui); }
.nbc-mark::after { content: ""; flex: 1; height: 1px; background: var(--color-hairline); }
.nbc-mark.ended { color: var(--color-ink); font-weight: 600; }
.nbc-mark.problem { color: var(--color-amber-text); }
.nbc-prompt-row { display: flex; flex-direction: column; gap: 2px; padding: 4px 14px 14px; }
.nbc-prompt-line { display: flex; align-items: flex-start; gap: 0; min-width: 0; }
.nbc-prompt-line .nb-lang-switch { margin: 1px 8px 0 0; }
.nbc-prompt-row.python .nbc-prompt { color: var(--color-hue-clay-ink); }
.nbc-prompt-line textarea { flex: 1; min-width: 0; min-height: 0; margin: 0; padding: 0; border: 0; outline: 0; resize: none; overflow: hidden; background: none; box-shadow: none; color: var(--color-ink); font: inherit; white-space: pre; }
.nbc-busy { flex: none; margin-left: 10px; color: var(--color-accent); font: 600 12px/1.6 var(--font-ui); white-space: nowrap; }
/* The language chip a cell carries, at the line where code is written: small, in its language's colour. */
.nb-lang-switch { display: inline-flex; flex: none; align-items: center; gap: 3px; min-height: 0; padding: 0 5px 0 7px; border: 0; border-radius: 6px; background: none; box-shadow: none; color: var(--color-muted); font: 600 12px/24px var(--font-ui); }
.nb-lang-switch > svg { opacity: .6; }
.nb-lang-switch:hover { background: var(--color-hover); color: var(--color-ink); }
/* The Servers view: where the live sessions run, what a connection to each place last saw, and
   a place's files as its server lists them. */
.sv-pane { container-type: inline-size; }
.sv-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; }
.sv-head .secondary { display: inline-flex; align-items: center; gap: 5px; min-height: 0; padding: 4px 10px; font-size: 12px; white-space: nowrap; }
.sv-lede { margin: -4px 0 0; color: var(--color-meta); font-size: 12px; }
.sv-places { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.sv-place { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 9px 11px; border: 1px solid var(--color-hairline-strong); border-radius: 10px; background: var(--color-surface); }
.sv-place.open { border-color: var(--color-accent-strong); }
.sv-place-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 7px; min-width: 0; }
.sv-place-head > svg { flex: none; color: var(--color-meta); }
.sv-place-head > strong { flex: 1 0 6rem; min-width: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
/* Which languages' next sessions start here: one place per language, pressed where it is. */
.sv-runs { display: inline-flex; flex: none; align-items: center; gap: 3px; }
.sv-runs small { margin-right: 2px; color: var(--color-meta); font-size: 11px; }
.sv-runs button { min-height: 0; padding: 1px 8px; border: 1px solid var(--color-hairline); border-radius: 999px; background: none; box-shadow: none; color: var(--color-meta); font-size: 11px; font-weight: 600; }
.sv-runs button:hover { border-color: var(--color-accent); color: var(--color-ink); }
.sv-runs button[aria-pressed="true"] { border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent-strong); }
.sv-where { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 0; color: var(--color-muted); font-size: 12px; overflow-wrap: anywhere; }
.sv-where code { color: var(--color-ink); font-size: 11.5px; }
.sv-check { margin: 0; color: var(--color-muted); font-size: 12px; }
.sv-check p { margin: 0; color: var(--color-ink); overflow-wrap: anywhere; }
.sv-check small { color: var(--color-meta); font-size: 11px; }
.sv-check.problem p { color: var(--color-amber-text); }
.sv-check .sv-missing { color: var(--color-amber-text); }
.sv-host { color: var(--color-meta); }
.sv-setup summary { color: var(--color-meta); font-size: 11.5px; cursor: pointer; }
.sv-setup pre { margin: 4px 0 0; padding: 6px 9px; border-radius: 7px; background: var(--color-well); font: 11.5px/1.45 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.sv-sessions { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; color: var(--color-ink); font-size: 12px; }
.sv-sessions li { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; }
.sv-sessions small { color: var(--color-meta); font-size: 11px; overflow-wrap: anywhere; }
.sv-lost { display: flex; align-items: flex-start; gap: 6px; margin: 0; color: var(--color-amber-text); font-size: 12px; }
.sv-lost > svg { flex: none; margin-top: 2px; }
.sv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 2px; }
.sv-actions .secondary { display: inline-flex; align-items: center; gap: 5px; min-height: 0; padding: 3px 9px; font-size: 12px; }
.sv-actions .secondary[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-accent-soft); }
.sv-actions .text-button { min-height: 0; padding: 2px 4px; font-size: 12px; }
.sv-by { margin-left: auto; color: var(--color-meta); font-size: 11px; }

.sv-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 10px 11px; border: 1px solid var(--color-accent); border-radius: 10px; background: var(--color-surface); }
.sv-form h3 { margin: 0 0 4px; font-size: 13px; }
.sv-form label { display: flex; flex-direction: column; margin-top: 4px; color: var(--color-ink); font-size: 12px; font-weight: 600; }
.sv-form label small { color: var(--color-meta); font-size: 11px; font-weight: 400; }
.sv-form input, .sv-form textarea { min-width: 0; padding: 5px 8px; font: 12.5px var(--font-mono); }
.sv-form-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }

.sv-files { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-top: 6px; border-top: 1px solid var(--color-divider); }
.sv-files > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sv-files h3 { margin: 0; font-size: 13px; }
.sv-files header .text-button { display: inline-flex; align-items: center; gap: 4px; min-height: 0; padding: 2px 4px; font-size: 12px; }
.sv-crumbs { display: flex; flex-wrap: wrap; align-items: center; color: var(--color-meta); font: 11.5px var(--font-mono); }
.sv-crumbs button { min-height: 0; padding: 1px 3px; border: 0; border-radius: 4px; background: none; box-shadow: none; color: var(--color-accent-strong); font: inherit; overflow-wrap: anywhere; text-align: left; }
.sv-crumbs button:hover { background: var(--color-hover); }
.sv-entries { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.sv-entries li { display: grid; grid-template-columns: minmax(0, 1fr) 4.6rem 4.4rem auto; align-items: center; gap: 0 8px; min-height: 28px; padding: 0 4px; border-radius: 6px; font-size: 12px; }
.sv-entries li:hover, .sv-entries li.focus { background: var(--color-hover); }
.sv-entries li.focus { box-shadow: inset 2px 0 0 var(--color-accent); }
.sv-entries li > small { color: var(--color-meta); font-size: 11px; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.sv-entries li > .inline-error { grid-column: 1 / -1; margin: 0 0 4px; }
.sv-entry { display: flex; align-items: center; justify-content: flex-start; justify-self: start; gap: 6px; max-width: 100%; min-width: 0; min-height: 0; padding: 3px 0; border: 0; background: none; box-shadow: none; color: var(--color-ink); font-size: 12.5px; font-weight: 500; text-align: left; }
.sv-entry:not(:disabled):hover span { text-decoration: underline; text-underline-offset: 2px; }
.sv-entry > svg { flex: none; color: var(--color-meta); }
.sv-entry > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv-copy { min-width: 0; color: var(--color-meta); font-size: 11px; white-space: nowrap; }
.sv-copy .text-button { min-height: 0; padding: 0; color: var(--color-amber-text); font-size: 11px; font-weight: 600; }
@container (max-width: 360px) { .sv-entries li { grid-template-columns: minmax(0, 1fr) auto auto; } .sv-entries li > small:nth-of-type(2) { display: none; } }

/* Where a language's next cell runs, beside its chip in the Notebook. */
.sv-chip { position: relative; flex: none; }
.sv-chip > summary { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border: 1px solid var(--color-hairline); border-radius: 999px; color: var(--color-muted); font-size: 11px; font-weight: 600; list-style: none; cursor: pointer; white-space: nowrap; }
.sv-chip > summary::-webkit-details-marker { display: none; }
.sv-chip > summary:hover { border-color: var(--color-accent); color: var(--color-ink); }
.sv-chip-menu { position: absolute; z-index: 20; bottom: calc(100% + 4px); left: 0; display: flex; flex-direction: column; gap: 2px; width: max-content; min-width: 13rem; max-width: 20rem; padding: 5px; border: 1px solid var(--color-hairline-strong); border-radius: 9px; background: var(--color-surface); box-shadow: 0 6px 20px rgb(0 0 0 / 14%); }
.sv-chip-menu button { display: flex; align-items: center; gap: 7px; min-height: 0; padding: 5px 8px; border: 0; border-radius: 6px; background: none; box-shadow: none; color: var(--color-ink); font-size: 12.5px; font-weight: 500; text-align: left; }
.sv-chip-menu button:hover { background: var(--color-hover); }
.sv-chip-menu button > span { flex: 1; }
.sv-chip-menu button > svg { flex: none; color: var(--color-meta); }
.sv-chip-menu p { margin: 3px 6px; color: var(--color-meta); font-size: 11.5px; }
/* Above the console the menu opens downward. */
.nbc-bar .sv-chip-menu { top: calc(100% + 4px); bottom: auto; }

/* A server's skills in serverctl: how it is used, readable here as the Agent reads them. */
.sv-skills, .sv-managed { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.sv-skills small, .sv-managed small { margin-right: 2px; color: var(--color-meta); font-size: 11px; }
.sv-skills button { display: inline-flex; align-items: center; gap: 4px; min-height: 0; padding: 1px 8px; border: 1px solid var(--color-hairline); border-radius: 999px; background: none; box-shadow: none; color: var(--color-ink); font: 500 11.5px var(--font-mono); }
.sv-skills button > svg { flex: none; color: var(--color-meta); }
.sv-skills button:hover { border-color: var(--color-accent); }
.sv-skills button[aria-pressed="true"] { border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent-strong); }
.sv-skills button.problem { border-style: dashed; color: var(--color-amber-text); }
.sv-skills-none { margin: 0; color: var(--color-meta); font-size: 11.5px; }
.sv-where small { color: var(--color-meta); font-size: 11px; }
.sv-managed { margin-bottom: 2px; }
.sv-managed small { flex-basis: 100%; }
.sv-managed button { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0; min-height: 0; padding: 4px 9px; border: 1px solid var(--color-hairline); border-radius: 8px; background: none; box-shadow: none; text-align: left; }
.sv-managed button strong { color: var(--color-ink); font: 600 12px var(--font-mono); }
.sv-managed button span { color: var(--color-meta); font-size: 10.5px; font-weight: 400; }
.sv-managed button:hover { border-color: var(--color-accent); }
.sv-managed button[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-accent-soft); }
.sv-reader { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-top: 6px; border-top: 1px solid var(--color-divider); }
.sv-form .sv-reader { max-height: 22rem; overflow: auto; padding: 6px 9px; border: 1px solid var(--color-hairline); border-radius: 8px; }
.sv-reader > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sv-reader h3 { display: inline-flex; align-items: center; gap: 6px; margin: 0; font: 600 13px var(--font-mono); }
.sv-reader h3 > svg { color: var(--color-meta); }
.sv-reader > header .text-button { min-height: 0; padding: 2px 4px; font-size: 12px; }
.sv-reader-what { margin: 0; color: var(--color-muted); font-size: 12px; }
.sv-reader-body { min-width: 0; font-size: 12.5px; overflow-wrap: anywhere; }
.sv-reader-body pre { white-space: pre-wrap; }
.sv-reader .nb-note code { overflow-wrap: anywhere; }
/* Data flow: a graph of values from the data read at the top to the results at the bottom, with
   the results to trace above it and the value chosen beside it (below it when narrow). Its path
   shows in the colors a script's editor marks lines in: what it comes from, and what comes of it. */
.flow-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.flow-lede { margin: -4px 0 0; color: var(--color-meta); font-size: 12px; line-height: 1.45; }
.lin { display: flex; flex-direction: column; gap: 10px; min-width: 0; container-type: inline-size; }
.lin-results { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.lin-results > span { margin-right: 4px; color: var(--color-meta); font-size: 11.5px; font-weight: 650; }
.lin-results > button:not(.text-button) { display: inline-flex; align-items: center; justify-content: flex-start; gap: 4px; max-width: 16rem; min-height: 0; padding: 2px 8px; border: 1px solid var(--color-hairline); border-radius: 999px; background: var(--color-surface); box-shadow: none; color: var(--color-muted); font-size: 11.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lin-results > button:not(.text-button) > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.lin-results > button:not(.text-button):hover { border-color: var(--color-hairline-strong); color: var(--color-ink); }
.lin-results > button[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-accent-soft); color: var(--color-accent-strong); }
.lin-results > button > svg { flex: none; }
.lin-results > .text-button { min-height: 0; padding: 2px 4px; font-size: 11.5px; }
.lin-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
.lin-canvas { position: relative; display: flex; flex-direction: column; gap: 30px; min-width: 0; padding: 4px 0 10px; }
.lin-edges { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.lin-edges path { fill: none; stroke: var(--color-hairline-strong); stroke-width: 1.3; transition: stroke .12s, opacity .12s; }
.lin-edges path.from { stroke: var(--color-hue-sky-ink); stroke-width: 1.8; }
.lin-edges path.into { stroke: var(--color-hue-clay-ink); stroke-width: 1.8; }
.lin-edges path.off { opacity: .18; }
.lin-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 12px; }
.lin-node { position: relative; display: flex; align-items: flex-start; gap: 6px; max-width: min(100%, 14rem); min-width: 0; min-height: 0; padding: 6px 10px 7px; border: 1px solid var(--color-hairline-strong); border-radius: 8px; background: var(--color-surface); box-shadow: none; color: var(--color-ink); text-align: left; cursor: pointer; transition: opacity .12s, border-color .12s, background .12s; }
.lin-node:hover { border-color: var(--color-accent); }
.lin-node > svg { flex: none; margin-top: 2px; color: var(--color-meta); }
.lin-text { display: grid; gap: 2px; min-width: 0; }
.lin-title { display: -webkit-box; min-width: 0; overflow: hidden; overflow-wrap: anywhere; font-size: 12.5px; font-weight: 500; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.lin-name { min-width: 0; overflow: hidden; font: 600 12px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.lin-name.lin-sub { font: 500 10.5px/1.3 var(--font-mono); color: var(--color-meta); }
.lin-node.input { border-style: dashed; background: var(--color-canvas); }
.lin-node.output { border-color: transparent; background: var(--color-hue-moss); color: var(--color-hue-moss-ink); }
.lin-node.plot { border-color: transparent; background: var(--color-hue-iris); color: var(--color-hue-iris-ink); }
.lin-node.output > svg, .lin-node.plot > svg, .lin-node.output .lin-sub, .lin-node.plot .lin-sub { color: inherit; opacity: .8; }
.lin-node.from { border-color: var(--color-hue-sky-ink); }
.lin-node.into { border-color: var(--color-hue-clay-ink); }
.lin-node.value.from, .lin-node.input.from { background: var(--color-hue-sky); }
.lin-node.value.into { background: var(--color-hue-clay); }
.lin-node.here { border-color: var(--color-accent); box-shadow: 0 0 0 2px var(--color-accent-soft); }
.lin-node.chosen { border-color: var(--color-accent); border-style: solid; box-shadow: 0 0 0 3px var(--color-accent-soft); }
.lin-node.dim { border-color: var(--color-hairline); background: var(--color-canvas); color: var(--color-meta); }
.lin-node.dim > * { opacity: .55; }
.lin-detail { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px 12px 11px; border: 1px solid var(--color-hairline); border-radius: 10px; background: var(--color-surface); font-size: 12px; }
.lin-detail > * { flex: none; }
.lin-detail .flow-cell-plots img { max-height: 9rem; width: auto; }
.lin-detail.empty { color: var(--color-muted); }
.lin-detail p { margin: 0; }
.lin-sum { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; color: var(--color-muted); font-size: 12px; }
.lin-sum b { color: var(--color-ink); font-size: 15px; font-variant-numeric: tabular-nums; }
.lin-sum > span { color: var(--color-meta); }
.lin-detail > header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 7px; min-width: 0; }
.lin-detail > header > svg { flex: none; color: var(--color-meta); }
.lin-detail h3 { min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: 14px; font-weight: 650; line-height: 1.35; }
.lin-detail h3.lin-bare { font: 650 13px var(--font-mono); }
.lin-kind { color: var(--color-meta); font-size: 11.5px; }
.lin-detail > header > .text-button { min-height: 0; padding: 1px 4px; font-size: 12px; }
.lin-detail > header > .text-button:first-of-type { margin-left: auto; }
.lin-path { color: var(--color-meta); font: 11px var(--font-mono); overflow-wrap: anywhere; }
.lin-said { color: var(--color-meta); font-size: 11.5px; overflow-wrap: anywhere; }
.lin-ident { font: 11px var(--font-mono); color: var(--color-muted); }
.lin-made-line { display: flex; flex-wrap: wrap; gap: 2px 8px; color: var(--color-muted); }
.lin-made .text-button { min-height: 0; padding: 0 2px; font-size: 12px; font-weight: 650; }
.lin-made b { font-weight: 650; color: var(--color-ink); }
.lin-purpose { color: var(--color-ink); }
.lin-purpose > span { color: var(--color-meta); }
.lin-detail dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 10px; margin: 0; }
.lin-detail dt { padding-top: 2px; color: var(--color-meta); font-weight: 600; }
.lin-detail dd { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 4px; min-width: 0; margin: 0; color: var(--color-muted); }
.lin-detail dd.lin-uses { display: grid; gap: 4px; color: var(--color-ink); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.lin-use { display: block; }
.lin-use code { color: var(--color-muted); font: 11.5px var(--font-mono); }
.lin-use-means { color: var(--color-ink); }
.lin-chip { max-width: 100%; min-width: 0; min-height: 0; padding: 1px 7px; text-align: left; overflow: hidden; border: 1px solid var(--color-hairline); border-radius: 999px; background: var(--color-well); box-shadow: none; color: var(--color-ink); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.lin-chip:hover { border-color: var(--color-accent); }
.lin-chip > span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lin-chip.from { border-color: transparent; background: var(--color-hue-sky); color: var(--color-hue-sky-ink); }
.lin-chip.into { border-color: transparent; background: var(--color-hue-clay); color: var(--color-hue-clay-ink); }
.lin-chip.chosen { border-color: var(--color-accent); }
.lin-code > summary { width: fit-content; color: var(--color-accent-strong); font-weight: 600; cursor: pointer; }
.lin-code[open] > summary { margin-bottom: 6px; }
.lin-code > .nb-code-block, .lin-code > pre { margin-top: 4px; }
.lin-who { color: var(--color-meta); }
.lin-stale { color: var(--color-amber-text); }
.lin-others { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 4px; }
/* Narrow, the chosen value is above the graph, and stays in view in a view of its own; the graph
   names its values without how each is made. Wide, the chosen value sits beside the graph. */
@container (max-width: 639px) {
  .lin-main.pinned > .lin-detail { position: sticky; top: 0; z-index: 2; max-height: 12rem; overflow-y: auto; box-shadow: 0 6px 14px -10px rgb(0 0 0 / 30%); }
  .lin-detail { gap: 6px; padding: 8px 10px; }
  .lin-main.pinned > .lin-detail.empty, .lin-detail.empty { position: static; flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; padding: 0; border: 0; background: none; box-shadow: none; }
  .lin-detail.empty > * { flex: 0 1 auto; }
  .lin-detail.empty > p:last-child { font-size: 11.5px; }
  .lin-node { max-width: 100%; }
  .lin-title { -webkit-line-clamp: 3; }
}
@container (min-width: 640px) {
  .lin-main { grid-template-columns: minmax(0, 1fr) minmax(240px, 34%); }
  .lin-main > .lin-detail { grid-column: 2; grid-row: 1; }
  .lin-main > .lin-canvas { grid-column: 1; grid-row: 1; }
  .lin-main.pinned > .lin-detail { position: sticky; top: 8px; }
}
.flow-cell-plots { display: flex; flex-wrap: wrap; gap: 8px; }
.flow-cell-plots img { max-width: min(100%, 320px); height: auto; border: 1px solid var(--color-hairline); border-radius: 6px; background: #fff; }
.flow-inner { display: flex; flex-direction: column; gap: 8px; }
.flow-inner > summary { width: fit-content; color: var(--color-accent-strong); font-size: 12px; font-weight: 600; cursor: pointer; }
.flow-inner[open] > summary { margin-bottom: 6px; }
.nb-body > .flow-inner { padding-left: 12px; }
/* A value of a live session: where in it, what it is and when it was read, then its facts and a page of it. */
.ov { display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 16px; container-type: inline-size; }
.ov.stale .ov-section, .ov.stale .ov-facts, .ov.stale .ov-value { opacity: .62; }
.ov-head { display: flex; flex-direction: column; gap: 4px; }
.ov-trail { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px; min-width: 0; font-size: 16px; font-weight: 650; }
.ov-trail > span { display: inline-flex; align-items: baseline; gap: 2px; min-width: 0; }
.ov-crumb { min-height: 0; padding: 0 2px; border: 0; background: none; color: var(--color-accent-strong); font: inherit; overflow-wrap: anywhere; text-align: left; }
.ov-crumb:hover:not(:disabled) { text-decoration: underline; background: none; }
.ov-crumb:disabled { color: var(--color-ink); opacity: 1; cursor: default; }
.ov-sep { padding: 0 3px; color: var(--color-meta); font-weight: 400; }
.ov-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; color: var(--color-meta); font-size: 12px; }
.ov-meta > svg { margin-right: -6px; }
.ov-meta > span:first-of-type { color: var(--color-ink); font-weight: 600; }
.ov-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 2px; }
.ov-expression { max-width: 100%; overflow: hidden; padding: 2px 7px; border-radius: 6px; background: var(--color-well); color: var(--color-ink); font: 12px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.ov-actions button { min-height: 28px; padding: 3px 11px; font-size: 12.5px; }
.ov-note { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 0; padding: 7px 10px; border-radius: 8px; background: var(--color-amber-soft); color: var(--color-amber-text); font-size: 12.5px; }
.ov-note.problem { background: color-mix(in srgb, var(--color-failed) 8%, var(--color-surface)); color: var(--color-failed-strong); }
.ov-note .text-button { min-height: 0; padding: 0; color: inherit; font-weight: 600; text-decoration: underline; }
.ov-empty { color: var(--color-meta); font-size: 13px; }

/* Facts: short label over value, as many to a row as fit. */
.ov-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 8px 16px; margin: 0; }
.ov-facts > div { min-width: 0; }
.ov-facts dt { color: var(--color-meta); font-size: 11.5px; }
.ov-facts dd { margin: 0; overflow-wrap: anywhere; color: var(--color-ink); font-size: 13.5px; font-variant-numeric: tabular-nums; }
.ov-value { margin: 4px 0; font: 22px/1.3 var(--font-mono); overflow-wrap: anywhere; }

.ov-section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ov-section > h3 { color: var(--color-meta); font-size: 11.5px; font-weight: 650; letter-spacing: .3px; text-transform: uppercase; }
.ov-small { color: var(--color-meta); font-size: 12px; }

/* The table scrolls both ways inside its own box; its header and row labels stay in sight. */
.ov-table-scroll { width: fit-content; max-width: 100%; max-height: min(62vh, 640px); overflow: auto; border: 1px solid var(--color-hairline); border-radius: 8px; }
.ov-table { border-collapse: separate; border-spacing: 0; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.ov-table th, .ov-table td { padding: 5px 10px; border-bottom: 1px solid var(--color-divider); text-align: left; white-space: nowrap; vertical-align: top; }
.ov-table .num { text-align: right; }
.ov-table thead th { position: sticky; top: 0; z-index: 2; background: var(--color-surface); border-bottom-color: var(--color-hairline-strong); font-weight: 400; }
.ov-table thead th.num .ov-col { justify-content: flex-end; margin-left: auto; }
.ov-table td { color: var(--color-ink); font-family: var(--font-mono); }
.ov-rowlabel { position: sticky; left: 0; z-index: 1; background: var(--color-surface); color: var(--color-meta); font-weight: 400; font-size: 12px; }
.ov-table thead .ov-rowlabel { z-index: 3; }
.ov-col { display: flex; align-items: center; gap: 4px; min-height: 0; padding: 0; border: 0; background: none; color: var(--color-ink); font-family: inherit; font-size: 12.5px; font-weight: 600; }
.ov-col:hover { color: var(--color-accent-strong); background: none; }
.ov-col-name { font-weight: 600; }
.ov-col-meta { display: block; color: var(--color-meta); font-size: 11px; font-weight: 400; }
.ov-table tbody tr:hover td, .ov-table tbody tr:hover th { background: var(--color-hover); }

.ov-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; color: var(--color-meta); font-size: 12px; }
.ov-pager .text-button { min-height: 0; padding: 2px 0; color: var(--color-accent-strong); font-size: 12px; font-weight: 600; }
.ov-pager .text-button:disabled { color: var(--color-meta); opacity: .5; }

.ov-values { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: 4px; margin: 0; padding: 0; list-style: none; }
.ov-values.named { grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); }
.ov-values li { display: flex; flex-direction: column; min-width: 0; padding: 4px 8px; border-radius: 6px; background: var(--color-well); }
.ov-value-name { overflow: hidden; color: var(--color-meta); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ov-value-text { overflow-wrap: anywhere; font: 12.5px var(--font-mono); }

.ov-parts { display: flex; flex-direction: column; margin: 0; padding: 0; border: 1px solid var(--color-hairline); border-radius: 8px; list-style: none; }
.ov-parts li + li { border-top: 1px solid var(--color-divider); }
.ov-part { display: grid; grid-template-columns: minmax(6rem, auto) auto minmax(0, 1fr) auto; align-items: baseline; gap: 4px 12px; width: 100%; min-height: 0; padding: 7px 10px; border: 0; border-radius: 0; background: none; color: var(--color-ink); font-size: 13px; font-weight: 400; text-align: left; }
.ov-part:hover { background: var(--color-hover); }
.ov-part-name { font: 600 12.5px var(--font-mono); overflow-wrap: anywhere; }
.ov-part-type { color: var(--color-meta); font-size: 12px; white-space: nowrap; }
.ov-part-summary { overflow: hidden; color: var(--color-muted); font: 12px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.ov-part > svg { align-self: center; color: var(--color-meta); }

.ov-fold > summary { padding: 3px 0; color: var(--color-meta); font-size: 12px; font-weight: 650; letter-spacing: .3px; text-transform: uppercase; cursor: pointer; }
.ov-fold[open] > summary { margin-bottom: 6px; }
.ov-picture { display: block; max-width: min(100%, 760px); height: auto; margin: 2px 0 10px; border: 1px solid var(--color-hairline); border-radius: 8px; background: #fff; }
.ov-text { margin: 0; max-height: 26em; overflow: auto; padding: 9px 12px; border-radius: 8px; background: var(--color-well); font: 12.5px/1.45 var(--font-mono); white-space: pre; }

@container (max-width: 520px) {
  .ov-table th, .ov-table td { padding-inline: 6px; }
  .ov-part { grid-template-columns: minmax(0, 1fr) auto; }
  .ov-part-type { grid-column: 1; grid-row: 2; }
  .ov-part-summary { grid-column: 1 / -1; grid-row: 3; }
  .ov-part > svg { grid-column: 2; grid-row: 1; }
}
`;
export function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-owner="rho-plugins.kernel"]')) return;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.kernel'; style.textContent = styles; document.head.append(style);
}
