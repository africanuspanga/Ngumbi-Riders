#!/usr/bin/env bash
#
# Build the signed release APK for Ng'umbi Riders.
#
#   cd mobile && ./scripts/build-apk.sh
#
# Output: mobile/dist/ngumbi-riders-<version>.apk
#
# Needs: JDK 17 (Temurin in ~/.jdks, or brew install openjdk@17) and the Android SDK
# (~/Library/Android/sdk). The release key lives in mobile/credentials/ and is
# git-ignored. It is created on the first run. BACK IT UP: Android only installs
# an update over an existing app when it is signed with the SAME key, so losing
# it means every phone has to uninstall and reinstall.
#
# To ship an update that needs a new APK (only native changes need one — web
# changes reach the app on every Vercel deploy): bump "version" and
# "android.versionCode" in app.json, then re-run this.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ -z "${JAVA_HOME:-}" ]]; then
  # A prebuilt JDK 17 in ~/.jdks (Eclipse Temurin), else Homebrew's.
  JAVA_HOME="$(ls -d "$HOME"/.jdks/jdk-17*/Contents/Home 2>/dev/null | tail -1)"
  [[ -n "$JAVA_HOME" ]] || JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
fi
export JAVA_HOME
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
java -version 2>&1 | head -1

CRED="$ROOT/credentials"
KEYSTORE="$CRED/ngumbi-release.jks"
PROPS="$CRED/keystore.properties"
ALIAS="ngumbi"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "No release key yet — creating $KEYSTORE"
  mkdir -p "$CRED"
  chmod 700 "$CRED"
  PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  keytool -genkeypair -v -storetype PKCS12 -keystore "$KEYSTORE" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=Ng'umbi Riders, O=Ng'umbi Riders, L=Dar es Salaam, C=TZ" >/dev/null
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=%s\nkeyPassword=%s\n' \
    "$KEYSTORE" "$PASS" "$ALIAS" "$PASS" > "$PROPS"
  chmod 600 "$KEYSTORE" "$PROPS"
  echo "Release key created. Back up the whole mobile/credentials folder somewhere safe."
fi

# Regenerate the native project from app.json (Continuous Native Generation).
npx expo prebuild --platform android --clean --no-install

# Sign release builds with our key instead of the debug key prebuild wires in.
python3 - "$PROPS" <<'PY'
import re, sys
props = sys.argv[1]
path = 'android/app/build.gradle'
s = open(path).read()
release_cfg = f'''
        release {{
            // Paths are relative to android/app: the repo folder name contains a
            // curly apostrophe (Ng’umbi), which java.util.Properties (Latin-1)
            // mangles, so no absolute path is ever read from a file.
            def p = new Properties()
            file("../../credentials/keystore.properties").withInputStream {{ p.load(it) }}
            storeFile file("../../credentials/ngumbi-release.jks")
            storePassword p.getProperty('storePassword')
            keyAlias p.getProperty('keyAlias')
            keyPassword p.getProperty('keyPassword')
        }}'''
s, n1 = re.subn(r'(signingConfigs\s*\{)', r'\1' + release_cfg.replace('\\', '\\\\'), s, count=1)
# Inside buildTypes.release, point at the release config.
m = re.search(r'buildTypes\s*\{.*?release\s*\{(.*?)\n        \}', s, re.S)
if not m or n1 != 1:
    sys.exit('could not patch android/app/build.gradle for release signing')
block = m.group(1)
new_block = block.replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release')
if new_block == block:
    sys.exit('release buildType has no debug signingConfig line to replace')
s = s[:m.start(1)] + new_block + s[m.end(1):]
open(path, 'w').write(s)
print('release signing configured')
PY

(cd android && ./gradlew --no-daemon assembleRelease)

VERSION="$(node -p "require('./app.json').expo.version")"
mkdir -p dist
OUT="dist/ngumbi-riders-$VERSION.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"

"$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)/apksigner" verify --print-certs "$OUT" | head -3
ls -lh "$OUT"
echo "APK ready: mobile/$OUT"
