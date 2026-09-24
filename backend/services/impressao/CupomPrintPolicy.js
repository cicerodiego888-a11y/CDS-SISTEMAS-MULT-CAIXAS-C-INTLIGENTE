/**
 * Política de impressão de cupom (camada posterior à venda/documento).
 * Não conhece Motor Fiscal, Motor Não Fiscal, pagamento ou estoque.
 */
'use strict';

const CHAVE = 'cupom_impressao_politica';
const MODOS = Object.freeze({
  PERGUNTAR: 'PERGUNTAR',
  AUTOMATICO: 'AUTOMATICO',
  NAO_IMPRIMIR: 'NAO_IMPRIMIR'
});
const DESTINOS = Object.freeze({
  CLIENTE: 'CLIENTE',
  ESTABELECIMENTO: 'ESTABELECIMENTO',
  COPIA: 'COPIA'
});
const MAX_VIAS = 4;
const TIPOS = Object.freeze({ FISCAL: 'FISCAL', NAO_FISCAL: 'NAO_FISCAL' });
const ESTADOS = Object.freeze({
  AGUARDANDO_DECISAO: 'AGUARDANDO_DECISAO',
  IMPRIMINDO: 'IMPRIMINDO',
  IMPRESSO: 'IMPRESSO',
  ERRO_IMPRESSAO: 'ERRO_IMPRESSAO',
  NAO_IMPRIMIR: 'NAO_IMPRIMIR'
});

const DESCRICAO = 'Política de impressão de cupons fiscal e não fiscal (perguntar/vias)';

function blocoPadrao() {
  return {
    modo: MODOS.PERGUNTAR,
    vias: 2,
    destinos: [DESTINOS.CLIENTE, DESTINOS.ESTABELECIMENTO]
  };
}

function padrao() {
  return {
    modo: MODOS.PERGUNTAR,
    max_vias: MAX_VIAS,
    fiscal: blocoPadrao(),
    nao_fiscal: blocoPadrao(),
    terminais: {},
    empresas: {}
  };
}

function normalizarModo(valor, fallback) {
  const v = String(valor || '').trim().toUpperCase();
  if (v === MODOS.PERGUNTAR || v === 'ASK' || v === 'PERGUNTAR_ANTES') return MODOS.PERGUNTAR;
  if (v === MODOS.AUTOMATICO || v === 'AUTO' || v === 'AUTOMATICO') return MODOS.AUTOMATICO;
  if (v === MODOS.NAO_IMPRIMIR || v === 'NUNCA' || v === 'NEVER' || v === 'OFF') return MODOS.NAO_IMPRIMIR;
  return fallback || MODOS.PERGUNTAR;
}

function normalizarDestino(valor, indice) {
  const v = String(valor || '').trim().toUpperCase();
  if (v === DESTINOS.CLIENTE || v === 'CONSUMIDOR') return DESTINOS.CLIENTE;
  if (v === DESTINOS.ESTABELECIMENTO || v === 'MERCANTIL' || v === 'LOJA' || v === 'EMPRESA') {
    return DESTINOS.ESTABELECIMENTO;
  }
  if (v === DESTINOS.COPIA || v === 'EXTRA' || v === 'ADICIONAL') return DESTINOS.COPIA;
  return indice === 0 ? DESTINOS.CLIENTE : (indice === 1 ? DESTINOS.ESTABELECIMENTO : DESTINOS.COPIA);
}

function normalizarVias(valor) {
  const n = parseInt(valor, 10);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(MAX_VIAS, n);
}

function completarDestinos(lista, vias) {
  const base = Array.isArray(lista) ? lista.map((item, i) => normalizarDestino(item, i)) : [];
  const destinos = [];
  for (let i = 0; i < vias; i += 1) {
    destinos.push(base[i] || (i === 0 ? DESTINOS.CLIENTE : (i === 1 ? DESTINOS.ESTABELECIMENTO : DESTINOS.COPIA)));
  }
  return destinos;
}

function normalizarBloco(bloco, fallbackModo) {
  const origem = bloco && typeof bloco === 'object' ? bloco : {};
  const vias = normalizarVias(origem.vias);
  return {
    modo: normalizarModo(origem.modo, fallbackModo),
    vias,
    destinos: completarDestinos(origem.destinos, vias)
  };
}

