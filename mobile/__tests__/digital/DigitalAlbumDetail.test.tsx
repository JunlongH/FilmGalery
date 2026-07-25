// C-11: DigitalAlbumDetailScreen component tests.
//
// Covers:
//   1. Load: shows album title + photo grid.
//   2. Long-press a photo → action sheet shows 3 actions
//      (addToAlbum / setCover / removeFromAlbum).
//   3. "Add to other album" flow: picker's onSelect(targetId) → POST
//      /api/albums/:id/photos → snackbar shows.
//   4. "Remove from this album" flow: DELETE /api/albums/:id/photos/:pid →
//      photo filtered out of grid.
//   5. "Set as cover" flow: POST /api/albums/:id/cover → snackbar shows.
//
// Mocks: DigitalPhotoGrid (deterministic cell render + callback capture),
// AlbumPickerSheet (no real modal — its onSelect prop is exposed on a
// module-level handle), and @react-navigation.

import React from 'react';
import { Provider as PaperProvider } from 'react-native-paper';
import TestRenderer, { act } from 'react-test-renderer';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../src/api/client', () => {
  const g = (...a: any[]) => mockGet(...a);
  const p = (...a: any[]) => mockPost(...a);
  const pu = (...a: any[]) => mockPut(...a);
  const d = (...a: any[]) => mockDelete(...a);
  return {
    api: { http: { get: g, post: p, put: pu, delete: d } },
    subscribeApiErrors: () => () => {},
  };
});

let gridProps: any = null;
jest.mock('../../src/components/digital/DigitalPhotoGrid', () => {
  const R = require('react');
  const { View } = require('react-native');
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
    );
  };
});

let pickerProps: any = null;
jest.mock('../../src/components/digital/AlbumPickerSheet', () => {
  const R = require('react');
  return function MockPicker(props: any) {
    pickerProps = props;
    return null;
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: { id: 7, title: 'My Album' } }),
}));

import DigitalAlbumDetailScreen from '../../src/screens/library/DigitalAlbumDetailScreen';
import { ApiContext } from '../../src/context/ApiContext';
import { invalidateQueries, setQueryData } from '../../src/api/queryCache';

const BASE = 'http://test.local';
const ALBUM_ID = 7;

function makePhoto(id: number) {
  return { id, source_type: 'digital', positive_thumb_rel_path: `t${id}.jpg` };
}

function labelsOf(r: any): string[] {
  return r.root.findAllByType('Text').map((n: any) => n.props?.children).filter((s: any) => typeof s === 'string') as string[];
}

