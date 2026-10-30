"""Standard compression only; retain the original executables for verification."""
from pathlib import Path
import gzip
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent / 'oneclick/public/bin'
releases = []
for name in ['setup-windows-amd64.exe', 'setup-windows-arm64.exe', 'setup-darwin-amd64', 'setup-darwin-arm64']:
    source = root / name
    data = source.read_bytes()
    archive = root / (name + ('.zip' if name.endswith('.exe') else '.gz'))
    if name.endswith('.exe'):
        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as stream:
            stream.writestr(info, data)
    else:
        archive.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    raw_hash = hashlib.sha256(data).hexdigest()
    compressed_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    releases.append({'name': name, 'archive': archive.name, 'size': len(data), 'archive_size': archive.stat().st_size,
                     'sha256': raw_hash, 'archive_sha256': compressed_hash})
    (root / (archive.name + '.sha256')).write_text(compressed_hash + '\n', encoding='ascii')
    print(f'{name}: {len(data)} -> {archive.stat().st_size} bytes')
(root / 'releases.json').write_text(json.dumps({'files': releases}, indent=2) + '\n', encoding='utf-8')
(root / 'SHA256SUMS.txt').write_text(''.join(f"{item['sha256']}  {item['name']}\n{item['archive_sha256']}  {item['archive']}\n" for item in releases), encoding='ascii')
