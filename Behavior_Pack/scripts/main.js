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
    .button("🏡 House Designs\n§7Cottage, cabin, villa, tower and more in 7 styles", "textures/items/door_wood")
    .button("🏘️ Build a Modern Village\n§7Furnished houses, apartments, cafe, farms, well", "textures/blocks/concrete_white")
    .button("🔷 Shapes & Beacons\n§7Spheres, domes, pyramids, towers, cones, beacons", "textures/items/diamond")
    .button("🏊 Swimming Pool\n§7Tiled pool with deck, lights and diving board", "textures/items/bucket_water")
    .button("🌊 Drain Water & Lava\n§7Remove liquids around you (undoable)", "textures/items/bucket_empty")
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
        openHouseDesignsMenu(player);
        break;
      case 6:
        openVillageBuilderMenu(player);
        break;
      case 7:
        openShapeBuilderMenu(player);
        break;
      case 8:
        openPoolBuilderMenu(player);
        break;
      case 9:
        openDrainLiquidMenu(player);
        break;
      case 10:
        openBridgeAndStairMenu(player);
        break;
      case 11:
        lightUpArea(player);
        break;
      case 12:
        openAreaCleanupMenu(player);
        break;
      case 13:
        executeUndo(player);
        break;
      case 14:
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
  // Very large boxes (such as a whole village) are drawn with a wider particle spacing.
  const previewStep = Math.max(bounds.x2 - bounds.x1, bounds.z2 - bounds.z1) > 32 ? 2 : 1;
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
    drawBoxOutline(dimension, bounds, particleName, previewStep);
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

/** Two-block door at local (x, y, z) whose walk-through direction is local (dx, dz). */
function pushDoorCommands(commands, context, x, y, z, dx, dz, doorId) {
  const code = DOOR_DIRECTION_CODES[worldDirectionKey(context, dx, dz)];
  commands.push(setLocal(context, x, y, z, withBlockStates(doorId, { direction: code, door_hinge_bit: false, open_bit: false, upper_block_bit: false })));
  commands.push(setLocal(context, x, y + 1, z, withBlockStates(doorId, { direction: code, door_hinge_bit: false, open_bit: false, upper_block_bit: true })));
}

/** Smallest box that contains every block touched by the given fill/setblock commands. */
function boundsFromCommands(commands) {
  let bounds = null;
  for (const command of commands) {
    const c = parseBlockCommand(command);
    if (!c) throw new Error(`Cannot measure command: ${command}`);
    if (!bounds) bounds = { x1: c.x1, y1: c.y1, z1: c.z1, x2: c.x2, y2: c.y2, z2: c.z2 };
    else {
      bounds.x1 = Math.min(bounds.x1, c.x1); bounds.y1 = Math.min(bounds.y1, c.y1); bounds.z1 = Math.min(bounds.z1, c.z1);
      bounds.x2 = Math.max(bounds.x2, c.x2); bounds.y2 = Math.max(bounds.y2, c.y2); bounds.z2 = Math.max(bounds.z2, c.z2);
    }
  }
  return bounds;
}

/** Splits a world-coordinate fill into horizontal layers so no command exceeds the fill limit. */
function pushLargeWorldFill(commands, bounds, blockId, mode = "") {
  const area = (bounds.x2 - bounds.x1 + 1) * (bounds.z2 - bounds.z1 + 1);
  const layersPerCommand = Math.max(1, Math.floor(FILL_COMMAND_LIMIT / area));
  for (let y = bounds.y1; y <= bounds.y2; y += layersPerCommand) {
    const top = Math.min(y + layersPerCommand - 1, bounds.y2);
    commands.push(`fill ${bounds.x1} ${y} ${bounds.z1} ${bounds.x2} ${top} ${bounds.z2} ${blockId}${mode ? ` ${mode}` : ""}`);
  }
}

/**
 * Block chosen from the shared block list, or a typed block ID (with the
 * minecraft: namespace added when missing). Returns null when invalid.
 */
function resolveBlockChoice(listIndex, customText) {
  let blockId = (BLOCK_OPTIONS[listIndex] || BLOCK_OPTIONS[0]).id;
  if (customText && String(customText).trim().length > 0) {
    blockId = String(customText).trim().toLowerCase();
    if (!blockId.includes(":")) blockId = "minecraft:" + blockId;
  }
  return isValidBlockId(blockId) ? blockId : null;
}

// Block tokens may carry Bedrock block states, e.g. `minecraft:bed ["direction"=2]`.
const BLOCK_STATES_PATTERN = /^\[("[a-z0-9_:]+"=("[a-z0-9_]+"|-?\d+|true|false))(,"[a-z0-9_:]+"=("[a-z0-9_]+"|-?\d+|true|false))*\]$/;

function parseBlockStates(token) {
  if (!BLOCK_STATES_PATTERN.test(token)) return null;
  const states = {};
  for (const entry of token.slice(1, -1).split(",")) {
    const [key, rawValue] = entry.split("=");
    states[key.slice(1, -1)] = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
  }
  return states;
}

/**
 * Splits a fill/setblock command into its parts, or returns null when the
 * command is not a well-formed block command this pack can verify.
 */
function parseBlockCommand(command) {
  const parts = command.split(/\s+/);
  if (parts[0] !== "fill" && parts[0] !== "setblock") return null;
  const isFill = parts[0] === "fill";
  const coords = parts.slice(1, isFill ? 7 : 4).map(Number);
  if (!coords.every(Number.isInteger)) return null;
  const [x1, y1, z1] = coords;
  const [x2, y2, z2] = isFill ? coords.slice(3) : coords;
  if (x1 > x2 || y1 > y2 || z1 > z2) return null;
  let index = isFill ? 7 : 4;
  const blockId = parts[index++];
  if (!isValidBlockId(blockId)) return null;
  let states = null;
  if (index < parts.length && parts[index].startsWith("[")) {
    states = parseBlockStates(parts[index++]);
    if (!states) return null;
  }
  const mode = index < parts.length ? parts[index++] : "replace";
  if (!["replace", "hollow", "outline", "keep"].includes(mode)) return null;
  // `fill ... <block> replace <filterBlock> [states]` only touches blocks matching the filter.
  let filterId = null, filterStates = null;
  if (isFill && mode === "replace" && index < parts.length) {
    filterId = parts[index++];
    if (!isValidBlockId(filterId)) return null;
    if (index < parts.length && parts[index].startsWith("[")) {
      filterStates = parseBlockStates(parts[index++]);
      if (!filterStates) return null;
    }
  }
  if (index !== parts.length) return null;
  return { isFill, x1, y1, z1, x2, y2, z2, blockId, states, mode, filterId, filterStates };
}

function blockMatches(block, blockId, states) {
  if (!block || block.typeId !== blockId) return false;
  if (!states) return true;
  const permutation = block.permutation;
  if (!permutation || typeof permutation.getState !== "function") return false;
  return Object.entries(states).every(([key, value]) => String(permutation.getState(key)) === String(value));
}

