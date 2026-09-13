/**
 * Aplica CFOP e CSOSN do padrão fiscal da empresa em todos os produtos.
 * Origem e CEST não são alterados no cadastro existente.
 */
'use strict';

function aplicarCfopCsosnEmTodosProdutos(db, { cfop, csosn }, callback) {
  const cfopNorm = cfop != null ? String(cfop).trim() : '';
  const csosnNorm = csosn != null ? String(csosn).trim() : '';

  if (!cfopNorm && !csosnNorm) {
    return callback(null, { produtos_atualizados: 0, cfop: '', csosn: '', aplicado: false });
  }

  const sets = ['updated_at = datetime(\'now\', \'localtime\')'];
  const params = [];

  if (cfopNorm) {
    sets.push('cfop = ?');
    params.push(cfopNorm);
  }
  if (csosnNorm) {
    sets.push('csosn = ?');
    params.push(csosnNorm);
  }

  db.run(
    `UPDATE produtos SET ${sets.join(', ')}`,
    params,
    function onUpdate(err) {
      if (err) return callback(err);
      callback(null, {
        produtos_atualizados: Number(this.changes || 0),
        cfop: cfopNorm,
        csosn: csosnNorm,
        aplicado: true
      });
    }
  );
}

module.exports = {
  aplicarCfopCsosnEmTodosProdutos
};
