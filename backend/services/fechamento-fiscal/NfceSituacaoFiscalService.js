'use strict';

const SITUACAO_NFCE = Object.freeze({
  SEM_DOCUMENTO: 'SEM_DOCUMENTO',
  AUTORIZADA: 'AUTORIZADA',
  REJEITADA: 'REJEITADA',
  CANCELADA: 'CANCELADA',
  PENDENTE: 'PENDENTE',
  ERRO: 'ERRO',
  DUPLICIDADE_PENDENTE: 'DUPLICIDADE_PENDENTE',
  DESCONHECIDA: 'DESCONHECIDA'
});

const CSTAT_AUTORIZACAO = new Set(['100', '150']);
const CSTAT_CANCELAMENTO = new Set(['135', '136', '155']);
const STATUS_PENDENTES = new Set([
  'pendente',
  'processando',
  'transmitindo',
  'enviada',
  'soap_enviado',
  'aguardando_retorno',
  'lote_processamento',
  'pendente_reenvio',
  'reenvio'
]);

function normalizarStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function extrairCStats(xml) {
  const out = [];
  const regex = /<cStat>([^<]+)<\/cStat>/gi;
  let match;
  while ((match = regex.exec(String(xml || ''))) !== null) {
    const valor = String(match[1] || '').trim();
    if (valor && !out.includes(valor)) out.push(valor);
  }
  return out;
}

function extrairProtocoloAutorizacao(xml) {
  const bloco = String(xml || '').match(/<protNFe[\s\S]*?<\/protNFe>/i)?.[0] || '';
  return String(bloco.match(/<nProt>([^<]+)<\/nProt>/i)?.[1] || '').trim();
}

function montarResultado(situacao, nota, extras = {}) {
  const status = normalizarStatus(nota?.status);
  const cstats = extrairCStats(nota?.xml_retorno);
  const decisaoPendente = [
    SITUACAO_NFCE.DUPLICIDADE_PENDENTE,
    SITUACAO_NFCE.PENDENTE,
    SITUACAO_NFCE.ERRO,
    SITUACAO_NFCE.DESCONHECIDA
  ].includes(situacao);
  return {
    situacao,
    venda_id: nota?.venda_id != null ? Number(nota.venda_id) : null,
    nfce_id: nota?.id != null ? Number(nota.id) : null,
    numero: nota?.numero ?? null,
    serie: nota?.serie ?? null,
    ambiente: nota?.ambiente ?? null,
    status_origem: status || null,
    cstats,
    protocolo: nota?.protocolo || extrairProtocoloAutorizacao(nota?.xml_retorno) || null,
    chave_acesso: nota?.chave_acesso || null,
    documentada: situacao === SITUACAO_NFCE.AUTORIZADA,
    bloqueia_fechamento: situacao === SITUACAO_NFCE.AUTORIZADA,
    exige_recuperacao: decisaoPendente,
    permite_decisao_automatica: !decisaoPendente,
    ...extras
  };
}

function classificarNotaNfce(nota) {
  if (!nota) {
    return montarResultado(SITUACAO_NFCE.SEM_DOCUMENTO, null, {
      motivo: 'Nenhum registro em nfce_notas para a venda.'
    });
  }

  const status = normalizarStatus(nota.status);
  const cstats = extrairCStats(nota.xml_retorno);
  const protocolo = nota.protocolo || extrairProtocoloAutorizacao(nota.xml_retorno);
  const recuperacao = nota.recuperacao_fiscal;

  if (recuperacao?.situacao_fiscal) {
    const situacao = String(recuperacao.situacao_fiscal).toUpperCase();
    if (Object.values(SITUACAO_NFCE).includes(situacao)) {
      return montarResultado(situacao, nota, {
        motivo: recuperacao.motivo || 'Situação determinada por consulta fiscal explícita.',
        origem_classificacao: 'RECUPERACAO_DUPLICIDADE',
        chave_acesso: recuperacao.chave_consultada || nota.chave_acesso || null,
        protocolo: recuperacao.protocolo || protocolo || null,
        cstats: recuperacao.cstats_consulta || (recuperacao.cstat_consulta
          ? [String(recuperacao.cstat_consulta)]
          : cstats),
        exige_recuperacao: [
          SITUACAO_NFCE.PENDENTE,
          SITUACAO_NFCE.ERRO,
          SITUACAO_NFCE.DESCONHECIDA,
          SITUACAO_NFCE.DUPLICIDADE_PENDENTE
        ].includes(situacao),
        permite_decisao_automatica: [
          SITUACAO_NFCE.AUTORIZADA,
          SITUACAO_NFCE.CANCELADA,
          SITUACAO_NFCE.REJEITADA,
          SITUACAO_NFCE.SEM_DOCUMENTO
        ].includes(situacao),
        recuperacao_fiscal: recuperacao
      });
    }
  }

  if (status === 'cancelada' || status === 'cancelado') {
    return montarResultado(SITUACAO_NFCE.CANCELADA, nota, {
      motivo: cstats.some((c) => CSTAT_CANCELAMENTO.has(c))
        ? 'Cancelamento confirmado pelo retorno fiscal.'
        : 'Motor Fiscal persistiu a NFC-e como cancelada.'
    });
  }

  const statusAutorizado = status === 'autorizada' || status === 'autorizado';
  const cstatAutorizado = cstats.some((c) => CSTAT_AUTORIZACAO.has(c));
  if (statusAutorizado && cstatAutorizado && Boolean(protocolo)) {
    return montarResultado(SITUACAO_NFCE.AUTORIZADA, nota, {
      motivo: 'Status compatível, cStat de autorização e protocolo presentes.'
    });
  }

  if (status === 'rejeitada_duplicidade' || cstats.includes('539')) {
    return montarResultado(SITUACAO_NFCE.DUPLICIDADE_PENDENTE, nota, {
      motivo: 'cStat 539 exige consulta/recuperação antes da decisão fiscal.'
    });
  }

  if (status === 'rejeitada' || status === 'denegada') {
    return montarResultado(SITUACAO_NFCE.REJEITADA, nota, {
      motivo: 'Retorno fiscal rejeitado/denegado; não há autorização efetiva.'
    });
  }

  if (STATUS_PENDENTES.has(status)) {
    return montarResultado(SITUACAO_NFCE.PENDENTE, nota, {
      motivo: 'Fluxo fiscal ainda sem resultado definitivo de autorização.'
    });
  }

  if (
    status.startsWith('erro')
    || status === 'configuracao_pendente'
    || status === 'equipamento_indisponivel'
    || status === 'timeout'
    || status === 'invalid_request'
  ) {
    return montarResultado(SITUACAO_NFCE.ERRO, nota, {
      motivo: 'Falha técnica/configuração sem evidência de autorização.'
    });
  }

  return montarResultado(SITUACAO_NFCE.DESCONHECIDA, nota, {
    motivo: statusAutorizado
      ? 'Status de autorização sem cStat e protocolo suficientes.'
      : 'Estado fiscal não reconhecido pelo contrato canônico.'
  });
}

