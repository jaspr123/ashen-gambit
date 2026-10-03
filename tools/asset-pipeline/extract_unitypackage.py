"""Extract selected assets from a .unitypackage into a folder, preserving Unity asset paths.
Never modifies the source package.
Usage: python extract_unitypackage.py <package> <outdir> [regex]"""
import sys, tarfile, re, os

def extract(pkg, outdir, pattern=None):
    rx = re.compile(pattern, re.I) if pattern else None
    names, members = {}, {}
    with tarfile.open(pkg, "r:gz") as tf:
        for m in tf:
            parts = m.name.strip("./").split("/")
            if len(parts) != 2:
                continue
            guid, kind = parts
            if kind == "pathname":
                names[guid] = tf.extractfile(m).read().decode("utf-8", "replace").splitlines()[0].strip()
            elif kind == "asset":
                members[guid] = tf.extractfile(m).read()
    n = 0
    for guid, name in names.items():
        if guid not in members or (rx and not rx.search(name)):
            continue
        dest = os.path.join(outdir, name.replace("Assets/", "", 1))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(members[guid])
        n += 1
    print(f"extracted {n} files from {os.path.basename(pkg)}")

if __name__ == "__main__":
    extract(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
