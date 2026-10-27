#!/usr/bin/env python3
"""
Convierte un DEM GeoTIFF de Marte (o genera un DEM sintético de prueba)
al formato de contrato de la sección 4.1 de ORQUESTADOR.md:
  - data/<dataset_id>/metadata.json
  - data/<dataset_id>/heightmap.f32  (Float32 little-endian, fila por fila, en metros)
  - data/<dataset_id>/texture.png    (vista previa de 8 bits en escala de grises)

Funciona tanto con rasterio/numpy (si están instalados) como con la librería
estándar de Python para GeoTIFFs Float32 sin comprimir.
"""

import argparse
import json
import math
import os
import shutil
import struct
import zlib
from pathlib import Path


def write_grayscale_png(path: Path, width: int, height: int, pixels_u8: bytes) -> None:
    """Escribe un PNG de 8 bits en escala de grises usando solo la librería estándar."""
    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    raw_rows = bytearray()
    for y in range(height):
        raw_rows.append(0)  # filtro None
        row_start = y * width
        raw_rows.extend(pixels_u8[row_start : row_start + width])

    compressed = zlib.compress(bytes(raw_rows), level=6)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + make_chunk(b"IHDR", ihdr)
        + make_chunk(b"IDAT", compressed)
        + make_chunk(b"IEND", b"")
    )
    path.write_bytes(png_bytes)


