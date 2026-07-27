import * as Sentry from "@sentry/react";

// Production error monitoring via Sentry — genuinely optional. Leave
// VITE_SENTRY_DSN unset and this quietly no-ops; nothing breaks, no errors
// get reported anywhere, the app behaves exactly as it did before this file
// existed. Setting the DSN is what actually turns monitoring on.
//
// To get a DSN: create a free account at sentry.io (free tier covers a small
// production app like this comfortably), create a new React project, and
// copy the DSN it gives you into VITE_SENTRY_DSN — locally in .env, and in
// Netlify's Site configuration → Environment variables for production.
// Creating that account is something only you can do; this file just wires
// up whatever DSN you give it.
const DSN = import.meta.env.VITE_SENTRY_DSN;

export function initErrorMonitoring() {
  if (!DSN) return; // no-op — monitoring simply isn't configured
  Sentry.init({
    dsn: DSN,
    // Keep this light — traces/session-replay sampling cost real quota on
    // the free tier, and error capture (the actual point of this) works
    // fully without them. Bump these later if you want performance insight too.
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE, // "production" vs "development"
  });
}

// Reports one error explicitly — used by the Error Boundary, and available
// for any spot in the app that catches something itself but still wants it
// visible in Sentry (e.g. a caught network failure worth knowing trends on).
export function reportError(error, context) {
  if (!DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
