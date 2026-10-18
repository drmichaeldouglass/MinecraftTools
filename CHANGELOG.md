# Changelog

Release notes for the Helper Tools add-on, newest first. Each release bumps both pack manifests so Minecraft recognises the update.

## Version 1.4.3 fixes

- **Enchant Item in Hand** could never work: the menu only opens while you hold the Helper Device, so the device was always the "item in hand" and the menu said it could not take any enchantments. The button is now **✨ Enchant an Item** and opens a picker listing every enchantable item in your hotbar, inventory, armour slots and off hand, with where it is and how many enchantments it already has. The device, items that cannot be enchanted and items that cannot take any more enchantments are left out. The chosen item is enchanted where it is, so worn armour stays on.
- Both manifests and all three rebuilt installers are version 1.4.3.

Validation: all 65 mocked Script API regression tests pass. The enchanting tests now open the menu with the device in hand, as in the game, and the mocked inventory returns copies so an enchantment only counts if it is written back to its slot. Minecraft is not available in this environment, so check in a disposable Minecraft world that the picker lists your items and that enchanting a hotbar item, an inventory item and worn armour works.

## Version 1.4.2 fixes

- Doors now use the `minecraft:cardinal_direction` block state. Bedrock replaced the old integer `direction` state on doors in 1.21.60, and this pack requires 1.26.40, so every door command was being rejected. That stopped every house design, starter template, the village, the city, the automatic door and the bubble elevator part-way through the build. Each door keeps the orientation the old state gave it.
- Pistons in the sugar cane and bamboo farm now push towards the crop. Bedrock swaps the horizontal `facing_direction` values for pistons (2 is south, 3 is north, 4 is east, 5 is west), so the pistons were facing away from the cane and never harvested it.
- The cobblestone generator lets its water fall into a small pit beside the source. Before, the water flowed onto the lava source and turned it into obsidian, so no cobblestone ever formed.
- The tree house stairs no longer clear away the lower half of the front door. The stairs now climb to a threshold under the door.
- Staircases from the Bridge & Stair Builder, and the bunker entrance, now clear three blocks of headroom. With two blocks, a block was left at head height in front of every step, so the stairs could not be walked in solid ground.
- Blocks that a later part of the same build overwrote are back: the A-frame cabin's porch lanterns, the lanterns beside every city tower entrance, the restaurant's dining room lights and one of its lamps. The mall no longer has a stall counter under its escalator.
- If the undo snapshot cannot be saved, the build now says that nothing was built. It no longer tells you to use Undo, which would have undone your previous build.
- Both manifests and all three rebuilt installers are version 1.4.2.

Validation: all 63 mocked Script API regression tests pass. The seven new tests and two updated ones fail against the 1.4.1 script. A new check replays every house, template, village and city build and fails if a later command overwrites a door, lamp, light or furniture block. Minecraft is not available in this environment, so check these in a disposable Minecraft world: doors (including the iron door and elevator doors) are placed and face the right way, the cane farm pistons fire into the cane, the cobblestone generator makes cobblestone, and the stairs can be walked up and down.

## Version 1.4.1 fixes

- Fixed enchanting passing identifier strings where the Script API requires `EnchantmentType` objects. Held-item enchanting and enchanted armour/tool kits now resolve types through `EnchantmentTypes.get`, retain level caps and reject unavailable enchantments.
- Auto-equipping armour now fills empty slots only. Existing armour and Elytra remain equipped; new pieces for occupied slots go into the inventory or drop at the player's feet if it is full. The menu explains this behaviour.
- Draining now verifies no-op fills instead of ignoring every command error. Failed edits and unloaded target blocks stop the build, report the error and retain the undo snapshot.
- Flood wheat farms now place the supporting row before the redstone dust, preventing unsupported wiring during construction.
- Both manifests and all three rebuilt installers are version 1.4.1.

Validation: all 56 mocked Script API regression tests pass. Six checks failed against the original source after strengthening the enchantment mock and adding regression cases. Coverage includes occupied armour slots with available and full inventories, unknown enchantments, drain failures and unavailable blocks, and flood-farm placement order at three widths in all four facings. Minecraft is not available in this environment. Check enchanting, armour grants, draining/undo and the flood-farm button in a disposable Minecraft world.

## Version 1.4.0 changes

