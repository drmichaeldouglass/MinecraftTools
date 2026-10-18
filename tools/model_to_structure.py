#!/usr/bin/env python3
"""Turn a 3D model or a picture into a colour-matched Minecraft Bedrock statue.

The result is a ``.mcstructure`` file in
``Behavior_Pack/structures/helpertools_statues/`` which the Helper Tools
add-on (or ``/structure load helpertools_statues:<name> ~ ~ ~``) can place in
the world.

Two kinds of input are supported:

``model``
    A triangle mesh (OBJ or PLY), for example a photogrammetry scan from
    Meshroom, RealityCapture or Polycam, or an export from Blender. Colours
    come from, in order of preference, a ``map_Kd`` texture sampled at the UVs,
    per-vertex colours, the material ``Kd`` colour, or light grey.

``image``
    A picture (PNG, JPEG, ...) turned into pixel art, either standing up as a
    wall or lying flat on the ground.

Pipeline for models:

1. Load the mesh and turn it so +Y is up (``--up z`` for Blender style Z-up
   exports) and optionally spin it about the vertical axis (``--rotate``).
2. Scale it so its longest side is ``--size`` blocks and drop it so its lowest
   point is at y = 0.
3. Sample every triangle densely (well under one block apart) and mark each
   block a sample lands in, averaging the sampled colours in linear light.
4. Flood fill the air from outside the model. A hollow statue (the default)
   keeps only the blocks that touch outside air, a solid one also fills
   everything the outside air cannot reach.
5. Match each block's colour to the nearest Bedrock block using the CIEDE2000
   colour difference in CIELAB space.
6. Write the little-endian NBT ``.mcstructure`` and (optionally) register the
   statue in the add-on script so the in-game menu can offer it.

Only the Python standard library, numpy and Pillow are required.

Examples::

    python3 tools/model_to_structure.py model scan.obj --size 48 --name my_bust
    python3 tools/model_to_structure.py model blender.ply --up z --solid
    python3 tools/model_to_structure.py image sprite.png --size 32 --name sprite
    python3 tools/model_to_structure.py --list
    python3 tools/model_to_structure.py --remove my_bust
"""

import argparse
import json
import os
import re
import struct
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# Paths and constants
# --------------------------------------------------------------------------

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMESPACE = "helpertools_statues"
DEFAULT_OUT_DIR = os.path.join(REPO_ROOT, "Behavior_Pack", "structures", NAMESPACE)
DEFAULT_SCRIPT = os.path.join(REPO_ROOT, "Behavior_Pack", "scripts", "main.js")

#: Largest statue edge in blocks. Structure blocks cap structures at 64 blocks
#: wide and long, so we keep every side (height included) within that.
MAX_SIZE = 64

#: Block palette version 1.21.40, matching tools/make_spawner_structures.cjs.
#: Newer versions of the game upgrade older palette entries when loading.
BLOCK_VERSION = (1 << 24) | (21 << 16) | (40 << 8)

#: Colour used when a model has no colour information at all.
FALLBACK_COLOUR = (0.78, 0.78, 0.78)

#: CIEDE2000 lightness factor used for matching. Blocks cannot reach fully
#: saturated colours, and with the reference value 1 a pure red model would
#: turn into orange concrete because orange is closer in lightness. The value
#: 2 (as used for textiles) favours keeping the hue, which looks right on
#: statues and pixel art.
MATCH_K_L = 2.0

#: Distance between surface samples, in blocks. Anything comfortably below
#: 0.5 keeps the voxel shell free of gaps that air could leak through.
SAMPLE_SPACING = 0.3

REGION_BEGIN = "// @generated statues begin (tools/model_to_structure.py)"
REGION_END = "// @generated statues end"

# --------------------------------------------------------------------------
# Block palette
# --------------------------------------------------------------------------

_DYES = ("white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
         "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black")

#: Palette groups selectable with ``--palette``. Every block is a full,
#: opaque cube with no block states (or the default state given in
#: BLOCK_STATES), and none of them fall, melt, spread or oxidise. Bedrock
#: identifiers differ from Java ones (plain terracotta is "hardened_clay").
PALETTE_GROUPS: Dict[str, List[str]] = {
    "concrete": [f"minecraft:{dye}_concrete" for dye in _DYES],
    "wool": [f"minecraft:{dye}_wool" for dye in _DYES],
    "terracotta": ["minecraft:hardened_clay"] + [f"minecraft:{dye}_terracotta" for dye in _DYES],
    "natural": ["minecraft:" + name for name in (
        "oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks",
        "dark_oak_planks", "mangrove_planks", "cherry_planks", "crimson_planks",
        "warped_planks", "stone", "cobblestone", "smooth_stone", "stone_bricks", "granite",
        "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite",
        "deepslate", "cobbled_deepslate", "polished_deepslate", "deepslate_bricks", "tuff",
        "calcite", "sandstone", "smooth_sandstone", "red_sandstone", "smooth_red_sandstone",
        "quartz_block", "quartz_bricks", "brick_block", "mud_bricks", "packed_mud", "clay",
        "snow", "obsidian", "blackstone", "polished_blackstone", "netherrack",
        "nether_brick", "red_nether_brick", "end_stone", "prismarine", "dark_prismarine",
        "moss_block")],
    "mineral": ["minecraft:" + name for name in (
        "gold_block", "iron_block", "diamond_block", "emerald_block", "lapis_block",
        "coal_block", "amethyst_block", "raw_iron_block", "raw_copper_block",
        "raw_gold_block")],
}

DEFAULT_PALETTE = "concrete,wool,terracotta"

#: Block states for palette blocks that have any (their default state).
BLOCK_STATES: Dict[str, Dict[str, str]] = {
    "minecraft:deepslate": {"pillar_axis": "y"},
    "minecraft:quartz_block": {"pillar_axis": "y"},
}