def read_uncompressed_float32_tiff(tif_path: Path):
    """Lee un GeoTIFF Float32 sin comprimir usando struct (sin dependencias externas)."""
    with tif_path.open("rb") as f:
        header = f.read(8)
        endian = "<" if header[:2] == b"II" else ">"
        magic, ifd_offset = struct.unpack(endian + "HI", header[2:8])
        if magic != 42:
            raise ValueError(f"Archivo TIFF no soportado (magic={magic})")

        f.seek(ifd_offset)
        num_entries = struct.unpack(endian + "H", f.read(2))[0]
        tags = {}
        for _ in range(num_entries):
            tag, typ, count, val_off = struct.unpack(endian + "HHII", f.read(12))
            tags[tag] = (typ, count, val_off)

        width = tags[256][2]
        height = tags[257][2]
        compression = tags.get(259, (3, 1, 1))[2]
        if compression != 1:
            raise RuntimeError(
                f"El TIFF usa compresión={compression}; instala rasterio para convertirlo."
            )

        # StripOffsets (273) y StripByteCounts (279)
        so_typ, so_cnt, so_off = tags[273]
        f.seek(so_off)
        so_fmt = "I" if so_typ == 4 else "H"
        strip_offsets = struct.unpack(
            f"{endian}{so_cnt}{so_fmt}", f.read(so_cnt * struct.calcsize(so_fmt))
        )

        sb_typ, sb_cnt, sb_off = tags[279]
        f.seek(sb_off)
        sb_fmt = "I" if sb_typ == 4 else "H"
        strip_bytes = struct.unpack(
            f"{endian}{sb_cnt}{sb_fmt}", f.read(sb_cnt * struct.calcsize(sb_fmt))
        )

        # PixelScale (33550)
        res_x_m, res_y_m = 20.0, 20.0
        if 33550 in tags:
            _, cnt, off = tags[33550]
            f.seek(off)
            scale = struct.unpack(f"{endian}{cnt}d", f.read(cnt * 8))
            res_x_m, res_y_m = float(scale[0]), float(scale[1])

        # Nodata (42113)
        nodata_val = None
        if 42113 in tags:
            _, cnt, off = tags[42113]
            f.seek(off)
            nd_str = f.read(cnt).rstrip(b"\x00").decode("ascii", errors="ignore").strip()
            if nd_str:
                try:
                    nodata_val = float(nd_str)
                except ValueError:
                    nodata_val = None

        # Leer todas las tiras como float32
        raw_floats = []
        for off, bc in zip(strip_offsets, strip_bytes):
            f.seek(off)
            n_floats = bc // 4
            row_vals = struct.unpack(f"{endian}{n_floats}f", f.read(bc))
            raw_floats.extend(row_vals)

    # Limpiar nodata/NaN si existieran
    valid_vals = [
        v
        for v in raw_floats
        if not (
            math.isnan(v)
            or v < -1e10
            or (nodata_val is not None and abs(v - nodata_val) < 1e30)
        )
    ]
    if len(valid_vals) < len(raw_floats):
        valid_sorted = sorted(valid_vals)
        median_val = valid_sorted[len(valid_sorted) // 2] if valid_sorted else 0.0
        raw_floats = [
            median_val
            if (
                math.isnan(v)
                or v < -1e10
                or (nodata_val is not None and abs(v - nodata_val) < 1e30)
            )
            else v
            for v in raw_floats
        ]
        min_elev = min(valid_vals)
        max_elev = max(valid_vals)
    else:
        min_elev = min(raw_floats)
        max_elev = max(raw_floats)

    return {
        "cols": width,
        "rows": height,
        "res_x_m": res_x_m,
        "res_y_m": res_y_m,
        "min_elev_m": float(min_elev),
        "max_elev_m": float(max_elev),
        "floats": raw_floats,
    }


def export_dataset(
    out_dir: Path,
    dataset_id: str,
    label: str,
    source: str,
    crs: str,
    rows: int,
    cols: int,
    res_x_m: float,
    res_y_m: float,
    floats: list,
    min_elev_m: float,
    max_elev_m: float,
    acquisition_date: str,
    uncertainty_note: str,
    existing_texture_path: Path = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Escribir heightmap.f32 en little-endian Float32
    f32_path = out_dir / "heightmap.f32"
    with f32_path.open("wb") as f:
        chunk_size = 65536
        for i in range(0, len(floats), chunk_size):
            chunk = floats[i : i + chunk_size]
            f.write(struct.pack(f"<{len(chunk)}f", *chunk))

    # 2. Escribir o copiar texture.png
    tex_path = out_dir / "texture.png"
    if existing_texture_path and existing_texture_path.exists():
        shutil.copyfile(existing_texture_path, tex_path)
    else:
        elev_range = max(max_elev_m - min_elev_m, 1e-6)
        pixels_u8 = bytes(
            max(0, min(255, int(round((v - min_elev_m) / elev_range * 255.0))))
            for v in floats
        )
        write_grayscale_png(tex_path, cols, rows, pixels_u8)

    # 3. Escribir metadata.json cumpliendo contrato 4.1
    width_m = round(cols * res_x_m, 2)
    depth_m = round(rows * res_y_m, 2)
    metadata = {
        "dataset_id": dataset_id,
        "label": label,
        "source": source,
        "crs": crs,
        "size_m": [width_m, depth_m],
        "resolution_m": round((res_x_m + res_y_m) / 2.0, 4),
        "shape": [rows, cols],
        "elevation_range_m": [round(min_elev_m, 2), round(max_elev_m, 2)],
        "heightmap": {
            "file": "heightmap.f32",
            "format": "float32-le",
            "units": "m",
        },
        "layers": [
            {"id": "base", "file": "texture.png", "type": "base"},
            {"id": "slope", "file": "slope.png", "type": "overlay", "unit": "deg", "range": [0, 45]},
            {"id": "risk", "file": "risk.png", "type": "overlay", "unit": "0-1"},
        ],
        "acquisition_date": acquisition_date,
        "uncertainty_note": uncertainty_note,
    }

    meta_path = out_dir / "metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # 4. Escribir config_fisio.json cumpliendo contrato 4.2
    config_fisio = {
        "gravity_ms2": 3.71,
        "eye_height_m": 1.6,
        "walk_speed_ms": 1.2,
        "run_speed_ms": 2.5,
        "max_safe_slope_deg": 25,
        "o2_reserve_l": 580.0,
        "o2_base_consumption_l_per_h": 50.0,
        "slope_cost_factors": [
            {"from_deg": 0, "to_deg": 5, "factor": 1.0},
            {"from_deg": 5, "to_deg": 10, "factor": 1.35},
            {"from_deg": 10, "to_deg": 15, "factor": 1.85},
            {"from_deg": 15, "to_deg": 20, "factor": 2.6},
            {"from_deg": 20, "to_deg": 25, "factor": 3.6},
            {"from_deg": 25, "to_deg": 90, "factor": 5.0},
        ],
        "notes": (
            "Fuentes y supuestos: gravity_ms2=3.71 m/s² (NASA Mars Fact Sheet); "
            "eye_height_m=1.6 m (estatura ocular media con traje EVA); "
            "walk_speed_ms=1.2 m/s y run_speed_ms=2.5 m/s (locomoción EVA en 0.38 g, NASA STD-3001); "
            "max_safe_slope_deg=25° (umbral máximo operativo de estabilidad EVA/rover, Semana 1); "
            "o2_reserve_l=580 L (reserva útil de O2 gaseoso equivalente en PLSS xEMU para EVA de ~8 h); "
            "o2_base_consumption_l_per_h=50 L/h (~0.83 L/min VO2 a tasa metabólica base de ~250 W, NASA HIDH); "
            "slope_cost_factors: multiplicadores metabólicos en ascenso según pendiente (ecuación de Pandolf/Margaria adaptada a EVA)."
        ),
    }
    fisio_path = out_dir / "config_fisio.json"
    fisio_path.write_text(json.dumps(config_fisio, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[OK] Dataset '{dataset_id}' exportado en {out_dir}")
    print(f"     shape={metadata['shape']}, size_m={metadata['size_m']}, elev={metadata['elevation_range_m']} m")


def generate_synthetic_dataset(out_dir: Path, dataset_id: str = "synth_crater") -> None:
    """Genera un segundo dataset sintético (cráter + colinas) para verificar el cambio por URL (?dataset=)."""
    rows, cols = 257, 257
    res_m = 50.0
    min_elev = -1200.0
    max_elev = -450.0
    floats = []

    for r in range(rows):
        ny = (r / (rows - 1)) - 0.5
        for c in range(cols):
            nx = (c / (cols - 1)) - 0.5
            dist = math.hypot(nx * 1.1, ny * 0.95)
            # Cráter central con borde elevado y anillo central
            crater = -520.0 * math.exp(-((dist / 0.24) ** 2))
            rim = 240.0 * math.exp(-(((dist - 0.28) / 0.08) ** 2))
            central_peak = 160.0 * math.exp(-((dist / 0.06) ** 2))
            undulation = (
                45.0 * math.sin(nx * 9.0) * math.cos(ny * 9.0)
                + 20.0 * math.sin(nx * 23.0 + ny * 17.0)
                + 80.0 * nx
            )
            elev = -850.0 + crater + rim + central_peak + undulation
            floats.append(float(elev))

    actual_min = min(floats)
    actual_max = max(floats)

    export_dataset(
        out_dir=out_dir,
        dataset_id=dataset_id,
        label="Cráter Sintético (dataset de validación)",
        source="synthetic",
        crs="IAU_2015:49900",
        rows=rows,
        cols=cols,
        res_x_m=res_m,
        res_y_m=res_m,
        floats=floats,
        min_elev_m=actual_min,
        max_elev_m=actual_max,
        acquisition_date="2026-10-26",
        uncertainty_note="DEM sintético analítico a 50 m/píxel para pruebas de cambio de dataset.",
    )


def main():
    parser = argparse.ArgumentParser(description="Convierte DEM GeoTIFF a formato Marswalk (.f32 + metadata.json)")
    parser.add_argument(
        "--dem",
        type=str,
        default="Semana 1/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
        help="Ruta al GeoTIFF de entrada",
    )
    parser.add_argument(
        "--texture",
        type=str,
        default="Semana 1/jezero_heightmap.png",
        help="Ruta a textura base opcional existente",
    )
    parser.add_argument(
        "--dataset-id",
        type=str,
        default="jezero_test",
        help="ID del dataset de salida en data/<dataset_id>/",
    )
    parser.add_argument(
        "--also-synth",
        action="store_true",
        default=True,
        help="Generar también data/synth_crater/ para validar cambio de ?dataset=",
    )
    args = parser.parse_args()

    root_dir = Path(__file__).resolve().parent.parent
    dem_path = root_dir / args.dem
    tex_path = root_dir / args.texture if args.texture else None
    out_dir = root_dir / "data" / args.dataset_id

    if not dem_path.exists():
        raise FileNotFoundError(f"No se encontró el DEM en: {dem_path}")

    info = read_uncompressed_float32_tiff(dem_path)
    export_dataset(
        out_dir=out_dir,
        dataset_id=args.dataset_id,
        label="Jezero (dataset de prueba)",
        source="CTX",
        crs="IAU_2015:49900",
        rows=info["rows"],
        cols=info["cols"],
        res_x_m=info["res_x_m"],
        res_y_m=info["res_y_m"],
        floats=info["floats"],
        min_elev_m=info["min_elev_m"],
        max_elev_m=info["max_elev_m"],
        acquisition_date="2020-07-30",
        uncertainty_note="DTM CTX B_soc_008 alineado a topografía MOLA (DeltaGeoid), resolución 20 m/píxel.",
        existing_texture_path=tex_path,
    )

    if args.also_synth:
        synth_dir = root_dir / "data" / "synth_crater"
        generate_synthetic_dataset(synth_dir, dataset_id="synth_crater")


if __name__ == "__main__":
    main()
