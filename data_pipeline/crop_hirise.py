#!/usr/bin/env python3
"""
Recorta una ventana de un DTM HiRISE (PDS3 .IMG, Float32 LE, 1 banda) y genera
un dataset del contrato 4.1 en public/data/<dataset_id>/.

Uso (el bloque se baja con HTTP Range, sin descargar los 380 MB completos):
  python3 data_pipeline/crop_hirise.py --block /tmp/hirise/block.bin \
      --samples 6673 --first-row 4001 --size 2000 --dataset-id hirise_jezero

Requiere numpy y Pillow.
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MISSING = np.float32(-3.4028227e38)


def hillshade(z, res_m, az_deg=315.0, alt_deg=35.0, ex=1.0):
    gy, gx = np.gradient(z * ex, res_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(360.0 - az_deg + 90.0), np.radians(alt_deg)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--block", required=True)
    ap.add_argument("--samples", type=int, default=6673)
    ap.add_argument("--first-row", type=int, default=0, help="fila del DTM donde empieza el bloque")
    ap.add_argument("--size", type=int, default=2000)
    ap.add_argument("--res-m", type=float, default=1.0096633)
    ap.add_argument("--dataset-id", default="hirise_jezero")
    ap.add_argument("--base", default="jezero_test", help="dataset del que copiar config_*.json")
    a = ap.parse_args()

    raw = np.fromfile(a.block, dtype="<f4")
    dem = raw.reshape(-1, a.samples)
    valid = (dem > -1e6) & np.isfinite(dem)
    print("bloque", dem.shape, "validos %.1f%%" % (100 * valid.mean()))

    # Buscar la ventana size×size con mayor fracción de píxeles válidos (paso de 100 px)
    best, pos = -1, (0, 0)
    integ = valid.astype(np.int32).cumsum(0).cumsum(1)
    def area(r, c, s):
        t = integ[r + s - 1, c + s - 1]
        t -= integ[r - 1, c + s - 1] if r else 0
        t -= integ[r + s - 1, c - 1] if c else 0
        t += integ[r - 1, c - 1] if r and c else 0
        return t
    for r in range(0, dem.shape[0] - a.size + 1, 100):
        for c in range(0, dem.shape[1] - a.size + 1, 100):
            v = area(r, c, a.size)
            if v > best:
                best, pos = v, (r, c)
    r0, c0 = pos
    win = dem[r0:r0 + a.size, c0:c0 + a.size].copy()
    ok = (win > -1e6) & np.isfinite(win)
    print("ventana fila %d col %d, validos %.2f%%" % (r0 + a.first_row, c0, 100 * ok.mean()))
    if (~ok).any():  # rellenar huecos con la media local simple
        win[~ok] = win[ok].mean()
    win = win.astype("<f4")

    out = ROOT / "public" / "data" / a.dataset_id
    out.mkdir(parents=True, exist_ok=True)
    win.tofile(out / "heightmap.f32")

    hs = hillshade(win, a.res_m, ex=1.5)
    zn = (win - win.min()) / max(1e-6, win.max() - win.min())
    # Hillshade modulado con tinte hipsométrico suave -> textura base
    tint = np.stack([0.72 + 0.20 * zn, 0.45 + 0.15 * zn, 0.30 + 0.10 * zn], -1)
    rgb = np.clip(tint * (0.25 + 0.85 * hs[..., None]) * 255, 0, 255).astype(np.uint8)
    Image.fromarray(rgb).save(out / "texture.png", optimize=True)

    size = a.size * a.res_m
    meta = {
        "dataset_id": a.dataset_id,
        "label": "Jezero HiRISE 1 m/px (ventana 2 km)",
        "source": "HiRISE",
        "crs": "IAU_2015:49900",
        "size_m": [round(size, 2), round(size, 2)],
        "resolution_m": a.res_m,
        "shape": [a.size, a.size],
        "elevation_range_m": [round(float(win.min()), 2), round(float(win.max()), 2)],
        "heightmap": {"file": "heightmap.f32", "format": "float32-le", "units": "m"},
        "layers": [{"id": "base", "file": "texture.png", "type": "base"}],
        "acquisition_date": "2016-12",
        "uncertainty_note": "HiRISE DTEEC_045994_1985_046060_1985_U01 (USGS/UA), 1 m/px. Textura = hillshade + tinte hipsométrico.",
    }
    (out / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    for f in ("config_fisio.json", "config_health.json"):
        src = ROOT / "public" / "data" / a.base / f
        if src.exists():
            d = json.loads(src.read_text())
            if "dataset_id" in d:
                d["dataset_id"] = a.dataset_id
            (out / f).write_text(json.dumps(d, indent=2, ensure_ascii=False))
    print("OK ->", out, "| %.1f MB" % (win.nbytes / 1e6), "| elev", meta["elevation_range_m"])


if __name__ == "__main__":
    main()
