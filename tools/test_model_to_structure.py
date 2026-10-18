"""Unit tests for tools/model_to_structure.py.

Run from the repository root with::

    python3 -m unittest discover -s tools -p 'test_*.py'
"""

import io
import os
import struct
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_to_structure as mts  # noqa: E402


# --------------------------------------------------------------------------
# A tiny independent little-endian NBT reader, used to check the writer.
# --------------------------------------------------------------------------

def read_nbt(data: bytes):
    pos = 0

    def take(fmt):
        nonlocal pos
        values = struct.unpack_from("<" + fmt, data, pos)
        pos += struct.calcsize("<" + fmt)
        return values[0]

    def string():
        nonlocal pos
        length = take("H")
        text = data[pos:pos + length].decode("utf-8")
        pos += length
        return text

    def payload(tag):
        if tag == 1:
            return ("byte", take("b"))
        if tag == 3:
            return ("int", take("i"))
        if tag == 8:
            return ("string", string())
        if tag == 9:
            item_tag = take("b")
            count = take("i")
            return ("list", item_tag, [payload(item_tag) for _ in range(count)])
        if tag == 10:
            result = {}
            while True:
                child = take("b")
                if child == 0:
                    return ("compound", result)
                key = string()
                result[key] = payload(child)
        raise ValueError(f"unexpected tag {tag}")

    assert take("b") == 10
    assert string() == ""
    root = payload(10)
    assert pos == len(data), "trailing bytes after root compound"
    return root


def plain(value):
    """Strip the type tags from read_nbt output."""
    if value[0] == "compound":
        return {k: plain(v) for k, v in value[1].items()}
    if value[0] == "list":
        return [plain(v) for v in value[2]]
    return value[1]


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def cube_mesh(size=1.0, offset=(0.0, 0.0, 0.0), colour=None):
    """A closed axis aligned box made of quads, as a Mesh."""
    corners = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], float)
    corners = corners * size + np.array(offset)
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    faces = [t for q in quads for t in ((q[0], q[1], q[2]), (q[0], q[2], q[3]))]
    mesh = mts.Mesh(vertices=corners, faces=np.array(faces))
    if colour is not None:
        mesh.vertex_colours = np.tile(np.array(colour, float), (8, 1))
    return mesh


def sphere_mesh(radius=1.0, segments=12, rings=8):
    vertices = [(0.0, radius, 0.0)]
    for ring in range(1, rings):
        phi = np.pi * ring / rings
        for seg in range(segments):
            theta = 2 * np.pi * seg / segments
            vertices.append((radius * np.sin(phi) * np.cos(theta), radius * np.cos(phi),
                             radius * np.sin(phi) * np.sin(theta)))
    vertices.append((0.0, -radius, 0.0))
    bottom = len(vertices) - 1

    def idx(ring, seg):
        return 1 + (ring - 1) * segments + seg % segments

    faces = []
    for seg in range(segments):
        faces.append((0, idx(1, seg + 1), idx(1, seg)))
        faces.append((bottom, idx(rings - 1, seg), idx(rings - 1, seg + 1)))
        for ring in range(1, rings - 1):
            a, b = idx(ring, seg), idx(ring, seg + 1)
            c, d = idx(ring + 1, seg + 1), idx(ring + 1, seg)
            faces += [(a, b, c), (a, c, d)]
    return mts.Mesh(vertices=np.array(vertices), faces=np.array(faces))


class TempDirTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name, content, mode="w"):
        path = os.path.join(self.dir, name)
        with open(path, mode) as handle:
            handle.write(content)
        return path


# --------------------------------------------------------------------------
# Loaders
# --------------------------------------------------------------------------

