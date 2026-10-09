# 🪄 Minecraft Bedrock Helper Tools Add-On

Requires Minecraft Bedrock **1.26.40 or newer** (Script API 2.9).

A complete, feature-rich Minecraft Bedrock Add-On created to give players an easy-to-use **Helper Device** (Magic Wand). When held and activated, it brings up a colorful, intuitive graphical menu packed with safety helpers, 3D holographic builder tools, superpowers, pet summoners, and multiplayer fast-travel!

---

## ✨ Full Feature Guide

### 1. 🎮 Game Modes & Time
* ☀️ **Set Daytime**: Instant bright daylight (`/time set day`).
* 🌙 **Set Nighttime**: Starry night sky (`/time set night`).
* 🌤️ **Clear Weather**: Stops rain, snow, and thunderstorms.
* 🎨 **Creative Mode**: Switch to Creative mode to fly and have infinite blocks.
* ⚔️ **Survival Mode**: Switch back to standard Survival adventure mode.

---

### 2. 🛡️ Life Savers & Rescue
* ❤️ **Instant Heal & Feed**: Instantly refills full health hearts and hunger bar.
* 🛡️ **Monster Begone!**: Clears all hostile monsters (Zombies, Creepers, Skeletons, Spiders, Phantoms, Endermen, Witches, Slimes, etc.) within a 35-block radius without harming friendly animals or pets.
* ⬆️ **Escape to Surface (Cave Rescue)**: Scans upwards to locate open ground exposed to the sky and warps the player out of deep caves or ravines.
* 🔥 **Lava & Fire Shield**: Puts out fire, nudges player up out of danger, and grants 2 minutes of Fire Resistance.
* 🥛 **Cure All Effects**: Instantly clears every potion effect — Poison, Wither, Slowness, and Blindness, plus any boosts you are carrying — exactly like drinking a bucket of milk.

---

### 3. ⚡ Superpowers & Flying
* 👀 **Night Vision (15 Minutes)**: See clearly in pitch-black caves and underwater without placing torches.
* 🏃 **Super Speed & Jump (5 Minutes)**: Grants Speed II and Jump Boost II for zooming around and jumping over obstacles.
* 🪽 **Elytra & Flight Kit**: Adds an Elytra (glider wings) and 64 Firework Flight Rockets to inventory.

---

### 4. 🏗️ 3D Builder Tools & Holographic Visual Guide
* ✨ **3D Holographic Visual Guide (Wireframe Preview)**:
  - When using builder tools, a glowing 3D particle wireframe box appears directly in the world in front of the player!
  - A confirmation popup allows walking around to inspect the placement and dimensions before confirming with **[✅ Confirm & Execute]** or **[❌ Cancel]**.
* 🕳️ **Dig an Empty Hole**: Visual sliders for **Width**, **Depth into ground**, and **Length forward** with an optional hollow toggle.
* 🧱 **Build / Fill Blocks**: Block picker with 30+ popular blocks (Diamond, Gold, Glass, Glowstone, Wood Planks, TNT, Colored Wool, etc.) or custom block IDs, with sliders and **Solid** vs **Hollow** (instant houses/rooms).
* 🚜 **Flatten / Level Ground**: Clears trees, bumps, and hills in a 5–20 block radius around the player and places a clean floor (Grass, Stone, Dirt, Wood Planks, etc.) ready for building.
* 🪜 **Instant Underfoot Platform**: Spawns a 3x3 to 9x9 safety platform (Glass, Wood, Smooth Stone, Glowstone, Obsidian) right beneath feet.
* 🏠 **Starter Base Templates**: Builds a furnished Simple House, Large Two-Storey House, Stone Fort, raised Tree House, or Underground Bunker in the direction the player faces.
* 🏘️ **Build a Modern Village**: Builds a whole 61×61 modern village in front of you: four furnished houses (a flat-roof bungalow, a two-storey family home, a house with a carport, and a glass-fronted studio cabin), a three-storey apartment block with balconies, a corner cafe with a flat upstairs, a crop farm with a shed, an orchard farm with a glasshouse, and a central plaza with a well, benches, trees and a bell, all joined by lit concrete roads with sidewalks. Every home has beds, a kitchen, seating, storage and lights. Pick one of three colour schemes, and leave **Flatten and prepare the ground first** on unless the land is already flat. The village builds over a couple of seconds and can be reverted with **↩️ Undo Last Build**.
* 🌉 **Bridge Builder**: Creates configurable 3–50 block bridges with selectable materials and optional safety railings.
* 🪜 **Stair Builder**: Builds one-to-five-block-wide staircases upward or downward, with optional automatic headroom clearing.
* 🧹 **Area Cleanup**: Safely removes selected dropped items, XP orbs, projectiles, vehicles, or hostile mobs within a 10–100 block radius. Players, pets, villagers, and friendly mobs are protected.
* 💡 **Light Up Area**: Automatically places torches in a neat grid on surrounding dark surfaces so monsters won't spawn.
* ↩️ **Undo Last Build / Hole**: Reverts the last fill, dig, bridge, staircase, or base build if a mistake was made.

---

