import React, { useState, useRef, useEffect, useCallback } from "react";
import { track, identify, resetUser, reportError } from "./analytics";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       "#F7F4EF",  // warm parchment
  surface:  "#FFFFFF",  // white cards
  surface2: "#F0EDE6",  // input background
  border:   "#E3DDD3",  // warm border
  borderLt: "#EAE6DF",  // lighter border
  ink:      "#1A1714",  // near-black (warm)
  sub:      "#6A635C",  // medium warm gray
  mute:     "#A89F96",  // light warm gray
  accent:   "#C0432A",  // coral (brand)
  accentLt: "#D4553A",  // lighter coral
  gold:     "#B8892A",  // amber gold
  green:    "#1A7A40",  // success green
};
const FD = `'Fraunces', Georgia, serif`;
const FB = `'Inter', -apple-system, sans-serif`;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

// ── Personas ──────────────────────────────────────────────────────────────────
const PERSONAS = {
  male: [
    { name: "Rajesh Sharma",  exp: 22, bg: "management consulting and business strategy at McKinsey and Tata Consulting" },
    { name: "Vikram Mehta",   exp: 25, bg: "corporate leadership and P&L management across FMCG and manufacturing" },
    { name: "Anil Kumar",     exp: 20, bg: "investment banking and strategic finance" },
    { name: "Suresh Iyer",    exp: 24, bg: "operations, supply chain, and general management" },
  ],
  female: [
    { name: "Priya Nair",    exp: 21, bg: "people leadership, HR transformation, and business consulting" },
    { name: "Anita Desai",   exp: 23, bg: "corporate strategy, M&A, and talent management" },
    { name: "Sunita Rao",    exp: 20, bg: "chief HR roles and organisational development" },
    { name: "Kavitha Menon", exp: 22, bg: "marketing leadership, brand strategy, and digital transformation" },
  ],
};
function pickPersona() {
  const g = Math.random() < 0.5 ? "male" : "female";
  const list = PERSONAS[g];
  return { ...list[Math.floor(Math.random() * list.length)], gender: g };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 700);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 700);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return m;
}

// ── Voice ─────────────────────────────────────────────────────────────────────
function resolveVoice(gender) {
  const vs = window.speechSynthesis.getVoices();
  if (!vs.length) return null;
  const iF  = vs.find(v => v.lang === "en-IN" && /heera|female/i.test(v.name));
  const iM  = vs.find(v => v.lang === "en-IN" && /ravi|male/i.test(v.name));
  const iA  = vs.find(v => v.lang === "en-IN");
  const eF  = vs.find(v => /Google UK English Female|Samantha|Aria|Zira/i.test(v.name));
  const eM  = vs.find(v => /Google UK English Male|David|Daniel/i.test(v.name));
  const any = vs.find(v => /en-/i.test(v.lang));
  return gender === "female" ? (iF || iA || eF || any) : (iM || iA || eM || any);
}

function makeSpeaker(voiceRef, speechIdRef, gender) {
  return (text, onEnd) => {
    window.speechSynthesis.cancel();
    const id = ++speechIdRef.current;
    const u  = new SpeechSynthesisUtterance(text);
    u.rate   = 0.93;
    u.pitch  = gender === "female" ? 1.06 : 0.94;
    if (voiceRef.current) u.voice = voiceRef.current;
    const guard = () => { if (speechIdRef.current === id && onEnd) onEnd(); };
    u.onend   = guard;
    u.onerror = guard;
    setTimeout(guard, Math.max(text.length * 80, 4500));
    window.speechSynthesis.speak(u);
  };
}

