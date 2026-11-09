const { withAppBuildGradle } = require("expo/config-plugins");

// Release builds sign with the keystore named by these Gradle properties or environment variables,
// and fall back to the debug keystore when none is set. Keystores and passwords never live in the repo.
const RELEASE_SIGNING_CONFIG = `
        release {
            def signingValue = { String name -> findProperty(name) ?: System.getenv(name) }
            def releaseStoreFile = signingValue('T3CODE_ANDROID_KEYSTORE_FILE')
            if (releaseStoreFile) {
                storeFile file(releaseStoreFile)
                storePassword signingValue('T3CODE_ANDROID_KEYSTORE_PASSWORD')
                keyAlias signingValue('T3CODE_ANDROID_KEY_ALIAS')
                keyPassword signingValue('T3CODE_ANDROID_KEY_PASSWORD') ?: signingValue('T3CODE_ANDROID_KEYSTORE_PASSWORD')
            }
        }`;

const DEBUG_SIGNING_CONFIG = /(signingConfigs \{\n\s+debug \{[^}]*\})/;
const RELEASE_BUILD_TYPE_SIGNING =
  /(release \{\n(?:\s+\/\/.*\n)*\s+)signingConfig signingConfigs\.debug/;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    let gradle = nextConfig.modResults.contents;
    if (gradle.includes("T3CODE_ANDROID_KEYSTORE_FILE")) return nextConfig;
    if (!DEBUG_SIGNING_CONFIG.test(gradle) || !RELEASE_BUILD_TYPE_SIGNING.test(gradle)) {
      throw new Error(
        "withAndroidReleaseSigning: app/build.gradle no longer matches the template.",
      );
    }
    gradle = gradle.replace(DEBUG_SIGNING_CONFIG, `$1${RELEASE_SIGNING_CONFIG}`);
    gradle = gradle.replace(
      RELEASE_BUILD_TYPE_SIGNING,
      "$1signingConfig signingConfigs.release.storeFile ? signingConfigs.release : signingConfigs.debug",
    );
    nextConfig.modResults.contents = gradle;
    return nextConfig;
  });
};
