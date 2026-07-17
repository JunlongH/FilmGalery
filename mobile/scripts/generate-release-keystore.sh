#!/usr/bin/env bash
# Generates a production release keystore for the FilmGallery Android app.
#
# Usage:  bash scripts/generate-release-keystore.sh
#
# Produces:
#   android/app/filmgallery-release.keystore   (SECRET — never commit)
#   android/app/keystore.properties            (SECRET — never commit)
#
# Both are covered by .gitignore. Guard the keystore password; losing the
# keystore means you can never publish an update to the same Play Store listing.

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEYSTORE="$APP_DIR/android/app/filmgallery-release.keystore"
PROPS="$APP_DIR/android/app/keystore.properties"

STORE_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
KEY_PASS="$STORE_PASS"
ALIAS="filmgallery"
VALIDITY=10000

echo "Generating keystore at: $KEYSTORE"
keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 \
  -validity "$VALIDITY" \
  -storepass "$STORE_PASS" \
  -keypass "$KEY_PASS" \
  -dname "CN=FilmGallery, OU=Mobile, O=FilmGallery, L=NA, ST=NA, C=CN"

cat > "$PROPS" <<EOF
storeFile=filmgallery-release.keystore
storePassword=$STORE_PASS
keyAlias=$ALIAS
keyPassword=$KEY_PASS
EOF

chmod 600 "$KEYSTORE" "$PROPS"
echo
echo "Done. Wrote: $PROPS"
echo "IMPORTANT: back up $KEYSTORE and these passwords in a secure location"
echo "(e.g. a password manager). The build will now sign releases with this keystore."