// Commands can fail when their target blocks already have the requested type.
// Verify the actual result instead of matching localized error text or swallowing
// failures such as unloaded chunks, invalid block IDs, or height limits.
function blockCommandIsSatisfied(dimension, command) {
  const parsed = parseBlockCommand(command);
  if (!parsed) return false;
  const { x1, y1, z1, x2, y2, z2, blockId, states, mode, filterId, filterStates } = parsed;
  try {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
      const block = dimension.getBlock({ x, y, z });
      if (!block) return false;
      if (filterId) {
        // A filtered replace is satisfied once nothing matching the filter remains.
        if (blockMatches(block, filterId, filterStates)) return false;
        continue;
      }
      if (mode === "keep") {
        // `keep` only fills air, so the command is satisfied once no air remains.
        if (block.isAir || block.typeId === "minecraft:air") return false;
        continue;
      }
      const boundary = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
      if (!boundary && mode === "outline") continue;
      if (!boundary && mode === "hollow") {
        if (block.typeId !== "minecraft:air") return false;
        continue;
      }
      if (!blockMatches(block, blockId, states)) return false;
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

/**
 * Runs the commands in order. When `batchSize` is set, the build yields to the
 * next game tick after every batch so that large plans (such as a whole
 * village) are spread over several ticks instead of stalling one.
 */
async function runBuildCommands(dimension, commands, batchSize = 0, tolerateFailures = false) {
  let failures = 0;
  for (let i = 0; i < commands.length; i++) {
    if (batchSize > 0 && i > 0 && i % batchSize === 0) await nextTick();
    if (tolerateFailures) {
      // Filtered fills fail when nothing matched; that is the expected outcome for most boxes.
      try { await runCommand(dimension, commands[i]); } catch (e) { failures++; }
    } else {
      await runBlockCommand(dimension, commands[i]);
    }
  }
  return failures;
}

function executeBuildPlanUnlocked(player, plan, actionType, successMessage, sound = "dig.stone") {
  if (plan.dimensionId !== player.dimension.id) {
    player.sendMessage("§eYou changed dimensions after opening the preview. Open the builder again here.§r");
    return;
  }
  if (!validateBuildBounds(player, plan.bounds)) return;
  player.sendMessage(`§e🏗️ Building ${plan.name}...§r`);
  return captureUndoSnapshot(player, plan.bounds, actionType).then(async (record) => {
    await runBuildCommands(getDimensionById(record.dimensionId), plan.commands, plan.batchSize || 0, Boolean(plan.tolerateFailures));
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

const FILL_DIRECTIONS = [
  { name: "⬆️ Up from my feet (above ground)", key: "up", description: "upwards from your feet" },
  { name: "⬇️ Down into the ground (below my feet)", key: "down", description: "downwards from below your feet" }
];

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
    .dropdown("Build Direction:", FILL_DIRECTIONS.map((d) => d.name), { defaultValueIndex: 0 })
    .dropdown("Structure Style:", fillStyles, { defaultValueIndex: 0 })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });

  form.show(player).then((response) => {
    if (response.canceled) return;
    const [blockIndex, customBlock, width, height, length, directionIndex, styleIndex, showGuide] = response.formValues;

    const selectedBlock = resolveBlockChoice(blockIndex, customBlock);
    if (!selectedBlock) {
      player.sendMessage("§cInvalid block ID. Use a value such as minecraft:quartz_block.§r");
      return;
    }

    const w = Math.round(width), h = Math.round(height), l = Math.round(length);
    const style = styleIndex === 1 ? "hollow" : (styleIndex === 2 ? "outline" : "replace");
    const direction = FILL_DIRECTIONS[directionIndex] || FILL_DIRECTIONS[0];
    const bounds = calculateBounds(player, w, l, h, direction.key);

    if (showGuide) {
      startPreview(
        player,
        bounds,
        "minecraft:villager_happy",
        `Do you want to build a ${w}x${h}x${l} structure with ${selectedBlock}, ${direction.description}?`,
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

function createBaseTemplatePlan(player, templateKey, paletteIndex = 0) {
  if (HOUSE_DESIGNS.some((design) => design.key === templateKey)) return createHouseDesignPlan(player, templateKey, paletteIndex);
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
  pushDoorCommands(q, c, 4, 1, 0, 0, 1, "minecraft:wooden_door");
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
  pushDoorCommands(q, c, 7, 1, 0, 0, 1, "minecraft:spruce_door");
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
  pushDoorCommands(q, c, 5, 8, 6, 0, 1, "minecraft:wooden_door");
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

// ==========================================
// 🏘️ MODERN VILLAGE BUILDER
// ==========================================

// The village is a 3×3 grid of 17×17 lots separated by 5-wide roads
// (sidewalk, three lanes of concrete, sidewalk). 17×3 + 5×2 = 61 blocks a
// side, which stays inside the 64-block limit of `/structure save`, so the
// whole village can still be undone with a single snapshot.
const VILLAGE_LOT = 17;
const VILLAGE_ROAD = 5;
const VILLAGE_SIZE = VILLAGE_LOT * 3 + VILLAGE_ROAD * 2;
const VILLAGE_FOUNDATION_DEPTH = 4;
const VILLAGE_CLEAR_HEIGHT = 17;
const VILLAGE_BATCH_SIZE = 40;
const FILL_COMMAND_LIMIT = 32768;

const VILLAGE_PALETTES = [
  {
    name: "Crisp White ⚪",
    wall: "minecraft:white_concrete", accent: "minecraft:light_gray_concrete",
    trim: "minecraft:stripped_dark_oak_log", plank: "minecraft:dark_oak_planks",
    floor: "minecraft:smooth_quartz", upperFloor: "minecraft:dark_oak_planks",
    roof: "minecraft:gray_concrete", roofStairs: "minecraft:dark_oak_stairs", slab: "minecraft:smooth_stone_slab",
    door: "minecraft:dark_oak_door", fence: "minecraft:dark_oak_fence", gate: "minecraft:dark_oak_fence_gate",
    sofa: "minecraft:quartz_stairs", chair: "minecraft:dark_oak_stairs", carpet: "minecraft:light_gray_carpet",
    counter: "minecraft:quartz_block", table: "minecraft:dark_oak_slab"
  },
  {
    name: "Charcoal & Oak ⚫",
    wall: "minecraft:gray_concrete", accent: "minecraft:black_concrete",
    trim: "minecraft:stripped_oak_log", plank: "minecraft:oak_planks",
    floor: "minecraft:smooth_stone", upperFloor: "minecraft:oak_planks",
    roof: "minecraft:black_concrete", roofStairs: "minecraft:deepslate_tile_stairs", slab: "minecraft:smooth_stone_slab",
    door: "minecraft:dark_oak_door", fence: "minecraft:oak_fence", gate: "minecraft:dark_oak_fence_gate",
    sofa: "minecraft:quartz_stairs", chair: "minecraft:oak_stairs", carpet: "minecraft:white_carpet",
    counter: "minecraft:quartz_block", table: "minecraft:oak_slab"
  },
  {
    name: "Sandstone & Spruce 🏖️",
    wall: "minecraft:sandstone", accent: "minecraft:white_concrete",
    trim: "minecraft:stripped_spruce_log", plank: "minecraft:spruce_planks",
    floor: "minecraft:smooth_stone", upperFloor: "minecraft:spruce_planks",
    roof: "minecraft:light_gray_concrete", roofStairs: "minecraft:spruce_stairs", slab: "minecraft:smooth_stone_slab",
    door: "minecraft:dark_oak_door", fence: "minecraft:spruce_fence", gate: "minecraft:dark_oak_fence_gate",
    sofa: "minecraft:quartz_stairs", chair: "minecraft:spruce_stairs", carpet: "minecraft:white_carpet",
    counter: "minecraft:quartz_block", table: "minecraft:spruce_slab"
  }
];

const VILLAGE_SHARED_BLOCKS = {
  path: "minecraft:smooth_stone", sidewalk: "minecraft:smooth_stone", road: "minecraft:gray_concrete",
  roadLine: "minecraft:light_gray_concrete", plaza: "minecraft:smooth_stone", plazaInner: "minecraft:polished_andesite",
  glass: "minecraft:glass", pane: "minecraft:glass_pane", bars: "minecraft:iron_bars",
  light: "minecraft:sea_lantern", lantern: "minecraft:lantern", hangingLantern: 'minecraft:lantern ["hanging"=true]',
  leaves: 'minecraft:oak_leaves ["persistent_bit"=true]', log: "minecraft:oak_log",
  grass: "minecraft:grass_block", dirt: "minecraft:dirt", air: "minecraft:air", water: "minecraft:water",
  farmland: 'minecraft:farmland ["moisturized_amount"=7]', hay: "minecraft:hay_block",
  stoneBricks: "minecraft:stone_bricks", tv: "minecraft:black_concrete", plate: "minecraft:wooden_pressure_plate"
};

const STAIR_DIRECTION_CODES = { "1,0": 0, "-1,0": 1, "0,1": 2, "0,-1": 3 };
const BED_DIRECTION_CODES = { "0,1": 0, "-1,0": 1, "0,-1": 2, "1,0": 3 };
const DOOR_DIRECTION_CODES = { "1,0": 0, "0,1": 1, "-1,0": 2, "0,-1": 3 };
// `facing_direction` of a ladder is the way it faces, away from the wall it hangs on.
const LADDER_DIRECTION_CODES = { "0,-1": 2, "0,1": 3, "-1,0": 4, "1,0": 5 };
const CARDINAL_DIRECTION_NAMES = { "1,0": "east", "-1,0": "west", "0,1": "south", "0,-1": "north" };

function withBlockStates(blockId, states) {
  const entries = Object.entries(states).map(([key, value]) => `"${key}"=${typeof value === "string" ? `"${value}"` : value}`);
  return `${blockId} [${entries.join(",")}]`;
}

/** World direction key ("x,z") for a direction given in a build context's local axes. */
function worldDirectionKey(context, dx, dz) {
  return `${context.rightX * dx + context.forwardX * dz},${context.rightZ * dx + context.forwardZ * dz}`;
}

/**
 * Creates a build context nested inside another one. `ax`/`az` is the parent
 * local point that becomes the child's origin and `fx`/`fz` is the child's
 * forward direction expressed in the parent's local axes. Parent contexts are
 * pure rotations, so the child keeps the same handedness.
 */
function createSubContext(parent, ax, az, fx, fz) {
  const origin = localPoint(parent, ax, 0, az);
  const rx = fz, rz = -fx;
  return {
    baseY: parent.baseY,
    originX: origin.x, originZ: origin.z,
    forwardX: parent.rightX * fx + parent.forwardX * fz,
    forwardZ: parent.rightZ * fx + parent.forwardZ * fz,
    rightX: parent.rightX * rx + parent.forwardX * rz,
    rightZ: parent.rightZ * rx + parent.forwardZ * rz
  };
}

/**
 * Context for a building of `width` blocks centred on the front edge of a lot.
 * `facing` is the lot-local direction from the lot towards its road; the
 * building's local z axis runs from the road into the lot.
 */
function createLotContext(village, col, row, facing, width) {
  const lx0 = col * (VILLAGE_LOT + VILLAGE_ROAD);
  const lz0 = row * (VILLAGE_LOT + VILLAGE_ROAD);
  const half = Math.floor((VILLAGE_LOT - 1) / 2);
  const frontX = lx0 + half + facing.x * half;
  const frontZ = lz0 + half + facing.z * half;
  const fx = -facing.x, fz = -facing.z;
  const rx = fz, rz = -fx;
  const widthHalf = Math.floor((width - 1) / 2);
  return createSubContext(village, frontX - rx * widthHalf, frontZ - rz * widthHalf, fx, fz);
}

/** Splits a fill into horizontal layers so no single command exceeds the fill limit. */
function pushLargeFill(q, c, x1, y1, z1, x2, y2, z2, blockId, mode = "") {
  const area = (Math.abs(x2 - x1) + 1) * (Math.abs(z2 - z1) + 1);
  const layersPerCommand = Math.max(1, Math.floor(FILL_COMMAND_LIMIT / area));
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += layersPerCommand) {
    q.push(fillLocal(c, x1, y, z1, x2, Math.min(y + layersPerCommand - 1, Math.max(y1, y2)), z2, blockId, mode));
  }
}

class VillageBuilder {
  constructor(context, palette, blocks) {
    this.c = context;
    this.p = palette;
    this.b = blocks;
    this.q = [];
  }
  fill(x1, y1, z1, x2, y2, z2, blockId, mode = "") { this.q.push(fillLocal(this.c, x1, y1, z1, x2, y2, z2, blockId, mode)); }
  set(x, y, z, blockId) { this.q.push(setLocal(this.c, x, y, z, blockId)); }
  /** Chair or sofa seat facing local direction (dx, dz): the tall side is behind the seat. */
  seat(x, y, z, dx, dz, blockId = this.p.chair) {
    const code = STAIR_DIRECTION_CODES[worldDirectionKey(this.c, -dx, -dz)];
    this.set(x, y, z, withBlockStates(blockId, { weirdo_direction: code, upside_down_bit: false }));
  }
  /** Two-block bed with the foot at (x, z) and the head one block towards (dx, dz). */
  bed(x, y, z, dx, dz) {
    const code = BED_DIRECTION_CODES[worldDirectionKey(this.c, dx, dz)];
    this.set(x, y, z, withBlockStates("minecraft:bed", { direction: code, head_piece_bit: false, occupied_bit: false }));
    this.set(x + dx, y, z + dz, withBlockStates("minecraft:bed", { direction: code, head_piece_bit: true, occupied_bit: false }));
  }
  /** Door whose walk-through direction is (dx, dz). */
  door(x, y, z, dx, dz) {
    pushDoorCommands(this.q, this.c, x, y, z, dx, dz, this.p.door);
  }
  /** Row of stair blocks from (x1, z1) to (x2, z2) at height y whose tall side faces local (dx, dz). */
  stairs(x1, y, z1, x2, z2, dx, dz, blockId = this.p.roofStairs) {
    const code = STAIR_DIRECTION_CODES[worldDirectionKey(this.c, dx, dz)];
    this.fill(x1, y, z1, x2, y, z2, withBlockStates(blockId, { weirdo_direction: code, upside_down_bit: false }));
  }
  /** Ladder from y1 up to y2 at (x, z), facing local (dx, dz) away from the wall it hangs on. */
  ladder(x, y1, z, y2, dx, dz) {
    const code = LADDER_DIRECTION_CODES[worldDirectionKey(this.c, dx, dz)];
    this.fill(x, y1, z, x, y2, z, withBlockStates("minecraft:ladder", { facing_direction: code }));
  }
  /** Container or furnace whose front faces local direction (dx, dz). */
  facing(x, y, z, blockId, dx, dz) {
    this.set(x, y, z, withBlockStates(blockId, { "minecraft:cardinal_direction": CARDINAL_DIRECTION_NAMES[worldDirectionKey(this.c, dx, dz)] }));
  }
  table(x, y, z) {
    this.set(x, y, z, this.p.fence);
    this.set(x, y + 1, z, this.b.plate);
  }
  lampPost(x, z, height = 2) {
    this.fill(x, 1, z, x, height, z, this.p.fence);
    this.set(x, height + 1, z, this.b.lantern);
  }
  tree(x, z) {
    this.fill(x - 1, 3, z - 1, x + 1, 4, z + 1, this.b.leaves);
    this.set(x, 5, z, this.b.leaves);
    this.fill(x, 1, z, x, 4, z, this.b.log);
  }
  /** Hollow room: floor at y0, walls y0+1..y0+height, interior cleared. */
  room(x1, z1, x2, z2, y0, height, wall, floor) {
    this.fill(x1, y0, z1, x2, y0, z2, floor);
    this.fill(x1, y0 + 1, z1, x2, y0 + height, z1, wall);
    this.fill(x1, y0 + 1, z2, x2, y0 + height, z2, wall);
    this.fill(x1, y0 + 1, z1, x1, y0 + height, z2, wall);
    this.fill(x2, y0 + 1, z1, x2, y0 + height, z2, wall);
    this.fill(x1 + 1, y0 + 1, z1 + 1, x2 - 1, y0 + height, z2 - 1, this.b.air);
  }
  /** Flat modern roof with a one-block slab overhang all round. */
  flatRoof(x1, z1, x2, z2, y) {
    this.fill(x1 - 1, y, z1 - 1, x2 + 1, y, z2 + 1, this.p.slab);
    this.fill(x1, y, z1, x2, y, z2, this.p.roof);
  }
  kitchenRow(x1, z, y, dx, dz, items) {
    for (let i = 0; i < items.length; i++) {
      const x = x1 + i;
      const item = items[i];
      if (item === "furnace" || item === "smoker" || item === "chest") this.facing(x, y, z, `minecraft:${item}`, dx, dz);
      else if (item === "counter") this.set(x, y, z, this.p.counter);
      else this.set(x, y, z, `minecraft:${item}`);
    }
  }
}

// Each building is drawn in its own lot context: x runs across the frontage,
// z runs from the road (z = 0, next to the sidewalk) into the lot, y = 0 is
// street level. Furniture goes in after the walls so it never gets cleared.

function drawBungalow(v) {
  const { p, b } = v;
  v.fill(5, 0, 0, 5, 0, 2, b.path);
  v.fill(0, 1, 0, 3, 1, 0, b.leaves);
  v.fill(7, 1, 0, 10, 1, 0, b.leaves);
  v.room(0, 3, 10, 11, 0, 4, p.wall, p.floor);
  v.fill(7, 1, 3, 10, 4, 3, p.accent);
  v.fill(0, 1, 3, 0, 4, 3, p.trim);
  v.fill(10, 1, 3, 10, 4, 3, p.trim);
  v.fill(1, 2, 3, 3, 3, 3, b.glass);
  v.fill(8, 2, 3, 9, 3, 3, b.glass);
  v.fill(0, 2, 5, 0, 3, 9, b.glass);
  v.fill(10, 2, 5, 10, 3, 9, b.glass);
  v.fill(2, 2, 11, 8, 3, 11, b.glass);
  v.door(5, 1, 3, 0, 1);
  v.fill(6, 1, 4, 6, 4, 7, p.plank);
  v.fill(6, 2, 6, 6, 2, 7, b.tv);
  v.fill(2, 1, 6, 4, 1, 8, p.carpet);
  for (let z = 6; z <= 8; z++) v.seat(1, 1, z, 1, 0, p.sofa);
  v.set(3, 1, 7, p.table);
  v.kitchenRow(1, 10, 1, 0, -1, ["barrel", "furnace", "counter", "crafting_table", "counter"]);
  v.set(5, 2, 10, "minecraft:flower_pot");
  v.bed(8, 1, 9, 0, 1);
  v.facing(9, 1, 10, "minecraft:chest", 0, -1);
  v.fill(9, 1, 4, 9, 2, 4, "minecraft:bookshelf");
  v.flatRoof(0, 3, 10, 11, 5);
  v.set(3, 5, 7, b.light);
  v.set(8, 5, 7, b.light);
}

function drawCarportHouse(v) {
  const { p, b } = v;
  v.fill(4, 0, 0, 4, 0, 2, b.path);
  v.fill(10, 0, 0, 14, 0, 9, b.road);
  v.fill(0, 1, 0, 2, 1, 0, b.leaves);
  v.room(0, 3, 8, 11, 0, 4, p.accent, p.floor);
  v.fill(0, 1, 3, 3, 4, 3, p.wall);
  v.fill(0, 1, 11, 8, 4, 11, p.wall);
  v.fill(1, 2, 3, 2, 3, 3, b.glass);
  v.fill(6, 2, 3, 7, 3, 3, b.glass);
  v.fill(0, 2, 5, 0, 3, 9, b.glass);
  v.fill(2, 2, 11, 6, 3, 11, b.glass);
  v.door(4, 1, 3, 0, 1);
  v.fill(2, 1, 5, 5, 1, 8, p.carpet);
  for (let z = 6; z <= 7; z++) v.seat(1, 1, z, 1, 0, p.sofa);
  v.set(3, 1, 6, p.table);
  v.fill(7, 2, 6, 7, 2, 7, b.tv);
  v.kitchenRow(1, 10, 1, 0, -1, ["furnace", "smoker", "crafting_table", "barrel"]);
  v.bed(6, 1, 9, 0, 1);
  v.facing(7, 1, 10, "minecraft:chest", 0, -1);
  v.set(5, 1, 10, "minecraft:bookshelf");
  v.flatRoof(0, 3, 8, 11, 5);
  v.set(2, 5, 7, b.light);
  v.set(6, 5, 7, b.light);
  for (const z of [3, 9]) for (const x of [10, 14]) v.fill(x, 1, z, x, 4, z, p.trim);
  v.fill(9, 5, 2, 15, 5, 10, p.roof);
  v.set(12, 4, 6, b.hangingLantern);
}

function drawStudioCabin(v) {
  const { p, b } = v;
  v.fill(3, 0, 0, 3, 0, 2, b.path);
  v.fill(0, 1, 0, 1, 1, 0, b.leaves);
  v.fill(5, 1, 0, 6, 1, 0, b.leaves);
  v.room(0, 3, 6, 9, 0, 3, p.plank, p.floor);
  v.fill(0, 1, 3, 0, 3, 3, p.trim);
  v.fill(6, 1, 3, 6, 3, 3, p.trim);
  v.fill(1, 1, 3, 2, 3, 3, b.glass);
  v.fill(4, 1, 3, 5, 3, 3, b.glass);
  v.fill(0, 2, 5, 0, 2, 7, b.glass);
  v.fill(6, 2, 5, 6, 2, 7, b.glass);
  v.door(3, 1, 3, 0, 1);
  v.bed(1, 1, 7, 0, 1);
  v.facing(2, 1, 8, "minecraft:chest", 0, -1);
  v.kitchenRow(4, 8, 1, 0, -1, ["furnace", "crafting_table"]);
  v.fill(5, 1, 5, 5, 2, 5, "minecraft:bookshelf");
  v.set(5, 1, 4, "minecraft:lectern");
  v.fill(2, 1, 5, 4, 1, 6, p.carpet);
  v.seat(4, 1, 7, -1, 0);
  v.flatRoof(0, 3, 6, 9, 4);
  v.set(3, 4, 6, b.light);
}

function drawFamilyHome(v) {
  const { p, b } = v;
  v.fill(5, 0, 0, 5, 0, 2, b.path);
  v.fill(0, 1, 0, 3, 1, 0, b.leaves);
  v.fill(7, 1, 0, 10, 1, 0, b.leaves);
  v.room(0, 3, 10, 12, 0, 9, p.wall, p.floor);
  v.fill(0, 6, 3, 10, 9, 3, p.accent);
  v.fill(1, 5, 4, 9, 5, 11, p.upperFloor);
  for (const y of [2, 7]) {
    v.fill(1, y, 3, 3, y + 1, 3, b.glass);
    v.fill(7, y, 3, 9, y + 1, 3, b.glass);
    v.fill(0, y, 6, 0, y + 1, 10, b.glass);
    v.fill(10, y, 6, 10, y + 1, 10, b.glass);
    v.fill(2, y, 12, 8, y + 1, 12, b.glass);
  }
  v.door(5, 1, 3, 0, 1);
  for (let step = 0; step < 4; step++) {
    v.fill(8, 1 + step, 5 + step, 9, 1 + step, 5 + step, p.plank);
    v.fill(8, 2 + step, 5 + step, 9, 3 + step, 5 + step, b.air);
  }
  v.fill(8, 5, 5, 9, 5, 8, b.air);
  v.fill(7, 6, 5, 7, 6, 8, p.fence);
  v.kitchenRow(1, 11, 1, 0, -1, ["barrel", "furnace", "counter", "smoker", "crafting_table", "counter"]);
  v.set(6, 2, 11, "minecraft:flower_pot");
  v.table(3, 1, 8);
  v.seat(2, 1, 8, 1, 0);
  v.seat(4, 1, 8, -1, 0);
  v.fill(1, 1, 5, 4, 1, 6, p.carpet);
  for (let x = 1; x <= 2; x++) v.seat(x, 1, 4, 0, 1, p.sofa);
  v.fill(1, 1, 9, 1, 2, 9, "minecraft:bookshelf");
  v.set(3, 4, 7, b.hangingLantern);
  v.set(6, 4, 9, b.hangingLantern);
  v.fill(5, 6, 4, 5, 9, 7, p.plank);
  v.bed(2, 6, 5, 0, -1);
  v.facing(1, 6, 4, "minecraft:chest", 0, 1);
  v.set(3, 6, 4, "minecraft:bookshelf");
  v.fill(1, 6, 7, 4, 6, 8, p.carpet);
  v.bed(8, 6, 10, 0, 1);
  v.facing(9, 6, 11, "minecraft:chest", 0, -1);
  v.set(1, 6, 11, "minecraft:cauldron");
  v.set(2, 6, 11, p.counter);
  v.set(6, 6, 11, "minecraft:bookshelf");
  v.fill(6, 6, 9, 7, 6, 10, p.carpet);
  v.flatRoof(0, 3, 10, 12, 10);
  v.set(3, 10, 7, b.light);
  v.set(7, 10, 10, b.light);
}

function drawApartmentBlock(v) {
  const { p, b } = v;
  v.fill(5, 0, 0, 7, 0, 2, b.path);
  v.fill(0, 1, 0, 3, 1, 0, b.leaves);
  v.fill(9, 1, 0, 12, 1, 0, b.leaves);
  v.room(0, 3, 12, 15, 0, 14, p.wall, p.floor);
  v.fill(0, 1, 3, 0, 14, 3, p.trim);
  v.fill(12, 1, 3, 12, 14, 3, p.trim);
  const levels = [0, 5, 10];
  for (const level of levels) {
    if (level > 0) v.fill(1, level, 4, 11, level, 14, p.upperFloor);
    v.fill(2, level + 2, 3, 4, level + 3, 3, b.glass);
    v.fill(8, level + 2, 3, 10, level + 3, 3, b.glass);
    v.fill(0, level + 2, 6, 0, level + 3, 8, b.glass);
    v.fill(0, level + 2, 11, 0, level + 3, 13, b.glass);
    v.fill(12, level + 2, 6, 12, level + 3, 8, b.glass);
    v.fill(12, level + 2, 11, 12, level + 3, 13, b.glass);
    v.fill(2, level + 2, 15, 10, level + 3, 15, b.glass);
    if (level > 0) {
      v.fill(1, level, 1, 5, level, 2, p.upperFloor);
      v.fill(1, level + 1, 1, 5, level + 1, 1, b.bars);
      v.set(1, level + 1, 2, b.bars);
      v.set(5, level + 1, 2, b.bars);
      v.door(3, level + 1, 3, 0, 1);
    }
  }
  v.door(6, 1, 3, 0, 1);
  for (let flight = 0; flight < 2; flight++) {
    const z0 = 5 + flight * 4;
    const y0 = 1 + flight * 5;
    for (let step = 0; step < 4; step++) {
      v.fill(10, y0 + step, z0 + step, 11, y0 + step, z0 + step, p.plank);
      v.fill(10, y0 + step + 1, z0 + step, 11, y0 + step + 2, z0 + step, b.air);
    }
    v.fill(10, y0 + 4, z0, 11, y0 + 4, z0 + 3, b.air);
    v.fill(9, y0 + 5, z0, 9, y0 + 5, z0 + 3, p.fence);
  }
  v.flatRoof(0, 3, 12, 15, 15);
  v.fill(0, 16, 3, 12, 16, 3, p.slab);
  v.fill(0, 16, 15, 12, 16, 15, p.slab);
  v.fill(0, 16, 3, 0, 16, 15, p.slab);
  v.fill(12, 16, 3, 12, 16, 15, p.slab);
  // Furnish every storey once all floors and the roof exist, so nothing is overwritten.
  for (const level of levels) {
    v.fill(4, level + 1, 8, 4, level + 4, 11, p.plank);
    v.fill(4, level + 2, 9, 4, level + 2, 10, b.tv);
    for (let x = 1; x <= 2; x++) v.seat(x, level + 1, 6, 0, 1, p.sofa);
    v.fill(1, level + 1, 7, 3, level + 1, 9, p.carpet);
    v.set(2, level + 1, 8, p.table);
    v.kitchenRow(5, 14, level + 1, 0, -1, ["barrel", "furnace", "counter", "crafting_table"]);
    v.bed(1, level + 1, 13, 0, 1);
    v.facing(2, level + 1, 14, "minecraft:chest", 0, -1);
    v.fill(9, level + 1, 14, 9, level + 2, 14, "minecraft:bookshelf");
    v.set(3, level + 5, 8, b.light);
    v.set(7, level + 5, 12, b.light);
  }
}

function drawCafe(v) {
  const { p, b } = v;
  v.fill(4, 0, 0, 8, 0, 2, b.path);
  for (const x of [1, 11]) {
    v.table(x, 1, 1);
    v.seat(x - 1, 1, 1, 1, 0);
    v.seat(x + 1, 1, 1, -1, 0);
  }
  v.room(0, 3, 12, 13, 0, 9, p.wall, p.floor);
  v.fill(0, 6, 3, 12, 9, 3, p.accent);
  v.fill(1, 5, 4, 11, 5, 12, p.upperFloor);
  v.fill(1, 1, 3, 5, 3, 3, b.glass);
  v.fill(7, 1, 3, 11, 3, 3, b.glass);
  v.fill(0, 4, 2, 12, 4, 2, p.slab);
  v.fill(2, 7, 3, 4, 8, 3, b.glass);
  v.fill(8, 7, 3, 10, 8, 3, b.glass);
  for (const y of [2, 7]) {
    v.fill(0, y, 6, 0, y + 1, 10, b.glass);
    v.fill(12, y, 6, 12, y + 1, 10, b.glass);
    v.fill(3, y, 13, 9, y + 1, 13, b.glass);
  }
  v.door(6, 1, 3, 0, 1);
  v.kitchenRow(3, 11, 1, 0, -1, ["barrel", "smoker", "counter", "counter", "counter", "counter", "furnace"]);
  v.set(7, 2, 11, "minecraft:cake");
  v.set(5, 2, 11, "minecraft:flower_pot");
  v.fill(3, 1, 12, 9, 2, 12, "minecraft:bookshelf");
  for (const [x, z] of [[3, 6], [3, 10], [7, 8]]) {
    v.table(x, 1, z);
    v.seat(x - 1, 1, z, 1, 0);
    v.seat(x + 1, 1, z, -1, 0);
  }
  for (let step = 0; step < 4; step++) {
    v.fill(10, 1 + step, 5 + step, 11, 1 + step, 5 + step, p.plank);
    v.fill(10, 2 + step, 5 + step, 11, 3 + step, 5 + step, b.air);
  }
  v.fill(10, 5, 5, 11, 5, 8, b.air);
  v.fill(9, 6, 5, 9, 6, 8, p.fence);
  v.set(3, 4, 6, b.hangingLantern);
  v.set(7, 4, 8, b.hangingLantern);
  v.set(3, 4, 10, b.hangingLantern);
  v.bed(2, 6, 11, 0, 1);
  v.facing(1, 6, 12, "minecraft:chest", 0, -1);
  for (let x = 2; x <= 3; x++) v.seat(x, 6, 5, 0, 1, p.sofa);
  v.fill(1, 6, 6, 4, 6, 8, p.carpet);
  v.set(2, 6, 7, p.table);
  v.kitchenRow(5, 12, 6, 0, -1, ["furnace", "counter", "crafting_table", "barrel"]);
  v.fill(8, 6, 11, 8, 7, 11, "minecraft:bookshelf");
  v.flatRoof(0, 3, 12, 13, 10);
  v.set(3, 10, 8, b.light);
  v.set(8, 10, 8, b.light);
}

function drawCropFarm(v) {
  const { p, b } = v;
  v.fill(0, 1, 0, 16, 1, 0, p.fence);
  v.fill(0, 1, 16, 16, 1, 16, p.fence);
  v.fill(0, 1, 0, 0, 1, 16, p.fence);
  v.fill(16, 1, 0, 16, 1, 16, p.fence);
  v.set(8, 1, 0, p.gate);
  v.fill(8, 0, 1, 8, 0, 10, b.path);
  const crops = [
    [1, 7, withBlockStates("minecraft:wheat", { growth: 7 }), withBlockStates("minecraft:carrots", { growth: 7 })],
    [9, 15, withBlockStates("minecraft:potatoes", { growth: 7 }), withBlockStates("minecraft:beetroot", { growth: 7 })]
  ];
  for (const [x1, x2, cropA, cropB] of crops) {
    v.fill(x1, 0, 2, x2, 0, 8, b.farmland);
    v.fill(x1, 0, 5, x2, 0, 5, b.water);
    v.fill(x1, 1, 2, x2, 1, 4, cropA);
    v.fill(x1, 1, 6, x2, 1, 8, cropB);
  }
  v.room(5, 11, 11, 15, 0, 3, p.plank, p.floor);
  v.door(8, 1, 11, 0, 1);
  v.fill(6, 2, 15, 10, 2, 15, b.pane);
  v.fill(6, 1, 14, 7, 1, 14, b.hay);
  v.facing(10, 1, 14, "minecraft:chest", 0, -1);
  v.set(10, 1, 12, "minecraft:composter");
  v.set(10, 1, 13, "minecraft:crafting_table");
  v.set(6, 1, 12, "minecraft:barrel");
  v.flatRoof(5, 11, 11, 15, 4);
  v.set(8, 3, 13, b.hangingLantern);
  v.fill(2, 1, 12, 2, 1, 13, b.hay);
  v.set(2, 2, 12, b.hay);
  v.set(14, 1, 12, "minecraft:composter");
  v.tree(14, 14);
  v.lampPost(1, 1);
  v.lampPost(15, 1);
}

function drawOrchardFarm(v) {
  const { p, b } = v;
  v.fill(0, 1, 0, 16, 1, 0, p.fence);
  v.fill(0, 1, 16, 16, 1, 16, p.fence);
  v.fill(0, 1, 0, 0, 1, 16, p.fence);
  v.fill(16, 1, 0, 16, 1, 16, p.fence);
  v.set(8, 1, 0, p.gate);
  v.fill(8, 0, 1, 8, 0, 15, b.path);
  // Glasshouse with two rows of beds and a central channel.
  v.room(1, 2, 7, 10, 0, 3, b.glass, p.floor);
  for (const [x, z] of [[1, 2], [7, 2], [1, 10], [7, 10]]) v.fill(x, 1, z, x, 3, z, p.trim);
  v.fill(1, 4, 2, 7, 4, 10, b.glass);
  v.door(4, 1, 2, 0, 1);
  v.fill(2, 0, 3, 6, 0, 9, b.farmland);
  v.fill(4, 0, 3, 4, 0, 9, b.water);
  v.fill(2, 1, 3, 3, 1, 9, withBlockStates("minecraft:carrots", { growth: 7 }));
  v.fill(5, 1, 3, 6, 1, 9, withBlockStates("minecraft:beetroot", { growth: 7 }));
  v.set(4, 3, 6, b.hangingLantern);
  // Orchard rows.
  for (const z of [4, 8, 12]) for (const x of [10, 14]) v.tree(x, z);
  // Open-sided storage barn.
  for (const [x, z] of [[1, 12], [7, 12], [1, 15], [7, 15]]) v.fill(x, 1, z, x, 3, z, p.trim);
  v.fill(1, 4, 12, 7, 4, 15, p.roof);
  v.fill(2, 0, 12, 6, 0, 15, p.floor);
  v.fill(2, 1, 14, 3, 1, 15, b.hay);
  v.set(2, 2, 15, b.hay);
  v.facing(6, 1, 15, "minecraft:chest", 0, -1);
  v.set(5, 1, 15, "minecraft:barrel");
  v.set(6, 1, 13, "minecraft:composter");
  v.set(3, 1, 12, "minecraft:cauldron");
  v.set(4, 3, 13, b.hangingLantern);
  v.lampPost(1, 1);
  v.lampPost(15, 1);
}

function drawPlaza(v) {
  const { p, b } = v;
  v.fill(0, 0, 0, 16, 0, 16, b.plaza);
  v.fill(2, 0, 2, 14, 0, 14, b.plazaInner);
  v.fill(6, 0, 6, 10, 0, 10, b.plaza);
  // Well: a stone-brick basin with a lantern under a small roof.
  v.fill(6, -1, 6, 10, -1, 10, b.stoneBricks);
  v.fill(7, 0, 7, 9, 0, 9, b.water);
  v.fill(6, 1, 6, 10, 1, 10, b.stoneBricks);
  v.fill(7, 1, 7, 9, 1, 9, b.air);
  for (const [x, z] of [[6, 6], [10, 6], [6, 10], [10, 10]]) v.fill(x, 2, z, x, 3, z, p.fence);
  v.fill(5, 4, 5, 11, 4, 11, p.slab);
  v.fill(6, 4, 6, 10, 4, 10, p.plank);
  v.set(8, 3, 8, b.hangingLantern);
  // Benches around the well.
  for (let n = 7; n <= 9; n++) {
    v.seat(n, 1, 4, 0, 1);
    v.seat(n, 1, 12, 0, -1);
    v.seat(4, 1, n, 1, 0);
    v.seat(12, 1, n, -1, 0);
  }
  for (const [x, z] of [[2, 2], [14, 2], [2, 14], [14, 14]]) v.tree(x, z);
  for (const [x, z] of [[4, 4], [12, 4], [4, 12], [12, 12]]) v.lampPost(x, z);
  v.fill(8, 1, 2, 8, 2, 2, p.trim);
  v.set(8, 3, 2, "minecraft:bell");
}

function drawVillageRoads(village, q, b, palette) {
  const strips = [];
  for (const start of [VILLAGE_LOT, VILLAGE_LOT * 2 + VILLAGE_ROAD]) strips.push(start);
  const end = VILLAGE_SIZE - 1;
  for (const s of strips) {
    const centre = s + 2;
    // Road running along z (sidewalk, lanes, sidewalk) and the matching one along x.
    q.push(fillLocal(village, s, 0, 0, s, 0, end, b.sidewalk));
    q.push(fillLocal(village, s + 4, 0, 0, s + 4, 0, end, b.sidewalk));
    q.push(fillLocal(village, s + 1, 0, 0, s + 3, 0, end, b.road));
    q.push(fillLocal(village, 0, 0, s, end, 0, s, b.sidewalk));
    q.push(fillLocal(village, 0, 0, s + 4, end, 0, s + 4, b.sidewalk));
    q.push(fillLocal(village, 0, 0, s + 1, end, 0, s + 3, b.road));
    for (let n = 1; n < end; n += 4) {
      q.push(fillLocal(village, centre, 0, n, centre, 0, Math.min(n + 1, end), b.roadLine));
      q.push(fillLocal(village, n, 0, centre, Math.min(n + 1, end), 0, centre, b.roadLine));
    }
  }
  // Street lamps on the sidewalks.
  const lampFence = palette.fence;
  for (const s of strips) for (const edge of [s, s + 4]) for (const n of [8, 30, 52]) {
    q.push(fillLocal(village, edge, 1, n, edge, 2, n, lampFence));
    q.push(setLocal(village, edge, 3, n, b.lantern));
    q.push(fillLocal(village, n, 1, edge, n, 2, edge, lampFence));
    q.push(setLocal(village, n, 3, edge, b.lantern));
  }
}

const VILLAGE_LOTS = [
  { col: 0, row: 0, facing: { x: 0, z: 1 }, width: 11, draw: drawBungalow },
  { col: 1, row: 0, facing: { x: 0, z: 1 }, width: 13, draw: drawApartmentBlock },
  { col: 2, row: 0, facing: { x: 0, z: 1 }, width: 15, draw: drawCarportHouse },
  { col: 0, row: 1, facing: { x: 1, z: 0 }, width: 17, draw: drawCropFarm },
  { col: 1, row: 1, facing: { x: 0, z: 1 }, width: 17, draw: drawPlaza },
  { col: 2, row: 1, facing: { x: -1, z: 0 }, width: 17, draw: drawOrchardFarm },
  { col: 0, row: 2, facing: { x: 0, z: -1 }, width: 13, draw: drawCafe },
  { col: 1, row: 2, facing: { x: 0, z: -1 }, width: 11, draw: drawFamilyHome },
  { col: 2, row: 2, facing: { x: 0, z: -1 }, width: 7, draw: drawStudioCabin }
];

function createVillagePlan(player, paletteIndex = 0, prepareGround = true) {
  const palette = VILLAGE_PALETTES[paletteIndex] || VILLAGE_PALETTES[0];
  const b = VILLAGE_SHARED_BLOCKS;
  const c = createOrientedBuildContext(player, VILLAGE_SIZE, VILLAGE_SIZE, -1);
  const end = VILLAGE_SIZE - 1;
  const q = [];
  if (prepareGround) {
    pushLargeFill(q, c, 0, 1, 0, end, VILLAGE_CLEAR_HEIGHT, end, b.air);
    pushLargeFill(q, c, 0, -VILLAGE_FOUNDATION_DEPTH, 0, end, -1, end, b.dirt, "keep");
    pushLargeFill(q, c, 0, 0, 0, end, 0, end, b.grass);
  }
  drawVillageRoads(c, q, b, palette);
  for (const lot of VILLAGE_LOTS) {
    const builder = new VillageBuilder(createLotContext(c, lot.col, lot.row, lot.facing, lot.width), palette, b);
    lot.draw(builder);
    q.push(...builder.q);
  }
  const plan = makePlan(player, "Modern Village", c, q,
    localBounds(c, 0, -VILLAGE_FOUNDATION_DEPTH, 0, end, VILLAGE_CLEAR_HEIGHT, end));
  plan.batchSize = VILLAGE_BATCH_SIZE;
  plan.palette = palette.name;
  return plan;
}

function openVillageBuilderMenu(player) {
  const form = new ModalFormData()
    .title("🏘️ Build a Modern Village")
    .dropdown("Colour scheme:", VILLAGE_PALETTES.map((palette) => palette.name), { defaultValueIndex: 0 })
    .toggle("Flatten and prepare the ground first (recommended)", { defaultValue: true })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [paletteIndex, prepareGround, showGuide] = response.formValues;
    const plan = createVillagePlan(player, Number(paletteIndex), Boolean(prepareGround));
    if (!validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => {
      player.sendMessage("§eThe village is built over a few seconds. Please stay in this dimension.§r");
      executeBuildPlan(player, plan, "village", "🏘️ Modern village completed! Four houses, apartments, a cafe, two farms and a well await.", "dig.wood");
    };
    const prompt = `Build a ${VILLAGE_SIZE}×${VILLAGE_SIZE} modern village (${plan.palette}) here?\n\n` +
      "It has four furnished houses, a three-storey apartment block, a cafe with a flat, two farms, and a plaza with a well. " +
      (prepareGround ? "The ground inside the box is flattened first." : "The ground is left as it is, so pick flat land.");
    if (showGuide) startPreview(player, plan.bounds, "minecraft:villager_happy", prompt, confirm);
    else confirm();
  }).catch((e) => console.error("Village builder menu error: " + e));
}

// ==========================================
// 🏡 HOUSE DESIGNS (WITH DOORS)
// ==========================================

// Every house design can be built in any of these styles. The first three are
// the village colour schemes; the rest are rustic and themed material sets.
const HOUSE_PALETTES = [
  ...VILLAGE_PALETTES,
  {
    name: "Rustic Oak & Cobblestone 🪵",
    wall: "minecraft:cobblestone", accent: "minecraft:stone_bricks",
    trim: "minecraft:oak_log", plank: "minecraft:oak_planks",
    floor: "minecraft:oak_planks", upperFloor: "minecraft:oak_planks",
    roof: "minecraft:dark_oak_planks", roofStairs: "minecraft:dark_oak_stairs", slab: "minecraft:dark_oak_slab",
    door: "minecraft:wooden_door", fence: "minecraft:oak_fence", gate: "minecraft:fence_gate",
    sofa: "minecraft:dark_oak_stairs", chair: "minecraft:oak_stairs", carpet: "minecraft:red_carpet",
    counter: "minecraft:smooth_stone", table: "minecraft:oak_slab"
  },
  {
    name: "Spruce Lodge 🌲",
    wall: "minecraft:spruce_planks", accent: "minecraft:stone_bricks",
    trim: "minecraft:stripped_spruce_log", plank: "minecraft:spruce_planks",
    floor: "minecraft:spruce_planks", upperFloor: "minecraft:spruce_planks",
    roof: "minecraft:stone_bricks", roofStairs: "minecraft:stone_brick_stairs", slab: "minecraft:stone_brick_slab",
    door: "minecraft:spruce_door", fence: "minecraft:spruce_fence", gate: "minecraft:spruce_fence_gate",
    sofa: "minecraft:spruce_stairs", chair: "minecraft:spruce_stairs", carpet: "minecraft:green_carpet",
    counter: "minecraft:smooth_stone", table: "minecraft:spruce_slab"
  },
  {
    name: "Desert Sandstone 🏜️",
    wall: "minecraft:sandstone", accent: "minecraft:smooth_sandstone",
    trim: "minecraft:stripped_acacia_log", plank: "minecraft:acacia_planks",
    floor: "minecraft:cut_sandstone", upperFloor: "minecraft:acacia_planks",
    roof: "minecraft:smooth_sandstone", roofStairs: "minecraft:sandstone_stairs", slab: "minecraft:sandstone_slab",
    door: "minecraft:acacia_door", fence: "minecraft:acacia_fence", gate: "minecraft:acacia_fence_gate",
    sofa: "minecraft:acacia_stairs", chair: "minecraft:acacia_stairs", carpet: "minecraft:orange_carpet",
    counter: "minecraft:cut_sandstone", table: "minecraft:acacia_slab"
  },
  {
    name: "Cherry Blossom 🌸",
    wall: "minecraft:cherry_planks", accent: "minecraft:white_concrete",
    trim: "minecraft:stripped_cherry_log", plank: "minecraft:cherry_planks",
    floor: "minecraft:cherry_planks", upperFloor: "minecraft:cherry_planks",
    roof: "minecraft:pink_terracotta", roofStairs: "minecraft:cherry_stairs", slab: "minecraft:cherry_slab",
    door: "minecraft:cherry_door", fence: "minecraft:cherry_fence", gate: "minecraft:cherry_fence_gate",
    sofa: "minecraft:quartz_stairs", chair: "minecraft:cherry_stairs", carpet: "minecraft:pink_carpet",
    counter: "minecraft:quartz_block", table: "minecraft:cherry_slab"
  }
];

// Designs are drawn like village lots: x runs across the frontage, z runs
// from the front (z = 0, one block ahead of the player) into the plot and
// y = 0 is ground level (the block under the player's feet).

/** Cottage with a pitched stair roof, chimney and a furnished single room. */
function drawCottage(v) {
  const { p, b } = v;
  v.set(5, 0, 0, b.path);
  v.lampPost(2, 0);
  v.lampPost(8, 0);
  v.room(1, 1, 9, 9, 0, 3, p.wall, p.floor);
  for (const [x, z] of [[1, 1], [9, 1], [1, 9], [9, 9]]) v.fill(x, 1, z, x, 3, z, p.trim);
  v.fill(2, 3, 1, 8, 3, 1, p.plank);
  v.fill(2, 2, 1, 3, 2, 1, b.glass);
  v.fill(7, 2, 1, 8, 2, 1, b.glass);
  for (const x of [1, 9]) {
    v.fill(x, 2, 3, x, 2, 4, b.glass);
    v.fill(x, 2, 6, x, 2, 7, b.glass);
  }
  v.fill(3, 2, 9, 4, 2, 9, b.glass);
  v.fill(6, 2, 9, 7, 2, 9, b.glass);
  v.door(5, 1, 1, 0, 1);
  v.fill(1, 4, 1, 9, 4, 9, p.plank);
  // Roof: each level steps one block in towards the ridge above x = 5.
  for (let i = 0; i <= 4; i++) {
    const y = 4 + i;
    v.stairs(i, y, 0, i, 10, 1, 0);
    v.stairs(10 - i, y, 0, 10 - i, 10, -1, 0);
    if (i >= 1 && i <= 3) {
      v.fill(i + 1, y, 1, 9 - i, y, 1, p.plank);
      v.fill(i + 1, y, 9, 9 - i, y, 9, p.plank);
      v.fill(i + 1, y, 2, 9 - i, y, 8, b.air);
    }
  }
  v.fill(5, 8, 0, 5, 8, 10, p.roof);
  v.fill(4, 6, 1, 6, 6, 1, b.glass);
  v.fill(8, 4, 8, 8, 9, 8, p.accent);
  v.set(8, 10, 8, "minecraft:campfire");
  // Furniture.
  v.bed(2, 1, 7, 0, 1);
  v.facing(3, 1, 8, "minecraft:chest", 0, -1);
  v.kitchenRow(6, 8, 1, 0, -1, ["furnace", "crafting_table", "barrel"]);
  v.fill(3, 1, 3, 7, 1, 4, p.carpet);
  v.table(5, 1, 5);
  v.seat(4, 1, 5, 1, 0);
  v.seat(6, 1, 5, -1, 0);
  v.fill(8, 1, 3, 8, 2, 3, "minecraft:bookshelf");
  v.set(5, 3, 5, b.hangingLantern);
}

/** Steep A-frame cabin whose roof reaches the ground, with a glass front gable. */
function drawAFrameCabin(v) {
  const { p, b } = v;
  v.fill(3, 0, 0, 5, 0, 0, b.path);
  v.lampPost(1, 0);
  v.lampPost(7, 0);
  v.fill(0, 0, 1, 8, 0, 9, p.floor);
  // Roof: two levels per step so the inside is tall enough to stand in.
  for (let i = 0; i <= 3; i++) {
    const y = 1 + i * 2;
    v.stairs(i, y, 0, i, 10, 1, 0);
    v.fill(i, y + 1, 0, i, y + 1, 10, p.roof);
    v.stairs(8 - i, y, 0, 8 - i, 10, -1, 0);
    v.fill(8 - i, y + 1, 0, 8 - i, y + 1, 10, p.roof);
    v.fill(i + 1, y, 1, 7 - i, y + 1, 1, p.plank);
    v.fill(i + 1, y, 9, 7 - i, y + 1, 9, p.plank);
    v.fill(i + 1, y, 2, 7 - i, y + 1, 8, b.air);
  }
  v.fill(4, 9, 0, 4, 9, 10, p.roof);
  v.fill(2, 3, 1, 6, 4, 1, b.glass);
  v.fill(3, 5, 1, 5, 6, 1, b.glass);
  v.set(2, 2, 1, b.glass);
  v.set(6, 2, 1, b.glass);
  v.fill(3, 5, 9, 5, 6, 9, b.glass);
  v.door(4, 1, 1, 0, 1);
  // Furniture.
  v.bed(1, 1, 7, 0, 1);
  v.facing(2, 1, 8, "minecraft:chest", 0, -1);
  v.kitchenRow(5, 8, 1, 0, -1, ["furnace", "crafting_table", "barrel"]);
  for (let z = 3; z <= 4; z++) v.seat(2, 1, z, 1, 0, p.sofa);
  v.fill(3, 1, 3, 5, 1, 5, p.carpet);
  v.set(4, 1, 4, p.table);
  v.fill(6, 1, 3, 6, 2, 3, "minecraft:bookshelf");
  v.set(4, 8, 4, b.hangingLantern);
  v.set(4, 8, 7, b.hangingLantern);
}

/** Two-storey modern villa with a roof terrace, internal stairs and a driveway. */
function drawModernVilla(v) {
  const { p, b } = v;
  v.fill(5, 0, 0, 7, 0, 1, b.path);
  v.fill(9, 0, 0, 12, 0, 1, b.road);
  v.fill(0, 1, 0, 3, 1, 0, b.leaves);
  v.room(0, 2, 12, 12, 0, 4, p.wall, p.floor);
  v.room(0, 2, 7, 12, 5, 4, p.accent, p.upperFloor);
  v.fill(8, 5, 2, 12, 5, 12, p.upperFloor);
  v.fill(8, 6, 2, 12, 6, 2, p.fence);
  v.fill(12, 6, 2, 12, 6, 12, p.fence);
  v.fill(8, 6, 12, 12, 6, 12, p.fence);
  // Ground-floor windows and door.
  v.fill(1, 2, 2, 4, 3, 2, b.glass);
  v.fill(8, 2, 2, 11, 3, 2, b.glass);
  for (const x of [0, 12]) {
    v.fill(x, 2, 4, x, 3, 6, b.glass);
    v.fill(x, 2, 8, x, 3, 10, b.glass);
  }
  v.fill(2, 2, 12, 5, 3, 12, b.glass);
  v.fill(7, 2, 12, 10, 3, 12, b.glass);
  v.door(6, 1, 2, 0, 1);
  // Upper-floor windows and the door onto the terrace.
  v.fill(1, 7, 2, 6, 8, 2, b.glass);
  v.fill(0, 7, 4, 0, 8, 6, b.glass);
  v.fill(0, 7, 8, 0, 8, 10, b.glass);
  v.fill(1, 7, 12, 6, 8, 12, b.glass);
  v.fill(7, 7, 4, 7, 8, 6, b.glass);
  v.door(7, 6, 8, 1, 0);
  // Stairs up the left side with an open stairwell.
  for (let step = 0; step < 4; step++) {
    v.fill(1, 1 + step, 4 + step, 2, 1 + step, 4 + step, p.plank);
    v.fill(1, 2 + step, 4 + step, 2, 3 + step, 4 + step, b.air);
  }
  v.fill(1, 5, 4, 2, 5, 7, b.air);
  v.fill(3, 6, 4, 3, 6, 7, p.fence);
  // Ground floor: lounge, kitchen and dining.
  v.fill(7, 1, 4, 7, 4, 6, p.plank);
  v.fill(7, 2, 4, 7, 2, 5, b.tv);
  v.fill(8, 1, 4, 11, 1, 6, p.carpet);
  for (let z = 4; z <= 5; z++) v.seat(11, 1, z, -1, 0, p.sofa);
  v.set(9, 1, 5, p.table);
  v.kitchenRow(1, 11, 1, 0, -1, ["barrel", "furnace", "counter", "smoker", "counter", "crafting_table"]);
  v.table(9, 1, 9);
  v.seat(8, 1, 9, 1, 0);
  v.seat(10, 1, 9, -1, 0);
  v.fill(11, 1, 11, 11, 2, 11, "minecraft:bookshelf");
  v.set(6, 4, 7, b.hangingLantern);
  v.set(4, 5, 9, b.light);
  v.set(9, 5, 5, b.light);
  // Upper floor: two bedrooms and a bathroom corner.
  v.bed(1, 6, 10, 0, 1);
  v.facing(3, 6, 11, "minecraft:chest", 0, -1);
  v.fill(1, 6, 8, 3, 6, 9, p.carpet);
  v.bed(5, 6, 10, 0, 1);
  v.facing(6, 6, 11, "minecraft:chest", 0, -1);
  v.set(6, 6, 4, "minecraft:cauldron");
  v.set(5, 6, 4, p.counter);
  v.fill(4, 6, 4, 4, 7, 4, "minecraft:bookshelf");
  v.set(3, 9, 7, b.hangingLantern);
  // Terrace seating.
  v.table(10, 6, 9);
  v.seat(9, 6, 9, 1, 0);
  v.seat(11, 6, 9, -1, 0);
  v.flatRoof(0, 2, 7, 12, 10);
}

/** Square stone watchtower with three floors joined by a ladder and a battlement deck. */
function drawWatchtower(v) {
  const { p, b } = v;
  v.set(3, 0, 0, b.path);
  v.room(0, 1, 6, 7, 0, 12, p.accent, p.floor);
  for (const [x, z] of [[0, 1], [6, 1], [0, 7], [6, 7]]) v.fill(x, 1, z, x, 12, z, p.trim);
  for (const y of [4, 8, 12]) v.fill(1, y, 2, 5, y, 6, p.upperFloor);
  v.ladder(3, 1, 6, 12, 0, -1);
  v.door(3, 1, 1, 0, 1);
  for (const y of [6, 10]) {
    v.set(1, y, 1, b.pane);
    v.set(5, y, 1, b.pane);
    v.set(0, y, 4, b.pane);
    v.set(6, y, 4, b.pane);
  }
  // Battlements around the top deck.
  for (let x = 0; x <= 6; x++) for (const z of [1, 7]) if ((x + z) % 2 === 0) v.set(x, 13, z, p.accent);
  for (let z = 2; z <= 6; z++) for (const x of [0, 6]) if ((x + z) % 2 === 0) v.set(x, 13, z, p.accent);
  v.set(3, 13, 4, "minecraft:campfire");
  v.fill(0, 13, 1, 0, 16, 1, p.fence);
  v.fill(1, 15, 1, 2, 16, 1, "minecraft:red_wool");
  // Furniture on each floor.
  v.facing(1, 1, 6, "minecraft:chest", 0, -1);
  v.set(5, 1, 6, "minecraft:crafting_table");
  v.set(5, 1, 2, "minecraft:barrel");
  v.bed(1, 5, 3, 0, 1);
  v.facing(5, 5, 6, "minecraft:chest", 0, -1);
  v.fill(1, 5, 6, 1, 6, 6, "minecraft:bookshelf");
  v.bed(1, 9, 3, 0, 1);
  v.set(5, 9, 6, "minecraft:bookshelf");
  v.set(5, 9, 2, "minecraft:lectern");
  for (const y of [3, 7, 11]) v.set(3, y, 4, b.hangingLantern);
}

const HOUSE_DESIGNS = [
  { key: "cottage", name: "Cosy Cottage 🏡", size: "11×11", description: "Pitched roof, chimney, bed and kitchen", width: 11, draw: drawCottage },
  { key: "aframe", name: "A-Frame Cabin 🛖", size: "9×11", description: "Steep roof to the ground, glass front, porch lamps", width: 9, draw: drawAFrameCabin },
  { key: "villa", name: "Modern Villa 🏢", size: "14×14", description: "Two storeys, roof terrace, stairs, driveway", width: 13, draw: drawModernVilla },
  { key: "watchtower", name: "Stone Watchtower 🗼", size: "7×8", description: "Ladder up three floors to the battlements", width: 7, draw: drawWatchtower },
  { key: "bungalow", name: "Modern Bungalow 🏠", size: "13×13", description: "Single storey with lounge, kitchen and bedroom", width: 11, draw: drawBungalow },
  { key: "carport_house", name: "Carport House 🚗", size: "17×13", description: "Modern home with a covered carport", width: 15, draw: drawCarportHouse },
  { key: "studio_cabin", name: "Studio Cabin 🛋️", size: "9×11", description: "Compact one-room cabin with a reading nook", width: 7, draw: drawStudioCabin },
  { key: "family_home", name: "Family Home 🏘️", size: "13×14", description: "Two storeys with three bedrooms and a kitchen", width: 11, draw: drawFamilyHome }
];

function createHouseDesignPlan(player, designKey, paletteIndex = 0) {
  const design = HOUSE_DESIGNS.find((d) => d.key === designKey);
  if (!design) return null;
  const palette = HOUSE_PALETTES[paletteIndex] || HOUSE_PALETTES[0];
  const c = createOrientedBuildContext(player, design.width, 1, -1);
  const builder = new VillageBuilder(c, palette, VILLAGE_SHARED_BLOCKS);
  design.draw(builder);
  const plan = makePlan(player, design.name.replace(/\s\S+$/, ""), c, builder.q, boundsFromCommands(builder.q));
  plan.batchSize = VILLAGE_BATCH_SIZE;
  plan.palette = palette.name;
  return plan;
}

function openHouseDesignsMenu(player) {
  const form = new ActionFormData()
    .title("🏡 House Designs")
    .body("Every house has a real door and furniture. Pick a design, then choose its style. It is placed in the direction you are facing:");
  for (const design of HOUSE_DESIGNS) form.button(`${design.name}\n§7${design.size} • ${design.description}`);
  form.button("⬅️ Back\n§7Return to Builder Tools");
  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === HOUSE_DESIGNS.length) return openBuilderToolsMenu(player);
    const design = HOUSE_DESIGNS[response.selection];
    if (design) openHouseStyleMenu(player, design);
  }).catch((e) => console.error("House designs menu error: " + e));
}

function openHouseStyleMenu(player, design) {
  const form = new ModalFormData()
    .title(`🏡 ${design.name}`)
    .dropdown("Style and materials:", HOUSE_PALETTES.map((palette) => palette.name), { defaultValueIndex: 0 })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [paletteIndex, showGuide] = response.formValues;
    const plan = createHouseDesignPlan(player, design.key, Number(paletteIndex));
    if (!plan || !validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => executeBuildPlan(player, plan, `house_${design.key}`, `🏡 ${design.name} completed in the ${plan.palette} style!`, "dig.wood");
    if (showGuide) {
      startPreview(player, plan.bounds, "minecraft:villager_happy",
        `${design.name}\n${design.description}\nStyle: ${plan.palette}\n\nBuild this house here?`, confirm);
    } else {
      confirm();
    }
  }).catch((e) => console.error("House style menu error: " + e));
}

// ==========================================
// 🔷 SHAPES & BEACONS
// ==========================================

const SHAPE_BATCH_SIZE = 60;
const SHAPE_MAX_RADIUS = 25;

const SHAPE_TYPES = [
  {
    key: "sphere", name: "Sphere 🔮", label: "Sphere", description: "Ball resting on the ground",
    sizes: [{ key: "radius", label: "Radius (blocks):", min: 1, max: SHAPE_MAX_RADIUS, step: 1, defaultValue: 5 }],
    hollowLabel: "Hollow (empty inside, one-block shell)"
  },
  {
    key: "dome", name: "Dome ⛺", label: "Dome", description: "Half sphere, great as a glass greenhouse",
    sizes: [{ key: "radius", label: "Radius (blocks):", min: 1, max: SHAPE_MAX_RADIUS, step: 1, defaultValue: 6 }],
    hollowLabel: "Hollow (open inside, walk in underneath)"
  },
  {
    key: "pyramid", name: "Pyramid 🔺", label: "Pyramid", description: "Stepped pyramid with a pointed top",
    sizes: [{ key: "base", label: "Base width (blocks):", min: 3, max: 61, step: 2, defaultValue: 11 }],
    hollowLabel: "Hollow (empty inside)"
  },
  {
    key: "cylinder", name: "Cylinder / Tower 🗼", label: "Cylinder", description: "Round tower; height 1 makes a disc or ring",
    sizes: [
      { key: "radius", label: "Radius (blocks):", min: 1, max: SHAPE_MAX_RADIUS, step: 1, defaultValue: 4 },
      { key: "height", label: "Height (blocks):", min: 1, max: 50, step: 1, defaultValue: 6 }
    ],
    hollowLabel: "Hollow (walls only, open top and bottom)"
  },
  {
    key: "cone", name: "Cone 🍦", label: "Cone", description: "Round spire that tapers to a point",
    sizes: [
      { key: "radius", label: "Base radius (blocks):", min: 1, max: SHAPE_MAX_RADIUS, step: 1, defaultValue: 5 },
      { key: "height", label: "Height (blocks):", min: 2, max: 50, step: 1, defaultValue: 8 }
    ],
    hollowLabel: "Hollow (open inside)"
  }
];

// A shape is a stack of horizontal layers. Each layer is a circle (`r2` is its
// squared radius, including the half-block rounding margin) or a square
// (`h` is its half width). `size` orders layers of the same kind.
function circleLayer(radius) {
  if (radius < 0) return null;
  const r2 = (radius + 0.5) * (radius + 0.5);
  return { r2, size: r2 };
}

function squareLayer(half) {
  return half < 0 ? null : { h: half, size: half };
}

/** The same layer one block smaller all round, or null when nothing is left. */
function shrinkLayer(layer) {
  if (!layer) return null;
  if (layer.h !== undefined) return squareLayer(layer.h - 1);
  const r = Math.sqrt(layer.r2) - 1;
  return r < 0 ? null : { r2: r * r, size: r * r };
}

function smallerLayer(a, b) {
  if (!a || !b) return null;
  return a.size <= b.size ? a : b;
}

/** Half extent along z of the layer's row at offset dx from its centre, or -1 for none. */
function layerRowExtent(layer, dx) {
  if (layer.h !== undefined) return Math.abs(dx) <= layer.h ? layer.h : -1;
  const s = layer.r2 - dx * dx;
  return s < 0 ? -1 : Math.floor(Math.sqrt(s));
}

/**
 * Layer stack for a shape: `outer[y]` is the solid cross-section at local
 * height y, `half` the horizontal half size, and the open flags say which
 * ends stay open when the shape is hollow.
 */
function createShapeLayers(shapeKey, params) {
  const outer = [];
  let half = 0, openBottom = true, openTop = false;
  if (shapeKey === "sphere") {
    const radius = params.radius;
    half = radius;
    openBottom = false;
    for (let y = 0; y <= 2 * radius; y++) {
      const dy = y - radius;
      const r2 = (radius + 0.5) * (radius + 0.5) - dy * dy;
      outer.push(r2 < 0 ? null : { r2, size: r2 });
    }
  } else if (shapeKey === "dome") {
    const radius = params.radius;
    half = radius;
    for (let y = 0; y <= radius; y++) {
      const r2 = (radius + 0.5) * (radius + 0.5) - y * y;
      outer.push({ r2, size: r2 });
    }
  } else if (shapeKey === "pyramid") {
    const base = Math.min(61, params.base | 1);
    half = (base - 1) / 2;
    for (let y = 0; y <= half; y++) outer.push(squareLayer(half - y));
  } else if (shapeKey === "cylinder") {
    half = params.radius;
    openTop = true;
    for (let y = 0; y < params.height; y++) outer.push(circleLayer(params.radius));
  } else if (shapeKey === "cone") {
    const radius = params.radius, height = params.height;
    half = radius;
    for (let y = 0; y < height; y++) outer.push(circleLayer(radius * (1 - y / height)));
  } else {
    throw new Error(`Unknown shape ${shapeKey}`);
  }
  return { outer, half, openBottom, openTop };
}

/**
 * Cross-sections to leave empty for a hollow shape. A block is hollowed only
 * when it is one block in from its own layer and inside the layers above and
 * below, so every hollowed block has solid neighbours on all six sides and
 * the shell never has holes.
 */
function shapeInnerLayers(spec) {
  const OPEN = { size: Infinity };
  const { outer, openBottom, openTop } = spec;
  return outer.map((layer, y) => {
    if (!layer) return null;
    const below = y === 0 ? (openBottom ? OPEN : null) : outer[y - 1];
    const above = y === outer.length - 1 ? (openTop ? OPEN : null) : outer[y + 1];
    return smallerLayer(smallerLayer(shrinkLayer(layer), below), above);
  });
}

/** Merges single-row runs into the fewest fill commands (columns first, then slabs). */
function mergeRunsIntoFills(context, runs, blockId) {
  runs.sort((a, b) => a.x - b.x || a.z1 - b.z1 || a.z2 - b.z2 || a.y - b.y);
  const columns = [];
  for (const run of runs) {
    const last = columns[columns.length - 1];
    if (last && last.x1 === run.x && last.z1 === run.z1 && last.z2 === run.z2 && last.y2 === run.y - 1) last.y2 = run.y;
    else columns.push({ x1: run.x, x2: run.x, y1: run.y, y2: run.y, z1: run.z1, z2: run.z2 });
  }
  columns.sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2 || a.z1 - b.z1 || a.z2 - b.z2 || a.x1 - b.x1);
  const boxes = [];
  for (const box of columns) {
    const last = boxes[boxes.length - 1];
    if (last && last.y1 === box.y1 && last.y2 === box.y2 && last.z1 === box.z1 && last.z2 === box.z2 && last.x2 === box.x1 - 1) last.x2 = box.x2;
    else boxes.push(box);
  }
  const commands = [];
  for (const box of boxes) pushLargeFill(commands, context, box.x1, box.y1, box.z1, box.x2, box.y2, box.z2, blockId);
  return commands;
}

function createShapeCommands(context, spec, hollow, blockId) {
  const { outer, half } = spec;
  const inner = hollow ? shapeInnerLayers(spec) : outer.map(() => null);
  const runs = [];
  for (let y = 0; y < outer.length; y++) {
    const layer = outer[y];
    if (!layer) continue;
    for (let x = 0; x <= 2 * half; x++) {
      const dx = x - half;
      const extent = layerRowExtent(layer, dx);
      if (extent < 0) continue;
      const innerExtent = inner[y] ? layerRowExtent(inner[y], dx) : -1;
      if (innerExtent < 0) {
        runs.push({ x, y, z1: half - extent, z2: half + extent });
      } else if (innerExtent < extent) {
        runs.push({ x, y, z1: half - extent, z2: half - innerExtent - 1 });
        runs.push({ x, y, z1: half + innerExtent + 1, z2: half + extent });
      }
    }
  }
  return mergeRunsIntoFills(context, runs, blockId);
}

function describeShapeSize(shape, params) {
  return shape.sizes.map((size) => `${size.label.replace(/[:\s]+$/, "").replace(/ \(blocks\)/, "")} ${params[size.key]}`).join(", ");
}

function createShapePlan(player, shapeKey, params, blockId, hollow) {
  const shape = SHAPE_TYPES.find((s) => s.key === shapeKey);
  if (!shape) return null;
  const spec = createShapeLayers(shapeKey, params);
  const size = spec.half * 2 + 1;
  const c = createOrientedBuildContext(player, size, size, 0);
  const commands = createShapeCommands(c, spec, hollow, blockId);
  const plan = makePlan(player, `${hollow ? "Hollow " : ""}${shape.label}`, c, commands,
    localBounds(c, 0, 0, 0, size - 1, spec.outer.length - 1, size - 1));
  plan.batchSize = SHAPE_BATCH_SIZE;
  plan.summary = describeShapeSize(shape, params);
  plan.blockId = blockId;
  return plan;
}

const BEACON_BASE_MATERIALS = [
  { name: "Iron Blocks ⚔️", id: "minecraft:iron_block" },
  { name: "Gold Blocks 🪙", id: "minecraft:gold_block" },
  { name: "Emerald Blocks ❇️", id: "minecraft:emerald_block" },
  { name: "Diamond Blocks 💎", id: "minecraft:diamond_block" },
  { name: "Netherite Blocks 👑", id: "minecraft:netherite_block" },
  { name: "Rainbow Mix (different block each level) 🌈", id: null }
];
const BEACON_MIX_LAYERS = ["minecraft:iron_block", "minecraft:gold_block", "minecraft:emerald_block", "minecraft:diamond_block"];

const BEACON_BEAM_COLOURS = [
  { name: "Plain white beam", id: null },
  { name: "Red 🔴", id: "minecraft:red_stained_glass" },
  { name: "Orange 🟠", id: "minecraft:orange_stained_glass" },
  { name: "Yellow 🟡", id: "minecraft:yellow_stained_glass" },
  { name: "Lime 🟢", id: "minecraft:lime_stained_glass" },
  { name: "Green 🌲", id: "minecraft:green_stained_glass" },
  { name: "Light Blue 🩵", id: "minecraft:light_blue_stained_glass" },
  { name: "Blue 🔵", id: "minecraft:blue_stained_glass" },
  { name: "Purple 🟣", id: "minecraft:purple_stained_glass" },
  { name: "Magenta 💜", id: "minecraft:magenta_stained_glass" },
  { name: "Pink 🌸", id: "minecraft:pink_stained_glass" },
  { name: "Cyan 🧊", id: "minecraft:cyan_stained_glass" },
  { name: "Black ⚫", id: "minecraft:black_stained_glass" }
];

/** Highest block the beacon's sky column may clear in this dimension (keeps the Nether roof intact). */
function beaconSkyLimit(dimensionId) {
  const range = getBuildRangeForDimension(dimensionId);
  const isNether = String(dimensionId).replace(/^minecraft:/, "") === "nether";
  return isNether ? Math.min(range.max, NETHER_CEILING_SCAN_Y) : range.max;
}

function createBeaconPlan(player, levels, materialIndex, beamIndex, clearSky) {
  levels = clampNumber(Math.round(levels), 1, 4);
  const material = BEACON_BASE_MATERIALS[materialIndex] || BEACON_BASE_MATERIALS[0];
  const beam = BEACON_BEAM_COLOURS[beamIndex] || BEACON_BEAM_COLOURS[0];
  const size = 2 * levels + 1;
  const centre = levels;
  const c = createOrientedBuildContext(player, size, size, 0);
  const q = [];
  for (let level = 0; level < levels; level++) {
    const half = levels - level;
    const blockId = material.id || BEACON_MIX_LAYERS[level % BEACON_MIX_LAYERS.length];
    q.push(fillLocal(c, centre - half, level, centre - half, centre + half, level, centre + half, blockId));
  }
  q.push(setLocal(c, centre, levels, centre, "minecraft:beacon"));
  let top = levels;
  if (beam.id) {
    top += 1;
    q.push(setLocal(c, centre, top, centre, beam.id));
  }
  let skyTop = top;
  if (clearSky) {
    skyTop = Math.max(top, beaconSkyLimit(player.dimension.id) - c.baseY);
    if (skyTop > top) pushLargeFill(q, c, centre, top + 1, centre, centre, skyTop, centre, "minecraft:air");
  }
  const plan = makePlan(player, "Beacon", c, q, localBounds(c, 0, 0, 0, size - 1, skyTop, size - 1));
  plan.batchSize = SHAPE_BATCH_SIZE;
  plan.levels = levels;
  plan.material = material.name;
  plan.beam = beam.name;
  return plan;
}

function openShapeBuilderMenu(player) {
  const form = new ActionFormData()
    .title("🔷 Shapes & Beacons")
    .body("Pick a shape. It is placed in front of you, resting at the level of your feet:");
  for (const shape of SHAPE_TYPES) form.button(`${shape.name}\n§7${shape.description}`);
  form.button("✨ Beacon with Pyramid Base\n§7Working beacon on an iron, gold, emerald, diamond or netherite pyramid");
  form.button("⬅️ Back\n§7Return to Builder Tools");
  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection < SHAPE_TYPES.length) return openShapeOptionsMenu(player, SHAPE_TYPES[response.selection]);
    if (response.selection === SHAPE_TYPES.length) return openBeaconBuilderMenu(player);
    openBuilderToolsMenu(player);
  }).catch((e) => console.error("Shape menu error: " + e));
}

