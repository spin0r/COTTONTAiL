// ─── Logger ───────────────────────────────────────────────────────
// Consistent, timestamped console output

const COLORS = {
  reset:   "\x1b[0m",
  dim:     "\x1b[2m",
  bold:    "\x1b[1m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  magenta: "\x1b[35m",
  blue:    "\x1b[34m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
};

function ts(): string {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

function fmt(tag: string, color: string, msg: string): string {
  return `${COLORS.gray}${ts()}${COLORS.reset} ${color}${COLORS.bold}${tag}${COLORS.reset} ${msg}`;
}

export const log = {
  info:    (tag: string, msg: string) => console.log(fmt(tag, COLORS.cyan,    msg)),
  success: (tag: string, msg: string) => console.log(fmt(tag, COLORS.green,   msg)),
  warn:    (tag: string, msg: string) => console.log(fmt(tag, COLORS.yellow,  msg)),
  error:   (tag: string, msg: string) => console.error(fmt(tag, COLORS.red,   msg)),
  db:      (msg: string)              => console.log(fmt("DB",      COLORS.blue,    msg)),
  backup:  (msg: string)              => console.log(fmt("BACKUP",  COLORS.magenta, msg)),
  bot:     (msg: string)              => console.log(fmt("BOT",     COLORS.cyan,    msg)),
  web:     (msg: string)              => console.log(fmt("WEB",     COLORS.green,   msg)),
  nzb:     (msg: string)              => console.log(fmt("NZB",     COLORS.yellow,  msg)),
  thumb:   (msg: string)              => console.log(fmt("THUMB",   COLORS.blue,    msg)),
};
