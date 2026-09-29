import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ReferencePage } from '../../shared/references';
export function useReferences(query: string | undefined, enabled: boolean, context: number) {
  const [result, setResult] = useState<{key:string;page:ReferencePage}>(), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0), [cursor, setCursor] = useState<string>();
  const generation = useRef(0), key = `${context}:${query ?? ''}`;
  const previousKey = useRef(key), refreshKey = useRef<string | undefined>(undefined);
  useEffect(() => { setCursor(undefined); }, [key, refresh]);
  useEffect(() => {
    const id = ++generation.current, abort = new AbortController();
    if (!enabled || query === undefined) { setCursor(undefined); setResult(undefined); setLoading(false); setError(''); return; }
    const same = previousKey.current === key; previousKey.current = key;
    const next = same ? cursor : undefined;
    if (!next) setResult(undefined);
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ query });
      if (next) params.set('cursor', next);
      if (refreshKey.current === key && !next) { params.set('refresh', 'true'); refreshKey.current = undefined; }
      void api<ReferencePage>(`/workspace/references?${params}`, undefined, abort.signal).then(value => {
        if (generation.current !== id) return;
        setResult(old => ({key, page: next && old?.key === key && old.page.revision === value.revision ? { ...value, entries: [...old.page.entries, ...value.entries] } : value}));
      }).catch(e => { if (!abort.signal.aborted && generation.current === id) setError(String(e)); }).finally(() => { if (generation.current === id) setLoading(false); });
    }, 100);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, enabled, context, cursor, refresh]);
  const page = enabled && result?.key === key ? result.page : undefined;
  return { page, error, loading, refresh: () => { refreshKey.current = key; setCursor(undefined); setRefresh(n=>n+1); }, more: () => { if (!loading && page?.next) setCursor(page.next); } };
}
