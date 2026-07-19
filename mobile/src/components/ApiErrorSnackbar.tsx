import React, { useEffect, useState } from 'react';
import { Snackbar, useTheme } from 'react-native-paper';
import { subscribeApiErrors, type ApiErrorInfo } from '../api/client';

export default function ApiErrorSnackbar() {
  const theme = useTheme();
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => subscribeApiErrors((info) => setError(info)), []);

  return (
    <Snackbar
      visible={!!error}
      onDismiss={() => setError(null)}
      duration={3000}
      style={{ backgroundColor: theme.colors.errorContainer }}
      action={{ label: 'OK', onPress: () => setError(null) }}
    >
      {error ? `Connection error: ${error.message}` : ''}
    </Snackbar>
  );
}
