import React, { useState, useRef, useEffect, useCallback } from "react";

const BRAND = {
  ink: "#16140f",
  paper: "#f4f0e6",
  card: "#fbf9f3",
  accent: "#c2502e",
  accentDeep: "#9c3d20",
  gold: "#b8923f",
  line: "#d9d2c2",
  mute: "#6f6857",
  green: "#3f7d4f",
};

const FONT_DISPLAY = `'Fraunces', Georgia, serif`;
const FONT_BODY = `'Spline Sans', system-ui, sans-serif`;

function useFonts() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Spline+Sans:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
    return () => { try { document.head.removeChild(l); } catch (e) {} };
  }, []);
}

// Calls our secure backend, which forwards to Anthropic with the API key
async function callClaude(messages, system, maxTokens = 1200) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function speak(text, onEnd) {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const pref =
      voices.find((v) => /Google UK English Female|Samantha|Microsoft Aria/i.test(v.name)) ||
      voices.find((v) => /en-US|en-GB/i.test(v.lang));
    if (pref) u.voice = pref;
    if (onEnd) u.onend = onEnd;
    window.speechSynthesis.speak(u);
  } catch (e) { if (onEnd) onEnd(); }
}

export default function InterviewPlatform() {
  useFonts();
  const [stage, setStage] = useState("setup");
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [role, setRole] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [report, setReport] = useState(null);

  return (
    <div style={{
      fontFamily: FONT_BODY, color: BRAND.ink, background: BRAND.paper,
      minHeight: "100vh", width: "100%",
    }}>
      <style>{`
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        ::selection { background:${BRAND.accent}; color:#fff; }
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:.9} 50%{transform:scale(1.18);opacity:1} }
        @keyframes ring { 0%{transform:scale(.8);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
        @keyframes rise { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes bar { 0%,100%{height:6px} 50%{height:22px} }
        .rise{animation:rise .6s cubic-bezier(.2,.7,.3,1) both}
      `}</style>
      <Header stage={stage} />
      {stage === "setup" && (
        <Setup
          resume={resume} setResume={setResume}
          jd={jd} setJd={setJd} role={role} setRole={setRole}
          onStart={() => setStage("interview")}
        />
      )}
      {stage === "interview" && (
        <Interview
          resume={resume} jd={jd} role={role}
          onFinish={(t, r) => { setTranscript(t); setReport(r); setStage("report"); }}
        />
      )}
      {stage === "report" && (
        <Report transcript={transcript} report={report} role={role}
          onRestart={() => { setStage("setup"); setTranscript([]); setReport(null); }} />
      )}
      <Footer />
    </div>
  );
}

function Header({ stage }) {
  const steps = ["Setup", "Interview", "Report"];
  const idx = { setup: 0, interview: 1, report: 2 }[stage];
  return (
    <header style={{
      borderBottom: `1px solid ${BRAND.line}`, padding: "18px 24px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      position: "sticky", top: 0, background: "rgba(244,240,230,.85)",
      backdropFilter: "blur(10px)", zIndex: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, background: BRAND.accent,
          display: "grid", placeItems: "center", color: "#fff",
          fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18,
        }}>P</div>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 20, letterSpacing: "-.02em" }}>
          PrepLoop
        </span>
      </div>
      <div style={{ display: "flex", gap: 18, fontSize: 13, color: BRAND.mute }}>
        {steps.map((s, i) => (
          <span key={s} style={{
            display: "flex", alignItems: "center", gap: 6,
            color: i === idx ? BRAND.accent : i < idx ? BRAND.ink : BRAND.mute,
            fontWeight: i === idx ? 600 : 500,
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%", fontSize: 11,
              display: "grid", placeItems: "center",
              border: `1px solid ${i <= idx ? BRAND.accent : BRAND.line}`,
              background: i < idx ? BRAND.accent : "transparent",
              color: i < idx ? "#fff" : "inherit",
            }}>{i < idx ? "✓" : i + 1}</span>
            {s}
          </span>
        ))}
      </div>
    </header>
  );
}

