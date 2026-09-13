'use strict';

const { cipAnalyze, matchIntent } = require('../core/cipHelper');

const PATTERNS = {
  nfe_rejeitadas: [/nf-?e rejeitad|rejeitad.*nf/i],
  nfce_pendentes: [/nfc-?e pendente|pendente.*nfc/i],
  notas_canceladas: [/nota.?cancelad|nf.*cancelad/i],
  problemas: [/problema.?fiscal|fiscal|sem ncm|pend[eê]ncia fiscal/i]
};

function createPlugin() {
  let ready = false;
  return {
    async load() { ready = true; return { ok: true }; },
    async unload() { ready = false; },
    async health() {
      return { ok: ready, motor: 'CIP', emiteDocumentos: false };
    },
    async ask({ mensagem } = {}, ctx = {}) {
      const intent = matchIntent(mensagem, PATTERNS);
      const full = await cipAnalyze(ctx.db, 'fiscal-copilot');
      const fiscal = full.sinais?.fiscal || {};
      const regras = full.regras || [];
      const problemas = [
        ...(fiscal.produtosSemNcm ? [{ tipo: 'cadastro', detalhe: `${fiscal.produtosSemNcm} produto(s) sem NCM` }] : []),
        ...regras.filter((r) => /fiscal|ncm|nfe|nfce/i.test(JSON.stringify(r))).slice(0, 10)
      ];

      if (intent === 'nfe_rejeitadas') {
        return {
          intent,
          resposta: 'NF-e rejeitadas: o Copiloto Fiscal não emite nem consulta SEFAZ diretamente. Use Central Fiscal/NF-e para o detalhe. CIP reporta problemas de cadastro fiscal abaixo.',
          fonte: 'CIP',
          dados: { problemas, produtosSemNcm: fiscal.produtosSemNcm || 0 },
          emite: false
        };
      }
      if (intent === 'nfce_pendentes') {
        return {
          intent,
          resposta: 'NFC-e pendentes: consulte o módulo Fiscal/PDV. Este plugin apenas diagnostica via CIP, sem emitir.',
          fonte: 'CIP',
          dados: { problemas },
          emite: false
        };
      }
      if (intent === 'notas_canceladas') {
        return {
          intent,
          resposta: 'Notas canceladas: histórico permanece no módulo Fiscal. Copiloto não cancela nem reemite.',
          fonte: 'CIP',
          dados: { problemas },
          emite: false
        };
      }
      if (intent === 'problemas') {
        return {
          intent,
          resposta: problemas.length
            ? `Problemas fiscais (CIP): ${problemas.map((p) => p.detalhe || p.tipo || JSON.stringify(p)).join('; ')}`
            : 'CIP não apontou problemas fiscais neste ciclo.',
          fonte: 'CIP',
          dados: { problemas, produtosSemNcm: fiscal.produtosSemNcm || 0 },
          emite: false
        };
      }
      return {
        intent: 'help',
        resposta: 'Copiloto Fiscal — "NF-e rejeitadas", "NFC-e pendentes", "Notas canceladas", "Problemas fiscais". Nunca emite documentos.',
        fonte: 'CIP',
        emite: false
      };
    }
  };
}

module.exports = createPlugin;
