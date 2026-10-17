# Agent Instructions

## Repository layout

- `Behavior_Pack/`: behavior pack source (manifest, items, custom furniture blocks in `blocks/`, `scripts/main.js`).
- `Resource_Pack/`: resource pack source (manifest, textures, furniture block geometry in `models/blocks/`, `blocks.json`, `textures/terrain_texture.json`, language files). The furniture blocks, textures and names are generated together; keep every block's geometry identifier, material textures, `blocks.json` entry and `tile.<id>.name` line in step (the regression tests check this).
- `tests/regression.cjs`: mocked Script API regression tests.
- `build.sh`: packages both packs into installers.
- `dist/`: built installers (`HelperTools.mcaddon`, `HelperTools_BP.mcpack`, `HelperTools_RP.mcpack`). These are committed so users can download them straight from the repository.

## Always rebuild the add-on after modifying it

Whenever you change anything in `Behavior_Pack/` or `Resource_Pack/`, you must rebuild the installers before you commit:

1. Run the tests: `node tests/regression.cjs`. All tests must pass.
2. Rebuild: `bash build.sh`. This writes all three installers into `dist/`.
3. Commit the updated files in `dist/` in the same commit (or the same pull request) as the source changes.

Never leave `dist/` out of date with the pack sources, and never edit the files in `dist/` by hand. Do not write build output to the repository root; `build.sh` puts everything in `dist/`.

## Versioning

When a change should reach players as an update, bump the version in both manifests (`Behavior_Pack/manifest.json` and `Resource_Pack/manifest.json`). Keep the header version, every module version, and the behavior pack's dependency on the resource pack in step, so Minecraft recognises the update. Then rebuild as above.

## Testing limits

Minecraft is not available in the automated environment. The regression tests mock the Script API, so say so when reporting results and recommend checking changes in a disposable Minecraft world.
