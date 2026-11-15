"""Generic HDF5 structure dump. Used to LEARN a real NISAR file's layout before any reader is written.
Run: python -m pipeline.nisar.hdf5_inspect path/to/file.h5   (prints groups, datasets, shapes, dtypes, attributes)"""
from __future__ import annotations
import sys
import h5py


def describe(path: str, max_attr_len: int = 120) -> list[str]:
    lines: list[str] = []
    def attrs(o):
        for k, v in o.attrs.items():
            s = repr(v if not hasattr(v, "tolist") else v.tolist())
            lines.append(f"    @{k} = {s[:max_attr_len]}")
    def visit(name, obj):
        if isinstance(obj, h5py.Dataset):
            lines.append(f"[D] /{name}  shape={obj.shape} dtype={obj.dtype}")
        else:
            lines.append(f"[G] /{name}")
        attrs(obj)
    with h5py.File(path, "r") as f:
        lines.append("[G] /"); attrs(f)
        f.visititems(visit)
    return lines


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m pipeline.nisar.hdf5_inspect <file.h5>")
    print("\n".join(describe(sys.argv[1])))
