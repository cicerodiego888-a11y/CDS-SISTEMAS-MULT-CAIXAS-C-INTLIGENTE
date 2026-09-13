/**
 * MUC RC2 — Métricas e observabilidade
 * @module motores/muc/observabilidade/MucMetricas
 */
'use strict';

const _state = {
  total: 0,
  automaticas: 0,
  manuais: 0,
  aprendidas: 0,
  erros: 0,
  tempos: [],
  confiancas: [],
  porFornecedor: Object.create(null),
  porGtin: Object.create(null),
  porTipo: Object.create(null),
  porApresentacao: Object.create(null),
  topErros: Object.create(null)
};

function inc(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function registrarConversao(resultado, contexto = {}) {
  _state.total += 1;
  const origem = String(resultado?.origem || '').toUpperCase();
  if (origem === 'MANUAL' || origem === 'COMPRA') _state.manuais += 1;
  else if (origem === 'APRENDIZADO') _state.aprendidas += 1;
  else _state.automaticas += 1;

  if (resultado?.tempoProcessamentoMs != null) {
    _state.tempos.push(Number(resultado.tempoProcessamentoMs));
    if (_state.tempos.length > 1000) _state.tempos.shift();
  }
  if (resultado?.confianca != null) {
    _state.confiancas.push(Number(resultado.confianca));
    if (_state.confiancas.length > 1000) _state.confiancas.shift();
  }

  inc(_state.porFornecedor, contexto.fornecedorCnpj);
  inc(_state.porGtin, contexto.gtin);
  inc(_state.porTipo, resultado?.tipoConversao);
  inc(_state.porApresentacao, resultado?.unidadeCompra);
}

function registrarErro(erro, contexto = {}) {
  _state.erros += 1;
  const msg = String(erro?.message || erro || 'ERRO').slice(0, 120);
  inc(_state.topErros, msg);
}

function media(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function snapshot() {
  const tempos = [..._state.tempos];
  tempos.sort((a, b) => a - b);
  return Object.freeze({
    total: _state.total,
    automaticas: _state.automaticas,
    manuais: _state.manuais,
    aprendidas: _state.aprendidas,
    erros: _state.erros,
    tempoMedioMs: Math.round(media(tempos) * 100) / 100,
    tempoMinMs: tempos[0] ?? 0,
    tempoMaxMs: tempos[tempos.length - 1] ?? 0,
    confiancaMedia: Math.round(media(_state.confiancas) * 100) / 100,
    porFornecedor: { ..._state.porFornecedor },
    porGtin: { ..._state.porGtin },
    porTipo: { ..._state.porTipo },
    topApresentacoes: Object.entries(_state.porApresentacao)
      .sort((a, b) => b[1] - a[1]).slice(0, 10),
    topErros: Object.entries(_state.topErros)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
  });
}

function exportarJson() {
  return JSON.stringify(snapshot(), null, 2);
}

function exportarMarkdown() {
  const s = snapshot();
  return [
    '# MUC — Dashboard de Métricas',
    '',
    `| Métrica | Valor |`,
    `|---------|-------|`,
    `| Total conversões | ${s.total} |`,
    `| Automáticas | ${s.automaticas} |`,
    `| Manuais | ${s.manuais} |`,
    `| Aprendidas | ${s.aprendidas} |`,
    `| Erros | ${s.erros} |`,
    `| Tempo médio (ms) | ${s.tempoMedioMs} |`,
    `| Confiança média | ${s.confiancaMedia}% |`,
    '',
    '## Top apresentações',
    ...s.topApresentacoes.map(([k, v]) => `- ${k}: ${v}`)
  ].join('\n');
}

function reset() {
  Object.keys(_state).forEach((k) => {
    if (Array.isArray(_state[k])) _state[k].length = 0;
    else if (typeof _state[k] === 'object') {
      Object.keys(_state[k]).forEach((sub) => delete _state[k][sub]);
    } else _state[k] = 0;
  });
}

module.exports = {
  registrarConversao,
  registrarErro,
  snapshot,
  exportarJson,
  exportarMarkdown,
  reset
};
