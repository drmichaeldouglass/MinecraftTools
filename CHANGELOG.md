# Changelog

Release notes for the Helper Tools add-on, newest first. Each release bumps both pack manifests so Minecraft recognises the update.

## Version 1.3.0 changes

- 🏘️ New **Build a Modern Village** tool under 🏗️ Builder Tools. It places a 61×61 village in front of you with four furnished houses of different designs, a three-storey apartment block, a cafe with a flat above, two farms, a plaza with a well, and lit roads. Choose a colour scheme (Crisp White, Charcoal & Oak, or Sandstone & Spruce), optionally flatten the ground first, and confirm from the 3D preview. The whole village fits in one undo snapshot, so **↩️ Undo Last Build** removes it again.
- Large builds now run in batches of commands across several game ticks instead of all at once, so the game stays responsive while the village is placed. Fills larger than the command limit are split automatically.
- Build commands can now carry Bedrock block states (for beds, doors, stairs, crops, lanterns and the like) and use the `keep` fill mode. The no-op check that lets a build continue over blocks that are already correct understands both, so a village can be rebuilt on top of itself.
- Both packs and all three installers are updated to version 1.3.0 so Minecraft can recognize the update.

Run `node tests/regression.cjs` for the 33 mocked Script API regression tests, which include building and undoing the village in all four facings and checking that every command stays inside the undo snapshot and the fill limit. Minecraft itself is not available in the automated test environment, so build the village in a disposable world first and check the furniture orientation (beds, doors, chairs) and that the farm crops and lanterns look right.

## Version 1.2.2 changes

- 🌎 Find Nearest Biome can now teleport you straight to the biome it found with a **🚀 Teleport There Now** button, instead of making you retype the coordinates. Underground biomes land you near the biome's depth.
- The biome search always passes an explicit search box (1024, then 4096, then 8192 blocks wide, full dimension height), each step in its own game tick, and reports API errors in chat instead of failing silently.
- 🏰 Find Nearest Structure explains that `/locate` needs Cheats on, keeps the structure name in the Teleport to Coordinates window, and also runs the command for you so Minecraft can report when nothing is in range. Reading a structure's coordinates from a script is still not possible on the stable Script API.
- The minimum engine version is now 1.26.40, the first release where `@minecraft/server` 2.9.0 (and its biome search) is available without the Beta APIs experiment.
- Both packs and all three installers are updated to version 1.2.2 so Minecraft can recognize the update.

Run `node tests/regression.cjs` for the 28 mocked Script API regression tests. Minecraft itself is not available in the automated test environment, so check the biome teleport in each dimension (including Lush Caves and Deep Dark) and the structure instructions in a disposable world first.

## Version 1.2.1 fixes and verification

- Base templates, stairs, digging, filling, platforms, and flattening can finish when some target blocks already have the requested type. A failed command is accepted only if the loaded target area matches its requested block types, including hollow interiors and outline shells. Other failures still stop the build and leave Undo available after a successful snapshot.
- An older preview cannot execute its build or cancel a newer preview. Failed forms clear their preview ticker, and confirmation is rejected after disconnecting or changing dimensions.
- Coordinate boxes reject malformed values rather than extracting unrelated digits or silently ignoring an invalid Y value. Paste a whole locate reply into X with Y and Z empty.
- Both packs and all three installers are updated to version 1.2.1 so Minecraft can recognize the update.

Run `node tests/regression.cjs` for the 25 mocked Script API regression tests, including all five base templates and both stair directions in all four facings. Run `bash build.sh` to rebuild the installers in `dist/`. Verify preview cancellation, template completion and undo, and coordinate travel in a disposable Minecraft world before using the update in a world you care about. Minecraft itself is not available in the automated test environment.

## Version 1.2.0 changes

- Upgraded to Script API `@minecraft/server` 2.9.0 and `@minecraft/server-ui` 2.0.0, so the add-on now needs Minecraft Bedrock 1.26.30 or newer.
- 🌎 Find Nearest Biome now shows the biome's coordinates directly instead of asking you to run `/locate`.
- 🏰 Find Nearest Structure gives you the `/locate` command, and teleporting is a separate 🧭 Teleport to Coordinates step with X, Y and Z boxes.

## Version 1.1.1 fixes and verification

- The Helper Device now has an always-usable activation component, including at full hunger.
- Dig depth counts blocks below the player's feet, so a one-block hole removes one ground layer.
- Pasted `/locate` replies preserve X/Z when the reply includes an unknown Y and a trailing distance.
- Coordinate travel checks the landing before moving. If loading fails or no landing is found, the player stays in place. Changing dimensions cancels a pending trip.
- A player can run only one build or undo at a time, protecting the undo snapshot from overlapping operations.
- Landing searches also work on API versions without `getTopmostBlock`.

Run `node --test tests/regression.cjs` for the mocked Script API regression tests, and `bash build.sh` to rebuild all three installers in `dist/`. These tests do not replace Minecraft testing. Check device activation at full hunger in Creative and Survival on touch and desktop, one-block digging and undo, base building and undo, and biome lookups in each dimension, and teleporting to loaded terrain, unloaded terrain, Nether caves, and End void in a test world.