function openShapeOptionsMenu(player, shape) {
  const form = new ModalFormData()
    .title(`🔷 ${shape.name}`)
    .dropdown("Choose Block Type:", BLOCK_OPTIONS.map((b) => b.name), { defaultValueIndex: 0 })
    .textField("Or Custom Block ID (e.g. quartz_block):", "leave blank if choosing from list");
  for (const size of shape.sizes) form.slider(size.label, size.min, size.max, { valueStep: size.step, defaultValue: size.defaultValue });
  form.toggle(shape.hollowLabel, { defaultValue: false });
  form.toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const values = response.formValues;
    const blockId = resolveBlockChoice(values[0], values[1]);
    if (!blockId) {
      player.sendMessage("§cInvalid block ID. Use a value such as minecraft:quartz_block.§r");
      return;
    }
    const params = {};
    shape.sizes.forEach((size, i) => {
      params[size.key] = clampNumber(Math.round(Number(values[2 + i])), size.min, size.max);
    });
    const hollow = Boolean(values[2 + shape.sizes.length]);
    const showGuide = values[3 + shape.sizes.length];
    const plan = createShapePlan(player, shape.key, params, blockId, hollow);
    if (!plan || !validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => executeBuildPlan(player, plan, `shape_${shape.key}`, `🔷 ${plan.name} completed! (${plan.summary}, ${plan.commands.length} fills of ${blockId})`);
    if (showGuide) {
      startPreview(player, plan.bounds, "minecraft:villager_happy",
        `Build a ${plan.name.toLowerCase()} (${plan.summary}) with ${blockId}?`, confirm);
    } else {
      confirm();
    }
  }).catch((e) => console.error("Shape options error: " + e));
}

