#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUTPUT_NAME="HelperTools"
DIST_DIR="dist"

# Resolve zip from PATH instead of assuming /usr/bin/zip
ZIP="$(command -v zip || true)"
if [ -z "$ZIP" ]; then
  echo "❌ 'zip' is not installed or not on PATH. Install it and run this script again." >&2
  exit 1
fi

echo "=========================================="
echo " Building $OUTPUT_NAME Minecraft Add-On"
echo "=========================================="

# Remove old builds
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/${OUTPUT_NAME}.mcaddon" "$DIST_DIR/${OUTPUT_NAME}_BP.mcpack" "$DIST_DIR/${OUTPUT_NAME}_RP.mcpack"

# 1. Build Behavior Pack (.mcpack)
echo "📦 Packaging Behavior Pack..."
(cd Behavior_Pack && "$ZIP" -r -q "../$DIST_DIR/${OUTPUT_NAME}_BP.mcpack" . -x "*.DS_Store*")

# 2. Build Resource Pack (.mcpack)
echo "🎨 Packaging Resource Pack..."
(cd Resource_Pack && "$ZIP" -r -q "../$DIST_DIR/${OUTPUT_NAME}_RP.mcpack" . -x "*.DS_Store*")

# 3. Build Unified .mcaddon
echo "✨ Creating Unified .mcaddon installer..."
(cd "$DIST_DIR" && "$ZIP" -q "${OUTPUT_NAME}.mcaddon" "${OUTPUT_NAME}_BP.mcpack" "${OUTPUT_NAME}_RP.mcpack")

echo "=========================================="
echo "✅ Build Complete!"
echo "Generated files in $DIST_DIR/:"
echo " - ${OUTPUT_NAME}.mcaddon (Double-click to install both packs on PC/Mobile)"
echo " - ${OUTPUT_NAME}_BP.mcpack (Behavior pack only)"
echo " - ${OUTPUT_NAME}_RP.mcpack (Resource pack only)"
echo "=========================================="
