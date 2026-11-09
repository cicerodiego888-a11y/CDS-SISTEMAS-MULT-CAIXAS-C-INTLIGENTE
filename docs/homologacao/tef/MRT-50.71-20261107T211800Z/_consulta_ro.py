import json
import sqlite3
from pathlib import Path

db = r'C:\ProgramData\MercantilFiscal\dados\mercadao.db'
out = Path(__file__).with_name('consulta-cadastro-ro.json')

con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
con.execute('PRAGMA query_only=ON')
cur = con.cursor()

hits = []
for (name,) in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
    cols = [r[1] for r in cur.execute(f'PRAGMA table_info({name})').fetchall()]
    if any(
        ('empresa' in c.lower())
        or ('loja_cod' in c.lower())
        or ('terminal_cod' in c.lower())
        or ('estabelecimento' in c.lower())
        for c in cols
    ):
        hits.append({'table': name, 'cols': cols})

pin_cols = [r[1] for r in cur.execute('PRAGMA table_info(tef_pinpads)').fetchall()]
pin_rows = [dict(zip(pin_cols, r)) for r in cur.execute('SELECT * FROM tef_pinpads').fetchall()]

cfg_cols = [r[1] for r in cur.execute('PRAGMA table_info(tef_configuracao)').fetchall()]
cfg_rows = [dict(zip(cfg_cols, r)) for r in cur.execute('SELECT * FROM tef_configuracao').fetchall()]

# tef_configuracoes key/value
kv = []
try:
    kv_cols = [r[1] for r in cur.execute('PRAGMA table_info(tef_configuracoes)').fetchall()]
    for r in cur.execute('SELECT * FROM tef_configuracoes LIMIT 50').fetchall():
        d = dict(zip(kv_cols, r))
        kv.append(d)
except Exception as e:
    kv = [{'erro': str(e)}]

con.close()

payload = {
    'gravacao': False,
    'outrasTabelasComCamposRoteamento': hits,
    'pinpads': pin_rows,
    'tef_configuracao': cfg_rows,
    'tef_configuracoes_kv': kv
}
out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf-8')
print('OK', out)
