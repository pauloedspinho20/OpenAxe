import { STORE_SESSIONS, withStore } from '../storage/db'
import type { SessionState } from './types'

export async function saveSession(session: SessionState): Promise<void> {
  await withStore<IDBValidKey>(STORE_SESSIONS, 'readwrite', (store) => store.put(session))
}

export async function getSession(id: string): Promise<SessionState | null> {
  const result = await withStore<SessionState | undefined>(STORE_SESSIONS, 'readonly', (store) =>
    store.get(id),
  )
  return result ?? null
}

export async function listSessions(): Promise<SessionState[]> {
  return withStore<SessionState[]>(STORE_SESSIONS, 'readonly', (store) => store.getAll())
}

export async function deleteSession(id: string): Promise<void> {
  await withStore<undefined>(STORE_SESSIONS, 'readwrite', (store) => store.delete(id))
}