### 5. 📍 Spawn & Multiplayer Fast Travel
* 📍 **Set Spawn Point Here**: Saves the player's current spot as their spawn point.
* 🚀 **Teleport to Spawn Point**: Instantly warps back to the saved spawn point from anywhere in the world.
* 👥 **Teleport to Another Player**: Lists online players (Dad, Mom, or friends) and teleports directly to them with one tap!
* 🌎 **Find Nearest Biome**: Choose any biome that exists in the dimension you are standing in (Overworld, Nether, or The End). Helper Tools finds the nearest one, shows its X and Z coordinates and distance, and the result window has a **🚀 Teleport There Now** button that takes you straight there. No retyping needed.
* 🏰 **Find Nearest Structure**: Choose a village, trial chamber, fortress, End city, ancient city, and more. Helper Tools gives you the `/locate` command to send in chat, and Minecraft replies with the coordinates. Typing `/locate` in chat needs Cheats turned on in the world settings.
* 🧭 **Teleport to Coordinates**: Type in X, Y and Z and warp there. Y is optional; leave it empty to land on the surface.

#### Finding a place and going there

* **Biomes**: the add-on looks the biome up from the world seed (`Dimension.calculateClosestBiomeFromSeed`), searching a 1024, then 4096, then 8192 block wide box across the full height of the dimension, and shows the coordinates in a window. Press **🚀 Teleport There Now** to go straight there; underground biomes such as Lush Caves and Deep Dark land you near the depth where the biome was found. Because the search uses the seed, the answer describes how the world was generated, so terrain you have changed since may look different.
* **Structures**: the stable Script API has no structure search, and commands run from scripts return only a success count, so Helper Tools cannot read where a structure is. It closes the menu and prints the exact command, for example `/locate structure minecraft:village`. Minecraft answers with something like `The nearest village is at block 1256, (y?), -648`. The command needs Cheats on in the world settings and operator rights; the add-on also runs it on your behalf so that Minecraft reports when no such structure is in range.

To go to a structure, open **📍 Spawn & Teleport** ➔ **🧭 Teleport to Coordinates** and type the numbers in. The window reminds you of the last place you searched for. You can also paste a whole `The nearest ...` line into the X box and it picks the numbers out. Prefer chat? `/scriptevent tools:goto 1256 -648` (or `/scriptevent tools:goto 1256 70 -648` with a height) does the same thing.

Helper Tools loads the destination first, finds solid ground with headroom (never lava, never the Nether's bedrock roof, and never buried inside rock), and puts you down there in one hop with Resistance and Fire Resistance for the landing. If there is nowhere safe to stand, you stay where you are.

---

### 6. 🐾 Pets & Companions
* 🐕 **Tamed Dog (Wolf)**: Summons a loyal tamed dog ready to follow and protect.
* 🐈 **Tamed Cat**: Summons a cute tamed cat (creepers run away from cats!).
* 🦜 **Tamed Parrot**: Summons a colorful parrot ready to sit on your shoulder.
* 🐴 **Tamed Horse with Saddle**: Summons a fast horse equipped with a saddle ready to ride.
* 🦾 **Iron Golem Guard**: Summons a giant bodyguard that fights monsters.
* 🦎 **Axolotl Companion**: Summons a swimming axolotl buddy.

---

## 📥 How to Install

### Option A: One-Click `.mcaddon` Installation (Recommended)

1. Double-click or open **`dist/HelperTools.mcaddon`** (in the `dist` folder of this repository).
2. Minecraft will launch automatically and import both the Behavior Pack and Resource Pack.

#### On iPad / iPhone (iOS):
- AirDrop `HelperTools.mcaddon` to the iPad or send it via Files / iCloud Drive.
- Tap `HelperTools.mcaddon` and select **"Open in Minecraft"**.

#### On Android:
- Open your Files app, tap `HelperTools.mcaddon`, and select **Minecraft**.

---

## ⚙️ World Setup (Required Settings)

When creating a new world (or editing an existing world):

1. **World Settings**:
   - Turn **ON** ➔ **Cheats** (so the game mode, time, and weather helpers can run).
   - **Experiments are not needed.** Leave **Beta APIs** **OFF** — this add-on uses the stable Script API, which works without any experimental toggle.

2. **Resource Packs**:
   - Go to **Resource Packs** ➔ **Available** / **Owned**.
   - Select **Helper Tools (Resource Pack)** and click **Activate**.

3. **Behavior Packs**:
   - Go to **Behavior Packs** ➔ **Available** / **Owned**.
   - Select **Helper Tools (Behavior Pack)** and click **Activate**.

4. Click **Play** / **Create**!

---

## 🎮 How to Use in the Game

1. When you join the world, you will automatically receive the **Helper Device** in your hotbar.
2. Hold the **Helper Device** in your hand:
   - **PC**: Right-click
   - **Touch / iPad / Phone**: Tap and hold the screen
   - **Controller (Xbox / Switch / PlayStation)**: Press Left Trigger (`LT` / `L2` / `ZL`)
3. If you ever lose the device:
   - Open any Helper Device you still have and tap **🎁 Get Extra Helper Device**, or
   - Type `/scriptevent tools:device` in chat and a new one is added to your inventory.

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
