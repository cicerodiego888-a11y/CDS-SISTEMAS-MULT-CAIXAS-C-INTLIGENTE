# MRT-50.70 — inspeção .conf sem gravar credenciais
from pathlib import Path
import re
import json
import hashlib
from collections import Counter

conf = Path(r'C:\VBI') / 'V$Pague' / 'Client' / 'V$PagueClient_Destaxa_LojaACB_TACB0120.conf'
out = Path(__file__).with_name('conf-inspecao.json')

raw = conf.read_bytes()
sha = hashlib.sha256(raw).hexdigest().upper()
text = None
enc_used = None
for enc in ('utf-8', 'utf-16', 'latin-1', 'cp1252'):
    try:
        text = raw.decode(enc)
        enc_used = enc
        break
    except Exception:
        pass

sens = re.compile(
    r'(senha|password|token|secret|key|cert|chave|private|credencial|authorization|api.?key|thumbprint)',
    re.I,
)

result = {
    'path': str(conf),
    'exists': True,
    'size': len(raw),
    'mtimeUtc': conf.stat().st_mtime,
    'sha256': sha,
    'encodingDetectada': enc_used,
    'linhas': len(text.splitlines()) if text else None,
    'amostraKvMascarada': [],
    'chavesMaisFrequentes': [],
    'hitsOperacionais': {},
}

if text:
    keys = []
    samples = []
    for i, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        if not s or s.startswith('#') or s.startswith(';'):
            continue
        m = re.match(r'^([A-Za-z0-9_./\\\-]+)\s*[=:]\s*(.*)$', s)
        if m:
            k, v = m.group(1), m.group(2)
            keys.append(k)
            if sens.search(k) or sens.search(v):
                samples.append({'linha': i, 'chave': k, 'valor': '***'})
            else:
                samples.append({
                    'linha': i,
                    'chave': k,
                    'valor': v if len(v) <= 100 else v[:97] + '...'
                })
        else:
            tags = re.findall(r'</?([A-Za-z0-9_:-]+)', s)
            keys.extend(tags)

    result['amostraKvMascarada'] = samples[:50]
    result['chavesMaisFrequentes'] = [
        {'chave': k, 'n': n} for k, n in Counter(keys).most_common(40)
    ]

    for kw in (
        'LojaACB', 'TACB0120', 'COM4', 'COM3', 'PPC', 'estabelecimento', 'loja',
        'terminal', 'Destaxa', 'porta', 'serial', 'PinPad', 'Gertec', 'Merchant',
        'Store', 'TerminalId', 'Company'
    ):
        hits = []
        for ln in text.splitlines():
            if kw.lower() in ln.lower():
                hh = ln.strip()
                if sens.search(hh):
                    hh = sens.sub('***', hh)
                hits.append(hh[:180])
        result['hitsOperacionais'][kw] = {
            'count': len(hits),
            'amostras': hits[:5]
        }

out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('OK', out)