class ObjTests(TempDirTest):
    def test_vertex_colours_quads_and_negative_indices(self):
        path = self.write("model.obj", "\n".join([
            "# comment",
            "v 0 0 0 1 0 0",
            "v 1 0 0 0 1 0",
            "v 1 1 0 0 0 1",
            "v 0 1 0 1 1 1",
            "vt 0 0", "vt 1 0", "vt 1 1", "vt 0 1",
            "vn 0 0 1",
            "f 1/1/1 2/2/1 3/3/1 4/4/1",      # quad with v/vt/vn
            "v 0 0 1 0.5 0.5 0.5",
            "f -1//1 -4//1 -5//1",           # negative indices, v//vn
            "f 1/1 2/2 3/3 4/4 5/1",          # pentagon, v/vt
        ]) + "\n")
        mesh = mts.load_obj(path)
        self.assertEqual(mesh.vertices.shape, (5, 3))
        self.assertEqual(len(mesh.faces), 2 + 1 + 3)
        np.testing.assert_array_equal(mesh.faces[0], [0, 1, 2])
        np.testing.assert_array_equal(mesh.faces[1], [0, 2, 3])
        np.testing.assert_array_equal(mesh.faces[2], [4, 1, 0])
        np.testing.assert_allclose(mesh.vertex_colours[0], [1, 0, 0])
        np.testing.assert_allclose(mesh.vertex_colours[4], [0.5, 0.5, 0.5])

    def test_colours_in_0_255_range_are_scaled(self):
        path = self.write("model.obj", "v 0 0 0 255 0 0\nv 1 0 0 0 255 0\nv 0 1 0 0 0 255\n"
                          "v 0 0 1\nf 1 2 3\nf 1 2 4\n")
        mesh = mts.load_obj(path)
        np.testing.assert_allclose(mesh.vertex_colours[0], [1, 0, 0])
        np.testing.assert_allclose(mesh.vertex_colours[3], mts.FALLBACK_COLOUR)

    def test_mtl_colour_and_texture(self):
        os.makedirs(os.path.join(self.dir, "tex"))
        Image.new("RGB", (4, 4), (0, 0, 255)).save(os.path.join(self.dir, "tex", "blue.png"))
        self.write("model.mtl", "newmtl red\nKd 1 0 0\n\nnewmtl textured\nKd 1 1 1\n"
                   "map_Kd -s 1 1 1 tex\\blue.png\n")
        path = self.write("model.obj", "mtllib model.mtl\n"
                          "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n"
                          "vt 0 0\nvt 1 0\nvt 1 1\n"
                          "usemtl red\nf 1 2 3\nusemtl textured\nf 1/1 3/3 4/2\n")
        mesh = mts.load_obj(path)
        np.testing.assert_allclose(mesh.face_colours[0], [1, 0, 0])
        self.assertEqual(mesh.face_texture.tolist(), [-1, 0])
        bary = np.array([[1 / 3, 1 / 3, 1 / 3]])
        colours = mts._sample_colours(mesh, np.array([0, 1]), bary)
        np.testing.assert_allclose(colours[0, 0], [1, 0, 0])
        np.testing.assert_allclose(colours[1, 0], [0, 0, 1])

    def test_no_colour_uses_fallback(self):
        path = self.write("m.obj", "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")
        mesh = mts.load_obj(path)
        colours = mts._sample_colours(mesh, np.array([0]), np.array([[1.0, 0, 0]]))
        np.testing.assert_allclose(colours[0, 0], mts.FALLBACK_COLOUR)


class PlyTests(TempDirTest):
    def test_ascii_with_uchar_colours_and_quads(self):
        path = self.write("m.ply", "\n".join([
            "ply", "format ascii 1.0", "comment test", "element vertex 4",
            "property float x", "property float y", "property float z",
            "property uchar red", "property uchar green", "property uchar blue",
            "element face 1", "property list uchar int vertex_indices", "end_header",
            "0 0 0 255 0 0", "1 0 0 0 255 0", "1 1 0 0 0 255", "0 1 0 255 255 255",
            "4 0 1 2 3"]) + "\n")
        mesh = mts.load_ply(path)
        self.assertEqual(mesh.faces.tolist(), [[0, 1, 2], [0, 2, 3]])
        np.testing.assert_allclose(mesh.vertex_colours[1], [0, 1, 0])

    def _binary_ply(self, faces, colour_type="float"):
        header = ["ply", "format binary_little_endian 1.0", "element vertex 5",
                  "property float x", "property float y", "property float z"]
        header += [f"property {colour_type} {c}" for c in ("red", "green", "blue")]
        header += [f"element face {len(faces)}", "property list uchar int vertex_indices",
                   "end_header"]
        body = b""
        for i in range(5):
            body += struct.pack("<3f", i, i * 2, i * 3)
            if colour_type == "float":
                body += struct.pack("<3f", 0.25, 0.5, 1.0)
            else:
                body += struct.pack("<3B", 64, 128, 255)
        for face in faces:
            body += struct.pack("<B", len(face)) + struct.pack(f"<{len(face)}i", *face)
        return self.write("b.ply", ("\n".join(header) + "\n").encode("ascii") + body, "wb")

    def test_binary_float_colours_triangles(self):
        mesh = mts.load_ply(self._binary_ply([(0, 1, 2), (2, 3, 4)]))
        self.assertEqual(mesh.faces.tolist(), [[0, 1, 2], [2, 3, 4]])
        np.testing.assert_allclose(mesh.vertices[4], [4, 8, 12])
        np.testing.assert_allclose(mesh.vertex_colours[0], [0.25, 0.5, 1.0])

    def test_binary_uchar_colours_mixed_polygons(self):
        mesh = mts.load_ply(self._binary_ply([(0, 1, 2), (0, 1, 2, 3), (1, 2, 3, 4)], "uchar"))
        self.assertEqual(mesh.faces.tolist(),
                         [[0, 1, 2], [0, 1, 2], [0, 2, 3], [1, 2, 3], [1, 3, 4]])
        np.testing.assert_allclose(mesh.vertex_colours[0], [64 / 255, 128 / 255, 1.0])

    def test_binary_all_quads(self):
        mesh = mts.load_ply(self._binary_ply([(0, 1, 2, 3), (1, 2, 3, 4)]))
        self.assertEqual(mesh.faces.tolist(), [[0, 1, 2], [0, 2, 3], [1, 2, 3], [1, 3, 4]])