function openBeaconBuilderMenu(player) {
  const form = new ModalFormData()
    .title("✨ Beacon with Pyramid Base")
    .dropdown("Pyramid blocks:", BEACON_BASE_MATERIALS.map((m) => m.name), { defaultValueIndex: 0 })
    .slider("Pyramid levels (more levels = stronger beacon):", 1, 4, { valueStep: 1, defaultValue: 4 })
    .dropdown("Beam colour (stained glass on top):", BEACON_BEAM_COLOURS.map((b) => b.name), { defaultValueIndex: 0 })
    .toggle("Clear the sky straight above the beacon (needed for the beam)", { defaultValue: true })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [materialIndex, levels, beamIndex, clearSky, showGuide] = response.formValues;
    const plan = createBeaconPlan(player, Number(levels), Number(materialIndex), Number(beamIndex), Boolean(clearSky));
    if (!validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => executeBuildPlan(player, plan, "beacon",
      `✨ Beacon completed on a ${plan.levels}-level ${plan.material.replace(/ \S+$/, "")} pyramid! Tap it to choose its power.`, "random.levelup");
    const prompt = `Build a ${plan.levels}-level beacon pyramid (${plan.material}, ${plan.beam.toLowerCase()}) here?` +
      (clearSky ? "\n\nThe column straight above the beacon is cleared so its beam can reach the sky." : "\n\nThe beam only shows if nothing solid is above the beacon.");
    if (showGuide) startPreview(player, plan.bounds, "minecraft:villager_happy", prompt, confirm);
    else confirm();
  }).catch((e) => console.error("Beacon menu error: " + e));
}

