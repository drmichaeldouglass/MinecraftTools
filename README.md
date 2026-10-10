# 🪄 Helper Tools: a Minecraft Bedrock Add-On

**Current version: 1.3.0** · Requires Minecraft Bedrock **1.26.40 or newer** · No experiments needed

Helper Tools gives every player a **Helper Device**, a glowing magic wand. Use it and a colourful menu opens with one-tap helpers: change the time or weather, heal up, escape from a cave, gain superpowers, summon tame pets, teleport to friends or biomes, and build anything from a simple hole to a whole furnished village. Builder tools show a glowing 3D preview in the world before anything changes, and the last build can be undone.

It was made with younger players in mind, so every option is a big labelled button and nothing needs typing in chat. It works just as well for grown-ups who want quick building and travel tools.

---

## ✨ What the add-on does

The Helper Device menu has six sections.

| Section | What's inside |
| --- | --- |
| 🎮 **Game Modes & Time** | Day, night, clear weather, Creative and Survival mode |
| 🛡️ **Life Savers & Rescue** | Heal and feed, clear nearby monsters, cave rescue, fire shield, cure effects |
| ⚡ **Superpowers & Flying** | Night vision, super speed and jump, Elytra with rockets |
| 🏗️ **Builder Tools** | Dig, fill, flatten, platforms, houses, a whole village, bridges, stairs, torches, cleanup, undo |
| 📍 **Spawn & Teleport** | Set and return to spawn, teleport to players, find biomes and structures, go to coordinates |
| 🐾 **Pets & Companions** | Tame dog, cat, parrot, saddled horse, iron golem, axolotl |

### 🎮 Game Modes & Time
- ☀️ **Set Daytime** and 🌙 **Set Nighttime**
- 🌤️ **Clear Weather**: stops rain, snow and thunderstorms.
- 🎨 **Creative Mode** and ⚔️ **Survival Mode**: switch your own game mode.

### 🛡️ Life Savers & Rescue
- ❤️ **Instant Heal & Feed**: fills your health and hunger bars.
- 🛡️ **Monster Begone!**: removes hostile mobs (zombies, creepers, skeletons, spiders, phantoms, endermen, witches, slimes and more) within 35 blocks. Animals and pets are left alone.
- ⬆️ **Escape to Surface**: finds open sky above you and lifts you out of a cave or ravine.
- 🔥 **Lava & Fire Shield**: puts out fire, nudges you up out of danger and gives 2 minutes of Fire Resistance.
- 🥛 **Cure All Effects**: clears every potion effect, like drinking milk.

### ⚡ Superpowers & Flying
- 👀 **Night Vision** for 15 minutes.
- 🏃 **Super Speed & Jump**: Speed II and Jump Boost II for 5 minutes.
- 🪽 **Elytra & Flight Kit**: an Elytra and 64 firework rockets.

### 🏗️ Builder Tools
Builds are placed in front of you, in the direction you are facing.

| Tool | Options |
| --- | --- |
| 🕳️ **Dig an Empty Hole** | Width, depth and length (1 to 25 blocks each), optional hollow shell |
| 🧱 **Build / Fill Blocks** | 30+ blocks to pick from or any block ID you type, width, height and length (1 to 25), solid or hollow (an instant room) |
| 🚜 **Flatten / Level Ground** | Clears trees and hills in a 5 to 20 block radius and lays a fresh floor |
| 🪜 **Instant Underfoot Platform** | 3×3 up to 9×9 platform right under your feet |
| 🏠 **Starter Base Templates** | Furnished Simple House, Large Two-Storey House, Stone Fort, Tree House or Underground Bunker |
| 🏘️ **Build a Modern Village** | A 61×61 village: four furnished houses, a three-storey apartment block, a cafe with a flat upstairs, a crop farm, an orchard with a glasshouse and a plaza with a well, joined by lit roads. Three colour schemes. |
| 🌉 **Bridge & Stair Builder** | Bridges 3 to 50 blocks long with optional railings; staircases up or down, 1, 3 or 5 blocks wide, with optional headroom clearing |
| 💡 **Light Up Area** | Places torches in a grid on the ground around you so monsters can't spawn |
| 🧹 **Area Cleanup** | Removes dropped items, XP orbs, arrows, boats and minecarts or hostile mobs within 10 to 100 blocks. Players, pets, villagers and friendly mobs are protected. |
| ↩️ **Undo Last Build/Hole** | Puts back what your last build replaced |

