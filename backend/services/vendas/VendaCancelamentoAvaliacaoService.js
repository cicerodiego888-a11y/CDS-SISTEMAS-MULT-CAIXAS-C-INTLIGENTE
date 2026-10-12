'use strict';

/**
 * Avaliação (somente leitura) do cancelamento de uma venda com NFC-e.
 * Separa as duas ações:
 *  - cancelar NFC-e: evento 110111 na SEFAZ, só para documento autorizado, com chave,
 *    protocolo e dentro do prazo;
 *  - cancelar venda: operação comercial (estoque/financeiro), sem evento fiscal quando
 *    não há NFC-e autorizada.
 * Situação fiscal não confirmada (duplicidade, timeout, desconhecida) bloqueia ambas.
 */

const db = require('../../database');
const {
  SITUACAO_NFCE,
  classificarSituacaoFiscalDaVenda
} = require('../fechamento-fiscal/NfceSituacaoFiscalService');
const { extrairChaveEProtocoloAutorizados } = require('../fiscal/utils');
const { calcularPrazoCancelamentoNfce } = require('../fiscal/fiscalDateTime');

const STATUS_NUNCA_TRANSMITIDA = new Set(['configuracao_pendente', 'erro_validacao']);
const STATUS_AUTORIZADA_LOCAL = new Set(['autorizada', 'cancelamento_rejeitado']);

