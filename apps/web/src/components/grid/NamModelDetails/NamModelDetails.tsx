import type { Tone3000LibraryEntry } from '../../../tone3000/library'
import { Dialog } from '@openaxe/ui'
import styles from './NamModelDetails.module.css'

export interface NamModelDetailsProps {
  open: boolean
  onClose: () => void
  /** The block's own gear label (e.g. "Amp Model"), shown when there's nothing richer to show. */
  kindLabel: string
  /** The name reported by the live block (works even for a locally-loaded file with no library entry). */
  loadedName: string | null
  entry: Tone3000LibraryEntry | null
}

const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp Model',
  'amp-cab': 'Amp+Cab Model',
  pedal: 'Pedal Model',
  outboard: 'Outboard Model',
  space: 'Space Model',
  cab: 'Cab IR',
  experimental: 'Experimental',
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export interface NamModelProps {
  kindLabel: string
  loadedName: string | null
  entry: Tone3000LibraryEntry | null
  onClick?: () => void
}

/**
 * The full Tone3000 detail view for a loaded NAM model, opened by clicking
 * BlockHighlight's NAM-core box. Entirely driven by data cached on the
 * Tone3000LibraryEntry at import time (see tone3000/library.ts) rather than
 * a live API re-fetch - the Tone3000 API needs an authenticated session for
 * any call (see tone3000/client.ts), so a cached snapshot is what keeps this
 * dialog working offline and for tones the user no longer has access to.
 */
export function NamModelDetails({
  open,
  onClose,
  kindLabel,
  loadedName,
  entry,
}: NamModelDetailsProps) {
  const tone = entry?.tone ?? null
  const model = entry?.model ?? null
  const heroImage = tone?.images?.[0] ?? entry?.imageUrl ?? null
  const title = tone?.title ?? entry?.toneTitle ?? entry?.name ?? loadedName ?? kindLabel
  const uploadedOn = formatDate(tone?.created_at ?? null)

  return (
    <Dialog open={open} onClose={onClose} title="Model Details">
      {heroImage && <img src={heroImage} alt="" className={styles.hero} loading="lazy" />}

      <div>
        <div className={styles.toneTitle}>{title}</div>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>
            {tone ? (GEAR_LABELS[tone.gear] ?? kindLabel) : kindLabel}
          </span>
          {tone?.format && <span className={styles.badge}>{tone.format.toUpperCase()}</span>}
          {model && (
            <span className={styles.badge}>
              {model.size} · A{model.architecture_version}
            </span>
          )}
        </div>
      </div>

      {entry && (
        <div className={styles.creatorRow}>
          {tone?.user?.avatar_url && (
            <img src={tone.user.avatar_url} alt="" className={styles.avatar} />
          )}
          <span className={styles.creatorName}>Captured by {entry.creator}</span>
          {uploadedOn && <span className={`label ${styles.uploadDate}`}>· {uploadedOn}</span>}
        </div>
      )}

      {tone && (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{tone.downloads_count ?? 0}</span>
            <span className={`label ${styles.metricLabel}`}>Downloads</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{tone.favorites_count ?? 0}</span>
            <span className={`label ${styles.metricLabel}`}>Likes</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{tone.models_count ?? 0}</span>
            <span className={`label ${styles.metricLabel}`}>Models</span>
          </div>
        </div>
      )}

      {tone?.description && <p className={styles.description}>{tone.description}</p>}

      {model && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>This Block's Model</span>
          <div className={styles.modelRow}>
            <span className={styles.modelName}>{model.name}</span>
            <span className={`label ${styles.modelMeta}`}>
              {model.size} · Architecture {model.architecture_version}
            </span>
          </div>
        </div>
      )}

      {tone && (tone.sizes?.length ?? 0) > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Available Sizes</span>
          <div className={styles.chips}>
            {tone.sizes.map((size) => (
              <span key={size} className={styles.chip}>
                {size}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone && (tone.makes?.length ?? 0) > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Gear</span>
          <div className={styles.chips}>
            {tone.makes.map((make) => (
              <span key={make} className={styles.chip}>
                {make}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone && (tone.tags?.length ?? 0) > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Tags</span>
          <div className={styles.chips}>
            {tone.tags.map((tag) => (
              <span key={tag} className={styles.chip}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone?.license && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>License</span>
          <p className={styles.licenseText}>{tone.license}</p>
        </div>
      )}

      {!entry && (
        <p className={styles.note}>
          Loaded from a local file - no Tone3000 data is available for it.
        </p>
      )}
      {entry && !tone && (
        <p className={styles.note}>
          Full details weren't cached for this import - re-import the model from the Tone3000
          catalog to see everything.
        </p>
      )}

      {entry?.sourceUrl && (
        <div className={styles.footer}>
          <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className={styles.link}>
            View on Tone3000 →
          </a>
        </div>
      )}
    </Dialog>
  )
}
