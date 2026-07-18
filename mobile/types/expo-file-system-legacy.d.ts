declare module 'expo-file-system/legacy' {
  export const documentDirectory: string;
  export const cacheDirectory: string;
  export const bundleDirectory: string;
  export function downloadAsync(...args: any[]): Promise<any>;
  export function readAsStringAsync(...args: any[]): Promise<any>;
  export function writeAsStringAsync(...args: any[]): Promise<any>;
  export function deleteAsync(...args: any[]): Promise<any>;
  export function getInfoAsync(...args: any[]): Promise<any>;
  export function makeDirectoryAsync(...args: any[]): Promise<any>;
  export function readDirectoryAsync(...args: any[]): Promise<any[]>;
  const _default: any;
  export default _default;
}
