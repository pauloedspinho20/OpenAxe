import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/global/ErrorBoundary/ErrorBoundary'
import { installUnhandledRejectionHandler } from './unhandledRejections'
import { installPrefsMirror } from './storage/prefsMirror'
import './index.css'
import App from './App.tsx'

installUnhandledRejectionHandler()

// Preferences are read synchronously during the first render (theme,
// onboarding, the factory-setup flag), so the shared store has to be copied
// into localStorage before mounting rather than after. Resolves immediately
// on the web, where there is no shell and nothing to copy.
void installPrefsMirror().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})
