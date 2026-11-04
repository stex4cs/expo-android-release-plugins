const { withAppBuildGradle } = require('expo/config-plugins');

// Sign release builds with the Play upload key.
//
// The key and its passwords live in mobile/credentials/ (gitignored, outside
// android/ so prebuild cannot delete them): upload.keystore plus
// keystore.properties with storeFile / storePassword / keyAlias / keyPassword,
// storeFile relative to android/.
//
// This used to be a hand edit in android/app/build.gradle. The prebuild on
// 1 September regenerated that file and quietly put release signing back on the
// debug key -- the v6 bundle had been built just before, so nothing showed until
// the next build, which Play would have refused as signed with the wrong key.
// Same reason as withVersionFromAppJson: anything in android/ has to come from
// a plugin.
//
// Without keystore.properties (another machine, a clone without the key) an APK
// still builds, debug-signed, for testing on a device. A Play bundle does not:
// the build stops instead of producing an AAB that would only fail on upload.

const MARKER = 'Added by plugins/withReleaseSigning.js';

const READER = `
    // ${MARKER}
    // Play upload key, read from mobile/credentials/ (gitignored); see the plugin.
    def releaseKeystorePropsFile = rootProject.file('../credentials/keystore.properties')
    def releaseKeystoreProps = new Properties()
    if (releaseKeystorePropsFile.exists()) {
        releaseKeystorePropsFile.withInputStream { releaseKeystoreProps.load(it) }
    }
`;

const RELEASE_CONFIG = (indent) => `${indent}    release {
${indent}        if (releaseKeystorePropsFile.exists()) {
${indent}            storeFile rootProject.file(releaseKeystoreProps['storeFile'])
${indent}            storePassword releaseKeystoreProps['storePassword']
${indent}            keyAlias releaseKeystoreProps['keyAlias']
${indent}            keyPassword releaseKeystoreProps['keyPassword']
${indent}        }
${indent}    }
`;

const BUNDLE_GUARD = `
// ${MARKER}
// A Play bundle signed with the debug key is rejected on upload; refuse to build one.
gradle.taskGraph.whenReady { graph ->
    def credentials = rootProject.file('../credentials/keystore.properties')
    // Only the app's own Play bundle. A looser name match (bundle*Release) also caught
    // library tasks like bundleLibCompileToJarRelease that every assembleRelease runs,
    // which blocked the debug-signed test APK this plugin promises without the key.
    def buildsBundle = graph.allTasks.any { it.project == project && it.name == 'bundleRelease' }
    if (buildsBundle && !credentials.exists()) {
        throw new GradleException(
            "mobile/credentials/keystore.properties is missing, so this bundle would be signed " +
            "with the debug key and Play would refuse it. Restore mobile/credentials/ first.")
    }
}
`;

function replaceOrThrow(src, pattern, replacement, what) {
  if (!pattern.test(src)) {
    throw new Error(
      `withReleaseSigning: could not find ${what} in android/app/build.gradle. ` +
        'The Expo template changed; update the plugin rather than editing build.gradle by hand.'
    );
  }
  return src.replace(pattern, replacement);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;

    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    // Reader just inside `android {`, ahead of signingConfigs, plus a release
    // config next to the template's debug one.
    src = replaceOrThrow(
      src,
      /\n([ \t]*)signingConfigs\s*\{\n/,
      (_m, indent) => `\n${READER}\n${indent}signingConfigs {\n${RELEASE_CONFIG(indent)}`,
      'signingConfigs'
    );

    // The template's release build type signs with the debug key.
    src = replaceOrThrow(
      src,
      /(buildTypes\s*\{[\s\S]*?\n\s*release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      '$1signingConfig releaseKeystorePropsFile.exists() ? signingConfigs.release : signingConfigs.debug',
      'the release build type'
    );

    src = `${src.trimEnd()}\n${BUNDLE_GUARD}`;

    cfg.modResults.contents = src;
    return cfg;
  });
};
