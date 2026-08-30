#!/usr/bin/env python3
"""Import the hand-edited DAZREN PSD into a fresh SYMBIES project.

The source PSD is treated as artwork data. Each production trait pixel layer is
expanded back onto the 2000x2000 NFT canvas and registered in the art engine.
Known trait metadata and weights are carried forward from SYMBIES Prime; no
SYMBIES Prime artwork is copied.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image
from psd_tools import PSDImage


CANVAS = (2000, 2000)
TIER_WEIGHTS = {
    "common": 100,
    "uncommon": 35,
    "rare": 12,
    "epic": 4,
    "legendary": 1,
}
NONE_PROBABILITY = {
    "clothing": 0.08,
    "ear": 0.30,
    "mark": 0.25,
    "glasses": 0.45,
    "headwear": 0.10,
}

CATEGORY_SPECS = (
    {
        "id": "background",
        "name": "Background",
        "order": 1,
        "group_prefix": "01 Background",
        "slot": "000_BACKGROUND",
        "optional": False,
    },
    {
        "id": "body",
        "name": "Body",
        "order": 2,
        "group_prefix": "03 Body",
        "slot": "300_BODY",
        "optional": False,
    },
    {
        "id": "eyes",
        "name": "Eyes",
        "order": 3,
        "group_prefix": "04 Eyes",
        "slot": "400_EYES",
        "optional": False,
    },
    {
        "id": "clothing",
        "name": "Clothing",
        "order": 4,
        "group_prefix": "05 Clothing",
        "slot": "500_CLOTHING_FRONT",
        "optional": True,
    },
    {
        "id": "ear",
        "name": "Ear / Side Accessory",
        "order": 5,
        "group_prefix": "06 Ear",
        "slot": "600_EAR_FRONT",
        "optional": True,
    },
    {
        "id": "mark",
        "name": "Mark",
        "order": 6,
        "group_prefix": "07 Mark",
        "slot": "700_MARK",
        "optional": True,
    },
    {
        "id": "glasses",
        "name": "Eyewear",
        "order": 7,
        "group_prefix": "08 Eyewear",
        "slot": "800_GLASSES",
        "optional": True,
    },
    {
        "id": "headwear",
        "name": "Headwear",
        "order": 8,
        "group_prefix": "09 Headwear",
        "slot": "1010_HEADWEAR_OVER",
        "optional": True,
    },
)

# The unnamed Photoshop headwear layers retain the ordering from the original
# Rocky export. Index 13 contains two disconnected sketch components; both are
# split into first-class temporary traits for manual cleanup.
HEADWEAR_BY_INDEX = {
    0: ("Black Cap", "headwear_black_cap"),
    1: ("Charcoal Beanie", "headwear_charcoal_beanie"),
    2: ("Cipher Chef Toque", "headwear_cipher_chef_toque"),
    3: ("Cipher Newsboy", "headwear_cipher_newsboy"),
    4: ("Cipher Sailor Cap", "headwear_cipher_sailor_cap"),
    5: ("Ember Ronin Kabuto", "headwear_ember_ronin_kabuto"),
    6: ("Obsidian Bowler", "headwear_obsidian_bowler"),
    7: ("Obsidian Cowboy Hat", "headwear_obsidian_cowboy_hat"),
    8: ("Obsidian Crown", "headwear_obsidian_crown"),
    9: ("Obsidian Horns", "headwear_obsidian_horns"),
    10: ("Obsidian Top Hat", "headwear_obsidian_top_hat"),
    11: ("Obsidian Tricorn", "headwear_obsidian_tricorn"),
    12: ("Purple Halo", "headwear_purple_halo"),
    14: ("Purple Jester Cap", "headwear_purple_jester_cap"),
    15: ("Robin Cycle Helmet", "headwear_robin_cycle_helmet"),
    16: ("Robin Fez", "headwear_robin_fez"),
    17: ("Robin Halo", "headwear_robin_halo"),
    18: ("Robin Hardhat", "headwear_robin_hardhat"),
    19: ("Signal Audio Headset", "headwear_signal_audio_headset"),
    20: ("Signal Bandana", "headwear_signal_bandana"),
    21: ("Signal Bucket", "headwear_signal_bucket"),
    22: ("Signal Cadet Cap", "headwear_signal_cadet_cap"),
    23: ("Signal Lynx Headband", "headwear_signal_lynx_headband"),
    24: ("Signal Trucker", "headwear_signal_trucker"),
    25: ("Signal Visor", "headwear_signal_visor"),
    26: ("Void Aviator Cap", "headwear_void_aviator_cap"),
    27: ("Void Beret", "headwear_void_beret"),
    28: ("Void Ranger", "headwear_void_ranger"),
    29: ("Void Sorcerer Hood", "headwear_void_sorcerer_hood"),
    30: ("Void Ushanka", "headwear_void_ushanka"),
}

EAR_BY_INDEX = {
    0: ("Antenna Stub", "ear_antenna"),
    1: ("Barcode Tag", "ear_barcode_tag"),
    2: ("Big Hoop", "ear_big_hoop"),
    3: ("Black Hoop", "ear_black_hoop"),
    4: ("Black Stud", "ear_black_stud"),
    5: ("Bone Charm", "ear_bone_tag"),
    6: ("Bone Splinter", "ear_bone_splinter"),
    7: ("Chain Drop", "ear_chain_drop"),
    8: ("Chip Tag", "ear_chip_tag"),
    9: ("Crystal Shard", "ear_crystal_shard"),
    10: ("Ear Cuff", "ear_cuff"),
    11: ("Ember Bead", "ear_ember_bead"),
    12: ("Gauge Plug", "ear_gauge"),
    13: ("Industrial Bar", "ear_industrial_bar"),
    14: ("Jack Plug", "ear_jack_plug"),
    15: ("LED Dot", "ear_led_dot"),
    16: ("Padlock", "ear_padlock"),
    17: ("Rune Ring", "ear_rune_ring"),
    18: ("Safety Pin", "ear_safety_pin"),
    19: ("Signal Drop", "ear_signal_drop"),
    20: ("Glitch Ring", "ear_glitch_ring"),
    21: ("Signal Hoop", "ear_signal_hoop"),
    22: ("Signal Stud", "ear_amethyst_stud"),
    23: ("Silver Hoop", "ear_silver_hoop"),
    24: ("Spike", "ear_spike"),
    25: ("Square Stud", "ear_square_stud"),
    26: ("Thorn", "ear_thorn"),
    27: ("Triple Ring", "ear_triple_ring"),
    28: ("Twin Rings", "ear_twin_rings"),
    29: ("X Tag", "ear_x_tag"),
}

ID_PATTERN = re.compile(r"^(.*?)\s*\[([^\]]+)\]\s*$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slug_from_id(category: str, trait_id: str) -> str:
    prefix = f"{category}_"
    value = trait_id[len(prefix) :] if trait_id.startswith(prefix) else trait_id
    return value.replace("_", "-")


def family_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")


def load_templates(prime_root: Path) -> dict[str, dict[str, Any]]:
    templates: dict[str, dict[str, Any]] = {}
    for path in sorted((prime_root / "traits").rglob("*.json")):
        data = json.loads(path.read_text())
        templates[data["id"]] = data
    return templates


def group_for(psd: PSDImage, prefix: str):
    matches = [layer for layer in psd if layer.is_group() and layer.name.startswith(prefix)]
    if len(matches) != 1:
        raise ValueError(f"Expected one PSD group starting with {prefix!r}, found {len(matches)}")
    return matches[0]


def parse_layer_identity(category: str, index: int, layer) -> tuple[str, str] | None:
    if category == "headwear":
        return HEADWEAR_BY_INDEX.get(index)
    if category == "ear":
        return EAR_BY_INDEX[index]

    match = ID_PATTERN.match(layer.name)
    if match:
        name = match.group(1).strip()
        trait_id = match.group(2).strip()
    else:
        name = layer.name.strip()
        trait_id = ""

    if category == "body" and index == 1:
        return "Obsidian Granite", "body_theme_obsidian_granite"
    if category == "body" and index == 30:
        return "Indigo", "body_indigo"
    if category == "eyes" and index == 17:
        return "Sleep", "eyes_sleep"
    if category == "clothing" and index == 21:
        return "Leather Jacket", "clothing_leather_jacket"
    if category == "clothing" and index == 22:
        return "Kimono", "clothing_kimono"
    if category == "glasses" and index == 24:
        return "Ski Goggles", "glasses_ski_goggles"

    if not re.fullmatch(r"[a-z0-9_]+", trait_id):
        raise ValueError(
            f"Layer {category}[{index}] {layer.name!r} has no canonical trait id"
        )
    return name, trait_id


def template_for(
    trait_id: str,
    templates: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    alias = {
        "eyes_sleep": "eyes_rest",
    }.get(trait_id, trait_id)
    value = templates.get(alias)
    return copy.deepcopy(value) if value else None


def new_trait_defaults(category: str, name: str, trait_id: str) -> dict[str, Any]:
    defaults = {
        "body_theme_obsidian_granite": (
            "rare",
            {"primary": "black", "secondary": "granite", "temperature": "neutral"},
        ),
        "headwear_unnamed_sketch_01": (
            "legendary",
            {"primary": "black", "temperature": "neutral"},
        ),
        "headwear_unnamed_sketch_02": (
            "legendary",
            {"primary": "black", "temperature": "neutral"},
        ),
        "clothing_leather_jacket": ("rare", {"primary": "black", "accent": "purple"}),
        "clothing_kimono": ("epic", {"primary": "black", "accent": "purple"}),
    }
    tier, palette = defaults.get(trait_id, ("uncommon", {}))
    result: dict[str, Any] = {
        "id": trait_id,
        "category": category,
        "name": name,
        "family": f"{category}:{family_slug(name)}",
        "rarity": {"weight": TIER_WEIGHTS[tier], "tier": tier, "min": 1},
    }
    if palette:
        result["palette"] = palette
    if trait_id.startswith("headwear_unnamed_sketch_"):
        result["tags"] = ["draft", "manual-cleanup"]
    return result


def trait_manifest(
    category: str,
    name: str,
    trait_id: str,
    slot: str,
    asset_file: str,
    templates: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    result = template_for(trait_id, templates) or new_trait_defaults(
        category, name, trait_id
    )
    result["id"] = trait_id
    result["category"] = category
    result["name"] = name
    result.pop("none", None)
    result.pop("weight", None)
    result.setdefault("family", f"{category}:{family_slug(name)}")
    result.setdefault("rarity", {"weight": 35, "tier": "uncommon"})
    result["rarity"]["min"] = 1

    # Preserve the one established front-vs-over headwear distinction. Every
    # other category uses the explicit production order requested for SYMBIES.
    if category == "headwear" and result.get("assets"):
        old_slot = result["assets"][0].get("slot")
        if old_slot in {"1000_HEADWEAR_FRONT", "1010_HEADWEAR_OVER"}:
            slot = old_slot
    result["assets"] = [{"slot": slot, "file": asset_file}]
    return result


def none_manifest(
    category: str,
    art_traits: list[dict[str, Any]],
    templates: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    trait_id = f"{category}_none"
    result = copy.deepcopy(templates[trait_id])
    art_weight = sum(float(item["rarity"]["weight"]) for item in art_traits)
    probability = NONE_PROBABILITY[category]
    none_weight = max(1, round(probability * art_weight / (1.0 - probability)))
    result["rarity"]["weight"] = none_weight
    result["rarity"]["min"] = 1
    result["assets"] = []
    return result


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def split_headwear_sketches(image: Image.Image) -> list[Image.Image]:
    rgba = np.array(image.convert("RGBA"))
    alpha = rgba[:, :, 3]
    component_count, labels, stats, _centroids = cv2.connectedComponentsWithStats(
        (alpha > 0).astype(np.uint8), connectivity=8
    )
    components = sorted(
        range(1, component_count), key=lambda label: int(stats[label, 4]), reverse=True
    )
    if len(components) != 2:
        raise ValueError(
            f"Expected two disconnected unnamed headwear sketches, found {len(components)}"
        )
    results: list[Image.Image] = []
    for label in components:
        separated = rgba.copy()
        separated[:, :, 3] = np.where(labels == label, alpha, 0).astype(np.uint8)
        results.append(Image.fromarray(separated, mode="RGBA"))
    return results


def build_project(psd_path: Path, prime_root: Path, output: Path) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError(f"Refusing to replace existing output: {output}")
    if not psd_path.is_file():
        raise FileNotFoundError(psd_path)
    if not (prime_root / "traits").is_dir():
        raise FileNotFoundError(prime_root / "traits")

    psd = PSDImage.open(psd_path)
    if psd.size != CANVAS:
        raise ValueError(f"PSD is {psd.size}, expected {CANVAS}")

    templates = load_templates(prime_root)
    output.mkdir(parents=True)
    records: list[dict[str, Any]] = []
    manifests_by_category: dict[str, list[dict[str, Any]]] = {}
    excluded_layers = [
        {
            "category": "background",
            "layer": "Background",
            "reason": "opaque white Photoshop document background, not a registered trait",
        },
    ]

    for spec in CATEGORY_SPECS:
        category = spec["id"]
        group = group_for(psd, spec["group_prefix"])
        category_traits: list[dict[str, Any]] = []
        assets_dir = output / "assets" / category
        traits_dir = output / "traits" / category
        assets_dir.mkdir(parents=True, exist_ok=True)
        traits_dir.mkdir(parents=True, exist_ok=True)

        for index, layer in enumerate(group):
            if layer.is_group() or layer.kind != "pixel":
                raise ValueError(f"Unexpected non-pixel child in {group.name}: {layer.name}")
            source_image = layer.topil().convert("RGBA")
            if source_image.size != CANVAS:
                canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
                canvas.alpha_composite(source_image, (int(layer.left), int(layer.top)))
                source_image = canvas

            if category == "headwear" and index == 13:
                layer_traits = [
                    (
                        "Unnamed Headwear Sketch 1",
                        "headwear_unnamed_sketch_01",
                        sketch,
                        component_index,
                    )
                    for component_index, sketch in enumerate(
                        split_headwear_sketches(source_image), start=1
                    )
                ]
                layer_traits[1] = (
                    "Unnamed Headwear Sketch 2",
                    "headwear_unnamed_sketch_02",
                    layer_traits[1][2],
                    2,
                )
            else:
                identity = parse_layer_identity(category, index, layer)
                if identity is None:
                    continue
                name, trait_id = identity
                layer_traits = [(name, trait_id, source_image, None)]

            for name, trait_id, image, component_index in layer_traits:
                if any(item["id"] == trait_id for item in category_traits):
                    raise ValueError(f"Duplicate canonical trait id after mapping: {trait_id}")
                bbox = image.getchannel("A").getbbox()
                if bbox is None:
                    raise ValueError(f"Production trait {trait_id} is alpha-empty")
                if category == "background" and bbox != (0, 0, *CANVAS):
                    raise ValueError(f"Background {trait_id} does not fill the canvas: {bbox}")

                slug = slug_from_id(category, trait_id)
                asset_relative = f"{category}/{slug}.png"
                asset_path = output / "assets" / asset_relative
                image.save(asset_path, format="PNG", optimize=True, compress_level=9)

                manifest = trait_manifest(
                    category,
                    name,
                    trait_id,
                    spec["slot"],
                    asset_relative,
                    templates,
                )
                category_traits.append(manifest)
                write_json(output / "traits" / category / f"{slug}.json", manifest)
                records.append(
                    {
                        "category": category,
                        "sourceGroup": group.name,
                        "sourceLayerIndex": index,
                        "sourceLayer": layer.name,
                        "sourceComponent": component_index,
                        "sourceLayerOpacity": int(layer.opacity),
                        "traitId": trait_id,
                        "traitName": name,
                        "asset": f"assets/{asset_relative}",
                        "alphaBBox": list(bbox),
                        "sha256": sha256_file(asset_path),
                    }
                )

        if spec["optional"]:
            none = none_manifest(category, category_traits, templates)
            write_json(output / "traits" / category / "none.json", none)
            category_traits.append(none)
        manifests_by_category[category] = category_traits

    categories = []
    for spec in CATEGORY_SPECS:
        category: dict[str, Any] = {
            "id": spec["id"],
            "name": spec["name"],
            "order": spec["order"],
        }
        if spec["id"] == "background":
            category["selectAfterCharacter"] = True
        if spec["optional"]:
            category.update(
                {
                    "optional": True,
                    "emitNoneInMetadata": True,
                    "includeNoneInDna": True,
                }
            )
        categories.append(category)

    project = {
        "name": "SYMBIES",
        "slug": "symbies",
        "description": "Born from code. Driven by curiosity. Symbies evolve through data, culture, and the infinite possibilities of the SYMBaiEX ecosystem.",
        "projectVersion": "2.0.0",
        "engineVersion": "0.1",
        "traitSchemaVersion": "1",
        "canvas": {"width": 2000, "height": 2000},
        "slots": [
            "000_BACKGROUND",
            "300_BODY",
            "400_EYES",
            "500_CLOTHING_FRONT",
            "600_EAR_FRONT",
            "700_MARK",
            "800_GLASSES",
            "1000_HEADWEAR_FRONT",
            "1010_HEADWEAR_OVER",
        ],
        "categories": categories,
        "metadata": {
            "nameTemplate": "Symbie #{editionPadded}",
            "descriptionTemplate": "A Symbie from the SYMBaiEX ecosystem.",
            "imageTemplate": "ipfs://PLACEHOLDER/{editionPadded}.png",
            "editionPadding": 4,
        },
        "generation": {
            "maxRerolls": 500,
            "allowDuplicates": False,
            "paletteRerollBelow": 20,
        },
        "fixedEditions": [
            {
                "edition": 1,
                "traits": {
                    "background": "background_void",
                    "body": "body_standard_charcoal",
                    "eyes": "eyes_signal",
                    "clothing": "clothing_black_hoodie",
                    "ear": "ear_x_tag",
                    "mark": "mark_diamond_rune",
                    "glasses": "glasses_none",
                    "headwear": "headwear_black_cap",
                },
            }
        ],
    }
    write_json(output / "project.json", project)

    old_rules = json.loads((prime_root / "rules" / "rules.json").read_text())
    rules = copy.deepcopy(old_rules)
    rules["synergies"] = [
        item
        for item in rules.get("synergies", [])
        if not any(
            selector.startswith("Back:") or selector.startswith("Special Effect:")
            for selector in item.get("when", [])
        )
    ]
    write_json(output / "rules" / "rules.json", rules)

    rarity_profile = {
        "schemaVersion": 1,
        "description": "Canonical SYMBIES rarity profile rebuilt from the hand-edited DAZREN PSD. Every registered trait has a positive weight and a one-use coverage minimum.",
        "tierWeights": TIER_WEIGHTS,
        "noneProbabilityByCategory": NONE_PROBABILITY,
        "coverage": {
            "minimumPerTrait": 1,
            "defaultExcludedCategories": [],
            "referenceGenerationCount": 500,
        },
    }
    write_json(output / "rarity-profile.json", rarity_profile)

    category_counts = {
        category: {
            "artwork": sum(1 for item in traits if not item.get("none")),
            "none": sum(1 for item in traits if item.get("none")),
            "registered": len(traits),
            "totalWeight": sum(float(item["rarity"]["weight"]) for item in traits),
        }
        for category, traits in manifests_by_category.items()
    }
    report = {
        "sourcePsd": str(psd_path),
        "sourcePsdSha256": sha256_file(psd_path),
        "sourcePsdBytes": psd_path.stat().st_size,
        "canvas": {"width": 2000, "height": 2000},
        "outputProject": str(output),
        "categoryOrder": [spec["id"] for spec in CATEGORY_SPECS],
        "categoryCounts": category_counts,
        "artworkTraits": len(records),
        "noneTraits": sum(item["none"] for item in category_counts.values()),
        "registeredTraits": sum(item["registered"] for item in category_counts.values()),
        "excludedLayers": excluded_layers,
        "missingFromUpdatedPsd": [
            "background_obsidian",
            "back category",
            "special category",
        ],
        "records": records,
    }
    write_json(output / "import-report.json", report)

    (output / "README.md").write_text(
        "# SYMBIES\n\n"
        "Fresh production project imported from `/Users/symbiex/Downloads/dazren.psd`.\n\n"
        "## Layer order\n\n"
        "1. Background\n2. Body\n3. Eyes\n4. Clothing\n5. Ear / Side Accessory\n"
        "6. Mark\n7. Eyewear\n8. Headwear\n\n"
        "Every artwork PNG is 2000x2000 RGBA and remains on the exact PSD canvas. "
        "Optional categories include a first-class None trait. All artwork and None "
        "traits have explicit rarity weights and `min: 1`. The Void Sorcerer Hood and "
        "Void Hoodie (Hood Up) retain their reciprocal pairing requirement.\n\n"
        "`import-report.json` records the source PSD checksum, every extracted layer, "
        "alpha bounds, output checksums, and intentionally excluded Photoshop leftovers.\n"
    )
    (output / "pipeline").mkdir(parents=True, exist_ok=True)
    (output / "pipeline" / "README.md").write_text(
        "# Pipeline\n\n"
        "Validate with:\n\n"
        "```sh\n"
        "bun run --cwd packages/sym-art-engine sym -- validate symbies\n"
        "```\n"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--psd", type=Path, required=True)
    parser.add_argument("--prime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = build_project(args.psd.resolve(), args.prime.resolve(), args.output.resolve())
    print(
        json.dumps(
            {
                "outputProject": report["outputProject"],
                "artworkTraits": report["artworkTraits"],
                "noneTraits": report["noneTraits"],
                "registeredTraits": report["registeredTraits"],
                "categoryCounts": report["categoryCounts"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
