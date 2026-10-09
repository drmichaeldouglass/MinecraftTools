import { world, system, ItemStack, BiomeTypes } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

const ITEM_ID = "tools:helper_device";

// Undo history storage: Map<playerId, UndoRecord>
const undoHistory = new Map();

const activeBuilds = new Set();
const activeTravels = new Set();

async function runExclusiveBuild(player, action) {
  const id = player.id;
  if (activeBuilds.has(id)) {
    player.sendMessage("§ePlease wait for your current build or undo to finish.§r");
    return;
  }
  activeBuilds.add(id);
  try { return await action(); }
  finally { activeBuilds.delete(id); }
}

function executeBuildPlan(player, ...args) {
  return runExclusiveBuild(player, () => executeBuildPlanUnlocked(player, ...args));
}

function executeDigHole(player, ...args) {
  return runExclusiveBuild(player, () => executeDigHoleUnlocked(player, ...args));
}

function executeFillBlocks(player, ...args) {
  return runExclusiveBuild(player, () => executeFillBlocksUnlocked(player, ...args));
}

function executeLevelGround(player, ...args) {
  return runExclusiveBuild(player, () => executeLevelGroundUnlocked(player, ...args));
}

function executePlatform(player, ...args) {
  return runExclusiveBuild(player, () => executePlatformUnlocked(player, ...args));
}

function executeUndo(player, ...args) {
  return runExclusiveBuild(player, () => executeUndoUnlocked(player, ...args));
}

// Active preview sessions: Map<playerId, { intervalId }>
const activePreviews = new Map();

// itemStartUse and itemUse can both fire for the same interaction.
const deviceMenuCooldowns = new Set();

// Hostile mob type IDs for "Monster Begone"
const HOSTILE_MOBS = new Set([
  "minecraft:zombie",
  "minecraft:zombie_villager",
  "minecraft:zombie_villager_v2",
  "minecraft:husk",
  "minecraft:drowned",
  "minecraft:skeleton",
  "minecraft:stray",
  "minecraft:wither_skeleton",
  "minecraft:creeper",
  "minecraft:spider",
  "minecraft:cave_spider",
  "minecraft:phantom",
  "minecraft:enderman",
  "minecraft:witch",
  "minecraft:slime",
  "minecraft:magma_cube",
  "minecraft:silverfish",
  "minecraft:endermite",
  "minecraft:pillager",
  "minecraft:vindicator",
  "minecraft:evocation_illager",
  "minecraft:ravager",
  "minecraft:vex",
  "minecraft:warden",
  "minecraft:blaze",
  "minecraft:ghast",
  "minecraft:hoglin",
  "minecraft:piglin_brute",
  "minecraft:shulker",
  "minecraft:breeze",
  "minecraft:bogged",
  "minecraft:zoglin",
  "minecraft:guardian",
  "minecraft:elder_guardian",
  "minecraft:creaking"
]);

const LIQUID_BLOCKS = new Set([
  "minecraft:water", "minecraft:flowing_water",
  "minecraft:lava", "minecraft:flowing_lava"
]);

// Kid-friendly block selection list
const BLOCK_OPTIONS = [
  { name: "Oak Wood Planks 🪵", id: "minecraft:oak_planks" },
  { name: "Cobblestone 🪨", id: "minecraft:cobblestone" },
  { name: "Stone 🗿", id: "minecraft:stone" },
  { name: "Smooth Stone 🧱", id: "minecraft:smooth_stone" },
  { name: "Stone Bricks 🏛️", id: "minecraft:stone_bricks" },
  { name: "Bricks 🧱", id: "minecraft:brick_block" },
  { name: "Dirt 🟫", id: "minecraft:dirt" },
  { name: "Grass Block 🟩", id: "minecraft:grass_block" },
  { name: "Glass (Clear) 🪟", id: "minecraft:glass" },
  { name: "Tinted Glass 🕶️", id: "minecraft:tinted_glass" },
  { name: "Glowstone (Lights up!) 💡", id: "minecraft:glowstone" },
  { name: "Sea Lantern 🏮", id: "minecraft:sea_lantern" },
  { name: "Diamond Block 💎", id: "minecraft:diamond_block" },
  { name: "Gold Block 🪙", id: "minecraft:gold_block" },
  { name: "Emerald Block ❇️", id: "minecraft:emerald_block" },
  { name: "Iron Block ⚔️", id: "minecraft:iron_block" },
  { name: "Netherite Block 👑", id: "minecraft:netherite_block" },
  { name: "Obsidian ⬛", id: "minecraft:obsidian" },
  { name: "TNT 💥", id: "minecraft:tnt" },
  { name: "Slime Block (Bouncy!) 🟢", id: "minecraft:slime" },
  { name: "Honey Block 🍯", id: "minecraft:honey_block" },
  { name: "Red Wool 🔴", id: "minecraft:red_wool" },
  { name: "Blue Wool 🔵", id: "minecraft:blue_wool" },
  { name: "Green Wool 🟢", id: "minecraft:green_wool" },
  { name: "Yellow Wool 🟡", id: "minecraft:yellow_wool" },
  { name: "Purple Wool 🟣", id: "minecraft:purple_wool" },
  { name: "Pink Wool 🌸", id: "minecraft:pink_wool" },
  { name: "White Wool ⚪", id: "minecraft:white_wool" },
  { name: "Black Wool ⚫", id: "minecraft:black_wool" },
  { name: "Water 💧", id: "minecraft:water" },
  { name: "Lava 🔥", id: "minecraft:lava" },
  { name: "Air (Clear out) 💨", id: "minecraft:air" }
];

const BIOME_OPTIONS = [
  { name: "Plains 🌾", id: "minecraft:plains", dimensions: ["overworld"] },
  { name: "Desert 🏜️", id: "minecraft:desert", dimensions: ["overworld"] },
  { name: "Forest 🌳", id: "minecraft:forest", dimensions: ["overworld"] },
  { name: "Taiga 🌲", id: "minecraft:taiga", dimensions: ["overworld"] },
  { name: "Swamp 🐊", id: "minecraft:swampland", dimensions: ["overworld"] },
  { name: "Mangrove Swamp 🌿", id: "minecraft:mangrove_swamp", dimensions: ["overworld"] },
  { name: "Jungle 🌴", id: "minecraft:jungle", dimensions: ["overworld"] },
  { name: "Savanna 🦒", id: "minecraft:savanna", dimensions: ["overworld"] },
  { name: "Badlands 🏜️", id: "minecraft:mesa", dimensions: ["overworld"] },
  { name: "Mushroom Island 🍄", id: "minecraft:mushroom_island", dimensions: ["overworld"] },
  { name: "Snowy Plains ❄️", id: "minecraft:ice_plains", dimensions: ["overworld"] },
  { name: "Cherry Grove 🌸", id: "minecraft:cherry_grove", dimensions: ["overworld"] },
  { name: "Meadow 🌼", id: "minecraft:meadow", dimensions: ["overworld"] },
  { name: "Jagged Peaks ⛰️", id: "minecraft:jagged_peaks", dimensions: ["overworld"] },
  { name: "Lush Caves 🌺", id: "minecraft:lush_caves", dimensions: ["overworld"], underground: true },
  { name: "Dripstone Caves 🪨", id: "minecraft:dripstone_caves", dimensions: ["overworld"], underground: true },
  { name: "Deep Dark 💀", id: "minecraft:deep_dark", dimensions: ["overworld"], underground: true },
  { name: "Nether Wastes 🔥", id: "minecraft:hell", dimensions: ["nether"] },
  { name: "Soul Sand Valley 👻", id: "minecraft:soulsand_valley", dimensions: ["nether"] },
  { name: "Crimson Forest 🍄", id: "minecraft:crimson_forest", dimensions: ["nether"] },
  { name: "Warped Forest 🟦", id: "minecraft:warped_forest", dimensions: ["nether"] },
  { name: "Basalt Deltas ⬛", id: "minecraft:basalt_deltas", dimensions: ["nether"] },
  { name: "The End 🐉", id: "minecraft:the_end", dimensions: ["the_end"] }
];

const STRUCTURE_OPTIONS = [
  { name: "Village 🏘️", id: "minecraft:village", dimensions: ["overworld"] },
  { name: "Trial Chambers ⚔️", id: "minecraft:trial_chambers", dimensions: ["overworld"] },
  { name: "Ancient City 💀", id: "minecraft:ancient_city", dimensions: ["overworld"] },
  { name: "Stronghold 🐉", id: "minecraft:stronghold", dimensions: ["overworld"] },
  { name: "Woodland Mansion 🏰", id: "minecraft:mansion", dimensions: ["overworld"] },
  { name: "Ocean Monument 🌊", id: "minecraft:monument", dimensions: ["overworld"] },
  { name: "Pillager Outpost 🏹", id: "minecraft:pillager_outpost", dimensions: ["overworld"] },
  { name: "Mineshaft ⛏️", id: "minecraft:mineshaft", dimensions: ["overworld"] },
  { name: "Temple 🗿", id: "minecraft:temple", dimensions: ["overworld"] },
  { name: "Shipwreck 🚢", id: "minecraft:shipwreck", dimensions: ["overworld"] },
  { name: "Buried Treasure 💎", id: "minecraft:buried_treasure", dimensions: ["overworld"] },
  { name: "Ocean Ruins 🌊", id: "minecraft:ruins", dimensions: ["overworld"] },
  { name: "Trail Ruins 🏺", id: "minecraft:trail_ruins", dimensions: ["overworld"] },
  { name: "Ruined Portal 🔥", id: "minecraft:ruined_portal", dimensions: ["overworld", "nether"] },
  { name: "Nether Fortress 🏰", id: "minecraft:fortress", dimensions: ["nether"] },
  { name: "Bastion Remnant 👽", id: "minecraft:bastion_remnant", dimensions: ["nether"] },
  { name: "End City 🏙️", id: "minecraft:end_city", dimensions: ["the_end"] }
];

const CLEANUP_PROJECTILES = new Set([
  "minecraft:arrow", "minecraft:thrown_trident", "minecraft:snowball", "minecraft:egg",
  "minecraft:ender_pearl", "minecraft:xp_bottle", "minecraft:splash_potion",
  "minecraft:lingering_potion", "minecraft:fireball", "minecraft:small_fireball",
  "minecraft:dragon_fireball", "minecraft:wither_skull", "minecraft:wither_skull_dangerous",
  "minecraft:shulker_bullet", "minecraft:llama_spit", "minecraft:wind_charge_projectile",
  "minecraft:breeze_wind_charge_projectile"
]);

const CLEANUP_VEHICLES = new Set([
  "minecraft:boat", "minecraft:chest_boat", "minecraft:minecart",
  "minecraft:chest_minecart", "minecraft:hopper_minecart", "minecraft:tnt_minecart",
  "minecraft:command_block_minecart"
]);

const BASE_TEMPLATES = [
  { key: "simple_house", name: "Simple House 🏠", size: "9×9", description: "Cozy furnished starter home" },
  { key: "large_house", name: "Large Two-Storey House 🏡", size: "15×11", description: "Two floors with an indoor staircase" },
  { key: "fort", name: "Stone Fort 🏰", size: "15×15", description: "Walls, towers, courtyard, and battlements" },
  { key: "tree_house", name: "Tree House 🌳", size: "11×15", description: "Raised home with a walk-up staircase" },
  { key: "bunker", name: "Underground Bunker 🛡️", size: "11×13", description: "Hidden rooms beneath the ground" }
];

/**
 * `isValid` is a method on older @minecraft/server versions and a property on
 * newer ones. Reading it either way keeps the pack working across API bumps.
 */
function isValidEntity(entity) {
  if (!entity) return false;
  try {
    const valid = entity.isValid;
    return typeof valid === "function" ? entity.isValid() : valid !== false;
  } catch (e) {
    return false;
  }
}

/**
 * Script API 2.x replaced `runCommandAsync` with a synchronous `runCommand`
 * that throws when a command fails. Returning a promise keeps every
 * `.then`/`.catch`/`await` chain behaving the way it did before.
 */
function runCommand(source, command) {
  try {
    return Promise.resolve(source.runCommand(command));
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * Give Helper Device to player if they don't already have one
 */
function giveDeviceIfMissing(player, announce = false) {
  try {
    const inventory = player.getComponent("inventory");
    if (!inventory || !inventory.container) return;
    const container = inventory.container;

    let hasItem = false;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && item.typeId === ITEM_ID) {
        hasItem = true;
        break;
      }
    }

    if (!hasItem) {
      const newItem = new ItemStack(ITEM_ID, 1);
      const leftover = container.addItem(newItem);
      if (leftover) {
        player.sendMessage("§e[Helper Tools] Inventory is full! Free a slot to get your Helper Device.§r");
      } else {
        player.sendMessage("§a✨ You received your Helper Device! Hold it and tap or right-click to open the menu. ✨§r");
        player.playSound("random.levelup", { volume: 0.8, pitch: 1.2 });
      }
    } else if (announce) {
      player.sendMessage("§e[Helper Tools] You already have a Helper Device in your inventory!§r");
    }
  } catch (e) {
    console.error("Error checking/giving device: " + e);
  }
}

function giveExtraDevice(player) {
  try {
    const inventory = player.getComponent("inventory");
    if (!inventory || !inventory.container) {
      player.sendMessage("§c[Helper Tools] Could not access your inventory.§r");
      return;
    }
    const leftover = inventory.container.addItem(new ItemStack(ITEM_ID, 1));
    if (leftover) {
      player.sendMessage("§e[Helper Tools] Inventory is full! Free a slot to get an extra Helper Device.§r");
      return;
    }
    player.sendMessage("§a✨ An extra Helper Device was added to your inventory!§r");
    player.playSound("random.levelup", { volume: 0.8, pitch: 1.2 });
  } catch (e) {
    player.sendMessage(`§c[Helper Tools] Could not give an extra device: ${e}§r`);
  }
}

