import json, sqlite3, os
db=os.environ["MRT_DB"]
uri="file:"+db.replace("\\","/")+"?mode=ro"
conn=sqlite3.connect(uri, uri=True)
conn.row_factory=sqlite3.Row
cur=conn.cursor()
cur.execute("PRAGMA query_only=ON")
cur.execute("""
SELECT p.id, p.codigo, p.porta_com, p.habilitado, p.status, c.provedor, c.ambiente
FROM tef_pinpads p LEFT JOIN tef_configuracao c ON c.id=p.tef_configuracao_id ORDER BY p.id
""")
pinpads=[dict(r) for r in cur.fetchall()]
# pending / unknown-ish TEF rows (read-only sample)
cur.execute("""
SELECT name FROM sqlite_master WHERE type='table' AND name='tef_transacoes'
""")
has_tx=cur.fetchone() is not None
pendentes=[]
if has_tx:
  cur.execute("PRAGMA table_info(tef_transacoes)")
  cols=[r[1] for r in cur.fetchall()]
  status_col='status' if 'status' in cols else None
  if status_col:
    cur.execute(f"""
      SELECT id, status, provedor, valor, tipo, idempotency_key
      FROM tef_transacoes
      WHERE lower(coalesce(status,'')) IN ('pendente','pending','unknown','em_andamento','processando')
         OR lower(coalesce(status,'')) LIKE '%unknown%'
      ORDER BY id DESC LIMIT 20
    """)
    pendentes=[dict(r) for r in cur.fetchall()]
conn.close()
print(json.dumps({
  "gravacao": False,
  "pinpads": pinpads,
  "porta_com": pinpads[0]["porta_com"] if pinpads else None,
  "com4": bool(pinpads) and str(pinpads[0].get("porta_com","")).upper()=="COM4",
  "pendentesOuUnknown": pendentes,
  "temPendenciaBloqueante": len(pendentes)>0
}, ensure_ascii=False, indent=2))
