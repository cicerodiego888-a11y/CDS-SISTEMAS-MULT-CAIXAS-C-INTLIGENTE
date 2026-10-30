const db = require('../../database');
const pinpadCatalog = require('./pinpads/pinpadCatalog');

function promisifyAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function enriquecerComEstatico(row) {
  const meta = pinpadCatalog.resolverPorCodigo(row.codigo) || {};
  return {
    codigo: row.codigo,
    nome: meta.nome || row.nome,
    fabricante: meta.fabricante || row.fabricante,
    modelo: meta.modelo || row.modelo,
    adquirenteSugerido: meta.adquirenteSugerido ?? row.adquirenteSugerido ?? null,
    ativo: row.ativo !== 0 && row.ativo !== false,
    nomeExibicao: meta.nomeExibicao || row.nome || row.codigo,
    integracaoTefStatus: meta.integracaoTefStatus || pinpadCatalog.INTEGRACAO_TEF.NAO_INTEGRADO,
    interfacesFisicasDocumentadas: meta.interfacesFisicasDocumentadas || [],
    descricaoConexao: meta.descricaoConexao || null,
    observacaoAdquirente: meta.observacaoAdquirente || null,
    adquirenteSugeridoNaoSelecionaProvedor: true
  };
}

/**
 * Catálogo exibido na Configuração TEF.
 * Fonte autoritativa de metadados (status de integração) = pinpadCatalog estático.
 * Tabela tef_pinpad_catalogo complementa com seeds/ativos; não remove modelos estáticos.
 */
async function listarCatalogoAtivo() {
  const porCodigo = new Map();

  for (const modelo of pinpadCatalog.listarAtivos()) {
    porCodigo.set(modelo.codigo, enriquecerComEstatico(modelo));
  }

  try {
    const rows = await promisifyAll(`
      SELECT codigo, nome, fabricante, modelo, adquirente_sugerido AS adquirenteSugerido, ativo
      FROM tef_pinpad_catalogo
      WHERE ativo = 1
      ORDER BY nome ASC
    `);

    for (const row of rows) {
      if (porCodigo.has(row.codigo)) {
        continue;
      }
      porCodigo.set(row.codigo, enriquecerComEstatico(row));
    }
  } catch {
    // tabela pode não existir em bases antigas até migração
  }

  return [...porCodigo.values()].sort((a, b) => String(a.nomeExibicao || a.nome).localeCompare(
    String(b.nomeExibicao || b.nome),
    'pt-BR'
  ));
}

module.exports = {
  listarCatalogoAtivo
};
