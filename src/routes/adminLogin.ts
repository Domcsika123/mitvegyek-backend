// src/routes/adminLogin.ts
import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const router = Router();

// MVP token tárolás memóriában
function setAdminToken(token: string) {
  (globalThis as any).__MV_ADMIN_TOKEN__ = token;
}
export function getAdminToken(): string | null {
  return (globalThis as any).__MV_ADMIN_TOKEN__ || null;
}

// Admin felhasználók betöltése JSON-ből
function loadAdminUsers(): { user: string; pass: string }[] {
  try {
    const filePath = path.join(__dirname, "..", "..", "data", "admin-users.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return Array.isArray(data.users) ? data.users : [];
    }
  } catch (err) {
    console.warn("[adminLogin] Nem lehet betölteni admin-users.json:", err);
  }
  // Fallback: env variables
  const envUser = process.env.ADMIN_USER || "admin";
  const envPass = process.env.ADMIN_PASS || "admin";
  return [{ user: envUser, pass: envPass }];
}

router.post("/login", (req, res) => {
  const { user, pass } = req.body || {};

  const adminUsers = loadAdminUsers();
  const validUser = adminUsers.find((u) => u.user === user && u.pass === pass);

  if (validUser) {
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
