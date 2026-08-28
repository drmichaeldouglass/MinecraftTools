#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUTPUT_NAME="HelperTools"

echo "=========================================="
echo " Building $OUTPUT_NAME Minecraft Add-On"
echo "=========================================="

# Remove old builds
rm -f "${OUTPUT_NAME}.mcaddon" "${OUTPUT_NAME}_BP.mcpack" "${OUTPUT_NAME}_RP.mcpack"

# 1. Build Behavior Pack (.mcpack)
echo "📦 Packaging Behavior Pack..."
(cd Behavior_Pack && /usr/bin/zip -r -q "../${OUTPUT_NAME}_BP.mcpack" . -x "*.DS_Store*")

# 2. Build Resource Pack (.mcpack)
echo "🎨 Packaging Resource Pack..."
(cd Resource_Pack && /usr/bin/zip -r -q "../${OUTPUT_NAME}_RP.mcpack" . -x "*.DS_Store*")

# 3. Build Unified .mcaddon
echo "✨ Creating Unified .mcaddon installer..."
/usr/bin/zip -q "${OUTPUT_NAME}.mcaddon" "${OUTPUT_NAME}_BP.mcpack" "${OUTPUT_NAME}_RP.mcpack"

echo "=========================================="
echo "✅ Build Complete!"
echo "Generated files:"
echo " - ${OUTPUT_NAME}.mcaddon (Double-click to install both packs on PC/Mobile)"
echo " - ${OUTPUT_NAME}_BP.mcpack (Behavior pack only)"
echo " - ${OUTPUT_NAME}_RP.mcpack (Resource pack only)"
echo "=========================================="