// Find the onPress handler wrapping a given literal label. The action-sheet
// renders label inside <Text>; we find that Text node then walk up the parent
// chain until we hit an ancestor with an `onPress` prop (the TouchableOpacity
// or Pressable that fires the action). Paper Portal re-parents modal content,
// so structural walks from the touchable downward are unreliable.
function findBtnOnPressByLabel(r: any, label: string): (() => void) | undefined {
  const textNode = r.root.findAllByType('Text').find((n: any) => n.props?.children === label);
  if (!textNode) return undefined;
  let cursor: any = textNode.parent;
  while (cursor) {
    if (cursor.props && typeof cursor.props.onPress === 'function') {
      return cursor.props.onPress;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function renderScreen() {
  return TestRenderer.create(
    React.createElement(
      PaperProvider,
      null,
      React.createElement(
        ApiContext.Provider,
        { value: { baseUrl: BASE } as any },
        React.createElement(DigitalAlbumDetailScreen),
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
  gridProps = null;
  pickerProps = null;
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe('DigitalAlbumDetailScreen (C-11)', () => {
  test('loads album title + photo grid', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === `/api/albums/${ALBUM_ID}/photos`) {
        return Promise.resolve([makePhoto(1), makePhoto(2), makePhoto(3)]);
      }
      if (path === `/api/albums/${ALBUM_ID}`) {
        return Promise.resolve({ id: ALBUM_ID, title: 'Vacation 2024' });
      }
      return Promise.resolve([]);
    });

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);

    const texts = labelsOf(r);
    expect(texts.some((s: string) => s === 'Vacation 2024')).toBe(true);
    expect(gridProps.photos).toHaveLength(3);
  });

  test('long-press photo opens action sheet with 3 actions', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === `/api/albums/${ALBUM_ID}/photos`) {
        return Promise.resolve([makePhoto(42)]);
      }
      if (path === `/api/albums/${ALBUM_ID}`) return Promise.resolve({ id: ALBUM_ID, title: 'A' });
      return Promise.resolve([]);
    });

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);

    // Initially no action sheet visible.
    expect(labelsOf(r).some((s: string) => s === '照片操作')).toBe(false);

    // Long-press the first photo via the grid's callback.
    await act(async () => { gridProps.onPhotoLongPress(makePhoto(42), 0); });
    await settle(r, 1);

    const labels = labelsOf(r);
    expect(labels).toContain('照片操作');
    expect(labels).toContain('加入其他相册');
    expect(labels).toContain('设为本相册封面');
    expect(labels).toContain('从本相册移除');
  });

  test('"add to other album" POSTs photos and shows snackbar', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === `/api/albums/${ALBUM_ID}/photos`) return Promise.resolve([makePhoto(42)]);
      if (path === `/api/albums/${ALBUM_ID}`) return Promise.resolve({ id: ALBUM_ID, title: 'A' });
      return Promise.resolve([]);
    });
    mockPost.mockResolvedValue({ ok: true });

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);

    await act(async () => { gridProps.onPhotoLongPress(makePhoto(42), 0); });
    await settle(r, 1);
    await act(async () => { findBtnOnPressByLabel(r, '加入其他相册')?.(); });
    await settle(r, 1);
    await act(async () => {
      pickerProps.onSelect(99, { id: 99, title: 'Other' });
    });
    await settle(r);

    expect(mockPost).toHaveBeenCalledWith('/api/albums/99/photos', { photo_ids: [42] });
    expect(labelsOf(r)).toContain('已加入相册');
  });

  test('"remove from this album" DELETEs and filters the photo out', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === `/api/albums/${ALBUM_ID}/photos`) {
        return Promise.resolve([makePhoto(42), makePhoto(43)]);
      }
      if (path === `/api/albums/${ALBUM_ID}`) return Promise.resolve({ id: ALBUM_ID, title: 'A' });
      return Promise.resolve([]);
    });
    mockDelete.mockResolvedValue({ ok: true });

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);
    expect(gridProps.photos).toHaveLength(2);

    // Long-press photo 42, then tap the "remove" action button.
    await act(async () => { gridProps.onPhotoLongPress(makePhoto(42), 0); });
    await settle(r, 1);

    const removeOnPress = findBtnOnPressByLabel(r, '从本相册移除');
    expect(removeOnPress).toBeTruthy();
    await act(async () => { removeOnPress!(); });
    await settle(r);

    expect(mockDelete).toHaveBeenCalledWith(`/api/albums/${ALBUM_ID}/photos/42`);
    expect(gridProps.photos.find((p: any) => p.id === 42)).toBeUndefined();
    expect(gridProps.photos).toHaveLength(1);
  });

  test('"set cover" POSTs and shows snackbar', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === `/api/albums/${ALBUM_ID}/photos`) return Promise.resolve([makePhoto(42)]);
      if (path === `/api/albums/${ALBUM_ID}`) return Promise.resolve({ id: ALBUM_ID, title: 'A' });
      return Promise.resolve([]);
    });
    mockPost.mockResolvedValue({ ok: true });

    let r: any;
    await act(async () => { r = renderScreen(); });
    await settle(r);

    await act(async () => { gridProps.onPhotoLongPress(makePhoto(42), 0); });
    await settle(r, 1);

    const setCoverOnPress = findBtnOnPressByLabel(r, '设为本相册封面');
    expect(setCoverOnPress).toBeTruthy();
    await act(async () => { setCoverOnPress!(); });
    await settle(r);

    expect(mockPost).toHaveBeenCalledWith(`/api/albums/${ALBUM_ID}/cover`, { photo_id: 42 });
    expect(labelsOf(r)).toContain('已设为封面');
  });
});
