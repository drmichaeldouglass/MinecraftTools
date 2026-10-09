const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const callbacks = [];
  const intervals = new Map();
  let nextIntervalId = 0;
  const clearedIntervals = [];
  const dimensions = new Map();
  const signal = { subscribe() {} };
  const world = {
    afterEvents: { playerSpawn: signal, playerLeave: signal }, beforeEvents: {},
    getAllPlayers: () => [], getDimension: id => dimensions.get(id.replace('minecraft:', ''))
  };
  const system = {
    afterEvents: { scriptEventReceive: signal }, runTimeout: fn => callbacks.push(fn),
    run: fn => callbacks.push(fn),
    runInterval: fn => { const id = ++nextIntervalId; intervals.set(id, fn); return id; },
    clearRun(id) { clearedIntervals.push(id); intervals.delete(id); }
  };
  const ctx = vm.createContext({ world, system, console, ItemStack: class {} });
  const source = fs.readFileSync(process.env.TOOLS_SOURCE || path.join(__dirname, '../Behavior_Pack/scripts/main.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), ctx);
  const dimension = {
    id: 'minecraft:overworld', runCommand: () => ({ successCount: 1 }),
    getTopmostBlock: () => undefined
  };
  dimensions.set('overworld', dimension);
  const player = {
    id: 'player1', dimension, location: { x: 0, y: 64, z: 0 }, isValid: () => true,
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }), messages: [], teleports: [],
    sendMessage(m) { this.messages.push(m); }, playSound() {}, addEffect() {},
    teleport(loc, options) { this.teleports.push({ loc, options }); },
    runCommand(command) { this.commands.push(command); return { successCount: 1 }; }, commands: []
  };
  async function tick() {
    await new Promise(resolve => setImmediate(resolve));
    for (const fn of callbacks.splice(0)) fn();
    await new Promise(resolve => setImmediate(resolve));
  }
  const evaluate = expression => vm.runInContext(expression, ctx);
  return { ctx, player, dimension, callbacks, tick, intervals, clearedIntervals, evaluate };
}

test('dig depth starts below the feet for all facings', () => {
  const { ctx, player } = harness();
  for (const dir of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    player.getViewDirection = () => dir;
    for (const depth of [1, 3, 25]) {
      const b = ctx.calculateBounds(player, 3, 5, depth, 'down');
      assert.equal(b.y2, 63); assert.equal(b.y1, 64 - depth);
      assert.equal((b.x2-b.x1+1)*(b.z2-b.z1+1), 15);
    }
  }
});

test('locate replies ignore trailing distance and preserve unknown Y', () => {
  const { ctx } = harness();
  const parsed = ctx.parseTeleportCoordinates('The nearest village is at block 1256, (y?), -648 (1432 blocks away)');
  assert.equal(parsed.x, 1256); assert.equal(parsed.z, -648); assert.equal(parsed.y, undefined);
  const xyz = ctx.parseTeleportCoordinates('The nearest city is at [1256, -51, -648] (1432 blocks away)');
  assert.equal(xyz.y, -51); assert.equal(xyz.z, -648);
});

test('coordinate command supports two or three numbers and rejects extra ones', () => {
  const { ctx } = harness();
  assert.equal(ctx.parseTeleportCoordinates('-20 30').z, 30);
  assert.equal(ctx.parseTeleportCoordinates('-20 64 30').y, 64);
  assert.equal(ctx.parseTeleportCoordinates('1 2 3 4'), null);
  assert.equal(ctx.parseTeleportCoordinates('1,2,3,4'), null);
  assert.equal(ctx.parseTeleportCoordinates('1..2 3'), null);
  assert.equal(ctx.parseTeleportCoordinates('nonsense'), null);
});

test('failed ticking area creation never teleports to an unchecked location', async () => {
  const { ctx, player, dimension, tick } = harness();
  dimension.runCommand = () => { throw new Error('ticking area limit'); };
  await ctx.teleportToCoordinates(player, {x:1000,z:2000});
  await tick();
  assert.equal(player.teleports.length, 0);
});

