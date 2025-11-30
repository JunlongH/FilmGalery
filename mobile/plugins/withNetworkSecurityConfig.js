const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const { Paths } = AndroidConfig;
const path = require('path');
const fs = require('fs');

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>`;

const withNetworkSecurityConfig = (config) => {
  // 1. Add the network_security_config.xml file using withDangerousMod
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const resDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      const xmlDir = path.join(resDir, 'xml');
      if (!fs.existsSync(xmlDir)) {
        fs.mkdirSync(xmlDir, { recursive: true });
      }
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG);
      return config;
    },
  ]);

  // 2. Reference it in AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });

  return config;
};

module.exports = withNetworkSecurityConfig;
