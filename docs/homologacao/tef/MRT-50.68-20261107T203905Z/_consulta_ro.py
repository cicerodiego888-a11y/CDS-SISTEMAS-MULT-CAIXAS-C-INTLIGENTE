import json, sqlite3, os
db = os.environ["MRT_DB"]
uri = "file:" + db.replace("\\", "/") + "?mode=ro"
conn = sqlite3.connect(uri, uri=True)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("PRAGMA query_only=ON")
cur.execute("""
SELECT p.id, p.codigo, p.nome, p.porta_com, p.habilitado, p.status, c.provedor, c.ambiente
FROM tef_pinpads p
LEFT JOIN tef_configuracao c ON c.id = p.tef_configuracao_id
ORDER BY p.id
""")
rows = [dict(r) for r in cur.fetchall()]
conn.close()
out = {
  "banco": db,
  "modo": "readonly uri mode=ro",
  "gravacao": False,
  "rows": rows,
  "porta_com": rows[0]["porta_com"] if rows else None,
  "coincidemCom4": bool(rows) and str(rows[0].get("porta_com") or "").upper() == "COM4"
}
print(json.dumps(out, ensure_ascii=False, indent=2))
