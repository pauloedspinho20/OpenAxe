import { useEffect, useState } from 'react'
import { useTone3000Auth } from '../tone3000/authStore'
import { useTone3000Browser } from '../tone3000/browserStore'
import { Tone3000Library, useTone3000Library } from '../tone3000/library'
import type { Tone3000LibraryEntry } from '../tone3000/library'
import { apiListMakes, apiListModels, apiListTags, apiSearchTones } from '../tone3000/client'
import { importTone3000Asset } from '../tone3000/importService'
import type { ChainLoadTarget } from '../tone3000/importService'
import type { Tone, Tone3000Model } from '../tone3000/types'
import { HardwareButton } from './primitives/HardwareButton'
import styles from './Tone3000Browser.module.css'

/** Max results /tones/search returns per page (per API docs). */
const SEARCH_PAGE_SIZE = 25

interface Props {
  /** Loads an imported model/IR into the target chain's amp/cab slot (null = engine off). */
  target: ChainLoadTarget | null
  context: AudioContext | null
}

interface SearchState {
  query: string
  gear: '' | Tone['gear']
  format: '' | Tone['format']
  sort: 'trending' | 'newest' | 'oldest' | 'downloads-all-time' | 'best-match'
}

const DEFAULT_SEARCH: SearchState = { query: '', gear: '', format: '', sort: 'trending' }
const NOT_AUTHENTICATED = 'Not authenticated'

