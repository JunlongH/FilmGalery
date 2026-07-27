import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

// Root stack param list — loose typing (all params optional) to unblock the
// TS migration. Tighten to required-params later once all call-sites are
// audited. This global declaration makes useNavigation() / useRoute() across
// all screens pick up the types automatically.

export type RootStackParamList = {
  Main: undefined;
  RollDetail: { rollId?: number | string; rollName?: string } | undefined;
  TagDetail: { tagId?: number | string; tagName?: string; mode?: 'film' | 'digital' } | undefined;
  FilmRolls: { filmId?: number | string; filmName?: string } | undefined;
  PhotoView: {
    photo?: any;
    photoId?: number | string;
    rollId?: number | string;
    photosKey?: string | null;
    initialIndex?: number;
    viewMode?: string;
  } | undefined;
  Settings: undefined;
  FilmItemDetail: { itemId?: number | string; filmName?: string } | undefined;
  ShotLog: { itemId?: number | string; filmName?: string; autoOpenShotMode?: boolean } | undefined;
  EquipmentRolls: { type?: string; id?: number | string; name?: string } | undefined;
  LocationDiagnostic: undefined;
  LocationPicker: { initial?: import('@filmgallery/types').LocationPickerValue | null } | undefined;
  Favorites: { mode?: 'film' | 'digital' } | undefined;
  Collections: { mode?: 'film' | 'digital' } | undefined;
  Films: undefined;
  Negatives: undefined;
  Equipment: undefined;
  Inventory: undefined;
  Stats: { mode?: 'film' | 'digital' } | undefined;
  AISettings: undefined;
  DigitalAlbumList: undefined;
  DigitalAlbumDetail: { id: number; title?: string };
  DigitalImport: { albumId?: number; albumTitle?: string } | undefined;
  // The Albums tab. Lives in RootTabParamList too; kept here so cross-stack
  // navigation.navigate('Albums') (e.g. from BrowseSection in OverviewStack)
  // typechecks, since the global RootParamList extends RootStackParamList.
  Albums: undefined;
};

export type RootTabParamList = {
  Overview: undefined;
  Timeline: undefined;
  Albums: undefined;
  Map: undefined;
  Library: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
export type TabNavigationProp = BottomTabNavigationProp<RootTabParamList>;
