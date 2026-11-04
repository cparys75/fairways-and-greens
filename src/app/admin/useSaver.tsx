import { useState } from 'react';
import { useSeason } from '../season';

/** Runs a save, then reloads the season so every page shows recalculated results. */
export function useSaver() {
  const { reload } = useSeason();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok = 'Saved') => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await reload();
      setMessage({ kind: 'ok', text: ok });
      return true;
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const view = message && <span className={message.kind === 'ok' ? 'ok' : 'error'}>{message.text}</span>;
  return { busy, run, view, setMessage };
}
