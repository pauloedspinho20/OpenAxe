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
import type { Make, Tag, Tone } from '../../tone3000/types'
import { bulkDownloadToneModels } from '../../tone3000/bulkDownload'
import {
  importAccountTones,
  type AccountImportProgress,
  type AccountImportScope,
} from '../../tone3000/accountImport'
import { NamModelDetails } from '../grid/NamModelDetails/NamModelDetails'
import { Dialog, HardwareButton, MixerIcon, OutlineButton, Pagination, Select } from '@openaxe/ui'
import styles from './Tone3000Browser.module.css'
import { CloseIcon } from '../../../../../packages/ui/src/icons/GeneraIcons'

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
  const [accountScope, setAccountScope] = useState<AccountImportScope>('all')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountProgress, setAccountProgress] = useState<AccountImportProgress | null>(null)

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

  const handleAccountImport = async () => {
    setAccountBusy(true)
    setImportError(null)
    setAccountProgress(null)
    try {
      const result = await importAccountTones({
        scope: accountScope,
        onProgress: (p) => setAccountProgress(p),
      })
      setAccountProgress(null)
      await Tone3000Library.refresh()
      if (result.tones === 0) {
        setImportError('No tones found for that scope in your Tone3000 account.')
      } else if (result.failed > 0) {
        setImportError(
          `Import: ${result.ok} downloaded, ${result.skipped} already cached, ${result.failed} failed. ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? '…' : ''}`,
        )
      } else {
        setImportError(
          `Imported ${result.tones} tone(s): ${result.ok} downloaded, ${result.skipped} already cached.`,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === NOT_AUTHENTICATED) {
        setNeedsConnect(true)
        setImportError(
          'Importing your account tones needs a Tone3000 connection — connect above, then retry.',
        )
      } else {
        setImportError(`Account import failed: ${message}`)
      }
      setAccountProgress(null)
    } finally {
      setAccountBusy(false)
    }
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
    setAccountProgress(null)
  }

  if (!browser.open || !browser.target) return null

  const { slot, gear } = browser.target
  const totalPages = Math.ceil(total / SEARCH_PAGE_SIZE)
  const listClass = viewMode === 'cards' ? styles.cardsGrid : styles.list
  const cardClass = `${styles.card} ${viewMode === 'cards' ? styles.cardVertical : ''}`
  const filteredLibrary = library.filter(
    (e) =>
      e.kind === 'model' &&
      (matchesQuery(e.name, search.query) ||
        matchesQuery(e.creator, search.query) ||
        matchesQuery(e.toneTitle ?? '', search.query)),
  )
  const LIBRARY_PAGE_SIZE = SEARCH_PAGE_SIZE
  const libraryTotalPages = Math.ceil(filteredLibrary.length / LIBRARY_PAGE_SIZE)
  const pagedLibrary = filteredLibrary.slice(
    (page - 1) * LIBRARY_PAGE_SIZE,
    page * LIBRARY_PAGE_SIZE,
  )
  console.log('library', library)
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
            LIBRARY ({library.filter((e) => e.kind === 'model').length})
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
        <div className={styles.content}>
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

          {loading ? (
            <div className={styles.loadingWrapper} aria-busy="true" aria-live="polite">
              <div className={styles.spinner} role="status" aria-label="Loading" />
            </div>
          ) : (
            <>
              {!needsConnect && tones.length === 0 && !error && (
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
                          {tone.images?.[0] ? (
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
                          ) : (
                            <div className={styles.cardImageContainer}>
                              <div className={styles.cardImage}></div>
                              <span className={styles.inLibraryBadge}>LIBRARY</span>
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
                          <OutlineButton
                            title="Model Details"
                            onClick={() => setDetailTone(tone)}
                            aria-label={`View details for ${tone.title}`}
                          >
                            <MixerIcon size={16} />
                          </OutlineButton>
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
            </>
          )}
        </div>
      )}

      {scope === 'library' && (
        <div className={styles.content}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select
              value={accountScope}
              onChange={(e) => setAccountScope(e.target.value as AccountImportScope)}
              aria-label="Account tones scope"
              disabled={accountBusy}
            >
              <option value="all">All</option>
              <option value="downloaded">Downloaded</option>
              <option value="favorited">Favorited</option>
              <option value="created">My models</option>
            </Select>
            <HardwareButton
              label={
                accountProgress
                  ? `Importing ${accountProgress.currentTone}/${accountProgress.totalTones}…`
                  : 'Import from Tone3000 account'
              }
              disabled={accountBusy || auth.status !== 'connected'}
              onClick={() => void handleAccountImport()}
            />
            {auth.status !== 'connected' && !accountBusy && (
              <OutlineButton onClick={() => void auth.connect()}>Connect Tone3000</OutlineButton>
            )}
          </div>
          {accountProgress && (
            <p className={styles.hint}>
              {accountProgress.status === 'fetching_models'
                ? `Fetching models for ${accountProgress.toneTitle}…`
                : accountProgress.status === 'downloading'
                  ? `Downloading ${accountProgress.toneTitle}…`
                  : `${accountProgress.toneTitle} — ${accountProgress.status}`}{' '}
              {accountProgress.currentTone}/{accountProgress.totalTones} tones
            </p>
          )}
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
            {pagedLibrary.map((entry) => (
              <li key={entry.id} className={cardClass}>
                <button
                  type="button"
                  className={styles.cardHeader}
                  onClick={() => setDetailTone(entry.tone)}
                  aria-label={`View details for ${entry.tone.title}`}
                >
                  {entry.imageUrl && (
                    <div className={styles.cardImageContainer}>
                      <img
                        src={entry.imageUrl}
                        alt=""
                        className={styles.cardImage}
                        loading="lazy"
                        draggable={false}
                      />
                    </div>
                  )}
                  <span className={styles.cardInfo}>
                    <span className={styles.cardTitle}>{entry.name}</span>
                    <span className={`label ${styles.cardMeta}`}>
                      {entry.creator} · {entry.kind.toUpperCase()}
                      {entry.toneTitle ? ` · ${entry.toneTitle}` : ''}
                    </span>
                    {entry.tone?.gear && (
                      <span className={`label ${styles.cardCredit}`}>
                        {entry.tone.gear} · {entry.tone.format.toUpperCase()}
                      </span>
                    )}
                  </span>
                </button>

                <div className={styles.cardActions}>
                  <OutlineButton
                    title="Model Details"
                    onClick={() => setDetailTone(entry.tone)}
                    aria-label={`View details for ${entry.tone.title}`}
                  >
                    <MixerIcon size={16} />
                  </OutlineButton>
                  <OutlineButton disabled={!target} onClick={() => void reloadFromLibrary(entry)}>
                    LOAD
                  </OutlineButton>
                  <OutlineButton
                    variant="danger"
                    onClick={() => void Tone3000Library.remove(entry.id)}
                    aria-label={`Remove ${entry.name} from library`}
                  >
                    <CloseIcon size={16} />
                  </OutlineButton>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={libraryTotalPages} onPageChange={setPage} />
        </div>
      )}

      {detailTone && (
        <NamModelDetails
          open={!!detailTone}
          onClose={() => setDetailTone(null)}
          kindLabel={GEAR_LABELS[gear] ?? gear}
          loadedName={null}
          entry={
            {
              id: `tone3000:${slot}:${detailTone.id}`,
              kind: slot,
              name: detailTone.title,
              creator: detailTone.user.username,
              sourceUrl: detailTone.url,
              toneTitle: detailTone.title,
              imageUrl: detailTone.images?.[0] ?? null,
              importedAt: Date.now(),
              tone: {
                id: detailTone.id,
                title: detailTone.title,
                description: detailTone.description,
                gear: detailTone.gear,
                format: detailTone.format,
                license: detailTone.license,
                images: detailTone.images ?? null,
                sizes: detailTone.sizes ?? [],
                makes: (detailTone.makes ?? []).map((m) => m.name) as unknown as Make[],
                tags: (detailTone.tags ?? []).map((t) => t.name) as unknown as Tag[],
                downloads_count: detailTone.downloads_count,
                favorites_count: detailTone.favorites_count,
                models_count: detailTone.models_count,
                user: detailTone.user,
                created_at: detailTone.created_at ?? null,
                url: detailTone.url,
                user_id: detailTone.user_id,
                is_public: detailTone.is_public,
                links: detailTone.links,
              },
              model: null,
            } as Tone3000LibraryEntry
          }
          slot={slot}
          blockId={browser.target?.blockId ?? null}
          loadTarget={target}
          audioContext={context}
        />
      )}

      <footer className={styles.footerWrapper}>
        <div className={styles.footer}>
          <span className={`label ${styles.footerText}`}>
            Neural Amp Modeler Models &amp; IRs via{' '}
            <a href="https://www.tone3000.com" target="_blank" rel="noreferrer">
              TONE3000
            </a>
          </span>
        </div>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </footer>
    </Dialog>
  )
}
