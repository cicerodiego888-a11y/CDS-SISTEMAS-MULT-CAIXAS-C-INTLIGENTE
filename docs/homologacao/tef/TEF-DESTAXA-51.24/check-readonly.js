'use strict';

const fs = require('fs');
const path = require('path');
const {
  inspecionarGateFinanceiro
} = require('../../../../backend/services/tef/destaxa/destaxaConstantes');

console.log('GATE', JSON.stringify(inspecionarGateFinanceiro(), null, 2));

const { DatabaseSync } = require('node:sqlite');

const paths = [
  'C:/ProgramData/MercantilFiscal/dados/mercadao.db',
  path.join(__dirname, '..', '..', '..', '..', 'dados', 'mercadao.db')
];

for (const p of paths) {
  if (!fs.existsSync(p)) {
    console.log('MISSING', p);
    continue;
  }
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const row = db.prepare(`
      SELECT id, status, valor, tipo, provedor, nsu, autorizacao,
             idempotency_key, venda_id, criado_em, atualizado_em
      FROM tef_transacoes WHERE id = 1
    `).get();
    const pendentes = db.prepare(`
      SELECT id, status, valor, tipo, provedor, idempotency_key, criado_em
      FROM tef_transacoes WHERE status = 'pendente' ORDER BY id
    `).all();
    console.log('DB', p);
    console.log(JSON.stringify({
      id1: row || { ausente: true },
      pendentesCount: pendentes.length,
      pendentes
    }, null, 2));
  } finally {
    db.close();
  }
}
