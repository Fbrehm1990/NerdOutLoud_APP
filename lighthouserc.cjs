// Lighthouse CI config. Runs against the production build served statically —
// Supabase/TMDB calls will fail in this environment (no live backend, no
// Netlify Functions server), which is fine: the app is built to degrade
// gracefully (local-mode fallback, try/catch around every network call), so
// it still renders and is measurable. This checks load performance and
// regressions, not full functional correctness — that's what the Vitest
// suite and manual QA are for.
//
// Budget philosophy: thresholds are set close to CURRENT actual bundle size,
// not an aspirational target pulled from nowhere. The point is catching
// regressions in future PRs, not demanding a score that fails on day one.
// Tighten these over time as the app is optimized, rather than loosening
// them to make failures go away.
module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      numberOfRuns: 3,
      settings: {
        // A single-page app has no meaningful "URL routes" to crawl from a
        // static server — just audit the one entry point.
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      },
    },
    assert: {
      assertions: {
        // Category scores. Performance is intentionally the loosest — a
        // client-rendered SPA with real API dependencies genuinely can't hit
        // 90+ without server-side rendering, which this app doesn't do.
        // Raising this later is a real, trackable improvement goal, not a
        // config value to fudge.
        "categories:performance": ["warn", { minScore: 0.6 }],
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.85 }],
        "categories:seo": ["error", { minScore: 0.9 }],

        // Core Web Vitals — warn rather than hard-fail initially, since CI
        // network conditions are noisier than production and these are new
        // checks that haven't been tuned against real-world variance yet.
        "first-contentful-paint": ["warn", { maxNumericValue: 3000 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 4000 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 600 }],

        // Resource budgets — set just above current actual size (see
        // README/DEPLOY-GUIDE for how to check current bundle sizes via
        // `npm run build`). A PR that meaningfully grows the bundle should
        // fail here; normal day-to-day changes shouldn't.
        "resource-summary:script:size": ["error", { maxNumericValue: 600000 }],
        "resource-summary:total:size": ["error", { maxNumericValue: 900000 }],
        "resource-summary:image:size": ["warn", { maxNumericValue: 300000 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
