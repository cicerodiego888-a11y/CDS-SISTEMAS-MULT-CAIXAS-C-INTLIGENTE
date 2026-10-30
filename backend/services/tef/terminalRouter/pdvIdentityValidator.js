'use strict';

/**
 * Validação da identidade do PDV usando a entidade já existente no CDS:
 * `terminais.id` (registrado pelo heartbeat PDV). Hostname/MAC NÃO são pdvId.
 */

const { ROUTE_CODES } = require('./contracts');

const MAC_RE = /^(?:[0-9A-Fa-f]{2}([-:]))(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}$/;
const MAC_COMPACT_RE = /^[0-9A-Fa-f]{12}$/;

function texto(valor) {
  if (valor == null) return '';
  return String(valor).trim();
}

/**
 * Detecta tentativas de usar hostname ou MAC no lugar de pdvId.
 */
function classificarIdentidadeInformada(bruto) {
  const raw = texto(bruto);
  if (!raw) {
    return { tipo: 'ausente', valor: null };
  }

  // Inteiro positivo puro → terminais.id (antes de heurística MAC compacta)
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0 && Number.isSafeInteger(id)) {
      return { tipo: 'pdv_id', valor: id };
    }
  }

  if (MAC_RE.test(raw)) {
    return { tipo: 'mac', valor: raw };
  }
  const hexOnly = raw.replace(/[^0-9A-Fa-f]/g, '');
  if (/[A-Fa-f]/.test(hexOnly) && MAC_COMPACT_RE.test(hexOnly)) {
    return { tipo: 'mac', valor: raw };
  }

  // Qualquer string com letras / pontos / hífens típicos de hostname
  if (/[A-Za-z]/.test(raw) || raw.includes('.') || raw.includes('\\') || raw.toLowerCase().startsWith('pdv-')) {
    return { tipo: 'hostname', valor: raw };
  }

  return { tipo: 'invalido', valor: raw };
}

function rejeitarHostnameOuMac(classificacao) {
  if (classificacao.tipo === 'hostname' || classificacao.tipo === 'mac') {
    return {
      ok: false,
      codigo: ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO,
      mensagem: 'Hostname/MAC não são identidade de PDV. Use terminais.id (pdvId) já registrado no CDS.',
      classificacao
    };
  }
  if (classificacao.tipo === 'invalido') {
    return {
      ok: false,
      codigo: ROUTE_CODES.PDV_IDENTIDADE_INVALIDA,
      mensagem: `pdvId inválido: "${classificacao.valor}"`,
      classificacao
    };
  }
  return { ok: true, classificacao };
}

/**
 * @param {object} db - database sqlite (callback API) ou objeto com get(sql, params) promisificado via injeção
 * @param {object} opcoes
 */
