import React, { useEffect, useState } from 'react';
import { Snackbar, useTheme } from 'react-native-paper';
import { subscribeApiErrors, type ApiErrorInfo } from '../api/client';
import { useT } from '../i18n';

export default function ApiErrorSnackbar() {
  const theme = useTheme();
  const t = useT();
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => subscribeApiErrors((info) => setError(info)), []);

  return (
    <Snackbar
      visible={!!error}
      onDismiss={() => setError(null)}
      duration={3000}
      style={{ backgroundColor: theme.colors.errorContainer }}
      action={{ label: '好', onPress: () => setError(null) }}
    >
      {error ? `连接错误：${error.message}` : ''}
    </Snackbar>
  );
}