/**
 * Auto-give item when player spawns/joins
 */
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  system.runTimeout(() => {
    if (isValidEntity(player)) {
      giveDeviceIfMissing(player);
    }
  }, 20);
});

/**
 * Chat command fallback (!device, !wand, !helper)
 */
const chatSendSignal = world.beforeEvents.chatSend;
if (chatSendSignal) {
  chatSendSignal.subscribe((event) => {
    const msg = event.message.trim().toLowerCase();
    if (msg === "!device" || msg === "!wand" || msg === "!helper") {
      event.cancel = true;
      system.run(() => giveDeviceIfMissing(event.sender, true));
    }
  });
}

/**
 * `world.beforeEvents.chatSend` only exists in the beta script API, so on the
 * stable module this pack targets the chat shortcuts above never fire.
 * `/scriptevent tools:device` is the fallback that always works, and
 * `/scriptevent tools:goto <X> [Y] <Z>` teleports to typed-in coordinates.
 */
const DEVICE_SCRIPT_EVENTS = ["tools:device", "tools:wand", "tools:helper"];
const TRAVEL_SCRIPT_EVENTS = ["tools:goto", "tools:travel", "tools:tp"];

if (system.afterEvents && system.afterEvents.scriptEventReceive) {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    const isDeviceEvent = DEVICE_SCRIPT_EVENTS.includes(event.id);
    const isTravelEvent = TRAVEL_SCRIPT_EVENTS.includes(event.id);
    if (!isDeviceEvent && !isTravelEvent) return;
    const source = event.sourceEntity;
    if (!source) return;
    const sourceId = source.id;
    const message = event.message;
    system.run(() => {
      const player = world.getAllPlayers().find((p) => p.id === sourceId);
      if (!player) return;
      if (isDeviceEvent) giveDeviceIfMissing(player, true);
      else handleTeleportScriptEvent(player, message);
    });
  }, { namespaces: ["tools"] });
}

/**
 * Release per-player state when someone leaves the world
 */
if (world.afterEvents.playerLeave) {
  world.afterEvents.playerLeave.subscribe((event) => {
    const previewId = activePreviews.get(event.playerId);
    if (previewId !== undefined) {
      system.clearRun(previewId.intervalId);
      activePreviews.delete(event.playerId);
    }
    deviceMenuCooldowns.delete(event.playerId);
  });
}

/**
 * Trigger menu when player uses Helper Device
 */
function handleDeviceUse(event) {
  if (!event.itemStack || event.itemStack.typeId !== ITEM_ID) return;
  const player = event.source;
  if (deviceMenuCooldowns.has(player.id)) return;
  deviceMenuCooldowns.add(player.id);
  system.run(() => {
    if (isValidEntity(player)) openMainMenu(player);
  });
  system.runTimeout(() => deviceMenuCooldowns.delete(player.id), 10);
}

if (world.afterEvents.itemStartUse) world.afterEvents.itemStartUse.subscribe(handleDeviceUse);
if (world.afterEvents.itemUse) world.afterEvents.itemUse.subscribe(handleDeviceUse);

// ==========================================
// 🌟 MAIN CATEGORY MENU (WITH ICONS)
// ==========================================

function openMainMenu(player) {
  const form = new ActionFormData()
    .title("✨ Helper Tools Device ✨")
    .body(`Welcome ${player.name}! Choose a helper category:`)
    .button("🎮 Game Modes & Time\n§7Creative, Survival, Day, Night", "textures/items/clock_item")
    .button("🛡️ Life Savers & Rescue\n§7Heal, Monster Begone, Cave Rescue", "textures/items/totem")
    .button("⚡ Superpowers & Flying\n§7Night Vision, Speed, Elytra Kit", "textures/items/elytra")
    .button("🏗️ Builder Tools\n§7Bases, Bridges, Stairs, and Cleanup", "textures/items/diamond_pickaxe")
    .button("📍 Spawn & Teleport\n§7Spawn, Friends, Biomes, and Structures", "textures/items/compass_item")
    .button("🐾 Pets & Companions\n§7Spawn Dog, Cat, Horse, Golem", "textures/items/bone")
    .button("🎁 Get Extra Helper Device\n§7Give another wand to inventory", "textures/items/helper_device");

  form.show(player).then((response) => {
    if (response.canceled) return;

    switch (response.selection) {
      case 0:
        openGameModeMenu(player);
        break;
      case 1:
        openLifeSaversMenu(player);
        break;
      case 2:
        openSuperpowersMenu(player);
        break;
      case 3:
        openBuilderToolsMenu(player);
        break;
      case 4:
        openSpawnAndTeleportMenu(player);
        break;
      case 5:
        openPetsMenu(player);
        break;
      case 6:
        giveExtraDevice(player);
        break;
    }
  }).catch((e) => console.error("Main menu error: " + e));
}

// ==========================================
// 1. 🎮 GAME MODES & TIME MENU (WITH ICONS)
// ==========================================

function openGameModeMenu(player) {
  const form = new ActionFormData()
    .title("🎮 Game Modes & Time")
    .body("Choose an option:")
    .button("☀️ Set Daytime\n§7Bright sunny daylight", "textures/items/clock_item")
    .button("🌙 Set Nighttime\n§7Starry night", "textures/items/bed_red")
    .button("🌤️ Clear Weather\n§7Stop rain and storms", "textures/items/bucket_water")
    .button("🎨 Creative Mode\n§7Fly and build with infinite blocks", "textures/items/feather")
    .button("⚔️ Survival Mode\n§7Standard survival adventure", "textures/items/diamond_sword")
    .button("⬅️ Back to Main Menu\n§7Return to categories", "textures/ui/arrow_left");

  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        setDaytime(player);
        break;
      case 1:
        setNighttime(player);
        break;
      case 2:
        clearWeather(player);
        break;
      case 3:
        setCreative(player);
        break;
      case 4:
        setSurvival(player);
        break;
      case 5:
        openMainMenu(player);
        break;
    }
  }).catch((e) => console.error("GameMode menu error: " + e));
}

function setDaytime(player) {
  runCommand(player.dimension, "time set day").then(() => {
    player.sendMessage("§e☀️ Time set to Daytime! Enjoy the sunshine!§r");
    player.playSound("random.orb", { volume: 0.8, pitch: 1.2 });
  }).catch((err) => player.sendMessage(`§cError: ${err}§r`));
}

function setNighttime(player) {
  runCommand(player.dimension, "time set night").then(() => {
    player.sendMessage("§b🌙 Time set to Nighttime! Look at the stars!§r");
    player.playSound("random.orb", { volume: 0.8, pitch: 0.8 });
  }).catch((err) => player.sendMessage(`§cError: ${err}§r`));
}

function clearWeather(player) {
  runCommand(player.dimension, "weather clear").then(() => {
    player.sendMessage("§b🌤️ Weather cleared! The skies are bright and blue!§r");
    player.playSound("random.levelup", { volume: 0.7, pitch: 1.4 });
  }).catch((err) => player.sendMessage(`§cError: ${err}§r`));
}

function setCreative(player) {
  runCommand(player, "gamemode creative @s").then(() => {
    player.sendMessage("§a🎨 Switched to Creative Mode! Fly and build anything!§r");
    player.playSound("random.levelup", { volume: 0.8, pitch: 1.5 });
  }).catch((err) => player.sendMessage(`§cError changing gamemode: ${err}§r`));
}

function setSurvival(player) {
  runCommand(player, "gamemode survival @s").then(() => {
    player.sendMessage("§c⚔️ Switched to Survival Mode! Have fun!§r");
    player.playSound("random.levelup", { volume: 0.8, pitch: 1.0 });
  }).catch((err) => player.sendMessage(`§cError changing gamemode: ${err}§r`));
}

// ==========================================
// 2. 🛡️ LIFE SAVERS & RESCUE MENU (WITH ICONS)
// ==========================================

function openLifeSaversMenu(player) {
  const form = new ActionFormData()
    .title("🛡️ Life Savers & Rescue")
    .body("Quick safety tools:")
    .button("❤️ Instant Heal & Feed\n§7Full health hearts and hunger bar", "textures/items/apple_golden")
    .button("🛡️ Monster Begone!\n§7Vanish hostile monsters within 35 blocks", "textures/items/diamond_sword")
    .button("⬆️ Escape to Surface\n§7Cave rescue - warp straight up to fresh air", "textures/blocks/ladder")
    .button("🔥 Lava & Fire Shield\n§7Put out fire & gain Fire Resistance", "textures/items/bucket_lava")
    .button("🥛 Cure All Effects\n§7Clear poison, slowness, wither, blindness", "textures/items/bucket_milk")
    .button("⬅️ Back to Main Menu\n§7Return to categories", "textures/ui/arrow_left");

  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        healAndFeed(player);
        break;
      case 1:
        clearNearbyMonsters(player);
        break;
      case 2:
        escapeToSurface(player);
        break;
      case 3:
        lavaRescue(player);
        break;
      case 4:
        cureAllEffects(player);
        break;
      case 5:
        openMainMenu(player);
        break;
    }
  }).catch((e) => console.error("LifeSavers menu error: " + e));
}

function healAndFeed(player) {
  runCommand(player, "effect @s instant_health 1 255 true").then(() => {
    return runCommand(player, "effect @s saturation 1 255 true");
  }).then(() => {
    player.sendMessage("§a❤️ Full health and hunger restored! You're good to go!§r");
    player.playSound("random.levelup", { volume: 0.9, pitch: 1.4 });
  }).catch((err) => player.sendMessage(`§cError: ${err}§r`));
}

function clearNearbyMonsters(player) {
  try {
    const loc = player.location;
    const dim = player.dimension;
    let count = 0;
    const entities = dim.getEntities({ location: loc, maxDistance: 35 });
    for (const entity of entities) {
      if (HOSTILE_MOBS.has(entity.typeId)) {
        try {
          entity.remove();
          count++;
        } catch (e) {}
      }
    }
    player.sendMessage(`§a🛡️ Monster Begone! Removed ${count} hostile monsters around you!§r`);
    player.playSound("random.explode", { volume: 0.4, pitch: 1.8 });
  } catch (err) {
    player.sendMessage(`§cError clearing monsters: ${err}§r`);
  }
}

function escapeToSurface(player) {
  try {
    const loc = player.location;
    const px = Math.floor(loc.x);
    const pz = Math.floor(loc.z);
    const startY = Math.floor(loc.y);
    const dim = player.dimension;

    let targetY = null;
    const range = getDimensionBuildRange(player);
    for (let y = range.max - 2; y > startY; y--) {
      try {
        const block = dim.getBlock({ x: px, y: y, z: pz });
        if (block && !block.isAir && !LIQUID_BLOCKS.has(block.typeId)) {
          const above1 = dim.getBlock({ x: px, y: y + 1, z: pz });
          const above2 = dim.getBlock({ x: px, y: y + 2, z: pz });
          if (above1 && above1.isAir && above2 && above2.isAir) {
            targetY = y + 1;
            break;
          }
        }
      } catch (e) {
        break;
      }
    }

    if (targetY !== null && targetY > startY) {
      player.teleport({ x: px + 0.5, y: targetY, z: pz + 0.5 });
      player.sendMessage(`§a⬆️ Escaped to the surface at Y=${targetY}! You're back in the open world!§r`);
      player.playSound("mob.endermen.portal", { volume: 0.9, pitch: 1.2 });
    } else {
      player.sendMessage("§e[Helper Tools] Already at surface or could not find open sky above!§r");
    }
  } catch (err) {
    player.sendMessage(`§cError escaping cave: ${err}§r`);
  }
}

/**
 * Finds standing room (two air blocks over solid ground) above the player,
 * or null when there is nowhere safe within `maxLift` blocks.
 */
function findSafeSpotAbove(player, maxLift = 8) {
  const dim = player.dimension;
  const loc = player.location;
  const x = Math.floor(loc.x);
  const z = Math.floor(loc.z);
  const range = getDimensionBuildRange(player);
  for (let lift = 1; lift <= maxLift; lift++) {
    const y = Math.floor(loc.y) + lift;
    if (y + 1 > range.max) break;
    try {
      const feet = dim.getBlock({ x: x, y: y, z: z });
      const head = dim.getBlock({ x: x, y: y + 1, z: z });
      const floor = dim.getBlock({ x: x, y: y - 1, z: z });
      if (feet && feet.isAir && head && head.isAir && floor && !floor.isAir && !LIQUID_BLOCKS.has(floor.typeId)) {
        return { x: x + 0.5, y: y, z: z + 0.5 };
      }
    } catch (e) {
      break;
    }
  }
  return null;
}

function lavaRescue(player) {
  try {
    player.extinguishFire();
    const safeSpot = findSafeSpotAbove(player);
    if (safeSpot) player.teleport(safeSpot);
    Promise.all([
      runCommand(player, "effect @s fire_resistance 120 1 true"),
      runCommand(player, "effect @s instant_health 1 255 true")
    ]).then(() => {
      player.sendMessage("§6🔥 Fire Shield Activated! Fire extinguished & 2 minutes of Fire Resistance granted!§r");
      if (!safeSpot) player.sendMessage("§eNo open ground was found above you, so you stayed put. Use ⬆️ Escape to Surface to get out.§r");
      player.playSound("random.splash", { volume: 0.9, pitch: 1.0 });
    }).catch((err) => player.sendMessage(`§cCould not apply the fire shield: ${err}§r`));
  } catch (err) {
    player.sendMessage(`§cError: ${err}§r`);
  }
}

function cureAllEffects(player) {
  runCommand(player, "effect @s clear").then(() => {
    player.sendMessage("§f🥛 All potion effects cured (just like a fresh bucket of milk)!§r");
    player.playSound("random.drink", { volume: 0.9, pitch: 1.0 });
  }).catch((err) => player.sendMessage(`§cError: ${err}§r`));
}

