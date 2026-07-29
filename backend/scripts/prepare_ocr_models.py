"""Download only the reviewed immutable OCR checkpoints into the project cache."""
import json
from pathlib import Path
from huggingface_hub import snapshot_download


def main():
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "ocr-models.json").read_text())
    directory = root / "models" / "ocr"
    directory.mkdir(parents=True, exist_ok=True)
    revisions = {}
    for name, model in manifest["models"].items():
        snapshot_download(model["repository"], revision=model["revision"], local_dir=directory / name, max_workers=2)
        revisions[name] = model["revision"]
    (directory / "revisions.json").write_text(json.dumps(revisions, indent=2))
    print("Pinned layout and OCR checkpoints are ready.")


if __name__ == "__main__":
    main()
