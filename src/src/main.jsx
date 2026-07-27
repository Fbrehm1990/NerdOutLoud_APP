import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { initErrorMonitoring } from './lib/errorMonitoring.js'

// No-ops unless VITE_SENTRY_DSN is set — see lib/errorMonitoring.js.
initErrorMonitoring();

// No StrictMode: this app was originally built and tested without it, and
// StrictMode's double-invoked effects in development could double-fire some
// of the network/realtime setup calls. Doesn't affect the production build
// either way — this only matters while running `npm run dev`.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
