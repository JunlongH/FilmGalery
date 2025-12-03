import axios from 'axios';
import { Alert } from 'react-native';

let primary = null;
let secondary = null;
let activeUrl = null;

export function configureAxios(primaryUrl, secondaryUrl) {
  if (primary === primaryUrl && secondary === secondaryUrl) return;
  
  primary = primaryUrl;
  secondary = secondaryUrl;
  activeUrl = primary; // Reset to primary on reconfiguration

  axios.defaults.baseURL = activeUrl;
  axios.defaults.timeout = 5000; // Set 5s timeout to ensure quick failover

  // Clear existing interceptors
  axios.interceptors.response.handlers = [];

  axios.interceptors.response.use(
    resp => resp,
    async err => {
      const originalRequest = err.config;
      
      // Check for network errors (no response or specific codes)
      // Expanded to catch more network-related errors
      const isNetworkError = !err.response && (
        err.code === 'ERR_NETWORK' || 
        err.code === 'ECONNABORTED' || 
        (err.message && (err.message.includes('Network Error') || err.message.includes('timeout')))
      );
      
      if (isNetworkError && originalRequest && !originalRequest._retry) {
        let newUrl = null;
        
        // Toggle URL if backup is available
        if (activeUrl === primary && secondary) {
            console.log(`Primary ${primary} unreachable, switching to secondary ${secondary}`);
            newUrl = secondary;
        } else if (activeUrl === secondary && primary) {
            console.log(`Secondary ${secondary} unreachable, switching to primary ${primary}`);
            newUrl = primary;
        }
        
        if (newUrl) {
            originalRequest._retry = true;
            activeUrl = newUrl;
            axios.defaults.baseURL = newUrl;
            originalRequest.baseURL = newUrl;
            
            // If the original URL was absolute and matched the old activeUrl, replace it
            // This handles cases where axios might have merged the baseURL into url
            if (originalRequest.url && originalRequest.url.startsWith('http')) {
               const oldUrl = newUrl === primary ? secondary : primary;
               if (oldUrl && originalRequest.url.startsWith(oldUrl)) {
                   originalRequest.url = originalRequest.url.replace(oldUrl, newUrl);
               }
            }

            // Retry the request
            return axios(originalRequest);
        }
      }

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

  console.log(`Axios configured. Primary: ${primary}, Secondary: ${secondary}`);
}
