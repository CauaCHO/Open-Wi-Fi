"""Compare this upgrade with the supplied v1.5 ZIP. Never edits the base archive."""
from pathlib import Path
import hashlib
import json
import re
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
baseline = Path(sys.argv[1])
with zipfile.ZipFile(baseline) as archive:
    old_source = archive.read('src/index.js').decode('utf-8').replace('\r\n', '\n')
    source = (root / 'src/index.js').read_text(encoding='utf-8')
    changed_regions = [
        ('async function adminRouters(env)', 'async function adminCreateRouterEnrollment'),
        ('async function adminPlatform(env)', 'async function adminDashboard'),
        ('function adminPage(){', 'function portalPage(env) {'),
    ]
    def normalize(text):
        for begin, end in changed_regions:
            first = text.index(begin)
            last = text.index(end, first)
            text = text[:first] + '// reviewed region\n' + text[last:]
        return text.replace('Open Wi-Fi Cloudflare v1.5.1 SaaS Control', 'Open Wi-Fi Cloudflare v1.5 Command Center')
    assert normalize(source) == normalize(old_source), 'Unexpected changes outside the three reviewed functions'
    files = {}
    for name in archive.namelist():
        if name.startswith(('migrations/', 'mikrotik/')) or name == 'wrangler.toml':
            original = archive.read(name)
            assert (root / name).read_bytes() == original, f'Protected file changed: {name}'
            files[name] = hashlib.sha256(original).hexdigest()
    payload = {
        'baseline': baseline.name,
        'baselineSha256': hashlib.sha256(baseline.read_bytes()).hexdigest(),
        'workerComparedWithNormalizedLineEndings': True,
        'changedFunctions': ['adminRouters', 'adminPlatform', 'adminPage'],
        'otherSourceChange': 'Root endpoint version text only',
        'allOtherWorkerCodeIdentical': True,
        'protectedFilesSha256': files,
        'note': 'Preservation is a code comparison, not proof of physical or commercial integration tests.'
    }
    (root / 'PRESERVACAO.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Preserved all Worker code outside the three reviewed functions and version text; {len(files)} protected files identical.')
