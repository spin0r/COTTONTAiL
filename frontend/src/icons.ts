// ─── SVG Icon helpers ─────────────────────────────────────────────
// 16×16, stroke-based, 1.5px stroke, currentColor

const s = (d: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;

export const iconSearch    = () => s('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>');
export const iconRefresh   = () => s('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>');
export const iconTrash     = () => s('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>');
export const iconEdit      = () => s('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>');
export const iconUpload    = () => s('<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>');
export const iconDownload  = () => s('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');
export const iconEye       = () => s('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
export const iconX         = () => s('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
export const iconCheck     = () => s('<polyline points="20 6 9 17 4 12"/>');
export const iconChevronDown = () => s('<polyline points="6 9 12 15 18 9"/>');
export const iconFolder    = () => s('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>');
export const iconFile      = () => s('<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>');
export const iconZap       = () => s('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>');
export const iconClipboard = () => s('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>');
export const iconSparkle   = () => s('<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>');
export const iconLogout    = () => s('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>');
export const iconUser      = () => s('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>');
export const iconSettings  = () => s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
export const iconActivity  = () => s('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>');
export const iconImage     = () => s('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>');
export const iconBackfill  = () => s('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/>');
export const iconTelegram  = () => s('<path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/>');

// ─── File type badge icon ─────────────────────────────────────────
export function iconFileType(filename: string): string {
  const ext = (filename.split('.').pop() || 'file').toLowerCase().slice(0, 4).toUpperCase();

  const isImg = /^(JPE?G|PNG|GIF|WEBP|BMP|TIFF?|SVG|HEIC|AVIF)$/.test(ext);
  const isVid = /^(MP4|MKV|AVI|MOV|WMV|M4V|WEBM|FLV|TS|MTS|3GP|VOB|OGV)$/.test(ext);
  const color = isImg ? '#22c55e' : isVid ? '#3b82f6' : '#71717a';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">
    <rect x="0" y="0" width="40" height="20" rx="4" fill="#27272a"/>
    <rect x="0" y="0" width="40" height="20" rx="4" fill="${color}" opacity="0.15"/>
    <rect x="0" y="0" width="40" height="20" rx="4" fill="none" stroke="${color}" stroke-width="1"/>
    <text x="20" y="13.5" text-anchor="middle" font-family="monospace" font-weight="700" font-size="9" fill="${color}" letter-spacing="0.5">${ext}</text>
  </svg>`;
}
