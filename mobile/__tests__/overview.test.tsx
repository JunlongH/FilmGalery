// N2-6: OverviewScreen tests
//
// Covers:
//   1. Renders hero / quick-stats / browse sections with film data, and
//      asserts the underlying fetches carry the active mode in their URL
//      (the cache key includes #${mode}, so a switch re-fetches).
//   2. Switching AppMode from 'film' → 'digital' triggers new fetches whose
//      request URL includes mode=digital.
//   3. Empty state: when every data source returns empty, OverviewScreen
//      renders the screen-level empty placeholder rather than the carousel.
//
// Mocks: api/client (URL capture), expo-linear-gradient + CachedImage +
// TouchScale + Icon (stub heavy native deps).

import React from 'react';
import { View } from 'react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import TestRenderer, { act } from 'react-test-renderer';

const mockGet = jest.fn();
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useRoute: () => ({ params: undefined }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      R.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, []);
    },
  };
});

jest.mock('../src/api/client', () => ({
  api: { http: { get: (...a: any[]) => mockGet(...a) } },
  subscribeApiErrors: () => () => {},
}));

jest.mock('expo-linear-gradient', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return {
    LinearGradient: function FakeGradient(props: any) {
      return R.createElement(V, { testID: 'gradient' }, props.children);
    },
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

import OverviewScreen from '../src/screens/overview/OverviewScreen';
import { ApiContext } from '../src/context/ApiContext';
import { AppModeProvider, useAppMode } from '../src/context/AppModeContext';
import { invalidateQueries } from '../src/api/queryCache';

const BASE = 'http://test.local';

function filmPhoto(id: number) {
  return {
    id,
    positive_rel_path: `p${id}.jpg`,
    positive_thumb_rel_path: `t${id}.jpg`,
    source_type: 'film',
    roll_id: 1,
    date_taken: '2024-01-15T10:00:00Z',
    camera: 'Leica M6',
    caption: `Photo ${id}`,
  };
}

function digitalPhoto(id: number) {
  return {
    id,
    positive_rel_path: `d${id}.jpg`,
    positive_thumb_rel_path: `dt${id}.jpg`,
    source_type: 'digital',
    date_taken: '2024-02-15T10:00:00Z',
    camera: 'Fujifilm X-T5',
    caption: `Digital ${id}`,
  };
}

function defaultResponder(url: string) {
  if (url.includes('/api/photos/random')) {
    return [filmPhoto(1), filmPhoto(2), filmPhoto(3)];
  }
  if (url.includes('/api/stats/summary')) {
    return { total_rolls: 5, total_photos: 100, total_digital_photos: 50 };
  }
  if (url.includes('/api/photos/favorites')) {
    return [{ id: 1 }, { id: 2 }];
  }
  if (url.includes('/api/stats/locations')) {
    return [{ city_name: 'Shanghai' }, { city_name: 'Tokyo' }];
  }
  if (url.includes('/api/albums')) {
    return [{ id: 1, title: 'Trip' }];
  }
  if (url.includes('/api/photos')) {
    return [filmPhoto(10), filmPhoto(11)];
  }
  return [];
}

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation(async (url: string) => defaultResponder(url));
  modeSetter = null;
  // Clear any cached query data leaked from a previous test (useApiQuery
  // reads from a module-level store).
  invalidateQueries();
});

afterEach(() => {
  // Unmount any renderer the test forgot to tear down, so query-cache
  // subscribers from the previous test don't leak into the next one and
  // trigger spurious refetches / act warnings.
  if (lastRenderer) {
    try {
      lastRenderer.unmount();
    } catch {
      /* already unmounted */
    }
    lastRenderer = null;
  }
});

let lastRenderer: any = null;

async function settle(ticks = 6) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise<void>((res) => setImmediate(() => res()));
    });
  }
}

let modeSetter: ((m: 'film' | 'digital') => void) | null = null;
function ModeSetterProbe() {
  const { setMode } = useAppMode();
  React.useEffect(() => {
    modeSetter = setMode;
  });
  return null;
}

function renderOverview() {
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
            React.createElement(OverviewScreen, null),
          ),
        ),
      ),
    ),
  );
  lastRenderer = r;
  return r;
}

function allText(r: any): string[] {
  return r.root
    .findAllByType('Text')
    .map((n: any) => n.props?.children)
    .filter((s: any) => typeof s === 'string') as string[];
}

function callsContaining(substr: string): any[] {
  return mockGet.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].includes(substr));
}

describe('OverviewScreen (N2)', () => {
  test('renders hero + stats + browse; fetches include mode=film', async () => {
    let r: any;
    await act(async () => {
      r = renderOverview();
    });
    await settle(r);

    const randomCalls = callsContaining('/api/photos/random');
    expect(randomCalls.length).toBeGreaterThan(0);
    expect(randomCalls[0][1]).toMatchObject({ mode: 'film', limit: 8 });

    const summaryCalls = callsContaining('/api/stats/summary');
    expect(summaryCalls.length).toBeGreaterThan(0);
    expect(summaryCalls[0][1]).toMatchObject({ mode: 'film' });

    // Browse section title rendered
    const texts = allText(r);
    expect(texts.some((s) => /浏览|Browse/.test(s))).toBe(true);

    // Entry cards rendered (testIDs we attached)
    expect(r.root.findAllByProps({ testID: 'entry-favorites' }).length).toBeGreaterThan(0);
    expect(r.root.findAllByProps({ testID: 'entry-collections' }).length).toBeGreaterThan(0);
  });

  test('switching mode to digital re-fetches with mode=digital', async () => {
    let r: any;
    await act(async () => {
      r = renderOverview();
    });
    await settle(r);

    // After initial film render, clear and switch.
    mockGet.mock.calls.length = 0;

    await act(async () => {
      modeSetter!('digital');
    });
    await settle(r);

    const randomCall = callsContaining('/api/photos/random')[0];
    expect(randomCall).toBeDefined();
    expect(randomCall[1]).toMatchObject({ mode: 'digital' });

    const summaryCall = callsContaining('/api/stats/summary')[0];
    expect(summaryCall).toBeDefined();
    expect(summaryCall[1]).toMatchObject({ mode: 'digital' });

    // Digital mode shows Albums entry, not Collections
    expect(r.root.findAllByProps({ testID: 'entry-albums' }).length).toBeGreaterThan(0);
    expect(r.root.findAllByProps({ testID: 'entry-collections' }).length).toBe(0);
  });

  test('empty state placeholder when all data sources are empty', async () => {
    mockGet.mockImplementation(async () => []);

    let r: any;
    await act(async () => {
      r = renderOverview();
    });
    await settle(r);

    const texts = allText(r);
    // overview.emptyTitle
    expect(texts.some((s) => /还没有内容|Nothing here yet/.test(s))).toBe(true);

    // Hero carousel should be hidden — no gradient rendered.
    expect(r.root.findAllByProps({ testID: 'gradient' }).length).toBe(0);
  });
});
