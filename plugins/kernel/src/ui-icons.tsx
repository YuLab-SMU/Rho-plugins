// The icons these views draw, in the same 24-pixel stroke style as the application's.
export type IconName = 'back' | 'book' | 'braces' | 'chart' | 'check' | 'chevron' | 'code' | 'file' | 'folder' | 'grid' | 'link' | 'list' | 'monitor' | 'offline' | 'pencil' | 'plus' | 'refresh' | 'run' | 'search' | 'server' | 'signal' | 'table' | 'updown';
export function Icon({ name, size = 20, stroke = 1.6 }: { name: IconName; size?: number; stroke?: number }) {
  const paths: Record<IconName, string> = {
    back: 'M15 5.25 8.25 12 15 18.75',
    book: 'M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2zM5 19.5v-14M19 17.5v3H7M9 7.5h6',
    braces: 'M8.5 4.5c-2 0-2.5 1-2.5 2.75v2C6 10.5 5.25 11.5 3.5 12c1.75.5 2.5 1.5 2.5 2.75v2c0 1.75.5 2.75 2.5 2.75M15.5 4.5c2 0 2.5 1 2.5 2.75v2c0 1.25.75 2.25 2.5 2.75-1.75.5-2.5 1.5-2.5 2.75v2c0 1.75-.5 2.75-2.5 2.75',
    chart: 'M4 4v16h16M8 16v-5M12 16V8M16 16v-3',
    check: 'M5.1 12.3 9.9 17.1 18.9 7.5',
    chevron: 'M9 5.25 15.75 12 9 18.75',
    code: 'M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5',
    file: 'M6 3h8l4 4v14H6z',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
    list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
    monitor: 'M4.5 4.5h15A1.5 1.5 0 0 1 21 6v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15V6a1.5 1.5 0 0 1 1.5-1.5zM8.5 20h7M12 16.5V20',
    offline: 'M3 9.3a12.75 12.75 0 0 1 18 0M6.3 12.9a7.95 7.95 0 0 1 11.4 0M9.6 16.5a3.3 3.3 0 0 1 4.8 0M3.75 3.75l16.5 16.5',
    pencil: 'M4.5 19.5h4l10-10a2.83 2.83 0 0 0-4-4l-10 10zM13 7l4 4',
    plus: 'M12 4.5v15M4.5 12h15',
    refresh: 'M19.5 12a7.5 7.5 0 1 1-2.25-5.4M19.5 4.2v3.9h-3.9',
    run: 'M7 4.5v15l12-7.5z',
    search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.25 15.25 20 20',
    server: 'M5 4h14a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 19 10H5a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 5 4zM5 14h14a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 5 14zM7.5 7h.01M7.5 17h.01',
    signal: 'M3 9.3a12.75 12.75 0 0 1 18 0M6.3 12.9a7.95 7.95 0 0 1 11.4 0M9.6 16.5a3.3 3.3 0 0 1 4.8 0M12 19.75h.01',
    table: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 10v10',
    updown: 'm8 9.5 4-4 4 4M8 14.5l4 4 4-4',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round"><path d={paths[name]} /></svg>;
}
