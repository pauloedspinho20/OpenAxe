import { useEffect, useState } from 'react'
import { useTone3000Auth } from '../../tone3000/authStore'
import { useTone3000Browser } from '../../tone3000/browserStore'
import { Tone3000Library, useTone3000Library } from '../../tone3000/library'
import type { Tone3000LibraryEntry } from '../../tone3000/library'
import {
  apiListCreatedTones,
  apiListFavoritedTones,
  apiListMakes,
  apiListModels,
  apiListTags,
  apiSearchTones,
} from '../../tone3000/client'
import { importTone3000Asset } from '../../tone3000/importService'
import type { BlockLoadTarget } from '../../tone3000/importService'
import type { Tone, Tone3000Model } from '../../tone3000/types'
import { Dialog, HardwareButton, OutlineButton } from '@nam/ui'
import styles from './Tone3000Browser.module.css'

/** Max results /tones/search and /tones/favorited return per page (per API docs). */
const SEARCH_PAGE_SIZE = 25

interface Props {
  /** Loads an imported model/IR into the target Amp/Cab block (null = engine off). */
  target: BlockLoadTarget | null
  context: AudioContext | null
}

type Scope = 'browse' | 'library' | 'favorites' | 'created'
type ViewMode = 'list' | 'cards'

interface SearchState {
  query: string
  format: '' | Tone['format']
  sort: 'trending' | 'newest' | 'oldest' | 'downloads-all-time' | 'best-match'
}

const DEFAULT_SEARCH: SearchState = { query: '', format: '', sort: 'trending' }
const NOT_AUTHENTICATED = 'Not authenticated'

const GEAR_LABELS: Record<Tone['gear'], string> = {
  amp: 'AMP MODEL',
  'amp-cab': 'AMP+CAB MODEL',
  pedal: 'PEDAL MODEL',
  outboard: 'OUTBOARD MODEL',
  space: 'SPACE MODEL',
  cab: 'CAB IR',
  experimental: 'EXPERIMENTAL',
}

function matchesQuery(text: string, query: string): boolean {
  return !query || text.toLowerCase().includes(query.trim().toLowerCase())
}

