"""Opt-in real full-pipeline Mac evaluation. No fake model fallback."""
import json
import argparse
import os
import platform
from pathlib import Path
import resource
import sys
import time
import threading
import subprocess

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ingestion.parser import paddle_parse


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--accelerator", choices=["cpu", "mlx"], default="cpu")
    args = arguments.parse_args()
    os.environ["RECALLX_OCR_ACCELERATOR"] = args.accelerator
    from PIL import Image, ImageDraw, ImageFont
    root = Path(__file__).resolve().parents[1]
    models = root / "models" / "ocr"
    manifest = json.loads((models / "revisions.json").read_text())
    os.environ.setdefault("RECALLX_OCR_MODEL_DIR", str(models / "PaddleOCR-VL-1.6"))
    os.environ.setdefault("RECALLX_OCR_LAYOUT_DIR", str(models / "PP-DocLayoutV3"))
    os.environ.setdefault("RECALLX_OCR_MODEL_REVISION", manifest["PaddleOCR-VL-1.6"])
    output = root.parent / "evidence" / "ocr"
    output.mkdir(parents=True, exist_ok=True)
    if args.accelerator == "mlx":
        os.environ["RECALLX_MLX_LOG_PATH"] = str(output / "smoke-mlx.service.log")
    img = Image.new("RGB", (1100, 320), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 30)
    reference = "Ephemeral means lasting for a very short time.\nThe ephemeral rainbow vanished after the rain."
    draw.text((45, 55), reference.splitlines()[0], fill="black", font=font)
    draw.text((45, 115), "The ephemeral rainbow vanished after the rain.", fill="black", font=font)
    path = output / "paragraph.png"
    img.save(path)
    started = time.monotonic()
    report = {"model_revisions": manifest, "pipeline": "full PaddleOCRVL v1.6", "device": "cpu" if args.accelerator == "cpu" else "CPU layout + local MLX recognition", "reference": reference, "platform": platform.platform(), "machine": platform.machine()}
    stopped = threading.Event()
    peak = [0]
    def sample_owned_processes():
        while not stopped.is_set():
            process = subprocess.Popen(["ps", "-axo", "pid=,ppid=,rss="], stdout=subprocess.PIPE, text=True)
            output, _ = process.communicate()
            rows = [tuple(map(int, row.split())) for row in output.splitlines() if row.strip()]
            owned = {os.getpid()}
            for _ in range(5):
                owned.update(pid for pid, parent, rss in rows if parent in owned and pid != process.pid)
            peak[0] = max(peak[0], sum(rss * 1024 for pid, parent, rss in rows if pid in owned))
            stopped.wait(.2)
    sampler = threading.Thread(target=sample_owned_processes, daemon=True)
    sampler.start()
    try:
        result = paddle_parse(path.read_bytes())
        text = "\n".join(b["text"] for b in result["blocks"])
        normalized = " ".join(text.split())
        expected = " ".join(reference.split())
        previous = list(range(len(expected) + 1))
        for row, character in enumerate(normalized, 1):
            current = [row]
            for col, target in enumerate(expected, 1):
                current.append(min(current[-1] + 1, previous[col] + 1, previous[col - 1] + (character != target)))
            previous = current
        valid_boxes = all(len(b["bbox"]) == 4 and 0 <= b["bbox"][0] < b["bbox"][2] <= result["width"] and 0 <= b["bbox"][1] < b["bbox"][3] <= result["height"] for b in result["blocks"])
        report.update(status="passed" if normalized == expected and valid_boxes else "quality_failed", character_error_rate=previous[-1] / len(expected), provenance_boxes_valid=valid_boxes, text=text, result=result)
    except Exception as exc:
        report.update(status="failed", error=str(exc))
    stopped.set()
    sampler.join(timeout=2)
    report.update(elapsed_including_queue_seconds=round(time.monotonic() - started, 3), child_peak_rss_bytes=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss, sampled_process_tree_peak_rss_bytes=peak[0], memory_note="Sampled RSS sums the smoke process and owned children; shared pages can be counted more than once. Separately accounted Metal allocations are not measured. It is not total unified-memory use or a system-wide memory measurement.")
    (output / ("smoke.json" if args.accelerator == "cpu" else "smoke-mlx.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
