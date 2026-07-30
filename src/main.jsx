import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { initErrorMonitoring } from './lib/errorMonitoring.js'
import { initGoogleAdsTracking } from './lib/googleAds.js'

// Both no-op unless their respective env vars are set — see lib/errorMonitoring.js
// and lib/googleAds.js.
initErrorMonitoring();
initGoogleAdsTracking();

// No StrictMode: this app was originally built and tested without it, and
// StrictMode's double-invoked effects in development could double-fire some
// of the network/realtime setup calls. Doesn't affect the production build
// either way — this only matters while running `npm run dev`.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
