import { STORE_TAKES, withStore } from '../storage/db'
import type { Take } from './types'

export async function saveTake(take: Take): Promise<void> {
  await withStore<IDBValidKey>(STORE_TAKES, 'readwrite', (store) => store.put(take))
}

export async function getTake(id: string): Promise<Take | null> {
  const result = await withStore<Take | undefined>(STORE_TAKES, 'readonly', (store) =>
    store.get(id),
  )
  return result ?? null
}

export async function deleteTake(id: string): Promise<void> {
  await withStore<undefined>(STORE_TAKES, 'readwrite', (store) => store.delete(id))
}

export async function listTakes(): Promise<Take[]> {
  return withStore<Take[]>(STORE_TAKES, 'readonly', (store) => store.getAll())
}