// ==========================================
// 3. ⚡ SUPERPOWERS & MOBILITY MENU (WITH ICONS)
// ==========================================

function openSuperpowersMenu(player) {
  const form = new ActionFormData()
    .title("⚡ Superpowers & Flying")
    .body("Choose a superpower:")
    .button("👀 Night Vision (15 Min)\n§7See clearly in dark caves and underwater", "textures/items/potion_bottle_nightVision")
    .button("🏃 Super Speed & Jump (5 Min)\n§7Run super fast and jump high", "textures/items/sugar")
    .button("🪽 Get Elytra & Flight Rockets\n§7Fly around the world with glider wings", "textures/items/elytra")
    .button("⬅️ Back to Main Menu\n§7Return to categories", "textures/ui/arrow_left");

  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        runCommand(player, "effect @s night_vision 900 0 true").then(() => {
          player.sendMessage("§b👀 Night Vision activated for 15 minutes! Dark places are fully lit!§r");
          player.playSound("random.orb", { volume: 0.9, pitch: 1.5 });
        }).catch((err) => player.sendMessage(`§cCould not apply Night Vision: ${err}§r`));
        break;
      case 1:
        runCommand(player, "effect @s speed 300 1 true").then(() => {
          return runCommand(player, "effect @s jump_boost 300 1 true");
        }).then(() => {
          player.sendMessage("§e⚡ Super Speed & High Jump active for 5 minutes! Zoom around!§r");
          player.playSound("random.levelup", { volume: 0.9, pitch: 1.8 });
        }).catch((err) => player.sendMessage(`§cCould not apply movement effects: ${err}§r`));
        break;
      case 2:
        giveElytraKit(player);
        break;
      case 3:
        openMainMenu(player);
        break;
    }
  }).catch((e) => console.error("Superpowers menu error: " + e));
}

function giveElytraKit(player) {
  try {
    const inv = player.getComponent("inventory");
    const container = inv && inv.container;
    let droppedOverflow = false;
    for (const item of [
      new ItemStack("minecraft:elytra", 1),
      new ItemStack("minecraft:firework_rocket", 64)
    ]) {
      const leftover = container ? container.addItem(item) : item;
      if (leftover) {
        player.dimension.spawnItem(leftover, {
          x: player.location.x,
          y: player.location.y + 0.5,
          z: player.location.z
        });
        droppedOverflow = true;
      }
    }
    const overflowMessage = droppedOverflow
      ? " Your inventory was full, so the overflow was dropped at your feet."
      : "";
    player.sendMessage(`§b🪽 Elytra & 64 Flight Fireworks added!${overflowMessage}§r`);
    player.playSound("random.levelup", { volume: 0.9, pitch: 1.4 });
  } catch (err) {
    player.sendMessage(`§cCould not grant the Elytra kit: ${err}§r`);
  }
}

// ==========================================
// 4. 🏗️ BUILDER TOOLS MENU (WITH ICONS)
// ==========================================

function openBuilderToolsMenu(player) {
  const form = new ActionFormData()
    .title("🏗️ Builder Tools")
    .body("Choose a builder tool:")
    .button("🕳️ Dig an Empty Hole\n§7Clear out ground with 3D glowing preview", "textures/items/diamond_shovel")
    .button("🧱 Build / Fill Blocks\n§7Place blocks or rooms with 3D guide", "textures/items/brick")
    .button("🚜 Flatten / Level Ground\n§7Level land for building with preview", "textures/items/iron_hoe")
    .button("🪜 Instant Underfoot Platform\n§7Create a platform right under your feet", "textures/blocks/ladder")
    .button("🏠 Starter Base Templates\n§7Houses, fort, tree house, and bunker", "textures/items/bed_red")
    .button("🌉 Bridge & Stair Builder\n§7Build safe paths in the direction you face", "textures/blocks/planks_oak")
    .button("💡 Light Up Area\n§7Place torches on dark surfaces around you", "textures/blocks/torch_on")
    .button("🧹 Area Cleanup\n§7Remove selected clutter around you", "textures/items/bucket_empty")
    .button("↩️ Undo Last Build/Hole\n§7Revert your last building action", "textures/ui/refresh")
    .button("⬅️ Back to Main Menu\n§7Return to categories", "textures/ui/arrow_left");

  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        openDigHoleMenu(player);
        break;
      case 1:
        openFillBlocksMenu(player);
        break;
      case 2:
        openLevelGroundMenu(player);
        break;
      case 3:
        openPlatformMenu(player);
        break;
      case 4:
        openBaseBuilderMenu(player);
        break;
      case 5:
        openBridgeAndStairMenu(player);
        break;
      case 6:
        lightUpArea(player);
        break;
      case 7:
        openAreaCleanupMenu(player);
        break;
      case 8:
        executeUndo(player);
        break;
      case 9:
        openMainMenu(player);
        break;
    }
  }).catch((e) => console.error("Builder menu error: " + e));
}

/**
 * Draw 3D wireframe bounding box using particle effects
 */
function drawBoxOutline(dimension, bounds, particleName = "minecraft:villager_happy", step = 1.0) {
  const minX = bounds.x1, maxX = bounds.x2 + 1;
  const minY = bounds.y1, maxY = bounds.y2 + 1;
  const minZ = bounds.z1, maxZ = bounds.z2 + 1;

  try {
    for (let x = minX; x <= maxX; x += step) {
      dimension.spawnParticle(particleName, { x: x, y: minY, z: minZ });
      dimension.spawnParticle(particleName, { x: x, y: minY, z: maxZ });
      dimension.spawnParticle(particleName, { x: x, y: maxY, z: minZ });
      dimension.spawnParticle(particleName, { x: x, y: maxY, z: maxZ });
    }
    for (let y = minY; y <= maxY; y += step) {
      dimension.spawnParticle(particleName, { x: minX, y: y, z: minZ });
      dimension.spawnParticle(particleName, { x: minX, y: y, z: maxZ });
      dimension.spawnParticle(particleName, { x: maxX, y: y, z: minZ });
      dimension.spawnParticle(particleName, { x: maxX, y: y, z: maxZ });
    }
    for (let z = minZ; z <= maxZ; z += step) {
      dimension.spawnParticle(particleName, { x: minX, y: minY, z: z });
      dimension.spawnParticle(particleName, { x: minX, y: maxY, z: z });
      dimension.spawnParticle(particleName, { x: maxX, y: minY, z: z });
      dimension.spawnParticle(particleName, { x: maxX, y: maxY, z: z });
    }
  } catch (e) {}
}

/**
 * Start 3D visual preview and prompt player with confirmation dialog
 */
function startPreview(player, bounds, particleName, promptText, onConfirm) {
  const id = player.id;
  const previous = activePreviews.get(id);
  if (previous) system.clearRun(previous.intervalId);

  const dimension = player.dimension;
  const dimensionId = dimension.id;
  const session = { intervalId: undefined };
  activePreviews.set(id, session);
  const isCurrent = () => activePreviews.get(id) === session;
  const stop = () => {
    system.clearRun(session.intervalId);
    if (isCurrent()) activePreviews.delete(id);
  };
  let ticks = 0;
  session.intervalId = system.runInterval(() => {
    ticks += 5;
    if (!isCurrent() || !isValidEntity(player) || player.dimension.id !== dimensionId) {
      stop();
      return;
    }
    if (ticks > 300) {
      // Stop drawing after 15 seconds, but keep this confirmation valid.
      system.clearRun(session.intervalId);
      return;
    }
    drawBoxOutline(dimension, bounds, particleName, 1.0);
  }, 5);

  player.playSound("random.orb", { volume: 0.8, pitch: 1.4 });
  player.sendMessage("§e✨ Visual Guide Active! Look at the glowing box in front of you.§r");

  const confirmForm = new MessageFormData()
    .title("✨ Visual Preview Guide")
    .body(promptText + "\n\n§7Look in front of you to see the 3D glowing box outline in the world!§r")
    .button1("✅ Confirm & Execute")
    .button2("❌ Cancel");

  system.runTimeout(() => {
    if (!isCurrent()) return;
    if (!isValidEntity(player) || player.dimension.id !== dimensionId) {
      stop();
      return;
    }
    confirmForm.show(player).then((res) => {
      // An older form must never clear or execute a newer preview.
      if (!isCurrent()) return;
      stop();
      if (!isValidEntity(player)) return;
      if (!res.canceled && res.selection === 0) {
        if (player.dimension.id !== dimensionId) {
          player.sendMessage("§eYou changed dimensions after opening the preview. Open the builder again here.§r");
          return;
        }
        onConfirm();
      } else {
        player.sendMessage("§7Action canceled.§r");
      }
    }).catch((e) => {
      stop();
      console.error("Confirm form error: " + e);
    });
  }, 8);
}

function getPlayerFacing(player) {
  const dir = player.getViewDirection();
  if (Math.abs(dir.x) > Math.abs(dir.z)) {
    return dir.x > 0 ? "EAST" : "WEST";
  } else {
    return dir.z > 0 ? "SOUTH" : "NORTH";
  }
}

function calculateBounds(player, width, length, verticalSize, verticalDir = "up") {
  const loc = player.location;
  const px = Math.floor(loc.x);
  const py = Math.floor(loc.y);
  const pz = Math.floor(loc.z);

  const facing = getPlayerFacing(player);
  const halfW1 = Math.floor((width - 1) / 2);
  const halfW2 = width - 1 - halfW1;

  let y1, y2;
  if (verticalDir === "down") {
    y2 = py - 1;
    y1 = py - verticalSize;
  } else {
    y1 = py;
    y2 = py + verticalSize - 1;
  }

  let x1, x2, z1, z2;
  const startOffset = 1;
  const endOffset = startOffset + length - 1;

  switch (facing) {
    case "SOUTH": // +Z
      x1 = px - halfW1;
      x2 = px + halfW2;
      z1 = pz + startOffset;
      z2 = pz + endOffset;
      break;
    case "NORTH": // -Z
      x1 = px - halfW2;
      x2 = px + halfW1;
      z1 = pz - endOffset;
      z2 = pz - startOffset;
      break;
    case "EAST": // +X
      x1 = px + startOffset;
      x2 = px + endOffset;
      z1 = pz - halfW1;
      z2 = pz + halfW2;
      break;
    case "WEST": // -X
      x1 = px - endOffset;
      x2 = px - startOffset;
      z1 = pz - halfW2;
      z2 = pz + halfW1;
      break;
  }

  return {
    x1: Math.min(x1, x2),
    y1: Math.min(y1, y2),
    z1: Math.min(z1, z2),
    x2: Math.max(x1, x2),
    y2: Math.max(y1, y2),
    z2: Math.max(z1, z2)
  };
}

function getBuildRangeForDimension(dimensionId) {
  const dimensionName = String(dimensionId).replace(/^minecraft:/, "");
  if (dimensionName === "nether") return { min: 0, max: 127 };
  if (dimensionName === "the_end") return { min: 0, max: 255 };
  return { min: -64, max: 319 };
}

function getDimensionBuildRange(player) {
  return getBuildRangeForDimension(player.dimension.id);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Returns a Y value the player can safely be placed at, or null if none was
 * found. World spawn reports Y as 32767 when the spawn height is "wherever the
 * ground happens to be", which is far outside the world and cannot be used.
 */
function resolveStandableY(dimension, location) {
  const range = getBuildRangeForDimension(dimension.id);
  const y = Math.floor(Number(location.y));
  if (Number.isFinite(y) && y >= range.min && y <= range.max) return y;
  try {
    const topBlock = dimension.getTopmostBlock({ x: Math.floor(location.x), z: Math.floor(location.z) });
    if (topBlock) return Math.min(range.max - 1, topBlock.location.y + 1);
  } catch (e) {}
  return null;
}

function validateBuildBounds(player, bounds) {
  const range = getDimensionBuildRange(player);
  if (bounds.y1 < range.min || bounds.y2 > range.max) {
    player.sendMessage(`§cThis action would cross the dimension height limit (${range.min} to ${range.max}). Move to a safer height and try again.§r`);
    return false;
  }
  return true;
}

function getHollowHoleBounds(bounds) {
  const interior = {
    x1: bounds.x1 + 1,
    y1: bounds.y1 + 1,
    z1: bounds.z1 + 1,
    x2: bounds.x2 - 1,
    y2: bounds.y2,
    z2: bounds.z2 - 1
  };
  if (interior.x1 > interior.x2 || interior.y1 > interior.y2 || interior.z1 > interior.z2) return null;
  return interior;
}

function getUndoStructureName(player) {
  const safePlayerId = String(player.id).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `helper_tools:undo_${safePlayerId}`;
}

function getDimensionById(dimensionId) {
  return world.getDimension(String(dimensionId).replace(/^minecraft:/, ""));
}

async function captureUndoSnapshot(player, bounds, type) {
  const structureName = getUndoStructureName(player);
  const command = `structure save ${structureName} ${bounds.x1} ${bounds.y1} ${bounds.z1} ${bounds.x2} ${bounds.y2} ${bounds.z2} false memory true`;
  const record = { type, bounds, structureName, dimensionId: player.dimension.id };
  await runCommand(player.dimension, command);
  undoHistory.set(player.id, record);
  return record;
}

function isValidBlockId(blockId) {
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(blockId);
}

function createOrientedBuildContext(player, width, length, baseYOffset = -1) {
  const loc = player.location;
  const px = Math.floor(loc.x);
  const pz = Math.floor(loc.z);
  const facing = getPlayerFacing(player);
  const vectors = {
    SOUTH: { forwardX: 0, forwardZ: 1, rightX: 1, rightZ: 0 },
    NORTH: { forwardX: 0, forwardZ: -1, rightX: -1, rightZ: 0 },
    EAST: { forwardX: 1, forwardZ: 0, rightX: 0, rightZ: -1 },
    WEST: { forwardX: -1, forwardZ: 0, rightX: 0, rightZ: 1 }
  };
  const vector = vectors[facing];
  const halfWidth = Math.floor((width - 1) / 2);
  const centerX = px + vector.forwardX;
  const centerZ = pz + vector.forwardZ;
  return {
    width,
    length,
    baseY: Math.floor(loc.y) + baseYOffset,
    originX: centerX - vector.rightX * halfWidth,
    originZ: centerZ - vector.rightZ * halfWidth,
    ...vector
  };
}

function localPoint(context, x, y, z) {
  return {
    x: context.originX + context.rightX * x + context.forwardX * z,
    y: context.baseY + y,
    z: context.originZ + context.rightZ * x + context.forwardZ * z
  };
}

function localBounds(context, x1, y1, z1, x2, y2, z2) {
  const a = localPoint(context, x1, y1, z1);
  const b = localPoint(context, x2, y2, z2);
  return {
    x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), z1: Math.min(a.z, b.z),
    x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y), z2: Math.max(a.z, b.z)
  };
}

