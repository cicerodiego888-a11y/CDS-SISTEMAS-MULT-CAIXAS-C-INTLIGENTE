/**
 * RC3.4.3 — Central Documental Inteligente (funções puras).
 * Sem consultas SEFAZ / sem alteração MIRX.
 *
 * @module motores/central-entradas/utils/centralDocumentalInteligente
 */

const MIRX_EVENTO_LABELS = Object.freeze({
  MIRX_SLEEP_START: { label: 'Documento entrou em SLEEP', icone: 'fa-moon', cor: '#64748b' },
  MIRX_WAKEUP: { label: 'Documento despertou', icone: 'fa-sun', cor: '#0d6efd' },
  MIRX_WAKEUP_EXECUTADO: { label: 'Recuperação iniciada', icone: 'fa-play', cor: '#0d6efd' },
  MIRX_CONSULTA_INICIO: { label: 'Recuperação iniciada', icone: 'fa-search', cor: '#f59e0b' },
  MIRX_CONSULTA_FIM: { label: 'Tentativa concluída', icone: 'fa-flag-checkered', cor: '#64748b' },
  MIRX_XML_RECUPERADO: { label: 'XML recuperado', icone: 'fa-file-code', cor: '#198754' },
  MIRX_REAGENDADO: { label: 'Recuperação agendada', icone: 'fa-hourglass-half', cor: '#fd7e14' },
  MIRX_AGENDAMENTO_ATUALIZADO: { label: 'Recuperação agendada', icone: 'fa-calendar-check', cor: '#0dcaf0' },
  MIRX_BLOQUEIO_656: { label: 'Gate / cooldown 656', icone: 'fa-shield-alt', cor: '#dc3545' },
  MIRX_ENFILEIRADO: { label: 'Recuperação agendada', icone: 'fa-list', cor: '#0dcaf0' },
  MIRX_SKIP_GATE: { label: 'Gate bloqueou consulta', icone: 'fa-ban', cor: '#dc3545' },
  MIRX_ERRO: { label: 'Erro temporário MIRX', icone: 'fa-exclamation-triangle', cor: '#dc3545' }
});

const STATUS_REAL = Object.freeze({
  RECEBIDA: 'Recebendo documento',
  SINCRONIZADA: 'Documento sincronizado',
  AGUARDANDO_XML_COMPLETO: 'Recuperação automática do XML agendada',
  EM_PROCESSAMENTO: 'Processando XML',
  AGUARDANDO_REVISAO: 'Aguardando revisão MIIP',
  REVISADA: 'Revisão MIIP concluída',
  PRONTA_PARA_COMPRA: 'Pronto para importar compra',
  EM_COMPRA: 'Importando compra',
  GRAVADA: 'Finalizado',
  DESCARTADA: 'Documento descartado',
  ERRO: 'Consulta temporariamente indisponível',
  DUPLICADA: 'Documento duplicado',
  XML_INDISPONIVEL: 'XML indisponível'
});

/**
 * @param {Object} doc
 * @param {Object} [wait]
 * @returns {string}
 */
function resolverStatusReal(doc, wait = {}) {
  const status = doc?.status || '';
  if (status === 'AGUARDANDO_XML_COMPLETO') {
    if (wait.estadoMirx === 'CONSULTANDO_XML') {
      return 'Recuperando XML automaticamente';
    }
    // RC3.4.5 — janela NT / agendado / SLEEP: nunca atribuir à “indisponibilidade SEFAZ”.
    if (
      wait.dormindo
      || wait.estadoMirx === 'SLEEP'
      || wait.estadoMirx === 'AGUARDANDO_JANELA_SEFAZ'
      || wait.estadoMirx === 'CONSULTA_PROGRAMADA'
      || wait.consultaBloqueada
      || wait.bloqueio656?.ativo
      || wait.proximaTentativa
      || wait.aguardandoXml
    ) {
      return 'Recuperação automática do XML agendada';
    }
    return 'Recuperação automática do XML agendada';
  }
  if (status === 'SINCRONIZADA' && doc?.tipoDocumento === 'RES_NFE') {
    return 'Aguardando manifestação';
  }
  if (status === 'EM_PROCESSAMENTO') {
    return 'Identificando produtos';
  }
  if (status === 'SINCRONIZADA' && ['PROC_NFE', 'NFE'].includes(doc?.tipoDocumento)) {
    return 'XML disponível — aguardando processamento';
  }
  return STATUS_REAL[status] || status || '—';
}

