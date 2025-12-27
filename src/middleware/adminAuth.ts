// src/middleware/adminAuth.ts
import { Request, Response, NextFunction } from "express";
import { getAdminToken } from "../routes/adminLogin";

/**
 * Admin token auth.
 * A kliens a token-t így küldi:
 *   headers: { "x-admin-token": "<token>" }
 */
export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-admin-token"];

  if (!token || typeof token !== "string" || token.trim() === "") {
    return res.status(401).json({ error: "Admin token hiányzik. Jelentkezz be újra." });
  }

  const expected = getAdminToken();
  if (!expected || token !== expected) {
    return res.status(401).json({ error: "Érvénytelen admin token. Jelentkezz be újra." });
  }

  next();
}