function classificarSituacaoFiscalNfce(notas) {
  const lista = (Array.isArray(notas) ? notas : (notas ? [notas] : []))
    .filter(Boolean)
    .slice()
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

  if (!lista.length) return classificarNotaNfce(null);

  const classificadas = lista.map(classificarNotaNfce);
  const autorizada = classificadas.find((c) => c.situacao === SITUACAO_NFCE.AUTORIZADA);
  if (autorizada) return { ...autorizada, quantidade_registros: lista.length };

  const duplicidade = classificadas.find(
    (c) => c.situacao === SITUACAO_NFCE.DUPLICIDADE_PENDENTE
  );
  if (duplicidade) return { ...duplicidade, quantidade_registros: lista.length };

  return { ...classificadas[0], quantidade_registros: lista.length };
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function classificarSituacoesFiscaisPorVenda(db, vendaIds) {
  const ids = [...new Set((vendaIds || []).map(Number).filter((id) => id > 0))];
  const mapa = new Map();
  if (!ids.length) return mapa;

  const placeholders = ids.map(() => '?').join(',');
  let notas = [];
  try {
    notas = await all(
      db,
      `SELECT * FROM nfce_notas WHERE venda_id IN (${placeholders}) ORDER BY venda_id, id DESC`,
      ids
    );
  } catch (err) {
    if (!/no such table/i.test(String(err?.message || ''))) throw err;
  }

  const porVenda = new Map();
  for (const nota of notas) {
    const vendaId = Number(nota.venda_id);
    if (!porVenda.has(vendaId)) porVenda.set(vendaId, []);
    porVenda.get(vendaId).push(nota);
  }

  const recuperacoesPorNfce = new Map();
  const nfceIds = notas.map((n) => Number(n.id)).filter((id) => id > 0);
  if (nfceIds.length) {
    try {
      const placeholdersAuditoria = nfceIds.map(() => '?').join(',');
      const auditorias = await all(
        db,
        `SELECT id, referencia_id, detalhes, criado_em
         FROM auditoria
         WHERE modulo = 'fechamento_fiscal'
           AND acao = 'recuperar_duplicidade_nfce'
           AND referencia_tipo = 'nfce'
           AND referencia_id IN (${placeholdersAuditoria})
         ORDER BY id DESC`,
        nfceIds
      );
      for (const auditoria of auditorias) {
        const nfceId = Number(auditoria.referencia_id);
        if (recuperacoesPorNfce.has(nfceId)) continue;
        try {
          recuperacoesPorNfce.set(nfceId, {
            ...JSON.parse(auditoria.detalhes || '{}'),
            auditoria_id: Number(auditoria.id),
            consultado_em: auditoria.criado_em || null
          });
        } catch (_) {
          /* auditoria antiga ou inválida não altera a classificação fiscal */
        }
      }
    } catch (err) {
      if (!/no such table|no such column/i.test(String(err?.message || ''))) throw err;
    }
  }

  for (const nota of notas) {
    nota.recuperacao_fiscal = recuperacoesPorNfce.get(Number(nota.id)) || null;
  }

  for (const id of ids) {
    const classificacao = classificarSituacaoFiscalNfce(porVenda.get(id) || []);
    mapa.set(id, { ...classificacao, venda_id: id });
  }
  return mapa;
}

async function classificarSituacaoFiscalDaVenda(db, vendaId) {
  const mapa = await classificarSituacoesFiscaisPorVenda(db, [vendaId]);
  return mapa.get(Number(vendaId)) || classificarSituacaoFiscalNfce([]);
}

module.exports = {
  SITUACAO_NFCE,
  extrairCStats,
  extrairProtocoloAutorizacao,
  classificarNotaNfce,
  classificarSituacaoFiscalNfce,
  classificarSituacoesFiscaisPorVenda,
  classificarSituacaoFiscalDaVenda
};
