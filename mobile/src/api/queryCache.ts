type Fetcher<T> = () => Promise<T>;
type Listener = () => void;

interface Entry<T> {
  data?: T;
  error?: string;
  updatedAt: number;
  promise?: Promise<T>;
}

const DEFAULT_TTL = 60_000;

const store = new Map<string, Entry<any>>();
const listeners = new Map<string, Set<Listener>>();

function emit(key: string): void {
  listeners.get(key)?.forEach((cb) => cb());
}

export function getQueryData<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

export function getQueryError(key: string): string | undefined {
  return store.get(key)?.error;
}

export function hasQueryData(key: string): boolean {
  return store.get(key)?.data !== undefined;
}

export function subscribeQuery(key: string, cb: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(key);
  };
}

function setEntry<T>(key: string, patch: Partial<Entry<T>>): void {
  const prev = store.get(key) ?? { updatedAt: 0 };
  store.set(key, { ...prev, ...patch } as Entry<T>);
  emit(key);
}

export function invalidateQueries(prefix?: string): void {
  if (!prefix) {
    store.clear();
    listeners.forEach((set) => set.forEach((cb) => cb()));
    return;
  }
  for (const key of [...store.keys()]) {
    if (key === prefix || key.startsWith(prefix)) {
      store.delete(key);
      emit(key);
    }
  }
}

export function setQueryData<T>(key: string, data: T): void {
  setEntry(key, { data, error: undefined, updatedAt: Date.now() });
}

export async function fetchQuery<T>(
  key: string,
  fetcher: Fetcher<T>,
  ttl: number = DEFAULT_TTL,
): Promise<T> {
  const existing = store.get(key) as Entry<T> | undefined;
  if (existing?.data !== undefined && Date.now() - existing.updatedAt < ttl) {
    return existing.data;
  }
  if (existing?.promise) {
    return existing.promise;
  }
  const promise = fetcher()
    .then((data) => {
      setEntry(key, { data, error: undefined, updatedAt: Date.now(), promise: undefined });
      return data;
    })
    .catch((err) => {
      setEntry(key, {
        error: err instanceof Error ? err.message : String(err),
        promise: undefined,
      });
      throw err;
    });
  setEntry(key, { promise });
  return promise;
}