// ==========================================
// 🏊 SWIMMING POOL
// ==========================================

const POOL_TILES = [
  { name: "Quartz (white) ⚪", id: "minecraft:quartz_block" },
  { name: "Prismarine (sea green) 🟩", id: "minecraft:prismarine" },
  { name: "Light Blue Concrete 🩵", id: "minecraft:light_blue_concrete" },
  { name: "Blue Concrete 🔵", id: "minecraft:blue_concrete" },
  { name: "Cyan Terracotta 🟦", id: "minecraft:cyan_terracotta" },
  { name: "Stone Bricks 🏛️", id: "minecraft:stone_bricks" }
];

const POOL_DECKS = [
  { name: "Smooth Stone 🧱", id: "minecraft:smooth_stone" },
  { name: "Oak Planks 🪵", id: "minecraft:oak_planks" },
  { name: "Smooth Quartz ⚪", id: "minecraft:smooth_quartz" },
  { name: "Sandstone 🏖️", id: "minecraft:sandstone" },
  { name: "Polished Andesite 🪨", id: "minecraft:polished_andesite" },
  { name: "No deck (keep the ground)", id: null }
];

/**
 * Pool sunk into the ground in front of the player. The water surface is
 * level with the ground, a tiled rim surrounds it and an optional one-block
 * deck surrounds the rim. Local y = 0 is ground level.
 */
