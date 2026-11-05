from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
out = root.parent / "deliverables" / "open-wifi-v2.0.0-rc.1-smartnet.zip"
out.parent.mkdir(exist_ok=True)
skip = {"node_modules", ".qa", ".wrangler", ".wrangler-config", ".npm-cache", "__pycache__"}
with ZipFile(out, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for path in root.rglob("*"):
        if not path.is_file() or any(part in skip for part in path.relative_to(root).parts):
            continue
        if path.name in {".dev.vars", ".env"} or path.name.startswith(".env.") or path.suffix == ".log":
            continue
        archive.write(path, (Path("open-wifi-v2.0.0-rc.1-smartnet") / path.relative_to(root)).as_posix())
print(out)
