import styles from './Wordmark.module.css'
import mainLogoUrl from './assets/icon-512-maskable.png'
import appLogoUrl from './assets/openaxe-256.png'
import pkg from '../../../package.json'
import type { CSSProperties } from 'react'

// PNG mark so the Wordmark needs no runtime SVG fetch (works in Storybook,
// the web app and the desktop bundle alike). Uses the final 256 png.
function MainLogo({ size = 24 }: { size?: number }) {
  return (
    <img
      src={mainLogoUrl}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: 'block', objectFit: 'contain', borderRadius: 'var(--r-lg)' }}
    />
  )
}

function AppLogo({ size = 24 }: { size?: number }) {
  return (
    <img
      src={appLogoUrl}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}

export interface WordmarkProps {
  variant?: 'inline' | 'hero'
  version?: string // e.g. "0.2.0" — normalised to "v0.2.0" inside
  showBeta?: boolean // default: derived as major(version) === 0
  style?: CSSProperties
}

function normaliseVersion(input?: string): string | undefined {
  if (!input) return undefined
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const withoutV = trimmed.replace(/^v/i, '')
  if (!withoutV) return undefined
  return `v${withoutV}`
}

function majorOf(version?: string): number | undefined {
  if (!version) return undefined
  const withoutV = version.replace(/^v/i, '').trim()
  const majorStr = withoutV.split('.')[0]
  const n = Number(majorStr)
  if (Number.isNaN(n)) return undefined
  return n
}

function resolveFallbackVersion(): string | undefined {
  try {
    return (pkg as { version?: string }).version
  } catch {
    return undefined
  }
}

export function Wordmark({
  variant = 'inline',
  version: versionProp,
  showBeta: showBetaProp,
  style,
}: WordmarkProps) {
  const fallback = resolveFallbackVersion()
  const rawVersion = versionProp ?? fallback
  const version = normaliseVersion(rawVersion)
  const major = majorOf(version)
  const showBeta =
    showBetaProp !== undefined ? showBetaProp : major !== undefined ? major === 0 : false

  if (variant === 'hero') {
    return (
      <div className={styles.hero} style={style}>
        <AppLogo size={200} />
        <p>
          OPEN<span>AXE</span>
        </p>
        {(version || showBeta) && (
          <div
            className={styles.metaRow}
            role="group"
            aria-label={version ? `version ${version} ${showBeta ? 'beta' : ''}`.trim() : 'beta'}
          >
            {version && (
              <span className={styles.version} aria-label={`version ${version}`}>
                {version}
              </span>
            )}
            {showBeta && (
              <span className={styles.beta} aria-label="beta">
                BETA
              </span>
            )}
          </div>
        )}

        <nav className={styles.links} aria-label="Downloads and source">
          <a href="https://openaxe-site.pages.dev/#download" target="_blank" rel="noopener">
            Download
          </a>

          <a href="https://github.com/pauloedspinho20/OpenAxe" target="_blank" rel="noopener">
            GitHub
          </a>
        </nav>
      </div>
    )
  }

  return (
    <div className={styles.inline} style={style}>
      <MainLogo size={40} />

      <p>
        OPEN<span>AXE</span>
      </p>
      {version && (
        <span className={styles.version} aria-label={`version ${version}`}>
          {version}
        </span>
      )}
      {showBeta && (
        <span className={styles.beta} aria-label="beta">
          BETA
        </span>
      )}
    </div>
  )
}
