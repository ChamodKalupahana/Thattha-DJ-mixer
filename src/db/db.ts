import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Mix,
  MixOutput,
  Settings,
  VideoFile,
  VideoInfo,
} from './types';

const DB_NAME = 'dj-mixer';
const DB_VERSION = 1;

export const STORES = ['files', 'videos', 'mixes', 'outputs', 'settings'] as const;

export type StoreName = (typeof STORES)[number];

export interface DJMixerDB extends DBSchema {
  files: { key: string; value: VideoFile };
  videos: { key: string; value: VideoInfo };
  mixes: { key: string; value: Mix };
  outputs: { key: string; value: MixOutput };
  settings: { key: string; value: Settings };
}

let dbPromise: Promise<IDBPDatabase<DJMixerDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<DJMixerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DJMixerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllRecords<S extends StoreName>(
  store: S,
): Promise<DJMixerDB[S]['value'][]> {
  const db = await getDB();
  return db.getAll(store);
}

export async function getRecord<S extends StoreName>(
  store: S,
  key: string,
): Promise<DJMixerDB[S]['value'] | undefined> {
  const db = await getDB();
  return db.get(store, key);
}

export async function putRecord<S extends StoreName>(
  store: S,
  key: string,
  value: DJMixerDB[S]['value'],
): Promise<void> {
  const db = await getDB();
  await db.put(store, value, key);
}

export async function putRecords<S extends StoreName>(
  store: S,
  items: { key: string; value: DJMixerDB[S]['value'] }[],
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all(items.map(({ key, value }) => tx.store.put(value, key)));
  await tx.done;
}

export async function deleteRecord<S extends StoreName>(
  store: S,
  key: string,
): Promise<void> {
  const db = await getDB();
  await db.delete(store, key);
}

export async function clearStore<S extends StoreName>(store: S): Promise<void> {
  const db = await getDB();
  await db.clear(store);
}