function parseJson(valor) {
  if (valor && typeof valor === 'object') return valor;
  if (typeof valor !== 'string' || !valor.trim()) return {};
  try {
    return JSON.parse(valor);
  } catch (_) {
    return {};
  }
}

function normalizar(entrada) {
  const raw = parseJson(entrada);
  const modoGeral = normalizarModo(raw.modo, MODOS.PERGUNTAR);
  const out = {
    modo: modoGeral,
    max_vias: MAX_VIAS,
    fiscal: normalizarBloco(raw.fiscal || raw.impressao_fiscal, modoGeral),
    nao_fiscal: normalizarBloco(raw.nao_fiscal || raw.impressao_nao_fiscal, modoGeral),
    terminais: raw.terminais && typeof raw.terminais === 'object' ? raw.terminais : {},
    empresas: raw.empresas && typeof raw.empresas === 'object' ? raw.empresas : {}
  };
  return out;
}

function rotuloVia(destino) {
  if (destino === DESTINOS.CLIENTE) return 'VIA DO CLIENTE';
  if (destino === DESTINOS.ESTABELECIMENTO) return 'VIA DO ESTABELECIMENTO';
  return 'VIA ADICIONAL';
}

function resolver(politica, tipo, contexto) {
  const cfg = normalizar(politica);
  const tipoNorm = String(tipo || '').toUpperCase() === TIPOS.FISCAL ? TIPOS.FISCAL : TIPOS.NAO_FISCAL;
  const bloco = tipoNorm === TIPOS.FISCAL ? { ...cfg.fiscal } : { ...cfg.nao_fiscal };
  const empresaId = contexto && contexto.empresa_id != null ? String(contexto.empresa_id) : '';
  const terminalId = contexto && contexto.terminal_id != null ? String(contexto.terminal_id) : '';
  const overlayEmpresa = empresaId && cfg.empresas && cfg.empresas[empresaId];
  const overlayTerminal = terminalId && cfg.terminais && cfg.terminais[terminalId];
  const mesclado = normalizarBloco({
    ...bloco,
    ...(overlayEmpresa && typeof overlayEmpresa === 'object' ? overlayEmpresa : {}),
    ...(overlayTerminal && typeof overlayTerminal === 'object' ? overlayTerminal : {})
  }, bloco.modo);
  return {
    tipo: tipoNorm,
    modo: mesclado.modo,
    vias: mesclado.vias,
    destinos: mesclado.destinos,
    rotulos: mesclado.destinos.map(rotuloVia),
    perguntar: mesclado.modo === MODOS.PERGUNTAR,
    imprimir: mesclado.modo !== MODOS.NAO_IMPRIMIR,
    automatico: mesclado.modo === MODOS.AUTOMATICO,
    max_vias: MAX_VIAS
  };
}

function ehChave(chave) {
  return String(chave || '') === CHAVE;
}

function montarResposta(politica) {
  const valor = normalizar(politica);
  return Object.freeze({
    chave: CHAVE,
    valor,
    json: JSON.stringify(valor)
  });
}

function ler(db, callback) {
  db.get(
    'SELECT valor FROM configuracoes WHERE chave = ?',
    [CHAVE],
    (err, row) => {
      if (err) return callback(err);
      const valor = normalizar(row && row.valor);
      callback(null, montarResposta(valor));
    }
  );
}

function salvar(db, entrada, callback) {
  const valor = normalizar(entrada);
  const json = JSON.stringify(valor);
  db.run(
    `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
     VALUES (?, ?, 'json', ?, datetime('now', 'localtime'))
     ON CONFLICT(chave) DO UPDATE SET
       valor = excluded.valor,
       tipo = excluded.tipo,
       descricao = excluded.descricao,
       updated_at = excluded.updated_at`,
    [CHAVE, json, DESCRICAO],
    function onSave(err) {
      if (err) return callback(err);
      callback(null, montarResposta(valor));
    }
  );
}

module.exports = {
  CHAVE,
  MODOS,
  DESTINOS,
  TIPOS,
  ESTADOS,
  MAX_VIAS,
  DESCRICAO,
  padrao,
  normalizar,
  resolver,
  rotuloVia,
  ehChave,
  montarResposta,
  ler,
  salvar
};