test('void destination retries, removes ticking area, and keeps player in place', async () => {
  const { ctx, player, dimension, tick } = harness();
  const commands = [];
  dimension.runCommand = cmd => { commands.push(cmd); };
  const trip = ctx.teleportToCoordinates(player, {x:1000,z:2000});
  for (let i = 0; i < 6; i++) await tick();
  await trip;
  assert.equal(player.teleports.length, 0);
  assert.equal(commands.filter(c => c.startsWith('tickingarea remove')).length, 1);
});

test('dimension change while loading cancels travel and cleans the ticking area', async () => {
  const { ctx, player, dimension, tick } = harness();
  const commands = [];
  dimension.runCommand = c => commands.push(c);
  const trip = ctx.teleportToCoordinates(player, {x:1000,z:2000});
  await new Promise(resolve => setImmediate(resolve));
  player.dimension = { id: 'minecraft:nether' };
  await tick(); await trip;
  assert.equal(player.teleports.length, 0);
  assert.ok(commands.some(c => c.startsWith('tickingarea remove')));
});

test('simultaneous trips cannot share or delete each other\'s loading area', async () => {
  const { ctx, player, dimension, tick } = harness();
  const commands = [];
  dimension.runCommand = c => commands.push(c);
  const first = ctx.teleportToCoordinates(player, {x:1000,z:2000});
  await ctx.teleportToCoordinates(player, {x:3000,z:4000});
  for (let i = 0; i < 6; i++) await tick();
  await first;
  assert.equal(commands.filter(c => c.startsWith('tickingarea add')).length, 1);
});

function solidColumn(dimension) {
  dimension.getTopmostBlock = () => ({location:{y:63}});
  dimension.getBlock = ({y}) => ({ isAir:y >= 64, typeId:y >=64 ? 'minecraft:air' : 'minecraft:stone' });
}

test('loaded safe ground lands once without creating a ticking area', async () => {
  const { ctx, player, dimension } = harness();
  solidColumn(dimension);
  dimension.runCommand = () => { throw new Error('should not need commands'); };
  await ctx.teleportToCoordinates(player, {x:1000,z:2000});
  assert.equal(player.teleports.length, 1);
  assert.equal(player.teleports[0].loc.y, 64);
});

test('loaded columns work without optional getTopmostBlock API', () => {
  const { ctx, dimension } = harness();
  solidColumn(dimension); delete dimension.getTopmostBlock;
  assert.equal(ctx.findStandableColumn(dimension, 0, 0, null).y, 64);
});

test('build and undo cannot overlap an unfinished build', async () => {
  const { ctx, player, dimension } = harness();
  const commands = [];
  dimension.runCommand = cmd => { commands.push(cmd); return {successCount:1}; };
  const b = {x1:0,y1:63,z1:1,x2:2,y2:63,z2:3};
  const first = ctx.executePlatform(player,b,3,'minecraft:glass');
  await ctx.executePlatform(player,b,3,'minecraft:stone');
  await ctx.executeUndo(player);
  await first;
  assert.equal(commands.filter(c=>c.startsWith('fill')).length,1);
  assert.ok(commands.every(c=>!c.startsWith('structure load')));
  await ctx.executeUndo(player);
  assert.equal(commands.filter(c=>c.startsWith('structure load')).length,1);
});

test('failed snapshot releases build lock and does not modify blocks', async () => {
  const { ctx, player, dimension } = harness();
  let attempts=0;
  dimension.runCommand = cmd => {
    assert.ok(cmd.startsWith('structure save')); attempts++; throw new Error('unloaded');
  };
  const b={x1:0,y1:63,z1:1,x2:2,y2:63,z2:3};
  await ctx.executePlatform(player,b,3,'minecraft:glass');
  await ctx.executePlatform(player,b,3,'minecraft:glass');
  assert.equal(attempts,2);
});

test('helper device has an always-usable trigger and remains a device after use', () => {
  const item = JSON.parse(fs.readFileSync(path.join(__dirname,'../Behavior_Pack/items/helper_device.json')));
  const food = item['minecraft:item'].components['minecraft:food'];
  assert.equal(food.can_always_eat,true);
  assert.equal(food.using_converts_to,'tools:helper_device');
});

