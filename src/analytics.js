// ── Analytics + error tracking ────────────────────────────────────────────────
// Wraps PostHog (product metrics + funnel) and Sentry (error tracking).
// All calls are safe no-ops if keys are missing (e.g. local dev without keys).

import posthog from "posthog-js";
import * as Sentry from "@sentry/react";

const PH_KEY  = import.meta.env.VITE_POSTHOG_KEY;
const PH_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

let phReady = false;

export function initAnalytics() {
  // PostHog
  if (PH_KEY && !PH_KEY.includes("paste-your")) {
    try {
      posthog.init(PH_KEY, {
        api_host: PH_HOST,
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        persistence: "localStorage+cookie",
      });
      phReady = true;
    } catch (e) { /* ignore */ }
  }

  // Sentry
  if (SENTRY_DSN && !SENTRY_DSN.includes("paste-your")) {
    try {
      Sentry.init({
        dsn: SENTRY_DSN,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.2,        // 20% performance sampling
        environment: import.meta.env.PROD ? "production" : "development",
      });
    } catch (e) { /* ignore */ }
  }
}

// Track a funnel/product event
export function track(event, props = {}) {
  if (phReady) {
    try { posthog.capture(event, props); } catch (e) { /* ignore */ }
  }
}

// Tie events to a known user after login/signup
export function identify(user) {
  if (phReady && user?.email) {
    try {
      posthog.identify(user.email, { name: user.name, email: user.email });
    } catch (e) { /* ignore */ }
  }
  try {
    Sentry.setUser(user?.email ? { email: user.email, username: user.name } : null);
  } catch (e) { /* ignore */ }
}

// Clear identity on logout
export function resetUser() {
  if (phReady) { try { posthog.reset(); } catch (e) { /* ignore */ } }
  try { Sentry.setUser(null); } catch (e) { /* ignore */ }
}

// Manually report a handled error
export function reportError(err, context = {}) {
  try { Sentry.captureException(err, { extra: context }); } catch (e) { /* ignore */ }
}
