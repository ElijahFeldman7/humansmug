import csv
import json
import time
import logging
import argparse
import urllib.request
import urllib.error
from pathlib import Path


logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


BASE = Path("/Users/eli/projects/HackTJ-2026/humansmug/humansmug/Additional Cases/(human smuggling)/Results")

DEFAULT_INPUT  = str(BASE / "sample_3docs.csv")
DEFAULT_OUTPUT = str(BASE / "output_enriched.csv")

OLLAMA_URL   = "http://127.0.0.1:11434/api/generate"
MODEL_NAME   = "uniner-smuggling:latest"
TIMEOUT_SECS = 120


def query_model(blurb: str) -> str:
    """Send text to the Ollama model and return its response."""
    payload = json.dumps({
        "model": MODEL_NAME,
        "prompt": blurb,
        "stream": False
    }).encode()

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
            data = json.loads(resp.read().decode())
            return data.get("response", "").strip()

    except urllib.error.URLError as e:
        log.warning(f"Model request failed: {e}")
        return "ERROR"


def load_completed_doc_ids(output_csv: str) -> set:
    """Load doc_ids already processed in the output file."""
    path = Path(output_csv)

    if not path.exists():
        return set()

    completed = set()

    with open(output_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            completed.add(row["doc_id"])

    return completed


def process(input_csv: str, output_csv: str) -> None:

    with open(input_csv, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    total = len(rows)

    completed_ids = load_completed_doc_ids(output_csv)

    log.info(f"{len(completed_ids)} rows already completed")

    Path(output_csv).parent.mkdir(parents=True, exist_ok=True)

    write_header = not Path(output_csv).exists()

    out_file = open(output_csv, "a", newline="", encoding="utf-8")
    writer = csv.writer(out_file, quoting=csv.QUOTE_ALL)

    if write_header:
        writer.writerow(["doc_id", "sentence_blurb", "ner_re_output"])

    remaining = total - len(completed_ids)

    log.info(f"Processing {remaining} rows using model '{MODEL_NAME}'")

    start_time = time.time()
    processed = 0

    for row in rows:

        doc_id = row["doc_id"]

        if doc_id in completed_ids:
            continue

        blurb = row["sentence_blurb"]

        result = query_model(blurb)

        writer.writerow([doc_id, blurb, result])
        out_file.flush()

        processed += 1

        elapsed = time.time() - start_time
        rate = processed / elapsed if elapsed > 0 else 0

        remaining_rows = remaining - processed
        eta = remaining_rows / rate if rate > 0 else 0

        log.info(
            f"[{processed}/{remaining}] doc_id={doc_id} | "
            f"{rate:.2f} rows/s | ETA {eta/60:.1f} min"
        )

    out_file.close()

    total_time = time.time() - start_time

    log.info(f"Completed {processed} rows")
    log.info(f"Output written to {output_csv}")
    log.info(f"Total runtime {total_time:.1f}s")


if __name__ == "__main__":

    parser = argparse.ArgumentParser()

    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)

    args = parser.parse_args()

    process(args.input, args.output)