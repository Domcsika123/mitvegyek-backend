// src/routes/adminLogin.ts
import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const router = Router();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const TOKEN_FILE = path.join(DATA_DIR, "admin-token.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function setAdminToken(token: string) {
  (globalThis as any).__MV_ADMIN_TOKEN__ = token;
  // Fájlba is mentjük, hogy újraindítás után is érvényes maradjon
  try {
    ensureDataDir();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }), "utf8");
  } catch (_) {}
}

export function getAdminToken(): string | null {
  // 1. Memóriából
  const mem = (globalThis as any).__MV_ADMIN_TOKEN__;
  if (mem) return mem;
  // 2. Fájlból (szerver újraindítás után)
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
      if (data?.token) {
        (globalThis as any).__MV_ADMIN_TOKEN__ = data.token;
        return data.token;
      }
    }
  } catch (_) {}
  return null;
}

router.post("/login", (req, res) => {
  const expectedUser = process.env.ADMIN_USER || "admin";
  const expectedPass = process.env.ADMIN_PASS || "admin";

  const { user, pass } = req.body || {};

  if (user === expectedUser && pass === expectedPass) {
    const token = crypto.randomBytes(32).toString("hex");
    setAdminToken(token);
    return res.json({ ok: true, token });
  }

  return res.status(401).json({ ok: false, error: "Hibás felhasználónév vagy jelszó." });
});

router.post("/logout", (req, res) => {
  setAdminToken("");
  return res.json({ ok: true });
});

export default router;
