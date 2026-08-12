"""Extract a reviewable Warcraft spell catalogue from the private core-rule PDF.

The output contains names, list/level assignments, one-line summaries, and the
structured header printed with each full spell description. It deliberately
does not copy spell body text or artwork into the distributable repository.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "World_of_Warcraft_2nd_Edition.pdf"
OUTPUT = ROOT / "scripts" / "warcraft-content" / "warcraft-spell-catalog.json"

SCHOOLS = (
    "Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation",
    "Illusion", "Necromancy", "Transmutation", "Universal",
)

LIST_HEADINGS = {
    "Arcanist": "Arcanist", "Mage": "Mage", "Necromancer": "Necromancer",
    "Warlock": "Warlock", "Healer": "Healer", "Druid": "Druid",
    "Priest": "Priest", "Shaman": "Shaman", "Paladin": "Paladin",
}

# Several printed descriptions cover a family of list entries under one
# heading.  The family members share the structured header even when their
# body text changes the numerical effect; retaining that relationship avoids
# inheriting unrelated template range/duration data.
HEADER_ALIASES = {
    "Detect Chaos/Evil/Good/Law": "Detect Chaos",
    "Greater Death Coil": "Death Coil", "Lesser Death Coil": "Death Coil",
    "Greater Demon Skin": "Demon Skin", "Lesser Demon Skin": "Demon Skin",
    "Greater Force of Nature": "Force of Nature",
    "Greater Inner Fire": "Inner Fire", "Lesser Inner Fire": "Inner Fire",
    "Greater Lightning Guardians": "Lightning Guardians", "Lesser Lightning Guardians": "Lightning Guardians",
    "Greater Mark of the Wild": "Mark of the Wild", "Lesser Mark of the Wild": "Mark of the Wild",
    "Greater Moonfire": "Moonfire",
    "Greater Shadow Word Pain": "Shadow Word Pain", "Lesser Shadow Word Pain": "Shadow Word Pain",
    "Magic Circle against Evil/Good": "Magic Circle against Evil",
    "Protection from Chaos/Evil": "Protection from Chaos",
    "Protection from Chaos/Evil/Good/Law": "Protection from Chaos",
    "Planar Binding": "Greater Planar Binding",
    **{f"Summon Monster {numeral}": "Summon Monster I" for numeral in ("II", "III", "IV", "V", "VI", "VII", "VIII", "IX")},
}

# Five SRD-compatible descriptions are absent from the Warcraft spell chapter.
# Four other Warcraft headers cross a page or column boundary and are handled
# explicitly by ``extract_description_headers`` below.
EXPECTED_HEADER_FALLBACKS = {
    "Geas/Quest", "Lesser Geas", "Mass Suggestion", "Suggestion", "Unseen Servant",
}

EXPECTED_LIST_COUNTS = {
    "Arcanist": [6, 10, 8, 8, 15, 10, 8, 8, 5, 5],
    "Mage": [3, 3, 4, 7, 6, 3, 2, 3, 3, 2],
    "Necromancer": [2, 3, 7, 3, 4, 3, 3, 3, 3, 2],
    "Warlock": [1, 5, 3, 4, 4, 6, 5, 3, 2, 2],
    "Healer": [9, 13, 12, 11, 8, 7, 9, 7, 4, 7],
    "Druid": [1, 6, 6, 6, 3, 5, 4, 4, 4, 4],
    "Priest": [1, 4, 6, 6, 4, 5, 5, 4, 4, 4],
    "Shaman": [1, 5, 4, 6, 4, 3, 3, 3, 2, 2],
    "Paladin": [0, 9, 8, 7, 6, 0, 0, 0, 0, 0],
}


def clean(text: str) -> str:
    replacements = {
        "\ufb01": "fi", "\ufb02": "fl", "\u2019": "'", "\u2018": "'",
        "\u2013": "-", "\u2014": "-", "\u00ad": "", "\u201c": '"', "\u201d": '"',
        # pdfminer cannot map this book's display-font apostrophe glyph and
        # emits U+FFFD. In list names it consistently represents an apostrophe.
        "\ufffd": "'",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    # Two display-font glyphs are commonly extracted as a separated initial.
    text = re.sub(r"\b([TVW]) ([a-z]{2,})\b", r"\1\2", text)
    text = re.sub(r"\b([A-Za-z]+)(fi|fl) ([a-z]+)\b", r"\1\2\3", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def collapse_display_font(line: str) -> str:
    """Undo doubled glyphs used by the spell-list display headings.

    The PDF stores headings such as ``0-Level Arcanist Spells`` as
    ``00--LLeevveell AArrccaanniisstt SSppeellllss``. Only collapse a token when
    every glyph is genuinely paired, so ordinary words such as ``Spells`` are
    never altered.
    """

    def collapse(token: str) -> str:
        if len(token) % 2 == 0 and token and all(token[index] == token[index + 1] for index in range(0, len(token), 2)):
            return token[::2]
        return token

    return " ".join(collapse(token) for token in line.split())


def canonical_name(name: str) -> str:
    name = clean(name)
    name = name.rstrip("*").strip()
    name = re.sub(r"(?:\s+\[[A-Za-z]+\]|\s+[MFX]+\*?)+$", "", name).strip()
    if ", " in name:
        base, suffix = name.rsplit(", ", 1)
        if suffix in {"Greater", "Lesser", "Mass"}:
            name = f"{suffix} {base}"
    return name


def extract_list_entries(_reader: PdfReader) -> dict[str, dict]:
    records: dict[str, dict] = {}
    active_list: str | None = None
    active_level: int | None = None
    active_domain: str | None = None
    heading_re = re.compile(r"(0|[1-9])(?:st|nd|rd|th)?-Level (.+?) Spells?$")
    entry_re = re.compile(r"^([^:]{2,90}?):\s*(.*)$")

    # Most list pages expose a reliable tagged-PDF text flow, including cases
    # where one list continues at the top of the right column before the next
    # section begins lower in the left column. The opening and Paladin pages are
    # the two exceptions: their tagged flow starts with the right column, so
    # read those pages as explicit left/right crops.
    with pdfplumber.open(PDF) as document:
      for page_number in range(265, 277):
        page = document.pages[page_number - 1]
        if page_number in {265, 276}:
          right_edge = 294 if page_number == 276 else 282
          segments = [
              page.crop((40, 55, 278, 755)).extract_text(x_tolerance=1, y_tolerance=3) or "",
              page.crop((right_edge, 55, 575, 755)).extract_text(x_tolerance=1, y_tolerance=3) or "",
          ]
        else:
          segments = [page.extract_text(x_tolerance=1, y_tolerance=3, use_text_flow=True) or ""]
        for segment in segments:
          lines = [clean(line) for line in segment.splitlines()]
          for line in lines:
            if not line:
                continue
            compact = collapse_display_font(re.sub(r"\s+", " ", line))
            domain_heading = re.match(r"^([A-Z][A-Za-z ]+?) Domain(?:\s+\1 Domain)?$", compact)
            if domain_heading:
                active_domain = domain_heading.group(1).strip()
                active_list = None
                active_level = None
                continue
            domain_spell = re.match(r"^([1-9])(?:st|nd|rd|th)[-?]([^:]+):\s*(.*)$", compact)
            if active_domain and domain_spell:
                level, raw_name, summary = domain_spell.groups()
                name = canonical_name(raw_name)
                record = records.setdefault(name, {"name": name, "assignments": [], "summary": "", "listPages": []})
                assignment = {"list": f"{active_domain} Domain", "level": int(level), "kind": "domain"}
                if assignment not in record["assignments"]:
                    record["assignments"].append(assignment)
                if summary and not record["summary"]:
                    record["summary"] = summary
                if page_number not in record["listPages"]:
                    record["listPages"].append(page_number)
                continue
            # A column break can place the last words of the preceding spell
            # summary on the same baseline as the next list heading (for
            # example, ``12 + level. 0-Level Druid Spells``). Match the heading
            # at the end of the line rather than requiring column text to start
            # with it.
            heading = heading_re.search(compact)
            if heading:
                label = heading.group(2).strip()
                active_level = int(heading.group(1))
                active_list = next((value for key, value in LIST_HEADINGS.items() if key.lower() in label.lower()), None)
                active_domain = None
                continue
            if active_list is None or active_level is None:
                continue
            match = entry_re.match(compact)
            if not match:
                continue
            raw_name, summary = match.groups()
            if raw_name and not raw_name[0].isupper():
                # On the Paladin page a few long left-column continuations
                # cross the gutter and precede the actual right-column entry
                # on the same baseline (``min./level. Freedom of Movement``).
                # Spell names are title-cased, so discard only that lowercase
                # gutter residue and retain the real name.
                title_start = re.search(r"\b[A-Z][A-Za-z'/-]*(?:\s+.*)?$", raw_name)
                if title_start:
                    raw_name = title_start.group(0)
            if not raw_name or not raw_name[0].isupper():
                # Lowercase column-overflow fragments are prose, not spell
                # names.  Keeping this gate after the Paladin gutter repair
                # retains genuine title-cased entries recovered above.
                continue
            if re.match(r"^[1-9](?:st|nd|rd|th)-", raw_name):
                continue
            if raw_name.startswith(("Level", "Components", "Casting Time", "Range", "Target", "Area", "Duration", "Saving Throw", "Spell Resistance")):
                continue
            name = canonical_name(raw_name)
            if (len(name) < 2 or name.startswith(("Table ", "Lesser Power", "Greater Power", "CHAPTER "))
                    or re.sub(r"\s+", "", name).upper().startswith("CHAPTER")
                    or "chapter" in name.lower() or "following spell lists" in name.lower()):
                continue
            record = records.setdefault(name, {"name": name, "assignments": [], "summary": "", "listPages": []})
            assignment = {"list": active_list, "level": active_level}
            if assignment not in record["assignments"]:
                record["assignments"].append(assignment)
            if summary and not record["summary"]:
                record["summary"] = summary
            if page_number not in record["listPages"]:
                record["listPages"].append(page_number)
    return records


def extract_description_headers(_reader: PdfReader) -> dict[str, dict]:
    headers: dict[str, dict] = {}
    school_re = re.compile(rf"^({'|'.join(SCHOOLS)})(?:\s*\([^)]*\))?(?:\s*\[[^]]*\])?$")
    key_re = re.compile(r"^(Level|Components|Casting Time|Range|Targets?|Effect|Area|Duration|Saving Throw|Spell Resistance):\s*(.*)$")

    # This book alternates the outer page margin, so the printed columns shift
    # by roughly 54 points on even pages. Read each page with the matching crop
    # geometry. This keeps names, schools, and metadata together without the
    # cross-column pairings produced by whole-page extraction.
    with pdfplumber.open(PDF) as document:
      for page_number in range(277, 361):
        page = document.pages[page_number - 1]
        bounds = ((40, 55, 278, 755), (283, 55, 575, 755)) if page_number % 2 else (
            (94, 55, 327, 755), (333, 55, 575, 755))
        for crop in bounds:
          lines = [clean(line) for line in (page.crop(crop).extract_text(x_tolerance=1, y_tolerance=3) or "").splitlines()]
          for index, line in enumerate(lines):
            if not school_re.match(line):
                continue
            prior = index - 1
            while prior >= 0 and (not lines[prior] or lines[prior].isdigit() or "CHAPTER SEVENTEEN" in lines[prior]):
                prior -= 1
            if prior < 0:
                continue
            name = canonical_name(lines[prior])
            if not name or len(name) > 80 or ":" in name:
                continue
            header = {"name": name, "school": line, "descriptionPages": [page_number]}
            for candidate in lines[index + 1:index + 18]:
                match = key_re.match(candidate)
                if match:
                    header[match.group(1)] = match.group(2)
                if candidate.startswith("Spell Resistance:"):
                    break
            if header.get("Level"):
                headers.setdefault(name, header)
        # Four entries put their title/school at the bottom of a page or column
        # and their structured metadata at the start of the following page or
        # column. Capture those deliberate layouts instead of classifying a
        # present Warcraft header as missing.
        boundary_headers = {
            "Charm Person": ([287, 288], 288, (94, 55, 327, 300), "Enchantment (Charm) [Mind-Affecting]"),
            "Second Soul": ([336], 336, (333, 55, 575, 270), "Conjuration (Healing)"),
            "Shadow Strike": ([337, 338], 338, (94, 55, 327, 320), "Transmutation"),
            "Withering Blight": ([359], 359, (283, 55, 575, 310), "Transmutation [Evil, Fel]"),
        }
        for name, (description_pages, page_number, bounds, school) in boundary_headers.items():
            lines = [clean(line) for line in (document.pages[page_number - 1].crop(bounds)
                     .extract_text(x_tolerance=1, y_tolerance=3) or "").splitlines()]
            header = {"name": name, "school": school, "descriptionPages": description_pages}
            for candidate in lines:
                match = key_re.match(candidate)
                if match:
                    header[match.group(1)] = match.group(2)
                if candidate.startswith("Spell Resistance:"):
                    break
            if header.get("Level"):
                headers[name] = header
    return headers


def main() -> None:
    reader = PdfReader(PDF)
    raw_records = extract_list_entries(reader)
    records: dict[str, dict] = {}
    for raw_name, raw_record in raw_records.items():
        name = canonical_name(raw_name)
        record = records.setdefault(name, {"name": name, "assignments": [], "summary": "", "listPages": []})
        for assignment in raw_record["assignments"]:
            if assignment not in record["assignments"]:
                record["assignments"].append(assignment)
        record["summary"] = record["summary"] or raw_record["summary"]
        record["listPages"] = sorted(set(record["listPages"] + raw_record["listPages"]))
    headers = extract_description_headers(reader)
    for name, record in records.items():
        header = headers.get(name) or headers.get(HEADER_ALIASES.get(name, ""))
        if header:
            record["header"] = dict(header, name=name)
    output = sorted(records.values(), key=lambda entry: entry["name"])
    if len(output) != 342:
        raise RuntimeError(f"Spell-list extraction produced {len(output)} records; expected 342.")
    assignments = sum(len(entry["assignments"]) for entry in output)
    if assignments != 504:
        raise RuntimeError(f"Spell-list extraction produced {assignments} assignments; expected 504.")
    for list_name, expected in EXPECTED_LIST_COUNTS.items():
        actual = [sum(any(assignment["list"] == list_name and assignment["level"] == level
                          for assignment in entry["assignments"]) for entry in output) for level in range(10)]
        if actual != expected:
            raise RuntimeError(f"{list_name} level counts {actual}; expected {expected}.")
    domains = sorted({assignment["list"] for entry in output for assignment in entry["assignments"]
                      if assignment.get("kind") == "domain"})
    for domain in domains:
        levels = sorted(assignment["level"] for entry in output for assignment in entry["assignments"]
                        if assignment.get("kind") == "domain" and assignment["list"] == domain)
        if levels != list(range(1, 10)):
            raise RuntimeError(f"{domain} levels {levels}; expected one spell at each level 1-9.")
    missing_headers = {entry["name"] for entry in output if "header" not in entry}
    if missing_headers != EXPECTED_HEADER_FALLBACKS:
        raise RuntimeError(f"Unexpected header fallbacks: {sorted(missing_headers)}")
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    matched = sum("header" in entry for entry in output)
    print(f"Extracted {len(output)} listed spells; matched {matched} full-description headers.")


if __name__ == "__main__":
    main()