function fillLocal(context, x1, y1, z1, x2, y2, z2, blockId, mode = "") {
  const bounds = localBounds(context, x1, y1, z1, x2, y2, z2);
  return `fill ${bounds.x1} ${bounds.y1} ${bounds.z1} ${bounds.x2} ${bounds.y2} ${bounds.z2} ${blockId}${mode ? ` ${mode}` : ""}`;
}

function setLocal(context, x, y, z, blockId) {
  const point = localPoint(context, x, y, z);
  return `setblock ${point.x} ${point.y} ${point.z} ${blockId}`;
}

function pushShellCommands(commands, context, x1, y1, z1, x2, y2, z2, blockId) {
  commands.push(fillLocal(context, x1, y1, z1, x2, y1, z2, blockId));
  commands.push(fillLocal(context, x1, y2, z1, x2, y2, z2, blockId));
  commands.push(fillLocal(context, x1, y1, z1, x1, y2, z2, blockId));
  commands.push(fillLocal(context, x2, y1, z1, x2, y2, z2, blockId));
  commands.push(fillLocal(context, x1, y1, z1, x2, y2, z1, blockId));
  commands.push(fillLocal(context, x1, y1, z2, x2, y2, z2, blockId));
}

// Commands can fail when their target blocks already have the requested type.
// Verify the actual result instead of matching localized error text or swallowing
// failures such as unloaded chunks, invalid block IDs, or height limits.
function blockCommandIsSatisfied(dimension, command) {
  const parts = command.split(/\s+/);
  if (parts[0] !== "fill" && parts[0] !== "setblock") return false;
  const isFill = parts[0] === "fill";
  const coords = parts.slice(1, isFill ? 7 : 4).map(Number);
  if (!coords.every(Number.isInteger)) return false;
  const [x1, y1, z1] = coords;
  const [x2, y2, z2] = isFill ? coords.slice(3) : coords;
  if (x1 > x2 || y1 > y2 || z1 > z2) return false;
  const blockId = parts[isFill ? 7 : 4];
  const mode = parts[isFill ? 8 : 5] || "replace";
  if (!isValidBlockId(blockId) || !["replace", "hollow", "outline"].includes(mode)) return false;
  if (parts.length > (isFill ? 9 : 6)) return false;
  try {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
      const boundary = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
      if (!boundary && mode === "outline") continue;
      const expected = !boundary && mode === "hollow" ? "minecraft:air" : blockId;
      const block = dimension.getBlock({ x, y, z });
      if (!block || block.typeId !== expected) return false;
    }
    return true;
  } catch (e) { return false; }
}

async function runBlockCommand(dimension, command) {
  try { return await runCommand(dimension, command); }
  catch (err) {
    if (!blockCommandIsSatisfied(dimension, command)) throw err;
    return { successCount: 0 };
  }
}

async function runBuildCommands(dimension, commands) {
  for (const command of commands) await runBlockCommand(dimension, command);
}

function executeBuildPlanUnlocked(player, plan, actionType, successMessage, sound = "dig.stone") {
  if (plan.dimensionId !== player.dimension.id) {
    player.sendMessage("§eYou changed dimensions after opening the preview. Open the builder again here.§r");
    return;
  }
  if (!validateBuildBounds(player, plan.bounds)) return;
  player.sendMessage(`§e🏗️ Building ${plan.name}...§r`);
  return captureUndoSnapshot(player, plan.bounds, actionType).then(async (record) => {
    await runBuildCommands(getDimensionById(record.dimensionId), plan.commands);
  }).then(() => {
    player.sendMessage(`§a${successMessage}§r`);
    player.playSound(sound, { volume: 1.0, pitch: 1.1 });
  }).catch((err) => {
    player.sendMessage(`§cBuild stopped because a command failed: ${err}§r`);
    player.sendMessage("§eUse Undo Last Build to restore the area.§r");
  });
}

function openDigHoleMenu(player) {
  const form = new ModalFormData()
    .title("🕳️ Dig an Empty Hole")
    .slider("Width (Blocks Wide):", 1, 25, { valueStep: 1, defaultValue: 3 })
    .slider("Depth (Blocks Deep into Ground):", 1, 25, { valueStep: 1, defaultValue: 3 })
    .slider("Length (Blocks Forward):", 1, 25, { valueStep: 1, defaultValue: 5 })
    .toggle("Hollow Hole (keeps outer shell)", { defaultValue: false })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });

  form.show(player).then((response) => {
    if (response.canceled) return;
    const [width, depth, length, hollow, showGuide] = response.formValues;
    const w = Math.round(width), d = Math.round(depth), l = Math.round(length);
    const bounds = calculateBounds(player, w, l, d, "down");

    if (showGuide) {
      startPreview(
        player,
        bounds,
        "minecraft:wax_particle",
        `Do you want to dig a ${w}x${d}x${l} hole here?`,
        () => executeDigHole(player, bounds, w, d, l, hollow)
      );
    } else {
      executeDigHole(player, bounds, w, d, l, hollow);
    }
  }).catch((e) => console.error("Dig menu error: " + e));
}

function executeDigHoleUnlocked(player, bounds, width, depth, length, hollow) {
  const digBounds = hollow ? getHollowHoleBounds(bounds) : bounds;
  if (!digBounds) {
    player.sendMessage("§eA hollow hole needs width and length of at least 3 blocks, and depth of at least 2 blocks.§r");
    return;
  }
  if (!validateBuildBounds(player, digBounds)) return;
  const cmd = `fill ${digBounds.x1} ${digBounds.y1} ${digBounds.z1} ${digBounds.x2} ${digBounds.y2} ${digBounds.z2} minecraft:air`;

  return captureUndoSnapshot(player, digBounds, "hole").then((record) => {
    return runBlockCommand(getDimensionById(record.dimensionId), cmd);
  }).then(() => {
    player.sendMessage(`§a🕳️ Hole created! (${width} wide, ${depth} deep, ${length} forward)§r`);
    player.playSound("dig.stone", { volume: 1.0, pitch: 0.8 });
  }).catch((err) => {
    player.sendMessage(`§c❌ Could not dig hole: ${err}§r`);
  });
}

function openFillBlocksMenu(player) {
  const blockNames = BLOCK_OPTIONS.map((b) => b.name);
  const fillStyles = ["Solid (Filled)", "Hollow (Room with empty inside)", "Outline (Frame only)"];

  const form = new ModalFormData()
    .title("🧱 Build / Fill Blocks")
    .dropdown("Choose Block Type:", blockNames, { defaultValueIndex: 0 })
    .textField("Or Custom Block ID (e.g. quartz_block):", "leave blank if choosing from list")
    .slider("Width (Blocks Wide):", 1, 25, { valueStep: 1, defaultValue: 3 })
    .slider("Height (Blocks High):", 1, 25, { valueStep: 1, defaultValue: 3 })
    .slider("Length (Blocks Forward):", 1, 25, { valueStep: 1, defaultValue: 5 })
    .dropdown("Structure Style:", fillStyles, { defaultValueIndex: 0 })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });

  form.show(player).then((response) => {
    if (response.canceled) return;
    const [blockIndex, customBlock, width, height, length, styleIndex, showGuide] = response.formValues;

    let selectedBlock = BLOCK_OPTIONS[blockIndex].id;
    if (customBlock && customBlock.trim().length > 0) {
      let cb = customBlock.trim();
      if (!cb.includes(":")) cb = "minecraft:" + cb;
      selectedBlock = cb;
    }

    if (!isValidBlockId(selectedBlock)) {
      player.sendMessage("§cInvalid block ID. Use a value such as minecraft:quartz_block.§r");
      return;
    }

    const w = Math.round(width), h = Math.round(height), l = Math.round(length);
    const style = styleIndex === 1 ? "hollow" : (styleIndex === 2 ? "outline" : "replace");
    const bounds = calculateBounds(player, w, l, h, "up");

    if (showGuide) {
      startPreview(
        player,
        bounds,
        "minecraft:villager_happy",
        `Do you want to build a ${w}x${h}x${l} structure with ${selectedBlock}?`,
        () => executeFillBlocks(player, bounds, selectedBlock, w, h, l, style)
      );
    } else {
      executeFillBlocks(player, bounds, selectedBlock, w, h, l, style);
    }
  }).catch((e) => console.error("Fill menu error: " + e));
}

function executeFillBlocksUnlocked(player, bounds, blockId, width, height, length, style) {
  if (!validateBuildBounds(player, bounds)) return;
  const cmd = `fill ${bounds.x1} ${bounds.y1} ${bounds.z1} ${bounds.x2} ${bounds.y2} ${bounds.z2} ${blockId} ${style}`;

  return captureUndoSnapshot(player, bounds, "fill").then((record) => {
    return runBlockCommand(getDimensionById(record.dimensionId), cmd);
  }).then(() => {
    player.sendMessage(`§a🧱 Blocks placed! (${width}x${height}x${length} of ${blockId})§r`);
    player.playSound("dig.stone", { volume: 1.0, pitch: 1.2 });
  }).catch((err) => {
    player.sendMessage(`§c❌ Could not place blocks: ${err}§r`);
  });
}

function openLevelGroundMenu(player) {
  const surfaces = [
    { name: "Grass Block 🟩", id: "minecraft:grass_block" },
    { name: "Stone 🗿", id: "minecraft:stone" },
    { name: "Smooth Stone 🧱", id: "minecraft:smooth_stone" },
    { name: "Dirt 🟫", id: "minecraft:dirt" },
    { name: "Oak Planks 🪵", id: "minecraft:oak_planks" },
    { name: "Sand 🏖️", id: "minecraft:sand" }
  ];

  const form = new ModalFormData()
    .title("🚜 Flatten / Level Ground")
    .slider("Radius (Blocks around you):", 5, 20, { valueStep: 1, defaultValue: 10 })
    .dropdown("Ground Floor Block:", surfaces.map(s => s.name), { defaultValueIndex: 0 })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });

  form.show(player).then((response) => {
    if (response.canceled) return;
    const [radius, surfaceIdx, showGuide] = response.formValues;
    const r = Math.round(radius);
    const floorBlock = surfaces[surfaceIdx].id;

    const loc = player.location;
    const px = Math.floor(loc.x);
    const py = Math.floor(loc.y);
    const pz = Math.floor(loc.z);

    const bounds = {
      x1: px - r, x2: px + r,
      y1: py - 1, y2: py + 10,
      z1: pz - r, z2: pz + r
    };

    if (showGuide) {
      startPreview(
        player,
        bounds,
        "minecraft:villager_happy",
        `Do you want to flatten a ${r}-block radius area around you with ${floorBlock}?`,
        () => executeLevelGround(player, bounds, r, floorBlock)
      );
    } else {
      executeLevelGround(player, bounds, r, floorBlock);
    }
  }).catch((e) => console.error("Level menu error: " + e));
}

function executeLevelGroundUnlocked(player, bounds, radius, floorBlock) {
  const clearCmd = `fill ${bounds.x1} ${bounds.y1 + 1} ${bounds.z1} ${bounds.x2} ${bounds.y2} ${bounds.z2} minecraft:air`;
  const floorCmd = `fill ${bounds.x1} ${bounds.y1} ${bounds.z1} ${bounds.x2} ${bounds.y1} ${bounds.z2} ${floorBlock}`;

  if (!validateBuildBounds(player, bounds)) return;
  return captureUndoSnapshot(player, bounds, "level").then((record) => {
    const dimension = getDimensionById(record.dimensionId);
    return runBlockCommand(dimension, clearCmd).then(() => runBlockCommand(dimension, floorCmd));
  }).then(() => {
    player.sendMessage(`§a🚜 Land flattened in a ${radius}-block radius with ${floorBlock}! Ready to build!§r`);
    player.playSound("dig.grass", { volume: 1.0, pitch: 1.0 });
  }).catch((err) => player.sendMessage(`§cError leveling land: ${err}§r`));
}

