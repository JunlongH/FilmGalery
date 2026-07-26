import React from 'react';
import { useAppMode } from '../../context/AppModeContext';
import DigitalTimelineScreen from './DigitalTimelineScreen';
import FilmTimelineScreen from './FilmTimelineScreen';

/**
 * HomeScreen — Timeline tab root.
 *
 * Pure conditional dispatcher. The film branch lives in FilmTimelineScreen and
 * the digital branch in DigitalTimelineScreen so each branch owns its own hooks
 * unconditionally; an early `return` here no longer skips hooks in the other
 * branch (C1: previously a mode-based early return broke the Rules of Hooks
 * because the film branch's useApiQuery / useFocusEffect / refs ran only some
 * of the time).
 */
export default function HomeScreen({ navigation }: any) {
  const { mode } = useAppMode();
  if (mode === 'digital') {
    return <DigitalTimelineScreen />;
  }
  return <FilmTimelineScreen navigation={navigation} />;
}
