import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

// Root stack param list — loose typing (all params optional) to unblock the
// TS migration. Tighten to required-params later once all call-sites are
// audited. This global declaration makes useNavigation() / useRoute() across
// all screens pick up the types automatically.

export type RootStackParamList = {
  Main: undefined;
  RollDetail: { rollId?: number | string; rollName?: string } | undefined;
  TagDetail: { tagId?: number | string; tagName?: string } | undefined;
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
  Favorites: undefined;
  Collections: undefined;
  Films: undefined;
  Negatives: undefined;
  Equipment: undefined;
  Inventory: undefined;
  Stats: undefined;
  AISettings: undefined;
};

export type RootTabParamList = {
  Timeline: undefined;
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
