import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AuthData, SessionToken } from "../types";

const AUTH_FILE = path.join(__dirname, "..", "..", "auth.json");
const DEFAULT_PASSWORD = "admin";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function pruneExpired(sessions: SessionToken[]): SessionToken[] {
  const now = Date.now();
  return sessions.filter((s) => now - s.createdAt < SESSION_MAX_AGE_MS);
}

function loadAuth(): AuthData {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as any;

      if (!Array.isArray(data.sessionTokens)) {
        const legacy = data.sessionToken as string | undefined;
        data.sessionTokens = legacy ? [{ token: legacy, createdAt: Date.now() }] : [];
        delete data.sessionToken;
        saveAuth(data as AuthData);
      } else if (data.sessionTokens.length > 0 && typeof data.sessionTokens[0] === "string") {
        data.sessionTokens = (data.sessionTokens as string[]).map((t) => ({
          token: t,
          createdAt: Date.now(),
        }));
        saveAuth(data as AuthData);
      }

      return data as AuthData;
    } catch (e: any) {
      console.error("Error reading auth.json", e);
    }
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hashed = hashPassword(DEFAULT_PASSWORD, salt);
  const authData: AuthData = { salt, hash: hashed, mustChange: true, sessionTokens: [] };
  saveAuth(authData);
  return authData;
}

function saveAuth(data: AuthData): void {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function verifyPassword(password: string): boolean {
  const auth = loadAuth();
  const hashed = hashPassword(password, auth.salt);
  return hashed === auth.hash;
}

export function mustChange(): boolean {
  return loadAuth().mustChange === true;
}

export function changePassword(newPassword: string): string {
  const auth = loadAuth();
  const salt = crypto.randomBytes(16).toString("hex");
  auth.salt = salt;
  auth.hash = hashPassword(newPassword, salt);
  auth.mustChange = false;
  const token = generateToken();
  auth.sessionTokens = [{ token, createdAt: Date.now() }];
  saveAuth(auth);
  return token;
}

export function createSession(): string {
  const auth = loadAuth();
  const token = generateToken();
  auth.sessionTokens = pruneExpired(auth.sessionTokens);
  auth.sessionTokens.push({ token, createdAt: Date.now() });
  saveAuth(auth);
  return token;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const auth = loadAuth();
  const now = Date.now();
  return auth.sessionTokens.some(
    (s) => s.token === token && now - s.createdAt < SESSION_MAX_AGE_MS
  );
}

export function clearSession(token: string | undefined): void {
  const auth = loadAuth();
  if (token) {
    auth.sessionTokens = auth.sessionTokens.filter((s) => s.token !== token);
  } else {
    auth.sessionTokens = [];
  }
  saveAuth(auth);
}