function createPoolPlan(player, width, length, depth, tileId, deckId, lights, divingBoard) {
  width = clampNumber(Math.round(width), 1, 25);
  length = clampNumber(Math.round(length), 1, 25);
  depth = clampNumber(Math.round(depth), 1, 6);
  const totalWidth = width + 4, totalLength = length + 4;
  const x2 = totalWidth - 1, z2 = totalLength - 1;
  const c = createOrientedBuildContext(player, totalWidth, totalLength, -1);
  const q = [];
  pushLargeFill(q, c, 0, 1, 0, x2, 3, z2, "minecraft:air");
  if (deckId) q.push(fillLocal(c, 0, 0, 0, x2, 0, z2, deckId));
  q.push(fillLocal(c, 1, -depth, 1, x2 - 1, 0, z2 - 1, tileId));
  q.push(fillLocal(c, 2, 1 - depth, 2, x2 - 2, 0, z2 - 2, "minecraft:water"));
  if (lights) {
    const floorY = -depth;
    const spots = [[2, 2], [x2 - 2, 2], [2, z2 - 2], [x2 - 2, z2 - 2]];
    if (width >= 3 && length >= 3) spots.push([Math.floor(x2 / 2), Math.floor(z2 / 2)]);
    const seen = new Set();
    for (const [x, z] of spots) {
      const key = `${x},${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      q.push(setLocal(c, x, floorY, z, "minecraft:sea_lantern"));
    }
  }
  if (divingBoard && length >= 2) {
    const cx = Math.floor(x2 / 2);
    q.push(setLocal(c, cx, 1, 0, deckId || tileId));
    q.push(fillLocal(c, cx, 1, 1, cx, 1, 3, "minecraft:smooth_stone_slab"));
  }
  const plan = makePlan(player, "Swimming Pool", c, q, localBounds(c, 0, -depth, 0, x2, 3, z2));
  plan.batchSize = VILLAGE_BATCH_SIZE;
  plan.width = width;
  plan.length = length;
  plan.depth = depth;
  return plan;
}

function openPoolBuilderMenu(player) {
  const form = new ModalFormData()
    .title("🏊 Swimming Pool")
    .slider("Pool width (blocks of water):", 1, 25, { valueStep: 1, defaultValue: 6 })
    .slider("Pool length (blocks forward):", 1, 25, { valueStep: 1, defaultValue: 10 })
    .slider("Depth (blocks of water):", 1, 6, { valueStep: 1, defaultValue: 2 })
    .dropdown("Pool tiles:", POOL_TILES.map((t) => t.name), { defaultValueIndex: 0 })
    .dropdown("Deck around the pool:", POOL_DECKS.map((d) => d.name), { defaultValueIndex: 0 })
    .toggle("Underwater lights (sea lanterns in the floor)", { defaultValue: true })
    .toggle("Diving board at the near end", { defaultValue: true })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [width, length, depth, tileIndex, deckIndex, lights, divingBoard, showGuide] = response.formValues;
    const tile = POOL_TILES[tileIndex] || POOL_TILES[0];
    const deck = POOL_DECKS[deckIndex] || POOL_DECKS[0];
    const plan = createPoolPlan(player, width, length, depth, tile.id, deck.id, Boolean(lights), Boolean(divingBoard));
    if (!validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => executeBuildPlan(player, plan, "pool", `🏊 ${plan.width}×${plan.length} swimming pool completed! Dive in!`, "random.splash");
    const prompt = `Build a ${plan.width}×${plan.length} pool, ${plan.depth} deep, with ${tile.name} tiles` +
      `${deck.id ? ` and a ${deck.name} deck` : ""}?\n\nIt is sunk into the ground so the water is level with the surface.`;
    if (showGuide) startPreview(player, plan.bounds, "minecraft:villager_happy", prompt, confirm);
    else confirm();
  }).catch((e) => console.error("Pool menu error: " + e));
}

// ==========================================
// 🌊 DRAIN WATER & LAVA
// ==========================================

const DRAIN_WATER_BLOCKS = ["minecraft:water", "minecraft:flowing_water", "minecraft:bubble_column"];
const DRAIN_LAVA_BLOCKS = ["minecraft:lava", "minecraft:flowing_lava"];
const DRAIN_MAX_RADIUS = 25;

const DRAIN_CHOICES = [
  { name: "💧 Water only", blocks: DRAIN_WATER_BLOCKS, label: "water" },
  { name: "🔥 Lava only", blocks: DRAIN_LAVA_BLOCKS, label: "lava" },
  { name: "💧🔥 Water and lava", blocks: [...DRAIN_WATER_BLOCKS, ...DRAIN_LAVA_BLOCKS], label: "water and lava" }
];

/** Cube of `radius` blocks around the player, clamped to the dimension height. */
function createDrainPlan(player, radius, choiceIndex) {
  radius = clampNumber(Math.round(radius), 1, DRAIN_MAX_RADIUS);
  const choice = DRAIN_CHOICES[choiceIndex] || DRAIN_CHOICES[2];
  const loc = player.location;
  const px = Math.floor(loc.x), py = Math.floor(loc.y), pz = Math.floor(loc.z);
  const range = getDimensionBuildRange(player);
  const bounds = {
    x1: px - radius, x2: px + radius,
    y1: clampNumber(py - radius, range.min, range.max), y2: clampNumber(py + radius, range.min, range.max),
    z1: pz - radius, z2: pz + radius
  };
  const commands = [];
  for (const liquid of choice.blocks) pushLargeWorldFill(commands, bounds, "minecraft:air", `replace ${liquid}`);
  return {
    name: `${choice.label} drain`, dimensionId: player.dimension.id, commands, bounds,
    batchSize: 5, tolerateFailures: true, radius, label: choice.label
  };
}

function openDrainLiquidMenu(player) {
  const form = new ModalFormData()
    .title("🌊 Drain Water & Lava")
    .slider("Radius around you (blocks):", 3, DRAIN_MAX_RADIUS, { valueStep: 1, defaultValue: 10 })
    .dropdown("What to remove:", DRAIN_CHOICES.map((c) => c.name), { defaultValueIndex: 2 })
    .toggle("✨ Show 3D Glowing Preview Guide First", { defaultValue: true });
  form.show(player).then((response) => {
    if (response.canceled) return;
    const [radius, choiceIndex, showGuide] = response.formValues;
    const plan = createDrainPlan(player, Number(radius), Number(choiceIndex));
    if (!validateBuildBounds(player, plan.bounds)) return;
    const confirm = () => executeBuildPlan(player, plan, "drain",
      `🌊 Removed all ${plan.label} within ${plan.radius} blocks of you! Liquid outside that area may flow back in.`, "random.splash");
    const prompt = `Remove all ${plan.label} within ${plan.radius} blocks of you (the glowing box)?\n\nUse Undo Last Build to put it back.`;
    if (showGuide) startPreview(player, plan.bounds, "minecraft:wax_particle", prompt, confirm);
    else confirm();
  }).catch((e) => console.error("Drain menu error: " + e));
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