/**
 * Explicação amigável do status atual.
 * @param {Object} doc
 * @param {Object} [wait]
 * @param {Object} [opcoes]
 * @returns {string}
 */
function explicarStatus(doc, wait = {}, opcoes = {}) {
  const status = doc?.status || '';
  const proxima = wait.proximaTentativa || wait.bloqueio656?.bloqueadoAte || null;
  const proximaLabel = opcoes.proximaLabel
    || (proxima ? formatarDataHoraCompleta(proxima) : null);

  if (status === 'AGUARDANDO_XML_COMPLETO') {
    if (wait.estadoMirx === 'CONSULTANDO_XML') {
      return 'O MIRX está consultando a SEFAZ para recuperar o XML completo.';
    }
    if (wait.dormindo || wait.estadoMirx === 'SLEEP' || wait.bloqueio656?.ativo) {
      return proximaLabel
        ? `Recuperação automática do XML agendada. Próxima tentativa: ${proximaLabel} (intervalo SEFAZ / Gate 656).`
        : 'Recuperação automática do XML agendada. O MIRX tentará novamente no horário programado.';
    }
    return proximaLabel
      ? `Recuperação automática do XML agendada. Próxima tentativa: ${proximaLabel}.`
      : 'Recuperação automática do XML agendada. O MIRX acompanhará e recuperará sem intervenção.';
  }
  if (status === 'EM_PROCESSAMENTO') {
    return 'O XML está sendo lido: itens, valores e tributos estão sendo extraídos.';
  }
  if (status === 'AGUARDANDO_REVISAO') {
    return 'O MIIP identificou os produtos. Confirme ou cadastre os itens pendentes na Central de Revisão.';
  }
  if (status === 'EM_COMPRA') {
    return 'A compra está sendo importada. Estoque e financeiro serão atualizados na conclusão.';
  }
  if (status === 'GRAVADA') {
    return 'Documento finalizado. Compra gravada e estoque atualizado.';
  }
  if (status === 'SINCRONIZADA' && doc?.tipoDocumento === 'RES_NFE') {
    return 'Resumo da NF-e recebido. Aguardando manifestação e disponibilização do XML completo.';
  }
  return STATUS_REAL[status] || 'Acompanhe o andamento na linha do tempo do documento.';
}

function formatarDataHoraCurta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** RC3.4.5 — DD/MM/AAAA HH:MM */
function formatarDataHoraCompleta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Mapeia eventos operacionais → eventos MIRX amigáveis.
 * @param {Object[]} eventos
 * @returns {Object[]}
 */
function mapearEventosMirx(eventos = []) {
  return (eventos || [])
    .map((ev) => {
      const detalhe = typeof ev.detalhe === 'string'
        ? safeJson(ev.detalhe)
        : (ev.detalhe || {});
      const tipoMirx = detalhe.tipoMirx || detalhe.mirxTipo || null;
      if (!detalhe.mirx && !tipoMirx) return null;
      const meta = MIRX_EVENTO_LABELS[tipoMirx] || {
        label: tipoMirx || 'Evento MIRX',
        icone: 'fa-robot',
        cor: '#64748b'
      };
      return {
        id: ev.id,
        tipoMirx: tipoMirx || 'MIRX',
        label: meta.label,
        icone: meta.icone,
        cor: meta.cor,
        createdAt: ev.createdAt || ev.created_at,
        motivo: detalhe.motivo || ev.descricao || null,
        cStat: detalhe.cStat || null,
        proximaTentativa: detalhe.proximaTentativa || null,
        metodo: detalhe.metodo || null,
        tentativa: detalhe.tentativa != null ? detalhe.tentativa : null
      };
    })
    .filter(Boolean);
}

function safeJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return {};
  }
}

/**
 * Auditoria documental agregada (sem SEFAZ).
 * @param {Object} ctx
 * @returns {Object}
 */
function montarAuditoriaDocumental(ctx = {}) {
  const doc = ctx.doc || {};
  const wait = ctx.wait || {};
  const historico = Array.isArray(ctx.historico) ? ctx.historico : [];
  const eventosMirx = Array.isArray(ctx.eventosMirx) ? ctx.eventosMirx : [];

  const inicio = doc.createdAt || historico[0]?.createdAt || wait.iniciadoEm || null;
  const fim = ['GRAVADA', 'DESCARTADA', 'XML_INDISPONIVEL'].includes(doc.status)
    ? (doc.updatedAt || historico[historico.length - 1]?.createdAt)
    : null;
  const agora = ctx.agora || Date.now();
  const inicioMs = inicio ? new Date(inicio).getTime() : null;
  const fimMs = fim ? new Date(fim).getTime() : agora;
  const tempoTotalMs = inicioMs != null ? Math.max(0, fimMs - inicioMs) : null;

  const xmlOk = ['PROC_NFE', 'NFE'].includes(doc.tipoDocumento)
    && doc.status !== 'AGUARDANDO_XML_COMPLETO';
  const xmlEvento = eventosMirx.find((e) => e.tipoMirx === 'MIRX_XML_RECUPERADO');
  const tempoAteXmlMs = xmlOk && inicioMs && (xmlEvento?.createdAt || doc.updatedAt)
    ? Math.max(0, new Date(xmlEvento?.createdAt || doc.updatedAt).getTime() - inicioMs)
    : (wait.tempoAguardandoMs != null && xmlOk ? wait.tempoAguardandoMs : null);

  return {
    tempoTotalMs,
    tempoTotalLabel: formatarDuracao(tempoTotalMs),
    quantidadeTentativas: Number(wait.tentativas ?? 0),
    ultimoMetodo: wait.ultimoMetodo || wait.metodoProgramado || null,
    ultimoRetornoSefaz: wait.ultimoCStat
      ? `cStat ${wait.ultimoCStat}${wait.ultimoResultado ? ` — ${wait.ultimoResultado}` : ''}`
      : (wait.ultimoResultado || null),
    tempoAteXmlMs,
    tempoAteXmlLabel: formatarDuracao(tempoAteXmlMs),
    dormindo: Boolean(wait.dormindo),
    proximaTentativa: wait.proximaTentativa || null
  };
}

function formatarDuracao(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  const seg = Math.max(0, Math.floor(Number(ms) / 1000));
  if (seg < 60) return `${seg}s`;
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return `${h}h ${m}min`;
}

/**
 * Progresso percentual a partir de etapas.
 * @param {Object} modelo
 * @returns {{ percentual: number, blocos: number, preenchidos: number, label: string }}
 */
function calcularProgressoPercentual(modelo = {}) {
  const total = Number(modelo.total) || (modelo.etapas?.length || 1);
  const ok = Number(modelo.concluidas) || 0;
  const percentual = Math.round((ok / Math.max(total, 1)) * 100);
  return {
    percentual,
    blocos: 10,
    preenchidos: Math.round(percentual / 10),
    label: `${percentual}%`
  };
}

module.exports = {
  MIRX_EVENTO_LABELS,
  STATUS_REAL,
  resolverStatusReal,
  explicarStatus,
  mapearEventosMirx,
  montarAuditoriaDocumental,
  calcularProgressoPercentual,
  formatarDuracao,
  formatarDataHoraCurta,
  formatarDataHoraCompleta
};