test('script event parses actual locate text before teleporting', () => {
  const { ctx, player } = harness();
  let destination;
  ctx.teleportToCoordinates = (p, coords) => { destination = coords; };
  ctx.handleTeleportScriptEvent(player, 'The nearest village is at block 1256, (y?), -648 (1432 blocks away)');
  assert.equal(destination.x, 1256);
  assert.equal(destination.z, -648);
  assert.equal(destination.y, undefined);
});

test('teleport form reads X, optional Y and Z boxes', () => {
  const { ctx } = harness();
  const xz = ctx.coordinatesFromFormText('1256', '', '-648');
  assert.equal(xz.x, 1256); assert.equal(xz.z, -648); assert.equal(xz.y, undefined);
  assert.equal(ctx.coordinatesFromFormText('10', '(y?)', '20').y, undefined);
  assert.equal(ctx.coordinatesFromFormText('10', '-40', '20').y, -40);
  assert.equal(ctx.coordinatesFromFormText('The nearest village is at block 5, (y?), 6', '', '').z, 6);
  assert.equal(ctx.coordinatesFromFormText('10', '', ''), null);
});

test('biome finder searches the whole dimension height and offers a direct teleport', async () => {
  const { ctx, player, dimension, tick } = harness();
  const searches = [];
  const properties = {};
  dimension.calculateClosestBiomeFromSeed = (pos, id, options) => { searches.push({ pos, id, options }); return { x: 300.7, y: 64, z: -400.2 }; };
  player.setDynamicProperty = (k, v) => { properties[k] = v; };
  let body, buttons = [];
  ctx.ActionFormData = class {
    title() { return this; } button(label) { buttons.push(label); return this; }
    body(text) { body = text; return this; }
    show() { return new Promise(() => {}); }
  };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  await tick();
  assert.equal(searches.length, 1);
  assert.equal(searches[0].id, 'minecraft:plains');
  assert.equal(searches[0].options.boundingSize.x, 1024);
  assert.ok(searches[0].options.boundingSize.y >= 384, 'vertical search covers the overworld height');
  assert.equal(searches[0].pos.y, (319 - 64) / 2);
  assert.match(body, /X 300 +Z -401/);
  assert.ok(buttons[0].includes('Teleport There Now'));
  assert.ok(player.messages.some(m => m.includes('X 300, Z -401') && m.includes('501 blocks')));
  assert.equal(properties.last_found_location, 'Plains: X 300, Z -401');
  assert.equal(player.teleports.length, 0);
});

test('biome result window teleports straight to the found coordinates', async () => {
  const { ctx, player, dimension, tick } = harness();
  dimension.calculateClosestBiomeFromSeed = () => ({ x: 300.7, y: -20, z: -400.2 });
  player.setDynamicProperty = () => {};
  let destination;
  ctx.teleportToCoordinates = (p, coords) => { destination = coords; };
  ctx.ActionFormData = class {
    title() { return this; } button() { return this; } body() { return this; }
    show() { return Promise.resolve({ canceled: false, selection: 0 }); }
  };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  await tick();
  assert.equal(JSON.stringify(destination), JSON.stringify({ x: 300, z: -401 }));
  ctx.showNearestBiome(player, { name: 'Lush Caves', id: 'minecraft:lush_caves', underground: true });
  await tick();
  assert.equal(JSON.stringify(destination), JSON.stringify({ x: 300, z: -401, y: -20 }));
});

test('biome finder widens the search before giving up', async () => {
  const { ctx, player, dimension, tick } = harness();
  const sizes = [];
  dimension.calculateClosestBiomeFromSeed = (pos, id, options) => { sizes.push(options.boundingSize.x); return undefined; };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(sizes, [1024, 4096, 8192]);
  assert.ok(player.messages.some(m => m.includes('No Plains') && m.includes('8192')));
  assert.equal(player.teleports.length, 0);
});

