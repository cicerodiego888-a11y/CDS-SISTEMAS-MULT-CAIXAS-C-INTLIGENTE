import json, sqlite3, os, hashlib
from datetime import datetime, timezone

root = os.environ["MRT_ROOT"]
db_path = os.environ["MRT_DB"]
uri = "file:" + db_path.replace("\\", "/") + "?mode=ro"

out = {
  "banco": db_path,
  "modo": "readonly uri mode=ro",
  "gravacao": False,
  "consultadoEm": datetime.now(timezone.utc).isoformat()
}

conn = sqlite3.connect(uri, uri=True)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Confirm read-only: attempt pragma and fail write intentionally documented as not executed
cur.execute("PRAGMA query_only=ON")

# Schema for tef_pinpads
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tef%' ORDER BY name")
out["tabelasTef"] = [r[0] for r in cur.fetchall()]

cur.execute("PRAGMA table_info(tef_pinpads)")
out["colunasTefPinpads"] = [{"cid": r[0], "name": r[1], "type": r[2], "notnull": r[3], "pk": r[5]} for r in cur.fetchall()]

# All pinpad rows with identifying fields
cols = [c["name"] for c in out["colunasTefPinpads"]]
wanted = [c for c in [
  "id","tef_configuracao_id","habilitado","codigo","nome","fabricante","modelo",
  "porta_com","tipo_conexao","ip","status","ultima_conexao","criado_em","atualizado_em"
] if c in cols]
# include any other useful id columns present
for extra in cols:
  if extra not in wanted and any(k in extra.lower() for k in ("empresa","loja","pdv","terminal","serial","mac")):
    wanted.append(extra)

sql = "SELECT " + ", ".join(wanted) + " FROM tef_pinpads ORDER BY id ASC"
cur.execute(sql)
rows = [dict(r) for r in cur.fetchall()]
out["tef_pinpads_count"] = len(rows)
out["tef_pinpads"] = rows

# Join config if possible for provider destaxa
cfg_info = {}
if "tef_configuracao" in out["tabelasTef"]:
  cur.execute("PRAGMA table_info(tef_configuracao)")
  cfg_cols = [r[1] for r in cur.fetchall()]
  cfg_info["colunas"] = cfg_cols
  select_cfg = [c for c in cfg_cols if c in (
    "id","empresa_id","loja_id","pdv_id","provedor","tef_provedor","habilitado","ativo",
    "nome","ambiente","atualizado_em","criado_em"
  ) or "provedor" in c.lower() or "empresa" in c.lower() or "loja" in c.lower()]
  if "id" not in select_cfg:
    select_cfg = ["id"] + select_cfg
  cur.execute("SELECT " + ", ".join(dict.fromkeys(select_cfg)) + " FROM tef_configuracao ORDER BY id ASC")
  cfg_info["registros"] = [dict(r) for r in cur.fetchall()]
out["tef_configuracao"] = cfg_info

# Enrich pinpads with config provider
by_cfg = {c.get("id"): c for c in cfg_info.get("registros", [])}
for r in rows:
  cfg = by_cfg.get(r.get("tef_configuracao_id"))
  r["_config"] = cfg

conn.close()

# Identification logic
destaxa_candidates = []
for r in rows:
  cfg = r.get("_config") or {}
  blob = json.dumps(cfg, ensure_ascii=False).lower() + " " + json.dumps({k:v for k,v in r.items() if k!='_config'}, ensure_ascii=False).lower()
  if "destaxa" in blob or (str(r.get("codigo") or "").upper().find("GERTEC")>=0) or "ppc" in blob:
    destaxa_candidates.append(r)

out["identificacao"] = {
  "totalRegistros": len(rows),
  "candidatosDestaxaOuGertec": len(destaxa_candidates),
  "criterio": "provedor/config contendo destaxa OU codigo/nome Gertec/PPC"
}

path = os.path.join(root, "consulta-tef-pinpads.json")
with open(path, "w", encoding="utf-8") as f:
  json.dump(out, f, ensure_ascii=False, indent=2, default=str)
print(json.dumps({
  "ok": True,
  "count": len(rows),
  "candidatos": len(destaxa_candidates),
  "file": path,
  "rows_summary": [
    {
      "id": r.get("id"),
      "tef_configuracao_id": r.get("tef_configuracao_id"),
      "codigo": r.get("codigo"),
      "nome": r.get("nome"),
      "porta_com": r.get("porta_com"),
      "habilitado": r.get("habilitado"),
      "status": r.get("status"),
      "provedor": (r.get("_config") or {}).get("tef_provedor") or (r.get("_config") or {}).get("provedor")
    } for r in rows
  ]
}, ensure_ascii=False, indent=2, default=str))
