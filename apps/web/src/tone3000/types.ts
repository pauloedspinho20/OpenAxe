/**
 * Tone3000 API data types - a typed subset of the reference client's
 * src/types.ts (github.com/tone-3000/api), kept here so the app only carries
 * the shapes it actually uses.
 */

/** Determines where a tone lands in the rack when imported. */
export type Tone3000Slot = 'model' | 'ir'

export interface PaginatedResponse<T> {
  data: T[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export interface EmbeddedUser {
  id: string
  username: string
  avatar_url: string | null
  url: string
}

export interface User extends EmbeddedUser {
  bio: string | null
  links: string[] | null
  created_at: string
  updated_at: string
}

export interface PublicMake {
  id: number
  name: string
  tones_count: number
  url: string
}

export interface PublicTag {
  id: number
  name: string
  tones_count: number
  url: string
}

export interface Make {
  id?: number
  name: string
}

export interface Tag {
  id?: number
  name: string
}

export type Gear = 'amp' | 'amp-cab' | 'pedal' | 'cab' | 'outboard' | 'space' | 'experimental'

export type ToneFormat = 'nam' | 'ir' | 'aida-x' | 'aa-snapshot' | 'proteus'

export interface Tone {
  id: number
  user_id: string
  user: EmbeddedUser
  created_at?: string
  updated_at?: string
  title: string
  description: string | null
  gear: Gear
  images: string[] | null
  is_public: boolean | null
  links: string[] | null
  format: ToneFormat
  license: string
  sizes: string[]
  makes: Make[]
  tags: Tag[]
  models_count: number
  downloads_count: number
  favorites_count: number
  url: string
}

export type ArchitectureVersion = '1' | '2' | 'custom'

export interface Tone3000Model {
  id: number
  created_at: string
  updated_at: string
  user_id: string
  model_url: string
  name: string
  size: string
  architecture_version: ArchitectureVersion
  tone_id: number
}

export type TonesSort = 'best-match' | 'newest' | 'oldest' | 'trending' | 'downloads-all-time'

export type FormatFilter = ToneFormat

export interface SearchTonesParams {
  query?: string
  page?: number
  pageSize?: number
  sort?: TonesSort
  gears?: Gear[]
  format?: FormatFilter
  sizes?: string[]
  architecture?: number | 'custom'
  tags?: string[]
  makes?: string[]
  creators?: string[]
}

/** Library filter params exposed by the tones/created|favorited endpoints. */
export interface ListUserTonesParams {
  page?: number
  pageSize?: number
  gear?: Gear
}

/** OAuth token triples, as issued/refreshed by the token endpoint. */
export interface T3KTokens {
  access_token: string
  refresh_token: string
  /** Unix timestamp (ms) when the access token expires. */
  expires_at: number
}

export type OAuthCallbackResult = { ok: true; tokens: T3KTokens } | { ok: false; error: string }
