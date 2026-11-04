/**
 * Scores entered on the course must survive a bad signal or the browser closing:
 * - drafts are kept in this browser while a card or round is being entered;
 * - a submission made without a connection waits in an outbox and is sent once the phone is back
 *   online (on the next app start or when the connection returns).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { CardEntry } from '../engine';
import { api, OfflineError, type Round } from './api';

const read = <T,>(key: string): T | null => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: drafts just won't persist */
  }
};

/** State that is also saved in this browser under `key`, so it survives reloads (null: memory only). */
export function useDraft<T>(key: string | null, initial: () => T): [T, (v: T) => void, () => void] {
  const [value, setValue] = useState<T>(() => (key ? read<T>(key) : null) ?? initial());
  const set = useCallback(
    (v: T) => {
      setValue(v);
      if (key) write(key, v);
    },
    [key],
  );
  const clear = useCallback(() => key && write(key, null), [key]);
  return [value, set, clear];
}

export const hasDraft = (key: string) => read(key) != null;
export const readDraft = <T,>(key: string) => read<T>(key);
export const clearDraft = (key: string) => write(key, null);

// ---------- outbox ----------

export type Job =
  | { kind: 'card'; seasonId: number; week: number; cards: CardEntry[]; label: string }
  | { kind: 'round'; round: Round; label: string };

interface Queued {
  id: string;
  job: Job;
  /** Set when the server refused it (e.g. invalid), so the user can see why. */
  error?: string;
}

const OUTBOX = 'golf-league.outbox';
const listeners = new Set<() => void>();
let snapshot: Queued[] = read<Queued[]>(OUTBOX) ?? [];

const save = (items: Queued[]) => {
  snapshot = items;
  write(OUTBOX, items.length ? items : null);
  listeners.forEach((l) => l());
};

const run = (job: Job) => (job.kind === 'card' ? api.submitCard(job.seasonId, job.week, job.cards) : api.saveRound(job.round));

/**
 * Send now if possible. Without a connection the job is queued and `queued` is returned; any other
 * failure (the server said no) is thrown so the screen can show it.
 */
export async function send<T = Awaited<ReturnType<typeof run>>>(job: Job): Promise<{ queued: true } | { queued: false; result: T }> {
  try {
    return { queued: false, result: (await run(job)) as T };
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    save([...snapshot, { id: `${Date.now()}-${Math.random()}`, job }]);
    return { queued: true };
  }
}

let flushing = false;

/** Try to send everything waiting in the outbox. */
export async function flush(): Promise<void> {
  if (flushing || !snapshot.some((q) => !q.error)) return;
  flushing = true;
  try {
    for (const q of snapshot.filter((x) => !x.error)) {
      try {
        await run(q.job);
        save(snapshot.filter((x) => x.id !== q.id));
      } catch (e) {
        if (e instanceof OfflineError) break;
        save(snapshot.map((x) => (x.id === q.id ? { ...x, error: (e as Error).message } : x)));
      }
    }
  } finally {
    flushing = false;
  }
}

export const dismiss = (id: string) => save(snapshot.filter((x) => x.id !== id));

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush());
  setTimeout(() => void flush(), 1500);
}

/** What's waiting to be sent; re-renders when it changes. Retries when the app comes back to the foreground. */
export function useOutbox(): Queued[] {
  useEffect(() => {
    const onShow = () => document.visibilityState === 'visible' && void flush();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
