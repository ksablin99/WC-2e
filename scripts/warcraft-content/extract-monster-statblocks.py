"""Extract Monster Guide statblock tables into a deterministic review catalogue.

The Monster Guide is a native-text PDF, but many entries place two or more
creatures in parallel columns.  This extractor uses word coordinates and the
Hit Dice value in each column as the anchor.  It intentionally captures only
the compact statblock fields; descriptive book prose and artwork are excluded.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "WoW - Monster Guide [2007] {WW17212}.pdf"
OUTPUT = Path(__file__).with_name("warcraft-monster-statblocks.json")
PAGE_MAP = Path(__file__).with_name("warcraft-monster-page-map.json")
OVERRIDES = Path(__file__).with_name("warcraft-monster-overrides.json")

FIRST_PDF_PAGE = 11
LAST_PDF_PAGE = 173

FIELD_LABELS = [
    "Hit Dice",
    "Initiative",
    "Speed",
    "Armor Class",
    "Base Attack/Grapple",
    "Attack",
    "Full Attack",
    "Space/Reach",
    "Special Attacks",
    "Special Qualities",
    "Saves",
    "Abilities",
    "Skills",
    "Feats",
    "Environment",
    "Area",
    "Organization",
    "Challenge Rating",
    "Treasure",
    "Alignment",
    "Advancement",
    "Level Adjustment",
]

SIZE_WORDS = {
    "Fine",
    "Diminutive",
    "Tiny",
    "Small",
    "Medium",
    "Large",
    "Huge",
    "Gargantuan",
    "Colossal",
}

HD_RE = re.compile(r"^\d+d\d+(?:[+\-]\d+)*$")


def sanitize_field(field: str, value: str) -> str:
    """Remove neighbouring rows/prose accidentally captured by PDF geometry.

    This is deliberately conservative: only fields with an unambiguous compact
    grammar are rewritten.  Anything ambiguous remains visible to validation
    and must be corrected in the reviewed override ledger.
    """
    value = normalize_text(value)
    if not value:
        return value

    patterns = {
        "Hit Dice": r"^(.+?\([\d,]+\s*hp\))",
        "Armor Class": r"^([+\-]?\d+.+?flat-?\s*footed\s+[+\-]?\d+)",
        "Saves": r"(Fort\s+[+\-]?\d+\s*,?\s*Ref\s+[+\-]?\d+\s*,?\s*Will\s+[+\-]?\d+)",
        "Abilities": (
            r"(Str\s+(?:\d+|-),?\s*Agy\s*(?:\d+|-),?\s*Sta\s*(?:\d+|-),?\s*"
            r"Int\s*(?:\d+|-),?\s*Spt\s*(?:\d+|-),?\s*Cha\s*(?:\d+|-))"
        ),
        "Challenge Rating": r"^\s*(\d+(?:/\d+)?)",
        "Level Adjustment": r"^\s*((?:[+\-]\d+|-|Use racial levels))",
    }
    pattern = patterns.get(field)
    if pattern:
        match = re.search(pattern, value, re.IGNORECASE)
        if match:
            return normalize_text(match.group(1))

    if field == "Alignment":
        match = re.match(
            r"((?:Always|Usually|Often)?\s*(?:lawful|neutral|chaotic)\s+(?:good|neutral|evil)|Always neutral)",
            value,
            re.IGNORECASE,
        )
        if match:
            return normalize_text(match.group(1))

    return value


def normalize_text(value: str) -> str:
    replacements = {
        "â€“": "-",
        "â€”": "-",
        "âˆ’": "-",
        "â€˜": "'",
        "â€™": "'",
        "â€œ": '"',
        "â€�": '"',
        "\u00ad": "",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\ufffd": "-",
        "\u00d7": "x",
    }
    for source, target in replacements.items():
        value = value.replace(source, target)
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"(?<=[+\-])\s+(?=\d)", "", value)
    return value.strip()


def group_lines(words: list[dict], tolerance: float = 2.7) -> list[dict]:
    lines: list[dict] = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        line = next(
            (candidate for candidate in reversed(lines[-4:]) if abs(candidate["top"] - word["top"]) <= tolerance),
            None,
        )
        if line is None:
            line = {"top": word["top"], "words": []}
            lines.append(line)
        line["words"].append(word)
    for line in lines:
        line["words"].sort(key=lambda item: item["x0"])
        line["text"] = normalize_text(" ".join(item["text"] for item in line["words"]))
    return lines


def labels_for_line(line: dict) -> list[tuple[str, int, int]]:
    words = line["words"]
    matches: list[tuple[str, int, int]] = []
    for label in sorted(FIELD_LABELS, key=len, reverse=True):
        label_words = label.split()
        for start in range(0, len(words) - len(label_words) + 1):
            candidate = " ".join(
                word["text"].rstrip(":") for word in words[start : start + len(label_words)]
            )
            if normalize_text(candidate).casefold() != label.casefold():
                continue
            last_index = start + len(label_words) - 1
            last = words[last_index]
            value_start = last_index + 1
            if ":" not in last["text"]:
                # Some PDF text engines split the colon into a standalone token.
                if len(words) <= value_start or words[value_start]["text"] != ":":
                    continue
                value_start += 1
            matches.append((label, start, value_start))
    # Prefer non-overlapping longest labels.  In particular, ``Full Attack``
    # must not also emit a nested ``Attack`` occurrence which can overwrite the
    # real single-attack row on continuation pages.
    accepted: list[tuple[str, int, int]] = []
    occupied: set[int] = set()
    for match in sorted(matches, key=lambda item: (-len(item[0].split()), item[1])):
        span = set(range(match[1], match[1] + len(match[0].split())))
        if occupied.intersection(span):
            continue
        accepted.append(match)
        occupied.update(span)
    return sorted(accepted, key=lambda item: item[1])


def text_in_column(lines: list[dict], top: float, bottom: float, left: float, right: float) -> str:
    pieces: list[str] = []
    for line in lines:
        if line["top"] < top - 1 or line["top"] >= bottom - 1:
            continue
        words = [word["text"] for word in line["words"] if word["x0"] >= left and word["x0"] < right]
        if words:
            pieces.append(" ".join(words))
    return normalize_text(" ".join(pieces))


def infer_header(
    lines: list[dict], hit_line: dict, starts: list[float], label_left: float, page_width: float
) -> list[tuple[str, str]]:
    candidates = [line for line in lines if hit_line["top"] - 110 <= line["top"] < hit_line["top"] - 1]
    assigned: list[list[tuple[float, str]]] = [[] for _ in starts]
    for line in candidates:
        line_words: list[list[str]] = [[] for _ in starts]
        for word in line["words"]:
            if word["x1"] < label_left - 8:
                continue
            center = (word["x0"] + word["x1"]) / 2
            closest = min(range(len(starts)), key=lambda index: abs(center - starts[index]))
            # Do not let wide page furniture drift into a distant stat column.
            if abs(center - starts[closest]) < max(125, page_width / (len(starts) + 2)):
                line_words[closest].append(word["text"])
        for index, pieces in enumerate(line_words):
            if pieces:
                assigned[index].append((line["top"], normalize_text(" ".join(pieces))))

    headers: list[tuple[str, str]] = []
    for index, _left in enumerate(starts):
        column_lines = [value for _top, value in assigned[index]]
        type_index = next(
            (i for i in range(len(column_lines) - 1, -1, -1) if column_lines[i].split(" ", 1)[0] in SIZE_WORDS),
            None,
        )
        if type_index is None:
            headers.append((f"Unresolved entry {index + 1}", ""))
            continue
        creature_type = column_lines[type_index]
        name = f"Unresolved entry {index + 1}"
        type_top = assigned[index][type_index][0]
        near_type = [
            value for top, value in assigned[index][:type_index]
            if 0 < type_top - top <= 28
        ]
        for candidate in reversed(near_type):
            if re.match(r"^\d+-HD\b", candidate, re.IGNORECASE):
                continue
            if re.search(r"WORLD OF WARCRAFT|CHAPTER (?:ONE|TWO)", candidate, re.IGNORECASE):
                continue
            name = candidate
            break
        headers.append((normalize_text(name), normalize_text(creature_type)))
    return headers


def extract_page(page, pdf_page: int, expected_columns: int | None = None) -> list[dict]:
    words = page.extract_words(
        keep_blank_chars=False,
        use_text_flow=False,
        split_at_punctuation=False,
        extra_attrs=["fontname", "size"],
    )
    lines = group_lines(words)
    occurrences: list[dict] = []
    for line_index, line in enumerate(lines):
        for label, start, value_start in labels_for_line(line):
            occurrences.append({
                "label": label,
                "lineIndex": line_index,
                "line": line,
                "start": start,
                "valueStart": value_start,
                "x0": line["words"][start]["x0"],
                "top": line["top"],
            })
    hit_occurrences = [occurrence for occurrence in occurrences if occurrence["label"] == "Hit Dice"]
    records: list[dict] = []

    for block_number, hit in enumerate(hit_occurrences, start=1):
        hit_line = hit["line"]
        value_words = hit_line["words"][hit["valueStart"]:]
        if not any(HD_RE.match(normalize_text(word["text"])) for word in value_words):
            # Some wrapped one-column blocks place the HD expression a few
            # pixels above the label baseline.  Treat those nearby words as
            # the same logical row.
            nearby_value_lines = [
                candidate for candidate in lines
                if abs(candidate["top"] - hit["top"]) <= 5
                and any(
                    word["x0"] > hit["x0"] + 35 and HD_RE.match(normalize_text(word["text"]))
                    for word in candidate["words"]
                )
            ]
            value_words = [
                word
                for candidate in nearby_value_lines
                for word in candidate["words"]
                if word["x0"] > hit["x0"] + 35
            ]
            value_words.sort(key=lambda word: word["x0"])
            if nearby_value_lines:
                hit["top"] = min(hit["top"], *(candidate["top"] for candidate in nearby_value_lines))
        starts = [word["x0"] for word in value_words if HD_RE.match(normalize_text(word["text"]))]
        if not starts:
            continue
        block_columns = 1 if expected_columns == 1 or len(starts) == 1 else len(starts)
        if expected_columns and expected_columns > 1:
            block_columns = min(block_columns, expected_columns)
        if block_columns == 1:
            starts = starts[:1]
        elif len(starts) > block_columns:
            starts = starts[:block_columns]

        same_lane_hits = [
            occurrence for occurrence in hit_occurrences
            if occurrence["top"] > hit["top"] and abs(occurrence["x0"] - hit["x0"]) <= 40
        ]
        next_hit_top = min((occurrence["top"] for occurrence in same_lane_hits), default=page.height)
        field_occurrences: dict[str, dict] = {}
        for occurrence in occurrences:
            top_slack = 40 if block_columns == 1 else 1
            if occurrence["top"] < hit["top"] - top_slack or occurrence["top"] >= next_hit_top:
                continue
            same_lane = abs(occurrence["x0"] - hit["x0"]) <= 40
            if (same_lane or block_columns == 1) and occurrence["label"] not in field_occurrences:
                field_occurrences[occurrence["label"]] = occurrence
        if "Hit Dice" not in field_occurrences:
            continue

        ordered_fields = sorted(field_occurrences.items(), key=lambda pair: pair[1]["top"])

        # A single stat column is often placed beside prose.  Use the first
        # substantial gap after the hp expression as its right edge.
        single_right = page.width
        if len(starts) == 1:
            trailing = [word for word in value_words if word["x0"] >= starts[0]]
            for left_word, right_word in zip(trailing, trailing[1:]):
                if right_word["x0"] - left_word["x1"] >= 16 and "hp" in " ".join(w["text"] for w in trailing[: trailing.index(left_word) + 1]).lower():
                    single_right = right_word["x0"] - 2
                    break
            if hit["x0"] < page.width / 2 and single_right == page.width:
                # The PDF media box includes a wide outer margin and chapter
                # decoration, so half of ``page.width`` lands inside the prose
                # column.  Statblocks use a stable 235-point left column.
                # Bounding from the detected label lane keeps adjacent prose
                # out while retaining long attack and equipment rows.
                single_right = min(page.width - 15, hit["x0"] + 235)

        headers = infer_header(lines, hit_line, starts, hit["x0"], single_right)
        boundaries = starts[1:] + [single_right]
        entries = [
            {
                "name": name,
                "typeLine": type_line,
                "pdfPages": [pdf_page],
                "printedPages": [pdf_page - 1],
                "fields": {},
                "verification": "native-text-table",
                "_columnX": starts[index],
                "_columnRight": boundaries[index],
                "_labelX": hit["x0"],
                "_blockColumns": len(starts),
            }
            for index, (name, type_line) in enumerate(headers)
        ]

        for field_index, (field, occurrence) in enumerate(ordered_fields):
            line = occurrence["line"]
            value_start = occurrence["valueStart"]
            label_end = line["words"][value_start - 1]["x1"] if value_start else 0
            for column_index, left in enumerate(starts):
                if block_columns == 1:
                    later_same_lane = [
                        candidate for _name, candidate in ordered_fields
                        if candidate["top"] > occurrence["top"] + 1 and abs(candidate["x0"] - occurrence["x0"]) <= 55
                    ]
                    bottom = min((candidate["top"] for candidate in later_same_lane), default=page.height)
                    # Level Adjustment is the terminal statblock row.  Letting
                    # it run to the page bottom captures the descriptive prose
                    # which follows many one-column statblocks.
                    if field == "Level Adjustment":
                        bottom = min(bottom, line["top"] + 20)
                    value_left = label_end + 2
                    right = single_right if occurrence["x0"] < page.width / 2 else page.width - 15
                else:
                    bottom = ordered_fields[field_index + 1][1]["top"] if field_index + 1 < len(ordered_fields) else line["top"] + 16
                    right = boundaries[column_index] - (2 if column_index < len(starts) - 1 else 0)
                    value_left = max(label_end + 2, left - 10) if column_index == 0 else left - 10
                entries[column_index]["fields"][field] = text_in_column(lines, occurrence["top"], bottom, value_left, right)

        for entry in entries:
            if entry["fields"].get("Hit Dice"):
                records.append(entry)

    return records


def extract_continuation_fields(page, records: list[dict]) -> None:
    """Attach field rows that continue at the top of the next physical page."""
    if not records:
        return
    lines = group_lines(page.extract_words(
        keep_blank_chars=False,
        use_text_flow=False,
        split_at_punctuation=False,
        extra_attrs=["fontname", "size"],
    ))
    occurrences: list[dict] = []
    for line in lines:
        for label, start, value_start in labels_for_line(line):
            occurrences.append({
                "label": label,
                "line": line,
                "valueStart": value_start,
                "x0": line["words"][start]["x0"],
                "top": line["top"],
            })
    first_hit_top = min(
        (occurrence["top"] for occurrence in occurrences if occurrence["label"] == "Hit Dice"),
        default=page.height,
    )
    continuation = [
        occurrence for occurrence in occurrences
        if occurrence["top"] < first_hit_top - 1 and occurrence["label"] != "Hit Dice"
    ]
    if not continuation:
        return

    if len(records) == 1:
        record = records[0]
        for occurrence in continuation:
            field = occurrence["label"]
            later_same_lane = [
                candidate for candidate in continuation
                if candidate["top"] > occurrence["top"] + 1 and abs(candidate["x0"] - occurrence["x0"]) <= 55
            ]
            bottom = min((candidate["top"] for candidate in later_same_lane), default=first_hit_top)
            if field == "Level Adjustment":
                bottom = min(bottom, occurrence["top"] + 20)
            label_end = occurrence["line"]["words"][occurrence["valueStart"] - 1]["x1"]
            right = page.width * 0.49 if occurrence["x0"] < page.width / 2 else page.width - 15
            value = text_in_column(lines, occurrence["top"], bottom, label_end + 2, right)
            if value:
                record["fields"][field] = value
        return

    # Continuation tables may move horizontally between facing pages.  Shift
    # the saved value-column boundaries by the label-column displacement.
    # Without this, the crop can retain only the damage parenthetical and lose
    # the attack name/bonus (a common layout on elemental tables).
    continuation_label_x = min(occurrence["x0"] for occurrence in continuation)
    original_label_x = records[0].get("_labelX", continuation_label_x)
    horizontal_shift = continuation_label_x - original_label_x
    starts = [record["_columnX"] + horizontal_shift for record in records]
    boundaries = starts[1:] + [records[-1]["_columnRight"] + horizontal_shift]
    ordered = sorted(continuation, key=lambda occurrence: occurrence["top"])
    for index, occurrence in enumerate(ordered):
        field = occurrence["label"]
        next_rows = [candidate["top"] for candidate in ordered[index + 1 :] if abs(candidate["x0"] - occurrence["x0"]) <= 40]
        bottom = min(next_rows, default=first_hit_top)
        for column, record in enumerate(records):
            value = text_in_column(
                lines,
                occurrence["top"],
                min(bottom, occurrence["top"] + 20) if field == "Level Adjustment" else bottom,
                max(occurrence["line"]["words"][occurrence["valueStart"] - 1]["x1"] + 2, starts[column] - 10),
                boundaries[column] - (2 if column < len(records) - 1 else 0),
            )
            if value:
                record["fields"][field] = value


def extract() -> list[dict]:
    records: list[dict] = []
    page_map = json.loads(PAGE_MAP.read_text(encoding="utf-8")) if PAGE_MAP.exists() else {}
    with pdfplumber.open(PDF) as document:
        pending: list[dict] = []
        for pdf_page in range(FIRST_PDF_PAGE, LAST_PDF_PAGE + 1):
            extract_continuation_fields(document.pages[pdf_page - 1], pending)
            replacements = page_map.get(str(pdf_page - 1))
            page_records = extract_page(
                document.pages[pdf_page - 1],
                pdf_page,
                len(replacements) if replacements else None,
            )
            records.extend(page_records)
            pending = [
                record for record in page_records
                if any(not record["fields"].get(field) for field in ("Saves", "Abilities", "Challenge Rating"))
            ]

    page_counts: defaultdict[str, int] = defaultdict(int)
    normalized_records: list[dict] = []
    for record in records:
        page_key = str(record["printedPages"][0])
        page_counts[page_key] += 1
        replacements = page_map.get(page_key, [])
        if replacements and page_counts[page_key] > len(replacements):
            continue
        if page_counts[page_key] <= len(replacements):
            replacement = replacements[page_counts[page_key] - 1]
            if replacement:
                record["name"] = replacement.get("name", record["name"])
                record["typeLine"] = replacement.get("typeLine", record["typeLine"])
                if replacement.get("kind"):
                    record["kind"] = replacement["kind"]
        normalized_records.append(record)
    records = normalized_records

    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    for record in records:
        record["fields"] = {
            field: sanitize_field(field, value)
            for field, value in record["fields"].items()
        }
        record["fields"].update(overrides.get(record["name"], {}))
        if record["name"] in overrides:
            record["verification"] = "native-text-table+review-override"

    for record in records:
        record.pop("_columnX", None)
        record.pop("_columnRight", None)
        record.pop("_labelX", None)
        record.pop("_blockColumns", None)

    # Duplicate names are valid only when the printed book truly repeats a
    # creature. Add a stable variant suffix for catalogue review without
    # silently discarding either record.
    seen: defaultdict[str, int] = defaultdict(int)
    for record in records:
        seen[record["name"]] += 1
        record["occurrence"] = seen[record["name"]]
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write the deterministic JSON catalogue")
    parser.add_argument("--dump", action="store_true", help="print the extracted catalogue")
    args = parser.parse_args()

    records = extract()
    unresolved = [record for record in records if record["name"].startswith("Unresolved entry")]
    missing = [
        record for record in records
        if record.get("kind") != "summon"
        and any(not record["fields"].get(field) for field in ("Hit Dice", "Armor Class", "Saves", "Abilities", "Challenge Rating"))
    ]
    print(f"Extracted {len(records)} statblock columns; unresolved names: {len(unresolved)}; incomplete core fields: {len(missing)}")
    if args.write:
        OUTPUT.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"Wrote {OUTPUT.relative_to(ROOT)}")
    if args.dump:
        print(json.dumps(records, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