# Average sRGB colour of every palette block.
#
# Generated by tools/compute_block_colours.py from Mojang's vanilla resource
# pack (https://github.com/Mojang/bedrock-samples, resource_pack/blocks.json,
# textures/terrain_texture.json and textures/blocks/*.png). Each face texture
# is averaged over its opaque pixels in linear light, then the six faces are
# averaged with equal weight. Block names were checked against
# metadata/vanilladata_modules/mojang-blocks.json in the same repository.
# Re-run that script after a texture update and paste its output here.
BLOCK_COLOURS: Dict[str, Tuple[int, int, int]] = {
    # concrete
    "minecraft:white_concrete": (207, 213, 214),
    "minecraft:orange_concrete": (224, 97, 1),
    "minecraft:magenta_concrete": (169, 48, 159),
    "minecraft:light_blue_concrete": (36, 137, 199),
    "minecraft:yellow_concrete": (241, 175, 21),
    "minecraft:lime_concrete": (94, 169, 25),
    "minecraft:pink_concrete": (214, 101, 143),
    "minecraft:gray_concrete": (55, 58, 62),
    "minecraft:light_gray_concrete": (125, 125, 115),
    "minecraft:cyan_concrete": (21, 119, 136),
    "minecraft:purple_concrete": (100, 32, 156),
    "minecraft:blue_concrete": (45, 47, 143),
    "minecraft:brown_concrete": (96, 60, 32),
    "minecraft:green_concrete": (73, 91, 36),
    "minecraft:red_concrete": (142, 33, 33),
    "minecraft:black_concrete": (8, 10, 15),
    # wool
    "minecraft:white_wool": (234, 237, 237),
    "minecraft:orange_wool": (241, 119, 22),
    "minecraft:magenta_wool": (190, 70, 181),
    "minecraft:light_blue_wool": (60, 176, 218),
    "minecraft:yellow_wool": (249, 198, 41),
    "minecraft:lime_wool": (113, 186, 26),
    "minecraft:pink_wool": (238, 144, 173),
    "minecraft:gray_wool": (63, 69, 72),
    "minecraft:light_gray_wool": (142, 143, 135),
    "minecraft:cyan_wool": (21, 138, 145),
    "minecraft:purple_wool": (123, 43, 173),
    "minecraft:blue_wool": (53, 58, 158),
    "minecraft:brown_wool": (115, 72, 41),
    "minecraft:green_wool": (85, 110, 28),
    "minecraft:red_wool": (161, 40, 35),
    "minecraft:black_wool": (22, 22, 27),
    # terracotta
    "minecraft:hardened_clay": (152, 94, 68),
    "minecraft:white_terracotta": (210, 178, 161),
    "minecraft:orange_terracotta": (162, 84, 38),
    "minecraft:magenta_terracotta": (150, 88, 109),
    "minecraft:light_blue_terracotta": (114, 109, 138),
    "minecraft:yellow_terracotta": (186, 133, 35),
    "minecraft:lime_terracotta": (104, 118, 53),
    "minecraft:pink_terracotta": (162, 78, 79),
    "minecraft:gray_terracotta": (58, 42, 36),
    "minecraft:light_gray_terracotta": (135, 107, 98),
    "minecraft:cyan_terracotta": (87, 91, 91),
    "minecraft:purple_terracotta": (118, 70, 86),
    "minecraft:blue_terracotta": (74, 60, 91),
    "minecraft:brown_terracotta": (77, 51, 36),
    "minecraft:green_terracotta": (76, 83, 42),
    "minecraft:red_terracotta": (143, 61, 47),
    "minecraft:black_terracotta": (37, 23, 16),
    # natural
    "minecraft:oak_planks": (165, 134, 81),
    "minecraft:spruce_planks": (117, 86, 49),
    "minecraft:birch_planks": (194, 177, 122),
    "minecraft:jungle_planks": (164, 118, 84),
    "minecraft:acacia_planks": (170, 91, 51),
    "minecraft:dark_oak_planks": (68, 44, 21),
    "minecraft:mangrove_planks": (119, 56, 50),
    "minecraft:cherry_planks": (227, 180, 174),
    "minecraft:crimson_planks": (105, 50, 73),
    "minecraft:warped_planks": (45, 109, 104),
    "minecraft:stone": (126, 126, 126),
    "minecraft:cobblestone": (132, 132, 132),
    "minecraft:smooth_stone": (160, 160, 160),
    "minecraft:stone_bricks": (124, 124, 124),
    "minecraft:granite": (152, 106, 89),
    "minecraft:polished_granite": (156, 109, 92),
    "minecraft:diorite": (193, 193, 193),
    "minecraft:polished_diorite": (197, 197, 198),
    "minecraft:andesite": (137, 137, 138),
    "minecraft:polished_andesite": (135, 137, 136),
    "minecraft:deepslate": (85, 85, 87),
    "minecraft:cobbled_deepslate": (81, 81, 83),
    "minecraft:polished_deepslate": (76, 76, 76),
    "minecraft:deepslate_bricks": (75, 75, 75),
    "minecraft:tuff": (111, 111, 105),
    "minecraft:calcite": (225, 226, 222),
    "minecraft:sandstone": (218, 206, 160),
    "minecraft:smooth_sandstone": (224, 214, 171),
    "minecraft:red_sandstone": (187, 100, 31),
    "minecraft:smooth_red_sandstone": (182, 98, 32),
    "minecraft:quartz_block": (236, 230, 223),
    "minecraft:quartz_bricks": (235, 229, 222),
    "minecraft:brick_block": (153, 101, 89),
    "minecraft:mud_bricks": (139, 105, 80),
    "minecraft:packed_mud": (143, 107, 80),
    "minecraft:clay": (161, 167, 180),
    "minecraft:snow": (249, 254, 254),
    "minecraft:obsidian": (21, 14, 35),
    "minecraft:blackstone": (44, 39, 46),
    "minecraft:polished_blackstone": (55, 51, 60),
    "minecraft:netherrack": (99, 40, 40),
    "minecraft:nether_brick": (46, 23, 27),
    "minecraft:red_nether_brick": (74, 8, 10),
    "minecraft:end_stone": (220, 224, 159),
    "minecraft:prismarine": (106, 160, 155),
    "minecraft:dark_prismarine": (53, 95, 78),
    "minecraft:moss_block": (91, 111, 46),
    # mineral
    "minecraft:gold_block": (247, 211, 69),
    "minecraft:iron_block": (221, 221, 221),
    "minecraft:diamond_block": (113, 238, 229),
    "minecraft:emerald_block": (57, 206, 99),
    "minecraft:lapis_block": (31, 69, 141),
    "minecraft:coal_block": (18, 17, 17),
    "minecraft:amethyst_block": (140, 104, 194),
    "minecraft:raw_iron_block": (173, 142, 116),
    "minecraft:raw_copper_block": (163, 109, 83),
    "minecraft:raw_gold_block": (224, 177, 61),
}

# --------------------------------------------------------------------------
# Colour science
# --------------------------------------------------------------------------


def srgb_to_linear(c):
    """Decode sRGB values in 0..1 to linear light."""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    """Encode linear light values in 0..1 as sRGB."""
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


_RGB_TO_XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                        [0.2126729, 0.7151522, 0.0721750],
                        [0.0193339, 0.1191920, 0.9503041]])
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])


def srgb_to_lab(c):
    """Convert sRGB (0..1, shape (..., 3)) to CIELAB with a D65 white point."""
    xyz = srgb_to_linear(c) @ _RGB_TO_XYZ.T / _WHITE_D65
    delta = 6 / 29
    f = np.where(xyz > delta ** 3, np.cbrt(xyz), xyz / (3 * delta ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16,
                     500 * (f[..., 0] - f[..., 1]),
                     200 * (f[..., 1] - f[..., 2])], axis=-1)