- 🔷 New **Shapes & Beacons** submenu under 🏗️ Builder Tools. Build a sphere, dome, stepped pyramid, cylinder or tower (height 1 makes a disc or ring) or cone, solid or hollow, in any block from the list or a typed block ID. Sizes go up to a radius of 25 and a pyramid base of 61. Hollow shapes are always one block thick with no gaps. Large shapes are built in batches over a few game ticks.
- ✨ **Beacon with Pyramid Base** builds a working beacon on a 1 to 4 level pyramid of iron, gold, emerald, diamond or netherite blocks (or a rainbow mix), with an optional stained-glass beam colour. The column straight above the beacon can be cleared to the sky so the beam shows; in the Nether the clearing stops below the bedrock roof.
- 🧱 **Build / Fill Blocks** has a new **Build Direction** choice: upwards from your feet (as before) or downwards into the ground below your feet.
- 🌊 New **Drain Water & Lava** tool removes water, lava or both within 3 to 25 blocks of you, and can be undone.
- 🏊 New **Swimming Pool** tool sinks a tiled pool into the ground in front of you with the water level with the surface. Choose width, length (1 to 25) and depth (1 to 6), the tile colour, a deck material or no deck, underwater sea lanterns and a diving board.
- 🏡 New **House Designs** submenu with eight furnished houses that have real doors: Cosy Cottage (pitched stair roof and smoking chimney), A-Frame Cabin, Modern Villa (two storeys, internal stairs, roof terrace and driveway), Stone Watchtower (three floors joined by a ladder, with battlements and a flag), and the Modern Bungalow, Carport House, Studio Cabin and Family Home from the village. Every design can be built in seven styles: the three village colour schemes plus Rustic Oak & Cobblestone, Spruce Lodge, Desert Sandstone and Cherry Blossom.
- 🏠 The Simple House, Large Two-Storey House and Tree House starter templates now have doors in their doorways.
- ⚡ Six more **Redstone Contraptions**: Spawner XP Farm (a dark room around a monster spawner, water streams that flush mobs into a chute and a two-deep pit, and a one-block gap to hit their legs from outside; the device gives you a zombie or skeleton spawn egg to set the spawner), Flood Wheat Farm (dispensers with water buckets wash fully grown wheat into hoppers and a chest at the press of a button; press again to take the water back), Auto Wool Farm (a penned sheep, an observer watching its grass, a shearing dispenser and a hopper minecart under the grass feeding a chest in a pit), Cobblestone Generator, Auto Smelter (three furnaces with input chests on top, fuel chests behind and output chests in front) and Infinite Water Source. The cane farm can now grow bamboo instead.
- ✨ New **Enchant & Armour** section on the main menu: enchant the item in your hand with a chosen enchantment and level (only enchantments the item can take are offered, levels are capped at the normal maximum, or add everything compatible at once), get a full armour set in any material, optionally enchanted and equipped, get an enchanted tool kit (sword, pickaxe, axe, shovel, bow), and get an armour trim kit (templates for any of the 18 patterns, a trim material and a smithing table). Trims cannot be applied by scripts or commands on Bedrock, so the kit is applied at the smithing table.
- ⭐ **Gain 30 XP Levels** under Superpowers.
- 🏙️ The village tool is now **Build a Village or City** with a new **Modern City** layout on the same 61×61 footprint: five glass-and-concrete skyscrapers of 5 to 12 storeys (two office towers, a hotel and two apartment towers, each with a soul sand lift up and a magma lift down, a door on every storey and a furnished lobby), a two-storey shopping mall with an atrium, skylight, stalls, fountain and food court, a three-storey city hall with a colonnade, council chamber, library and clock tower, a restaurant with a bar, kitchen and rooftop terrace, and a park with a fountain, trees, flower beds and benches. The tallest tower carries a beacon. The city fits the single undo snapshot.
- 🪑 Seven **custom furniture blocks** with their own 3D models and textures: Chair, Sofa, Table, Floor Lamp (light level 15), Television, Fridge and Computer. Directional ones face the way they are placed. The houses, village and city are furnished with them (lounges have a sofa, TV and lamp; kitchens have a fridge; offices have desks with computers), and they are also available from the Construction tab of the Creative inventory. A **Use Helper Tools furniture** toggle in the house and village forms switches back to plain Minecraft stand-ins.
- ⚡ New **Redstone Contraptions** submenu with six working machines: Automatic Door (iron door with pressure plates or buttons, in your choice of wall block), Bubble Elevator (soul sand water lift up a glass tower, 3 to 60 blocks, with an optional magma shaft down and a railed landing at the top), Firework Launcher (1 to 9 dispensers loaded with 192 rockets each and fired by one button), Auto Sugar Cane Farm (observers and pistons harvest into a hopper and chest, 2 to 8 rows), Night Lamps (fence posts with redstone lamps and inverted daylight sensors placed in a grid around you) and Powered Railway (straight track with powered rails on redstone blocks, a buffer at the end and a minecart for your inventory). All of them can be undone.
- Fill commands with a `replace <block>` filter are understood by the no-op check, and builds can mark themselves as tolerant of fills that change nothing (used by the drain tool).
- Both packs and all three installers are updated to version 1.4.0 so Minecraft can recognize the update.

Run `node tests/regression.cjs` for the 51 mocked Script API regression tests. New tests cover both fill directions, the drain plan, every shape (including a check that hollow shells have no holes), the beacon, the pool, all eight house designs in all four facings and all seven styles, the starter-template doors, all twelve contraptions in all four facings, enchanting (levels, caps, conflicts, armour and tool kits, trim kits), the city in all four facings (including that it fits one snapshot), the furniture toggle, and that every furniture block's geometry, textures, sound and name are defined consistently across both packs, as well as the Builder Tools menu wiring. Minecraft itself is not available in the automated test environment, so try the new tools in a disposable world first. In particular check that the furniture blocks render with their models and textures and face the right way (if chairs face backwards, swap the 90 and 270 rotations in `Behavior_Pack/blocks`), that the city towers' lifts work, that the beacon activates and its beam colour shows, that the spawner farm spawns and flushes mobs once the spawner is set, that the flood farm's water reaches the hoppers and is taken back, that the wool farm's dispenser fires when the sheep eats and the hopper minecart collects the wool, that enchantments apply with the chosen levels, that the contraptions work (the elevator doors hold the water in, the observers fire the farm pistons and cane floats to the chest, the launcher button fires every dispenser, the night lamps come on at dusk and the rails face along the track), that roof stairs, doors and the watchtower ladder face the right way, that the flattened block names used by the new styles (for example `cut_sandstone`, `stone_brick_slab`, `pink_terracotta` and the stained glass colours) all exist on your version, and that draining a pond does not leave water flowing back in from outside the box.

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
