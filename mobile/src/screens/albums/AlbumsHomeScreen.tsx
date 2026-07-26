import React from 'react';
import { useAppMode } from '../../context/AppModeContext';
import DigitalAlbumListScreen from '../library/DigitalAlbumListScreen';
import CollectionsAlbumsScreen from './CollectionsAlbumsScreen';

export default function AlbumsHomeScreen() {
  const { mode } = useAppMode();
  if (mode === 'digital') return <DigitalAlbumListScreen />;
  return <CollectionsAlbumsScreen />;
}
