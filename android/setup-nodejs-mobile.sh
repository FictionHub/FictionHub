#!/usr/bin/env bash
# Script to download nodejs-mobile prebuilt binaries and create a local Maven AAR
# Run this before building the Android project

set -e

NODEJS_MOBILE_VERSION="18.20.4"
ZIP_URL="https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v${NODEJS_MOBILE_VERSION}/nodejs-mobile-v${NODEJS_MOBILE_VERSION}-android.zip"
WORK_DIR="android/app/nodejs-mobile-maven"
ZIP_FILE="${WORK_DIR}/nodejs-mobile-android.zip"

echo "Setting up nodejs-mobile local Maven repo..."

mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

# Download the prebuilt binaries if not already present
if [ ! -f "${ZIP_FILE}" ]; then
    echo "Downloading nodejs-mobile v${NODEJS_MOBILE_VERSION}..."
    curl -L -o "${ZIP_FILE}" "${ZIP_URL}"
fi

# Extract the zip
echo "Extracting binaries..."
unzip -o "${ZIP_FILE}" -d "extracted"

# Create the AAR structure
AAR_DIR="${WORK_DIR}/aar/org/nodejs/mobile/nodejs-mobile/${NODEJS_MOBILE_VERSION}"
mkdir -p "${AAR_DIR}"

# Copy .so files to jniLibs
mkdir -p "${AAR_DIR}/jni/armeabi-v7a"
mkdir -p "${AAR_DIR}/jni/arm64-v8a"
mkdir -p "${AAR_DIR}/jni/x86"
mkdir -p "${AAR_DIR}/jni/x86_64"

cp "extracted/bin/armeabi-v7a/libnode.so" "${AAR_DIR}/jni/armeabi-v7a/" 2>/dev/null || true
cp "extracted/bin/arm64-v8a/libnode.so" "${AAR_DIR}/jni/arm64-v8a/" 2>/dev/null || true
cp "extracted/bin/x86/libnode.so" "${AAR_DIR}/jni/x86/" 2>/dev/null || true
cp "extracted/bin/x86_64/libnode.so" "${AAR_DIR}/jni/x86_64/" 2>/dev/null || true

# Create a minimal pom.xml for the AAR
cat > "${AAR_DIR}/nodejs-mobile-${NODEJS_MOBILE_VERSION}.pom" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd" xmlns="http://maven.apache.org/POM/4.0.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.nodejs.mobile</groupId>
  <artifactId>nodejs-mobile</artifactId>
  <version>${NODEJS_MOBILE_VERSION}</version>
  <packaging>aar</packaging>
  <description>Node.js for Mobile Apps - Prebuilt binaries</description>
</project>
EOF

# Create a minimal AAR file (just the native libs and pom)
cd "${AAR_DIR}"
jar -cf "nodejs-mobile-${NODEJS_MOBILE_VERSION}.aar" jni META-INF 2>/dev/null || {
    # Create META-INF if needed
    mkdir -p META-INF
    jar -cf "nodejs-mobile-${NODEJS_MOBILE_VERSION}.aar" jni META-INF
}

# Install to local maven repo (simulated by directory structure)
echo "Local Maven repo created at: ${WORK_DIR}"
echo "Add maven { url file('nodejs-mobile-maven') } to your repositories"