export function Tone3000Browser({ target, context }: Props) {
  const browser = useTone3000Browser()
  const auth = useTone3000Auth()
  const library = useTone3000Library((s) => s.entries)
  const [scope, setScope] = useState<Scope>('browse')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
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

  // Deliverable taxonomies (makes/tags) for the autocomplete datalists - browse only.
  useEffect(() => {
    if (scope !== 'browse') return
    const t = setTimeout(
      () =>
        void apiListMakes(makesValue)
          .then((r) => setMakes(r.data.map((m) => m.name)))
          .catch(() => setMakes([])),
      300,
    )
    return () => clearTimeout(t)
  }, [scope, makesValue])

  useEffect(() => {
    if (scope !== 'browse') return
    const t = setTimeout(
      () =>
        void apiListTags(tagsValue)
          .then((r) => setTags(r.data.map((t) => t.name)))
          .catch(() => setTags([])),
      300,
    )
    return () => clearTimeout(t)
  }, [scope, tagsValue])

  useEffect(() => {
    setPage(1)
  }, [scope])

  // The search itself, keyed on the settled filters. Re-runs after connect
  // (auth.status in deps) for the lazy-auth flow. Browse, Favorites, and
  // Created share this effect - all three are paginated Tone lists, just
  // from different endpoints, and Favorites/Created skip the free-text/
  // format/sort/makes/tags filters only the search endpoint supports.
  useEffect(() => {
    if (scope === 'library' || !browser.target) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const request =
      scope === 'favorites'
        ? apiListFavoritedTones({
            page,
            pageSize: SEARCH_PAGE_SIZE,
            gear: browser.target.gear,
          })
        : scope === 'created'
          ? apiListCreatedTones({
              page,
              pageSize: SEARCH_PAGE_SIZE,
              gear: browser.target.gear,
            })
          : apiSearchTones({
              query: debouncedQuery,
              page,
              pageSize: SEARCH_PAGE_SIZE,
              sort: search.sort,
              architecture: 2,
              gears: [browser.target.gear],
              ...(search.format ? { format: search.format } : {}),
              ...(makesValue ? { makes: [makesValue] } : {}),
              ...(tagsValue ? { tags: [tagsValue] } : {}),
            })
    request
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
    scope,
    debouncedQuery,
    page,
    browser.target,
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
    const { blockId, slot } = browser.target
    setImportingId(model.id.toString())
    setImportDone(null)
    setImportError(null)
    try {
      const id = `tone3000:${slot}:${model.id}`
      await importTone3000Asset(
        {
          id,
          blockId,
          slot,
          name: model.name,
          modelUrl: model.model_url,
          creator: tone.user.username,
          sourceUrl: tone.url,
          toneTitle: tone.title,
          imageUrl: tone.images?.[0] ?? null,
          tone: {
            id: tone.id,
            title: tone.title,
            description: tone.description,
            gear: tone.gear,
            format: tone.format,
            license: tone.license,
            images: tone.images ?? null,
            sizes: tone.sizes ?? [],
            makes: (tone.makes ?? []).map((m) => m.name),
            tags: (tone.tags ?? []).map((t) => t.name),
            downloads_count: tone.downloads_count,
            favorites_count: tone.favorites_count,
            models_count: tone.models_count,
            user: tone.user,
            created_at: tone.created_at ?? null,
            url: tone.url,
          },
          model: {
            id: model.id,
            name: model.name,
            size: model.size,
            architecture_version: model.architecture_version,
          },
        },
        target,
        context,
      )
      // `target`/`context` are null whenever the engine isn't powered on yet
      // (or, briefly, right after adding a block - see useTone3000Target) -
      // importTone3000Asset still downloads and caches in that case, but
      // there's no live block for it to actually load into. Closing here as
      // if it succeeded would silently strand the download - surface it
      // instead and leave the dialog open so the user can see what happened.
      if (target && context) {
        close()
      } else {
        setImportDone(model.id.toString())
        setImportError(
          "Downloaded and cached, but the engine isn't running yet - power on, then click Reload here (or find it under Library).",
        )
      }
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
    setScope('browse')
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

  const { slot, gear } = browser.target
  const totalPages = Math.ceil(total / SEARCH_PAGE_SIZE)
  const listClass = viewMode === 'cards' ? styles.cardsGrid : styles.list
  const cardClass = `${styles.card} ${viewMode === 'cards' ? styles.cardVertical : ''}`
  const filteredLibrary = library.filter(
    (e) =>
      matchesQuery(e.name, search.query) ||
      matchesQuery(e.creator, search.query) ||
      matchesQuery(e.toneTitle ?? '', search.query),
  )

  return (
    <Dialog
      open={true}
      onClose={close}
      title={`TONE3000 CATALOG · ${GEAR_LABELS[gear]}`}
      width="min(1040px, 96vw)"
      zIndex={40}
      headerContent={
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${scope === 'browse' ? styles.tabActive : ''}`}
            onClick={() => setScope('browse')}
          >
            ALL
          </button>
          <button
            type="button"
            className={`${styles.tab} ${scope === 'library' ? styles.tabActive : ''}`}
            onClick={() => setScope('library')}
          >
            LIBRARY ({library.length})
          </button>
          <button
            type="button"
            className={`${styles.tab} ${scope === 'favorites' ? styles.tabActive : ''}`}
            onClick={() => setScope('favorites')}
          >
            FAVORITES
          </button>
          <button
            type="button"
            className={`${styles.tab} ${scope === 'created' ? styles.tabActive : ''}`}
            onClick={() => setScope('created')}
          >
            MY MODELS
          </button>
          <span className={styles.viewToggle} role="group" aria-label="View mode">
            <button
              type="button"
              className={`${styles.viewBtn} ${viewMode === 'list' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="List view"
              title="List view"
            >
              ☰
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${viewMode === 'cards' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('cards')}
              aria-label="Card view"
              title="Card view"
            >
              ▦
            </button>
          </span>
        </div>
      }
    >
      {auth.error && <p className={styles.error}>{auth.error}</p>}
      {importError && <p className={styles.error}>{importError}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {scope !== 'library' && (
        <div className={styles.body}>
          <div className={styles.filters}>
            <input
              type="text"
              placeholder="Search tones…"
              value={search.query}
              onChange={(e) => setSearch((s) => ({ ...s, query: e.target.value }))}
              className={styles.input}
            />
            {scope === 'browse' && (
              <>
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
              </>
            )}
          </div>

          {scope === 'browse' && (
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
          )}

          {scope === 'favorites' && (
            <p className={styles.hint}>
              Tones you've favorited on tone3000.com - filtered by title, from {GEAR_LABELS[gear]}.
            </p>
          )}

          {scope === 'created' && (
            <p className={styles.hint}>
              Tones you've uploaded to tone3000.com - filtered by title, from {GEAR_LABELS[gear]}.
            </p>
          )}

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

          <ul className={listClass}>
            {tones
              .filter(
                (tone) =>
                  (scope !== 'favorites' && scope !== 'created') ||
                  matchesQuery(tone.title, search.query),
              )
              .map((tone) => {
                const inLibrary = library.some((e) => e.sourceUrl === tone.url)
                return (
                  <li key={tone.id} className={cardClass}>
                    <button
                      type="button"
                      className={styles.cardHeader}
                      onClick={() => void toggleTone(tone)}
                    >
                      {tone.images?.[0] && (
                        <div className={styles.cardImageContainer}>
                          <img
                            src={tone.images[0]}
                            alt=""
                            className={styles.cardImage}
                            loading="lazy"
                          />
                        </div>
                      )}
                      <span className={styles.cardInfo}>
                        <span className={styles.cardTitle}>
                          {tone.title}
                          {inLibrary && (
                            <span className={`label ${styles.inLibraryBadge}`}>IN LIBRARY</span>
                          )}
                        </span>
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
                              <OutlineButton
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
                              </OutlineButton>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
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

      {scope === 'library' && (
        <div className={styles.body}>
          <div className={styles.filters}>
            <input
              type="text"
              placeholder="Filter your library…"
              value={search.query}
              onChange={(e) => setSearch((s) => ({ ...s, query: e.target.value }))}
              className={styles.input}
            />
          </div>
          {library.length === 0 && <p className={styles.hint}>Nothing imported yet.</p>}
          {library.length > 0 && filteredLibrary.length === 0 && (
            <p className={styles.hint}>No library items match.</p>
          )}
          <ul className={listClass}>
            {filteredLibrary.map((entry) => (
              <li key={entry.id} className={cardClass}>
                <div className={styles.libraryRow}>
                  {entry.imageUrl && (
                    <img src={entry.imageUrl} alt="" className={styles.cardImage} loading="lazy" />
                  )}
                  <div className={styles.libraryInfo}>
                    <span className={styles.cardTitle}>{entry.name}</span>
                    <span className={`label ${styles.cardMeta}`}>
                      {entry.creator} · {entry.kind}
                      {entry.toneTitle ? ` · ${entry.toneTitle}` : ''}
                    </span>
                  </div>
                  <OutlineButton disabled={!target} onClick={() => void reloadFromLibrary(entry)}>
                    LOAD
                  </OutlineButton>
                  <OutlineButton
                    variant="danger"
                    onClick={() => void Tone3000Library.remove(entry.id)}
                    aria-label={`Remove ${entry.name} from library`}
                  >
                    ×
                  </OutlineButton>
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
    </Dialog>
  )
}
