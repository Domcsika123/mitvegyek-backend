// src/routes/adminLogin.ts
import { Router } from "express";
import crypto from "crypto";

const router = Router();

// MVP token tárolás memóriában
function setAdminToken(token: string) {
  (globalThis as any).__MV_ADMIN_TOKEN__ = token;
}
export function getAdminToken(): string | null {
  return (globalThis as any).__MV_ADMIN_TOKEN__ || null;
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
