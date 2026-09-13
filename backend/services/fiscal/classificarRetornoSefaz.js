/**
 * Classificação única de retorno SEFAZ (cStat) para NF-e de devolução.
 * Não espalhar if (cStat === ...) nas rotas de emissão.
 */

'use strict';

const ACOES = Object.freeze({
  AUTORIZADA: 'AUTORIZADA',
  DENEGADA: 'DENEGADA',
  PROCESSANDO: 'PROCESSANDO',
  REENVIAVEL: 'REENVIAVEL',
  EXIGE_CORRECAO: 'EXIGE_CORRECAO',
  EXIGE_NOVA_IDENTIDADE: 'EXIGE_NOVA_IDENTIDADE',
  SINCRONIZAR_DOCUMENTO_EXISTENTE: 'SINCRONIZAR_DOCUMENTO_EXISTENTE',
  NAO_REENVIAVEL: 'NAO_REENVIAVEL'
});

const MAPA = Object.freeze({
  100: ACOES.AUTORIZADA,
  150: ACOES.AUTORIZADA,
  110: ACOES.DENEGADA,
  301: ACOES.DENEGADA,
  302: ACOES.DENEGADA,
  103: ACOES.PROCESSANDO,
  104: ACOES.PROCESSANDO,
  105: ACOES.PROCESSANDO,
  204: ACOES.SINCRONIZAR_DOCUMENTO_EXISTENTE,
  539: ACOES.EXIGE_NOVA_IDENTIDADE,
  275: ACOES.EXIGE_CORRECAO,
  590: ACOES.EXIGE_CORRECAO,
  591: ACOES.EXIGE_CORRECAO,
  863: ACOES.EXIGE_CORRECAO,
  108: ACOES.REENVIAVEL,
  109: ACOES.REENVIAVEL
});

function soDigitos(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function classificarRetornoSefaz(cStat, xMotivo) {
  const codigo = soDigitos(cStat);
  const acao = MAPA[codigo] || (codigo ? ACOES.NAO_REENVIAVEL : ACOES.NAO_REENVIAVEL);
  const reenvioPermitido = acao === ACOES.REENVIAVEL;
  let mensagemReenvio = null;
  if (acao === ACOES.EXIGE_CORRECAO) {
    mensagemReenvio =
      'Esta NF-e possui XML rejeitado por inconsistência fiscal.\n\n'
      + `cStat: ${codigo || '—'}\n\n`
      + 'O XML original não pode ser reutilizado.\n\n'
      + 'É necessário gerar uma nova emissão utilizando as regras fiscais atuais.';
  } else if (acao === ACOES.EXIGE_NOVA_IDENTIDADE) {
    mensagemReenvio =
      'Rejeição 539: duplicidade de NF-e com diferença na chave de acesso.\n\n'
      + 'Não retransmita este documento.\n\n'
      + 'Preserve o histórico e inicie uma NOVA emissão com nova identidade fiscal (novo número e novo cNF).';
  } else if (acao === ACOES.SINCRONIZAR_DOCUMENTO_EXISTENTE) {
    mensagemReenvio =
      'A SEFAZ já possui este documento (cStat 204). Não retransmita. Consulte a situação e sincronize o protocolo.';
  }
  return {
    cStat: codigo || null,
    xMotivo: xMotivo || null,
    acao,
    reenvioPermitido,
    mensagemReenvio
  };
}

function acaoDoCstat(cStat) {
  return classificarRetornoSefaz(cStat).acao;
}

module.exports = {
  ACOES,
  MAPA,
  classificarRetornoSefaz,
  acaoDoCstat
};