test('biome finder reports API errors instead of failing silently', async () => {
  const { ctx, player, dimension, tick } = harness();
  dimension.calculateClosestBiomeFromSeed = () => { throw new Error('boom'); };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  await tick();
  assert.ok(player.messages.some(m => m.includes('Could not search for Plains') && m.includes('boom')));
});

test('structure finder gives the locate command and runs it as the player', async () => {
  const { ctx, player, tick } = harness();
  const properties = {};
  player.setDynamicProperty = (k, v) => { properties[k] = v; };
  ctx.showStructureLocateCommand(player, { name: 'Village', id: 'minecraft:village' });
  await tick();
  assert.deepEqual(player.commands, ['locate structure minecraft:village']);
  assert.ok(player.messages.some(m => m.includes('/locate structure minecraft:village')));
  assert.ok(player.messages.some(m => m.includes('Cheats')));
  assert.ok(properties.last_found_location.startsWith('Village:'));
  assert.equal(player.teleports.length, 0);
  player.runCommand = () => { throw new Error('No structure found'); };
  ctx.showStructureLocateCommand(player, { name: 'Village', id: 'minecraft:village' });
  await tick();
  assert.ok(player.messages.some(m => m.includes('could not find a Village') && m.includes('No structure found')));
});

test('coordinate boxes reject malformed values instead of extracting unrelated digits', () => {
  const { ctx } = harness();
  for (const args of [
    ['1..2', '', '3'], ['10abc', '', '20'], ['10', '64 70', '20'],
    ['10', 'bad Y', '20'], ['10', '', '20abc'], ['10', '', '2..3'],
    ['1 2 3', '64', '20'], ['9'.repeat(400), '', '20']
  ]) assert.equal(ctx.coordinatesFromFormText(...args), null, args.join(' / '));
  assert.equal(ctx.parseTeleportCoordinates(`1 ${'9'.repeat(400)} 2`),null);
  assert.equal(ctx.coordinatesFromFormText(`Nearest place at 1, ${'9'.repeat(400)}, 2`, '', ''),null);
  assert.equal(ctx.coordinatesFromFormText('+10', '-40.5', '-20').y, -40.5);
  assert.equal(ctx.coordinatesFromFormText('10', ' (y?) ', '20').y, undefined);
});

function previewForms(ctx) {
  const pending = [];
  ctx.MessageFormData = class {
    title() { return this; } body() { return this; }
    button1() { return this; } button2() { return this; }
    show() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); }
  };
  return pending;
}
const previewBounds = { x1:0, y1:64, z1:1, x2:2, y2:66, z2:3 };

test('a superseded preview cannot execute or clear the replacement preview', async () => {
  const { ctx, player, tick, intervals } = harness();
  const pending = previewForms(ctx);
  let oldBuilds = 0, newBuilds = 0;
  ctx.startPreview(player, previewBounds, 'particle', 'Old', () => oldBuilds++);
  await tick();
  ctx.startPreview(player, previewBounds, 'particle', 'New', () => newBuilds++);
  await tick();
  pending[0].resolve({ canceled:false, selection:0 });
  await tick();
  assert.equal(oldBuilds, 0);
  assert.equal(intervals.size, 1);
  pending[1].resolve({ canceled:false, selection:0 });
  await tick();
  assert.equal(newBuilds, 1);
  assert.equal(intervals.size, 0);
});

test('rejected preview clears its ticker, and a delayed obsolete preview never opens', async () => {
  const { ctx, player, tick, intervals } = harness();
  const pending = previewForms(ctx);
  ctx.startPreview(player, previewBounds, 'particle', 'Old', () => assert.fail('obsolete build'));
  ctx.startPreview(player, previewBounds, 'particle', 'New', () => {});
  await tick();
  assert.equal(pending.length, 1);
  const originalError = console.error;
  console.error = () => {};
  try { pending[0].reject(new Error('form unavailable')); await tick(); }
  finally { console.error = originalError; }
  assert.equal(intervals.size, 0);
});

