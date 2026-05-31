const express  = require("express");
const path     = require("path");
const multer   = require("multer");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
require("dotenv").config();

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "preploop-secret-2026-change-in-prod";

// In-memory stores (persist while server is running)
let users   = [];
let ratings = [];

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, mobile, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password are required." });
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ error: "This email is already registered. Please log in." });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), name: name.trim(), email: email.toLowerCase().trim(), mobile: (mobile || "").trim(), hash };
  users.push(user);
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { name: user.name, email: user.email, mobile: user.mobile } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: "No account found with this email." });
  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { name: user.name, email: user.email, mobile: user.mobile } });
});

app.get("/api/auth/verify", (req, res) => {
  const auth = (req.headers.authorization || "").replace("Bearer ", "");
  if (!auth) return res.status(401).json({ error: "No token" });
  try {
    const decoded = jwt.verify(auth, JWT_SECRET);
    const user = users.find(u => u.id === decoded.id);
    if (!user) return res.status(401).json({ error: "User not found — please log in again." });
    res.json({ user: { name: user.name, email: user.email, mobile: user.mobile } });
  } catch { res.status(401).json({ error: "Session expired — please log in again." }); }
});

app.post("/api/auth/google", async (req, res) => {
  const { name, email } = req.body;
  if (!email) return res.status(400).json({ error: "Invalid Google account." });
  let user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) {
    user = { id: Date.now().toString(), name: (name || email).trim(), email: email.toLowerCase().trim(), mobile: "", hash: "" };
    users.push(user);
  }
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { name: user.name, email: user.email, mobile: user.mobile } });
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
app.get("/api/ratings", (_req, res) => res.json(ratings));

app.post("/api/ratings", (req, res) => {
  const { name, rating, review, role } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Invalid rating." });
  ratings.unshift({
    name:   (name   || "Anonymous").trim(),
    rating: parseInt(rating),
    review: (review || "").trim(),
    role:   (role   || "").trim(),
    date:   new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
  });
  if (ratings.length > 100) ratings = ratings.slice(0, 100);
  res.json({ success: true });
});

// ── Serve React app ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
