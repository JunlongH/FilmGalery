import type { Photo, Roll } from './index';

export type RootStackParamList = {
  Home: undefined;
  MainMenu: undefined;
  Settings: undefined;
  ShotLog: undefined;
  MyRolls: undefined;
  RollDetail: { roll: Roll };
  PhotoViewer: { photo: Photo };
};
