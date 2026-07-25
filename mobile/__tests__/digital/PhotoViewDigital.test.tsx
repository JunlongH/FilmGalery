// C-12: PhotoViewScreen digital-branch tests.
//
// Covers:
//   1. Digital photo: no negative-toggle button rendered.
//   2. Digital photo: EXIF summary line (camera · iso etc.) rendered.
//   3. Digital photo: "加入相册" and "删除照片" action buttons rendered.
//   4. Regression: film photo with negative_rel_path renders the negative
//      toggle button when anyNegatives=true.
//
// Heavy native deps are stubbed:
//   - `react-native-image-viewing` → render HeaderComponent/FooterComponent
//     directly so we can assert on the buttons they produce.
//   - `expo-file-system/legacy`, `expo-media-library`, `expo-image`,
//     CachedImage, TagEditModal, NoteEditModal, AlbumPickerSheet, ExifSheet →
//     lightweight stubs so PhotoViewScreen mounts under Node without a real
//     native image pipeline.

import React from 'react';
import { View, Text } from 'react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-image-viewing', () => {
  const R = require('react');
  return function MockImageView(props: any) {
    return R.createElement(
      R.Fragment,
      null,
      props.HeaderComponent ? props.HeaderComponent() : null,
      props.FooterComponent ? props.FooterComponent() : null,
    );
  };
});

jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-media-library', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('expo-image', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { Image: function FakeImage() { return R.createElement(View, null); } };
});

jest.mock('../../src/api/client', () => ({
  api: {
    http: { get: jest.fn().mockResolvedValue([]), post: jest.fn().mockResolvedValue({}), put: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) },
    photos: { delete: jest.fn().mockResolvedValue({}), getRandom: jest.fn() },
  },
  subscribeApiErrors: () => () => {},
}));

jest.mock('../../src/components/CachedImage', () => {
  const R = require('react');
  const { View } = require('react-native');
  return function FakeCachedImage() { return R.createElement(View, null); };
});
jest.mock('../../src/components/TagEditModal', () => () => null);
jest.mock('../../src/components/NoteEditModal', () => () => null);
jest.mock('../../src/components/digital/AlbumPickerSheet', () => () => null);
jest.mock('../../src/components/digital/ExifSheet', () => () => null);

// react-native Alert.alert — used by delete confirm. Stub to no-op.
jest.mock('react-native/Libraries/Alert/Alert', () => ({ alert: jest.fn() }), { virtual: true });

import PhotoViewScreen from '../../src/screens/viewing/PhotoViewScreen';
import { Icon } from '../../src/components/ui';
import { ApiContext } from '../../src/context/ApiContext';

const BASE = 'http://test.local';

function renderScreen(routeParams: any) {
  return TestRenderer.create(
    React.createElement(
      PaperProvider,
      null,
      React.createElement(
        ApiContext.Provider,
        { value: { baseUrl: BASE } as any },
        React.createElement(PhotoViewScreen, { route: routeParams, navigation: { goBack: jest.fn(), navigate: jest.fn() } }),
      ),
    ),
  );
}

async function settle(r: any, ticks = 3) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => { await new Promise<void>((res) => setImmediate(() => res())); });
  }
}

function findByAccessibilityLabel(r: any, label: string): any {
  // findAllByProps traverses descendants too — TouchableOpacity passes its
  // accessibilityLabel down to its internal Animated(View) child, so a single
  // labeled button can yield several matches. Use > 0 / === 0 as the
  // existence predicate instead of asserting exact counts.
  return r.root.findAllByProps({ accessibilityLabel: label });
}

function allText(r: any): string[] {
  return r.root.findAllByType('Text').map((n: any) => n.props?.children).filter((s: any) => typeof s === 'string') as string[];
}

describe('PhotoViewScreen digital branch (C-12)', () => {
  test('digital photo: no negative-toggle button, has add/delete buttons', async () => {
    const digitalPhoto = {
      id: 1,
      source_type: 'digital',
      positive_rel_path: 'p1.jpg',
      camera: 'Fujifilm X-T5',
      lens: 'XF 35mm f/1.4',
      focal_length: 35,
      aperture: '1.4',
      shutter_speed: '1/500',
      iso: 200,
      date_taken: '2024-05-01T10:00:00Z',
    };
    let r: any;
    await act(async () => {
      r = renderScreen({ params: { photo: digitalPhoto, photosKey: 'test', initialIndex: 0 } });
    });
    await settle(r);

    // Add and delete buttons present (with accessibility labels).
    expect(findByAccessibilityLabel(r, '加入相册').length).toBeGreaterThan(0);
    expect(findByAccessibilityLabel(r, '删除照片').length).toBeGreaterThan(0);

    // No negative-toggle TouchableOpacity: that button has no accessibility
    // label and renders an Icon with name "contrast" or "palette". The header
    // is rendered via the MockImageView HeaderComponent, so the digital branch
    // must NOT include the contrast/palette icon. Verify by scanning all Icon
    // names rendered.
    const iconNames = r.root.findAllByType(Icon).map((n: any) => n.props?.name);
    expect(iconNames).not.toContain('contrast');
    expect(iconNames).not.toContain('palette');
  });

  test('digital photo: renders EXIF summary line with camera + iso', async () => {
    const digitalPhoto = {
      id: 2,
      source_type: 'digital',
      positive_rel_path: 'p2.jpg',
      camera: 'Sony A7R V',
      iso: 800,
      focal_length: 85,
      aperture: '2.8',
      shutter_speed: '1/125',
    };
    let r: any;
    await act(async () => {
      r = renderScreen({ params: { photo: digitalPhoto, photosKey: 'test', initialIndex: 0 } });
    });
    await settle(r);

    const texts = allText(r);
    // exifSummary joins parts with ' · '. Camera and ISO must appear.
    const exifLine = texts.find((s) => s.includes('Sony A7R V') && s.includes('ISO 800'));
    expect(exifLine).toBeTruthy();
    expect(exifLine).toContain('85mm');
    expect(exifLine).toContain('f/2.8');
  });

  test('regression: film photo with negative renders the negative-toggle button', async () => {
    const filmPhoto = {
      id: 3,
      source_type: 'film',
      positive_rel_path: 'p3.jpg',
      negative_rel_path: 'n3.jpg',
      roll_id: 11,
      filename: 'frame_03.jpg',
    };
    let r: any;
    await act(async () => {
      r = renderScreen({ params: { photo: filmPhoto, photosKey: 'test', initialIndex: 0 } });
    });
    await settle(r);

    // Negative-toggle button present (Icon name "contrast" in positive mode).
    const iconNames = r.root.findAllByType(Icon).map((n: any) => n.props?.name);
    expect(iconNames).toContain('contrast');

    // Digital-only buttons absent.
    expect(findByAccessibilityLabel(r, '加入相册')).toHaveLength(0);
    expect(findByAccessibilityLabel(r, '删除照片')).toHaveLength(0);
  });
});
