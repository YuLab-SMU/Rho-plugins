import { useSyncExternalStore } from 'react';

// What one view of the sessions asks another to show: a cell, for the Notebook that lists it to
// scroll to, and a plot, for the Plots view to bring forward. A view on the page takes it at once;
// one opened for it, or another page's Notebook, takes it once it has read the sessions. Each ask
// is taken once, by the first view shown that holds it.
let asked: { cellId: string; at: number } | null = null;
let plot: { cellId: string; plot: number; at: number } | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const askCell = (cellId: string) => { asked = { cellId, at: Date.now() }; changed(); };
export function takeCell(has: (cellId: string) => boolean) {
  if (!asked || !has(asked.cellId)) return null;
  const cellId = asked.cellId; asked = null;
  return cellId;
}
export const useAskedCell = () => useSyncExternalStore(subscribe, () => asked);

export const askPlot = (cellId: string, number: number) => { plot = { cellId, plot: number, at: Date.now() }; changed(); };
export function takePlot(has: (cellId: string, plot: number) => boolean) {
  if (!plot || !has(plot.cellId, plot.plot)) return null;
  const taken = plot; plot = null;
  return taken;
}
export const useAskedPlot = () => useSyncExternalStore(subscribe, () => plot);