function openPlatformMenu(player) {
  const platformBlocks = [
    { name: "Glass (Clear View) 🪟", id: "minecraft:glass" },
    { name: "Oak Wood Planks 🪵", id: "minecraft:oak_planks" },
    { name: "Smooth Stone 🧱", id: "minecraft:smooth_stone" },
    { name: "Glowstone (Lights up!) 💡", id: "minecraft:glowstone" },
    { name: "Obsidian (Indestructible) ⬛", id: "minecraft:obsidian" }
  ];

  const form = new ModalFormData()
    .title("🪜 Instant Underfoot Platform")
    .slider("Platform Size (3x3 to 9x9):", 3, 9, { valueStep: 2, defaultValue: 5 })
    .dropdown("Platform Block:", platformBlocks.map(b => b.name), { defaultValueIndex: 0 })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });

  form.show(player).then((response) => {
    if (response.canceled) return;
    const [size, blockIdx, showGuide] = response.formValues;
    const s = Math.round(size);
    const half = Math.floor((s - 1) / 2);
    const blockId = platformBlocks[blockIdx].id;

    const loc = player.location;
    const px = Math.floor(loc.x);
    const py = Math.floor(loc.y) - 1;
    const pz = Math.floor(loc.z);

    const bounds = {
      x1: px - half, x2: px + half,
      y1: py, y2: py,
      z1: pz - half, z2: pz + half
    };

    if (showGuide) {
      startPreview(
        player,
        bounds,
        "minecraft:villager_happy",
        `Do you want to place a ${s}x${s} platform under your feet?`,
        () => executePlatform(player, bounds, s, blockId)
      );
    } else {
      executePlatform(player, bounds, s, blockId);
    }
  }).catch((e) => console.error("Platform menu error: " + e));
}

function executePlatformUnlocked(player, bounds, size, blockId) {
  if (!validateBuildBounds(player, bounds)) return;
  const cmd = `fill ${bounds.x1} ${bounds.y1} ${bounds.z1} ${bounds.x2} ${bounds.y2} ${bounds.z2} ${blockId}`;
  return captureUndoSnapshot(player, bounds, "platform").then((record) => {
    return runBlockCommand(getDimensionById(record.dimensionId), cmd);
  }).then(() => {
    player.sendMessage(`§a🪜 ${size}x${size} Platform created under your feet!§r`);
    player.playSound("dig.wood", { volume: 1.0, pitch: 1.2 });
  }).catch((err) => player.sendMessage(`§cError creating platform: ${err}§r`));
}

function openBaseBuilderMenu(player) {
  const form = new ActionFormData()
    .title("🏠 Starter Base Templates")
    .body("Choose a base. It will be placed in the direction you are facing:");
  for (const template of BASE_TEMPLATES) {
    form.button(`${template.name}\n§7${template.size} • ${template.description}`);
  }
  form.button("⬅️ Back\n§7Return to Builder Tools");
  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === BASE_TEMPLATES.length) return openBuilderToolsMenu(player);
    const template = BASE_TEMPLATES[response.selection];
    if (!template) return;
    const plan = createBaseTemplatePlan(player, template.key);
    if (!plan || !validateBuildBounds(player, plan.bounds)) return;
    startPreview(
      player,
      plan.bounds,
      "minecraft:villager_happy",
      `${template.name}\n${template.description}\n\nBuild this template here?`,
      () => executeBuildPlan(player, plan, `base_${template.key}`, `🏠 ${template.name} completed!`, "dig.wood")
    );
  }).catch((e) => console.error("Base builder menu error: " + e));
}

function createBaseTemplatePlan(player, templateKey) {
  if (templateKey === "simple_house") return createSimpleHousePlan(player);
  if (templateKey === "large_house") return createLargeHousePlan(player);
  if (templateKey === "fort") return createFortPlan(player);
  if (templateKey === "tree_house") return createTreeHousePlan(player);
  if (templateKey === "bunker") return createBunkerPlan(player);
  return null;
}

function makePlan(player, name, context, commands, bounds) {
  return { name, dimensionId: player.dimension.id, context, commands, bounds };
}

function createSimpleHousePlan(player) {
  const c = createOrientedBuildContext(player, 9, 9, -1);
  const q = [];
  q.push(fillLocal(c, 0, 0, 0, 8, 0, 8, "minecraft:stone_bricks"));
  q.push(fillLocal(c, 0, 1, 0, 8, 4, 0, "minecraft:oak_planks"));
  q.push(fillLocal(c, 0, 1, 8, 8, 4, 8, "minecraft:oak_planks"));
  q.push(fillLocal(c, 0, 1, 0, 0, 4, 8, "minecraft:oak_planks"));
  q.push(fillLocal(c, 8, 1, 0, 8, 4, 8, "minecraft:oak_planks"));
  q.push(fillLocal(c, 1, 1, 1, 7, 4, 7, "minecraft:air"));
  q.push(fillLocal(c, 4, 1, 0, 4, 2, 0, "minecraft:air"));
  q.push(setLocal(c, 2, 2, 0, "minecraft:glass"), setLocal(c, 6, 2, 0, "minecraft:glass"));
  q.push(fillLocal(c, 2, 2, 8, 6, 2, 8, "minecraft:glass"));
  q.push(fillLocal(c, 0, 2, 3, 0, 2, 5, "minecraft:glass"));
  q.push(fillLocal(c, 8, 2, 3, 8, 2, 5, "minecraft:glass"));
  for (const x of [0, 8]) for (const z of [0, 8]) q.push(fillLocal(c, x, 1, z, x, 4, z, "minecraft:oak_log"));
  q.push(fillLocal(c, 0, 5, 0, 8, 5, 8, "minecraft:dark_oak_planks"));
  q.push(fillLocal(c, 1, 6, 1, 7, 6, 7, "minecraft:oak_planks"));
  q.push(setLocal(c, 2, 1, 6, "minecraft:crafting_table"));
  q.push(setLocal(c, 3, 1, 6, "minecraft:furnace"));
  q.push(setLocal(c, 6, 1, 6, "minecraft:chest"));
  q.push(setLocal(c, 4, 4, 4, "minecraft:sea_lantern"));
  return makePlan(player, "Simple House", c, q, localBounds(c, 0, 0, 0, 8, 6, 8));
}

function createLargeHousePlan(player) {
  const c = createOrientedBuildContext(player, 15, 11, -1);
  const q = [];
  q.push(fillLocal(c, 0, 0, 0, 14, 0, 10, "minecraft:stone_bricks"));
  q.push(fillLocal(c, 0, 1, 0, 14, 7, 0, "minecraft:spruce_planks"));
  q.push(fillLocal(c, 0, 1, 10, 14, 7, 10, "minecraft:spruce_planks"));
  q.push(fillLocal(c, 0, 1, 0, 0, 7, 10, "minecraft:spruce_planks"));
  q.push(fillLocal(c, 14, 1, 0, 14, 7, 10, "minecraft:spruce_planks"));
  q.push(fillLocal(c, 1, 1, 1, 13, 7, 9, "minecraft:air"));
  q.push(fillLocal(c, 1, 4, 1, 13, 4, 9, "minecraft:oak_planks"));
  q.push(fillLocal(c, 1, 4, 2, 3, 4, 6, "minecraft:air"));
  q.push(fillLocal(c, 7, 1, 0, 7, 2, 0, "minecraft:air"));
  for (const y of [2, 6]) {
    q.push(fillLocal(c, 3, y, 0, 5, y, 0, "minecraft:glass"));
    q.push(fillLocal(c, 9, y, 0, 11, y, 0, "minecraft:glass"));
    q.push(fillLocal(c, 3, y, 10, 11, y, 10, "minecraft:glass"));
    q.push(fillLocal(c, 0, y, 3, 0, y, 7, "minecraft:glass"));
    q.push(fillLocal(c, 14, y, 3, 14, y, 7, "minecraft:glass"));
  }
  for (let step = 0; step < 4; step++) {
    q.push(fillLocal(c, 1, 1, 2 + step, 3, 1 + step, 2 + step, "minecraft:stone_bricks"));
    q.push(fillLocal(c, 1, 2 + step, 2 + step, 3, 3 + step, 2 + step, "minecraft:air"));
  }
  q.push(fillLocal(c, 0, 8, 0, 14, 8, 10, "minecraft:dark_oak_planks"));
  q.push(setLocal(c, 10, 1, 8, "minecraft:chest"));
  q.push(setLocal(c, 11, 1, 8, "minecraft:crafting_table"));
  q.push(setLocal(c, 12, 1, 8, "minecraft:furnace"));
  q.push(setLocal(c, 7, 3, 5, "minecraft:sea_lantern"), setLocal(c, 7, 7, 5, "minecraft:sea_lantern"));
  return makePlan(player, "Large House", c, q, localBounds(c, 0, 0, 0, 14, 8, 10));
}

function createFortPlan(player) {
  const c = createOrientedBuildContext(player, 15, 15, -1);
  const q = [];
  q.push(fillLocal(c, 0, 0, 0, 14, 0, 14, "minecraft:stone_bricks"));
  q.push(fillLocal(c, 1, 1, 1, 13, 8, 13, "minecraft:air"));
  q.push(fillLocal(c, 0, 1, 0, 14, 6, 0, "minecraft:cobblestone"));
  q.push(fillLocal(c, 0, 1, 14, 14, 6, 14, "minecraft:cobblestone"));
  q.push(fillLocal(c, 0, 1, 0, 0, 6, 14, "minecraft:cobblestone"));
  q.push(fillLocal(c, 14, 1, 0, 14, 6, 14, "minecraft:cobblestone"));
  for (const [x1, z1, x2, z2] of [[0, 0, 3, 3], [11, 0, 14, 3], [0, 11, 3, 14], [11, 11, 14, 14]]) {
    pushShellCommands(q, c, x1, 1, z1, x2, 8, z2, "minecraft:stone_bricks");
    q.push(fillLocal(c, x1 + 1, 2, z1 + 1, x2 - 1, 7, z2 - 1, "minecraft:air"));
  }
  q.push(fillLocal(c, 6, 1, 0, 8, 3, 0, "minecraft:air"));
  for (let n = 0; n <= 14; n += 2) {
    q.push(setLocal(c, n, 7, 0, "minecraft:stone_bricks"), setLocal(c, n, 7, 14, "minecraft:stone_bricks"));
    q.push(setLocal(c, 0, 7, n, "minecraft:stone_bricks"), setLocal(c, 14, 7, n, "minecraft:stone_bricks"));
  }
  for (const [x, z] of [[1, 1], [13, 1], [1, 13], [13, 13]]) q.push(setLocal(c, x, 9, z, "minecraft:stone_bricks"));
  q.push(setLocal(c, 4, 0, 7, "minecraft:sea_lantern"), setLocal(c, 10, 0, 7, "minecraft:sea_lantern"));
  q.push(setLocal(c, 7, 1, 10, "minecraft:crafting_table"), setLocal(c, 8, 1, 10, "minecraft:chest"));
  return makePlan(player, "Stone Fort", c, q, localBounds(c, 0, 0, 0, 14, 9, 14));
}

function createTreeHousePlan(player) {
  const c = createOrientedBuildContext(player, 11, 15, -1);
  const q = [];
  q.push(fillLocal(c, 5, 0, 10, 5, 8, 10, "minecraft:oak_log"));
  q.push(fillLocal(c, 0, 6, 10, 10, 6, 10, "minecraft:oak_log"));
  q.push(fillLocal(c, 5, 6, 5, 5, 6, 14, "minecraft:oak_log"));
  q.push(fillLocal(c, 0, 7, 5, 10, 7, 14, "minecraft:oak_planks"));
  q.push(fillLocal(c, 1, 8, 6, 9, 11, 6, "minecraft:oak_planks"));
  q.push(fillLocal(c, 1, 8, 13, 9, 11, 13, "minecraft:oak_planks"));
  q.push(fillLocal(c, 1, 8, 6, 1, 11, 13, "minecraft:oak_planks"));
  q.push(fillLocal(c, 9, 8, 6, 9, 11, 13, "minecraft:oak_planks"));
  q.push(fillLocal(c, 2, 8, 7, 8, 11, 12, "minecraft:air"));
  q.push(fillLocal(c, 5, 8, 6, 5, 9, 6, "minecraft:air"));
  q.push(fillLocal(c, 1, 9, 8, 1, 9, 11, "minecraft:glass"), fillLocal(c, 9, 9, 8, 9, 9, 11, "minecraft:glass"));
  q.push(fillLocal(c, 4, 9, 13, 6, 9, 13, "minecraft:glass"));
  q.push(fillLocal(c, 0, 12, 5, 10, 12, 14, "minecraft:dark_oak_planks"));
  q.push(fillLocal(c, 1, 13, 6, 9, 13, 13, "minecraft:oak_leaves"));
  q.push(fillLocal(c, 2, 14, 7, 8, 14, 12, "minecraft:oak_leaves"));
  for (let step = 0; step <= 7; step++) {
    q.push(fillLocal(c, 4, 0, step, 6, step, step, "minecraft:oak_planks"));
    q.push(fillLocal(c, 4, step + 1, step, 6, step + 2, step, "minecraft:air"));
  }
  q.push(setLocal(c, 3, 8, 11, "minecraft:crafting_table"), setLocal(c, 7, 8, 11, "minecraft:chest"));
  q.push(setLocal(c, 5, 11, 10, "minecraft:sea_lantern"));
  return makePlan(player, "Tree House", c, q, localBounds(c, 0, 0, 0, 10, 14, 14));
}

function createBunkerPlan(player) {
  const c = createOrientedBuildContext(player, 11, 13, -1);
  const q = [];
  pushShellCommands(q, c, 0, -6, 5, 10, 0, 12, "minecraft:deepslate_bricks");
  q.push(fillLocal(c, 1, -5, 6, 9, -1, 11, "minecraft:air"));
  q.push(fillLocal(c, 0, 0, 5, 10, 0, 12, "minecraft:grass_block"));
  q.push(fillLocal(c, 1, -5, 9, 9, -1, 9, "minecraft:polished_deepslate"));
  q.push(fillLocal(c, 4, -5, 9, 6, -3, 9, "minecraft:air"));
  q.push(fillLocal(c, 4, -5, 5, 6, -1, 5, "minecraft:air"));
  for (let step = 0; step <= 6; step++) {
    const y = -step;
    q.push(fillLocal(c, 4, -6, step, 6, y, step, "minecraft:stone_bricks"));
    q.push(fillLocal(c, 4, y + 1, step, 6, y + 2, step, "minecraft:air"));
  }
  q.push(setLocal(c, 2, -5, 10, "minecraft:crafting_table"), setLocal(c, 3, -5, 10, "minecraft:furnace"));
  q.push(setLocal(c, 8, -5, 10, "minecraft:chest"));
  for (const [x, z] of [[3, 7], [7, 7], [3, 11], [7, 11]]) q.push(setLocal(c, x, -1, z, "minecraft:sea_lantern"));
  return makePlan(player, "Underground Bunker", c, q, localBounds(c, 0, -6, 0, 10, 2, 12));
}

