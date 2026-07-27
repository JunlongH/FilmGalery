// N5: LibraryScreen ("More" tab) tests.
//
// Covers:
//   1. Film mode renders the 7 film entries (Favorites / Collections / Stats /
//      Films / Equipment / Inventory / ShotLog) in the new mode-aware list.
//   2. Digital mode renders the 4 digital entries (Favorites / Stats /
//      Sessions / Map) after switching AppMode to 'digital'.
//   3. Tapping a row calls navigation.navigate with the entry's target +
//      params (verifies the wire-up rather than just label rendering).
//
// Mocks: api/client (not used by LibraryScreen itself, but AppModeProvider /
// nested contexts may pull it in via the tree), navigation (jest fn capture),
// lucide + expo icons (stub heavy native deps).

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
  api: { http: { get: jest.fn() } },
  subscribeApiErrors: () => () => {},
}));

// W5: LibraryScreen now calls getFilmItems() to resolve the active "loaded"
// film before navigating to ShotLog. Mock it per-test via jest.fn().
jest.mock('../src/api/filmItems', () => ({
  getFilmItems: jest.fn(),
}));

// QuickMeterSheet is rendered inline by LibraryScreen (for the multi-loaded
// case). Stub it to a lightweight component that exposes a testID reflecting
// the `visible` prop so tests can assert the picker opens.
jest.mock('../src/components/metering/QuickMeterSheet', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return function FakeQuickMeterSheet(props: any) {
    if (!props.visible) return null;
    return R.createElement(V, { testID: 'quick-meter-sheet' });
  };
});

jest.mock('../src/components/CachedImage', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return function FakeCachedImage(props: any) {
    return R.createElement(V, { testID: props.testID || 'cached-image' });
  };
});

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return function FakeIcon() {
    return R.createElement(V, { testID: 'mc-icon' });
  };
});

jest.mock('lucide-react-native', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return new Proxy(
    {},
    {
      get: () => (props: any) => R.createElement(V, { testID: props.testID || 'lucide-icon' }),
    },
  );
});

import LibraryScreen from '../src/screens/library/LibraryScreen';
import { ApiContext } from '../src/context/ApiContext';
import { AppModeProvider, useAppMode } from '../src/context/AppModeContext';
import { getFilmItems } from '../src/api/filmItems';

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

function renderLibrary() {
  const r = TestRenderer.create(
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
            React.createElement(LibraryScreen, null),
          ),
        ),
      ),
    ),
  );
  lastRenderer = r;
  return r;
}

async function settle(ticks = 4) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise<void>((res) => setImmediate(() => res()));
    });
  }
}

function allText(r: any): string[] {
  return r.root
    .findAllByType('Text')
    .map((n: any) => n.props?.children)
    .filter((s: any) => typeof s === 'string') as string[];
}

function pressEntry(r: any, testID: string) {
  const matches = r.root.findAllByProps({ testID });
  if (matches.length === 0) throw new Error(`no node with testID=${testID}`);
  // TouchableOpacity forwards onPress to a nested responder; fire the prop
  // directly to simulate the row tap.
  const target = matches[0];
  const onPress = target.props.onPress;
  if (typeof onPress !== 'function') {
    throw new Error(`node with testID=${testID} has no onPress prop`);
  }
  onPress();
}

