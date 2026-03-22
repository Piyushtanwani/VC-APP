import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.connectflow.app',
  appName: 'ConnectFlow',
  webDir: 'dist',
  server: {
    cleartext: true
  }
};

export default config;
