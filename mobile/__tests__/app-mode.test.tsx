import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiContext } from '../src/context/ApiContext';
import { AppModeProvider, useAppMode } from '../src/context/AppModeContext';
import { useLibraryMode } from '../src/hooks/useLibraryMode';

const BASE = 'http://test.local';
const BASE2 = 'http://test2.local';

const mockRoute: { params: any } = { params: undefined };
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockRoute.params }),
}));

async function settle(ticks = 4) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise<void>((res) => setImmediate(() => res()));
    });
  }
}

function ModeProbe({ onMode }: { onMode: (m: string) => void }) {
  const { mode } = useAppMode();
  React.useEffect(() => {
    onMode(mode);
  }, [mode, onMode]);
  return null;
}

function ModeWriter({ onSetter }: { onSetter: (s: (m: 'film' | 'digital') => void) => void }) {
  const { setMode } = useAppMode();
  React.useEffect(() => {
    onSetter(setMode);
  }, [onSetter]);
  return null;
}

function HydratedProbe({ onHydrated }: { onHydrated: (h: boolean) => void }) {
  const { hydrated } = useAppMode();
  React.useEffect(() => {
    onHydrated(hydrated);
  }, [hydrated, onHydrated]);
  return null;
}

function LibModeProbe({ onMode }: { onMode: (m: string) => void }) {
  const mode = useLibraryMode();
  React.useEffect(() => {
    onMode(mode);
  }, [mode, onMode]);
  return null;
}

function renderAppModeTree(baseUrl: string, probe: React.ReactElement) {
  return TestRenderer.create(
    React.createElement(
      ApiContext.Provider,
      { value: { baseUrl } as any },
      React.createElement(AppModeProvider, null, probe),
    ),
  );
}

beforeEach(async () => {
  mockRoute.params = undefined;
  await AsyncStorage.clear();
});

