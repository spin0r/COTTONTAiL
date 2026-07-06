// ─── Shared TypeScript Types ───────────────────────────────────────────────────

export interface Transfer {
  id?: string;
  name?: string;
  progress?: string | number;
  message?: string;
  folder_id?: string;
  status?: string;
}

export interface TransfersDict {
  running?: Transfer[];
  queued?: Transfer[];
  finished?: Transfer[];
  error?: Transfer[];
  failed?: Transfer[];
}

export interface TransferError {
  error: string;
  data?: unknown;
  raw?: string;
}

export type TransferResult = TransfersDict | TransferError;

export interface FolderFile {
  name?: string;
  link?: string;
  directlink?: string;
  url?: string;
  size?: number | string;
  fileSize?: number | string;
  file_size?: number | string;
  type?: string;
}

export interface FolderContents {
  content?: FolderFile[];
  files?: FolderFile[] | { content?: FolderFile[] };
  status?: string;
}

export interface AccountInfo {
  username?: string;
  days_left?: string;
  status?: string;
}

export interface NzbRecord {
  msg_id: number;
  file_name: string;
  caption: string;
  keywords: string;
  file_type: string;
  uploaded_at: string;
}

export interface NzbMeta {
  msg_id: number;
  file_name: string;
  caption: string;
  keywords?: string;
  file_type?: string;
  uploaded_at?: string;
}

export interface BackupInfo {
  path: string;
  size: number;
  sizeMB: string;
  modified: string;
  rev: string;
}

export interface AuthData {
  salt: string;
  hash: string;
  mustChange: boolean;
  sessionTokens: SessionToken[];
}

export interface SessionToken {
  token: string;
  createdAt: number;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface BotSession {
  _setState?: string | null;
  _setName?: string | null;
  _setPrefix?: string | null;
  lastSearch?: string;
  lastLogSearch?: string;
}
