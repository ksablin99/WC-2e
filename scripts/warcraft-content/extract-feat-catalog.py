"""Extract feat names, categories, prerequisites, and concise summaries.

Only structured metadata and a short first-sentence paraphrase source are kept;
the distributable content generator never copies full book descriptions.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "World_of_Warcraft_2nd_Edition.pdf"
OUTPUT = ROOT / "scripts" / "warcraft-content" / "warcraft-feat-catalog.json"
CATEGORIES = {"General", "Item Creation", "Metamagic", "Shout", "Technology", "Special"}


def clean(text: str) -> str:
    for old, new in {
        "\ufb01": "fi", "\ufb02": "fl", "\u2019": "'", "\u2018": "'",
        "\u2013": "-", "\u2014": "-", "\u00ad": "", "\u201c": '"', "\u201d": '"',
    }.items():
        text = text.replace(old, new)
    text = re.sub(r"\b([TW]) ([a-z]{2,})\b", r"\1\2", text)
    text = re.sub(r"\b([A-Za-z]+)(fi|fl) ([a-z]+)\b", r"\1\2\3", text)
    return re.sub(r"\s+", " ", text).strip()


def main() -> None:
    reader = PdfReader(PDF)
    records: list[dict] = []
    for page_number in range(144, 181):
        lines = [clean(line) for line in (reader.pages[page_number - 1].extract_text() or "").splitlines()]
        index = 0
        while index < len(lines):
            category_match = re.fullmatch(r"\[([^]]+)\]", lines[index])
            if not category_match or category_match.group(1) not in CATEGORIES:
                index += 1
                continue
            category = category_match.group(1)
            prior = index - 1
            while prior >= 0 and not lines[prior]:
                prior -= 1
            name = lines[prior].strip() if prior >= 0 else ""
            # Wrapped names occur rarely; join a short title-case predecessor.
            if prior > 0 and len(name) < 18 and re.fullmatch(r"[A-Z][A-Za-z() -]+", lines[prior - 1] or ""):
                name = f"{lines[prior - 1]} {name}"
            name = re.sub(r"\s+", " ", name).strip()
            if not name or len(name) > 80:
                index += 1
                continue

            end = index + 1
            while end < len(lines):
                if re.fullmatch(r"\[([^]]+)\]", lines[end]) and end > index + 1:
                    break
                end += 1
            body = " ".join(line for line in lines[index + 1:end] if line)
            prerequisite = ""
            prereq = re.search(r"Prerequisites?:\s*(.*?)(?=\s+Benefits?:|\s+Normal:|\s+Special:|$)", body)
            if prereq:
                prerequisite = prereq.group(1).strip()
            benefit = ""
            benefit_match = re.search(r"Benefit:\s*(.*?)(?=\s+Normal:|\s+Special:|$)", body)
            if benefit_match:
                benefit = benefit_match.group(1).strip()
                sentence = re.match(r"(.{1,420}?[.!?])(?:\s|$)", benefit)
                benefit = sentence.group(1) if sentence else benefit[:420].rstrip()
            records.append({
                "name": name,
                "category": category,
                "prerequisite": prerequisite,
                "summarySource": benefit,
                "pdfPages": [page_number],
                "printedPages": [page_number - 2],
            })
            index = end

    unique: dict[str, dict] = {}
    for record in records:
        unique.setdefault(record["name"], record)
    output = sorted(unique.values(), key=lambda entry: entry["name"])
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Extracted {len(output)} feat descriptions by category: " + ", ".join(
        f"{category}={sum(entry['category'] == category for entry in output)}" for category in sorted(CATEGORIES)
    ))


if __name__ == "__main__":
    main()
