// Icônes SVG des outils et actions (24×24, trait = currentColor).
import type { ReactNode } from 'react';

const dot = (x: number, y: number, filled = true) => <circle cx={x} cy={y} r={2.4} fill={filled ? 'currentColor' : 'var(--panel)'} stroke="currentColor" strokeWidth={1.5} />;

const P: Record<string, ReactNode> = {
  move: <path d="M5 3l13 6.5-5.5 1.5L10 17z" fill="currentColor" fillOpacity={0.15} />,
  freehand: <><path d="M3 18c3-6 5 2 8-3s3-8 6-6" strokeDasharray="0" /><path d="M15 21l6-6-2-2-6 6-1 3z" fill="currentColor" fillOpacity={0.2} /></>,
  mic: <><rect x={9} y={3} width={6} height={11} rx={3} /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  ruler: <><path d="M3 15L15 3l6 6L9 21z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2M5 13l1 1" /></>,
  speakerOff: <><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9l5 6M22 9l-5 6" /></>,
  speaker: <><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  camera: <><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx={12} cy={13} r={3.5} /></>,
  point: <>{dot(12, 12)}<path d="M12 4v3M12 17v3M4 12h3M17 12h3" /></>,
  midpoint: <><path d="M4 18L20 6" />{dot(4, 18)}{dot(20, 6)}{dot(12, 12, false)}</>,
  intersect: <><path d="M3 19L21 5" /><circle cx={13} cy={14} r={6} />{dot(9.3, 12.2, false)}</>,
  segment: <><path d="M5 18L19 6" />{dot(5, 18)}{dot(19, 6)}</>,
  line: <><path d="M2 21L22 3" />{dot(7, 16.5)}{dot(16, 8.4)}</>,
  ray: <><path d="M5 18L22 3" />{dot(5, 18)}{dot(14, 10)}</>,
  perp: <><path d="M3 18h18M12 3v15" /><path d="M12 14h4v4" strokeWidth={1.2} /></>,
  parallel: <><path d="M3 17L17 5M7 21L21 9" /></>,
  bisector: <><path d="M4 16h16" />{dot(4, 16)}{dot(20, 16)}<path d="M12 3v19" strokeDasharray="2.5 2" /></>,
  angleBisector: <><path d="M3 20L21 20M3 20L15 4" /><path d="M3 20L21 11" strokeDasharray="2.5 2" /></>,
  circle2: <><circle cx={11} cy={12} r={7.5} />{dot(11, 12)}{dot(18.5, 12)}</>,
  circleR: <><circle cx={12} cy={12} r={8} />{dot(12, 12)}<path d="M12 12h8" strokeDasharray="2 1.8" /></>,
  polygon: <><path d="M4 18L7 6l11 2 2 9z" fill="currentColor" fillOpacity={0.15} />{dot(4, 18)}{dot(7, 6)}{dot(18, 8)}{dot(20, 17)}</>,
  regular: <><path d="M12 3l8 5.8-3 9.2H7L4 8.8z" fill="currentColor" fillOpacity={0.15} /></>,
  reflectLine: <><path d="M12 2v20" strokeDasharray="2.5 2" /><path d="M3 17l6-9v9z" fill="currentColor" fillOpacity={0.25} /><path d="M21 17l-6-9v9z" /></>,
  reflectPoint: <><path d="M3 20l5-7h3z" fill="currentColor" fillOpacity={0.25} /><path d="M21 4l-5 7h-3z" />{dot(12, 12)}</>,
  translate: <><path d="M3 19l4-7 3 7z" fill="currentColor" fillOpacity={0.25} /><path d="M14 13l4-7 3 7z" /><path d="M7 21l9-0" /><path d="M14 19l2 2-2 2" /></>,
  rotate: <><path d="M5 19l3-6 4 6z" fill="currentColor" fillOpacity={0.25} /><path d="M18 5a8 8 0 0 0-11 4" /><path d="M6 5v4h4" />{dot(17, 15)}</>,
  distance: <><path d="M3 15h18M3 11v8M21 11v8" /><path d="M7 7h10" strokeWidth={1.2} /><text x={12} y={8} fontSize={6} textAnchor="middle" stroke="none" fill="currentColor">cm</text></>,
  angle: <><path d="M4 20h17M4 20L16 5" /><path d="M11 20a7 7 0 0 0-2.6-5.4" /></>,
  delete: <><path d="M15 4l5 5-9 9H6l-3-3z" /><path d="M9 10l5 5M3 21h18" /></>,
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
  grid: <path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" strokeWidth={1.3} />,
  axes: <><path d="M4 20V3M4 20h17" /><path d="M2 5l2-2 2 2M19 18l2 2-2 2" /></>,
  magnet: <path d="M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4zM6 8h4M14 8h4" />,
  sun: <><circle cx={12} cy={12} r={4} /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  file: <path d="M14 3H6v18h12V7zM14 3v4h4" />,
  open: <path d="M3 7h6l2 2h10v10H3zM3 7V5h6" />,
  save: <path d="M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7" />,
  image: <><path d="M3 5h18v14H3z" /><circle cx={8.5} cy={10} r={1.8} /><path d="M21 16l-5-5-8 8" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" fillOpacity={0.2} />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  home: <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx={12} cy={12} r={3} /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  send: <path d="M4 12l16-8-6 16-2.5-6.5z" />,
  stop: <rect x={6} y={6} width={12} height={12} rx={2} />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  help: <><circle cx={12} cy={12} r={9} /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></>,
  slider: <><path d="M3 12h18" /><circle cx={9} cy={12} r={3} fill="var(--panel)" /></>,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name] ?? P.point}
    </svg>
  );
}
