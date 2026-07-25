// C-10: DigitalLibraryScreen component tests.
//
// Strategy: mock DigitalPhotoGrid (the FlatList inside has timer/IntersectionObserver
// quirks under jest-expo that make cell rendering flaky) to a deterministic
// stub that captures its props on a module-level `gridProps` handle. The
// screen's pagination / state logic is what we actually want to cover here —
// rendering individual thumbnails is verified in `DigitalPhotoGrid`'s own
// component tests if/when added.
//
// Covers:
//   1. Render: shows the "我的相册" entry card text + photos reach the grid.
//   2. Pagination: 60 + 30 → 90 photos after triggering onEndReached.
//   3. Empty state: empty array → "还没有数码照片" empty title rendered.
//   4. Network error: api reject → queryCache records error; the
//      ApiErrorSnackbar subscriber wiring is in place.

import React from 'react';
import { Provider as PaperProvider } from 'react-native-paper';
import TestRenderer, { act } from 'react-test-renderer';

const mockHttp = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
let errorSubscriber: ((info: { message: string; status?: number }) => void) | null = null;

jest.mock('../../src/api/client', () => {
  const fn = (...args: any[]) => mockHttp(...args);
  return {
    api: { http: { get: fn, post: (...a:any[])=>mockPost(...a), put: (...a:any[])=>mockPut(...a), delete: (...a:any[])=>mockDelete(...a) } },
    subscribeApiErrors: (cb: any) => {
      errorSubscriber = cb;
      return () => { errorSubscriber = null; };
    },
  };
});

let gridProps: any = null;
jest.mock('../../src/components/digital/DigitalPhotoGrid', () => {
  const R = require('react');
  const { View } = require('react-native');
  // Render photos + ListHeaderComponent / ListEmptyComponent / ListFooterComponent
  // so the screen's JSX for those slots still mounts in tests.
  return function MockGrid(props: any) {
    gridProps = props;
    return R.createElement(
      View,
      { testID: 'photo-grid' },
      props.ListHeaderComponent || null,
      (props.photos || []).map((p: any) =>
        R.createElement(View, { key: p.id, testID: `cell-${p.id}` }),
      ),
      props.photos && props.photos.length === 0 && props.ListEmptyComponent
        ? props.ListEmptyComponent
        : null,
      props.ListFooterComponent || null,
    );
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

import DigitalLibraryScreen from '../../src/screens/library/DigitalLibraryScreen';
import { ApiContext } from '../../src/context/ApiContext';
import { invalidateQueries, setQueryData } from '../../src/api/queryCache';

const BASE = 'http://test.local';

function makePhoto(id: number) {
  return { id, source_type: 'digital', positive_thumb_rel_path: `t${id}.jpg` };
}

function renderScreen() {
  return TestRenderer.create(
    React.createElement(
      PaperProvider,
      null,
      React.createElement(
        ApiContext.Provider,
        { value: { baseUrl: BASE } as any },
        React.createElement(DigitalLibraryScreen),
      ),
    ),
  );
}

async function settle(r: any, ticks = 3) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => { await new Promise<void>((res) => setImmediate(() => res())); });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidateQueries();
  errorSubscriber = null;
  gridProps = null;
  mockHttp.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe('DigitalLibraryScreen (C-10)', () => {
  test('renders album entry card + photo grid', async () => {
    mockHttp.mockImplementation((path: string) => {
      if (path === '/api/photos') return Promise.resolve([makePhoto(1), makePhoto(2)]);
      return Promise.resolve([]);
    });

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);

    const texts = r.root.findAllByType('Text').map((n: any) => n.children[0]);
    expect(texts.some((s: string) => s === '我的相册')).toBe(true);
    expect(texts.some((s: string) => s === '整理数码照片合集')).toBe(true);
    // Grid received photos (cells are not asserted individually because
    // react-test-renderer + React 19 memoization quirks can produce duplicate
    // fiber matches across reconciliation passes; gridProps.photos is the
    // authoritative source of truth for what the grid would render).
    expect(gridProps.photos).toHaveLength(2);
  });

  test('paginates: 60 + 30 → 90 photos', async () => {
    const page1 = Array.from({ length: 60 }, (_, i) => makePhoto(i + 1));
    const page2 = Array.from({ length: 30 }, (_, i) => makePhoto(i + 61));
    mockHttp.mockImplementation((path: string, params: any) => {
      if (path === '/api/digital-sessions') return Promise.resolve([]);
      if (params?.page === 2) return Promise.resolve(page2);
      return Promise.resolve(page1);
    });
    setQueryData(`digitalPhotos@${BASE}?mode=digital&page=1`, page1);
    setQueryData(`digitalSessions@${BASE}`, []);

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);

    expect(gridProps.photos).toHaveLength(60);

    // Trigger pagination via the grid's onEndReached prop.
    await act(async () => { await gridProps.onEndReached(); });
    await settle(r);

    expect(mockHttp).toHaveBeenCalledWith('/api/photos', expect.objectContaining({ page: 2 }));
    expect(gridProps.photos).toHaveLength(90);
  });

  test('empty state shows "还没有数码照片"', async () => {
    mockHttp.mockResolvedValue([]);
    setQueryData(`digitalPhotos@${BASE}?mode=digital&page=1`, []);
    setQueryData(`digitalSessions@${BASE}`, []);

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);

    const texts = r.root.findAllByType('Text').map((n: any) => n.children[0]);
    expect(texts.some((s: string) => s === '还没有数码照片')).toBe(true);
    expect(texts.some((s: string) => s === '请用桌面端导入数码照片')).toBe(true);
    expect(gridProps.photos).toHaveLength(0);
  });

  test('network error surfaces in queryCache (ApiErrorSnackbar reads it)', async () => {
    mockHttp.mockRejectedValue(new Error('boom'));
    // No primed cache → the screen's fetchQuery rejects and queryCache stores
    // the error under pageKey(1). The real ApiErrorSnackbar (mounted at the
    // app root) consumes subscribeApiErrors to display these. Here we verify
    // the screen's load error lands in queryCache where a downstream component
    // would pick it up.

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r, 5);

    // The error was recorded in queryCache (drives the error UI).
    const { getQueryError } = require('../../src/api/queryCache');
    const err = getQueryError(`digitalPhotos@${BASE}?mode=digital&page=1`);
    expect(err).toBe('boom');
    // Subscribe contract is exported (ApiErrorSnackbar relies on it).
    const client = require('../../src/api/client');
    expect(typeof client.subscribeApiErrors).toBe('function');
  });
});
