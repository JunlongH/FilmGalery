/**
 * LocationPickerContext — Promise-based location picker for React Navigation.
 *
 * React Navigation can't pass a callback to a target screen directly. This
 * context provides `pickLocation(initial)` which returns a Promise that
 * resolves when the user confirms (or rejects/resolves-null on cancel).
 *
 * Usage:
 *   const { pickLocation } = useLocationPicker();
 *   const result = await pickLocation(currentValue);
 *   if (result) { /* user confirmed *\/ }
 *
 * The Provider must be mounted INSIDE NavigationContainer (so useNavigation
 * works) and wrap the RootStack (so the LocationPickerScreen can access it).
 */

import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { LocationPickerValue } from '@filmgallery/types';

interface PendingRequest {
  initial: LocationPickerValue | null;
  resolve: (value: LocationPickerValue | null) => void;
}

interface LocationPickerContextValue {
  pickLocation: (initial?: LocationPickerValue | null) => Promise<LocationPickerValue | null>;
  pending: PendingRequest | null;
  resolvePick: (value: LocationPickerValue | null) => void;
}

const LocationPickerContext = createContext<LocationPickerContextValue | null>(null);

export function LocationPickerProvider({ children }: { children: React.ReactNode }) {
  const navigation = useNavigation();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  // Ref holds the current pending request so resolvePick can access it
  // without reading state (avoids stale-closure issues in React 18 strict
  // mode where state updaters may run twice). Review finding W6.
  const pendingRef = useRef<PendingRequest | null>(null);

  const pickLocation = useCallback(
    (initial: LocationPickerValue | null = null) => {
      return new Promise<LocationPickerValue | null>((resolve) => {
        // If a previous pick is still pending, resolve it with null (cancel)
        // so its caller's Promise doesn't hang forever. (Review finding C4)
        const prev = pendingRef.current;
        if (prev) {
          prev.resolve(null);
        }
        const req: PendingRequest = { initial, resolve };
        pendingRef.current = req;
        setPending(req);
        (navigation as any).navigate('LocationPicker', { initial });
      });
    },
    [navigation]
  );

  const resolvePick = useCallback((value: LocationPickerValue | null) => {
    // Resolve the promise from the ref (NOT from state) to avoid running
    // side-effects inside a setState updater. Review finding W6.
    const req = pendingRef.current;
    if (req) {
      req.resolve(value);
      pendingRef.current = null;
      setPending(null);
    }
  }, []);

  return (
    <LocationPickerContext.Provider value={{ pickLocation, pending, resolvePick }}>
      {children}
    </LocationPickerContext.Provider>
  );
}

export function useLocationPicker(): LocationPickerContextValue {
  const ctx = useContext(LocationPickerContext);
  if (!ctx) throw new Error('useLocationPicker must be used within LocationPickerProvider');
  return ctx;
}
