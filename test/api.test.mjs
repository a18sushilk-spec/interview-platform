// Runnable backend API tests. Start the server first, then: node test/api.test.mjs
// Tests auth (signup/login/google), ratings, and resume parsing. Does NOT test /api/claude (costs money).

const BASE = process.env.TEST_BASE || "http://localhost:3001";
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}  ${detail}`); }
}

async function post(path, body, headers = {}) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  let json = {}; try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}
async function get(path, headers = {}) {
  const r = await fetch(BASE + path, { headers });
  let json = null; try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}

async function run() {
  const uniq = Date.now();
  const email = `test_${uniq}@example.com`;
  const email2 = `test2_${uniq}@example.com`;

  // ── Signup ──
  const s1 = await post("/api/auth/signup", { name: "Test User", email, mobile: "9999999999", password: "secret123" });
  check("signup returns token", s1.status === 200 && !!s1.json.token, JSON.stringify(s1.json));
  check("signup returns correct user email", s1.json.user?.email === email, JSON.stringify(s1.json.user));
  const token = s1.json.token;

  // ── Duplicate signup rejected ──
  const s2 = await post("/api/auth/signup", { name: "Dup", email, password: "another" });
  check("duplicate signup rejected", s2.status === 400 && !!s2.json.error, JSON.stringify(s2.json));

  // ── Signup missing fields ──
  const s3 = await post("/api/auth/signup", { email: `x_${uniq}@e.com` });
  check("signup without password rejected", s3.status === 400, JSON.stringify(s3.json));

  // ── Login correct ──
  const l1 = await post("/api/auth/login", { email, password: "secret123" });
  check("login correct password works", l1.status === 200 && !!l1.json.token, JSON.stringify(l1.json));
  check("login returns the right user (not someone else)", l1.json.user?.email === email, JSON.stringify(l1.json.user));

  // ── Login wrong password ──
  const l2 = await post("/api/auth/login", { email, password: "wrongpass" });
  check("login wrong password rejected", l2.status === 401, JSON.stringify(l2.json));

  // ── Login unknown email ──
  const l3 = await post("/api/auth/login", { email: `nobody_${uniq}@e.com`, password: "x" });
  check("login unknown email rejected", l3.status === 401, JSON.stringify(l3.json));

  // ── Token verify ──
  const v1 = await get("/api/auth/verify", { Authorization: `Bearer ${token}` });
  check("verify valid token returns user", v1.status === 200 && v1.json.user?.email === email, JSON.stringify(v1.json));

  // ── Verify bad token ──
  const v2 = await get("/api/auth/verify", { Authorization: "Bearer garbage.token.here" });
  check("verify bad token rejected", v2.status === 401, JSON.stringify(v2.json));

  // ── Second distinct user gets their OWN identity (the "everyone shows my email" bug) ──
  const s4 = await post("/api/auth/signup", { name: "Second Person", email: email2, password: "secret456" });
  check("second user signs up", s4.status === 200, JSON.stringify(s4.json));
  check("second user has DIFFERENT email", s4.json.user?.email === email2 && s4.json.user?.email !== email, JSON.stringify(s4.json.user));
  const v3 = await get("/api/auth/verify", { Authorization: `Bearer ${s4.json.token}` });
  check("second user's token resolves to SECOND user (not first)", v3.json.user?.email === email2, JSON.stringify(v3.json.user));

  // ── Google auth creates/returns user ──
  const g1 = await post("/api/auth/google", { name: "Google Guy", email: `g_${uniq}@gmail.com` });
  check("google auth returns token + correct email", g1.status === 200 && g1.json.user?.email === `g_${uniq}@gmail.com`, JSON.stringify(g1.json));

  // ── Ratings: post + retrieve ──
  const r1 = await post("/api/ratings", { name: "Reviewer", rating: 5, review: "Great!", role: "Analyst" });
  check("post valid rating works", r1.status === 200 && r1.json.success, JSON.stringify(r1.json));
  const r2 = await post("/api/ratings", { name: "Bad", rating: 9, review: "x" });
  check("post invalid rating (>5) rejected", r2.status === 400, JSON.stringify(r2.json));
  const rg = await get("/api/ratings");
  check("get ratings returns array", Array.isArray(rg.json), JSON.stringify(rg.json).slice(0, 120));
  check("posted rating appears in list", Array.isArray(rg.json) && rg.json.some(x => x.review === "Great!"), "");

  // ── Role packs (RAG-lite retrieval) ──
  const rp1 = await get("/api/role-pack?role=" + encodeURIComponent("Product Manager"));
  check("role-pack matches 'Product Manager'", rp1.json.matched && /product/i.test(rp1.json.pack?.role || ""), JSON.stringify(rp1.json).slice(0,120));
  const rp2 = await get("/api/role-pack?role=" + encodeURIComponent("APM"));
  check("role-pack matches alias 'APM' to Product Manager", rp2.json.matched && /product/i.test(rp2.json.pack?.role || ""), JSON.stringify(rp2.json).slice(0,120));
  const rp3 = await get("/api/role-pack?role=" + encodeURIComponent("Senior Data Scientist"));
  check("role-pack matches 'Senior Data Scientist'", rp3.json.matched && /data/i.test(rp3.json.pack?.role || ""), JSON.stringify(rp3.json).slice(0,120));
  const rp4 = await get("/api/role-pack?role=" + encodeURIComponent("Underwater Basket Weaver"));
  check("role-pack returns no match for unknown role (graceful fallback)", rp4.json.matched === false, JSON.stringify(rp4.json));
  const rp5 = await get("/api/role-pack?role=" + encodeURIComponent("consultant"));
  check("role-pack matches 'consultant'", rp5.json.matched && /consultant/i.test(rp5.json.pack?.role || ""), JSON.stringify(rp5.json).slice(0,120));
  const rp6 = await get("/api/role-pack?role=" + encodeURIComponent("scrum master"));
  check("role-pack matches 'scrum master' to Project Manager", rp6.json.matched && /project/i.test(rp6.json.pack?.role || ""), JSON.stringify(rp6.json).slice(0,120));
  const rp7 = await get("/api/role-pack?role=" + encodeURIComponent("Chief of Staff"));
  check("role-pack matches 'Chief of Staff' to Founder's Office", rp7.json.matched && /founder/i.test(rp7.json.pack?.role || ""), JSON.stringify(rp7.json).slice(0,120));
  const rp8 = await get("/api/role-pack?role=" + encodeURIComponent("Growth Marketing Manager"));
  check("role-pack matches 'Growth Marketing Manager' to Marketing", rp8.json.matched && /marketing/i.test(rp8.json.pack?.role || ""), JSON.stringify(rp8.json).slice(0,120));

  // ── Output ──
  console.log("\n──────── BACKEND API TEST RESULTS ────────");
  console.log(results.join("\n"));
  console.log("──────────────────────────────────────────");
  console.log(`TOTAL: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error("TEST RUNNER CRASHED:", e.message); process.exit(2); });
