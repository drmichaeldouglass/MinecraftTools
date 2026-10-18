#!/usr/bin/env python3
"""Recompute the average block colours used by ``model_to_structure.py``.

``model_to_structure.py`` ships a hard-coded table (``BLOCK_COLOURS``) so it
works offline. This helper regenerates that table from the official vanilla
resource pack published by Mojang at
https://github.com/Mojang/bedrock-samples and prints it as Python source that
can be pasted over the old table.

How a colour is computed:

1. The block's face textures are looked up in ``resource_pack/blocks.json``
   (a single texture, or separate ``up``/``down``/``side`` or per-direction
   textures) and resolved to image files through
   ``resource_pack/textures/terrain_texture.json``.
2. Each face texture is averaged over its opaque pixels in *linear light*
   (sRGB decoded, averaged, re-encoded), which is what the eye sees when a
   block is far enough away that the texture detail blurs together.
3. The six faces (up, down, north, south, east, west) are averaged with equal
   weight, so side textures count for two thirds of the result.

Usage::

    python3 tools/compute_block_colours.py            # print the table
    python3 tools/compute_block_colours.py --cache DIR  # keep downloads

Only the standard library, numpy and Pillow are needed.
"""

import argparse
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model_to_structure import PALETTE_GROUPS, linear_to_srgb, srgb_to_linear  # noqa: E402

BASE_URL = "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/"
FACES = ("up", "down", "north", "south", "east", "west")


def fetch(path, cache_dir):
    """Download ``BASE_URL + path``, optionally caching it on disk."""
    if cache_dir:
        local = os.path.join(cache_dir, path.replace("/", "__"))
        if os.path.exists(local):
            with open(local, "rb") as handle:
                return handle.read()
    with urllib.request.urlopen(BASE_URL + path, timeout=60) as response:
        data = response.read()
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        with open(local, "wb") as handle:
            handle.write(data)
    return data


def load_commented_json(data):
    """Parse JSON that may contain ``//`` line comments (Mojang's files do)."""
    text = data.decode("utf-8-sig")
    text = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
    return json.loads(text)


def face_textures(entry):
    """Map each of the six faces to a terrain texture short name."""
    textures = entry["textures"]
    if isinstance(textures, str):
        return {face: textures for face in FACES}
    side = textures.get("side")
    return {face: textures.get(face, side) for face in FACES}


def texture_path(terrain, short_name):
    """Resolve a terrain texture short name to a path inside the pack."""
    value = terrain[short_name]["textures"]
    if isinstance(value, list):  # random variations: use the first one
        value = value[0]
    if isinstance(value, dict):
        value = value["path"]
    return value


def average_texture(data):
    """Average an image's opaque pixels in linear light, returning linear RGB."""
    image = Image.open(io.BytesIO(data)).convert("RGBA")
    pixels = np.asarray(image, dtype=np.float64) / 255.0
    opaque = pixels[..., 3] > 0.5
    rgb = pixels[..., :3][opaque] if opaque.any() else pixels[..., :3].reshape(-1, 3)
    return srgb_to_linear(rgb).mean(axis=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--cache", help="directory to cache downloaded files in")
    args = parser.parse_args()

    blocks = load_commented_json(fetch("resource_pack/blocks.json", args.cache))
    terrain = load_commented_json(
        fetch("resource_pack/textures/terrain_texture.json", args.cache))["texture_data"]

    texture_cache = {}
    print("BLOCK_COLOURS = {")
    for group, ids in PALETTE_GROUPS.items():
        print(f"    # {group}")
        for block_id in ids:
            faces = face_textures(blocks[block_id.split(":", 1)[1]])
            colours = []
            for face in FACES:
                path = texture_path(terrain, faces[face])
                if path not in texture_cache:
                    for extension in (".png", ".tga"):
                        try:
                            texture_cache[path] = average_texture(
                                fetch(f"resource_pack/{path}{extension}", args.cache))
                            break
                        except urllib.error.HTTPError:  # try the next extension
                            continue
                    else:
                        raise RuntimeError(f"could not download texture {path}")
                colours.append(texture_cache[path])
            srgb = linear_to_srgb(np.mean(colours, axis=0))
            r, g, b = (int(round(c * 255)) for c in srgb)
            print(f'    "{block_id}": ({r}, {g}, {b}),')
    print("}")


if __name__ == "__main__":
    main()
