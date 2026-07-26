// C1: HomeScreen Rules-of-Hooks regression test.
//
// Previously HomeScreen had an early `if (mode === 'digital') return
// <DigitalTimelineScreen/>` BEFORE its useApiQuery / useMemo / useRef /
// useFocusEffect hooks. Switching AppMode therefore flipped the active hook
// count mid-mount and would crash React ("Rendered fewer hooks than
// expected"). HomeScreen is now a pure conditional dispatcher; each branch
// owns its own hooks.
//
// These tests mount HomeScreen in film mode, switch to digital, switch back,
// and assert (a) no React hook-count error is thrown and (b) the right child
// screen is rendered for each mode. We don't exercise the heavy data hooks
// inside each child (they're mocked) — the contract being tested is the
// dispatcher structure, not the data fetching.

import React from 'react';
import { Provider as PaperProvider } from 'react-native-paper';
import TestRenderer, { act } from 'react-test-renderer';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setOptions: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const R = require('react');
    R.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, []);
  },
}));

jest.mock('../src/api/client', () => ({
  api: { http: { get: jest.fn(() => Promise.resolve([])) } },
  subscribeApiErrors: () => () => {},
}));

jest.mock('../src/hooks/useApiQuery', () => ({
  useApiQuery: () => ({
    data: [],
    error: null,
    loading: false,
    refreshing: false,
    refresh: jest.fn(),
  }),
}));

jest.mock('../src/api/queryCache', () => ({
  fetchQuery: jest.fn(() => Promise.resolve([])),
  getQueryData: () => undefined,
  getQueryError: () => undefined,
  invalidateQueries: jest.fn(),
  setQueryData: jest.fn(),
  subscribeQuery: () => () => {},
}));

jest.mock('../src/components/CachedImage', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return function FakeCachedImage() {
    return R.createElement(V, { testID: 'cached-image' });
  };
});

jest.mock('../src/components/SkeletonBox', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return function FakeSkeletonBox() {
    return R.createElement(V, { testID: 'skeleton' });
  };
});

jest.mock('lucide-react-native', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return new Proxy(
    {},
    { get: () => (props: any) => R.createElement(V, { testID: props.testID || 'lucide-icon' }) },
  );
});

jest.mock('../src/components/metering/QuickMeterSheet', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return function FakeQuickMeterSheet(props: any) {
    if (!props.visible) return null;
    return R.createElement(V, { testID: 'quick-meter-sheet' });
  };
});

import HomeScreen from '../src/screens/timeline/HomeScreen';
import DigitalTimelineScreen from '../src/screens/timeline/DigitalTimelineScreen';
import FilmTimelineScreen from '../src/screens/timeline/FilmTimelineScreen';
import { ApiContext } from '../src/context/ApiContext';
import { AppModeProvider, useAppMode } from '../src/context/AppModeContext';

const BASE = 'http://test.local';

let lastRenderer: any = null;
let modeSetter: ((m: 'film' | 'digital') => void) | null = null;

function ModeSetterProbe() {
  const { setMode } = useAppMode();
  React.useEffect(() => {
    modeSetter = setMode;
  });
  return null;
}

async function renderHome(initialMode?: 'film' | 'digital') {
  let r: any;
  await act(async () => {
    r = TestRenderer.create(
      React.createElement(
        ApiContext.Provider,
        { value: { baseUrl: BASE } as any },
        React.createElement(
          AppModeProvider,
          null,
          React.createElement(
            PaperProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(ModeSetterProbe, null),
              React.createElement(HomeScreen, { navigation: { navigate: mockNavigate, setOptions: jest.fn() } }),
            ),
          ),
        ),
      ),
    );
  });
  lastRenderer = r;
  // ModeSetterProbe assigns modeSetter in its useEffect; by the time act()
  // returns it should be populated. If an initial mode other than the default
  // 'film' is requested, switch now and let effects flush.
  if (initialMode && initialMode !== 'film' && modeSetter) {
    await act(async () => {
      modeSetter!(initialMode);
    });
  }
  return r;
}

async function settle(ticks = 4) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise<void>((res) => setImmediate(() => res()));
    });
  }
}

beforeEach(async () => {
  mockNavigate.mockReset();
  modeSetter = null;
  // AppModeProvider reads `library_mode@<baseUrl>` from AsyncStorage on mount.
  // The jest mock is an in-memory store that persists across tests, so a
  // 'digital' written by a previous test would leak in and flip the next
  // test's initial mode. Clear it before each test.
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
});

afterEach(() => {
  if (lastRenderer) {
    try {
      lastRenderer.unmount();
    } catch {
      /* already unmounted */
    }
    lastRenderer = null;
  }
});

describe('HomeScreen conditional dispatcher (C1)', () => {
  test('film mode renders FilmTimelineScreen and not DigitalTimelineScreen', async () => {
    const r: any = await renderHome();
    await settle();

    expect(r.root.findAllByType(FilmTimelineScreen).length).toBe(1);
    expect(r.root.findAllByType(DigitalTimelineScreen).length).toBe(0);
  });

  test('digital mode renders DigitalTimelineScreen and not FilmTimelineScreen', async () => {
    const r: any = await renderHome('digital');
    await settle();

    expect(r.root.findAllByType(DigitalTimelineScreen).length).toBe(1);
    expect(r.root.findAllByType(FilmTimelineScreen).length).toBe(0);
  });

  test('switching film → digital → film does not crash (Rules of Hooks)', async () => {
    // The pre-fix bug: film mode used N hooks (useApiQuery, useFocusEffect,
    // two refs, two useMemo), then digital branch returned early — so a
    // film→digital switch dropped hooks and React threw. After extraction,
    // HomeScreen itself uses only useAppMode() regardless of mode.
    const r: any = await renderHome();
    await settle();
    expect(r.root.findAllByType(FilmTimelineScreen).length).toBe(1);

    await act(async () => {
      modeSetter!('digital');
    });
    await settle();
    expect(r.root.findAllByType(DigitalTimelineScreen).length).toBe(1);
    expect(r.root.findAllByType(FilmTimelineScreen).length).toBe(0);

    await act(async () => {
      modeSetter!('film');
    });
    await settle();
    expect(r.root.findAllByType(FilmTimelineScreen).length).toBe(1);
    expect(r.root.findAllByType(DigitalTimelineScreen).length).toBe(0);

    // And one more bounce to be sure.
    await act(async () => {
      modeSetter!('digital');
    });
    await settle();
    expect(r.root.findAllByType(DigitalTimelineScreen).length).toBe(1);
  });
});
