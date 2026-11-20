/**
 * Companion shell config. Point server.url at the HTTPS Zenvio origin.
 * Do not set this to a local file:// bundle of the entire product unless packaging intentionally.
 * Types come from @capacitor/cli when the native shell package is installed.
 */
const config = {
  appId: "com.gozenvio.nfc",
  appName: "Zenvio NFC",
  webDir: "www",
  server: {
    url: process.env.ZENVIO_CAPACITOR_URL || "https://gozenvio.com",
    cleartext: false,
  },
  plugins: {
    ZenvioNfc: {
      // Placeholder for future plugin config.
    },
  },
};

export default config;
