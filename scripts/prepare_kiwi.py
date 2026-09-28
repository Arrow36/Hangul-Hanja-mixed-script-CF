"""Fetch the pinned official Kiwi model and split assets under Cloudflare's file limit."""
import hashlib
import json
import shutil
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
MODEL = PUBLIC / 'model'
URL = 'https://github.com/bab2min/Kiwi/releases/download/v0.24.0/kiwi_model_v0.24.0_base.tgz'
SHA256 = '33188ba932bba4717bad5244bbec0ef8b1c9cbb47e26e68394a7976d8d779083'
FILES = ('combiningRule.txt', 'default.dict', 'extract.mdl', 'multi.dict',
         'sj.morph', 'typo.dict', 'cong.mdl', 'nounchr.mdl', 'dialect.dict')
CHUNK = 20 * 1024 * 1024

def main():
    MODEL.mkdir(parents=True, exist_ok=True)
    wasm = ROOT / 'node_modules/kiwi-nlp/dist/kiwi-wasm.wasm'
    if not wasm.exists():
        raise SystemExit('Run npm install first')
    shutil.copyfile(wasm, PUBLIC / 'static/kiwi-wasm.wasm')
    if (MODEL / 'manifest.json').exists():
        return
    archive = ROOT / 'work-kiwi-model.tgz'
    try:
        if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
            urllib.request.urlretrieve(URL, archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
            raise RuntimeError('Kiwi model checksum mismatch')
        manifest = {}
        with tarfile.open(archive, 'r:gz') as tar:
            for name in FILES:
                member = tar.getmember('models/cong/base/' + name)
                parts = []
                with tar.extractfile(member) as source:
                    assert source is not None
                    index = 0
                    while data := source.read(CHUNK):
                        part = f'{name}.{index:03d}'
                        (MODEL / part).write_bytes(data)
                        parts.append(part)
                        index += 1
                manifest[name] = parts
        (MODEL / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    finally:
        archive.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