export function Tone3000Browser({ target, context }: Props) {
  const browser = useTone3000Browser()
  const auth = useTone3000Auth()
  const library = useTone3000Library((s) => s.entries)
  const [tab, setTab] = useState<'browse' | 'library'>('browse')
  const [search, setSearch] = useState<SearchState>(DEFAULT_SEARCH)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [tones, setTones] = useState<Tone[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [models, setModels] = useState<Record<number, Tone3000Model[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importDone, setImportDone] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [makes, setMakes] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [makesValue, setMakesValue] = useState('')
  const [tagsValue, setTagsValue] = useState('')

  useEffect(() => {
    void Tone3000Library.refresh()
  }, [])

  // Debounce the free-text query (rate limit is 100 req/min).
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setDebouncedQuery(search.query)
    }, 350)
    return () => clearTimeout(t)
  }, [search.query])

  // Deliverable taxonomies (makes/tags) for the autocomplete datalists.
  useEffect(() => {
    const t = setTimeout(
      () =>
        void apiListMakes(makesValue)
          .then((r) => setMakes(r.data.map((m) => m.name)))
          .catch(() => setMakes([])),
      300,
    )
    return () => clearTimeout(t)
  }, [makesValue])

  useEffect(() => {
    const t = setTimeout(
      () =>
        void apiListTags(tagsValue)
          .then((r) => setTags(r.data.map((t) => t.name)))
          .catch(() => setTags([])),
      300,
    )
    return () => clearTimeout(t)
  }, [tagsValue])

  // The search itself, keyed on the settled filters. Re-runs after connect
  // (auth.status in deps) for the lazy-auth flow.
  useEffect(() => {
    if (tab !== 'browse') return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Parameters<typeof apiSearchTones>[0] = {
      query: debouncedQuery,
      page,
      pageSize: SEARCH_PAGE_SIZE,
      sort: search.sort,
      architecture: 2,
    }
    if (search.gear) params.gears = [search.gear]
    if (search.format) params.format = search.format
    if (makesValue) params.makes = [makesValue]
    if (tagsValue) params.tags = [tagsValue]
    apiSearchTones(params)
      .then((res) => {
        if (cancelled) return
        setTones(res.data)
        setTotal(res.total)
        setNeedsConnect(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        if (message === NOT_AUTHENTICATED) {
          setNeedsConnect(true)
          setTones([])
          setError(null)
        } else {
          setError(message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    debouncedQuery,
    page,
    search.gear,
    search.format,
    search.sort,
    makesValue,
    tagsValue,
    auth.status,
  ])

  const toggleTone = async (tone: Tone) => {
    if (expanded === tone.id) {
      setExpanded(null)
      return
    }
    setExpanded(tone.id)
    if (!models[tone.id]) {
      setModelsLoading(true)
      try {
        const res = await apiListModels(tone.id, { pageSize: 50, architecture: 2 })
        setModels((m) => ({ ...m, [tone.id]: res.data }))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setModelsLoading(false)
      }
    }
  }

  const runImport = async (model: Tone3000Model, tone: Tone) => {
    if (!browser.target) return
    const { chain, slot } = browser.target
    setImportingId(model.id.toString())
    setImportDone(null)
    setImportError(null)
    try {
      const id = `tone3000:${slot}:${model.id}`
      await importTone3000Asset(
        {
          id,
          chain,
          slot,
          name: model.name,
          modelUrl: model.model_url,
          creator: tone.user.username,
          sourceUrl: tone.url,
          toneTitle: tone.title,
          imageUrl: tone.images?.[0] ?? null,
        },
        target,
        context,
      )
      close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === NOT_AUTHENTICATED) {
        setImportError('Importing needs a Tone3000 account connection — connect above, then retry.')
        setNeedsConnect(true)
      } else {
        setImportError(`Import failed: ${message}`)
      }
    } finally {
      setImportingId(null)
    }
  }

  const reloadFromLibrary = async (entry: Tone3000LibraryEntry) => {
    if (!target || !context) return
    const blob = await Tone3000Library.getBlob(entry.id)
    if (!blob) return
    if (entry.kind === 'model') {
      await target.loadModel(await blob.text(), { id: entry.id, name: entry.name })
    } else {
      const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
      target.loadIR(audioBuffer, { id: entry.id, name: entry.name })
    }
    await Tone3000Library.notifyLoaded()
    close()
  }

  const close = () => {
    browser.closeBrowser()
    setTab('browse')
    setSearch(DEFAULT_SEARCH)
    setDebouncedQuery('')
    setTones([])
    setTotal(0)
    setPage(1)
    setError(null)
    setNeedsConnect(false)
    setImportError(null)
  }

  if (!browser.open || !browser.target) return null

  const { chain, slot } = browser.target
  const totalPages = Math.ceil(total / SEARCH_PAGE_SIZE)

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Tone3000 catalog">
      <div className={styles.modal}>
        <header className={styles.header}>
          <span className={`label ${styles.heading}`}>
            TONE3000 CATALOG · CHAIN {chain} · {slot === 'model' ? 'AMP MODEL' : 'CAB IR'}
          </span>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'browse' ? styles.tabActive : ''}`}
              onClick={() => setTab('browse')}
            >
              BROWSE
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'library' ? styles.tabActive : ''}`}
              onClick={() => setTab('library')}
            >
              LIBRARY ({library.length})
            </button>
            <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        {auth.error && <p className={styles.error}>{auth.error}</p>}
        {importError && <p className={styles.error}>{importError}</p>}
        {error && <p className={styles.error}>{error}</p>}

        {tab === 'browse' && (
          <div className={styles.body}>
            <div className={styles.filters}>
              <input
                type="text"
                placeholder="Search tones…"
                value={search.query}
                onChange={(e) => setSearch((s) => ({ ...s, query: e.target.value }))}
                className={styles.input}
              />
              <select
                value={search.gear}
                onChange={(e) => setSearch((s) => ({ ...s, gear: e.target.value as Tone['gear'] }))}
                className={styles.input}
                aria-label="Gear"
              >
                <option value="">All gear</option>
                <option value="amp">Amp</option>
                <option value="amp-cab">Amp+Cab</option>
                <option value="cab">Cab</option>
                <option value="pedal">Pedal</option>
                <option value="outboard">Outboard</option>
                <option value="space">Space</option>
              </select>
              <select
                value={search.format}
                onChange={(e) =>
                  setSearch((s) => ({ ...s, format: e.target.value as Tone['format'] }))
                }
                className={styles.input}
                aria-label="Format"
              >
                <option value="">All formats</option>
                <option value="nam">NAM</option>
                <option value="ir">IR</option>
              </select>
              <select
                value={search.sort}
                onChange={(e) =>
                  setSearch((s) => ({ ...s, sort: e.target.value as SearchState['sort'] }))
                }
                className={styles.input}
                aria-label="Sort"
              >
                <option value="trending">Trending</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="downloads-all-time">Most downloaded</option>
                <option value="best-match">Best match</option>
              </select>
            </div>

            <div className={styles.filterRow}>
              <input
                type="text"
                list="t3k-makes"
                placeholder="Makes…"
                value={makesValue}
                onChange={(e) => setMakesValue(e.target.value)}
                className={styles.input}
              />
              <datalist id="t3k-makes">
                {makes.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <input
                type="text"
                list="t3k-tags"
                placeholder="Tags…"
                value={tagsValue}
                onChange={(e) => setTagsValue(e.target.value)}
                className={styles.input}
              />
              <datalist id="t3k-tags">
                {tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>

            {needsConnect && (
              <div className={styles.connect}>
                <p className={styles.connectText}>
                  Browsing/importing Tone3000 content uses your Tone3000 account. Connect once; your
                  refresh token is kept on this device for future sessions.
                </p>
                <HardwareButton label="Connect Tone3000" onClick={() => void auth.connect()} />
              </div>
            )}

            {loading && <p className={styles.hint}>Loading…</p>}
            {!loading && !needsConnect && tones.length === 0 && !error && (
              <p className={styles.hint}>No tones match.</p>
            )}

            <ul className={styles.list}>
              {tones.map((tone) => (
                <li key={tone.id} className={styles.card}>
                  <button
                    type="button"
                    className={styles.cardHeader}
                    onClick={() => void toggleTone(tone)}
                  >
                    {tone.images?.[0] && (
                      <img
                        src={tone.images[0]}
                        alt=""
                        className={styles.cardImage}
                        loading="lazy"
                      />
                    )}
                    <span className={styles.cardInfo}>
                      <span className={styles.cardTitle}>{tone.title}</span>
                      <span className={`label ${styles.cardMeta}`}>
                        {tone.gear} · {tone.format.toUpperCase()} · {tone.downloads_count} DL
                      </span>
                      <span className={`label ${styles.cardCredit}`}>
                        Captured by {tone.user.username}
                      </span>
                    </span>
                  </button>

                  {expanded === tone.id && modelsLoading && (
                    <p className={styles.hint}>Loading models…</p>
                  )}
                  {expanded === tone.id && models[tone.id] && (
                    <ul className={styles.modelList}>
                      {models[tone.id]!.map((model) => {
                        const assetId = `tone3000:${slot}:${model.id}`
                        const cached = library.some((e) => e.id === assetId)
                        return (
                          <li key={model.id} className={styles.modelRow}>
                            <span className={styles.modelName}>
                              {model.name}
                              <span className={`label ${styles.modelSize}`}>
                                {model.size} · A{model.architecture_version}
                              </span>
                            </span>
                            <button
                              type="button"
                              className={styles.importBtn}
                              disabled={importingId === model.id.toString()}
                              onClick={() => void runImport(model, tone)}
                            >
                              {importingId === model.id.toString()
                                ? 'IMPORTING…'
                                : importDone === model.id.toString()
                                  ? 'IMPORTED ✓'
                                  : cached
                                    ? 'RELOAD'
                                    : 'IMPORT'}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav className={styles.pagination}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ‹
                </button>
                <span className={`label ${styles.pageInfo}`}>
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  ›
                </button>
              </nav>
            )}
          </div>
        )}

        {tab === 'library' && (
          <div className={styles.body}>
            {library.length === 0 && <p className={styles.hint}>Nothing imported yet.</p>}
            <ul className={styles.list}>
              {library.map((entry) => (
                <li key={entry.id} className={styles.card}>
                  <div className={styles.libraryRow}>
                    {entry.imageUrl && (
                      <img
                        src={entry.imageUrl}
                        alt=""
                        className={styles.cardImage}
                        loading="lazy"
                      />
                    )}
                    <div className={styles.libraryInfo}>
                      <span className={styles.cardTitle}>{entry.name}</span>
                      <span className={`label ${styles.cardMeta}`}>
                        {entry.creator} · {entry.kind}
                        {entry.toneTitle ? ` · ${entry.toneTitle}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.importBtn}
                      disabled={!target}
                      onClick={() => void reloadFromLibrary(entry)}
                    >
                      LOAD
                    </button>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => void Tone3000Library.remove(entry.id)}
                      aria-label={`Remove ${entry.name} from library`}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className={styles.footer}>
          <span className={`label ${styles.footerText}`}>
            Models &amp; IRs via TONE3000 ·{' '}
            <a href="https://www.tone3000.com" target="_blank" rel="noreferrer">
              tone3000.com
            </a>
          </span>
        </footer>
      </div>
    </div>
  )
}