test('preview confirmation remains usable after its drawing expires', async () => {
  const { ctx, player, tick, intervals } = harness();
  const pending = previewForms(ctx);
  let builds = 0;
  ctx.startPreview(player, previewBounds, 'particle', 'Build', () => builds++);
  await tick();
  const ticker = [...intervals.values()][0];
  for (let i = 0; i < 61; i++) ticker();
  assert.equal(intervals.size, 0);
  pending[0].resolve({ canceled:false, selection:0 });
  await tick();
  assert.equal(builds, 1);
});

function blockWorld(dimension) {
  const blocks = new Map();
  const states = new Map();
  dimension.getBlock = ({x,y,z}) => {
    const key = `${x},${y},${z}`;
    const typeId = blocks.get(key) || (y < 64 ? 'minecraft:stone' : 'minecraft:air');
    const blockStates = states.get(key) || {};
    return { typeId, isAir:typeId === 'minecraft:air', permutation:{ getState: name => blockStates[name] } };
  };
  dimension.runCommand = command => {
    const p = command.split(/\s+/);
    if (p[0] !== 'fill' && p[0] !== 'setblock') return { successCount:1 };
    const fill = p[0] === 'fill';
    const [x1,y1,z1] = p.slice(1,4).map(Number);
    const [x2,y2,z2] = fill ? p.slice(4,7).map(Number) : [x1,y1,z1];
    let index = fill ? 7 : 4;
    const typeId = p[index++];
    let blockStates = {};
    if (p[index] && p[index].startsWith('[')) blockStates = JSON.parse('{' + p[index++].slice(1,-1).replace(/=/g, ':') + '}');
    const mode = p[index] || 'replace';
    let changed = 0;
    for(let x=x1;x<=x2;x++) for(let y=y1;y<=y2;y++) for(let z=z1;z<=z2;z++) {
      const key = `${x},${y},${z}`;
      const current = dimension.getBlock({x,y,z});
      if (mode === 'keep' && !current.isAir) continue;
      const sameStates = JSON.stringify(states.get(key) || {}) === JSON.stringify(blockStates);
      if(current.typeId !== typeId || !sameStates) {
        blocks.set(key,typeId); states.set(key, blockStates); changed++;
      }
    }
    if (!changed) throw new Error('No blocks changed');
    return { successCount:changed };
  };
  return { blocks, states };
}

test('all base templates and staircases finish despite already-empty air and duplicate placements', async () => {
  for (const facing of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    for (const key of ['simple_house','large_house','fort','tree_house','bunker','stairs_up','stairs_down']) {
      const { ctx, player, dimension } = harness();
      player.getViewDirection = () => facing;
      blockWorld(dimension);
      const plan = key.startsWith('stairs')
        ? ctx.createStairPlan(player,3,8,'minecraft:stone_bricks',key.endsWith('up')?'up':'down',true)
        : ctx.createBaseTemplatePlan(player,key);
      await ctx.executeBuildPlan(player,plan,key,'Completed');
      assert.ok(player.messages.some(m=>m.includes('Completed')), key);
      assert.ok(!player.messages.some(m=>m.includes('command failed')), key);
      await ctx.executeUndo(player);
      assert.ok(player.messages.some(m=>m.includes('Undid')), key);
    }
  }
});

test('flattening already-clear ground still places its new floor', async () => {
  const { ctx, player, dimension } = harness();
  blockWorld(dimension);
  const b = { x1:-5,y1:63,z1:-5,x2:5,y2:74,z2:5 };
  await ctx.executeLevelGround(player,b,5,'minecraft:grass_block');
  assert.equal(dimension.getBlock({x:0,y:63,z:0}).typeId,'minecraft:grass_block');
  assert.ok(player.messages.some(m=>m.includes('Land flattened')));
});

