"""
test_sample.py

Runs the docx-to-CSV pipeline on 3 related human-smuggling Ex parte cases
that share overlapping entities (Texas Court of Appeals, smuggling charges,
bail proceedings, same defendant surnames).

Output: Additional Cases/(human smuggling)/Results/sample_test.csv
"""

import csv
import logging
from pathlib import Path

# Reuse all logic from test.py
from test import extract_text, split_sentences, chunk_sentences, is_relevant

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

BASE = Path("/Users/eli/projects/humansmug/humansmug/Additional Cases/(human smuggling)")

SAMPLE_DOCS = [
    BASE / "1-100" / "Ex parte Vazquez-Bautista, 2023 Tex. App. LEXIS 5935.DOCX",
    BASE / "1-100" / "Ex parte Vazquez-Bautista, 683 S.W.3d 504.DOCX",
    BASE / "1-100" / "Ex parte Aparicio, 672 S.W.3d 696.DOCX",
]

OUTPUT_CSV = BASE / "Results" / "sample_test.csv"

blurb_size = 2

total_rows = filtered_rows = 0

OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as csvfile:
    writer = csv.writer(csvfile, quoting=csv.QUOTE_ALL)
    writer.writerow(["doc_id", "sentence_blurb"])

    for docx_path in SAMPLE_DOCS:
        doc_id = f"{docx_path.parent.name}/{docx_path.stem}"
        log.info(f"Processing: {doc_id}")

        text = extract_text(str(docx_path))
        if not text.strip():
            log.warning(f"  No text extracted from {doc_id}")
            continue

        sentences = split_sentences(text)
        blurbs = chunk_sentences(sentences, blurb_size=blurb_size)

        for blurb in blurbs:
            total_rows += 1
            if not is_relevant(blurb):
                filtered_rows += 1
                continue
            writer.writerow([doc_id, blurb])

kept = total_rows - filtered_rows
log.info(f"\nDone. {kept} blurbs written to {OUTPUT_CSV}")
log.info(f"Filtered out {filtered_rows} / {total_rows} blurbs ({100*filtered_rows//max(total_rows,1)}%)")
