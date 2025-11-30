import axios from 'axios';
import { Alert } from 'react-native';

let configuredFor = null;

export function configureAxios(baseUrl) {
  if (configuredFor === baseUrl) return; // avoid re-adding interceptors repeatedly
  configuredFor = baseUrl;

  axios.defaults.baseURL = baseUrl;

  // Clear existing interceptors (basic approach: recreate instance if needed; for now we keep simple)
  axios.interceptors.response.handlers = [];

  axios.interceptors.response.use(
    resp => resp,
    err => {
      const info = {
        message: err.message,
        code: err.code,
        url: err.config && err.config.url,
        status: err.response && err.response.status,
      };
      // Log for adb logcat debugging
      console.log('AXIOS_ERROR', info);
      
      // Show alert on device
      Alert.alert(
        'Connection Error', 
        `URL: ${info.url}\nError: ${info.message}\nCode: ${info.code}\nStatus: ${info.status || 'N/A'}`
      );

      return Promise.reject(err);
    }
  );

  console.log('Axios configured for', baseUrl);
}
