#!/bin/bash
set -euo pipefail

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
build="$root/.amp/in/build"
app="$build/Build/Products/Debug/X Draft.app"
entitlements="$root/mac/X Draft/Sharing.entitlements"
artifacts="$root/.amp/in/artifacts"
mkdir -p "$artifacts"

xcodebuild -project "$root/mac/X Draft/X Draft.xcodeproj" -scheme 'X Draft' \
  -configuration Debug -derivedDataPath "$build" CODE_SIGNING_ALLOWED=NO build

# Linker-only signatures from CODE_SIGNING_ALLOWED=NO don't seal the bundles
# or include the sandbox entitlement required for extension registration.
codesign --force --sign - --entitlements "$entitlements" "$app/Contents/PlugIns/X Draft Extension.appex"
codesign --force --sign - --entitlements "$entitlements" "$app"
codesign --verify --deep --strict "$app"

ditto -c -k --sequesterRsrc --keepParent "$app" "$artifacts/X-Draft-local-test.zip"
printf '\nLocal development build: %s\nArchive: %s\n' "$app" "$artifacts/X-Draft-local-test.zip"
printf 'Open the app, then enable it in Safari Settings > Extensions. Do not import the app ZIP as a temporary extension.\n'
