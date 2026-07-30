// Google Ads conversion tracking — genuinely optional, same pattern as
// errorMonitoring.js. Leave VITE_GOOGLE_ADS_ID unset and this quietly no-ops:
// no script loads, no tracking happens, nothing breaks.
//
// Two separate conversion events are wired up, both created as separate
// "conversion actions" inside Google Ads so you can see (and optimize
// campaigns toward) which one actually matters:
//   1. First spin — someone who clicked an ad and actually tried the core
//      feature. This is the strongest "the ad worked" signal the app has.
//   2. Account signup — someone who converted into a real, retained user.
//
// To set this up: Google Ads → Goals → Conversions → New conversion action,
// once for each event you want to track (or just the first one to start).
// Google gives you a Conversion ID (looks like AW-123456789) shared across
// all your conversion actions, and a separate Conversion Label per action
// (looks like AbC-D_efG-h12_34-567). Paste them into .env / Netlify's
// environment variables — see .env.example for exactly which variable is which.
const ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID;
const SPIN_LABEL = import.meta.env.VITE_GOOGLE_ADS_SPIN_LABEL;
const SIGNUP_LABEL = import.meta.env.VITE_GOOGLE_ADS_SIGNUP_LABEL;

let loaded = false;

function ensureGtagLoaded() {
  if (loaded || !ADS_ID) return;
  loaded = true;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", ADS_ID);
}

function fireConversion(label) {
  if (!ADS_ID || !label) return; // no-op if this specific conversion isn't configured
  ensureGtagLoaded();
  window.gtag("event", "conversion", { send_to: `${ADS_ID}/${label}` });
}

// Call once, at app startup — safe to call even if unconfigured.
export function initGoogleAdsTracking() {
  ensureGtagLoaded();
}

// Call the moment a genuinely new user takes their first spin (already the
// exact moment lib/utils.js's "new_user_first_spin" internal event fires —
// this is meant to be called from that same spot).
export function trackFirstSpinConversion() {
  fireConversion(SPIN_LABEL);
}

// Call right after a signup completes successfully.
export function trackSignupConversion() {
  fireConversion(SIGNUP_LABEL);
}
