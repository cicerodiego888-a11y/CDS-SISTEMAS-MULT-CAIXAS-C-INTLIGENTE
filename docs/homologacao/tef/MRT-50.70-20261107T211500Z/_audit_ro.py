# MRT-50.70 — consultas somente leitura (não grava no mercadao.db)
import sqlite3
import json
from pathlib import Path

OUT = Path(__file__).with_name('consulta-cadastro-ro.json')
db = r'C:\ProgramData\MercantilFiscal\dados\mercadao.db'

con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
con.execute('PRAGMA query_only=ON')
cur = con.cursor()

tabs = [
    r[0]
    for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tef%' ORDER BY 1"
    ).fetchall()
]

payload = {'gravacao': False, 'tables': tabs, 'pinpads': [], 'configuracoes': []}

# pinpads
try:
    cols = [r[1] for r in cur.execute('PRAGMA table_info(tef_pinpads)').fetchall()]
    rows = cur.execute('SELECT * FROM tef_pinpads').fetchall()
    for row in rows:
        d = dict(zip(cols, row))
        payload['pinpads'].append(d)
except Exception as e:
    payload['pinpads_erro'] = str(e)

# configuracao (todas as tabelas com config no nome)
for t in tabs:
    if 'config' not in t.lower():
        continue
    try:
        cols = [r[1] for r in cur.execute(f'PRAGMA table_info({t})').fetchall()]
        rows = cur.execute(f'SELECT * FROM {t} LIMIT 20').fetchall()
        items = []
        for row in rows:
            d = dict(zip(cols, row))
            for k in list(d):
                if any(
                    x in k.lower()
                    for x in ('senha', 'token', 'secret', 'key', 'cert', 'password', 'chave')
                ):
                    if d[k]:
                        d[k] = '***'
            items.append(d)
        payload['configuracoes'].append({'table': t, 'cols': cols, 'rows': items})
    except Exception as e:
        payload['configuracoes'].append({'table': t, 'erro': str(e)})

con.close()
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf-8')
print('OK', OUT)
