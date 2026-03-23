import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.connectflow.app',
  appName: 'ConnectFlow',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
