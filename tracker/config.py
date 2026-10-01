"""Lädt config/config.json, config/targets.json und data/parts.json."""
from __future__ import annotations

import json
from pathlib import Path


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load(root: Path) -> dict:
    """-> {"cfg": ..., "targets": ..., "parts": ...}; Pfade der Zustandsdateien stehen in cfg["paths"]."""
    cfg = read_json(root / "config" / "config.json")
    return {
        "cfg": cfg,
        "targets": read_json(root / "config" / "targets.json").get("targets", {}),
        "parts": read_json(root / cfg["paths"]["parts"])["parts"],
    }
