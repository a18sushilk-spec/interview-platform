const express  = require("express");
const path     = require("path");
const multer   = require("multer");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const { Pool } = require("pg");
require("dotenv").config();

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "preploop-secret-2026-change-in-prod";

// ── Database ──────────────────────────────────────────────────────────────────
const hasDb = !!process.env.DATABASE_URL;
const pool  = hasDb ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

// In-memory fallback (used only if DATABASE_URL is missing, e.g. quick local dev)
let memUsers   = [];
let memRatings = [];

// Create tables on startup
async function initDb() {
  if (!hasDb) { console.warn("⚠ No DATABASE_URL — using in-memory storage (data will not persist)."); return; }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id      TEXT PRIMARY KEY,
        name    TEXT NOT NULL,
        email   TEXT UNIQUE NOT NULL,
        mobile  TEXT DEFAULT '',
        hash    TEXT DEFAULT '',
        created TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ratings (
        id      SERIAL PRIMARY KEY,
        name    TEXT DEFAULT 'Anonymous',
        rating  INT NOT NULL,
        review  TEXT DEFAULT '',
        role    TEXT DEFAULT '',
        created TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log("✓ Database ready (Postgres).");
  } catch (err) {
    console.error("Database init failed:", err.message);
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, mobile, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password are required." });
  const em = email.toLowerCase().trim();
  try {
    const hash = await bcrypt.hash(password, 10);
    const id   = Date.now().toString();
    const u    = { id, name: name.trim(), email: em, mobile: (mobile || "").trim(), hash };

    if (hasDb) {
      const exists = await pool.query("SELECT 1 FROM users WHERE email=$1", [em]);
      if (exists.rowCount) return res.status(400).json({ error: "This email is already registered. Please log in." });
      await pool.query("INSERT INTO users (id,name,email,mobile,hash) VALUES ($1,$2,$3,$4,$5)", [u.id, u.name, u.email, u.mobile, u.hash]);
    } else {
      if (memUsers.find(x => x.email === em)) return res.status(400).json({ error: "This email is already registered. Please log in." });
      memUsers.push(u);
    }
    const token = jwt.sign({ id: u.id, name: u.name, email: u.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { name: u.name, email: u.email, mobile: u.mobile } });
  } catch (err) {
    console.error("Signup error:", err.message);
    res.status(500).json({ error: "Could not create account. Please try again." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const em = (email || "").toLowerCase().trim();
  try {
    let user;
    if (hasDb) { const r = await pool.query("SELECT * FROM users WHERE email=$1", [em]); user = r.rows[0]; }
    else user = memUsers.find(x => x.email === em);
    if (!user) return res.status(401).json({ error: "No account found with this email." });
    const ok = await bcrypt.compare(password, user.hash);
    if (!ok) return res.status(401).json({ error: "Incorrect password." });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { name: user.name, email: user.email, mobile: user.mobile } });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Could not log in. Please try again." });
  }
});

app.get("/api/auth/verify", async (req, res) => {
  const auth = (req.headers.authorization || "").replace("Bearer ", "");
  if (!auth) return res.status(401).json({ error: "No token" });
  try {
    const decoded = jwt.verify(auth, JWT_SECRET);
    let user;
    if (hasDb) { const r = await pool.query("SELECT * FROM users WHERE id=$1", [decoded.id]); user = r.rows[0]; }
    else user = memUsers.find(x => x.id === decoded.id);
    if (!user) return res.status(401).json({ error: "User not found — please log in again." });
    res.json({ user: { name: user.name, email: user.email, mobile: user.mobile } });
  } catch { res.status(401).json({ error: "Session expired — please log in again." }); }
});

app.post("/api/auth/google", async (req, res) => {
  const { name, email } = req.body;
  if (!email) return res.status(400).json({ error: "Invalid Google account." });
  const em = email.toLowerCase().trim();
  try {
    let user;
    if (hasDb) {
      const r = await pool.query("SELECT * FROM users WHERE email=$1", [em]);
      user = r.rows[0];
      if (!user) {
        const id = Date.now().toString();
        await pool.query("INSERT INTO users (id,name,email,mobile,hash) VALUES ($1,$2,$3,'','')", [id, (name || em).trim(), em]);
        user = { id, name: (name || em).trim(), email: em, mobile: "" };
      }
    } else {
      user = memUsers.find(x => x.email === em);
      if (!user) { user = { id: Date.now().toString(), name: (name || em).trim(), email: em, mobile: "", hash: "" }; memUsers.push(user); }
    }
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { name: user.name, email: user.email, mobile: user.mobile } });
  } catch (err) {
    console.error("Google auth error:", err.message);
    res.status(500).json({ error: "Google sign-in failed. Please try again." });
  }
});

// ── Claude proxy ──────────────────────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    if (!response.ok) console.error("Anthropic error:", JSON.stringify(data));
    res.json(data);
  } catch (err) {
    console.error("Claude proxy error:", err.message);
    res.status(500).json({ error: "Failed to reach Anthropic API." });
  }
});

// ── Resume parser ─────────────────────────────────────────────────────────────
app.post("/api/parse-resume", upload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  try {
    if (req.file.mimetype === "application/pdf" || req.file.originalname.endsWith(".pdf")) {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(req.file.buffer);
      return res.json({ text: data.text });
    }
    res.json({ text: req.file.buffer.toString("utf8") });
  } catch (err) {
    console.error("Resume parse error:", err.message);
    res.status(500).json({ error: "Could not parse file. Please paste your resume as text." });
  }
});

// ── Ratings ───────────────────────────────────────────────────────────────────
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

app.get("/api/ratings", async (_req, res) => {
  try {
    if (hasDb) {
      const r = await pool.query("SELECT name,rating,review,role,created FROM ratings ORDER BY created DESC LIMIT 100");
      return res.json(r.rows.map(x => ({ name: x.name, rating: x.rating, review: x.review, role: x.role, date: fmtDate(x.created) })));
    }
    res.json(memRatings);
  } catch (err) {
    console.error("Get ratings error:", err.message);
    res.json([]);
  }
});

app.post("/api/ratings", async (req, res) => {
  const { name, rating, review, role } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Invalid rating." });
  try {
    if (hasDb) {
      await pool.query("INSERT INTO ratings (name,rating,review,role) VALUES ($1,$2,$3,$4)",
        [(name || "Anonymous").trim(), parseInt(rating), (review || "").trim(), (role || "").trim()]);
    } else {
      memRatings.unshift({ name: (name || "Anonymous").trim(), rating: parseInt(rating), review: (review || "").trim(), role: (role || "").trim(), date: fmtDate(Date.now()) });
      if (memRatings.length > 100) memRatings = memRatings.slice(0, 100);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Post rating error:", err.message);
    res.status(500).json({ error: "Could not save review." });
  }
});

// ── Serve React app ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const PORT = process.env.PORT || 3001;
initDb().then(() => {
  app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
});