function openBridgeAndStairMenu(player) {
  const form = new ActionFormData()
    .title("🌉 Bridge & Stair Builder")
    .body("Build safely in the direction you are facing:")
    .button("🌉 Build a Bridge\n§7Flat walkway with optional railings")
    .button("📈 Build Stairs Up\n§7Ascending block staircase")
    .button("📉 Build Stairs Down\n§7Descending staircase with headroom")
    .button("⬅️ Back\n§7Return to Builder Tools");
  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === 0) openBridgeBuilderMenu(player);
    else if (response.selection === 1) openStairBuilderMenu(player, "up");
    else if (response.selection === 2) openStairBuilderMenu(player, "down");
    else if (response.selection === 3) openBuilderToolsMenu(player);
  }).catch((e) => console.error("Bridge and stair menu error: " + e));
}

function openBridgeBuilderMenu(player) {
  const materials = [
    { name: "Oak Planks", id: "minecraft:oak_planks" },
    { name: "Stone Bricks", id: "minecraft:stone_bricks" },
    { name: "Cobblestone", id: "minecraft:cobblestone" },
    { name: "Glass", id: "minecraft:glass" },
    { name: "Nether Bricks", id: "minecraft:nether_brick" },
    { name: "Deepslate Bricks", id: "minecraft:deepslate_bricks" }
  ];
  const railings = [
    { name: "Oak Fence", id: "minecraft:oak_fence" },
    { name: "Cobblestone Wall", id: "minecraft:cobblestone_wall" },
    { name: "Iron Bars", id: "minecraft:iron_bars" },
    { name: "Glass", id: "minecraft:glass" }
  ];
  const form = new ModalFormData()
    .title("🌉 Build a Bridge")
    .dropdown("Bridge Material:", materials.map((v) => v.name), { defaultValueIndex: 0 })
    .slider("Width:", 3, 9, { valueStep: 2, defaultValue: 3 })
    .slider("Length:", 3, 50, { valueStep: 1, defaultValue: 12 })
    .toggle("Add Safety Railings", { defaultValue: true })
    .dropdown("Railing Material:", railings.map((v) => v.name), { defaultValueIndex: 0 })
    .toggle("✨ Show 3D Preview First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [materialIndex, width, length, addRailings, railingIndex, showGuide] = response.formValues;
    const plan = createBridgePlan(player, Math.round(width), Math.round(length), materials[materialIndex].id, addRailings, railings[railingIndex].id);
    if (!validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => executeBuildPlan(player, plan, "bridge", `🌉 ${plan.width}×${plan.length} bridge completed!`, "dig.wood");
    if (showGuide) startPreview(player, plan.bounds, "minecraft:villager_happy", `Build this ${plan.width}×${plan.length} bridge?`, confirm);
    else confirm();
  }).catch((e) => console.error("Bridge builder menu error: " + e));
}

function createBridgePlan(player, width, length, material, addRailings, railingMaterial) {
  const c = createOrientedBuildContext(player, width, length, -1);
  const q = [fillLocal(c, 0, 0, 0, width - 1, 0, length - 1, material)];
  if (addRailings) {
    q.push(fillLocal(c, 0, 1, 0, 0, 1, length - 1, railingMaterial));
    q.push(fillLocal(c, width - 1, 1, 0, width - 1, 1, length - 1, railingMaterial));
  }
  return {
    name: "bridge", dimensionId: player.dimension.id, width, length, commands: q,
    bounds: localBounds(c, 0, 0, 0, width - 1, addRailings ? 1 : 0, length - 1)
  };
}

function openStairBuilderMenu(player, direction) {
  const materials = [
    { name: "Oak Planks", id: "minecraft:oak_planks" },
    { name: "Stone Bricks", id: "minecraft:stone_bricks" },
    { name: "Cobblestone", id: "minecraft:cobblestone" },
    { name: "Deepslate Bricks", id: "minecraft:deepslate_bricks" },
    { name: "Nether Bricks", id: "minecraft:nether_brick" }
  ];
  const label = direction === "up" ? "Up" : "Down";
  const form = new ModalFormData()
    .title(`🪜 Build Stairs ${label}`)
    .dropdown("Stair Material:", materials.map((v) => v.name), { defaultValueIndex: 0 })
    .slider("Width:", 1, 5, { valueStep: 2, defaultValue: 3 })
    .slider("Number of Steps:", 3, 25, { valueStep: 1, defaultValue: 8 })
    .toggle("Clear Two Blocks of Headroom", { defaultValue: true })
    .toggle("✨ Show 3D Preview First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [materialIndex, width, steps, clearHeadroom, showGuide] = response.formValues;
    const plan = createStairPlan(player, Math.round(width), Math.round(steps), materials[materialIndex].id, direction, clearHeadroom);
    if (!validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => executeBuildPlan(player, plan, "stairs", `🪜 ${plan.steps}-step staircase built ${label.toLowerCase()}!`);
    if (showGuide) startPreview(player, plan.bounds, "minecraft:villager_happy", `Build these ${plan.steps} steps ${label.toLowerCase()}?`, confirm);
    else confirm();
  }).catch((e) => console.error("Stair builder menu error: " + e));
}

function createStairPlan(player, width, steps, material, direction, clearHeadroom) {
  const c = createOrientedBuildContext(player, width, steps, -1);
  const q = [];
  const stepDirection = direction === "down" ? -1 : 1;
  for (let step = 0; step < steps; step++) {
    const y = step * stepDirection;
    q.push(fillLocal(c, 0, y, step, width - 1, y, step, material));
    if (clearHeadroom) q.push(fillLocal(c, 0, y + 1, step, width - 1, y + 2, step, "minecraft:air"));
  }
  const endY = (steps - 1) * stepDirection;
  return {
    name: "staircase", dimensionId: player.dimension.id, steps, commands: q,
    bounds: localBounds(c, 0, Math.min(0, endY), 0, width - 1, Math.max(0, endY) + (clearHeadroom ? 2 : 0), steps - 1)
  };
}

function openAreaCleanupMenu(player) {
  const form = new ModalFormData()
    .title("🧹 Area Cleanup")
    .slider("Cleanup Radius:", 10, 100, { valueStep: 5, defaultValue: 30 })
    .toggle("Remove Dropped Items", { defaultValue: true })
    .toggle("Remove XP Orbs", { defaultValue: true })
    .toggle("Remove Arrows & Projectiles", { defaultValue: true })
    .toggle("Remove Boats & Minecarts", { defaultValue: false })
    .toggle("Remove Hostile Monsters", { defaultValue: false });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [radius, items, xp, projectiles, vehicles, hostiles] = response.formValues;
    const options = { items, xp, projectiles, vehicles, hostiles };
    if (!items && !xp && !projectiles && !vehicles && !hostiles) {
      player.sendMessage("§eChoose at least one cleanup category.§r");
      return;
    }
    confirmAreaCleanup(player, Math.round(radius), options);
  }).catch((e) => console.error("Area cleanup menu error: " + e));
}

function getCleanupCategory(typeId, options) {
  if (options.items && typeId === "minecraft:item") return "dropped items";
  if (options.xp && typeId === "minecraft:xp_orb") return "XP orbs";
  if (options.projectiles && CLEANUP_PROJECTILES.has(typeId)) return "projectiles";
  if (options.vehicles && CLEANUP_VEHICLES.has(typeId)) return "vehicles";
  if (options.hostiles && HOSTILE_MOBS.has(typeId)) return "hostile monsters";
  return null;
}

function findCleanupTargets(player, radius, options) {
  const targets = [];
  const counts = new Map();
  const entities = player.dimension.getEntities({ location: player.location, maxDistance: radius });
  for (const entity of entities) {
    const category = getCleanupCategory(entity.typeId, options);
    if (!category) continue;
    if (entity.typeId === "minecraft:item") {
      try {
        const item = entity.getComponent("item");
        if (item && item.itemStack && item.itemStack.typeId === ITEM_ID) continue;
      } catch (e) {}
    }
    targets.push(entity);
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return { targets, counts };
}

function confirmAreaCleanup(player, radius, options) {
  try {
    const preview = findCleanupTargets(player, radius, options);
    const summary = preview.counts.size
      ? Array.from(preview.counts.entries()).map(([category, count]) => `• ${category}: ${count}`).join("\n")
      : "Nothing matching your choices was found.";
    const warning = options.vehicles
      ? "\n\n§cWarning: selected vehicles and anything stored inside them will be removed.§r"
      : "";
    const form = new MessageFormData()
      .title("🧹 Confirm Area Cleanup")
      .body(`Within ${radius} blocks:\n\n${summary}${warning}`)
      .button1("✅ Clean Up")
      .button2("❌ Cancel");
    form.show(player).then((response) => {
      if (!response.canceled && response.selection === 0) executeAreaCleanup(player, radius, options);
    }).catch((e) => console.error("Cleanup confirmation error: " + e));
  } catch (err) {
    player.sendMessage(`§cCould not scan this area: ${err}§r`);
  }
}

function executeAreaCleanup(player, radius, options) {
  try {
    const cleanup = findCleanupTargets(player, radius, options);
    let removed = 0;
    for (const entity of cleanup.targets) {
      try { entity.remove(); removed++; } catch (e) {}
    }
    player.sendMessage(`§a🧹 Area cleaned! Removed ${removed} selected objects within ${radius} blocks.§r`);
    player.playSound("random.pop", { volume: 0.9, pitch: 1.3 });
  } catch (err) {
    player.sendMessage(`§cArea cleanup failed: ${err}§r`);
  }
}

async function lightUpArea(player) {
  try {
    const loc = player.location;
    const px = Math.floor(loc.x);
    const py = Math.floor(loc.y);
    const pz = Math.floor(loc.z);
    const dim = player.dimension;

    let torchCount = 0;
    for (let dx = -12; dx <= 12; dx += 6) {
      for (let dz = -12; dz <= 12; dz += 6) {
        const tx = px + dx;
        const tz = pz + dz;
        for (let ty = py + 3; ty >= py - 3; ty--) {
          try {
            const block = dim.getBlock({ x: tx, y: ty, z: tz });
            const below = dim.getBlock({ x: tx, y: ty - 1, z: tz });
            if (block && block.isAir && below && !below.isAir && !LIQUID_BLOCKS.has(below.typeId)) {
              await runCommand(dim, `setblock ${tx} ${ty} ${tz} minecraft:torch`);
              torchCount++;
              break;
            }
          } catch (e) {}
        }
      }
    }
    player.sendMessage(`§e💡 Lit up the area with ${torchCount} torches! Monsters won't spawn here!§r`);
    player.playSound("random.orb", { volume: 0.8, pitch: 1.3 });
  } catch (err) {
    player.sendMessage(`§cError lighting area: ${err}§r`);
  }
}

function executeUndoUnlocked(player) {
  const lastAction = undoHistory.get(player.id);
  if (!lastAction || !lastAction.structureName || !lastAction.bounds || !lastAction.dimensionId) {
    player.sendMessage("§e[Helper Tools] Nothing to undo!§r");
    return;
  }

  const undoDimension = getDimensionById(lastAction.dimensionId);
  const loadCmd = `structure load ${lastAction.structureName} ${lastAction.bounds.x1} ${lastAction.bounds.y1} ${lastAction.bounds.z1}`;
  return runCommand(undoDimension, loadCmd).then(async () => {
    undoHistory.delete(player.id);
    await runCommand(undoDimension, `structure delete ${lastAction.structureName}`).catch(() => {});
    player.sendMessage("§a↩️ Undid your last build action!§r");
    player.playSound("random.pop", { volume: 1.0, pitch: 1.0 });
  }).catch((err) => {
    player.sendMessage(`§cError undoing action: ${err}§r`);
  });
}

// ==========================================
// 5. 📍 SPAWN & FAST TRAVEL MENU (WITH ICONS)
// ==========================================

function openSpawnAndTeleportMenu(player) {
  const form = new ActionFormData()
    .title("📍 Spawn & Teleport")
    .body("Fast travel options:")
    .button("📍 Set Spawn Point Here\n§7Save your current spot", "textures/items/bed_red")
    .button("🚀 Teleport to Spawn Point\n§7Warp home to your saved spawn", "textures/items/ender_pearl")
    .button("👥 Teleport to Another Player\n§7Warp directly to Dad, Mom, or friends", "textures/items/name_tag")
    .button("🌎 Find Nearest Biome\n§7Find a biome and teleport straight there", "textures/items/compass_item")
    .button("🏰 Find Nearest Structure\n§7Get the command that finds a structure", "textures/items/map_filled")
    .button("🧭 Teleport to Coordinates\n§7Type in X, Y and Z and warp there", "textures/items/paper")
    .button("⬅️ Back to Main Menu\n§7Return to categories", "textures/ui/arrow_left");

  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        setSpawnPoint(player);
        break;
      case 1:
        teleportToSpawn(player);
        break;
      case 2:
        openTeleportPlayerMenu(player);
        break;
      case 3:
        openBiomeFinderMenu(player);
        break;
      case 4:
        openStructureFinderMenu(player);
        break;
      case 5:
        openTeleportToCoordinatesForm(player);
        break;
      case 6:
        openMainMenu(player);
        break;
    }
  }).catch((e) => console.error("Spawn menu error: " + e));
}