// ── API ───────────────────────────────────────────────────────────────────────
async function callClaude(messages, system, maxTokens = 1200) {
  const res  = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.content || []).map(b => b.type === "text" ? b.text : "").filter(Boolean).join("\n").trim();
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [stage,        setStage]        = useState("setup");
  const [user,         setUser]         = useState(null);
  const [authPending,  setAuthPending]  = useState(false);
  const [interviewKey, setInterviewKey] = useState(0);
  const [resume,   setResume]   = useState("");
  const [jd,       setJd]       = useState("");
  const [role,     setRole]     = useState("");
  const [company,  setCompany]  = useState("");
  const [industry, setIndustry] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [report,     setReport]     = useState(null);

  // Verify stored token; restore that user's saved form only if the SAME user returns
  useEffect(() => {
    const token = localStorage.getItem("pl_token");
    if (!token) return;
    fetch("/api/auth/verify", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (!d.user) return;
        setUser(d.user);
        // Restore form scoped to THIS user's email
        try {
          const saved = JSON.parse(localStorage.getItem(`pl_form_${d.user.email}`) || "{}");
          if (saved.resume)   setResume(saved.resume);
          if (saved.jd)       setJd(saved.jd);
          if (saved.role)     setRole(saved.role);
          if (saved.company)  setCompany(saved.company);
          if (saved.industry) setIndustry(saved.industry);
        } catch (_) {}
      })
      .catch(() => {});
  }, []);

  // Persist form only for logged-in users, scoped to their email. Anonymous = nothing saved.
  useEffect(() => {
    if (!user?.email) return;
    try { localStorage.setItem(`pl_form_${user.email}`, JSON.stringify({ resume, jd, role, company, industry })); } catch (_) {}
  }, [user, resume, jd, role, company, industry]);

  const login = (token, u) => {
    localStorage.setItem("pl_token", token);
    localStorage.setItem("pl_user", JSON.stringify(u));
    setUser(u);
    identify(u);
    track("user_logged_in", { email: u.email });
    if (authPending) { setAuthPending(false); setStage("interview"); track("interview_started"); }
    else setStage("setup");
  };
  const logout = () => {
    track("user_logged_out");
    resetUser();
    // Stop Google from silently auto-signing the same account back in
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch (_) {}
    // Clear session token + any in-progress interview (per-user form data is kept,
    // keyed by email, so it returns only when THAT user logs back in)
    localStorage.removeItem("pl_token");
    localStorage.removeItem("pl_user");
    localStorage.removeItem("pl_interview_progress");
    // Hard reload to a clean home page so everything is fully refreshed
    window.location.href = "/";
  };
  const handleStart = () => {
    const hasToken = !!localStorage.getItem("pl_token");
    track("begin_interview_clicked", { logged_in: !!(user || hasToken) });
    if (user || hasToken) { setStage("interview"); track("interview_started"); }
    else { setAuthPending(true); setStage("auth"); }
  };
  const freshStart = () => {
    localStorage.removeItem("pl_interview_progress");
    setInterviewKey(k => k + 1);
  };

  return (
    <div style={{ fontFamily: FB, color: C.ink, background: C.bg, minHeight: "100vh" }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; -webkit-font-smoothing: antialiased; margin:0; padding:0; }
        body { margin:0; background:${C.bg}; color:${C.ink}; }
        ::selection { background:${C.accent}; color:#fff; }
        input, textarea, select { font-family:inherit; color:${C.ink}; background:${C.surface2}; }
        button { font-family:inherit; cursor:pointer; }
        a { color:${C.accent}; text-decoration:none; }
        a:hover { text-decoration:underline; }
        @keyframes pulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
        @keyframes ring   { 0%{transform:scale(.85);opacity:.55} 100%{transform:scale(2.1);opacity:0} }
        @keyframes rise   { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        @keyframes bar    { 0%,100%{height:4px} 50%{height:18px} }
        @keyframes dot    { 0%,80%,100%{opacity:0;transform:scale(0)} 40%{opacity:1;transform:scale(1)} }
        @keyframes shimmer{ 0%{opacity:.4} 50%{opacity:1} 100%{opacity:.4} }
        .rise { animation:rise .45s cubic-bezier(.16,1,.3,1) both; }
        input:focus, textarea:focus, select:focus { outline:2px solid ${C.accent}50; border-color:${C.accent} !important; }
        button:active { opacity:.8; }
        ::-webkit-scrollbar { width:6px; } ::-webkit-scrollbar-track { background:${C.surface}; } ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:3px; }
      `}</style>

      <Nav stage={stage} user={user} onLogout={logout} />

      {stage === "auth"      && <AuthScreen onLogin={login} />}
      {stage === "setup"     && (
        <Setup resume={resume} setResume={setResume} jd={jd} setJd={setJd}
          role={role} setRole={setRole} company={company} setCompany={setCompany}
          industry={industry} setIndustry={setIndustry} onStart={handleStart} />
      )}
      {stage === "interview" && (
        <Interview key={interviewKey} resume={resume} jd={jd} role={role}
          company={company} industry={industry} onFreshStart={freshStart}
          onFinish={(t, r) => {
            localStorage.removeItem("pl_interview_progress");
            track("interview_completed", { questions_answered: t.length, score: r?.overall ?? null });
            setTranscript(t); setReport(r); setStage("report");
            track("report_viewed", { score: r?.overall ?? null });
          }} />
      )}
      {stage === "report"    && (
        <Report transcript={transcript} report={report} role={role}
          onRestart={() => { setStage("setup"); setTranscript([]); setReport(null); window.scrollTo({ top:0, behavior:"smooth" }); }} />
      )}
      <Foot />
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function Nav({ stage, user, onLogout }) {
  const mob   = useIsMobile();
  const steps = ["Setup", "Interview", "Report"];
  const idx   = { setup:0, interview:1, report:2 }[stage] ?? -1;
  return (
    <nav style={{ height:58, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:200, background:`${C.bg}EE`, backdropFilter:"blur(14px)", borderBottom:`1px solid ${C.border}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:32, height:32, borderRadius:9, background:C.accent, display:"grid", placeItems:"center", color:"#fff", fontFamily:FD, fontWeight:700, fontSize:18, boxShadow:`0 0 0 1px ${C.accent}40` }}>P</div>
        <span style={{ fontFamily:FD, fontWeight:600, fontSize:18, letterSpacing:"-.02em", color:C.ink }}>PrepLoop</span>
      </div>

      {/* Stepper */}
      {!mob && idx >= 0 && (
        <div style={{ display:"flex", alignItems:"center" }}>
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:22, height:22, borderRadius:"50%", background:i < idx ? C.accent : i === idx ? C.accent : "transparent", border:`1.5px solid ${i <= idx ? C.accent : C.border}`, display:"grid", placeItems:"center", fontSize:10, fontWeight:700, color:i <= idx ? "#fff" : C.mute, flexShrink:0 }}>
                  {i < idx ? "✓" : i + 1}
                </div>
                <span style={{ fontSize:12.5, color:i === idx ? C.ink : C.mute, fontWeight:i === idx ? 600 : 400 }}>{s}</span>
              </div>
              {i < steps.length - 1 && <div style={{ width:28, height:1, background:i < idx ? C.accent : C.border, margin:"0 10px" }} />}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* User area — FIX: visible on dark bg */}
      <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
        {user ? (
          <>
            {!mob && (
              <div style={{ display:"flex", alignItems:"center", gap:8, background:C.surface2, border:`1px solid ${C.border}`, borderRadius:30, padding:"5px 12px 5px 8px" }}>
                <div style={{ width:24, height:24, borderRadius:"50%", background:C.accent, display:"grid", placeItems:"center", color:"#fff", fontSize:11, fontWeight:700, flexShrink:0 }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize:13, color:C.ink, fontWeight:500 }}>{user.name.split(" ")[0]}</span>
              </div>
            )}
            <button onClick={onLogout} style={{ fontSize:12.5, padding:"6px 14px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.sub, whiteSpace:"nowrap" }}>
              Log out
            </button>
          </>
        ) : (
          <div style={{ width:32 }} /> /* spacer */
        )}
      </div>
    </nav>
  );
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const mob = useIsMobile();
  const [tab,  setTab]  = useState("login");
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [mob_, setMob_] = useState(""); const [pass,  setPass]  = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const gRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes("paste-your") || !window.google) return;
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (res) => {
          try {
            const payload = JSON.parse(atob(res.credential.split(".")[1]));
            const r = await fetch("/api/auth/google", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ name:payload.name, email:payload.email }) });
            const d = await r.json();
            if (d.token) onLogin(d.token, d.user); else setErr(d.error || "Google sign-in failed.");
          } catch { setErr("Google sign-in failed — try email instead."); }
        },
      });
      if (gRef.current) window.google.accounts.id.renderButton(gRef.current, { theme:"outline", size:"large", width:"100%", text:"continue_with" });
    } catch (_) {}
  }, [onLogin]);

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const ep   = tab === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body = tab === "login" ? { email, password:pass } : { name, email, mobile:mob_, password:pass };
      const res  = await fetch(ep, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const d    = await res.json();
      if (d.error) setErr(d.error); else onLogin(d.token, d.user);
    } catch { setErr("Connection error — please try again."); }
    setBusy(false);
  };

  const hasGoogle = GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes("paste-your");

  return (
    <main style={{ minHeight:"calc(100vh - 58px)", display:"grid", placeItems:"center", padding:"24px 16px" }}>
      <div className="rise" style={{ width:"100%", maxWidth:400, background:C.surface, border:`1px solid ${C.border}`, borderRadius:18, padding:mob?"28px 20px":"36px 36px", boxShadow:"0 12px 40px rgba(26,23,20,.1)" }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:C.accent, display:"grid", placeItems:"center", color:"#fff", fontFamily:FD, fontWeight:700, fontSize:24, margin:"0 auto 12px" }}>P</div>
          <h1 style={{ fontFamily:FD, fontSize:22, fontWeight:600, letterSpacing:"-.02em", marginBottom:4 }}>PrepLoop</h1>
          <p style={{ fontSize:13.5, color:C.sub }}>AI mock interview · walk in ready</p>
        </div>

        {hasGoogle && (
          <>
            <div ref={gRef} style={{ width:"100%", marginBottom:16 }} />
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <div style={{ flex:1, height:1, background:C.border }} />
              <span style={{ fontSize:12, color:C.mute }}>or continue with email</span>
              <div style={{ flex:1, height:1, background:C.border }} />
            </div>
          </>
        )}

        <div style={{ display:"flex", background:C.surface2, borderRadius:9, padding:3, marginBottom:18 }}>
          {["login","signup"].map(t => (
            <button key={t} onClick={() => { setTab(t); setErr(""); }} style={{ flex:1, padding:"8px 0", borderRadius:7, border:"none", fontSize:13.5, fontWeight:500, background:tab===t?C.surface:"transparent", color:tab===t?C.ink:C.mute, boxShadow:tab===t?"0 1px 3px rgba(26,23,20,.1)":"none" }}>
              {t === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display:"grid", gap:10 }}>
          {tab === "signup" && <input value={name}  onChange={e=>setName(e.target.value)}  placeholder="Full name *" required style={aInp()} />}
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address *" type="email" required style={aInp()} />
          {tab === "signup" && <input value={mob_}  onChange={e=>setMob_(e.target.value)}  placeholder="Mobile number (optional)" type="tel" style={aInp()} />}
          <input value={pass}  onChange={e=>setPass(e.target.value)}  placeholder="Password *" type="password" required style={aInp()} />
          {err && <div style={{ fontSize:12.5, color:C.accent, background:`${C.accent}18`, border:`1px solid ${C.accent}30`, padding:"9px 12px", borderRadius:8 }}>{err}</div>}
          <button type="submit" disabled={busy} style={{ padding:"12px", borderRadius:9, border:"none", background:busy?C.border:C.accent, color:busy?C.sub:"#fff", fontWeight:700, fontSize:14.5, marginTop:2, boxShadow:busy?"none":`0 4px 18px ${C.accent}50` }}>
            {busy ? "Please wait…" : tab === "login" ? "Log in" : "Create account"}
          </button>
        </form>
        <p style={{ textAlign:"center", fontSize:12.5, color:C.mute, marginTop:14 }}>
          {tab === "login" ? "No account? " : "Already registered? "}
          <button onClick={() => { setTab(tab==="login"?"signup":"login"); setErr(""); }} style={{ background:"none", border:"none", color:C.accent, fontWeight:600, fontSize:12.5, cursor:"pointer" }}>
            {tab === "login" ? "Sign up free" : "Log in"}
          </button>
        </p>
      </div>
    </main>
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function Setup({ resume, setResume, jd, setJd, role, setRole, company, setCompany, industry, setIndustry, onStart }) {
  const mob = useIsMobile();
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [ratings,   setRatings]   = useState([]);
  const [showForm,  setShowForm]  = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const fileRef = useRef(null);
  const ready   = resume.trim().length > 40 && role.trim().length > 1;

  useEffect(() => {
    track("landing_viewed");
    fetch("/api/ratings").then(r=>r.json()).then(setRatings).catch(()=>{});
  }, []);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploadMsg(""); setResume("");
    if (file.type === "text/plain" || file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = ev => { setResume(ev.target.result); setUploadMsg("✓ Resume loaded"); };
      reader.readAsText(file); return;
    }
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      setUploading(true); setUploadMsg("Parsing PDF…");
      try {
        const fd = new FormData(); fd.append("resume", file);
        const res  = await fetch("/api/parse-resume", { method:"POST", body:fd });
        const data = await res.json();
        if (data.text) { setResume(data.text); setUploadMsg("✓ Resume loaded from PDF"); }
        else setUploadMsg("⚠ Could not read PDF — paste as text.");
      } catch { setUploadMsg("⚠ Upload failed — paste as text."); }
      setUploading(false); return;
    }
    setUploadMsg("⚠ Upload PDF or TXT only.");
  };

  const onFileInput  = e  => handleUpload(e.target.files[0]);
  const onDrop       = e  => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files[0]); };
  const onDragOver   = e  => { e.preventDefault(); setDragOver(true); };
  const onDragLeave  = () => setDragOver(false);

  const avg = ratings.length ? (ratings.reduce((s,r)=>s+r.rating,0)/ratings.length).toFixed(1) : null;

  return (
    <main>
      {/* ── Hero + Form (unified dark section) ── */}
      <section style={{ background:C.bg, borderBottom:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:mob?"40px 20px 48px":"72px 32px 64px", display:"grid", gridTemplateColumns:mob?"1fr":"1fr 1fr", gap:mob?40:56, alignItems:"flex-start" }}>

          {/* Left: headline */}
          <div style={{ paddingTop:mob?0:12 }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:`${C.accent}18`, border:`1px solid ${C.accent}35`, borderRadius:30, padding:"5px 14px", fontSize:12, fontWeight:600, color:C.accentLt, marginBottom:22, letterSpacing:".05em" }}>
              ✦ AI-powered · Real voice · Honest feedback
            </div>
            <h1 style={{ fontFamily:FD, fontSize:mob?34:52, lineHeight:1.07, fontWeight:600, letterSpacing:"-.03em", marginBottom:18, color:C.ink }}>
              The mock interview that<br />
              <span style={{ color:C.accent, fontStyle:"italic" }}>actually prepares you.</span>
            </h1>
            <p style={{ fontSize:mob?15:16.5, color:C.sub, lineHeight:1.72, marginBottom:32, fontWeight:300, maxWidth:440 }}>
              A seasoned Indian interviewer — real voice, sharp follow-ups, real pressure — powered by Claude. Then a scored, line-by-line report against your actual JD, with a stronger version of every answer.
            </p>

            {/* Trust strip */}
            <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginBottom:28 }}>
              {[["10K+","Interviews done"],["4.8★","Average rating"],["95%","Say it helped"]].map(([n,l]) => (
                <div key={l} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 18px", textAlign:"center", minWidth:90 }}>
                  <div style={{ fontFamily:FD, fontSize:22, fontWeight:600, color:C.ink }}>{n}</div>
                  <div style={{ fontSize:11.5, color:C.mute, marginTop:3 }}>{l}</div>
                </div>
              ))}
            </div>

            {/* Avatar trust line */}
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ display:"flex" }}>
                {["R","P","A","S","V"].map((l,i) => (
                  <div key={i} style={{ width:28, height:28, borderRadius:"50%", background:`hsl(${i*40+10},50%,35%)`, border:`2px solid ${C.bg}`, display:"grid", placeItems:"center", fontSize:11, fontWeight:700, color:"#fff", marginLeft:i>0?-8:0, zIndex:5-i }}>
                    {l}
                  </div>
                ))}
              </div>
              <span style={{ fontSize:13, color:C.sub }}>Trusted by 10,000+ candidates across India</span>
            </div>
          </div>

          {/* Right: REAL setup form card */}
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:18, padding:mob?"20px":"28px 28px", boxShadow:"0 12px 40px rgba(26,23,20,.1)" }}>
            <h2 style={{ fontFamily:FD, fontSize:18, fontWeight:600, marginBottom:20, color:C.ink }}>Set up your interview</h2>

            <div style={{ display:"grid", gap:14 }}>
              {/* Role */}
              <Fld label="🎯 Target role" req filled={role.trim().length > 0}>
                <input value={role} onChange={e=>setRole(e.target.value)} placeholder="e.g. Senior Financial Analyst" style={inp()} />
              </Fld>

              {/* Company + Industry */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Fld label="🏢 Company">
                  <input value={company} onChange={e=>setCompany(e.target.value)} placeholder="e.g. McKinsey…" style={inp()} />
                </Fld>
                <Fld label="📊 Industry">
                  <input value={industry} onChange={e=>setIndustry(e.target.value)} placeholder="e.g. FMCG…" style={inp()} />
                </Fld>
              </div>

              {/* JD */}
              <Fld label="📋 Job description" hint="Recommended">
                <textarea value={jd} onChange={e=>setJd(e.target.value)} placeholder="Paste the job description here…" style={{ ...inp(), minHeight:90, resize:"vertical", lineHeight:1.6 }} />
              </Fld>

              {/* Resume — drag-and-drop zone */}
              <Fld label="📄 Your resume" req filled={resume.trim().length > 40}>
                <div
                  onClick={() => fileRef.current.click()}
                  onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
                  style={{ border:`2px dashed ${dragOver ? C.accent : resume.trim().length > 40 ? C.green : C.border}`, borderRadius:10, padding:"14px 14px 10px", cursor:"pointer", transition:"border-color .2s", background:dragOver?`${C.accent}08`:C.surface2 }}
                >
                  <textarea
                    value={resume} onChange={e=>setResume(e.target.value)}
                    onClick={e=>e.stopPropagation()}
                    placeholder="Paste your resume here, or drag & drop a PDF / TXT file…"
                    style={{ ...inp(), border:"none", background:"transparent", minHeight:110, resize:"vertical", lineHeight:1.6, padding:0, width:"100%" }}
                  />
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, paddingTop:8, borderTop:`1px solid ${C.border}` }}>
                    <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display:"none" }} onChange={onFileInput} />
                    <button onClick={e=>{e.stopPropagation();fileRef.current.click();}} disabled={uploading} style={{ fontSize:12, padding:"5px 12px", borderRadius:7, border:`1px solid ${C.border}`, background:C.surface, color:C.sub, display:"flex", alignItems:"center", gap:5 }}>
                      {uploading ? "⏳ Parsing…" : "⬆ Upload PDF / TXT"}
                    </button>
                    {uploadMsg && <span style={{ fontSize:11.5, color:uploadMsg.startsWith("✓")?C.green:C.accent }}>{uploadMsg}</span>}
                    {!uploadMsg && <span style={{ fontSize:11.5, color:C.mute }}>or drag & drop</span>}
                  </div>
                </div>
              </Fld>

              {/* CTA */}
              <div style={{ marginTop:4 }}>
                <button disabled={!ready} onClick={onStart} style={{ width:"100%", padding:"13px", borderRadius:10, border:"none", background:ready?C.accent:C.surface2, color:ready?"#fff":C.mute, fontWeight:700, fontSize:15, cursor:ready?"pointer":"not-allowed", boxShadow:ready?`0 6px 24px ${C.accent}50`:"none", transition:"all .2s", letterSpacing:"-.01em" }}>
                  Begin interview →
                </button>
                {!ready && <p style={{ textAlign:"center", fontSize:12.5, color:C.mute, marginTop:8 }}>Add your resume and target role to begin.</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ maxWidth:1100, margin:"0 auto", padding:mob?"48px 20px":"64px 32px" }}>
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <p style={{ fontSize:12.5, color:C.accent, fontWeight:600, letterSpacing:".08em", textTransform:"uppercase", marginBottom:10 }}>The process</p>
          <h2 style={{ fontFamily:FD, fontSize:mob?24:30, fontWeight:600, letterSpacing:"-.025em" }}>How PrepLoop works</h2>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:mob?"1fr":"repeat(3,1fr)", gap:14 }}>
          {[
            { n:"01", icon:"📝", t:"Set the stage",    d:"Paste your resume and JD. Add the company and industry for sharper, more targeted questions.", col:"#3A6BB5" },
            { n:"02", icon:"🎙", t:"Live voice interview", d:"A senior Indian professional — real voice, follow-ups, pressure — interviews you in real time. Just speak.",col:C.accent },
            { n:"03", icon:"📊", t:"Honest scorecard", d:"Every answer scored against your JD. What worked, what to fix, and a stronger version of each answer.", col:C.green },
          ].map(({ n, icon, t, d, col }) => (
            <div key={n} style={{ position:"relative", background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 24px", overflow:"hidden" }}>
              <div style={{ position:"absolute", right:16, top:8, fontFamily:FD, fontSize:72, fontWeight:700, color:`${col}12`, lineHeight:1, userSelect:"none" }}>{n}</div>
              <div style={{ fontSize:28, marginBottom:14 }}>{icon}</div>
              <div style={{ fontSize:11.5, fontWeight:700, color:col, letterSpacing:".08em", marginBottom:8 }}>{n}</div>
              <h3 style={{ fontFamily:FD, fontSize:18, fontWeight:600, marginBottom:10, color:C.ink }}>{t}</h3>
              <p style={{ fontSize:13.5, color:C.sub, lineHeight:1.68 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ── */}
      {ratings.length > 0 && (
        <section style={{ borderTop:`1px solid ${C.border}`, padding:mob?"40px 20px":"56px 32px" }}>
          <div style={{ maxWidth:1100, margin:"0 auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:28, flexWrap:"wrap", gap:14 }}>
              <div>
                <p style={{ fontSize:12.5, color:C.accent, fontWeight:600, letterSpacing:".08em", textTransform:"uppercase", marginBottom:8 }}>Candidate reviews</p>
                <h2 style={{ fontFamily:FD, fontSize:mob?22:26, fontWeight:600, letterSpacing:"-.02em", marginBottom:6 }}>What candidates say</h2>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <Stars rating={parseFloat(avg)} size={14} />
                  <span style={{ fontSize:14, fontWeight:600, color:C.ink }}>{avg} / 5</span>
                  <span style={{ fontSize:13, color:C.mute }}>· {ratings.length} {ratings.length===1?"review":"reviews"}</span>
                </div>
              </div>
              <button onClick={()=>setShowForm(v=>!v)} style={gBtn()}>{showForm?"Close":"Write a review"}</button>
            </div>
            {showForm && <QuickReview onDone={r=>{setRatings([r,...ratings]);setShowForm(false);}} />}
            <div style={{ display:"grid", gridTemplateColumns:mob?"1fr":"repeat(auto-fill,minmax(290px,1fr))", gap:14 }}>
              {ratings.slice(0,6).map((r,i) => (
                <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:"18px 20px" }}>
                  <Stars rating={r.rating} size={13} />
                  {r.review && <p style={{ fontSize:13.5, lineHeight:1.68, color:C.sub, margin:"10px 0" }}>"{r.review}"</p>}
                  <div style={{ fontSize:12, color:C.mute }}><strong style={{ color:C.sub }}>{r.name}</strong>{r.role&&<> · {r.role}</>} · {r.date}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {ratings.length === 0 && (
        <section style={{ borderTop:`1px solid ${C.border}`, padding:mob?"32px 20px":"48px 32px" }}>
          <div style={{ maxWidth:1100, margin:"0 auto", textAlign:"center" }}>
            {!showForm ? (
              <div style={{ background:C.surface, border:`2px dashed ${C.border}`, borderRadius:16, padding:"32px 24px", maxWidth:480, margin:"0 auto" }}>
                <div style={{ fontSize:32, marginBottom:12 }}>⭐</div>
                <p style={{ color:C.sub, fontSize:14, marginBottom:16 }}>No reviews yet — be the first!</p>
                <button onClick={()=>setShowForm(true)} style={pBtn()}>Write a review</button>
              </div>
            ) : (
              <div style={{ maxWidth:560, margin:"0 auto" }}>
                <QuickReview onDone={r=>{setRatings([r]);setShowForm(false);}} />
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function QuickReview({ onDone }) {
  const [star,setStar]=useState(0);const [hover,setHover]=useState(0);
  const [name,setName]=useState("");const [role,setRole]=useState("");
  const [text,setText]=useState("");const [err,setErr]=useState("");const [done,setDone]=useState(false);
  const submit=async()=>{
    if(!star){setErr("Please pick a rating.");return;}
    try{await fetch("/api/ratings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,rating:star,review:text,role})});
    track("review_submitted", { rating: star, source: "homepage" });
    setDone(true);onDone({name:name||"Anonymous",rating:star,review:text,role,date:new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})});}
    catch{setErr("Submit failed — try again.");}
  };
  if(done)return<p style={{color:C.green,fontWeight:600,margin:"0 0 20px"}}>✓ Thank you for your review!</p>;
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"22px 22px",marginBottom:20}}>
      <div style={{display:"flex",gap:4,marginBottom:12}}>{[1,2,3,4,5].map(n=><span key={n} onClick={()=>setStar(n)} onMouseEnter={()=>setHover(n)} onMouseLeave={()=>setHover(0)} style={{fontSize:26,cursor:"pointer",color:n<=(hover||star)?C.gold:C.border}}>★</span>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={inp()}/>
        <input value={role} onChange={e=>setRole(e.target.value)} placeholder="Role practised for" style={inp()}/>
      </div>
      <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Share your experience…" style={{...inp(),minHeight:74,resize:"vertical",lineHeight:1.55,marginBottom:10}}/>
      {err&&<p style={{color:C.accent,fontSize:12.5,marginBottom:8}}>{err}</p>}
      <button onClick={submit} style={pBtn()}>Submit review</button>
    </div>
  );
}

// ── Interview ─────────────────────────────────────────────────────────────────
function Interview({ resume, jd, role, company, industry, onFinish, onFreshStart }) {
  const mob = useIsMobile();

  const [savedProgress] = useState(() => {
    try {
      const s = localStorage.getItem("pl_interview_progress");
      if (!s) return null;
      const d = JSON.parse(s);
      if (Date.now() - d.savedAt > 86400000) { localStorage.removeItem("pl_interview_progress"); return null; }
      return d;
    } catch { return null; }
  });

  const [showResume, setShowResume] = useState(!!savedProgress);
  const personaRef   = useRef(savedProgress ? savedProgress.persona : pickPersona());
  const p            = personaRef.current;
  const voiceRef     = useRef(null);
  const speechIdRef  = useRef(0);
  const accRef       = useRef("");
  const finalRef     = useRef("");
  const restartRef   = useRef(false);
  const phaseRef     = useRef("intro");
  const startedRef   = useRef(false);
  const recRef       = useRef(null);
  const recSessionRef = useRef(0); // guards against overlapping recognizers double-writing text

  const [history,      setHistory]      = useState(savedProgress ? savedProgress.history    : []);
  const [transcript,   setTranscript]   = useState(savedProgress ? savedProgress.transcript : []);
  const [phase,        setPhase]        = useState("intro");
  const [currentQ,     setCurrentQ]     = useState(savedProgress ? savedProgress.currentQ  : "");
  const [liveText,     setLiveText]     = useState("");
  const [editedAnswer, setEditedAnswer] = useState("");
  const [qCount,       setQCount]       = useState(savedProgress ? savedProgress.qCount    : 0);
  const [error,        setError]        = useState("");
  const SOFT_MAX = 15;

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const pick = () => { voiceRef.current = resolveVoice(p.gender); };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [p.gender]);

  const doSpeak = useCallback(makeSpeaker(voiceRef, speechIdRef, p.gender), [p.gender]);

  const saveProgress = useCallback((hist, trans, q, count) => {
    try {
      localStorage.setItem("pl_interview_progress", JSON.stringify({
        history:hist, transcript:trans, currentQ:q, qCount:count,
        persona:{ name:p.name, exp:p.exp, bg:p.bg, gender:p.gender },
        savedAt:Date.now(),
      }));
    } catch (_) {}
  }, [p]);

  const sys =
    `You are ${p.name}, a seasoned Indian professional with ${p.exp} years of experience in ${p.bg}. ` +
    `You speak clear, professional Indian English — warm, rigorous, senior. You are conducting a job interview.\n\n` +
    `ROLE: ${role}` + (company?`\nCOMPANY: ${company}`:"") + (industry?`\nINDUSTRY: ${industry}`:"") +
    `\n\nJOB DESCRIPTION:\n${(jd||"Not provided").slice(0,1200)}\n\nCANDIDATE RESUME:\n${resume.slice(0,1200)}\n\n` +
    `STEP 1 (internal): Identify 5–7 key assessment parameters for this role. Prioritise per JD.\n` +
    `STEP 2 RULES:\n- Open warmly and ask for a self-introduction.\n- For each parameter: 1 focused main question.\n` +
    `- Follow-ups: 0–2 per parameter MAX, never more regardless of answer quality.\n` +
    `- After all parameters are covered, close the interview warmly.\n` +
    `- NO markdown, bullets, or stage directions. ONE question per turn. 1–3 spoken sentences only.`;

  const getNext = useCallback(async (msgs) => {
    setPhase("thinking");
    try {
      const line = await callClaude(msgs, sys, 350);
      setCurrentQ(line);
      setHistory([...msgs, { role:"assistant", content:line }]);
      setPhase("asking");
      doSpeak(line, () => setPhase("ready"));
    } catch { setError("Connection issue — check your internet and refresh."); }
  }, [sys, doSpeak]);

  useEffect(() => {
    if (startedRef.current || showResume) return;
    startedRef.current = true;
    getNext([{ role:"user", content:"Please begin the interview now." }]);
  }, [getNext, showResume]);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError("Speech recognition requires Google Chrome on desktop."); return; }
    window.speechSynthesis.cancel();
    speechIdRef.current++;
    // accRef  = text BANKED from completed utterances (everything said so far, finalized)
    // finalRef = full current answer = banked + live utterance
    accRef.current = "";
    finalRef.current = "";
    restartRef.current = true;
    const session = ++recSessionRef.current;

    // SINGLE-UTTERANCE architecture (continuous=false):
    // Each recognizer captures ONE phrase, then ends. We bank its final text and
    // immediately start a fresh recognizer for the next phrase. Because every
    // recognizer's results array only ever holds the CURRENT phrase, the mobile
    // "replay" bug cannot duplicate earlier text, and laptop long-answers are kept
    // because each phrase is banked into accRef before the next recognizer starts.
    const createRec = () => {
      const rec = new SR();
      rec.continuous = false;        // <-- key change: one phrase per recognizer
      rec.interimResults = true;
      rec.lang = "en-IN";

      rec.onresult = (e) => {
        if (recSessionRef.current !== session) return; // ignore stale recognizer
        let utterFinal = "", interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) utterFinal += t + " ";
          else interim += t;
        }
        // Display = everything banked + the phrase currently being spoken.
        finalRef.current = (accRef.current + utterFinal).trim();
        setLiveText((accRef.current + utterFinal + interim).trim());
      };

      rec.onerror = () => {};

      rec.onend = () => {
        if (recSessionRef.current !== session) return;
        // Bank this phrase's finalized text, then start the next recognizer.
        accRef.current = finalRef.current ? finalRef.current + " " : accRef.current;
        if (restartRef.current && phaseRef.current === "listening") {
          try { const next = createRec(); recRef.current = next; next.start(); } catch (_) {}
        }
      };
      return rec;
    };

    const rec = createRec();
    recRef.current = rec;
    try { rec.start(); } catch (_) {}
    setLiveText(""); setPhase("listening");
  };

  const stopRecording = () => {
    restartRef.current = false;
    recSessionRef.current++;     // invalidate this session so no stale callback writes
    speechIdRef.current++;
    try { recRef.current?.stop(); } catch (_) {}
    // Use whichever is most complete: liveText includes any in-progress (interim) phrase
    const a = finalRef.current.trim();
    const b = liveText.trim();
    const answer = b.length > a.length ? b : a;
    if (!answer) { setPhase("ready"); return; }
    setEditedAnswer(answer); setLiveText(""); setPhase("editing");
  };

  const submitAnswer = async (answer) => {
    if (!answer.trim()) { setPhase("ready"); return; }
    const newT = [...transcript, { q:currentQ, a:answer }];
    setTranscript(newT); setEditedAnswer("");
    const n = qCount + 1; setQCount(n);
    const msgs = [...history, { role:"user", content:answer }];
    saveProgress(msgs, newT, currentQ, n);
    if (n >= SOFT_MAX) { await doClose(msgs, newT); return; }
    getNext(msgs);
  };

  const doClose = useCallback(async (msgs, finalTranscript) => {
    window.speechSynthesis.cancel();
    speechIdRef.current++;
    restartRef.current = false;
    try { recRef.current?.stop(); } catch (_) {}
    setPhase("closing");
    try {
      // FIX: explicit instruction to NOT ask questions in closing
      const closing = await callClaude(
        [...msgs, { role:"user", content:"Close the interview now. Say exactly 2 sentences only: (1) thank the candidate warmly by name, (2) tell them their feedback report is being prepared. Do NOT ask any questions. Do NOT mention any further topics." }],
        sys, 100
      );
      setCurrentQ(closing);
      doSpeak(closing, () => buildReport(finalTranscript));
    } catch { buildReport(finalTranscript); }
  }, [sys, doSpeak]);

  const buildReport = async (finalTranscript) => {
    setPhase("scoring");
    const qa = finalTranscript.map((t,i)=>`Q${i+1}: ${t.q}\nA${i+1}: ${t.a}`).join("\n\n");
    const rSys =
      `You are an expert interview coach. Role: "${role}"${company?` at ${company}`:""}.` +
      `\nJD: ${(jd||"Not provided").slice(0,600)}\nResume: ${resume.slice(0,600)}\n\n` +
      `Return ONLY valid JSON, no markdown, no extra text:\n` +
      `{"overall":<0-100>,"verdict":"<one punchy sentence>","strengths":["...","...","..."],"gaps":["...","...","..."],` +
      `"perQuestion":[{"question":"<short>","score":<0-10>,"good":"<what worked>","improve":"<specific fix>","modelAnswer":"<2-3 stronger sentences>"}]}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw   = await callClaude([{ role:"user", content:qa }], rSys, 3000);
        const clean = raw.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim();
        const s = clean.indexOf("{"); const e = clean.lastIndexOf("}");
        if (s===-1||e===-1) throw new Error("No JSON");
        const json = JSON.parse(clean.slice(s,e+1));
        onFinish(finalTranscript, json); return;
      } catch (err) { console.error(`Report attempt ${attempt+1}:`, err.message); }
    }
    reportError(new Error("Report generation failed after 2 attempts"), { role, questions: finalTranscript.length });
    track("report_generation_failed", { questions: finalTranscript.length });
    onFinish(finalTranscript, { overall:0, verdict:"Report could not be generated — please try another interview.", strengths:[], gaps:[], perQuestion:[] });
  };

  // Resume banner
  const handleResume = () => { setShowResume(false); startedRef.current = true; getNext(savedProgress.history); };
  const handleFresh  = () => { setShowResume(false); onFreshStart(); };

  if (showResume && savedProgress) {
    return (
      <main style={{ minHeight:"calc(100vh - 58px)", display:"grid", placeItems:"center", padding:"24px 16px" }}>
        <div className="rise" style={{ width:"100%", maxWidth:460, background:C.surface, border:`1px solid ${C.border}`, borderRadius:18, padding:mob?"28px 22px":"36px 36px", boxShadow:"0 12px 40px rgba(26,23,20,.1)", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:16 }}>💾</div>
          <h2 style={{ fontFamily:FD, fontSize:22, fontWeight:600, marginBottom:10 }}>Unfinished interview found</h2>
          <p style={{ color:C.sub, fontSize:14.5, lineHeight:1.68, marginBottom:8 }}>
            You completed <strong style={{ color:C.ink }}>{savedProgress.transcript.length} question{savedProgress.transcript.length!==1?"s":""}</strong> with <strong style={{ color:C.ink }}>{savedProgress.persona.name}</strong> before the session ended.
          </p>
          <p style={{ color:C.mute, fontSize:13.5, marginBottom:28 }}>Your answers are saved. Resume to continue from where you left off.</p>
          <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
            <button onClick={handleResume} style={pBtn()}>Resume interview →</button>
            <button onClick={handleFresh}  style={gBtn()}>Start fresh</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight:"calc(100vh - 58px)", maxWidth:680, margin:"0 auto", padding:mob?"32px 20px 60px":"52px 28px 80px", textAlign:"center" }}>

      {/* Interviewer badge */}
      {["asking","ready","listening","editing"].includes(phase) && currentQ && (
        <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:C.surface, border:`1px solid ${C.border}`, borderRadius:30, padding:"6px 14px 6px 8px", marginBottom:16 }}>
          <div style={{ width:24, height:24, borderRadius:"50%", background:C.accent, display:"grid", placeItems:"center", fontSize:12, fontWeight:700, color:"#fff" }}>
            {p.gender==="female"?"👩":"👨"}
          </div>
          <span style={{ fontSize:12.5, color:C.sub }}><strong style={{ color:C.ink }}>{p.name}</strong> · {p.exp} yrs</span>
        </div>
      )}

      <div style={{ fontSize:12, color:C.mute, letterSpacing:".04em", marginBottom:20 }}>
        {["scoring","closing"].includes(phase) ? "Wrapping up your interview…" : `QUESTION ${qCount+1}`}
      </div>

      <Orb phase={phase} gender={p.gender} />
      <LoadingBar phase={phase} />

      {phase !== "scoring" && (
        <div className="rise" key={currentQ} style={{ fontFamily:FD, fontSize:mob?20:24, lineHeight:1.45, fontWeight:500, margin:"22px auto 0", maxWidth:520, minHeight:72, letterSpacing:"-.01em", color:C.ink }}>
          {phase==="thinking" ? <span style={{ color:C.mute }}>…</span> : currentQ}
        </div>
      )}

      {phase === "listening" && (
        <div style={{ marginTop:20, background:C.surface, border:`1px solid ${C.accent}40`, borderRadius:12, padding:"14px 18px", fontSize:15, textAlign:"left", minHeight:60, lineHeight:1.68, color:C.ink }}>
          {liveText || <span style={{ color:C.mute }}>Listening… speak your answer.</span>}
        </div>
      )}

      {phase === "editing" && (
        <div style={{ marginTop:18, textAlign:"left" }}>
          <p style={{ fontSize:12.5, color:C.mute, marginBottom:7 }}>Review or edit before submitting:</p>
          <textarea value={editedAnswer} onChange={e=>setEditedAnswer(e.target.value)} style={{ ...inp(), width:"100%", minHeight:110, resize:"vertical", lineHeight:1.68 }} />
          <div style={{ display:"flex", gap:10, marginTop:10, flexWrap:"wrap" }}>
            <button onClick={()=>submitAnswer(editedAnswer)} style={pBtn()}>Submit answer →</button>
            <button onClick={()=>{ setEditedAnswer(""); setPhase("ready"); }} style={gBtn()}>Re-record</button>
          </div>
        </div>
      )}

      {!["editing","scoring","closing"].includes(phase) && (
        <div style={{ marginTop:26, display:"flex", justifyContent:"center", gap:10, flexWrap:"wrap" }}>
          {/* Answer now is available in BOTH ready and asking, so the user is never stuck waiting for audio */}
          {(phase==="ready" || phase==="asking") && (
            <button onClick={() => { speechIdRef.current++; window.speechSynthesis.cancel(); startListening(); }} style={pBtn()}>
              🎤 Answer now
            </button>
          )}
          {phase==="listening" && <button onClick={stopRecording}  style={{ ...pBtn(), background:C.green, boxShadow:`0 4px 18px ${C.green}50` }}>✓ Done answering</button>}
          {phase==="asking"    && (
            <button
              onClick={() => { speechIdRef.current++; window.speechSynthesis.cancel(); setPhase("ready"); }}
              style={gBtn()}>Skip audio →</button>
          )}
          {["ready","asking"].includes(phase) && qCount >= 3 && (
            <button onClick={() => doClose(history, transcript)} style={{ ...gBtn(), color:C.accent, borderColor:`${C.accent}50` }}>
              Finish interview
            </button>
          )}
        </div>
      )}

      {error && <div style={{ marginTop:20, color:C.accent, fontSize:13.5, background:`${C.accent}18`, border:`1px solid ${C.accent}30`, padding:"12px 16px", borderRadius:10 }}>{error}</div>}
      {!["editing","scoring","closing"].includes(phase) && (
        <p style={{ fontSize:12.5, color:C.mute, maxWidth:380, margin:"28px auto 0", lineHeight:1.7 }}>
          Speak naturally. Tap "Done" when finished, then review before submitting.
        </p>
      )}
    </main>
  );
}

// ── Loading bar ───────────────────────────────────────────────────────────────
function LoadingBar({ phase }) {
  const [elapsed, setElapsed] = useState(0);
  const [pct, setPct]         = useState(0);
  useEffect(() => {
    setElapsed(0); setPct(0);
    if (!["scoring","thinking","closing"].includes(phase)) return;
    const t = setInterval(() => { setElapsed(e=>e+1); if (phase==="scoring") setPct(p=>p+(90-p)*0.04); }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  if (phase === "scoring") return (
    <div style={{ maxWidth:360, margin:"18px auto 0" }}>
      <p style={{ fontSize:13, color:C.sub, marginBottom:10 }}>
        {elapsed<8?"Reading your answers…":elapsed<18?"Matching against the JD…":elapsed<28?"Preparing your report…":"Almost done…"}
      </p>
      <div style={{ height:3, background:C.border, borderRadius:2 }}>
        <div style={{ height:"100%", background:C.accent, borderRadius:2, width:`${pct}%`, transition:"width 1s ease-out" }} />
      </div>
      <p style={{ fontSize:11, color:C.mute, marginTop:5, textAlign:"right" }}>{elapsed}s</p>
    </div>
  );
  if (["thinking","closing"].includes(phase)) return (
    <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:18 }}>
      {[0,1,2].map(i=><div key={i} style={{ width:7, height:7, borderRadius:"50%", background:C.accent, animation:`dot 1.4s ease-in-out ${i*0.18}s infinite` }}/>)}
    </div>
  );
  return null;
}

// ── Orb ───────────────────────────────────────────────────────────────────────
function Orb({ phase, gender }) {
  const listening = phase==="listening", speaking = phase==="asking";
  const color = listening ? C.green : C.accent;
  return (
    <div style={{ position:"relative", width:100, height:100, margin:"0 auto" }}>
      {(listening||speaking) && (<><span style={{ position:"absolute",inset:0,borderRadius:"50%",border:`2px solid ${color}`,animation:"ring 1.9s ease-out 0s infinite" }}/><span style={{ position:"absolute",inset:0,borderRadius:"50%",border:`2px solid ${color}`,animation:"ring 1.9s ease-out .7s infinite" }}/></>)}
      <div style={{ position:"absolute",inset:0,borderRadius:"50%",background:`radial-gradient(circle at 33% 28%, ${color}, ${listening?"#155228":C.accentLt})`,display:"grid",placeItems:"center",animation:speaking?"pulse 1.3s ease-in-out infinite":"none",boxShadow:`0 10px 28px ${color}55` }}>
        {listening?(
          <div style={{ display:"flex",gap:3,alignItems:"center",height:24 }}>
            {[0,.18,.36,.12].map((d,i)=><span key={i} style={{ width:3.5,background:"#fff",borderRadius:3,animation:`bar .9s ease-in-out ${d}s infinite` }}/>)}
          </div>
        ):<span style={{ fontSize:30 }}>{speaking?(gender==="female"?"👩‍💼":"👨‍💼"):["scoring","closing"].includes(phase)?"📋":"🎙"}</span>}
      </div>
    </div>
  );
}

// ── Report ────────────────────────────────────────────────────────────────────
function Report({ transcript, report, role, onRestart }) {
  const mob    = useIsMobile();
  const topRef = useRef(null);
  const r      = report || {};
  const score  = r.overall || 0;
  const band   = score>=80?["Strong",C.green]:score>=60?["Promising",C.gold]:score>=1?["Needs work",C.accent]:["—",C.mute];

  const [star,setStar]=useState(0);const [hover,setHover]=useState(0);
  const [name,setName]=useState("");const [rev,setRev]=useState("");
  const [done,setDone]=useState(false);const [skip,setSkip]=useState(false);const [err,setErr]=useState("");

  const submitRating=async()=>{
    if(!star){setErr("Please select a rating.");return;}
    try{await fetch("/api/ratings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,rating:star,review:rev,role})});
    track("review_submitted", { rating: star, source: "report" });
    setDone(true);setTimeout(()=>topRef.current?.scrollIntoView({behavior:"smooth"}),300);}
    catch{setErr("Could not submit — try again.");}
  };

  return(
    <main ref={topRef} style={{ maxWidth:820, margin:"0 auto", padding:mob?"28px 20px 60px":"44px 32px 80px" }}>

      {/* Score card */}
      <div className="rise" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:18, padding:mob?"22px 20px":"32px 36px", display:"flex", gap:24, alignItems:"center", flexWrap:"wrap", boxShadow:"0 6px 24px rgba(26,23,20,.08)" }}>
        <div style={{ position:"relative", width:100, height:100, flexShrink:0 }}>
          <svg width="100" height="100" style={{ transform:"rotate(-90deg)" }}>
            <circle cx="50" cy="50" r="43" fill="none" stroke={C.border} strokeWidth="8"/>
            <circle cx="50" cy="50" r="43" fill="none" stroke={band[1]} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={2*Math.PI*43} strokeDashoffset={2*Math.PI*43*(1-score/100)}/>
          </svg>
          <div style={{ position:"absolute",inset:0,display:"grid",placeItems:"center" }}>
            <div style={{ fontFamily:FD,fontSize:28,fontWeight:600,color:C.ink }}>{score}</div>
          </div>
        </div>
        <div style={{ flex:1, minWidth:200 }}>
          <div style={{ color:band[1],fontWeight:700,fontSize:11,letterSpacing:".1em",textTransform:"uppercase",marginBottom:8 }}>{band[0]}</div>
          <h2 style={{ fontFamily:FD,fontSize:mob?19:24,lineHeight:1.3,fontWeight:600,marginBottom:6 }}>{r.verdict||"Your interview report"}</h2>
          <p style={{ color:C.mute,fontSize:13 }}>{role}</p>
        </div>
      </div>

      {/* Strengths + Gaps */}
      <div className="rise" style={{ display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:12,marginTop:14,animationDelay:".06s" }}>
        <Panel title="What worked"           color={C.green}  items={r.strengths}/>
        <Panel title="Where you lost points" color={C.accent} items={r.gaps}/>
      </div>

      <h3 className="rise" style={{ fontFamily:FD,fontSize:mob?19:22,fontWeight:600,letterSpacing:"-.02em",margin:"32px 0 12px" }}>Question by question</h3>
      <div style={{ display:"grid",gap:10 }}>
        {(r.perQuestion||[]).map((q,i)=>(
          <div key={i} className="rise" style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:13,padding:mob?"16px":"20px 22px",animationDelay:`${.04*i}s` }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12 }}>
              <p style={{ margin:0,fontWeight:600,fontSize:14.5,flex:1,lineHeight:1.45,color:C.ink }}>{q.question}</p>
              <span style={{ flexShrink:0,fontFamily:FD,fontWeight:700,fontSize:14,color:q.score>=7?C.green:q.score>=4?C.gold:C.accent,border:`1px solid ${C.border}`,borderRadius:7,padding:"2px 9px" }}>{q.score}/10</span>
            </div>
            {q.good    && <FL label="Good" color={C.green}  text={q.good}/>}
            {q.improve && <FL label="Fix"  color={C.accent} text={q.improve}/>}
            {q.modelAnswer&&(
              <div style={{ marginTop:10,background:C.surface2,borderRadius:9,padding:"10px 14px",borderLeft:`3px solid ${C.gold}` }}>
                <span style={{ fontSize:10.5,fontWeight:700,letterSpacing:".07em",color:C.gold,textTransform:"uppercase" }}>Stronger answer</span>
                <p style={{ margin:"4px 0 0",fontSize:13.5,lineHeight:1.65,color:C.sub }}>{q.modelAnswer}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop:28,display:"flex",gap:10 }}>
        <button onClick={onRestart} style={pBtn()}>Run another interview</button>
      </div>

      {/* Rating */}
      <div style={{ height:1,background:C.border,margin:"48px 0 0" }}/>
      <div style={{ marginTop:36 }}>
        <h3 style={{ fontFamily:FD,fontSize:mob?19:21,fontWeight:600,letterSpacing:"-.02em",marginBottom:5 }}>How was your experience?</h3>
        <p style={{ color:C.mute,fontSize:13.5,marginBottom:22 }}>Your review appears publicly on the homepage.</p>
        {skip?<p style={{ fontSize:13.5,color:C.mute }}>No worries — you can leave a review from the homepage anytime.</p>
        :done?<p style={{ color:C.green,fontWeight:600,fontSize:15 }}>✓ Thank you! Your review is live on the homepage.</p>
        :(
          <div style={{ display:"grid",gap:12 }}>
            <div style={{ display:"flex",gap:5 }}>{[1,2,3,4,5].map(n=><span key={n} onClick={()=>setStar(n)} onMouseEnter={()=>setHover(n)} onMouseLeave={()=>setHover(0)} style={{ fontSize:34,cursor:"pointer",color:n<=(hover||star)?C.gold:C.border,transition:"color .1s" }}>★</span>)}</div>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name (optional)" style={{ ...inp(),maxWidth:300 }}/>
            <textarea value={rev} onChange={e=>setRev(e.target.value)} placeholder="Share your experience…" style={{ ...inp(),minHeight:86,resize:"vertical",lineHeight:1.6 }}/>
            {err&&<p style={{ color:C.accent,fontSize:13 }}>{err}</p>}
            <div style={{ display:"flex",gap:10 }}>
              <button onClick={submitRating} style={pBtn()}>Submit review</button>
              <button onClick={()=>setSkip(true)} style={gBtn()}>Skip</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ── Stars, Panel, FL, Fld ─────────────────────────────────────────────────────
function Stars({ rating, size=14 }) {
  return <span style={{ display:"inline-flex",gap:2 }}>{[1,2,3,4,5].map(n=><span key={n} style={{ fontSize:size,color:n<=Math.round(rating)?C.gold:C.border }}>★</span>)}</span>;
}
function Panel({ title, color, items }) {
  return(
    <div style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:13,padding:"17px 18px" }}>
      <h4 style={{ margin:"0 0 9px",fontSize:11.5,fontWeight:700,letterSpacing:".07em",textTransform:"uppercase",color }}>{title}</h4>
      <ul style={{ margin:0,paddingLeft:16,display:"grid",gap:7 }}>
        {(items||[]).map((s,i)=><li key={i} style={{ fontSize:13.5,lineHeight:1.65,color:C.sub }}>{s}</li>)}
        {(!items||!items.length)&&<li style={{ color:C.mute,fontSize:13 }}>—</li>}
      </ul>
    </div>
  );
}
function FL({ label, color, text }) {
  return <p style={{ margin:"8px 0 0",fontSize:13.5,lineHeight:1.6,color:C.sub }}><span style={{ fontWeight:700,color,fontSize:11,letterSpacing:".05em" }}>{label} · </span>{text}</p>;
}
function Fld({ label, hint, req, filled, children }) {
  return(
    <label style={{ display:"block" }}>
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5,alignItems:"center" }}>
        <span style={{ fontWeight:600,fontSize:13,color:C.sub,display:"flex",alignItems:"center",gap:6 }}>
          {label}
          {req && filled && <span style={{ color:C.green,fontSize:12 }}>✓</span>}
        </span>
        {hint&&<span style={{ fontSize:11.5,color:C.mute }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Foot() {
  const mob = useIsMobile();
  return(
    <footer style={{ borderTop:`1px solid ${C.border}`,background:C.surface,padding:mob?"36px 20px 24px":"48px 32px 28px" }}>
      <div style={{ maxWidth:1100,margin:"0 auto" }}>
        <div style={{ display:"grid",gridTemplateColumns:mob?"1fr":"2fr 1fr 1fr",gap:mob?32:48,marginBottom:36 }}>
          <div>
            <div style={{ display:"flex",alignItems:"center",gap:9,marginBottom:14 }}>
              <div style={{ width:30,height:30,borderRadius:8,background:C.accent,display:"grid",placeItems:"center",color:"#fff",fontFamily:FD,fontWeight:700,fontSize:17 }}>P</div>
              <span style={{ fontFamily:FD,fontWeight:600,fontSize:18,letterSpacing:"-.02em",color:C.ink }}>PrepLoop</span>
            </div>
            <p style={{ color:C.mute,fontSize:13.5,lineHeight:1.7,maxWidth:260 }}>AI-powered mock interviews built for India's professionals. Walk in ready.</p>
          </div>
          <div>
            <h4 style={{ fontSize:12,fontWeight:700,letterSpacing:".07em",textTransform:"uppercase",color:C.mute,marginBottom:14 }}>Product</h4>
            {["How it works","Reviews","Privacy"].map(l=><div key={l} style={{ marginBottom:9 }}><a href="#" style={{ fontSize:14,color:C.sub }}>{l}</a></div>)}
          </div>
          <div>
            <h4 style={{ fontSize:12,fontWeight:700,letterSpacing:".07em",textTransform:"uppercase",color:C.mute,marginBottom:14 }}>Company</h4>
            {["About","Contact"].map(l=><div key={l} style={{ marginBottom:9 }}><a href="#" style={{ fontSize:14,color:C.sub }}>{l}</a></div>)}
          </div>
        </div>
        <div style={{ borderTop:`1px solid ${C.border}`,paddingTop:20,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10 }}>
          <span style={{ fontSize:12.5,color:C.mute }}>© 2026 PrepLoop. All rights reserved.</span>
          <span style={{ fontSize:12.5,color:C.mute }}>Built for India's professionals</span>
        </div>
      </div>
    </footer>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function inp() { return { width:"100%",fontFamily:FB,fontSize:14,color:C.ink,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 13px",outline:"none",transition:"border-color .15s" }; }
function aInp() { return { ...inp(),fontSize:14.5,padding:"11px 14px",borderRadius:10 }; }
function pBtn() { return { fontFamily:FB,fontWeight:700,fontSize:14.5,letterSpacing:"-.01em",padding:"12px 26px",borderRadius:9,border:"none",background:C.accent,color:"#fff",boxShadow:`0 4px 16px ${C.accent}45`,cursor:"pointer" }; }
function gBtn() { return { fontFamily:FB,fontWeight:500,fontSize:13.5,padding:"10px 20px",borderRadius:9,border:`1px solid ${C.border}`,background:"transparent",color:C.sub,cursor:"pointer" }; }