### 📍 Spawn & Teleport
- 📍 **Set Spawn Point Here** and 🚀 **Teleport to Spawn Point**
- 👥 **Teleport to Another Player**: pick anyone online from a list.
- 🌎 **Find Nearest Biome**: choose a biome in your current dimension (Overworld, Nether or The End). The add-on shows its coordinates and distance, and **🚀 Teleport There Now** takes you straight there.
- 🏰 **Find Nearest Structure**: choose a village, trial chamber, ancient city, stronghold, fortress, End city and more. The add-on gives you the `/locate` command to find it (see [Finding structures](#finding-structures) below).
- 🧭 **Teleport to Coordinates**: type X and Z (Y is optional) and go there.

Every teleport loads the destination first and puts you on solid ground with headroom, never in lava, inside rock or on the Nether roof. You get 10 seconds of Resistance and Fire Resistance for the landing. If there is nowhere safe to stand, you stay where you are.

### 🐾 Pets & Companions
- 🐕 Tamed dog, 🐈 tamed cat, 🦜 tamed parrot, 🐴 tamed horse with a saddle, 🦾 iron golem bodyguard and 🦎 axolotl.

---

## 📥 How to install

The ready-made installers are in the [`dist`](dist) folder of this repository:

| File | What it is |
| --- | --- |
| **`HelperTools.mcaddon`** | Both packs in one file. **Use this one.** |
| `HelperTools_BP.mcpack` | Behavior pack only |
| `HelperTools_RP.mcpack` | Resource pack only |

To download a file from GitHub, open it in the `dist` folder and press the **Download raw file** button (the down arrow at the top right of the file view).

### 🪟 Windows
1. Download `HelperTools.mcaddon`.
2. Double-click it. Minecraft opens and shows "Successfully imported" for both packs.

### 📱 iPhone and iPad
1. Download `HelperTools.mcaddon` in Safari, or AirDrop it from a Mac, or save it to iCloud Drive.
2. Open the **Files** app and tap the file. If it doesn't open straight away, tap the **Share** button and choose **Minecraft**.
3. Minecraft opens and imports both packs.

### 🤖 Android
1. Download `HelperTools.mcaddon`.
2. Open your Files app, tap the file and choose **Minecraft**.

### 🎮 Consoles (Xbox, PlayStation, Switch)
Consoles can't import add-on files directly. Install the add-on on a PC, phone or tablet, create a world with it there, then play that world on the console using **Realms** or by joining the host over LAN or as a friend.

### 🔄 Updating to a new version
Import the new `HelperTools.mcaddon` the same way. Minecraft replaces the old version, and worlds that already have the add-on use the new one the next time they load.

---

## ⚙️ World setup

Do this when you create a new world, or under **Edit** for an existing world.

1. **Game settings**
   - Turn **Cheats** ON. The chat commands below (`/scriptevent` and `/locate`) need it.
   - Leave all **Experiments** OFF. Helper Tools uses the stable Script API, so Beta APIs is not needed.
2. **Behavior Packs** ➔ **Available** ➔ select **Helper Tools (Behavior Pack)** ➔ **Activate**. Minecraft offers to add the matching resource pack too; say yes.
3. Check **Resource Packs** ➔ **Active** lists **Helper Tools (Resource Pack)**. If it doesn't, activate it from **Available**.
4. Press **Create** or **Play**.

> 💾 Builder tools change a lot of blocks at once. Try them in a test world first, and make a copy of any world you care about before building in it (**Edit** ➔ **Copy World**).

---

## 🎮 How to use it

### Opening the menu
You get a Helper Device in your inventory automatically when you join the world. Hold it and use it:

| Device | How to open the menu |
| --- | --- |
| PC | Right-click |
| Phone or tablet | Tap and hold the screen, or tap the **Open Helper Tools** button |
| Controller | Left trigger (`LT`, `L2` or `ZL`) |

Pick a section, then a tool. Every sub-menu has a **⬅️ Back** button.

### Building with the 3D preview
1. Stand where you want the build to start and face the direction you want it to go.
2. Open **🏗️ Builder Tools**, choose a tool and set the sliders and options.
3. Leave **✨ Show 3D Glowing Preview Guide First** turned on. A glowing outline of the build appears in the world.
4. Walk around to check the size and position. A window asks you to choose **✅ Confirm & Execute** to build or **❌ Cancel** to try again.
5. Made a mistake? Use **↩️ Undo Last Build/Hole**.

About undo:
- It remembers **one** build per player: your most recent dig, fill, flatten, platform, base, village, bridge or staircase. A new build replaces the saved one.
- The undo is kept in memory, so it is lost when the world is closed.
- Torches from **Light Up Area** and things removed by **Area Cleanup** can't be undone.

For the **Modern Village**, find a reasonably open area, leave **Flatten and prepare the ground first** on unless the land is already flat, and wait a couple of seconds while it builds in stages.

### Finding biomes
Open **📍 Spawn & Teleport** ➔ **🌎 Find Nearest Biome**, pick a biome, and press **🚀 Teleport There Now** in the result window. Choose **✅ Done** instead to just keep the coordinates. The search uses the world seed, so places you have changed may look different from how they were generated. Underground biomes such as Lush Caves and Deep Dark land you near the depth where the biome was found.

### Finding structures
Minecraft doesn't let add-ons read where structures are, so this takes two steps:

1. Open **📍 Spawn & Teleport** ➔ **🏰 Find Nearest Structure** and pick one. The add-on closes the menu and shows the command, for example `/locate structure minecraft:village`, and Minecraft replies in chat with something like `The nearest village is at block 1256, (y?), -648`.
2. Open **🧭 Teleport to Coordinates** and type the X and Z numbers in. You can also paste the whole "The nearest ..." line into the X box and leave Y and Z empty; the add-on picks the numbers out.

Typing `/locate` yourself needs Cheats on and operator rights.

### Chat commands
These work with Cheats on. They are handy if you lose your device or prefer typing.

| Command | What it does |
| --- | --- |
| `/scriptevent tools:device` | Gives you a Helper Device if you don't have one |
| `/scriptevent tools:goto 1256 -648` | Teleports to X 1256, Z -648 and lands on the surface |
| `/scriptevent tools:goto 1256 70 -648` | Teleports to X, Y, Z |

You can also get a spare device from the main menu with **🎁 Get Extra Helper Device**.

### Multiplayer
Every player gets their own Helper Device and their own undo. **👥 Teleport to Another Player** lists everyone online. Time and weather changes affect everyone in the world; game mode changes only affect you.

---

## 🛠️ Troubleshooting

| Problem | What to try |
| --- | --- |
| The device didn't appear | Run `/scriptevent tools:device`, or rejoin the world. Check the behavior pack is active in the world settings. |
| The device looks like a purple and black square | The resource pack isn't active. Activate **Helper Tools (Resource Pack)** under Resource Packs. |
| Nothing happens when I use the device | Make sure your Minecraft is 1.26.40 or newer. Older versions can't run the add-on's scripts. |
| "Nothing to undo!" | Undo only covers your most recent build, and only until the world is closed. |
| A biome isn't found | It may be further away than the search reaches (about 4,000 blocks in each direction), or not exist in that dimension. |
| `/locate` says unknown command or no permission | Turn Cheats on and make sure you are an operator. |

---

## 🧑‍💻 For developers

### Repository layout

| Path | Contents |
| --- | --- |
| `Behavior_Pack/` | Behavior pack: manifest, the Helper Device item and `scripts/main.js` |
| `Resource_Pack/` | Resource pack: manifest, textures and language files |
| `tests/regression.cjs` | Regression tests that run against a mocked Script API |
| `build.sh` | Packages both packs into the installers |
| `dist/` | Built installers, committed so players can download them from the repository |
| `CHANGELOG.md` | Release notes for each version |

The add-on uses `@minecraft/server` 2.9.0 and `@minecraft/server-ui` 2.0.0.

### Testing and building

```bash
node tests/regression.cjs   # run the regression tests
bash build.sh               # rebuild dist/HelperTools.mcaddon and both .mcpack files
```

`build.sh` needs `zip` on your PATH. Always rebuild and commit `dist/` together with any change to the packs. The tests mock the Script API rather than running Minecraft, so check changes in a disposable world before release.

### Releasing an update
Bump the version in both `Behavior_Pack/manifest.json` and `Resource_Pack/manifest.json`, keeping the header version, every module version and the behavior pack's dependency on the resource pack the same. Then run the tests, rebuild, and add an entry to [`CHANGELOG.md`](CHANGELOG.md).

See [`AGENTS.md`](AGENTS.md) for the full contributor checklist.