beforeEach(async () => {
  mockNavigate.mockReset();
  modeSetter = null;
  (getFilmItems as jest.Mock).mockReset();
  // Suppress the Alert popup in tests by default; individual tests override.
  jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  // AppModeProvider reads `library_mode@<baseUrl>` from AsyncStorage on mount.
  // The jest mock is an in-memory store that persists across tests, so a
  // 'digital' written by an earlier mode-switch test would leak in and start
  // the next test in digital mode (hiding the film-only ShotLog entry). Clear
  // it before each test.
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

describe('LibraryScreen / "More" tab (N5)', () => {
  test('film mode renders 7 entries with localized labels', async () => {
    let r: any;
    await act(async () => {
      r = renderLibrary();
    });
    await settle();

    const texts = allText(r);
    // Default locale in tests is zh.
    const expected = [
      '收藏',
      '合集',
      '统计',
      '胶卷目录',
      '器材',
      '库存',
      '拍摄记录',
    ];
    for (const label of expected) {
      expect(texts.some((s) => s === label)).toBe(true);
    }
    // Sanity: digital-only labels must NOT render in film mode.
    expect(texts.some((s) => s === '地图')).toBe(false);
  });

  test('film entry tap navigates with mode=film (Favorites)', async () => {
    let r: any;
    await act(async () => {
      r = renderLibrary();
    });
    await settle();

    act(() => {
      pressEntry(r, 'entry-favorites');
    });
    expect(mockNavigate).toHaveBeenCalledWith('Favorites', { mode: 'film' });
  });

  test('digital mode renders 3 entries after switching mode', async () => {
    let r: any;
    await act(async () => {
      r = renderLibrary();
    });
    await settle();

    await act(async () => {
      modeSetter!('digital');
    });
    await settle();

    const texts = allText(r);
    const expected = ['收藏', '统计', '地图'];
    for (const label of expected) {
      expect(texts.some((s) => s === label)).toBe(true);
    }
    // Film-only entries must NOT render in digital mode.
    expect(texts.some((s) => s === '胶卷目录' || s === '器材' || s === '库存')).toBe(false);
  });

  test('digital Map entry navigates cross-tab to Map', async () => {
    let r: any;
    await act(async () => {
      r = renderLibrary();
    });
    await settle();

    await act(async () => {
      modeSetter!('digital');
    });
    await settle();

    act(() => {
      pressEntry(r, 'entry-map');
    });
    expect(mockNavigate).toHaveBeenCalledWith('Map', undefined);
  });

  // W5: LibraryScreen ShotLog entry must not navigate to ShotLog without an
  // itemId. It first resolves the loaded film inventory:
  //   0 items → Alert + no nav
  //   1 item  → navigate to ShotLog with that itemId
  //   many    → open QuickMeterSheet (reused as "pick loaded roll" picker)
  describe('ShotLog entry (W5)', () => {
    test('0 loaded films → Alert, no navigation', async () => {
      let r: any;
      await act(async () => {
        r = renderLibrary();
      });
      await settle();

      (getFilmItems as jest.Mock).mockResolvedValue({ items: [] });

      await act(async () => {
        pressEntry(r, 'entry-shotlog');
        // Flush the async openShotLog() promise.
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(getFilmItems).toHaveBeenCalledWith({ status: 'loaded', limit: 50 });
      expect(require('react-native').Alert.alert).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      // Picker must not open when there's nothing to pick from.
      expect(r.root.findAllByProps({ testID: 'quick-meter-sheet' })).toHaveLength(0);
    });

    test('exactly 1 loaded film → navigates directly with itemId', async () => {
      let r: any;
      await act(async () => {
        r = renderLibrary();
      });
      await settle();

      (getFilmItems as jest.Mock).mockResolvedValue({
        items: [{ id: 42, film_name: 'Portra 400' }],
      });

      await act(async () => {
        pressEntry(r, 'entry-shotlog');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('ShotLog', {
        itemId: 42,
        filmName: 'Portra 400',
      });
      // Picker not needed in the 1-item case.
      expect(r.root.findAllByProps({ testID: 'quick-meter-sheet' })).toHaveLength(0);
    });

    test('multiple loaded films → opens QuickMeterSheet picker', async () => {
      let r: any;
      await act(async () => {
        r = renderLibrary();
      });
      await settle();

      (getFilmItems as jest.Mock).mockResolvedValue({
        items: [
          { id: 1, film_name: 'Portra 400' },
          { id: 2, film_name: 'Ektar 100' },
        ],
      });

      await act(async () => {
        pressEntry(r, 'entry-shotlog');
        await Promise.resolve();
        await Promise.resolve();
      });

      // Should NOT navigate on its own — the picker takes over.
      expect(mockNavigate).not.toHaveBeenCalled();
      // Picker sheet must be mounted now (visible=true).
      expect(r.root.findAllByProps({ testID: 'quick-meter-sheet' }).length).toBeGreaterThan(0);
    });

    test('getFilmItems rejects → Alert + no navigation', async () => {
      let r: any;
      await act(async () => {
        r = renderLibrary();
      });
      await settle();

      (getFilmItems as jest.Mock).mockRejectedValue(new Error('network'));

      await act(async () => {
        pressEntry(r, 'entry-shotlog');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(require('react-native').Alert.alert).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