describe('AppModeContext persistence', () => {
  test('default mode is film when nothing persisted', async () => {
    const seen: string[] = [];
    const onMode = (m: string) => {
      if (seen[seen.length - 1] !== m) seen.push(m);
    };
    let r: any;
    await act(async () => {
      r = renderAppModeTree(BASE, React.createElement(ModeProbe, { onMode }));
    });
    await settle();
    expect(seen[seen.length - 1]).toBe('film');
  });

  test('reads persisted mode on mount', async () => {
    await AsyncStorage.setItem(`library_mode@${BASE}`, 'digital');
    const seen: string[] = [];
    const onMode = (m: string) => {
      if (seen[seen.length - 1] !== m) seen.push(m);
    };
    let r: any;
    await act(async () => {
      r = renderAppModeTree(BASE, React.createElement(ModeProbe, { onMode }));
    });
    await settle();
    expect(seen[seen.length - 1]).toBe('digital');
  });

  test('setMode updates consumers and writes to AsyncStorage', async () => {
    let setter: ((m: 'film' | 'digital') => void) | null = null;
    const onSetter = (s: (m: 'film' | 'digital') => void) => {
      setter = s;
    };
    const seen: string[] = [];
    const onMode = (m: string) => {
      if (seen[seen.length - 1] !== m) seen.push(m);
    };

    let r: any;
    await act(async () => {
      r = renderAppModeTree(
        BASE,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ModeWriter, { onSetter }),
          React.createElement(ModeProbe, { onMode }),
        ),
      );
    });
    await settle();
    expect(seen[seen.length - 1]).toBe('film');

    await act(async () => {
      setter!('digital');
    });
    await settle();

    expect(seen[seen.length - 1]).toBe('digital');
    expect(await AsyncStorage.getItem(`library_mode@${BASE}`)).toBe('digital');
  });

  test('changing baseUrl re-reads persisted mode', async () => {
    await AsyncStorage.setItem(`library_mode@${BASE}`, 'film');
    await AsyncStorage.setItem(`library_mode@${BASE2}`, 'digital');

    const seen: string[] = [];
    const onMode = (m: string) => {
      if (seen[seen.length - 1] !== m) seen.push(m);
    };

    const probe = React.createElement(ModeProbe, { onMode });
    let r: any;
    await act(async () => {
      r = renderAppModeTree(BASE, probe);
    });
    await settle();
    expect(seen[seen.length - 1]).toBe('film');

    await act(async () => {
      r.update(
        React.createElement(
          ApiContext.Provider,
          { value: { baseUrl: BASE2 } as any },
          React.createElement(AppModeProvider, null, probe),
        ),
      );
    });
    await settle();
    expect(seen[seen.length - 1]).toBe('digital');
  });

  test('hydrated is false on first render and true after read settles', async () => {
    const seen: boolean[] = [];
    const onHydrated = (h: boolean) => {
      if (seen[seen.length - 1] !== h) seen.push(h);
    };
    await act(async () => {
      renderAppModeTree(BASE, React.createElement(HydratedProbe, { onHydrated }));
    });
    expect(seen[0]).toBe(false);
    await settle();
    expect(seen[seen.length - 1]).toBe(true);
  });

  test('read failure warns, keeps default mode, and hydrated still becomes true', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    const modeSeen: string[] = [];
    const onMode = (m: string) => {
      if (modeSeen[modeSeen.length - 1] !== m) modeSeen.push(m);
    };
    const hydratedSeen: boolean[] = [];
    const onHydrated = (h: boolean) => {
      if (hydratedSeen[hydratedSeen.length - 1] !== h) hydratedSeen.push(h);
    };

    await act(async () => {
      renderAppModeTree(
        BASE,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ModeProbe, { onMode }),
          React.createElement(HydratedProbe, { onHydrated }),
        ),
      );
    });
    await settle();

    expect(modeSeen[modeSeen.length - 1]).toBe('film');
    expect(hydratedSeen[hydratedSeen.length - 1]).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      '[AppMode] Failed to load persisted mode:',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  test('write failure warns but mode state still updates', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    let setter: ((m: 'film' | 'digital') => void) | null = null;
    const onSetter = (s: (m: 'film' | 'digital') => void) => {
      setter = s;
    };
    const seen: string[] = [];
    const onMode = (m: string) => {
      if (seen[seen.length - 1] !== m) seen.push(m);
    };

    await act(async () => {
      renderAppModeTree(
        BASE,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ModeWriter, { onSetter }),
          React.createElement(ModeProbe, { onMode }),
        ),
      );
    });
    await settle();
    expect(seen[seen.length - 1]).toBe('film');

    await act(async () => {
      setter!('digital');
    });
    await settle();

    expect(seen[seen.length - 1]).toBe('digital');
    expect(warnSpy).toHaveBeenCalledWith(
      '[AppMode] Failed to persist mode:',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  test('hydrated resets to false on baseUrl change and true again after re-read', async () => {
    await AsyncStorage.setItem(`library_mode@${BASE}`, 'film');
    await AsyncStorage.setItem(`library_mode@${BASE2}`, 'digital');

    const seen: boolean[] = [];
    const onHydrated = (h: boolean) => {
      if (seen[seen.length - 1] !== h) seen.push(h);
    };

    const probe = React.createElement(HydratedProbe, { onHydrated });
    let r: any;
    await act(async () => {
      r = renderAppModeTree(BASE, probe);
    });
    await settle();
    expect(seen).toEqual([false, true]);

    await act(async () => {
      r.update(
        React.createElement(
          ApiContext.Provider,
          { value: { baseUrl: BASE2 } as any },
          React.createElement(AppModeProvider, null, probe),
        ),
      );
    });
    await settle();
    expect(seen).toEqual([false, true, false, true]);
  });
});

describe('useLibraryMode fallback chain', () => {
  async function readLibMode(): Promise<string> {
    const seen: string[] = [];
    const onMode = (m: string) => {
      if (seen[seen.length - 1] !== m) seen.push(m);
    };
    let r: any;
    await act(async () => {
      r = renderAppModeTree(BASE, React.createElement(LibModeProbe, { onMode }));
    });
    await settle();
    return seen[seen.length - 1];
  }

  test('explicit params.mode=digital overrides global', async () => {
    mockRoute.params = { mode: 'digital' };
    const result = await readLibMode();
    expect(result).toBe('digital');
  });

  test('explicit params.mode=film overrides global', async () => {
    await AsyncStorage.setItem(`library_mode@${BASE}`, 'digital');
    mockRoute.params = { mode: 'film' };
    const result = await readLibMode();
    expect(result).toBe('film');
  });

  test('no params falls back to global mode (film default)', async () => {
    mockRoute.params = undefined;
    const result = await readLibMode();
    expect(result).toBe('film');
  });

  test('no params falls back to persisted global mode (digital)', async () => {
    await AsyncStorage.setItem(`library_mode@${BASE}`, 'digital');
    mockRoute.params = undefined;
    const result = await readLibMode();
    expect(result).toBe('digital');
  });

  test('invalid params value (e.g. "all") falls back to global, not hardcoded film', async () => {
    await AsyncStorage.setItem(`library_mode@${BASE}`, 'digital');
    mockRoute.params = { mode: 'all' };
    const result = await readLibMode();
    expect(result).toBe('digital');
  });
});