function setSpawnPoint(player) {
  const loc = player.location;
  const x = Math.floor(loc.x);
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z);
  const dimId = player.dimension.id;

  const saveTravelPoint = () => {
    player.setDynamicProperty("saved_spawn_x", x);
    player.setDynamicProperty("saved_spawn_y", y);
    player.setDynamicProperty("saved_spawn_z", z);
    player.setDynamicProperty("saved_spawn_dim", dimId);

    player.sendMessage(`§a📍 Travel point saved at (${x}, ${y}, ${z}) in this dimension!§r`);
    player.playSound("random.levelup", { volume: 0.9, pitch: 1.3 });
  };

  // Bed spawn points are restricted by dimension, but Helper Tools travel
  // points should work everywhere.
  if (String(dimId).replace(/^minecraft:/, "") === "overworld") {
    runCommand(player, `spawnpoint @s ${x} ${y} ${z}`).then(saveTravelPoint).catch(() => saveTravelPoint());
  } else {
    saveTravelPoint();
  }
}

function teleportToSpawn(player) {
  try {
    const sx = player.getDynamicProperty("saved_spawn_x");
    const sy = player.getDynamicProperty("saved_spawn_y");
    const sz = player.getDynamicProperty("saved_spawn_z");
    const sDim = player.getDynamicProperty("saved_spawn_dim");

    if (sx !== undefined && sy !== undefined && sz !== undefined) {
      const targetDim = sDim ? getDimensionById(sDim) : player.dimension;
      player.teleport({ x: sx + 0.5, y: sy, z: sz + 0.5 }, { dimension: targetDim });
      player.sendMessage(`§b🚀 Teleported to your saved travel point (${sx}, ${sy}, ${sz})!§r`);
      player.playSound("mob.endermen.portal", { volume: 0.9, pitch: 1.0 });
      return;
    }

    const spawnLoc = player.getSpawnPoint();
    if (spawnLoc) {
      const bedY = resolveStandableY(spawnLoc.dimension, spawnLoc);
      if (bedY !== null) {
        player.teleport({ x: Math.floor(spawnLoc.x) + 0.5, y: bedY, z: Math.floor(spawnLoc.z) + 0.5 }, { dimension: spawnLoc.dimension });
        player.sendMessage(`§b🚀 Teleported to spawn point (${Math.floor(spawnLoc.x)}, ${bedY}, ${Math.floor(spawnLoc.z)})!§r`);
        player.playSound("mob.endermen.portal", { volume: 0.9, pitch: 1.0 });
        return;
      }
    }

    const defSpawn = world.getDefaultSpawnLocation();
    const overworld = world.getDimension("overworld");
    const spawnY = resolveStandableY(overworld, defSpawn);
    if (spawnY === null) {
      player.sendMessage("§eCould not work out a safe height for the world spawn. Use 📍 Set Spawn Point Here to save your own travel point.§r");
      return;
    }
    player.teleport({ x: Math.floor(defSpawn.x) + 0.5, y: spawnY, z: Math.floor(defSpawn.z) + 0.5 }, { dimension: overworld });
    player.sendMessage(`§b🚀 Teleported to world spawn (${Math.floor(defSpawn.x)}, ${spawnY}, ${Math.floor(defSpawn.z)})!§r`);
    player.playSound("mob.endermen.portal", { volume: 0.9, pitch: 1.0 });
  } catch (err) {
    player.sendMessage(`§cCould not teleport to spawn: ${err}§r`);
  }
}

function openTeleportPlayerMenu(player) {
  const otherPlayers = world.getAllPlayers().filter(p => p.id !== player.id);

  if (otherPlayers.length === 0) {
    player.sendMessage("§e[Helper Tools] No other players are currently online in this world!§r");
    return;
  }

  const form = new ActionFormData()
    .title("👥 Teleport to Player")
    .body("Choose a player to warp to:");

  for (const p of otherPlayers) {
    form.button(`👤 ${p.name}\n§7Teleport to ${p.name}`, "textures/items/name_tag");
  }
  form.button("⬅️ Back\n§7Return to menu", "textures/ui/arrow_left");

  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === otherPlayers.length) {
      openSpawnAndTeleportMenu(player);
      return;
    }
    const targetPlayer = otherPlayers[response.selection];
    if (isValidEntity(targetPlayer)) {
      player.teleport(targetPlayer.location, { dimension: targetPlayer.dimension });
      player.sendMessage(`§b🚀 Teleported to ${targetPlayer.name}!§r`);
      player.playSound("mob.endermen.portal", { volume: 0.9, pitch: 1.0 });
    }
  }).catch((e) => console.error("Teleport player menu error: " + e));
}

function getCurrentDimensionName(player) {
  return String(player.dimension.id).replace(/^minecraft:/, "");
}

/**
 * Biomes are looked up from the world seed with
 * `Dimension.calculateClosestBiomeFromSeed` and the result window can teleport
 * the player straight there, so nobody has to retype coordinates.
 *
 * Structures are different: the stable Script API has no structure search and
 * `CommandResult` only carries `successCount`, so a scripted `/locate` gives the
 * script nothing to read. The player is given the `/locate` command for chat and
 * Minecraft prints the coordinates, which then go into 🧭 Teleport to
 * Coordinates (or `/scriptevent tools:goto`).
 */
const WORLD_EDGE = 29999900;

// Tried in order when the exact column has no room to stand.
const ARRIVAL_OFFSETS = [
  { x: 0, z: 0 },
  { x: 3, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 3 }, { x: 0, z: -3 },
  { x: 6, z: 6 }, { x: -6, z: 6 }, { x: 6, z: -6 }, { x: -6, z: -6 }
];

const LAVA_BLOCKS = new Set(["minecraft:lava", "minecraft:flowing_lava"]);

// Chunk radius of the temporary ticking area, and how long to let it load.
const TRAVEL_AREA_RADIUS = 2;
const TRAVEL_LOAD_TICKS = 40;

// The Nether's bedrock roof starts at Y 124, so surface searches begin below it.
const NETHER_CEILING_SCAN_Y = 120;

/**
 * Horizontal search box sizes (blocks) tried in order, each in its own tick.
 * `calculateClosestBiomeFromSeed` is expensive and its default search volume is
 * undocumented, so the box is always passed explicitly and grows until a biome
 * turns up. The vertical size always covers the whole dimension so cave biomes
 * are found no matter where the player is standing.
 */
const BIOME_SEARCH_SIZES = [1024, 4096, 8192];

function openBiomeFinderMenu(player) {
  openFinderSelectionMenu(player, BIOME_OPTIONS, "🌎 Nearest Biome",
    "Pick a biome. Helper Tools finds the nearest one and can teleport you straight there.", showNearestBiome);
}

function openStructureFinderMenu(player) {
  openFinderSelectionMenu(player, STRUCTURE_OPTIONS, "🏰 Nearest Structure",
    "Pick a structure. Helper Tools gives you the command that makes Minecraft show its coordinates in chat.",
    showStructureLocateCommand);
}

function openFinderSelectionMenu(player, allOptions, title, body, onSelect) {
  const options = allOptions.filter((option) => option.dimensions.includes(getCurrentDimensionName(player)));
  const form = new ActionFormData().title(title).body(body);
  for (const option of options) form.button(`${option.name}\n§7${option.id.replace("minecraft:", "")}`);
  form.button("⬅️ Back\n§7Return to Spawn & Teleport");
  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === options.length) return openSpawnAndTeleportMenu(player);
    const option = options[response.selection];
    if (option) return onSelect(player, option);
  }).catch((e) => console.error(`${title} menu error: ${e}`));
}

/**
 * `BiomeTypes.get` wants the namespaced identifier. A `BiomeType` is passed to
 * the search when the catalogue knows the biome; otherwise the raw identifier
 * is tried, which the API also accepts.
 */
function resolveBiomeType(biomeId) {
  try {
    if (typeof BiomeTypes !== "undefined" && BiomeTypes && typeof BiomeTypes.get === "function") {
      const biomeType = BiomeTypes.get(biomeId);
      if (biomeType) return biomeType;
    }
  } catch (e) {
    // Fall through to the string identifier.
  }
  return biomeId;
}

function getBiomeSearchOrigin(player) {
  const range = getBuildRangeForDimension(player.dimension.id);
  return { x: player.location.x, y: (range.min + range.max) / 2, z: player.location.z };
}

function getBiomeSearchOptions(dimensionId, horizontalSize) {
  const range = getBuildRangeForDimension(dimensionId);
  return { boundingSize: { x: horizontalSize, y: range.max - range.min + 2, z: horizontalSize } };
}

function nextTick() {
  return new Promise((resolve) => system.run(resolve));
}

/**
 * Resolves to `{ x, y, z, distance }` of the nearest biome, or null when none
 * exists within the largest search box. Each search size runs in its own tick
 * so one slow lookup cannot stall the game for long. Throws if the API itself
 * fails, so the caller can show the reason.
 */
async function findNearestBiome(player, biomeId) {
  const dimension = player.dimension;
  const origin = getBiomeSearchOrigin(player);
  const biome = resolveBiomeType(biomeId);
  for (let i = 0; i < BIOME_SEARCH_SIZES.length; i++) {
    if (i > 0) await nextTick();
    if (!isValidEntity(player)) return null;
    const found = dimension.calculateClosestBiomeFromSeed(origin, biome, getBiomeSearchOptions(dimension.id, BIOME_SEARCH_SIZES[i]));
    if (found && Number.isFinite(found.x) && Number.isFinite(found.z)) {
      const x = Math.floor(found.x);
      const z = Math.floor(found.z);
      const y = Number.isFinite(found.y) ? Math.floor(found.y) : undefined;
      return { x, y, z, distance: Math.round(Math.hypot(x - origin.x, z - origin.z)) };
    }
  }
  return null;
}

/**
 * Surface biomes land on the surface. Underground biomes pass the height the
 * search reported so the landing is looked for around it first.
 */
function biomeDestination(option, result) {
  const destination = { x: result.x, z: result.z };
  if (option.underground && Number.isFinite(result.y)) destination.y = result.y;
  return destination;
}

async function showNearestBiome(player, option) {
  player.sendMessage(`§e🔎 Searching for the nearest ${option.name}...§r`);
  let result;
  try {
    result = await findNearestBiome(player, option.id);
  } catch (err) {
    if (isValidEntity(player)) player.sendMessage(`§cCould not search for ${option.name}: ${err}§r`);
    return;
  }
  if (!isValidEntity(player)) return;
  if (!result) {
    player.sendMessage(`§eNo ${option.name} could be found within ${BIOME_SEARCH_SIZES[BIOME_SEARCH_SIZES.length - 1]} blocks of here.§r`);
    return;
  }

  player.setDynamicProperty("last_found_location", `${option.name}: X ${result.x}, Z ${result.z}`);
  player.sendMessage(`§b🌎 Nearest ${option.name}: §fX ${result.x}, Z ${result.z}§b (about ${result.distance} blocks away)§r`);
  player.playSound("random.orb", { volume: 0.8, pitch: 1.4 });

  const undergroundNote = option.underground ? "\n\nThis biome is underground, so Helper Tools will try to land you inside it." : "";
  new ActionFormData()
    .title(`🌎 ${option.name}`)
    .body(`The nearest ${option.name} is at:\n\n§lX ${result.x}    Z ${result.z}§r\n\nAbout ${result.distance} blocks away. The coordinates are in chat too.${undergroundNote}`)
    .button("🚀 Teleport There Now\n§7Go straight to this biome", "textures/items/ender_pearl")
    .button("🌎 Find Another Biome\n§7Back to the biome list", "textures/items/compass_item")
    .button("✅ Done\n§7Keep the coordinates for later")
    .show(player).then((response) => {
      if (response.canceled) return;
      if (response.selection === 0) return teleportToCoordinates(player, biomeDestination(option, result));
      if (response.selection === 1) openBiomeFinderMenu(player);
    }).catch((e) => console.error("Biome result error: " + e));
}

/**
 * No form is opened here on purpose: chat is unusable while a form is on
 * screen, and the player needs chat to run the command.
 *
 * `/locate` is also run through the script as the player. Command output from
 * scripts is not returned to the script, so Helper Tools cannot read the
 * coordinates, but a failure (no such structure in range) does come back as an
 * error worth showing. Typing `/locate` in chat needs Cheats on and operator
 * rights, which the script path does not.
 */
function showStructureLocateCommand(player, option) {
  const command = `locate structure ${option.id}`;
  player.setDynamicProperty("last_found_location", `${option.name}: type the numbers from /${command}`);
  player.sendMessage(`§b§l🏰 Where is the nearest ${option.name}?§r`);
  player.sendMessage(`§eSend this in chat: §a/${command}§r`);
  player.sendMessage("§7Minecraft replies with its coordinates, like §fThe nearest ... is at block 1256, (y?), -648§r");
  player.sendMessage("§7Then open the Helper Device, choose §f🧭 Teleport to Coordinates§7 and type the X and Z numbers in. Or send §f/scriptevent tools:goto 1256 -648§7 in chat.§r");
  player.sendMessage("§7If Minecraft says you do not have permission, turn on Cheats in the world settings first.§r");
  player.playSound("random.orb", { volume: 0.8, pitch: 1.4 });
  runCommand(player, command).catch((err) => {
    if (isValidEntity(player)) player.sendMessage(`§eMinecraft could not find a ${option.name} from here: ${err}§r`);
  });
}

/**
 * Two numbers are X and Z (the shape `/locate` reports, where the height comes
 * back as "(y?)"); three are X, Y and Z.
 */