function dbGet(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function retornoProtocolo(xml) {
  const infProt = (String(xml || '').match(/<infProt[\s\S]*?<\/infProt>/i) || [])[0] || '';
  return {
    cstat: (infProt.match(/<cStat>\s*(\d+)\s*<\/cStat>/i) || [])[1] || null,
    xmotivo: (infProt.match(/<xMotivo>\s*([^<]+?)\s*<\/xMotivo>/i) || [])[1] || null
  };
}

function descreverNota(nota) {
  if (!nota) return null;
  const auth = extrairChaveEProtocoloAutorizados(nota.xml_retorno) || {};
  const ret = retornoProtocolo(nota.xml_retorno);
  return {
    id: Number(nota.id),
    numero: nota.numero != null ? Number(nota.numero) : null,
    serie: nota.serie != null ? Number(nota.serie) : null,
    ambiente: nota.ambiente != null ? Number(nota.ambiente) : null,
    status: nota.status || null,
    chave_acesso: auth.chaveAcesso || nota.chave_acesso || null,
    protocolo: auth.protocolo || nota.protocolo || null,
    cstat: ret.cstat,
    xmotivo: ret.xmotivo
  };
}

function rotuloNota(n) {
  return n && n.numero != null ? `NFC-e nº ${n.numero} série ${n.serie}` : 'NFC-e';
}

function bloquear(base, codigo, mensagem, extra = {}) {
  return {
    ...base,
    ...extra,
    cancelar_nfce: false,
    cancelar_venda_permitido: false,
    bloqueio: { codigo, mensagem },
    mensagem
  };
}

async function avaliarCancelamentoVenda(vendaId, deps = {}) {
  const database = deps.db || db;
  const agora = deps.agora || new Date();
  const id = Number(vendaId);

  const venda = id > 0 ? await dbGet(database, 'SELECT * FROM vendas WHERE id = ?', [id]) : null;
  if (!venda) {
    const err = new Error('Venda não encontrada.');
    err.statusCode = 404;
    throw err;
  }

  const situacao = await classificarSituacaoFiscalDaVenda(database, id);
  const notaRow = situacao.nfce_id
    ? await dbGet(database, 'SELECT * FROM nfce_notas WHERE id = ?', [situacao.nfce_id])
    : null;
  const nfce = descreverNota(notaRow);

  const base = {
    venda_id: id,
    venda_codigo: venda.codigo || null,
    venda_cancelada: Number(venda.cancelada || 0) === 1,
    situacao_fiscal: situacao.situacao,
    nfce
  };

  if (base.venda_cancelada) {
    return bloquear(base, 'VENDA_JA_CANCELADA', `A venda #${id} já está cancelada.`);
  }

  const st = String((nfce && nfce.status) || '').toLowerCase();
  if (situacao.situacao === SITUACAO_NFCE.AUTORIZADA || STATUS_AUTORIZADA_LOCAL.has(st)) {
    if (!STATUS_AUTORIZADA_LOCAL.has(st)) {
      return bloquear(
        base,
        'AUTORIZACAO_SEM_REGISTRO_LOCAL',
        `${rotuloNota(nfce)} consta como autorizada pela consulta à SEFAZ, mas a autorização não está registrada nesta nota. Trate o documento pelo Fechamento Fiscal antes de cancelar a venda.`
      );
    }
    const chave = String((nfce && nfce.chave_acesso) || '').replace(/\D/g, '');
    if (chave.length !== 44 || !nfce.protocolo) {
      return bloquear(
        base,
        'NFCE_SEM_CHAVE_OU_PROTOCOLO',
        `${rotuloNota(nfce)} está autorizada, mas não possui ${chave.length !== 44 ? 'chave de acesso válida' : 'protocolo de autorização'} registrado. O cancelamento fiscal não pode ser transmitido.`
      );
    }
    const prazo = calcularPrazoCancelamentoNfce(notaRow, agora);
    if (!prazo.ok) {
      return bloquear(base, prazo.codigo, `${rotuloNota(nfce)}: ${prazo.mensagem}`, { prazo });
    }
    if (!prazo.dentro_prazo) {
      return bloquear(
        base,
        'CANCELAMENTO_FORA_DO_PRAZO',
        `${rotuloNota(nfce)} foi autorizada há ${Math.floor(prazo.minutos_decorridos)} min; o prazo de cancelamento é de ${prazo.prazo_minutos} min. O evento de cancelamento não será enviado.`,
        { prazo }
      );
    }
    return {
      ...base,
      prazo,
      cancelar_nfce: true,
      cancelar_venda_permitido: true,
      exige_justificativa: true,
      bloqueio: null,
      mensagem: `${rotuloNota(nfce)} autorizada: será enviado o evento de cancelamento à SEFAZ e, se homologado, a venda será cancelada.`
    };
  }

  if (situacao.situacao === SITUACAO_NFCE.CANCELADA) {
    return {
      ...base,
      cancelar_nfce: false,
      cancelar_venda_permitido: true,
      bloqueio: null,
      mensagem: `${rotuloNota(nfce)} já está cancelada na SEFAZ; nenhum novo evento será enviado. Somente a venda será cancelada.`
    };
  }

  if (situacao.situacao === SITUACAO_NFCE.REJEITADA) {
    const motivo = nfce && nfce.cstat ? ` (cStat ${nfce.cstat}: ${nfce.xmotivo || 'sem motivo'})` : '';
    return {
      ...base,
      cancelar_nfce: false,
      cancelar_venda_permitido: true,
      bloqueio: null,
      mensagem: `${rotuloNota(nfce)} foi rejeitada${motivo} e não tem valor fiscal; nenhum evento será enviado à SEFAZ. Somente a venda será cancelada e o histórico fiscal será preservado.`
    };
  }

  if (situacao.situacao === SITUACAO_NFCE.SEM_DOCUMENTO) {
    return {
      ...base,
      cancelar_nfce: false,
      cancelar_venda_permitido: true,
      bloqueio: null,
      mensagem: 'Venda sem NFC-e: somente a venda será cancelada.'
    };
  }

  if (situacao.situacao === SITUACAO_NFCE.ERRO && STATUS_NUNCA_TRANSMITIDA.has(st)) {
    return {
      ...base,
      cancelar_nfce: false,
      cancelar_venda_permitido: true,
      bloqueio: null,
      mensagem: `${rotuloNota(nfce)} não chegou a ser transmitida (${st}); somente a venda será cancelada.`
    };
  }

  return bloquear(
    base,
    'SITUACAO_FISCAL_NAO_CONFIRMADA',
    `A situação de ${rotuloNota(nfce)} na SEFAZ ainda não foi confirmada (${situacao.situacao}${st ? `, status ${st}` : ''}). Ela pode estar autorizada; consulte a situação (Fechamento Fiscal → Recuperar duplicidades, ou nova tentativa de emissão) antes de cancelar.`
  );
}

module.exports = {
  avaliarCancelamentoVenda
};
