import json
import sqlite3

p = r"C:\ProgramData\MercantilFiscal\dados\mercadao.db"
c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
cur = c.cursor()
cols = [r[1] for r in cur.execute("PRAGMA table_info(produtos)")]
preco = next((x for x in ["preco_venda", "preco", "valor_venda"] if x in cols), None)
cb = next((x for x in ["codigo_barras", "ean", "gtin"] if x in cols), None)
ci = next((x for x in ["codigo_interno", "codigo"] if x in cols), None)
nome = next((x for x in ["nome", "descricao"] if x in cols), None)
q = (
    f"SELECT id, {cb or 'NULL'}, {ci or 'NULL'}, {nome or 'NULL'}, {preco} "
    f"FROM produtos WHERE CAST({preco} AS REAL)=1.0 LIMIT 20"
)
rows = cur.execute(q).fetchall()
print(json.dumps({"cols_sample": cols[:25], "preco": preco, "rows": rows}, ensure_ascii=False, indent=2))
c.close()