def delta_e_2000(lab1, lab2, k_l: float = 1.0):
    """CIEDE2000 colour difference between broadcastable arrays of Lab colours.

    ``k_l`` is the standard lightness weighting factor (1 for the reference
    conditions, 2 is commonly used for textured surfaces such as textiles).

    Follows Sharma, Wu and Dalal (2005), "The CIEDE2000 colour-difference
    formula: implementation notes, supplementary test data, and mathematical
    observations", Color Research and Application 30(1).
    """
    lab1 = np.asarray(lab1, dtype=np.float64)
    lab2 = np.asarray(lab2, dtype=np.float64)
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]

    c_bar = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    g = 0.5 * (1 - np.sqrt(c_bar ** 7 / (c_bar ** 7 + 25.0 ** 7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    no_hue = (c1p * c2p) == 0

    dlp = l2 - l1
    dcp = c2p - c1p
    dhp = h2p - h1p
    dhp = np.where(dhp > 180, dhp - 360, np.where(dhp < -180, dhp + 360, dhp))
    dhp = np.where(no_hue, 0.0, dhp)
    dhp_big = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dhp / 2))

    lp_bar = (l1 + l2) / 2
    cp_bar = (c1p + c2p) / 2
    h_sum = h1p + h2p
    hp_bar = np.where(np.abs(h1p - h2p) <= 180, h_sum / 2,
                      np.where(h_sum < 360, (h_sum + 360) / 2, (h_sum - 360) / 2))
    hp_bar = np.where(no_hue, h_sum, hp_bar)

    t = (1 - 0.17 * np.cos(np.radians(hp_bar - 30)) + 0.24 * np.cos(np.radians(2 * hp_bar))
         + 0.32 * np.cos(np.radians(3 * hp_bar + 6)) - 0.20 * np.cos(np.radians(4 * hp_bar - 63)))
    d_theta = 30 * np.exp(-(((hp_bar - 275) / 25) ** 2))
    r_c = 2 * np.sqrt(cp_bar ** 7 / (cp_bar ** 7 + 25.0 ** 7))
    s_l = 1 + 0.015 * (lp_bar - 50) ** 2 / np.sqrt(20 + (lp_bar - 50) ** 2)
    s_c = 1 + 0.045 * cp_bar
    s_h = 1 + 0.015 * cp_bar * t
    r_t = -np.sin(np.radians(2 * d_theta)) * r_c
    return np.sqrt((dlp / (k_l * s_l)) ** 2 + (dcp / s_c) ** 2 + (dhp_big / s_h) ** 2
                   + r_t * (dcp / s_c) * (dhp_big / s_h))


class Palette:
    """A set of candidate blocks and their colours, ready for matching."""

    def __init__(self, block_ids: Sequence[str]):
        if not block_ids:
            raise ValueError("the palette is empty")
        self.block_ids = list(block_ids)
        self.srgb = np.array([BLOCK_COLOURS[b] for b in self.block_ids], dtype=np.float64) / 255
        self.linear = srgb_to_linear(self.srgb)
        self.lab = srgb_to_lab(self.srgb)

    @classmethod
    def from_spec(cls, spec: str) -> "Palette":
        """Build a palette from a comma separated list of groups and block ids.

        ``"concrete,wool"`` selects two groups, ``"all"`` every known block and
        ``"concrete,minecraft:gold_block"`` adds a single block to a group.
        """
        ids: List[str] = []
        for token in (t.strip() for t in spec.split(",")):
            if not token:
                continue
            if token == "all":
                chosen = [b for group in PALETTE_GROUPS.values() for b in group]
            elif token in PALETTE_GROUPS:
                chosen = PALETTE_GROUPS[token]
            else:
                block = token if ":" in token else "minecraft:" + token
                if block not in BLOCK_COLOURS:
                    raise ValueError(
                        f"unknown palette group or block '{token}'. Groups: "
                        f"{', '.join(PALETTE_GROUPS)}, all")
                chosen = [block]
            ids.extend(b for b in chosen if b not in ids)
        return cls(ids)

    def match(self, srgb) -> np.ndarray:
        """Return the index of the closest palette block for each sRGB colour."""
        srgb = np.asarray(srgb, dtype=np.float64).reshape(-1, 3)
        if len(srgb) == 0:
            return np.zeros(0, dtype=np.int64)
        # Match each distinct 8-bit colour once; models repeat colours a lot.
        quantised = np.clip(np.round(srgb * 255), 0, 255).astype(np.int64)
        keys = (quantised[:, 0] << 16) | (quantised[:, 1] << 8) | quantised[:, 2]
        unique_keys, inverse = np.unique(keys, return_inverse=True)
        unique_rgb = np.stack([(unique_keys >> 16) & 255, (unique_keys >> 8) & 255,
                               unique_keys & 255], axis=-1) / 255.0
        lab = srgb_to_lab(unique_rgb)
        best = np.empty(len(lab), dtype=np.int64)
        for start in range(0, len(lab), 4096):
            chunk = lab[start:start + 4096, None, :]
            best[start:start + 4096] = np.argmin(
                delta_e_2000(chunk, self.lab[None], MATCH_K_L), axis=1)
        return best[inverse.reshape(-1)]


# --------------------------------------------------------------------------
# Meshes and loaders
# --------------------------------------------------------------------------


@dataclass
class Mesh:
    """A triangle mesh with optional colour information.

    All colours are sRGB floats in 0..1. ``face_texture`` holds an index into
    ``textures`` (or -1) and ``face_uvs`` the UV at each triangle corner.
    """

    vertices: np.ndarray                      # (N, 3) float
    faces: np.ndarray                         # (M, 3) int
    vertex_colours: Optional[np.ndarray] = None   # (N, 3)
    face_colours: Optional[np.ndarray] = None     # (M, 3), NaN where unknown
    face_uvs: Optional[np.ndarray] = None         # (M, 3, 2), NaN where unknown
    face_texture: Optional[np.ndarray] = None     # (M,) int
    textures: List[np.ndarray] = field(default_factory=list)  # (H, W, 3) uint8 each

    def describe(self) -> str:
        sources = []
        if self.textures and self.face_texture is not None and (self.face_texture >= 0).any():
            sources.append(f"{len(self.textures)} texture(s)")
        if self.vertex_colours is not None:
            sources.append("vertex colours")
        if self.face_colours is not None and not np.isnan(self.face_colours).all():
            sources.append("material colours")
        return (f"{len(self.vertices)} vertices, {len(self.faces)} triangles, colour from "
                + (", ".join(sources) if sources else "nothing (using light grey)"))


def _fan(polygon: Sequence[int]) -> List[Tuple[int, int, int]]:
    """Triangulate a convex polygon (given as corner positions) as a fan."""
    return [(polygon[0], polygon[k], polygon[k + 1]) for k in range(1, len(polygon) - 1)]


#: Textures larger than this (in pixels along a side) are shrunk on loading.
#: Even a 64 block statue only needs a few hundred texels per block face, and
#: 8K or 16K photogrammetry textures would otherwise use gigabytes of memory.
MAX_TEXTURE_SIDE = 4096


def load_texture(path: str) -> np.ndarray:
    """Load an image as an (H, W, 3) uint8 sRGB array, shrinking huge ones."""
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = None  # scan textures can legitimately be enormous
    try:
        with Image.open(path) as image:
            image = image.convert("RGB")
            factor = -(-max(image.size) // MAX_TEXTURE_SIDE)  # ceiling division
            if factor > 1:
                image = image.reduce(factor)  # box filter: averages the texels
            return np.asarray(image, dtype=np.uint8)
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit


def _find_file(base_dir: str, name: str) -> Optional[str]:
    """Find a file referenced by an OBJ/MTL/PLY, tolerating Windows paths."""
    name = name.strip().strip('"').replace("\\", "/")
    for candidate in (os.path.join(base_dir, name),            # usual case: relative
                      os.path.join(base_dir, os.path.basename(name)),  # moved folder
                      name):                                   # absolute path
        if os.path.isfile(candidate):
            return candidate
    return None


# Options that may precede the file name in an MTL map statement, with the
# largest number of values each takes.
_MAP_OPTIONS = {"-blendu": 1, "-blendv": 1, "-bm": 1, "-boost": 1, "-cc": 1, "-clamp": 1,
                "-imfchan": 1, "-mm": 2, "-o": 3, "-s": 3, "-t": 3, "-texres": 1, "-type": 1}


def _map_file_name(tokens: List[str]) -> str:
    """Strip options such as ``-s 1 1 1`` from a ``map_Kd`` statement."""
    i = 0
    while i < len(tokens) and tokens[i] in _MAP_OPTIONS:
        limit = _MAP_OPTIONS[tokens[i]]
        i += 1
        taken = 0
        while i < len(tokens) and taken < limit:
            if taken > 0:
                try:
                    float(tokens[i])
                except ValueError:
                    break
            i += 1
            taken += 1
    return " ".join(tokens[i:])


def load_mtl(path: str) -> Dict[str, dict]:
    """Read the ``Kd`` colour and ``map_Kd`` texture of each material."""
    materials: Dict[str, dict] = {}
    current = None
    base_dir = os.path.dirname(path)
    with open(path, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            parts = raw.strip().split()
            if not parts or parts[0].startswith("#"):
                continue
            key = parts[0]
            if key == "newmtl":
                current = materials.setdefault(" ".join(parts[1:]), {})
            elif current is None:
                continue
            elif key == "Kd" and len(parts) >= 4:
                current["kd"] = tuple(float(v) for v in parts[1:4])
            elif key == "map_Kd" and len(parts) >= 2:
                name = _map_file_name(parts[1:])
                found = _find_file(base_dir, name)
                if found:
                    current["texture"] = found
                else:
                    print(f"warning: texture '{name}' from {path} not found", file=sys.stderr)
    return materials


def load_obj(path: str) -> Mesh:
    """Load a Wavefront OBJ file (with optional MTL materials and textures)."""
    base_dir = os.path.dirname(path)
    positions: List[Tuple[float, float, float]] = []
    colours: List[Optional[Tuple[float, float, float]]] = []
    uvs: List[Tuple[float, float]] = []
    faces: List[Tuple[int, int, int]] = []
    face_uv_ids: List[Tuple[int, int, int]] = []
    face_material: List[Optional[str]] = []
    materials: Dict[str, dict] = {}
    current_material: Optional[str] = None
    any_colour = False

    def resolve(token: str, count: int) -> int:
        index = int(token)
        return index - 1 if index > 0 else count + index

    with open(path, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            parts = raw.split()
            if not parts or parts[0].startswith("#"):
                continue
            key = parts[0]
            if key == "v":
                values = [float(v) for v in parts[1:]]
                positions.append((values[0], values[1], values[2]))
                if len(values) >= 6:  # "v x y z r g b", common in scan exports
                    colours.append((values[3], values[4], values[5]))
                    any_colour = True
                else:
                    colours.append(None)
            elif key == "vt":
                uvs.append((float(parts[1]), float(parts[2]) if len(parts) > 2 else 0.0))
            elif key == "f":
                corners = []
                corner_uvs = []
                for token in parts[1:]:
                    pieces = token.split("/")
                    corners.append(resolve(pieces[0], len(positions)))
                    has_uv = len(pieces) > 1 and pieces[1] != ""
                    corner_uvs.append(resolve(pieces[1], len(uvs)) if has_uv else -1)
                for tri, tri_uv in zip(_fan(corners), _fan(corner_uvs)):
                    faces.append(tri)
                    face_uv_ids.append(tri_uv)
                    face_material.append(current_material)
            elif key == "mtllib":
                rest = raw.strip()[len("mtllib"):].strip()
                names = [rest] if _find_file(base_dir, rest) else rest.split()
                for name in names:
                    found = _find_file(base_dir, name)
                    if found:
                        materials.update(load_mtl(found))
                    else:
                        print(f"warning: material library '{name}' not found", file=sys.stderr)
            elif key == "usemtl":
                current_material = " ".join(parts[1:])

    if not faces:
        raise ValueError(f"{path} contains no faces")
    vertices = np.array(positions, dtype=np.float64)
    face_array = np.array(faces, dtype=np.int64)
    if face_array.min() < 0 or face_array.max() >= len(vertices):
        raise ValueError(f"{path} has a face that refers to a missing vertex")
    mesh = Mesh(vertices=vertices, faces=face_array)

    if any_colour:
        filled = [c if c is not None else (np.nan,) * 3 for c in colours]
        vertex_colours = np.array(filled, dtype=np.float64)
        if np.nanmax(vertex_colours) > 1.0:  # some tools write 0..255
            vertex_colours /= 255.0
        mesh.vertex_colours = np.where(np.isnan(vertex_colours), FALLBACK_COLOUR, vertex_colours)

    if materials:
        texture_index: Dict[str, int] = {}
        face_colours = np.full((len(faces), 3), np.nan)
        face_texture = np.full(len(faces), -1, dtype=np.int64)
        for i, name in enumerate(face_material):
            material = materials.get(name) if name is not None else None
            if not material:
                continue
            if "kd" in material:
                face_colours[i] = material["kd"]
            if "texture" in material:
                tex_path = material["texture"]
                if tex_path not in texture_index:
                    texture_index[tex_path] = len(mesh.textures)
                    mesh.textures.append(load_texture(tex_path))
                face_texture[i] = texture_index[tex_path]
        mesh.face_colours = face_colours
        if mesh.textures:
            uv_array = np.array(uvs if uvs else [(np.nan, np.nan)], dtype=np.float64)
            ids = np.array(face_uv_ids, dtype=np.int64)
            face_uvs = uv_array[np.clip(ids, 0, len(uv_array) - 1)]
            face_uvs[ids < 0] = np.nan
            mesh.face_uvs = face_uvs
            mesh.face_texture = face_texture
    return mesh


_PLY_TYPES = {
    "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
    "short": "i2", "int16": "i2", "ushort": "u2", "uint16": "u2",
    "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4",
    "float": "f4", "float32": "f4", "double": "f8", "float64": "f8",
}


def _parse_ply_header(handle):
    """Return (format, elements, comments) from a PLY header."""
    if handle.readline().strip() != b"ply":
        raise ValueError("not a PLY file (missing 'ply' magic line)")
    fmt = None
    elements = []  # [name, count, [(prop_name, type) or (prop_name, count_type, item_type)]]
    comments = []
    while True:
        line = handle.readline()
        if not line:
            raise ValueError("PLY header has no end_header line")
        parts = line.decode("ascii", errors="replace").split()
        if not parts:
            continue
        if parts[0] == "format":
            fmt = parts[1]
        elif parts[0] in ("comment", "obj_info"):
            comments.append(" ".join(parts[1:]))
        elif parts[0] == "element":
            elements.append([parts[1], int(parts[2]), []])
        elif parts[0] == "property":
            if parts[1] == "list":
                elements[-1][2].append((parts[4], _PLY_TYPES[parts[2]], _PLY_TYPES[parts[3]]))
            else:
                elements[-1][2].append((parts[2], _PLY_TYPES[parts[1]]))
        elif parts[0] == "end_header":
            break
    if fmt not in ("ascii", "binary_little_endian", "binary_big_endian"):
        raise ValueError(f"unsupported PLY format '{fmt}'")
    return fmt, elements, comments


def _read_ply_ascii(body: bytes, elements):
    tokens = body.split()
    pos = 0
    data = {}
    for name, count, props in elements:
        if all(len(p) == 2 for p in props):
            width = len(props)
            block = np.array(tokens[pos:pos + count * width], dtype=np.float64)
            block = block.reshape(count, width)
            pos += count * width
            data[name] = {p[0]: block[:, i] for i, p in enumerate(props)}
            continue
        columns: Dict[str, list] = {p[0]: [] for p in props}
        for _ in range(count):
            for prop in props:
                if len(prop) == 2:
                    columns[prop[0]].append(float(tokens[pos]))
                    pos += 1
                else:
                    n = int(tokens[pos])
                    columns[prop[0]].append([float(t) for t in tokens[pos + 1:pos + 1 + n]])
                    pos += 1 + n
        data[name] = columns
    return data


def _read_ply_binary(body: bytes, elements, endian: str):
    offset = 0
    data = {}
    for name, count, props in elements:
        if all(len(p) == 2 for p in props):
            dtype = np.dtype([(p[0], endian + p[1]) for p in props])
            block = np.frombuffer(body, dtype=dtype, count=count, offset=offset)
            offset += dtype.itemsize * count
            data[name] = {p[0]: block[p[0]] for p in props}
            continue
        if count == 0:
            data[name] = {p[0]: [] for p in props}
            continue
        # Fast path: every list in this element has the same length as in the
        # first row (all triangles, or all quads), so numpy can read it whole.
        first_counts = []
        probe = offset
        for prop in props:
            if len(prop) == 2:
                probe += np.dtype(prop[1]).itemsize
            else:
                n = int(np.frombuffer(body, endian + prop[1], 1, probe)[0])
                first_counts.append(n)
                probe += np.dtype(prop[1]).itemsize + n * np.dtype(prop[2]).itemsize
        fields = []
        list_iter = iter(first_counts)
        for prop in props:
            if len(prop) == 2:
                fields.append((prop[0], endian + prop[1]))
            else:
                n = next(list_iter)
                fields.append((prop[0] + "#count", endian + prop[1]))
                fields.append((prop[0], endian + prop[2], (n,)))
        dtype = np.dtype(fields)
        block = None
        if offset + dtype.itemsize * count <= len(body):
            block = np.frombuffer(body, dtype=dtype, count=count, offset=offset)
            list_iter = iter(first_counts)
            for prop in props:
                if len(prop) == 3 and not np.all(block[prop[0] + "#count"] == next(list_iter)):
                    block = None
                    break
        if block is not None:
            offset += dtype.itemsize * count
            data[name] = {p[0]: block[p[0]] for p in props}
            continue
        # Slow path: lists of varying length (mixed polygons).
        columns: Dict[str, list] = {p[0]: [] for p in props}
        for _ in range(count):
            for prop in props:
                if len(prop) == 2:
                    fmt = endian + prop[1]
                    columns[prop[0]].append(np.frombuffer(body, fmt, 1, offset)[0])
                    offset += np.dtype(fmt).itemsize
                else:
                    n = int(np.frombuffer(body, endian + prop[1], 1, offset)[0])
                    offset += np.dtype(prop[1]).itemsize
                    item = np.dtype(endian + prop[2])
                    columns[prop[0]].append(np.frombuffer(body, item, n, offset).tolist())
                    offset += item.itemsize * n
        data[name] = columns
    return data


def _ply_colour(column, type_code: str) -> np.ndarray:
    values = np.asarray(column, dtype=np.float64)
    if type_code.startswith(("u", "i")) or values.max(initial=0) > 1.0:
        values = values / 255.0
    return values


def load_ply(path: str) -> Mesh:
    """Load a PLY mesh (ASCII or binary) with optional vertex colours.

    Texture coordinates are used when the file names its texture in a
    ``comment TextureFile <image>`` line (as MeshLab and several scanning
    apps write), either per face (``texcoord``) or per vertex (``s``/``t``,
    ``u``/``v`` or ``texture_u``/``texture_v``).
    """
    with open(path, "rb") as handle:
        fmt, elements, comments = _parse_ply_header(handle)
        body = handle.read()
    if fmt == "ascii":
        data = _read_ply_ascii(body, elements)
    else:
        data = _read_ply_binary(body, elements, "<" if fmt == "binary_little_endian" else ">")
    types = {name: {p[0]: p[-1] for p in props} for name, _, props in elements}

    if "vertex" not in data:
        raise ValueError(f"{path} has no vertex element")
    vert = data["vertex"]
    vertices = np.stack([np.asarray(vert[k], dtype=np.float64) for k in "xyz"], axis=-1)

    face_data = data.get("face", {})
    index_key = next((k for k in ("vertex_indices", "vertex_index") if k in face_data), None)
    if index_key is None:
        raise ValueError(f"{path} has no faces (a point cloud cannot be voxelised; "
                         "mesh it first, for example with Poisson reconstruction in MeshLab)")
    polygons = face_data[index_key]
    corner_uvs = face_data.get("texcoord")

    triangles: List[Tuple[int, int, int]] = []
    triangle_uvs: List[Tuple] = []
    if isinstance(polygons, np.ndarray) and polygons.ndim == 2:
        # Every polygon has the same corner count: triangulate them all at once.
        corners = polygons.shape[1]
        fans = [[0, k, k + 1] for k in range(1, corners - 1)]
        faces = polygons.astype(np.int64)[:, fans].reshape(-1, 3)
        if corner_uvs is not None:
            uv = np.asarray(corner_uvs, dtype=np.float64).reshape(len(polygons), corners, 2)
            triangle_uvs = list(uv[:, fans].reshape(-1, 3, 2))
    else:
        for p, polygon in enumerate(polygons):
            polygon = [int(i) for i in polygon]
            triangles.extend(_fan(polygon))
            if corner_uvs is not None:
                uv = np.asarray(corner_uvs[p], dtype=np.float64).reshape(-1, 2)
                triangle_uvs.extend(np.array(t) for t in _fan(list(uv)))
        faces = np.array(triangles, dtype=np.int64).reshape(-1, 3)
    if len(faces) == 0:
        raise ValueError(f"{path} contains no faces")
    mesh = Mesh(vertices=vertices, faces=faces)

    colour_keys = next((keys for keys in (("red", "green", "blue"), ("r", "g", "b"),
                                          ("diffuse_red", "diffuse_green", "diffuse_blue"))
                        if all(k in vert for k in keys)), None)
    if colour_keys:
        mesh.vertex_colours = np.stack(
            [_ply_colour(vert[k], types["vertex"][k]) for k in colour_keys], axis=-1)

    texture_name = next((c.split(None, 1)[1] for c in comments
                         if c.startswith("TextureFile ") and len(c.split(None, 1)) > 1), None)
    if texture_name:
        found = _find_file(os.path.dirname(path), texture_name)
        uv_keys = next((keys for keys in (("s", "t"), ("u", "v"), ("texture_u", "texture_v"))
                        if all(k in vert for k in keys)), None)
        if not found:
            print(f"warning: texture '{texture_name}' not found", file=sys.stderr)
        elif triangle_uvs or uv_keys:
            mesh.textures.append(load_texture(found))
            if triangle_uvs:
                mesh.face_uvs = np.array(triangle_uvs, dtype=np.float64).reshape(-1, 3, 2)
            else:
                vertex_uv = np.stack([np.asarray(vert[k], dtype=np.float64) for k in uv_keys], -1)
                mesh.face_uvs = vertex_uv[faces]
            mesh.face_texture = np.zeros(len(faces), dtype=np.int64)
    if faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError(f"{path} has a face that refers to a missing vertex")
    return mesh


def load_mesh(path: str) -> Mesh:
    """Load an OBJ or PLY file, chosen by extension."""
    extension = os.path.splitext(path)[1].lower()
    if extension == ".obj":
        return load_obj(path)
    if extension == ".ply":
        return load_ply(path)
    raise ValueError(f"unsupported model format '{extension}' (use .obj or .ply; in Blender "
                     "use File > Export > Wavefront (.obj) or Stanford PLY)")


# --------------------------------------------------------------------------
# Voxelisation
# --------------------------------------------------------------------------


def orient_vertices(vertices: np.ndarray, up: str = "y", rotate: float = 0.0) -> np.ndarray:
    """Turn model coordinates into Minecraft ones (+X east, +Y up, +Z south).

    ``up="z"`` converts Blender's Z-up coordinates the same way Blender's own
    Y-up exporters do: (x, y, z) becomes (x, z, -y). ``rotate`` then turns the
    model anticlockwise (seen from above) by that many degrees.
    """
    v = np.asarray(vertices, dtype=np.float64)
    if up == "z":
        v = np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=-1)
    elif up != "y":
        raise ValueError("up must be 'y' or 'z'")
    if rotate:
        angle = np.radians(rotate)
        c, s = np.cos(angle), np.sin(angle)
        # Anticlockwise from above (looking down -Y) in a right-handed frame.
        x, z = v[:, 0] * c + v[:, 2] * s, -v[:, 0] * s + v[:, 2] * c
        v = np.stack([x, v[:, 1], z], axis=-1)
    return v


def _barycentric_grid(n: int) -> np.ndarray:
    """Barycentric weights for a triangular grid with n steps along each edge."""
    i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
    keep = (i + j) <= n
    a, b = i[keep] / n, j[keep] / n
    return np.stack([1 - a - b, a, b], axis=-1)


def _sample_colours(mesh: Mesh, tri_ids: np.ndarray, bary: np.ndarray) -> np.ndarray:
    """sRGB colour at barycentric points ``bary`` (K, 3) of triangles ``tri_ids``."""
    shape = (len(tri_ids), len(bary), 3)
    colours = np.empty(shape)
    colours[:] = FALLBACK_COLOUR
    if mesh.face_colours is not None:
        fc = mesh.face_colours[tri_ids]
        known = ~np.isnan(fc[:, 0])
        colours[known] = fc[known][:, None, :]
    if mesh.vertex_colours is not None:
        corner = mesh.vertex_colours[mesh.faces[tri_ids]]          # (T, 3, 3)
        colours = np.einsum("kc,tcd->tkd", bary, corner)
    if mesh.textures and mesh.face_texture is not None and mesh.face_uvs is not None:
        tex_ids = mesh.face_texture[tri_ids]
        uv_corners = mesh.face_uvs[tri_ids]                           # (T, 3, 2)
        for t, texture in enumerate(mesh.textures):
            use = (tex_ids == t) & ~np.isnan(uv_corners[:, 0, 0])
            if not use.any():
                continue
            uv = np.einsum("kc,tcd->tkd", bary, uv_corners[use])      # (T', K, 2)
            h, w = texture.shape[:2]
            px = np.floor((uv[..., 0] % 1.0) * w).astype(np.int64).clip(0, w - 1)
            py = np.floor((1.0 - uv[..., 1] % 1.0) * h).astype(np.int64).clip(0, h - 1)
            colours[use] = texture[py, px] / 255.0
    return colours


@dataclass
class VoxelGrid:
    """Surface voxels of a model with their average sRGB colours."""

    occupied: np.ndarray   # (X, Y, Z) bool
    colours: np.ndarray    # (X, Y, Z, 3) sRGB, meaningful where occupied


def voxelise(mesh: Mesh, size: int, up: str = "y", rotate: float = 0.0,
             spacing: float = SAMPLE_SPACING) -> VoxelGrid:
    """Mark every block the mesh surface passes through and average its colour.

    The model is scaled so its longest side spans ``size`` blocks and moved so
    its lowest point sits at y = 0.
    """
    vertices = orient_vertices(mesh.vertices, up, rotate)
    used = np.unique(mesh.faces)
    low = vertices[used].min(axis=0)
    extent = vertices[used].max(axis=0) - low
    longest = float(extent.max())
    scale = size / longest if longest > 0 else 1.0
    dims = np.maximum(1, np.ceil(extent * scale - 1e-6)).astype(np.int64)
    dims = np.minimum(dims, size)
    scaled = (vertices - low) * scale

    count = int(np.prod(dims))
    colour_sum = np.zeros((count, 3))
    hits = np.zeros(count)

    tri = scaled[mesh.faces]                                           # (M, 3, 3)
    edges = np.stack([np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1),
                      np.linalg.norm(tri[:, 2] - tri[:, 1], axis=1),
                      np.linalg.norm(tri[:, 0] - tri[:, 2], axis=1)], axis=1)
    steps = np.maximum(1, np.ceil(edges.max(axis=1) / spacing)).astype(np.int64)

    for n in np.unique(steps):
        bary = _barycentric_grid(int(n))
        tri_ids_all = np.nonzero(steps == n)[0]
        chunk = max(1, 2_000_000 // len(bary))
        for start in range(0, len(tri_ids_all), chunk):
            tri_ids = tri_ids_all[start:start + chunk]
            points = np.einsum("kc,tcd->tkd", bary, tri[tri_ids]).reshape(-1, 3)
            cell = np.floor(points).astype(np.int64)
            cell = np.clip(cell, 0, dims - 1)
            flat = (cell[:, 0] * dims[1] + cell[:, 1]) * dims[2] + cell[:, 2]
            linear = srgb_to_linear(_sample_colours(mesh, tri_ids, bary).reshape(-1, 3))
            hits += np.bincount(flat, minlength=count)
            for channel in range(3):
                colour_sum[:, channel] += np.bincount(flat, weights=linear[:, channel],
                                                      minlength=count)

    occupied = hits > 0
    colours = np.zeros((count, 3))
    colours[occupied] = linear_to_srgb(colour_sum[occupied] / hits[occupied, None])
    shape = tuple(int(d) for d in dims)
    return VoxelGrid(occupied.reshape(shape), colours.reshape(shape + (3,)))


_NEIGHBOURS = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))


def _shift(array: np.ndarray, offset: Tuple[int, int, int], fill=False) -> np.ndarray:
    """Shift ``array`` by ``offset`` voxels, filling the exposed edge."""
    result = np.full_like(array, fill)
    src = []
    dst = []
    for o, n in zip(offset, array.shape):
        if o >= 0:
            src.append(slice(0, n - o))
            dst.append(slice(o, n))
        else:
            src.append(slice(-o, n))
            dst.append(slice(0, n + o))
    result[tuple(dst)] = array[tuple(src)]
    return result


def outside_air(solid: np.ndarray) -> np.ndarray:
    """Air voxels connected (through shared faces) to the outside of the grid."""
    padded = np.pad(solid, 1, constant_values=False)
    outside = np.zeros_like(padded)
    outside[0, :, :] = outside[-1, :, :] = True
    outside[:, 0, :] = outside[:, -1, :] = True
    outside[:, :, 0] = outside[:, :, -1] = True
    outside &= ~padded
    while True:
        grown = outside.copy()
        for offset in _NEIGHBOURS:
            grown |= _shift(outside, offset)
        grown &= ~padded
        if np.array_equal(grown, outside):
            break
        outside = grown
    return outside[1:-1, 1:-1, 1:-1]


def touches(mask: np.ndarray, target: np.ndarray, target_outside_value=True) -> np.ndarray:
    """True where ``mask`` has a face neighbour in ``target`` (beyond the edge counts too)."""
    near = np.zeros_like(mask)
    for offset in _NEIGHBOURS:
        near |= _shift(target, offset, fill=target_outside_value)
    return mask & near


def fill_labels(labels: np.ndarray, region: np.ndarray) -> np.ndarray:
    """Give unlabelled (-1) voxels in ``region`` the label of a nearby voxel."""
    labels = labels.copy()
    while True:
        missing = region & (labels < 0)
        if not missing.any():
            return labels
        changed = False
        for offset in _NEIGHBOURS:
            source = _shift(labels, offset, fill=-1)
            take = missing & (source >= 0)
            if take.any():
                labels[take] = source[take]
                missing &= ~take
                changed = True
        if not changed:
            return labels


@dataclass
class Statue:
    """Blocks ready to write: ``labels`` index ``block_ids`` (-1 = leave as is)."""

    labels: np.ndarray        # (X, Y, Z) int
    block_ids: List[str]

    @property
    def size(self) -> Tuple[int, int, int]:
        return tuple(int(d) for d in self.labels.shape)

    @property
    def block_count(self) -> int:
        return int((self.labels >= 0).sum())

    def usage(self) -> List[Tuple[str, int]]:
        counts = np.bincount(self.labels[self.labels >= 0], minlength=len(self.block_ids))
        return sorted(((self.block_ids[i], int(c)) for i, c in enumerate(counts) if c),
                      key=lambda item: -item[1])


def model_to_statue(mesh: Mesh, size: int, palette: Palette, solid: bool = False,
                    up: str = "y", rotate: float = 0.0) -> Statue:
    """Voxelise a mesh and match its colours to blocks."""
    grid = voxelise(mesh, size, up, rotate)
    outside = outside_air(grid.occupied)
    enclosed = ~grid.occupied & ~outside
    if solid:
        keep = ~outside
        if not enclosed.any():
            print("note: the model has no closed interior to fill (open scans often don't); "
                  "the statue will be a shell", file=sys.stderr)
    else:
        # Only blocks with a face open to outside air can be seen.
        keep = touches(grid.occupied, outside)
    labels = np.full(grid.occupied.shape, -1, dtype=np.int64)
    surface = keep & grid.occupied
    labels[surface] = palette.match(grid.colours[surface])
    labels = fill_labels(labels, keep)
    return Statue(labels, palette.block_ids)


# --------------------------------------------------------------------------
# Images
# --------------------------------------------------------------------------


def _resize_image(image: Image.Image, size: int) -> Image.Image:
    """Scale so the longest side is ``size`` pixels, keeping pixel art crisp."""
    width, height = image.size
    factor = size / max(width, height)
    new_size = (max(1, round(width * factor)), max(1, round(height * factor)))
    if new_size == image.size:
        return image
    if factor > 1:  # enlarging pixel art: repeat pixels instead of blurring
        return image.resize(new_size, Image.NEAREST)
    # Average with premultiplied alpha so transparent pixels do not bleed.
    return image.convert("RGBa").resize(new_size, Image.BOX).convert("RGBA")


def dither_match(srgb: np.ndarray, opaque: np.ndarray, palette: Palette) -> np.ndarray:
    """Floyd-Steinberg error diffusion (in linear light) onto the palette."""
    height, width = opaque.shape
    work = srgb_to_linear(srgb).copy()
    labels = np.full((height, width), -1, dtype=np.int64)
    for y in range(height):
        for x in range(width):
            if not opaque[y, x]:
                continue
            wanted = np.clip(work[y, x], 0, 1)
            lab = srgb_to_lab(linear_to_srgb(wanted))
            index = int(np.argmin(delta_e_2000(lab, palette.lab, MATCH_K_L)))
            labels[y, x] = index
            error = wanted - palette.linear[index]
            for dx, dy, weight in ((1, 0, 7), (-1, 1, 3), (0, 1, 5), (1, 1, 1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and ny < height and opaque[ny, nx]:
                    work[ny, nx] += error * weight / 16
    return labels


def image_to_statue(path: str, size: int, palette: Palette, flat: bool = False,
                    dither: bool = False) -> Statue:
    """Turn a picture into a one block thick wall (or floor) of matched blocks.

    A wall stands in the X-Y plane and reads correctly when seen from the
    south (+Z side, looking north). A floor lies in the X-Z plane at y = 0
    with the top of the picture to the north.
    """
    with Image.open(path) as source:
        image = _resize_image(source.convert("RGBA"), size)
    pixels = np.asarray(image, dtype=np.float64) / 255.0
    opaque = pixels[..., 3] >= 0.5
    srgb = pixels[..., :3]
    if dither:
        labels2d = dither_match(srgb, opaque, palette)
    else:
        labels2d = np.full(opaque.shape, -1, dtype=np.int64)
        labels2d[opaque] = palette.match(srgb[opaque])
    height, width = labels2d.shape
    if flat:
        labels = labels2d.T[:, None, :]                  # x = column, z = row
    else:
        labels = labels2d[::-1].T[:, :, None]            # x = column, y = up
    return Statue(np.ascontiguousarray(labels), palette.block_ids)


# --------------------------------------------------------------------------
# NBT / .mcstructure
# --------------------------------------------------------------------------

TAG_END, TAG_BYTE, TAG_INT, TAG_STRING, TAG_LIST, TAG_COMPOUND = 0, 1, 3, 8, 9, 10


@dataclass
class NbtList:
    """An NBT list whose items all have tag type ``item_tag``."""

    item_tag: int
    items: list


def _tag_type(value) -> int:
    if isinstance(value, bool):
        return TAG_BYTE
    if isinstance(value, int):
        return TAG_INT
    if isinstance(value, str):
        return TAG_STRING
    if isinstance(value, (NbtList, np.ndarray)):
        return TAG_LIST
    if isinstance(value, dict):
        return TAG_COMPOUND
    raise TypeError(f"cannot store {type(value).__name__} in NBT")


def _write_string(out: bytearray, text: str):
    data = text.encode("utf-8")
    out += struct.pack("<H", len(data)) + data


def _write_payload(out: bytearray, value):
    tag = _tag_type(value)
    if tag == TAG_BYTE:
        out += struct.pack("<b", int(value))
    elif tag == TAG_INT:
        out += struct.pack("<i", value)
    elif tag == TAG_STRING:
        _write_string(out, value)
    elif isinstance(value, np.ndarray):  # fast path for long int lists
        out += struct.pack("<bi", TAG_INT, value.size)
        out += value.astype("<i4").tobytes()
    elif tag == TAG_LIST:
        # Empty lists keep their item type, as make_spawner_structures.cjs does.
        out += struct.pack("<bi", value.item_tag, len(value.items))
        for item in value.items:
            _write_payload(out, item)
    else:
        for key, child in value.items():
            out += struct.pack("<b", _tag_type(child))
            _write_string(out, key)
            _write_payload(out, child)
        out += struct.pack("<b", TAG_END)


def encode_nbt(root: dict) -> bytes:
    """Encode an unnamed root compound as little-endian (Bedrock) NBT."""
    out = bytearray()
    out += struct.pack("<b", TAG_COMPOUND)
    _write_string(out, "")
    _write_payload(out, root)
    return bytes(out)


def structure_nbt(statue: Statue) -> bytes:
    """Build the .mcstructure bytes for a statue.

    Only blocks the statue uses go into the palette. Empty positions get index
    -1 (a structure void), so loading the statue never replaces the terrain or
    builds around it with air.

    Block order: Bedrock stores ``block_indices`` in "ZYX order", Z changing
    fastest and X slowest, i.e. index = (x * size_y + y) * size_z + z. Source:
    Bedrock Wiki, ".mcstructure" page, section "Block Indices"
    (https://wiki.bedrock.dev/nbt/mcstructure, which lists a 2x3x4 example as
    0 0 0, 0 0 1, 0 0 2, 0 0 3, 0 1 0, ...); the ``mcstructure`` Python
    package (github.com/phoenixr-codes/mcstructure) agrees, flattening an
    (x, y, z) numpy array in C order. A C-order flatten of our (X, Y, Z)
    ``labels`` array is exactly that order.
    """
    used = np.unique(statue.labels[statue.labels >= 0])
    remap = np.full(len(statue.block_ids) + 1, -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    primary = np.where(statue.labels >= 0, remap[statue.labels], -1).reshape(-1)
    secondary = np.full(primary.size, -1, dtype=np.int64)
    block_palette = [{
        "name": statue.block_ids[i],
        "states": dict(BLOCK_STATES.get(statue.block_ids[i], {})),
        "version": BLOCK_VERSION,
    } for i in used]
    root = {
        "format_version": 1,
        "size": NbtList(TAG_INT, list(statue.size)),
        "structure": {
            "block_indices": NbtList(TAG_LIST, [primary, secondary]),
            "entities": NbtList(TAG_COMPOUND, []),
            "palette": {
                "default": {
                    "block_palette": NbtList(TAG_COMPOUND, block_palette),
                    "block_position_data": {},
                },
            },
        },
        "structure_world_origin": NbtList(TAG_INT, [0, 0, 0]),
    }
    return encode_nbt(root)


# --------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------


def render_preview(statue: Statue, path: str, scale: Optional[int] = None):
    """Save front (from the south), side (from the east) and top views as a PNG."""
    colours = np.array([BLOCK_COLOURS[b] for b in statue.block_ids], dtype=np.float64)
    labels = statue.labels

    def view(grid: np.ndarray) -> np.ndarray:
        """Project along the last axis, nearest voxel = highest index."""
        filled = grid >= 0
        depth = grid.shape[2]
        has = filled.any(axis=2)
        nearest = depth - 1 - np.argmax(filled[:, :, ::-1], axis=2)
        picked = np.take_along_axis(grid, nearest[..., None], axis=2)[..., 0]
        shade = 0.55 + 0.45 * (nearest + 1) / depth
        rgb = np.where(has[..., None], colours[np.maximum(picked, 0)] * shade[..., None], 40)
        return rgb  # (columns, rows-from-bottom, 3)

    front = view(labels)                                        # x right, y up
    side = view(np.transpose(labels, (2, 1, 0))[::-1])          # looking west: north right
    top = view(np.transpose(labels, (0, 2, 1)))                 # looking down: x right
    top = top[:, ::-1]                                          # north at the top
    panels = [np.transpose(p, (1, 0, 2))[::-1] for p in (front, side)]
    panels.append(np.transpose(top, (1, 0, 2))[::-1])
    height = max(p.shape[0] for p in panels)
    gap = np.full((height, 1, 3), 255.0)
    padded = [np.vstack([np.full((height - p.shape[0], p.shape[1], 3), 255.0), p])
              for p in panels]
    sheet = np.hstack([padded[0], gap, padded[1], gap, padded[2]])
    scale = scale or max(1, 256 // max(height, 1))
    image = Image.fromarray(np.clip(sheet, 0, 255).astype(np.uint8))
    image.resize((sheet.shape[1] * scale, sheet.shape[0] * scale), Image.NEAREST).save(path)


# --------------------------------------------------------------------------
# Registering statues in the add-on script
# --------------------------------------------------------------------------

_ENTRY = re.compile(r'^\s*\{\s*name:\s*("(?:[^"\\]|\\.)*")\s*,\s*structure:\s*"([^"]+)"\s*,'
                    r'\s*size:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]\s*\}\s*,?\s*$')


@dataclass
class StatueEntry:
    name: str
    structure: str
    size: Tuple[int, int, int]

    def to_js(self) -> str:
        x, y, z = self.size
        return (f"{{ name: {json.dumps(self.name)}, structure: {json.dumps(self.structure)}, "
                f"size: [{x}, {y}, {z}] }}")


class RegionError(Exception):
    """The generated STATUES region is missing or cannot be understood."""


def _find_region(lines: List[str]) -> Tuple[int, int]:
    begin = [i for i, line in enumerate(lines) if line.strip() == REGION_BEGIN]
    end = [i for i, line in enumerate(lines) if line.strip() == REGION_END]
    if len(begin) != 1 or len(end) != 1 or end[0] < begin[0]:
        raise RegionError(f"could not find exactly one pair of marker lines\n  {REGION_BEGIN}\n"
                          f"  {REGION_END}")
    return begin[0], end[0]


def read_statue_entries(text: str) -> List[StatueEntry]:
    """Parse the entries between the generated-region markers."""
    lines = text.splitlines()
    begin, end = _find_region(lines)
    entries = []
    for line in lines[begin + 1:end]:
        stripped = line.strip()
        if not stripped or stripped.startswith("const STATUES") or stripped in ("];", "]"):
            if stripped.startswith("const STATUES") and stripped not in (
                    "const STATUES = [", "const STATUES = [];"):
                raise RegionError(f"unexpected line in the statues region: {stripped}")
            continue
        match = _ENTRY.match(line)
        if not match:
            raise RegionError(f"unexpected line in the statues region: {stripped}")
        entries.append(StatueEntry(json.loads(match.group(1)), match.group(2),
                                   tuple(int(match.group(i)) for i in (3, 4, 5))))
    return entries


def render_region(entries: List[StatueEntry], indent: str = "") -> List[str]:
    """Render the STATUES constant, one entry per line, sorted by name."""
    entries = sorted(entries, key=lambda e: (e.name.lower(), e.structure))
    if not entries:
        return [f"{indent}const STATUES = [];"]
    body = [f"{indent}  {e.to_js()}{',' if i < len(entries) - 1 else ''}"
            for i, e in enumerate(entries)]
    return [f"{indent}const STATUES = ["] + body + [f"{indent}];"]


def update_statue_entries(script_path: str, add: Optional[StatueEntry] = None,
                          remove: Optional[str] = None) -> List[StatueEntry]:
    """Add/replace (keyed by structure id) or remove an entry in the script.

    Everything outside the marker lines is left byte for byte as it was.
    """
    with open(script_path, "r", encoding="utf-8", newline="") as handle:
        text = handle.read()
    newline = "\r\n" if "\r\n" in text else "\n"
    entries = read_statue_entries(text)
    lines = text.split(newline)
    begin, end = _find_region([line.rstrip("\r") for line in lines])
    indent = lines[begin][:len(lines[begin]) - len(lines[begin].lstrip())]
    if remove is not None:
        entries = [e for e in entries if e.structure != remove]
    if add is not None:
        entries = [e for e in entries if e.structure != add.structure] + [add]
    lines[begin + 1:end] = render_region(entries, indent)
    temp_path = script_path + ".tmp"
    with open(temp_path, "w", encoding="utf-8", newline="") as handle:
        handle.write(newline.join(lines))
    os.replace(temp_path, script_path)
    return entries


# --------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------


def clean_name(text: str) -> str:
    """Make a structure name: lowercase letters, digits and underscores."""
    name = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return name or "statue"


def title_from(text: str) -> str:
    words = re.sub(r"[_\-]+", " ", text).split()
    return " ".join(w[:1].upper() + w[1:] for w in words) or "Statue"


def _display(path: str) -> str:
    """Show paths inside the current directory relative to it, others in full."""
    relative = os.path.relpath(os.path.abspath(path))
    return path if relative.startswith("..") else relative


def _clamp_size(size: int) -> int:
    clamped = min(max(int(size), 1), MAX_SIZE)
    if clamped != size:
        print(f"note: size {size} clamped to {clamped} (allowed 1..{MAX_SIZE})", file=sys.stderr)
    return clamped


def _save(statue: Statue, args) -> int:
    name = args.name or clean_name(os.path.splitext(os.path.basename(args.input))[0])
    if not re.fullmatch(r"[a-z0-9_]+", name):
        print(f"error: --name must use only a-z, 0-9 and _ (got '{name}')", file=sys.stderr)
        return 2
    title = args.title or title_from(os.path.splitext(os.path.basename(args.input))[0])
    if statue.block_count == 0:
        print("error: the statue has no blocks", file=sys.stderr)
        return 1
    os.makedirs(args.out_dir, exist_ok=True)
    out_path = os.path.join(args.out_dir, name + ".mcstructure")
    data = structure_nbt(statue)
    with open(out_path, "wb") as handle:
        handle.write(data)
    structure_id = f"{NAMESPACE}:{name}"
    x, y, z = statue.size
    print(f"Wrote {_display(out_path)} ({len(data)} bytes)")
    print(f"  structure {structure_id}, size {x} x {y} x {z} (x, y, z), "
          f"{statue.block_count} blocks")
    for block, count in statue.usage()[:12]:
        print(f"    {count:6d}  {block}")
    if len(statue.usage()) > 12:
        print(f"    ... and {len(statue.usage()) - 12} more block types")
    print(f"  place it with: /structure load {structure_id} ~ ~ ~")
    if args.preview:
        render_preview(statue, args.preview)
        print(f"  preview saved to {args.preview}")
    entry = StatueEntry(title, structure_id, statue.size)
    print(f"  script entry: {entry.to_js()}")
    if args.register:
        try:
            update_statue_entries(args.script, add=entry)
            print(f"  registered '{title}' in {_display(args.script)}")
        except (RegionError, OSError) as error:
            print(f"note: not registered in {args.script}: {error}\n"
                  "  add the entry above to the STATUES list by hand", file=sys.stderr)
    print("Rebuild the add-on with: bash build.sh")
    return 0


def command_model(args) -> int:
    palette = Palette.from_spec(args.palette)
    mesh = load_mesh(args.input)
    print(f"Loaded {args.input}: {mesh.describe()}")
    statue = model_to_statue(mesh, _clamp_size(args.size), palette, solid=args.solid,
                             up=args.up, rotate=args.rotate)
    return _save(statue, args)


def command_image(args) -> int:
    palette = Palette.from_spec(args.palette)
    statue = image_to_statue(args.input, _clamp_size(args.size), palette, flat=args.flat,
                             dither=args.dither)
    return _save(statue, args)


def command_list(args) -> int:
    files = sorted(f[:-len(".mcstructure")] for f in os.listdir(args.out_dir)
                   if f.endswith(".mcstructure")) if os.path.isdir(args.out_dir) else []
    try:
        with open(args.script, encoding="utf-8") as handle:
            entries = {e.structure: e for e in read_statue_entries(handle.read())}
    except (RegionError, OSError) as error:
        print(f"note: cannot read registered statues from {args.script}: {error}")
        entries = {}
    names = sorted(set(files) | {s.split(":", 1)[1] for s in entries if s.startswith(NAMESPACE)})
    if not names:
        print("No statues yet.")
        return 0
    print(f"{'structure':40s} {'title':24s} {'size':>12s}  file  registered")
    for name in names:
        structure_id = f"{NAMESPACE}:{name}"
        entry = entries.get(structure_id)
        size = "x".join(map(str, entry.size)) if entry else "?"
        print(f"{structure_id:40s} {(entry.name if entry else '-'):24s} {size:>12s}  "
              f"{'yes' if name in files else 'NO':4s}  {'yes' if entry else 'no'}")
    return 0


def command_remove(args) -> int:
    name = args.remove.split(":", 1)[-1]
    path = os.path.join(args.out_dir, name + ".mcstructure")
    if os.path.exists(path):
        os.remove(path)
        print(f"Deleted {_display(path)}")
    else:
        print(f"No file {_display(path)}")
    structure_id = f"{NAMESPACE}:{name}"
    try:
        with open(args.script, encoding="utf-8") as handle:
            registered = any(e.structure == structure_id
                             for e in read_statue_entries(handle.read()))
        if registered:
            update_statue_entries(args.script, remove=structure_id)
            print(f"Removed {structure_id} from {_display(args.script)}")
        else:
            print(f"{structure_id} was not registered in {_display(args.script)}")
    except (RegionError, OSError) as error:
        print(f"note: script not updated: {error}", file=sys.stderr)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Turn a 3D model or picture into a Minecraft Bedrock statue (.mcstructure).",
        epilog="Run '%(prog)s model -h' or '%(prog)s image -h' for the options of each mode.")
    parser.add_argument("--list", action="store_true", help="list statues and exit")
    parser.add_argument("--remove", metavar="NAME", help="delete a statue file and its entry")

    # --out-dir and --script work both before and after the mode name. The
    # sub-command copies default to SUPPRESS so they only override when given.
    out_help = ("folder for the .mcstructure files "
                "(default: Behavior_Pack/structures/helpertools_statues)")
    script_help = ("add-on script holding the STATUES list "
                   "(default: Behavior_Pack/scripts/main.js)")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help=out_help)
    parser.add_argument("--script", default=DEFAULT_SCRIPT, help=script_help)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--out-dir", default=argparse.SUPPRESS, help=out_help)
    common.add_argument("--script", default=argparse.SUPPRESS, help=script_help)
    common.add_argument("--size", type=int, default=32,
                        help=f"longest side in blocks, 1..{MAX_SIZE} (default: %(default)s)")
    common.add_argument("--name", help="structure name, a-z 0-9 _ (default: from the file name)")
    common.add_argument("--title", help="name shown in game (default: from the file name)")
    common.add_argument("--palette", default=DEFAULT_PALETTE,
                        help="comma separated groups (" + ", ".join(PALETTE_GROUPS)
                        + ", all) and/or block ids (default: %(default)s)")
    common.add_argument("--register", action=argparse.BooleanOptionalAction, default=True,
                        help="add or update the statue in the add-on script (default: on)")
    common.add_argument("--preview", metavar="PNG",
                        help="also save a front/side/top preview picture")

    sub = parser.add_subparsers(dest="command", metavar="{model,image}")
    model = sub.add_parser("model", parents=[common], help="OBJ or PLY mesh to statue")
    model.add_argument("input", help="model file (.obj or .ply)")
    fill = model.add_mutually_exclusive_group()
    fill.add_argument("--hollow", dest="solid", action="store_false",
                      help="only the visible shell (default, far fewer blocks)")
    fill.add_argument("--solid", dest="solid", action="store_true",
                      help="fill the inside of closed models too")
    model.set_defaults(solid=False)
    model.add_argument("--up", choices=("y", "z"), default="y",
                       help="model up axis: y (OBJ convention) or z (Blender) (default: y)")
    model.add_argument("--rotate", type=float, default=0.0, metavar="DEGREES",
                       help="turn the model anticlockwise seen from above")
    model.set_defaults(func=command_model)

    image = sub.add_parser("image", parents=[common], help="picture to pixel art")
    image.add_argument("input", help="picture file (PNG, JPEG, GIF, ...)")
    orientation = image.add_mutually_exclusive_group()
    orientation.add_argument("--vertical", dest="flat", action="store_false",
                             help="stand up as a wall facing south (default)")
    orientation.add_argument("--flat", dest="flat", action="store_true",
                             help="lie flat on the ground, top of the picture to the north")
    image.set_defaults(flat=False)
    image.add_argument("--dither", action="store_true",
                       help="Floyd-Steinberg dithering (smoother gradients)")
    image.set_defaults(func=command_image)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.list:
            return command_list(args)
        if args.remove:
            return command_remove(args)
        if not getattr(args, "command", None):
            parser.print_help()
            return 2
        return args.func(args)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