function Setup({ resume, setResume, jd, setJd, role, setRole, onStart }) {
  const ready = resume.trim().length > 40 && jd.trim().length > 40;
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px 80px" }}>
      <div className="rise" style={{ maxWidth: 640 }}>
        <p style={{ color: BRAND.accent, fontWeight: 600, fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase", margin: 0 }}>
          Mock interview · powered by AI
        </p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 46, lineHeight: 1.05, letterSpacing: "-.03em", margin: "12px 0 14px", fontWeight: 600 }}>
          Walk in already<br /><span style={{ color: BRAND.accent, fontStyle: "italic" }}>having done it.</span>
        </h1>
        <p style={{ fontSize: 17, color: BRAND.mute, lineHeight: 1.5, margin: 0 }}>
          Paste your resume and the job description. A real interviewer voice takes you through
          a full session — questions, follow-ups, the works — then hands you an honest, line-by-line report.
        </p>
      </div>

      <div className="rise" style={{ marginTop: 36, display: "grid", gap: 18, animationDelay: ".08s" }}>
        <Field label="Target role" hint="e.g. Senior Financial Analyst">
          <input value={role} onChange={(e) => setRole(e.target.value)}
            placeholder="What role are you interviewing for?"
            style={inputStyle()} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Field label="Your resume" hint="Paste the text of your CV">
            <textarea value={resume} onChange={(e) => setResume(e.target.value)}
              placeholder="Paste your full resume here…"
              style={{ ...inputStyle(), minHeight: 220, resize: "vertical", lineHeight: 1.5 }} />
          </Field>
          <Field label="Job description" hint="Paste the JD you're applying to">
            <textarea value={jd} onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the job description here…"
              style={{ ...inputStyle(), minHeight: 220, resize: "vertical", lineHeight: 1.5 }} />
          </Field>
        </div>
      </div>

      <div className="rise" style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 16, animationDelay: ".16s" }}>
        <button disabled={!ready} onClick={onStart}
          style={{
            fontFamily: FONT_BODY, fontWeight: 600, fontSize: 16,
            padding: "15px 30px", borderRadius: 12, border: "none",
            background: ready ? BRAND.accent : BRAND.line,
            color: ready ? "#fff" : BRAND.mute, cursor: ready ? "pointer" : "not-allowed",
            boxShadow: ready ? `0 10px 24px -8px ${BRAND.accent}` : "none",
            transition: "all .2s",
          }}>
          Begin interview →
        </button>
        <span style={{ fontSize: 13, color: BRAND.mute }}>
          {ready ? "Find a quiet spot. We'll use your microphone." : "Add your resume and the JD to continue."}
        </span>
      </div>

      <div className="rise" style={{ marginTop: 56, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, animationDelay: ".24s" }}>
        {[
          ["Speaks to you", "A voice asks each question out loud — answer naturally, hands-free."],
          ["Reads the room", "Follow-ups are decided live from what you actually said."],
          ["Tells you straight", "An honest report, scored against the JD and your resume."],
        ].map(([t, d]) => (
          <div key={t} style={{
            background: BRAND.card, border: `1px solid ${BRAND.line}`,
            borderRadius: 14, padding: 20,
          }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, margin: "0 0 6px", fontWeight: 600 }}>{t}</h3>
            <p style={{ margin: 0, fontSize: 14, color: BRAND.mute, lineHeight: 1.5 }}>{d}</p>
          </div>
        ))}
      </div>
    </main>
  );
}