test('real block-command failures still stop a build and preserve its undo', async () => {
  const { ctx, player, dimension } = harness();
  dimension.getBlock = () => ({ typeId:'minecraft:air',isAir:true });
  const commands = [];
  dimension.runCommand = c => {
    commands.push(c);
    if(c.startsWith('fill')) throw new Error('invalid block');
    return { successCount:1 };
  };
  const plan = { name:'test',dimensionId:dimension.id,bounds:previewBounds,
    commands:['fill 0 64 1 2 66 3 minecraft:missing','setblock 0 64 1 minecraft:stone'] };
  await ctx.executeBuildPlan(player,plan,'test','Completed');
  assert.ok(player.messages.some(m=>m.includes('command failed')));
  assert.ok(!commands.some(c=>c.startsWith('setblock')));
  await ctx.executeUndo(player);
  assert.ok(commands.some(c=>c.startsWith('structure load')));
  dimension.getBlock = () => { throw new Error('unloaded'); };
  await assert.rejects(ctx.runBlockCommand(dimension,'fill 0 64 1 2 66 3 minecraft:air'),/invalid block/);
});


test('dimension changes and disconnects invalidate a pending preview confirmation', async () => {
  for (const disconnect of [false, true]) {
    const { ctx, player, tick, intervals } = harness();
    const pending = previewForms(ctx);
    ctx.startPreview(player, previewBounds, 'particle', 'Build', () => assert.fail('stale build'));
    await tick();
    if (disconnect) player.isValid = false;
    else player.dimension = { id:'minecraft:nether' };
    pending[0].resolve({ canceled:false, selection:0 });
    await tick();
    assert.equal(intervals.size, 0);
  }
});

test('no-op checks respect hollow interiors, outline shells and unavailable blocks', () => {
  const { ctx, dimension } = harness();
  dimension.getBlock = ({x,y,z}) => ({typeId: x===1 && y===65 && z===1 ? 'minecraft:dirt' : 'minecraft:stone'});
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:stone outline'),true);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:stone hollow'),false);
  dimension.getBlock = ({x,y,z}) => ({typeId: x===1 && y===65 && z===1 ? 'minecraft:air' : 'minecraft:stone'});
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:stone hollow'),true);
  dimension.getBlock = () => undefined;
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:air'),false);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 2 66 2 0 64 0 minecraft:air'),false);
});

async function settle(promise, tick) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 1000 && !done; i++) await tick();
  return promise;
}

test('block commands with states and keep mode are parsed and verified', () => {
  const { ctx, dimension } = harness();
  const parsed = ctx.parseBlockCommand('setblock 1 64 2 minecraft:bed ["direction"=2,"head_piece_bit"=true]');
  assert.equal(parsed.blockId, 'minecraft:bed');
  assert.equal(JSON.stringify(parsed.states), JSON.stringify({ direction:'2', head_piece_bit:'true' }));
  assert.equal(parsed.mode, 'replace');
  assert.equal(ctx.parseBlockCommand('fill 0 64 0 2 64 2 minecraft:dirt keep').mode, 'keep');
  assert.equal(ctx.parseBlockCommand('fill 0 64 0 2 64 2 minecraft:dirt ["bad state"] keep'), null);
  assert.equal(ctx.parseBlockCommand('setblock 1 64 2 minecraft:bed ["direction"=2] replace extra'), null);
  blockWorld(dimension);
  dimension.runCommand('setblock 1 64 2 minecraft:bed ["direction"=2,"head_piece_bit"=true]');
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'setblock 1 64 2 minecraft:bed ["direction"=2,"head_piece_bit"=true]'), true);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'setblock 1 64 2 minecraft:bed ["direction"=0,"head_piece_bit"=true]'), false);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 60 0 2 63 2 minecraft:dirt keep'), true);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 60 0 2 64 2 minecraft:dirt keep'), false);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 63 0 2 63 2 minecraft:stone'), true);
});

