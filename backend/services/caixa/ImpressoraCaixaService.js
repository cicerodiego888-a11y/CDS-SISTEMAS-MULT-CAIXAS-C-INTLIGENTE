'use strict';

function criarImpressoraCaixaService(db) {
  if (!db) throw new TypeError('Conexão de banco obrigatória.');

  function normalizarCaixaId(caixaId) {
    const id = Number(caixaId);
    if (!Number.isInteger(id) || id <= 0) {
      const erro = new Error('ID do caixa inválido.');
      erro.status = 400;
      throw erro;
    }
    return id;
  }

  function buscarCaixa(caixaId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT id, impressora_cupom FROM caixas WHERE id = ?',
        [caixaId],
        (err, row) => {
          if (err) return reject(err);
          if (!row) {
            const erro = new Error('Caixa não encontrado.');
            erro.status = 404;
            return reject(erro);
          }
          resolve(row);
        }
      );
    });
  }

  function buscarImpressoraLegada() {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT valor FROM configuracoes WHERE chave = 'impressora_cupom'",
        [],
        (err, row) => (err ? reject(err) : resolve(row?.valor || null))
      );
    });
  }

  async function obterImpressoraDoCaixa(caixaId) {
    const id = normalizarCaixaId(caixaId);
    const caixa = await buscarCaixa(id);
    return {
      caixa_id: id,
      impressora_cupom: caixa.impressora_cupom || null
    };
  }

  async function resolverImpressoraDoCaixa(caixaId) {
    const id = normalizarCaixaId(caixaId);
    const caixa = await buscarCaixa(id);
    const valorNormalizado = typeof caixa.impressora_cupom === 'string'
      ? caixa.impressora_cupom.trim()
      : '';

    if (valorNormalizado) {
      return {
        caixa_id: id,
        impressora_cupom: valorNormalizado,
        configurada: true,
        deviceName: valorNormalizado
      };
    }

    const fallbackSalvo = await buscarImpressoraLegada();
    const fallback = typeof fallbackSalvo === 'string' ? fallbackSalvo.trim() : '';
    if (fallback) {
      return {
        caixa_id: id,
        impressora_cupom: null,
        configurada: false,
        deviceName: fallback,
        fallback
      };
    }

    return {
      caixa_id: id,
      impressora_cupom: null,
      configurada: false,
      deviceName: null
    };
  }

  async function salvarImpressoraDoCaixa(caixaId, deviceName) {
    const id = normalizarCaixaId(caixaId);
    if (deviceName != null && typeof deviceName !== 'string') {
      const erro = new Error('Nome da impressora inválido.');
      erro.status = 400;
      throw erro;
    }

    const nome = typeof deviceName === 'string' ? deviceName.trim() : '';
    if (nome.length > 255) {
      const erro = new Error('Nome da impressora excede 255 caracteres.');
      erro.status = 400;
      throw erro;
    }

    await buscarCaixa(id);
    const valor = nome || null;
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE caixas SET impressora_cupom = ? WHERE id = ?',
        [valor, id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    return { caixa_id: id, impressora_cupom: valor };
  }

  return { obterImpressoraDoCaixa, resolverImpressoraDoCaixa, salvarImpressoraDoCaixa };
}

let servicoPrincipal = null;

function obterServicoPrincipal() {
  if (!servicoPrincipal) {
    servicoPrincipal = criarImpressoraCaixaService(require('../../database'));
  }
  return servicoPrincipal;
}

module.exports = {
  criarImpressoraCaixaService,
  obterImpressoraDoCaixa: (...args) => obterServicoPrincipal().obterImpressoraDoCaixa(...args),
  resolverImpressoraDoCaixa: (...args) => obterServicoPrincipal().resolverImpressoraDoCaixa(...args),
  salvarImpressoraDoCaixa: (...args) => obterServicoPrincipal().salvarImpressoraDoCaixa(...args)
};