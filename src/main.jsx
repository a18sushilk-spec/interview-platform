import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import InterviewPlatform from "./InterviewPlatform";
import { initAnalytics } from "./analytics";

// Start PostHog + Sentry before the app renders
initAnalytics();

// Friendly fallback if the app ever crashes (Sentry captures the error)
function Crash() {
  return (
    <div style={{
      fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh",
      display: "grid", placeItems: "center", background: "#F7F4EF", color: "#1A1714",
      textAlign: "center", padding: 24,
    }}>
      <div>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 28, marginBottom: 12 }}>
          Something went wrong
        </h1>
        <p style={{ color: "#6A635C", marginBottom: 20, maxWidth: 360 }}>
          We hit an unexpected error and our team has been notified. Please refresh the page to continue.
        </p>
        <button onClick={() => window.location.reload()} style={{
          padding: "12px 26px", borderRadius: 9, border: "none",
          background: "#C0432A", color: "#fff", fontWeight: 600, fontSize: 15, cursor: "pointer",
        }}>
          Refresh page
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<Crash />}>
      <InterviewPlatform />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
