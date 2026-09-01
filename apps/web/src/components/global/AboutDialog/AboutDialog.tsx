import { Dialog, Wordmark } from '@openaxe/ui'
import pkg from '../../../../package.json'
import styles from './AboutDialog.module.css'

export interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="About OpenAxe" width="560px">
      <div className={styles.body}>
        <div className={styles.hero}>
          <Wordmark version={pkg.version} />
          <p className={styles.description}>{pkg.description}</p>
          <p className={styles.version}>
            v{pkg.version} · GPL-3.0-only · 2024–2026 OpenAxe Contributors
          </p>
        </div>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Built with</h3>
          <ul className={styles.list}>
            <li>
              <a
                href="https://github.com/tone-3000/neural-amp-modeler-wasm"
                target="_blank"
                rel="noreferrer"
              >
                Neural Amp Modeler
              </a>{' '}
              — amp & pedal captures (NAMCore)
            </li>
            <li>
              <a href="https://www.tone3000.com" target="_blank" rel="noreferrer">
                TONE3000
              </a>{' '}
              — models & IR library
            </li>
            <li>
              Made with ❤ by{' '}
              <a href="https://hotdogtor.com" target="_blank" rel="noreferrer">
                Hot Dogtor
              </a>
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Project</h3>
          <ul className={styles.list}>
            <li>
              <a href="https://github.com/pauloedspinho20/OpenAxe" target="_blank" rel="noreferrer">
                github.com/pauloedspinho20/OpenAxe
              </a>
            </li>
            <li>
              <a
                href="https://github.com/pauloedspinho20/OpenAxe/issues"
                target="_blank"
                rel="noreferrer"
              >
                Issues & feature requests
              </a>
            </li>
            <li>
              <a
                href="https://github.com/pauloedspinho20/OpenAxe/blob/main/LICENSE"
                target="_blank"
                rel="noreferrer"
              >
                License: GPLv3
              </a>{' '}
              ·{' '}
              <a
                href="https://github.com/pauloedspinho20/OpenAxe/blob/main/THIRD_PARTY_NOTICES.md"
                target="_blank"
                rel="noreferrer"
              >
                Third-party notices
              </a>
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Technology</h3>
          <p className={styles.text}>
            Web: Vite + React + AudioWorklet + WASM (Emscripten). Desktop: C++ + webview.h + JUCE
            audio_devices. Plugin: iPlug2 (VST3/CLAP/AU) + same C++ core (<code>packages/core</code>
            ) + React webview. Design tokens in <code>packages/ui/tokens</code> → CSS & C++ header.
          </p>
          <p className={styles.text}>
            DSP wraps Dragonfly Reverb, DSPark and NeuralAmpModelerCore — one C++ core for every
            target.
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Acknowledgments</h3>
          <p className={styles.text}>
            Thanks to Steven Atkinson (NAM), Michael Willis (Dragonfly), Cristian Moresi (DSPark),
            the Tone3000 community, and every contributor making free, open guitar tone possible.
          </p>
        </section>
      </div>
    </Dialog>
  )
}
