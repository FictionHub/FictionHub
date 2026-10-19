#!/usr/bin/env bash
# Script to download nodejs-mobile prebuilt binaries and set up libnode for nodejs-server module
# Run from the android/ directory

set -e

NODEJS_MOBILE_VERSION="18.20.4"
ZIP_URL="https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v${NODEJS_MOBILE_VERSION}/nodejs-mobile-v${NODEJS_MOBILE_VERSION}-android.zip"
# When run from android/, the libnode dir is nodejs-server/src/main/libnode
LIBNODE_DIR="nodejs-server/src/main/libnode"

echo "Setting up libnode for nodejs-server module..."

mkdir -p "${LIBNODE_DIR}"
cd "${LIBNODE_DIR}"

ZIP_FILE="nodejs-mobile-android.zip"

# Download the prebuilt binaries if not already present
if [ ! -f "${ZIP_FILE}" ]; then
    echo "Downloading nodejs-mobile v${NODEJS_MOBILE_VERSION}..."
    curl -L -o "${ZIP_FILE}" "${ZIP_URL}"
fi

# Extract the zip
echo "Extracting binaries..."
unzip -o "${ZIP_FILE}" -d "extracted"

# Create the bin directory structure
mkdir -p bin/armeabi-v7a
mkdir -p bin/arm64-v8a
mkdir -p bin/x86
mkdir -p bin/x86_64

# Copy .so files
echo "Copying libnode.so files..."
cp "extracted/bin/armeabi-v7a/libnode.so" "bin/armeabi-v7a/" 2>/dev/null && echo "  armeabi-v7a: OK" || echo "  armeabi-v7a: NOT FOUND"
cp "extracted/bin/arm64-v8a/libnode.so" "bin/arm64-v8a/" 2>/dev/null && echo "  arm64-v8a: OK" || echo "  arm64-v8a: NOT FOUND"
cp "extracted/bin/x86/libnode.so" "bin/x86/" 2>/dev/null && echo "  x86: OK" || echo "  x86: NOT FOUND"
cp "extracted/bin/x86_64/libnode.so" "bin/x86_64/" 2>/dev/null && echo "  x86_64: OK" || echo "  x86_64: NOT FOUND"

# Copy include headers
echo "Copying include headers..."
rm -rf include
cp -r extracted/include .

echo "libnode setup complete!"
echo "Libnode files are in: ${LIBNODE_DIR}/bin/"