# --------------------------------------------------------------------------
# Voxelisation
# --------------------------------------------------------------------------

class VoxeliseTests(unittest.TestCase):
    def setUp(self):
        self.palette = mts.Palette.from_spec("concrete")

    def test_cube_gives_closed_shell_of_right_size(self):
        grid = mts.voxelise(cube_mesh(2.0, offset=(5, -3, 7)), 16)
        self.assertEqual(grid.occupied.shape, (16, 16, 16))
        self.assertEqual(int(grid.occupied.sum()), 16 ** 3 - 14 ** 3)
        outside = mts.outside_air(grid.occupied)
        self.assertFalse(outside[1:-1, 1:-1, 1:-1].any(), "air leaked into the cube")

    def test_hollow_and_solid_statues(self):
        hollow = mts.model_to_statue(cube_mesh(colour=(1, 1, 1)), 10, self.palette)
        solid = mts.model_to_statue(cube_mesh(colour=(1, 1, 1)), 10, self.palette, solid=True)
        self.assertEqual(hollow.block_count, 10 ** 3 - 8 ** 3)
        self.assertEqual(solid.block_count, 10 ** 3)
        self.assertEqual(solid.usage(), [("minecraft:white_concrete", 1000)])

    def test_sphere_shell_is_watertight(self):
        for size in (7, 20, 41):
            grid = mts.voxelise(sphere_mesh(), size)
            outside = mts.outside_air(grid.occupied)
            enclosed = ~grid.occupied & ~outside
            self.assertTrue(enclosed.any(), f"sphere shell leaks at size {size}")
            centre = tuple(d // 2 for d in grid.occupied.shape)
            self.assertTrue(enclosed[centre])
            solid = mts.model_to_statue(sphere_mesh(), size, self.palette, solid=True)
            hollow = mts.model_to_statue(sphere_mesh(), size, self.palette)
            self.assertGreater(solid.block_count, hollow.block_count)
            self.assertEqual(solid.labels[centre] >= 0, True)
            self.assertEqual(hollow.labels[centre], -1)

    def test_size_scales_longest_side_and_up_axis(self):
        box = cube_mesh()
        box.vertices = box.vertices * np.array([1.0, 0.5, 2.0])  # longest along z
        self.assertEqual(mts.voxelise(box, 20).occupied.shape, (10, 5, 20))
        # Blender style Z-up: the long z axis becomes height.
        self.assertEqual(mts.voxelise(box, 20, up="z").occupied.shape, (10, 20, 5))
        self.assertEqual(mts.voxelise(box, 20, rotate=90).occupied.shape, (20, 5, 10))

    def test_model_stands_on_lowest_point(self):
        statue = mts.model_to_statue(sphere_mesh(), 12, self.palette)
        self.assertTrue((statue.labels[:, 0, :] >= 0).any())
        self.assertTrue((statue.labels[:, -1, :] >= 0).any())

    def test_open_mesh_solid_still_works(self):
        mesh = cube_mesh()
        mesh.faces = mesh.faces[2:]  # remove one side
        with redirect_stderr(io.StringIO()) as err:
            statue = mts.model_to_statue(mesh, 8, self.palette, solid=True)
        self.assertIn("no closed interior", err.getvalue())
        self.assertEqual(statue.block_count, 8 ** 3 - 6 ** 3 - 6 ** 2)  # one side open

    def test_colours_follow_vertex_colours(self):
        mesh = cube_mesh()
        mesh.vertex_colours = np.where(mesh.vertices[:, 1:2] > 0.5, [0.0, 0.0, 1.0], [1.0, 1.0, 0.0])
        statue = mts.model_to_statue(mesh, 16, mts.Palette.from_spec("wool"))
        top = {statue.block_ids[i] for i in statue.labels[:, -1, :].ravel() if i >= 0}
        bottom = {statue.block_ids[i] for i in statue.labels[:, 0, :].ravel() if i >= 0}
        self.assertEqual(top, {"minecraft:blue_wool"})
        self.assertEqual(bottom, {"minecraft:yellow_wool"})


# --------------------------------------------------------------------------
# Colour matching
# --------------------------------------------------------------------------

class ColourTests(unittest.TestCase):
    def test_ciede2000_reference_values(self):
        # Pairs 1, 7, 17 and 25 from Sharma, Wu and Dalal (2005), table 1.
        pairs = [((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
                 ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
                 ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
                 ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644)]
        for lab1, lab2, expected in pairs:
            self.assertAlmostEqual(float(mts.delta_e_2000(lab1, lab2)), expected, places=4)
            self.assertAlmostEqual(float(mts.delta_e_2000(lab2, lab1)), expected, places=4)

    def test_lab_of_white_and_black(self):
        np.testing.assert_allclose(mts.srgb_to_lab([1, 1, 1]), [100, 0, 0], atol=0.01)
        np.testing.assert_allclose(mts.srgb_to_lab([0, 0, 0]), [0, 0, 0], atol=0.01)

    def test_pure_colours(self):
        palette = mts.Palette.from_spec("concrete,wool,terracotta")
        cases = {(1, 1, 1): "white", (0, 0, 0): "black", (1, 0, 0): "red",
                 (1, 1, 0): "yellow", (0, 0, 1): "blue", (1, 0.5, 0): "orange",
                 (0, 1, 1): "cyan", (1, 0, 1): "magenta"}
        found = palette.match(list(cases))
        for (colour, name), index in zip(cases.items(), found):
            block = palette.block_ids[index]
            self.assertTrue(block.startswith(f"minecraft:{name}_"), f"{colour} -> {block}")

    def test_every_block_matches_itself(self):
        palette = mts.Palette.from_spec("all")
        found = palette.match(palette.srgb)
        self.assertEqual([palette.block_ids[i] for i in found], palette.block_ids)

    def test_palette_spec(self):
        palette = mts.Palette.from_spec("terracotta, gold_block,minecraft:snow")
        self.assertEqual(len(palette.block_ids), 19)
        self.assertIn("minecraft:hardened_clay", palette.block_ids)
        self.assertEqual(palette.block_ids[-2:], ["minecraft:gold_block", "minecraft:snow"])
        with self.assertRaises(ValueError):
            mts.Palette.from_spec("glass")

    def test_palette_blocks_are_known(self):
        for group in mts.PALETTE_GROUPS.values():
            for block in group:
                self.assertIn(block, mts.BLOCK_COLOURS)
        for block in mts.BLOCK_STATES:
            self.assertIn(block, mts.BLOCK_COLOURS)


# --------------------------------------------------------------------------
# Images
# --------------------------------------------------------------------------

class ImageTests(TempDirTest):
    def setUp(self):
        super().setUp()
        image = Image.new("RGBA", (3, 2), (255, 255, 255, 255))
        image.putpixel((0, 0), (170, 30, 30, 255))  # top left red
        image.putpixel((2, 1), (0, 0, 0, 0))        # bottom right transparent
        self.path = os.path.join(self.dir, "art.png")
        image.save(self.path)
        self.palette = mts.Palette.from_spec("concrete")

    def test_vertical_wall(self):
        statue = mts.image_to_statue(self.path, 3, self.palette)
        self.assertEqual(statue.size, (3, 2, 1))
        self.assertEqual(statue.block_ids[statue.labels[0, 1, 0]], "minecraft:red_concrete")
        self.assertEqual(statue.labels[2, 0, 0], -1)
        self.assertEqual(statue.block_count, 5)

    def test_flat_floor_and_upscaling(self):
        statue = mts.image_to_statue(self.path, 6, self.palette, flat=True)
        self.assertEqual(statue.size, (6, 1, 4))
        self.assertEqual(statue.block_ids[statue.labels[0, 0, 0]], "minecraft:red_concrete")
        self.assertEqual(statue.block_ids[statue.labels[1, 0, 1]], "minecraft:red_concrete")
        self.assertEqual(statue.labels[5, 0, 3], -1)

    def test_dither_runs(self):
        gradient = Image.linear_gradient("L").resize((16, 16)).convert("RGBA")
        path = os.path.join(self.dir, "grad.png")
        gradient.save(path)
        statue = mts.image_to_statue(path, 16, self.palette, dither=True)
        self.assertEqual(statue.block_count, 256)
        self.assertGreater(len(statue.usage()), 2)


# --------------------------------------------------------------------------
# NBT output
# --------------------------------------------------------------------------

class NbtTests(unittest.TestCase):
    def test_round_trip_and_index_order(self):
        ids = ["minecraft:stone", "minecraft:deepslate", "minecraft:white_wool"]
        labels = np.full((2, 3, 4), -1, dtype=np.int64)
        labels[1, 0, 0] = 1     # x = 1
        labels[0, 2, 0] = 2     # y = 2
        labels[0, 0, 3] = 1     # z = 3
        statue = mts.Statue(labels, ids)
        root = plain(read_nbt(mts.structure_nbt(statue)))

        self.assertEqual(root["format_version"], 1)
        self.assertEqual(root["size"], [2, 3, 4])
        self.assertEqual(root["structure_world_origin"], [0, 0, 0])
        structure = root["structure"]
        self.assertEqual(structure["entities"], [])
        palette = structure["palette"]["default"]
        self.assertEqual(palette["block_position_data"], {})
        names = [b["name"] for b in palette["block_palette"]]
        self.assertEqual(names, ["minecraft:deepslate", "minecraft:white_wool"])  # stone unused
        self.assertEqual(palette["block_palette"][0]["states"], {"pillar_axis": "y"})
        self.assertEqual(palette["block_palette"][1]["states"], {})
        self.assertEqual(palette["block_palette"][0]["version"], 0x01152800)

        primary, secondary = structure["block_indices"]
        self.assertEqual(len(primary), 24)
        self.assertEqual(secondary, [-1] * 24)

        def at(x, y, z):  # Bedrock order: z fastest, then y, then x
            return primary[(x * 3 + y) * 4 + z]

        self.assertEqual(names[at(1, 0, 0)], "minecraft:deepslate")
        self.assertEqual(names[at(0, 2, 0)], "minecraft:white_wool")
        self.assertEqual(names[at(0, 0, 3)], "minecraft:deepslate")
        self.assertEqual(primary.count(-1), 21)
        self.assertEqual(primary[12], 0)   # x = 1 starts after 3 * 4 entries
        self.assertEqual(primary[8], 1)    # y = 2 starts after 2 * 4 entries
        self.assertEqual(primary[3], 0)    # z = 3


# --------------------------------------------------------------------------
# Script registration and the command line
# --------------------------------------------------------------------------

SCRIPT = """import { world } from "@minecraft/server";

  // @generated statues begin (tools/model_to_structure.py)
  const STATUES = [
    { name: "Zebra", structure: "helpertools_statues:zebra", size: [3, 4, 5] },
    { name: "Rubber Duck", structure: "helpertools_statues:rubber_duck", size: [12, 10, 14] }
  ];
  // @generated statues end

function after() {}
"""


class RegisterTests(TempDirTest):
    def setUp(self):
        super().setUp()
        self.script = self.write("main.js", SCRIPT)

    def read(self):
        with open(self.script, encoding="utf-8", newline="") as handle:
            return handle.read()

    def test_add_replace_sort_and_remove(self):
        mts.update_statue_entries(self.script, add=mts.StatueEntry(
            "Apple \"Tree\"", "helpertools_statues:apple", (1, 2, 3)))
        mts.update_statue_entries(self.script, add=mts.StatueEntry(
            "Duck", "helpertools_statues:rubber_duck", (11, 12, 16)))
        text = self.read()
        self.assertTrue(text.startswith('import { world } from "@minecraft/server";\n\n'))
        self.assertTrue(text.endswith("  // @generated statues end\n\nfunction after() {}\n"))
        expected = [
            "  const STATUES = [",
            '    { name: "Apple \\"Tree\\"", structure: "helpertools_statues:apple", '
            "size: [1, 2, 3] },",
            '    { name: "Duck", structure: "helpertools_statues:rubber_duck", '
            "size: [11, 12, 16] },",
            '    { name: "Zebra", structure: "helpertools_statues:zebra", size: [3, 4, 5] }',
            "  ];",
        ]
        lines = text.split("\n")
        start = lines.index("  " + mts.REGION_BEGIN)
        self.assertEqual(lines[start + 1:start + 6], expected)
        entries = mts.read_statue_entries(text)
        self.assertEqual(entries[0].name, 'Apple "Tree"')

        mts.update_statue_entries(self.script, remove="helpertools_statues:zebra")
        mts.update_statue_entries(self.script, remove="helpertools_statues:apple")
        mts.update_statue_entries(self.script, remove="helpertools_statues:rubber_duck")
        self.assertIn("  const STATUES = [];\n  // @generated statues end", self.read())
        mts.update_statue_entries(self.script, add=mts.StatueEntry(
            "Duck", "helpertools_statues:rubber_duck", (1, 1, 1)))
        self.assertEqual(len(mts.read_statue_entries(self.read())), 1)

    def test_crlf_is_preserved(self):
        self.write("main.js", SCRIPT.replace("\n", "\r\n"))
        mts.update_statue_entries(self.script, add=mts.StatueEntry(
            "Ant", "helpertools_statues:ant", (1, 1, 1)))
        text = self.read()
        self.assertNotIn("\n", text.replace("\r\n", ""))
        self.assertEqual(len(mts.read_statue_entries(text)), 3)

    def test_missing_markers(self):
        self.write("main.js", "const STATUES = [];\n")
        with self.assertRaises(mts.RegionError):
            mts.update_statue_entries(self.script, add=mts.StatueEntry("A", "x:a", (1, 1, 1)))
        self.assertEqual(self.read(), "const STATUES = [];\n")

    def test_command_line_end_to_end(self):
        out_dir = os.path.join(self.dir, "structures")
        obj = self.write("Blue_Box.obj", "v 0 0 0 0 0 1\nv 1 0 0 0 0 1\nv 1 1 0 0 0 1\n"
                         "v 0 1 0 0 0 1\nv 0 0 1 0 0 1\nv 1 0 1 0 0 1\nv 1 1 1 0 0 1\n"
                         "v 0 1 1 0 0 1\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\n"
                         "f 3 7 8 4\nf 5 1 4 8\n")
        common = ["--script", self.script, "--out-dir", out_dir]
        with redirect_stdout(io.StringIO()) as out:
            self.assertEqual(mts.main(["model", obj, "--size", "5", "--solid"] + common), 0)
        self.assertIn("helpertools_statues:blue_box", out.getvalue())
        path = os.path.join(out_dir, "blue_box.mcstructure")
        with open(path, "rb") as handle:
            root = plain(read_nbt(handle.read()))
        self.assertEqual(root["size"], [5, 5, 5])
        entries = {e.structure: e for e in mts.read_statue_entries(self.read())}
        self.assertEqual(entries["helpertools_statues:blue_box"].name, "Blue Box")
        self.assertEqual(entries["helpertools_statues:blue_box"].size, (5, 5, 5))

        with redirect_stdout(io.StringIO()) as out:
            mts.main(["--list"] + common)
        self.assertIn("helpertools_statues:blue_box", out.getvalue())

        with redirect_stdout(io.StringIO()):
            mts.main(["--remove", "blue_box"] + common)
        self.assertFalse(os.path.exists(path))
        self.assertNotIn("blue_box", self.read())

        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(mts.main(["model", obj, "--name", "Bad-Name"] + common), 2)
            self.assertEqual(mts.main(["image", obj] + common), 1)  # not an image

    def test_names(self):
        self.assertEqual(mts.clean_name("My Scan (final) v2"), "my_scan_final_v2")
        self.assertEqual(mts.title_from("rubber_duck-scan"), "Rubber Duck Scan")


if __name__ == "__main__":
    unittest.main()
