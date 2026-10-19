'use strict';

const CSTAT_REJEICAO_CANCELAMENTO = new Set(['501', '573', '631']);

function extrairBloco(xml, nome) {
  const padrao = new RegExp(
    `<(?:(?:[\\w.-]+):)?${nome}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${nome}\\s*>`,
    'gi'
  );
  const matches = [...String(xml || '').matchAll(padrao)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

function extrairTag(xml, nome) {
  const bloco = extrairBloco(xml, nome);
  if (bloco == null) return null;
  return bloco.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function temAutorizacaoOriginal(xml, chaveAcesso) {
  const protocolo = extrairBloco(xml, 'protNFe');
  const infProt = protocolo && extrairBloco(protocolo, 'infProt');
  const cStat = infProt && extrairTag(infProt, 'cStat');
  const chaveAutorizada = infProt && extrairTag(infProt, 'chNFe');
  return (cStat === '100' || cStat === '150')
    && String(chaveAutorizada || '').replace(/\D/g, '') === chaveAcesso;
}

function obterCstatRejeicao(xml) {
  const eventos = [...String(xml || '').matchAll(
    /<(?:(?:[\w.-]+):)?retEvento\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?retEvento\s*>/gi
  )];
  if (!eventos.length) return null;
  const ultimoEvento = eventos[eventos.length - 1][1];
  const infEvento = extrairBloco(ultimoEvento, 'infEvento') || ultimoEvento;
  const cStat = infEvento && extrairTag(infEvento, 'cStat');
  return CSTAT_REJEICAO_CANCELAMENTO.has(cStat) ? cStat : null;
}

function restaurarStatusAutorizadoNfceRejeitada(database) {
  return new Promise((resolve, reject) => {
    database.all(
      `SELECT id, chave_acesso, xml_retorno
       FROM nfce_notas
       WHERE status = 'cancelamento_rejeitado'`,
      [],
      (selectError, rows) => {
        if (selectError) return reject(selectError);

        const elegiveis = (rows || []).filter((row) => {
          const chave = String(row.chave_acesso || '').replace(/\D/g, '');
          const xml = String(row.xml_retorno || '');
          return /^\d{44}$/.test(chave)
            && chave.slice(20, 22) === '65'
            && temAutorizacaoOriginal(xml, chave)
            && obterCstatRejeicao(xml);
        });

        let atualizados = 0;
        const atualizarProximo = (index) => {
          if (index >= elegiveis.length) return resolve(atualizados);
          const row = elegiveis[index];
          const statusNovo = obterCstatRejeicao(row.xml_retorno) === '573'
            ? 'cancelamento_desconhecido'
            : 'autorizada';
          database.run(
            `UPDATE nfce_notas
             SET status = ?,
                 updated_at = datetime('now', 'localtime')
             WHERE id = ? AND status = 'cancelamento_rejeitado'`,
            [statusNovo, row.id],
            function onUpdate(updateError) {
              if (updateError) return reject(updateError);
              atualizados += this.changes;
              atualizarProximo(index + 1);
            }
          );
        };

        atualizarProximo(0);
      }
    );
  });
}

module.exports = {
  restaurarStatusAutorizadoNfceRejeitada
};
