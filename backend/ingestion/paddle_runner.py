"""Runs only in the isolated OCR environment; writes the full pipeline's layout result."""
import json
import os
from pathlib import Path
import sys
import signal
from urllib.parse import urlparse


def main():
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(Path(__file__).resolve().parents[1] / "models" / ".paddlex"))
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PaddleOCRVL
    from paddlex.inference import load_pipeline_config
    from PIL import Image
    model_root = Path(__file__).resolve().parents[1] / "models" / "ocr"
    layout = os.getenv("RECALLX_OCR_LAYOUT_DIR", str(model_root / "PP-DocLayoutV3"))
    model = os.getenv("RECALLX_OCR_MODEL_DIR", str(model_root / "PaddleOCR-VL-1.6"))
    if not layout or not Path(layout).is_dir() or not model or not Path(model).is_dir():
        raise RuntimeError("Set RECALLX_OCR_LAYOUT_DIR and RECALLX_OCR_MODEL_DIR to pinned local models")
    config = load_pipeline_config("PaddleOCR-VL-1.6")
    config["batch_size"] = 1
    config["SubModules"]["LayoutDetection"]["batch_size"] = 1
    config["SubModules"]["VLRecognition"]["batch_size"] = 1
    kwargs = {"pipeline_version": "v1.6", "device": "cpu", "layout_detection_model_dir": layout, "use_layout_detection": True, "use_queues": False, "paddlex_config": config}
    server = os.getenv("RECALLX_MLX_URL")
    if server:
        if urlparse(server).hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("OCR inference service must be local to this Mac")
        kwargs.update(vl_rec_backend="mlx-vlm-server", vl_rec_server_url=server, vl_rec_api_model_name=model, vl_rec_max_concurrency=1)
    else:
        kwargs["vl_rec_model_dir"] = model
    pipeline = PaddleOCRVL(**kwargs)
    results = list(pipeline.predict_iter(sys.argv[1]))
    blocks = []
    raw_results = []
    for result in results:
        data = result.json
        if isinstance(data, str):
            data = json.loads(data)
        data = data.get("res", data)
        raw_results.append(data)
        for block in data.get("parsing_res_list", []):
            text = block.get("block_content", "").strip()
            if text:
                blocks.append({"text": text, "kind": block.get("block_label", "text"), "bbox": block["block_bbox"], "confidence": None})
    with Image.open(sys.argv[1]) as img:
        output = {"blocks": blocks, "width": img.width, "height": img.height, "raw": raw_results, "recognition_backend": "mlx-vlm-server" if server else "paddle-cpu"}
    Path(sys.argv[2]).write_text(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    # A dead Celery parent cannot leave an unbounded model process holding the Mac lease.
    signal.alarm(300)
    main()
