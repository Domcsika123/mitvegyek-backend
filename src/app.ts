// src/app.ts
import express from "express";
import cors from "cors";
import path from "path";

import recommendRouter from "./routes/recommend";
import adminRouter from "./routes/admin";
import adminLoginRouter from "./routes/adminLogin";
import { adminAuth } from "./middleware/adminAuth";

const app = express();

// Alap middleware-k
app.use(cors());
app.use(express.json());

// Statikus fájlok (demo.html, admin.html, widget.js, stb.)
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// Health-check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", service: "MitVegyek API működik" });
});

// ✅ LOGIN endpoint (NINCS token védelem!)
// POST /api/admin/login
app.use("/api/admin", adminLoginRouter);

// ✅ Admin API – token védelemmel
app.use("/api/admin", adminAuth, adminRouter);

// Nyilvános ajánló API
app.use("/api", recommendRouter);

export default app;
