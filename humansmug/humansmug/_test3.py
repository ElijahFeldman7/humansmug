"""
Quick test run on 3 related documents to verify CSV output and entity overlap.
Output: /tmp/test3_output.csv
"""
import sys
sys.path.insert(0, "/Users/eli/projects/humansmug/humansmug")

import csv
import logging
from pathlib import Path
from test import extract_text, split_sentences, chunk_sentences, is_relevant

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

BASE = Path("/Users/eli/projects/humansmug/humansmug/Additional Cases/(human smuggling)")
DOCS = [
    BASE / "1-100/Gen. Land Office of Tex v. Biden, 71 F.4th 264.DOCX",
    BASE / "1-100/Texas v. U.S. Dep_t of Homeland Sec., 700 F. Supp. 3d 539.DOCX",
    BASE / "1-100/United States v. Abbott, 87 F.4th 616.DOCX",
]
OUTPUT = "/tmp/test3_output.csv"

with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(["doc_id", "sentence_blurb"])
    for path in DOCS:
        doc_id = f"1-100/{path.stem}"
        log.info(f"Processing: {doc_id}")
        text = extract_text(str(path))
        sentences = split_sentences(text)
        blurbs = chunk_sentences(sentences, blurb_size=2)
        kept = [b for b in blurbs if is_relevant(b)]
        for blurb in kept:
            writer.writerow([doc_id, blurb])
        log.info(f"  → {len(kept)} blurbs kept")

log.info(f"\nDone. Written to {OUTPUT}")
