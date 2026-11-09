import json
import sqlite3

db = r'C:\ProgramData\MercantilFiscal\dados\mercadao.db'
con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
con.execute('PRAGMA query_only=ON')
cur = con.cursor()

cfg_cols = [r[1] for r in cur.execute('PRAGMA table_info(tef_configuracao)')]
cfg = dict(zip(cfg_cols, cur.execute('SELECT * FROM tef_configuracao').fetchone()))
pin_cols = [r[1] for r in cur.execute('PRAGMA table_info(tef_pinpads)')]
pin = dict(zip(pin_cols, cur.execute('SELECT * FROM tef_pinpads').fetchone()))

pendencias = []
try:
    q = (
        "SELECT id,status,codigo_resposta,valor,criado_em FROM tef_transacoes "
        "WHERE lower(coalesce(status,'')) IN "
        "('pendente','pending','em_andamento','unknown','iniciada','processando') "
        "ORDER BY id DESC LIMIT 10"
    )
    for r in cur.execute(q):
        pendencias.append({
            'id': r[0], 'status': r[1], 'codigo_resposta': r[2],
            'valor': r[3], 'criado_em': r[4]
        })
except Exception as e:
    pendencias = [{'erro': str(e)}]

out = {
    'gravacao': False,
    'cfg': {
        'provedor': cfg.get('provedor'),
        'ambiente': cfg.get('ambiente'),
        'empresa_codigo': cfg.get('empresa_codigo'),
        'loja_codigo': cfg.get('loja_codigo'),
        'terminal_codigo': cfg.get('terminal_codigo'),
        'habilitado': cfg.get('habilitado')
    },
    'pin': {
        'codigo': pin.get('codigo'),
        'porta_com': pin.get('porta_com'),
        'habilitado': pin.get('habilitado'),
        'ativo': pin.get('ativo'),
        'modelo': pin.get('modelo')
    },
    'pendencias': pendencias
}
print(json.dumps(out, ensure_ascii=False, indent=2))
con.close()
