# Tools

## Statues from 3D models and pictures

`model_to_structure.py` turns a 3D model (a photogrammetry scan, a Blender
model) or a picture into a colour-matched block statue. It writes a Bedrock
`.mcstructure` file to `Behavior_Pack/structures/helpertools_statues/` and adds
the statue to the `STATUES` list in `Behavior_Pack/scripts/main.js`, so it shows
up in the add-on's statue menu once the add-on is rebuilt. You can also place
it yourself with `/structure load helpertools_statues:<name> ~ ~ ~`.

You need Python 3.9 or newer with numpy and Pillow:

```bash
python3 -m pip install numpy pillow
```

### Quick start

```bash
# A 3D model, 48 blocks along its longest side
python3 tools/model_to_structure.py model scan.obj --size 48 --name my_bust --title "My Bust"

# A picture as a wall of pixel art, 64 blocks wide
python3 tools/model_to_structure.py image photo.png --size 64 --name holiday --dither

# See what you have, or remove a statue (file and menu entry)
python3 tools/model_to_structure.py --list
python3 tools/model_to_structure.py --remove my_bust
```

Then rebuild the add-on (see [After making a statue](#after-making-a-statue)).

Add `--preview preview.png` to any run to get a picture of the statue from the
front, the side and above. It is the quickest way to check the colours and the
way the statue faces before going into the game.

### From a photogrammetry scan

Meshroom, RealityCapture, Metashape, Polycam, Kiri and similar apps can all
export something the tool reads:

- **OBJ with a texture** (an `.obj`, an `.mtl` and one or more images). Keep
  the three together in one folder; the tool follows `mtllib` and `map_Kd` and
  samples the texture at the UVs.
- **OBJ or PLY with vertex colours** (`v x y z r g b` lines, or PLY
  `red`/`green`/`blue` properties). This is the simplest option if the app
  offers it.

Tips:

1. **Clean up first.** Crop away the ground, the turntable and any floating
   bits, otherwise they become part of the statue. MeshLab or Blender work
   well for this.
2. **Decimate.** A statue is at most 64 blocks across, so a 100 000 to 300 000
   triangle mesh carries all the detail you will see. Big meshes still work but
   load slowly, because OBJ is read line by line. In MeshLab use *Filters >
   Remeshing, Simplification and Reconstruction > Simplification: Quadric Edge
   Collapse Decimation (with texture)*; in Blender add a *Decimate* modifier.
   Texture images larger than 4096 pixels are shrunk automatically.
3. **Check the up axis.** If the statue comes out lying on its back or face,
   run it again with `--up z` (or without it). Use `--rotate 90` (or 180, 270)
   to turn the statue to face another way.
4. **Hollow or solid.** The default `--hollow` keeps only the blocks you can
   see, which is far fewer blocks and much quicker to place. `--solid` also
   fills the inside, which only makes a difference if you plan to dig into the
   statue. Scans are often open underneath; that is fine for a hollow statue,
   but there is nothing to fill for a solid one.
5. **Point clouds will not work.** The tool needs a surface made of triangles.
   Mesh a point cloud first (for example *Surface Reconstruction: Screened
   Poisson* in MeshLab).

### From Blender

1. If the colour comes from a node setup rather than a single image texture,
   bake it to an image texture (or to a colour attribute) first.
2. Apply any modifiers you want to keep, and decimate heavy meshes (see above).
3. Export with *File > Export > Wavefront (.obj)*. The default settings (Y up,
   forward -Z) suit the tool, so no `--up` option is needed. Tick *Materials*
   and set *Path Mode* to *Copy* so the textures are written next to the OBJ,
   or tick the colour attribute option to write vertex colours.
4. Or export *File > Export > Stanford PLY* with vertex colours. The PLY
   exporter keeps Blender's Z-up axis by default, so add `--up z`.

The side of the model that faces you in Blender's front view (the -Y side)
ends up facing south (+Z) in Minecraft.

### Pixel art from a picture

```bash
python3 tools/model_to_structure.py image sprite.png --size 32 --name sprite --title "Sprite"
python3 tools/model_to_structure.py image map.png --size 64 --flat --name floor_map
```

- `--vertical` (the default) stands the picture up as a wall one block thick.
  It reads correctly from the south side; from the north it is mirrored.
- `--flat` lays it on the ground with the top of the picture to the north.
- Transparent pixels become empty space, so sprites keep their outline.
- Small pixel art is enlarged with crisp, square pixels; large pictures are
  averaged down. Pictures with smooth gradients or photos look better with
  `--dither`.

### Options worth knowing

| Option | Meaning |
| --- | --- |
| `--size N` | Longest side in blocks, 1 to 64 (default 32). Small faces need about 32 or more to be recognisable. |
| `--name NAME` | Structure file name: lowercase letters, digits and `_`. Defaults to the input file name. |
| `--title TEXT` | Name shown in the game menu. Defaults to the input file name. |
| `--palette LIST` | Comma separated groups: `concrete`, `wool`, `terracotta` (the default is all three), `natural` (planks, stone, sandstone, quartz and so on), `mineral` (gold, iron, diamond blocks and so on) or `all`. Single blocks work too, for example `concrete,gold_block`. |
| `--no-register` | Only write the `.mcstructure`; leave `main.js` alone. |
| `--script PATH` | Register the statue in a different script file. |
| `--out-dir PATH` | Write the structure somewhere else. |

### How the colours are chosen

Each block of the statue takes the average colour of the part of the model
inside it (averaged in linear light). That colour is matched to the closest
block with the CIEDE2000 colour difference, which follows human colour
perception much better than plain RGB distance. Fully saturated colours are
outside what the blocks can show, so the matching gives hue a little more
weight than lightness: a pure red becomes red wool rather than orange concrete.

The block colours are built into the tool. They are the averages of Mojang's
vanilla textures, and `tools/compute_block_colours.py` regenerates them from
<https://github.com/Mojang/bedrock-samples> if the textures ever change.

### After making a statue

The game only sees the statue once the add-on is rebuilt:

```bash
node tests/regression.cjs                              # add-on tests
python3 -m unittest discover -s tools -p 'test_*.py'   # statue tool tests
bash build.sh                                          # rebuild dist/
```

Commit the new `.mcstructure`, the change to `main.js` and the rebuilt files in
`dist/` together. Statues are worth checking in a disposable world first,
since how a statue looks in the game is the one thing the tests cannot check.

### The sample rubber duck

`samples/make_rubber_duck.py` builds a small low-poly rubber duck with vertex
colours (`samples/rubber_duck.obj`). The statue the add-on ships was made with:

```bash
python3 tools/samples/make_rubber_duck.py
python3 tools/model_to_structure.py model tools/samples/rubber_duck.obj \
    --size 16 --name rubber_duck --title "Rubber Duck"
```

## Other tools

- `make_spawner_structures.cjs` writes the monster spawner structures used by
  the Spawner XP Farm (`node tools/make_spawner_structures.cjs`).