test('village fits a single undo snapshot and every command stays inside its bounds and the fill limit', () => {
  const { ctx, player, evaluate } = harness();
  const size = evaluate('VILLAGE_SIZE');
  const paletteCount = evaluate('VILLAGE_PALETTES.length');
  assert.ok(size <= 64, 'structure save allows at most 64 blocks a side');
  for (const facing of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    player.getViewDirection = () => facing;
    for (let palette = 0; palette < paletteCount; palette++) {
      const plan = ctx.createVillagePlan(player, palette, true);
      const b = plan.bounds;
      assert.ok(b.x2 - b.x1 + 1 <= 64 && b.z2 - b.z1 + 1 <= 64 && b.y2 - b.y1 + 1 <= 384);
      assert.ok(plan.commands.length > 500, 'village has many commands');
      for (const command of plan.commands) {
        const c = ctx.parseBlockCommand(command);
        assert.ok(c, `unparseable command: ${command}`);
        assert.ok(c.x1 >= b.x1 && c.x2 <= b.x2 && c.y1 >= b.y1 && c.y2 <= b.y2 && c.z1 >= b.z1 && c.z2 <= b.z2, `outside bounds: ${command}`);
        assert.ok((c.x2-c.x1+1)*(c.y2-c.y1+1)*(c.z2-c.z1+1) <= 32768, `too large: ${command}`);
      }
    }
  }
  const footprint = ctx.createVillagePlan(player, 0, true).bounds;
  assert.equal(footprint.x2 - footprint.x1 + 1, size);
  assert.equal(footprint.z2 - footprint.z1 + 1, size);
});

test('village builds and undoes in all four facings, spreading commands over several ticks', async () => {
  for (const facing of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    const { ctx, player, dimension, tick, callbacks, evaluate } = harness();
    player.getViewDirection = () => facing;
    const { blocks } = blockWorld(dimension);
    const batchSize = evaluate('VILLAGE_BATCH_SIZE');
    const plan = ctx.createVillagePlan(player, 0, true);
    let yields = 0;
    const originalRun = ctx.system.run;
    ctx.system.run = fn => { yields++; callbacks.push(fn); };
    await settle(ctx.executeBuildPlan(player, plan, 'village', 'Village done'), tick);
    ctx.system.run = originalRun;
    assert.ok(player.messages.some(m => m.includes('Village done')), player.messages.join('\n'));
    assert.ok(!player.messages.some(m => m.includes('command failed')));
    assert.ok(yields >= Math.floor(plan.commands.length / batchSize) - 1, 'build yields between batches');
    const placed = new Set(blocks.values());
    for (const needed of ['minecraft:bed', 'minecraft:dark_oak_door', 'minecraft:wheat', 'minecraft:water', 'minecraft:sea_lantern', 'minecraft:gray_concrete', 'minecraft:bell']) {
      assert.ok(placed.has(needed), `${needed} placed`);
    }
    const first = ctx.parseBlockCommand(plan.commands[0]);
    assert.equal(first.blockId, 'minecraft:air');
    await ctx.executeUndo(player);
    assert.ok(player.messages.some(m => m.includes('Undid')));
  }
});

test('village without ground preparation leaves the terrain alone and still undoes', async () => {
  const { ctx, player, dimension, tick, evaluate } = harness();
  blockWorld(dimension);
  const size = evaluate('VILLAGE_SIZE');
  const prepared = ctx.createVillagePlan(player, 1, true);
  const coversVillage = c => { const b = ctx.parseBlockCommand(c); return b.x2 - b.x1 + 1 === size && b.z2 - b.z1 + 1 === size; };
  assert.ok(prepared.commands.some(c => c.endsWith(' keep')));
  assert.ok(prepared.commands.some(c => c.endsWith('minecraft:air') && coversVillage(c)));
  const plan = ctx.createVillagePlan(player, 1, false);
  assert.ok(!plan.commands.some(c => c.endsWith(' keep')));
  assert.ok(!plan.commands.some(coversVillage));
  await settle(ctx.executeBuildPlan(player, plan, 'village', 'Village done'), tick);
  assert.ok(player.messages.some(m => m.includes('Village done')));
  await ctx.executeUndo(player);
  assert.ok(player.messages.some(m => m.includes('Undid')));
});

test('a village can be rebuilt on top of itself without stopping on already-placed blocks', async () => {
  const { ctx, player, dimension, tick } = harness();
  blockWorld(dimension);
  for (let i = 0; i < 2; i++) {
    player.messages.length = 0;
    await settle(ctx.executeBuildPlan(player, ctx.createVillagePlan(player, 2, true), 'village', 'Village done'), tick);
    assert.ok(player.messages.some(m => m.includes('Village done')), `build ${i}: ` + player.messages.join('\n'));
  }
});
