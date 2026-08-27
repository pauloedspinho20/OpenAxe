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
import type { BlockLoadTarget } from '../../tone3000/importService'
import type { Tone } from '../../tone3000/types'
import { bulkDownloadToneModels } from '../../tone3000/bulkDownload'
import { ToneCatalogDetailsDialog } from './ToneCatalogDetailsDialog'
import { Dialog, HardwareButton, OutlineButton, Select } from '@openaxe/ui'
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
}

function matchesQuery(text: string, query: string): boolean {
  return !query || text.toLowerCase().includes(query.trim().toLowerCase())
}

export function Tone3000Browser({ target, context }: Props) {
  const browser = useTone3000Browser()
  const auth = useTone3000Auth()
  const library = useTone3000Library((s) => s.entries)
  const [scope, setScope] = useState<Scope>('browse')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [search, setSearch] = useState<SearchState>(DEFAULT_SEARCH)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [tones, setTones] = useState<Tone[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [makes, setMakes] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [makesValue, setMakesValue] = useState('')
  const [tagsValue, setTagsValue] = useState('')
  const [detailTone, setDetailTone] = useState<Tone | null>(null)
  const [quickDownloadingToneId, setQuickDownloadingToneId] = useState<number | null>(null)

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

  const hasCachedForTone = (tone: Tone) => library.some((e) => e.sourceUrl === tone.url)

  const handleQuickDownloadAll = async (tone: Tone) => {
    if (!browser.target) return
    const { slot } = browser.target
    setQuickDownloadingToneId(tone.id)
    setImportError(null)
    try {
      let res = await apiListModels(tone.id, { pageSize: 50, architecture: 2 })
      if (res.data.length === 0) {
        res = await apiListModels(tone.id, { pageSize: 50 })
      }
      const result = await bulkDownloadToneModels({ tone, models: res.data, slot })
      if (result.failed > 0) {
        setImportError(
          `Download: ${result.ok} ok, ${result.skipped} skipped, ${result.failed} failed. ${result.errors.join('; ')}`,
        )
      } else if (result.ok > 0 || result.skipped > 0) {
        setImportError(
          `${result.ok} downloaded, ${result.skipped} already cached. Open details to pick a file.`,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === NOT_AUTHENTICATED) {
        setNeedsConnect(true)
        setImportError(
          'Downloading needs a Tone3000 account connection — connect above, then retry.',
        )
      } else {
        setImportError(`Download failed: ${message}`)
      }
    } finally {
      setQuickDownloadingToneId(null)
    }
  }

  const handleQuickLoadFirst = async (tone: Tone) => {
    const cached = library
      .filter((e) => e.sourceUrl === tone.url)
      .sort((a, b) => b.importedAt - a.importedAt)
    const entry = cached[0]
    if (!entry) return
    await reloadFromLibrary(entry)
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
    setDetailTone(null)
    setQuickDownloadingToneId(null)
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
              className={`${styles.viewBtn} ${viewMode === 'cards' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('cards')}
              aria-label="Card view"
              title="Card view"
            >
              ▦
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${viewMode === 'list' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="List view"
              title="List view"
            >
              ☰
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
              <div className={styles.filterRow}>
                <Select
                  value={search.format}
                  onChange={(e) =>
                    setSearch((s) => ({ ...s, format: e.target.value as Tone['format'] }))
                  }
                  aria-label="Format"
                >
                  <option value="">All formats</option>
                  <option value="nam">NAM</option>
                  <option value="ir">IR</option>
                </Select>
                <Select
                  value={search.sort}
                  onChange={(e) =>
                    setSearch((s) => ({ ...s, sort: e.target.value as SearchState['sort'] }))
                  }
                  aria-label="Sort"
                >
                  <option value="trending">Trending</option>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="downloads-all-time">Most downloaded</option>
                  <option value="best-match">Best match</option>
                </Select>
              </div>
            )}

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
          </div>

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
                const hasCached = hasCachedForTone(tone)
                const isDownloading = quickDownloadingToneId === tone.id
                return (
                  <li key={tone.id} className={cardClass}>
                    <button
                      type="button"
                      className={styles.cardHeader}
                      onClick={() => setDetailTone(tone)}
                      aria-label={`View details for ${tone.title}`}
                    >
                      {tone.images?.[0] && (
                        <div className={styles.cardImageContainer}>
                          <img
                            src={tone.images[0]}
                            alt=""
                            className={styles.cardImage}
                            loading="lazy"
                            draggable={false}
                          />
                          {inLibrary && <span className={styles.inLibraryBadge}>LIBRARY</span>}
                        </div>
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
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => setDetailTone(tone)}
                        aria-label={`View details for ${tone.title}`}
                        title="View details"
                      >
                        ⓘ
                      </button>
                      <OutlineButton
                        disabled={isDownloading}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (hasCached) void handleQuickLoadFirst(tone)
                          else void handleQuickDownloadAll(tone)
                        }}
                        title={
                          hasCached
                            ? 'Load first cached file into active block'
                            : 'Download all files'
                        }
                      >
                        {isDownloading ? '…' : hasCached ? 'LOAD' : '⬇ Download'}
                      </OutlineButton>
                    </div>
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

      {detailTone && (
        <ToneCatalogDetailsDialog
          open={!!detailTone}
          onClose={() => setDetailTone(null)}
          tone={detailTone}
          slot={slot}
          target={target}
          context={context}
        />
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
