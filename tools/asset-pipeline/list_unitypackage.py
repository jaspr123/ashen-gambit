"""List the logical asset paths inside a .unitypackage (gzipped tar of GUID folders).
Usage: python list_unitypackage.py <package> [ext,ext,...]"""
import sys, tarfile, collections

def list_package(path, exts=None):
    names = {}
    sizes = {}
    with tarfile.open(path, "r:gz") as tf:
        for m in tf:
            parts = m.name.strip("./").split("/")
            if len(parts) != 2:
                continue
            guid, kind = parts
            if kind == "pathname":
                names[guid] = tf.extractfile(m).read().decode("utf-8", "replace").splitlines()[0].strip()
            elif kind == "asset":
                sizes[guid] = m.size
    out = []
    for guid, name in names.items():
        if guid not in sizes:
            continue
        if exts and not name.lower().endswith(tuple(exts)):
            continue
        out.append((name, sizes[guid], guid))
    return sorted(out)

if __name__ == "__main__":
    exts = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    rows = list_package(sys.argv[1], exts)
    c = collections.Counter(n.rsplit(".", 1)[-1].lower() for n, _, _ in list_package(sys.argv[1]))
    print("TYPES:", dict(c.most_common(12)))
    for n, s, g in rows:
        print(f"{s/1024:9.0f}KB  {n}")
