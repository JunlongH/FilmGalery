// N4-5: Albums tab tests
//
// Covers:
//   1. Film mode: AlbumsHomeScreen renders the胶片 Collections grid
//      (CollectionsAlbumsScreen). /api/tags is called with mode=film and
//      the tag name + photo count render.
//   2. Digital mode: switching AppMode to 'digital' renders the数码 album
//      list (DigitalAlbumListScreen). /api/albums is fetched and the album
//      title renders (regression guard after migrating the screen into
//      AlbumsStack and relocating its create affordance into the list header).
//
// Mocks: api/client (URL capture), CachedImage + Icon (stub heavy native deps).

import React from 'react';
import { Provider as PaperProvider } from 'react-native-paper';
import TestRenderer, { act } from 'react-test-renderer';

const mockGet = jest.fn();
jest.mock('@react-navigation/native', () => {
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
    useRoute: () => ({ params: undefined }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const R = require('react');
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

import AlbumsHomeScreen from '../src/screens/albums/AlbumsHomeScreen';
import { ApiContext } from '../src/context/ApiContext';
import { AppModeProvider, useAppMode } from '../src/context/AppModeContext';
import { invalidateQueries } from '../src/api/queryCache';

const BASE = 'http://test.local';

function filmTag(id: number) {
  return {
    id,
    name: `Collection ${id}`,
    photos_count: 10 + id,
    cover_thumb: `tag${id}.jpg`,
  };
}

function digitalAlbum(id: number) {
  return {
    id,
    title: `Album ${id}`,
    photo_count: 20 + id,
    cover_thumb: `album${id}.jpg`,
  };
}

function defaultResponder(url: string) {
  if (url.includes('/api/tags')) {
    return [filmTag(1), filmTag(2)];
  }
  if (url.includes('/api/albums')) {
    return [digitalAlbum(5)];
  }
  if (url.includes('/api/digital-sessions')) {
    return [];
  }
  return [];
}

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation(async (url: string) => defaultResponder(url));
  modeSetter = null;
  invalidateQueries();
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

function renderAlbums() {
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
            React.createElement(AlbumsHomeScreen, null),
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

describe('Albums tab (N4)', () => {
  test('film mode renders Collections grid and fetches /api/tags?mode=film', async () => {
    let r: any;
    await act(async () => {
      r = renderAlbums();
    });
    await settle(r);

    const tagsCalls = callsContaining('/api/tags');
    expect(tagsCalls.length).toBeGreaterThan(0);
    expect(tagsCalls[0][1]).toMatchObject({ mode: 'film' });

    const texts = allText(r);
    expect(texts.some((s) => /Collection 1/.test(s))).toBe(true);
    expect(texts.some((s) => /11 张照片|11 photos/.test(s))).toBe(true);
  });

  test('digital mode renders album list and fetches /api/albums', async () => {
    let r: any;
    await act(async () => {
      r = renderAlbums();
    });
    await settle(r);

    await act(async () => {
      modeSetter!('digital');
    });
    await settle(r);

    const albumsCalls = callsContaining('/api/albums');
    expect(albumsCalls.length).toBeGreaterThan(0);

    const texts = allText(r);
    expect(texts.some((s) => /Album 5/.test(s))).toBe(true);
  });
});