function Interview({ resume, jd, role, onFinish }) {
  const [history, setHistory] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [phase, setPhase] = useState("intro");
  const [currentQ, setCurrentQ] = useState("");
  const [liveText, setLiveText] = useState("");
  const [qCount, setQCount] = useState(0);
  const [error, setError] = useState("");
  const recRef = useRef(null);
  const finalRef = useRef("");
  const startedRef = useRef(false);
  const MAX_Q = 6;

  const systemPrompt =
    `You are an experienced, warm but rigorous hiring interviewer with 25+ years in the candidate's field. ` +
    `You are interviewing for this role: "${role || "the role"}".\n\n` +
    `JOB DESCRIPTION:\n${jd}\n\nCANDIDATE RESUME:\n${resume}\n\n` +
    `Conduct a realistic spoken interview. Rules:\n` +
    `- Ask ONE question at a time. Keep each turn to 1-3 sentences, conversational, as if spoken aloud.\n` +
    `- Start by briefly introducing yourself and asking the candidate to introduce themselves.\n` +
    `- Probe based on their previous answer AND gaps between resume and JD. Ask natural follow-ups.\n` +
    `- Do NOT give feedback during the interview. Just interview.\n` +
    `- Never use markdown, lists, or stage directions. Output only what you would say out loud.`;

  const getNext = useCallback(async (msgs) => {
    setPhase("thinking");
    try {
      const line = await callClaude(msgs, systemPrompt, 300);
      setCurrentQ(line);
      setHistory([...msgs, { role: "assistant", content: line }]);
      setPhase("asking");
      speak(line, () => setPhase("ready"));
    } catch (e) {
      setError("Connection issue. Check that your backend server is running and your API key is set.");
    }
  }, [systemPrompt]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    getNext([{ role: "user", content: "Please begin the interview now." }]);
  }, [getNext]);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError("Your browser doesn't support speech recognition. Use Chrome on desktop."); return; }
    window.speechSynthesis.cancel();
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    finalRef.current = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += t + " ";
        else interim += t;
      }
      setLiveText(finalRef.current + interim);
    };
    rec.onerror = () => {};
    rec.onend = () => {};
    recRef.current = rec;
    rec.start();
    setLiveText("");
    setPhase("listening");
  };

  const stopAndSubmit = async () => {
    if (recRef.current) recRef.current.stop();
    const answer = (finalRef.current || liveText).trim();
    if (!answer) { setPhase("ready"); return; }
    const newTranscript = [...transcript, { q: currentQ, a: answer }];
    setTranscript(newTranscript);
    setLiveText("");
    const nextCount = qCount + 1;
    setQCount(nextCount);
    const msgs = [...history, { role: "user", content: answer }];

    if (nextCount >= MAX_Q) {
      setPhase("closing");
      const closing = await callClaude(
        [...msgs, { role: "user", content: "Now professionally close the interview in 2 sentences, thanking the candidate and telling them they'll receive feedback shortly." }],
        systemPrompt, 150
      ).catch(() => "Thank you for your time today — that's all the questions I have. You'll get your detailed feedback in just a moment.");
      setCurrentQ(closing);
      speak(closing, () => buildReport(newTranscript));
      return;
    }
    getNext(msgs);
  };

  const buildReport = async (finalTranscript) => {
    setPhase("scoring");
    const qa = finalTranscript.map((t, i) => `Q${i + 1}: ${t.q}\nA${i + 1}: ${t.a}`).join("\n\n");
    const sys =
      `You are an elite interview coach. Evaluate this candidate's mock interview for the role "${role}". ` +
      `Score strictly and helpfully against the JOB DESCRIPTION and their RESUME.\n\n` +
      `JD:\n${jd}\n\nRESUME:\n${resume}\n\n` +
      `Return ONLY valid JSON, no markdown, with this exact shape:\n` +
      `{"overall":<0-100 int>,"verdict":"<one punchy sentence>","strengths":["..."],"gaps":["..."],` +
      `"perQuestion":[{"question":"<short>","score":<0-10>,"good":"<what worked>","improve":"<specific fix, reference JD/resume>","modelAnswer":"<2-3 sentence stronger version>"}]}`;
    try {
      const raw = await callClaude([{ role: "user", content: qa }], sys, 2500);
      const clean = raw.replace(/```json|```/g, "").trim();
      const json = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
      onFinish(finalTranscript, json);
    } catch (e) {
      onFinish(finalTranscript, {
        overall: 0, verdict: "We couldn't generate the report this time — please retry.",
        strengths: [], gaps: [], perQuestion: [],
      });
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 80px", textAlign: "center" }}>
      <div style={{ fontSize: 13, color: BRAND.mute, marginBottom: 8 }}>
        {phase === "scoring" || phase === "closing"
          ? "Wrapping up"
          : `Question ${Math.min(qCount + 1, MAX_Q)} of ${MAX_Q}`}
      </div>

      <Orb phase={phase} />

      <div className="rise" key={currentQ} style={{
        fontFamily: FONT_DISPLAY, fontSize: 26, lineHeight: 1.3, fontWeight: 500,
        margin: "26px auto 0", maxWidth: 600, minHeight: 90, letterSpacing: "-.01em",
      }}>
        {phase === "thinking" ? <span style={{ color: BRAND.mute }}>…</span>
          : phase === "scoring" ? "Scoring your interview against the job description…"
          : currentQ}
      </div>

      {phase === "listening" && (
        <div style={{
          marginTop: 22, background: BRAND.card, border: `1px solid ${BRAND.line}`,
          borderRadius: 14, padding: 16, fontSize: 16, color: BRAND.ink, textAlign: "left",
          minHeight: 60, lineHeight: 1.5,
        }}>
          {liveText || <span style={{ color: BRAND.mute }}>Listening… speak your answer.</span>}
        </div>
      )}

      <div style={{ marginTop: 30, display: "flex", justifyContent: "center", gap: 12 }}>
        {phase === "ready" && (
          <button onClick={startListening} style={primaryBtn()}>
            🎤 Answer now
          </button>
        )}
        {phase === "listening" && (
          <button onClick={stopAndSubmit} style={{ ...primaryBtn(), background: BRAND.green }}>
            ✓ Done answering
          </button>
        )}
        {phase === "asking" && (
          <button onClick={() => { window.speechSynthesis.cancel(); setPhase("ready"); }} style={ghostBtn()}>
            Skip audio →
          </button>
        )}
      </div>

      {error && (
        <p style={{ marginTop: 24, color: BRAND.accentDeep, fontSize: 14, background: "#f7e3dc", padding: "12px 16px", borderRadius: 10 }}>
          {error}
        </p>
      )}

      <p style={{ marginTop: 40, fontSize: 12.5, color: BRAND.mute, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
        Tip: answer out loud as you would in a real interview. The interviewer listens until you tap "Done."
      </p>
    </main>
  );
}

function Orb({ phase }) {
  const listening = phase === "listening";
  const speaking = phase === "asking";
  const color = listening ? BRAND.green : BRAND.accent;
  return (
    <div style={{ position: "relative", width: 120, height: 120, margin: "10px auto 0" }}>
      {(listening || speaking) && (
        <>
          <span style={ringStyle(color, 0)} />
          <span style={ringStyle(color, .6)} />
        </>
      )}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, ${color}, ${listening ? "#2c5c39" : BRAND.accentDeep})`,
        display: "grid", placeItems: "center",
        animation: speaking ? "pulse 1.2s ease-in-out infinite" : "none",
        boxShadow: `0 16px 40px -10px ${color}`,
      }}>
        {listening ? (
          <div style={{ display: "flex", gap: 4, alignItems: "center", height: 30 }}>
            {[0, .2, .4, .15].map((d, i) => (
              <span key={i} style={{ width: 5, background: "#fff", borderRadius: 3, animation: `bar 1s ease-in-out ${d}s infinite` }} />
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 38 }}>{speaking ? "🗣" : phase === "scoring" || phase === "closing" ? "📋" : "🎙"}</span>
        )}
      </div>
    </div>
  );
}

function Report({ transcript, report, role, onRestart }) {
  const r = report || {};
  const score = r.overall || 0;
  const band = score >= 80 ? ["Strong", BRAND.green] : score >= 60 ? ["Promising", BRAND.gold] : score >= 1 ? ["Needs work", BRAND.accent] : ["—", BRAND.mute];
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "44px 24px 90px" }}>
      <div className="rise" style={{
        background: BRAND.ink, color: BRAND.paper, borderRadius: 20, padding: "34px 32px",
        display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap",
      }}>
        <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0 }}>
          <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="#3a352b" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={band[1]} strokeWidth="10"
              strokeLinecap="round" strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - score / 100)} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 600 }}>{score}</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <span style={{ color: band[1], fontWeight: 600, fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase" }}>{band[0]}</span>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, lineHeight: 1.2, margin: "8px 0 0", fontWeight: 600 }}>
            {r.verdict || "Your interview report"}
          </h2>
          <p style={{ color: "#bdb4a2", margin: "8px 0 0", fontSize: 14 }}>{role}</p>
        </div>
      </div>

      <div className="rise" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18, animationDelay: ".08s" }}>
        <Panel title="What worked" color={BRAND.green} items={r.strengths} />
        <Panel title="Where you lost points" color={BRAND.accent} items={r.gaps} />
      </div>

      <h3 className="rise" style={{ fontFamily: FONT_DISPLAY, fontSize: 22, margin: "34px 0 14px", fontWeight: 600 }}>
        Question by question
      </h3>
      <div style={{ display: "grid", gap: 14 }}>
        {(r.perQuestion || []).map((q, i) => (
          <div key={i} className="rise" style={{
            background: BRAND.card, border: `1px solid ${BRAND.line}`, borderRadius: 14,
            padding: 20, animationDelay: `${.04 * i}s`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15.5, flex: 1 }}>{q.question}</p>
              <span style={{
                flexShrink: 0, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15,
                color: q.score >= 7 ? BRAND.green : q.score >= 4 ? BRAND.gold : BRAND.accent,
                border: `1px solid ${BRAND.line}`, borderRadius: 8, padding: "3px 9px",
              }}>{q.score}/10</span>
            </div>
            {q.good && <Line label="Good" color={BRAND.green} text={q.good} />}
            {q.improve && <Line label="Fix" color={BRAND.accent} text={q.improve} />}
            {q.modelAnswer && (
              <div style={{ marginTop: 10, background: BRAND.paper, borderRadius: 10, padding: "10px 13px", borderLeft: `3px solid ${BRAND.gold}` }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: BRAND.gold, textTransform: "uppercase" }}>Stronger answer</span>
                <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.5, color: BRAND.ink }}>{q.modelAnswer}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 36, display: "flex", gap: 12 }}>
        <button onClick={onRestart} style={primaryBtn()}>Run another interview</button>
      </div>
    </main>
  );
}

function Panel({ title, color, items }) {
  return (
    <div style={{ background: BRAND.card, border: `1px solid ${BRAND.line}`, borderRadius: 14, padding: 20 }}>
      <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color }}>{title}</h4>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 7 }}>
        {(items || []).map((s, i) => (
          <li key={i} style={{ fontSize: 14.5, lineHeight: 1.5, color: BRAND.ink }}>{s}</li>
        ))}
        {(!items || !items.length) && <li style={{ color: BRAND.mute, fontSize: 14 }}>—</li>}
      </ul>
    </div>
  );
}

function Line({ label, color, text }) {
  return (
    <p style={{ margin: "9px 0 0", fontSize: 14, lineHeight: 1.5 }}>
      <span style={{ fontWeight: 700, color, fontSize: 12, letterSpacing: ".04em" }}>{label} · </span>
      {text}
    </p>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${BRAND.line}`, padding: "20px 24px", textAlign: "center", color: BRAND.mute, fontSize: 12.5 }}>
      PrepLoop · MVP — built for professionals who want to walk in ready.
    </footer>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        <span style={{ fontSize: 12.5, color: BRAND.mute }}>{hint}</span>
      </div>
      {children}
    </label>
  );
}
function inputStyle() {
  return {
    width: "100%", fontFamily: FONT_BODY, fontSize: 15, color: BRAND.ink,
    background: BRAND.card, border: `1px solid ${BRAND.line}`, borderRadius: 12,
    padding: "13px 15px", outline: "none",
  };
}
function primaryBtn() {
  return {
    fontFamily: FONT_BODY, fontWeight: 600, fontSize: 16, padding: "14px 28px",
    borderRadius: 12, border: "none", background: BRAND.accent, color: "#fff",
    cursor: "pointer", boxShadow: `0 10px 24px -8px ${BRAND.accent}`,
  };
}
function ghostBtn() {
  return {
    fontFamily: FONT_BODY, fontWeight: 600, fontSize: 15, padding: "13px 24px",
    borderRadius: 12, border: `1px solid ${BRAND.line}`, background: "transparent",
    color: BRAND.mute, cursor: "pointer",
  };
}
function ringStyle(color, delay) {
  return {
    position: "absolute", inset: 0, borderRadius: "50%",
    border: `2px solid ${color}`, animation: `ring 1.8s ease-out ${delay}s infinite`,
  };
}