function criarPdvIdentityValidator(dependencias = {}) {
  const getDb = dependencias.getDb || (() => require('../../../database'));
  const getRow = dependencias.getRow || defaultGetRow;

  async function defaultGetRow(sql, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  /**
   * Valida pdvId contra `terminais` (+ caixa ativo).
   * empresaId/lojaId: contexto opcional vs códigos em tef_configuracao (quando presentes).
   */
  async function validarPdvId(pdvIdBruto, contexto = {}) {
    const classificacao = classificarIdentidadeInformada(pdvIdBruto);
    const bloqueioForma = rejeitarHostnameOuMac(classificacao);
    if (!bloqueioForma.ok) {
      return {
        ...bloqueioForma,
        pdv: null
      };
    }

    if (classificacao.tipo === 'ausente') {
      return {
        ok: true,
        ausente: true,
        codigo: null,
        mensagem: 'pdvId não informado — modo compatibilidade singleton',
        pdv: null
      };
    }

    const pdvId = classificacao.valor;
    let row;
    try {
      row = await getRow(
        `
          SELECT
            t.id AS terminal_id,
            t.nome AS terminal_nome,
            t.hostname,
            t.ativo AS terminal_ativo,
            t.caixa_id,
            c.nome AS caixa_nome,
            c.ativo AS caixa_ativo
          FROM terminais t
          LEFT JOIN caixas c ON c.id = t.caixa_id
          WHERE t.id = ?
        `,
        [pdvId]
      );
    } catch (error) {
      return {
        ok: false,
        codigo: ROUTE_CODES.ROUTER_ERRO_INTERNO,
        mensagem: `Falha ao consultar identidade PDV: ${error.message}`,
        pdv: null
      };
    }

    if (!row) {
      return {
        ok: false,
        codigo: ROUTE_CODES.PDV_INEXISTENTE,
        mensagem: `PDV inexistente (terminais.id=${pdvId})`,
        pdv: null
      };
    }

    const terminalAtivo = row.terminal_ativo == null || Number(row.terminal_ativo) === 1;
    if (!terminalAtivo) {
      return {
        ok: false,
        codigo: ROUTE_CODES.PDV_INATIVO,
        mensagem: `PDV inativo (terminais.id=${pdvId})`,
        pdv: {
          pdvId: String(row.terminal_id),
          terminalId: row.terminal_id,
          hostname: row.hostname,
          ativo: false,
          caixaId: row.caixa_id || null
        }
      };
    }

    if (row.caixa_id == null) {
      return {
        ok: false,
        codigo: ROUTE_CODES.PDV_SEM_VINCULO,
        mensagem: `PDV sem vínculo com caixa/estrutura operacional (terminais.id=${pdvId}). Hostname não substitui o vínculo.`,
        pdv: {
          pdvId: String(row.terminal_id),
          terminalId: row.terminal_id,
          hostname: row.hostname,
          ativo: true,
          caixaId: null
        }
      };
    }

    if (row.caixa_ativo != null && Number(row.caixa_ativo) !== 1) {
      return {
        ok: false,
        codigo: ROUTE_CODES.PDV_SEM_VINCULO,
        mensagem: `PDV vinculado a caixa inativo (caixa_id=${row.caixa_id})`,
        pdv: {
          pdvId: String(row.terminal_id),
          terminalId: row.terminal_id,
          hostname: row.hostname,
          ativo: true,
          caixaId: row.caixa_id,
          caixaAtivo: false
        }
      };
    }

    const empresaId = texto(contexto.empresaId);
    const lojaId = texto(contexto.lojaId);
    const config = contexto.configSingleton || null;

    if (empresaId && config && texto(config.empresa_codigo || config.empresaCodigo)) {
      const esperado = texto(config.empresa_codigo || config.empresaCodigo);
      if (esperado && esperado !== empresaId) {
        return {
          ok: false,
          codigo: ROUTE_CODES.EMPRESA_LOJA_INCOMPATIVEL,
          mensagem: `empresaId "${empresaId}" incompatível com configuração TEF da instalação ("${esperado}")`,
          pdv: null
        };
      }
    }

    if (lojaId && config && texto(config.loja_codigo || config.lojaCodigo)) {
      const esperado = texto(config.loja_codigo || config.lojaCodigo);
      if (esperado && esperado !== lojaId) {
        return {
          ok: false,
          codigo: ROUTE_CODES.EMPRESA_LOJA_INCOMPATIVEL,
          mensagem: `lojaId "${lojaId}" incompatível com configuração TEF da instalação ("${esperado}")`,
          pdv: null
        };
      }
    }

    return {
      ok: true,
      ausente: false,
      codigo: null,
      mensagem: 'PDV válido',
      pdv: {
        pdvId: String(row.terminal_id),
        terminalId: row.terminal_id,
        nome: row.terminal_nome || null,
        hostname: row.hostname || null,
        ativo: true,
        caixaId: row.caixa_id,
        caixaNome: row.caixa_nome || null,
        caixaAtivo: true,
        // hostname disponível só como metadado — nunca como identidade
        identidadeEhHostname: false
      }
    };
  }

  return {
    classificarIdentidadeInformada,
    rejeitarHostnameOuMac,
    validarPdvId
  };
}

module.exports = {
  criarPdvIdentityValidator,
  classificarIdentidadeInformada,
  rejeitarHostnameOuMac,
  MAC_RE
};