function coordinatesFromNumbers(values) {
  if (!values.every(Number.isFinite)) return null;
  if (values.length === 2) return { x: values[0], z: values[1] };
  if (values.length === 3) return { x: values[0], y: values[1], z: values[2] };
  return null;
}

// Parse the coordinate tuple before any trailing distance in a /locate reply.
function parseTeleportCoordinates(text) {
  const input = String(text ?? "").trim();
  if (/^[\d+.,\s-]+$/.test(input)) {
    const tokens = input.split(/[\s,]+/);
    if (!tokens.every((token) => /^[+-]?\d+(?:\.\d+)?$/.test(token))) return null;
    return coordinatesFromNumbers(tokens.map(Number));
  }
  const tuple = input.match(/(-?\d+(?:\.\d+)?)\s*,\s*(?:\(\s*y\s*\?\s*\)|~|\?|(-?\d+(?:\.\d+)?))\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (tuple) {
    const result = { x: Number(tuple[1]), z: Number(tuple[3]) };
    if (tuple[2] !== undefined) result.y = Number(tuple[2]);
    return [result.x, result.z, ...(result.y === undefined ? [] : [result.y])].every(Number.isFinite) ? result : null;
  }
  return null;
}

/**
 * Reads the X, Y and Z boxes. A whole `/locate` reply pasted into the X box is
 * picked apart too. A blank Y box or the literal "(y?)" from `/locate`
 * means "put me on the surface"; other nonnumeric values are rejected.
 */
function coordinatesFromFormText(xText, yText, zText) {
  const x = String(xText ?? "").trim();
  const y = String(yText ?? "").trim();
  const z = String(zText ?? "").trim();
  const numberPattern = /^[+-]?\d+(?:\.\d+)?$/;
  // A pasted tuple/reply belongs in X alone; do not silently ignore Y or Z.
  if (!numberPattern.test(x)) {
    return !y && !z ? parseTeleportCoordinates(x) : null;
  }
  if (!numberPattern.test(z)) return null;
  const coordinates = { x: Number(x), z: Number(z) };
  if (y && !/^(?:\(\s*y\s*\?\s*\)|~|\?)$/i.test(y)) {
    if (!numberPattern.test(y)) return null;
    coordinates.y = Number(y);
  }
  if (!Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.z) ||
      (coordinates.y !== undefined && !Number.isFinite(coordinates.y))) return null;
  return coordinates;
}

function openTeleportToCoordinatesForm(player) {
  const lastFound = player.getDynamicProperty("last_found_location");
  const reminder = typeof lastFound === "string" && lastFound.length > 0 ? `§7Last search - ${lastFound}§r\n\n` : "";
  const form = new ModalFormData()
    .title("🧭 Teleport to Coordinates")
    .textField(`${reminder}X`, "Example: 1256")
    .textField("Y (optional)", "Leave empty to land on the surface")
    .textField("Z", "Example: -648")
    .submitButton("🚀 Teleport");

  form.show(player).then((response) => {
    if (response.canceled) return;
    const values = response.formValues || [];
    const text = (index) => String(values[index] === undefined ? "" : values[index]).trim();
    const coordinates = coordinatesFromFormText(text(0), text(1), text(2));
    if (!coordinates) {
      player.sendMessage("§cEnter valid numbers for X and Z, and a number or an empty box for Y. Paste a locate reply into X with Y and Z empty.§r");
      system.runTimeout(() => openTeleportToCoordinatesForm(player), 10);
      return;
    }
    teleportToCoordinates(player, coordinates);
  }).catch((e) => console.error("Teleport to coordinates form error: " + e));
}

function handleTeleportScriptEvent(player, message) {
  const coordinates = parseTeleportCoordinates(message);
  if (!coordinates) {
    player.sendMessage("§cUse §f/scriptevent tools:goto <X> <Z>§c or §f<X> <Y> <Z>§c, for example §f/scriptevent tools:goto 1256 -648§r");
    return;
  }
  teleportToCoordinates(player, coordinates);
}

function getTravelAreaName(player) {
  return `ht_travel_${String(player.id).replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function removeTravelArea(dimension, areaName) {
  return runCommand(dimension, `tickingarea remove ${areaName}`).then(() => {}, () => {});
}

/**
 * Loads the destination first so the landing spot can be worked out before the
 * player moves. `getBlock` throws on unloaded chunks, which is exactly what a
 * far-away destination is, so a temporary ticking area does the loading.
 */
async function teleportToCoordinates(player, coordinates) {
  const id = player.id;
  if (activeTravels.has(id)) {
    player.sendMessage("§ePlease wait for your current trip to finish.§r");
    return;
  }
  if (!Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.z)) {
    player.sendMessage("§cPlease enter finite X and Z coordinates.§r");
    return;
  }
  activeTravels.add(id);
  const dimension = player.dimension;
  const range = getBuildRangeForDimension(dimension.id);
  const x = clampNumber(Math.floor(coordinates.x), -WORLD_EDGE, WORLD_EDGE);
  const z = clampNumber(Math.floor(coordinates.z), -WORLD_EDGE, WORLD_EDGE);
  const requestedY = Number.isFinite(coordinates.y)
    ? clampNumber(Math.floor(coordinates.y), range.min + 1, range.max - 2) : null;
  const areaName = getTravelAreaName(player);
  let areaCreated = false;
  try {
    player.sendMessage(`§e🚀 Checking safe ground at X ${x}, Z ${z}. Hold on...§r`);
    let spot = findArrivalSpot(dimension, x, z, requestedY);
    if (!spot) {
      const areaY = requestedY ?? Math.floor((range.min + range.max) / 2);
      await runCommand(dimension, `tickingarea add circle ${x} ${areaY} ${z} ${TRAVEL_AREA_RADIUS} ${areaName} true`);
      areaCreated = true;
      for (let attempt = 0; attempt < 5 && !spot; attempt++) {
        await new Promise((resolve) => system.runTimeout(resolve, TRAVEL_LOAD_TICKS));
        if (!isValidEntity(player) || player.dimension.id !== dimension.id) return;
        spot = findArrivalSpot(dimension, x, z, requestedY);
      }
    }
    if (!isValidEntity(player) || player.dimension.id !== dimension.id) return;
    if (!spot) {
      player.sendMessage("§eNo safe landing was found. You stayed where you were; try nearby coordinates.§r");
      return;
    }
    player.addEffect("resistance", 200, { amplifier: 4, showParticles: false });
    player.addEffect("fire_resistance", 200, { amplifier: 0, showParticles: false });
    player.teleport({ x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5 }, { dimension });
    player.sendMessage(`§b🚀 Teleported! You are at ${spot.x}, ${spot.y}, ${spot.z}.§r`);
    player.playSound("mob.endermen.portal", { volume: 0.9, pitch: 1.0 });
  } catch (err) {
    if (isValidEntity(player)) player.sendMessage(`§cCould not complete travel: ${err}. No unchecked landing will be attempted.§r`);
  } finally {
    if (areaCreated) await removeTravelArea(dimension, areaName);
    activeTravels.delete(id);
  }
}

function findArrivalSpot(dimension, x, z, requestedY) {
  for (const offset of ARRIVAL_OFFSETS) {
    const spot = findStandableColumn(dimension, x + offset.x, z + offset.z, requestedY);
    if (spot) return spot;
  }
  // Solid rock all around the reported height: take the surface above it
  // rather than leaving the player buried.
  if (requestedY !== null) return findArrivalSpot(dimension, x, z, null);
  return null;
}

/**
 * Scans a column downwards for solid, non-lava footing with two air blocks
 * above it. Returns null when the chunk is not loaded yet or the column has
 * nowhere to stand.
 */
function findStandableColumn(dimension, x, z, requestedY) {
  const range = getBuildRangeForDimension(dimension.id);
  const isNether = String(dimension.id).replace(/^minecraft:/, "") === "nether";
  let startY;
  let lowestY;

  if (requestedY !== null) {
    // Underground destination: search around the reported height so the player
    // lands inside the structure instead of on the surface far above it.
    startY = Math.min(range.max - 2, requestedY + 4);
    lowestY = Math.max(range.min + 1, requestedY - 24);
  } else if (isNether) {
    startY = NETHER_CEILING_SCAN_Y;
    lowestY = range.min + 1;
  } else {
    try {
      if (typeof dimension.getTopmostBlock === "function") {
        const topmost = dimension.getTopmostBlock({ x: x, z: z });
        if (!topmost) return null;
        startY = Math.min(range.max - 1, topmost.location.y + 1);
      } else {
        startY = range.max - 1;
      }
    } catch (e) {
      return null;
    }
    lowestY = range.min + 1;
  }

  for (let y = startY; y >= lowestY; y--) {
    try {
      const floor = dimension.getBlock({ x: x, y: y - 1, z: z });
      const feet = dimension.getBlock({ x: x, y: y, z: z });
      const head = dimension.getBlock({ x: x, y: y + 1, z: z });
      if (!floor || !feet || !head) return null;
      if (!feet.isAir || !head.isAir) continue;
      // Water is fine to land on - the player just swims. Lava is not.
      if (floor.isAir || LAVA_BLOCKS.has(floor.typeId)) continue;
      return { x: x, y: y, z: z };
    } catch (e) {
      return null;
    }
  }
  return null;
}

// ==========================================
// 6. 🐾 PETS & COMPANIONS MENU (WITH ICONS)
// ==========================================

function openPetsMenu(player) {
  const form = new ActionFormData()
    .title("🐾 Pets & Companions")
    .body("Spawn a friendly companion:")
    .button("🐕 Tamed Dog (Wolf)\n§7Loyal bodyguard dog with collar", "textures/items/bone")
    .button("🐈 Tamed Cat\n§7Cute companion cat that scares creepers", "textures/items/fish_raw")
    .button("🦜 Tamed Parrot\n§7Colorful parrot that sits on shoulder", "textures/items/feather")
    .button("🐴 Tamed Horse with Saddle\n§7Ready to ride fast horse", "textures/items/saddle")
    .button("🦾 Iron Golem Guard\n§7Giant friendly defender", "textures/items/iron_ingot")
    .button("🦎 Axolotl Companion\n§7Cute swimming buddy", "textures/items/bucket_axolotl")
    .button("⬅️ Back to Main Menu\n§7Return to categories", "textures/ui/arrow_left");

  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        spawnPet(player, "wolf", "minecraft:on_tame", "🐕 Tamed Dog summoned! Right-click to make them sit or follow!");
        break;
      case 1:
        spawnPet(player, "cat", "minecraft:on_tame", "🐈 Tamed Cat summoned! Creepers will run away from you!");
        break;
      case 2:
        spawnPet(player, "parrot", "minecraft:on_tame", "🦜 Tamed Parrot summoned! Walk into it to place on your shoulder!");
        break;
      case 3:
        spawnHorseWithSaddle(player);
        break;
      case 4:
        spawnPet(player, "iron_golem", "minecraft:from_player", "🦾 Iron Golem Guard summoned! He will protect you from monsters!");
        break;
      case 5:
        spawnAxolotl(player);
        break;
      case 6:
        openMainMenu(player);
        break;
    }
  }).catch((e) => console.error("Pets menu error: " + e));
}

function spawnPet(player, mobType, spawnEvent, message) {
  try {
    const entity = player.dimension.spawnEntity(`minecraft:${mobType}`, getCompanionSpawnLocation(player));
    let tamed = false;
    const tameable = entity.getComponent("minecraft:tameable");
    if (tameable && typeof tameable.tame === "function") {
      try { tamed = tameable.tame(player) !== false; } catch (e) { tamed = false; }
    }
    if (!tamed && spawnEvent) {
      try { entity.triggerEvent(spawnEvent); } catch (e) {}
    }
    player.sendMessage(`§a${message}§r`);
    player.playSound("random.levelup", { volume: 0.9, pitch: 1.5 });
  } catch (err) {
    player.sendMessage(`§cError summoning pet: ${err}§r`);
  }
}

function spawnHorseWithSaddle(player) {
  try {
    const horse = player.dimension.spawnEntity("minecraft:horse", getCompanionSpawnLocation(player));
    const tameMount = horse.getComponent("minecraft:tamemount");
    if (tameMount && typeof tameMount.tameToPlayer === "function") tameMount.tameToPlayer(true, player);
    else if (tameMount && typeof tameMount.tame === "function") tameMount.tame(true);
    let saddled = true;
    try { horse.triggerEvent("minecraft:horse_saddled"); } catch (e) { saddled = false; }
    if (saddled) {
      player.sendMessage("§a🐴 Tamed Horse with Saddle summoned! Jump on and ride away!§r");
    } else {
      giveSaddleFallback(player);
      player.sendMessage("§a🐴 Tamed Horse summoned! A saddle was added to your inventory - put it on the horse to ride.§r");
    }
    player.playSound("random.levelup", { volume: 0.9, pitch: 1.4 });
  } catch (err) {
    player.sendMessage(`§cError summoning horse: ${err}§r`);
  }
}

function spawnAxolotl(player) {
  try {
    player.dimension.spawnEntity("minecraft:axolotl", getCompanionSpawnLocation(player));
    player.sendMessage("§a🦎 Cute Axolotl summoned! You can pick it up with a water bucket!§r");
    player.playSound("random.orb", { volume: 0.9, pitch: 1.6 });
  } catch (err) {
    player.sendMessage(`§cError summoning axolotl: ${err}§r`);
  }
}

function getCompanionSpawnLocation(player) {
  const direction = player.getViewDirection();
  return {
    x: player.location.x + direction.x * 2,
    y: player.location.y + 0.5,
    z: player.location.z + direction.z * 2
  };
}

function giveSaddleFallback(player) {
  try {
    const inventory = player.getComponent("inventory");
    const saddle = new ItemStack("minecraft:saddle", 1);
    const leftover = inventory && inventory.container ? inventory.container.addItem(saddle) : saddle;
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  } catch (e) {}
}
