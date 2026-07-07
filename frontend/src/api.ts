// ─── Types ────────────────────────────────────────────────────────

export interface Transfer {
  id?: string;
  name?: string;
  progress?: string | number;
  message?: string;
  folder_id?: string;
  status?: string;
}

export interface TransfersData {
  running?: Transfer[];
  queued?: Transfer[];
  finished?: Transfer[];
  error?: Transfer[];
}

export interface FileEntry {
  name: string;
  size: number;
  mtime: number;
}

export interface LogEntry {
  msg_id: number;
  file_name: string;
  caption: string;
  uploaded_at: string;
  link: string;
  has_custom_thumbnail?: boolean;
}

export interface AccountInfo {
  username?: string;
  days_left?: string;
  status?: string;
}

export interface HealthInfo {
  status: string;
  bot: string;
  connected: boolean;
  profile: string;
  email: string | null;
  uptime: string;
}

// ─── API helpers ─────────────────────────────────────────────────

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health:           ()            => req<HealthInfo>("GET", "/health"),
  authCheck:        ()            => req<{ ok: boolean }>("GET", "/api/auth-check"),
  transfers:        ()            => req<TransfersData>("GET", "/api/transfers"),
  deleteTransfer:   (id: string)  => req<void>("DELETE", `/api/transfers/${id}`),
  transferContents: (id: string)  => req<{ files: any[] }>("GET", `/api/transfers/${id}/contents`),

  files:            ()            => req<FileEntry[]>("GET", "/files"),
  deleteFile:       (name: string) => req<void>("DELETE", `/files/${encodeURIComponent(name)}`),
  renameFile:       (name: string, newName: string) => req("PUT", `/files/${encodeURIComponent(name)}`, { new_name: newName }),
  clearFiles:       ()            => req<void>("DELETE", "/files"),
  uploadToMagic:    (name: string) => req<{ status: string }>("POST", `/upload-to-magic/${encodeURIComponent(name)}`),
  uploadToLog:      (name: string) => req<{ status: string }>("POST", `/upload-to-log/${encodeURIComponent(name)}`),

  logs:             (q?: string)  => req<{ results: LogEntry[]; total: number }>("GET", `/api/logs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  logStats:         ()            => req<{ total: number }>("GET", "/api/logs/stats"),
  grabNzb:          (id: number)  => req<{ status: string }>("POST", `/api/grab/${id}`),
  renameLog:        (id: number, newName: string) => req("PUT", `/api/logs/${id}/rename`, { new_name: newName }),
  aiRenameLog:      (id: number)  => req<{ new_name: string }>("POST", `/api/logs/${id}/ai-rename`),
  deleteLog:        (id: number)  => req<{ success: boolean; telegram_deleted: boolean; db_deleted: boolean }>("DELETE", `/api/logs/${id}`),
  logThumbnailUrl:       (id: number)  => `/api/logs/${id}/thumbnail`,
  logCustomThumbnailUrl: (id: number)  => `/api/logs/${id}/custom-thumbnail`,
  setCustomThumbnail:    (id: number, url: string) => req<{ success: boolean; size: number; mime: string }>("POST", `/api/logs/${id}/custom-thumbnail`, { url }),

  account:          ()            => req<AccountInfo>("GET", "/api/account"),
  renewAccount:     ()            => req<{ success: boolean }>("POST", "/api/account/renew"),

  profiles:         ()            => req<{ profiles: string[]; active: string }>("GET", "/api/profiles"),
  switchProfile:    (name: string) => req("POST", "/api/profiles/switch", { name }),

  login:            (password: string) => req<{ success: boolean; mustChange?: boolean }>("POST", "/api/login", { password }),
  changePassword:   (currentPassword: string, newPassword: string) => req("POST", "/api/change-password", { currentPassword, newPassword }),
  logout:           ()            => req("POST", "/api/logout"),
};

// ─── Upload file via FormData ─────────────────────────────────────

export async function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload");
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        try { reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed")); }
        catch { reject(new Error("Upload failed")); }
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

// ─── Utilities ───────────────────────────────────────────────────

export function fmtSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
