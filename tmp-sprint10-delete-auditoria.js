'use strict';

const sqlite3 = require('./node_modules/sqlite3');
const src = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const IDS = [3073, 3074, 3077, 3078, 3079, 3080, 3081, 3082, 3088, 3089, 3090, 3091, 3092, 3093, 3119, 3120, 3121, 3122, 3123, 3124];
const db = new sqlite3.Database(src);
const q = (s, p = []) => new Promise((r, j) => db.all(s, p, (e, rows) => (e ? j(e) : r(rows))));
const run = (s, p = []) => new Promise((r, j) => db.run(s, p, function onRun(e) { e ? j(e) : r(this); }));

(async () => {
  const vendasAntes = await q('SELECT id, status, tipo_venda, status_entrega, nome_cliente_entrega, total FROM vendas WHERE id IN (1,10,15,16) ORDER BY id');
  const audAntes = (await q('SELECT COUNT(*) n, MAX(id) mx FROM auditoria'))[0];
  const vizinhosAntes = await q('SELECT id FROM auditoria WHERE id IN (3072,3075,3076,3083,3118,3125) ORDER BY id');
  const alvo = await q(`SELECT id, modulo, acao, referencia_id FROM auditoria WHERE id IN (${IDS.join(',')}) ORDER BY id`);
  if (alvo.length !== 20) throw new Error('COUNT=' + alvo.length);
  for (const r of alvo) {
    if (r.modulo !== 'vendas_entrega') throw new Error('modulo ' + r.id);
    if (!['entrega_iniciada', 'mudanca_status', 'entrega_editada'].includes(r.acao)) throw new Error('acao ' + r.id);
    if (![1, 10, 15].includes(Number(r.referencia_id))) throw new Error('ref ' + r.id);
  }
  await run('BEGIN IMMEDIATE');
  const del = await run(
    `DELETE FROM auditoria WHERE id IN (${IDS.join(',')}) AND modulo = 'vendas_entrega' AND acao IN ('entrega_iniciada','mudanca_status','entrega_editada') AND CAST(referencia_id AS INTEGER) IN (1,10,15)`
  );
  if (del.changes !== 20) {
    await run('ROLLBACK');
    throw new Error('changes=' + del.changes);
  }
  await run('COMMIT');
  const restam = await q(`SELECT id FROM auditoria WHERE id IN (${IDS.join(',')})`);
  const vendasDepois = await q('SELECT id, status, tipo_venda, status_entrega, nome_cliente_entrega, total FROM vendas WHERE id IN (1,10,15,16) ORDER BY id');
  const audDepois = (await q('SELECT COUNT(*) n, MAX(id) mx FROM auditoria'))[0];
  const vizinhosDepois = await q('SELECT id FROM auditoria WHERE id IN (3072,3075,3076,3083,3118,3125) ORDER BY id');
  const entregaReal = await q("SELECT id FROM auditoria WHERE modulo='vendas_entrega' AND id IN (2978,2980,3026)");
  console.log(JSON.stringify({
    vendasAntes,
    vendasDepois,
    audAntes,
    audDepois,
    vizinhosAntes: vizinhosAntes.map((x) => x.id),
    vizinhosDepois: vizinhosDepois.map((x) => x.id),
    restam: restam.length,
    deleted: del.changes,
    entregaReal: entregaReal.map((x) => x.id),
    vendasIguais: JSON.stringify(vendasAntes) === JSON.stringify(vendasDepois)
  }, null, 2));
  db.close();
})().catch((e) => {
  console.error('FALHOU', e.message);
  try { db.close(); } catch (_) { /* ignore */ }
  process.exit(1);
});
