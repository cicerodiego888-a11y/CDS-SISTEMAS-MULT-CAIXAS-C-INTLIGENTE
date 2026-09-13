'use strict';

/**
 * Núcleo compartilhado dos Drivers Oficiais (RC4.0).
 * Vive em drivers/comum — NÃO altera BaseDriver / Registry / Framework.
 */

function agora() {
  return new Date().toISOString();
}

function montarCapacidades(perfil = {}) {
  const sync = perfil.sync || {};
  return {
    discovery: true,
    handshake: true,
    diagnostico: true,
    monitoramento: true,
    sincronizacao: true,
    configuracao: true,
    identificacao_firmware: true,
    numero_serie: true,
    modelo: true,
    versao: true,
    health_especifico: true,
    leitura_configuracao: true,
    escrita_configuracao: true,
    backup_configuracao: true,
    restaurar_configuracao: true,
    sync_produtos: sync.produtos !== false,
    sync_plu: sync.plu !== false,
    sync_departamentos: sync.departamentos !== false,
    sync_configuracoes: sync.configuracoes !== false,
    sync_promocoes: sync.promocoes !== false,
    sync_etiquetas: sync.etiquetas !== false,
    ...(perfil.capacidades_extra || {})
  };
}

function montarIdentidade(perfil, overrides = {}) {
  return {
    fabricante: perfil.fabricante,
    modelo: overrides.modelo || perfil.modelo,
    versao_driver: perfil.versao,
    firmware: overrides.firmware || perfil.firmware_padrao || (perfil.firmware_conhecido || [])[0] || null,
    firmware_conhecido: [...(perfil.firmware_conhecido || [])],
    numero_serie: overrides.numero_serie || null,
    protocolo: (perfil.protocolos || [])[0] || null,
    capacidades: montarCapacidades(perfil),
    ...overrides
  };
}

/**
 * Health Score específico do driver (0–100) + fatores.
 */
function calcularHealthDriver(perfil, metricas = {}) {
  const fatores = [];
  let score = 100;
  const catalogo = perfil.health?.fatores || [];

  const latencia = Number(metricas.latencia_ms);
  if (Number.isFinite(latencia)) {
    if (latencia > 2000) {
      score -= 25;
      fatores.push('latencia');
    } else if (latencia > 800) {
      score -= 12;
      fatores.push('latencia_moderada');
    }
  }

  if (metricas.erro_protocolo) {
    score -= 20;
    fatores.push('erro_protocolo');
  }
  if (Number(metricas.fila || 0) > 10) {
    score -= 10;
    fatores.push('fila');
  }
  if (metricas.timeout) {
    score -= 15;
    fatores.push('timeout');
  }
  if (metricas.firmware_incompativel) {
    score -= 30;
    fatores.push('firmware_incompativel');
  }
  if (metricas.desconectado) {
    score -= 40;
    fatores.push('desconectado');
  }

  for (const f of catalogo) {
    if (metricas[f.chave] && !fatores.includes(f.chave)) {
      score -= Number(f.penalidade || 5);
      fatores.push(f.chave);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let rotulo = 'Funcionando normalmente.';
  if (score <= 0) rotulo = 'Equipamento indisponível.';
  else if (score <= 40) rotulo = 'Falhas recorrentes.';
  else if (score <= 60) rotulo = 'Problemas de comunicação.';
  else if (score <= 80) rotulo = 'Oscilações.';

  return { score, rotulo, fatores, fabricante: perfil.fabricante };
}

function montarDiagnostico(perfil, contexto = {}) {
  const itens = (perfil.diagnosticos || []).map((d) => ({
    codigo: d.codigo,
    alerta: d.alerta || null,
    problema: d.problema || null,
    solucao: d.solucao || null,
    recomendacao: d.recomendacao || null,
    severidade: d.severidade || 'info',
    ativo: Boolean(contexto.ativos?.[d.codigo])
  }));

  const alertas = itens.filter((i) => i.alerta).map((i) => i.alerta);
  const problemas = itens.filter((i) => i.problema && i.ativo).map((i) => i.problema);
  const solucoes = itens.filter((i) => i.solucao && i.ativo).map((i) => i.solucao);
  const recomendacoes = itens.map((i) => i.recomendacao).filter(Boolean);

  return {
    sucesso: true,
    simulado: contexto.simulado !== false,
    comunicacao_real: contexto.comunicacao_real === true,
    alertas,
    problemas,
    solucoes,
    recomendacoes,
    itens,
    identidade: contexto.identidade || null,
    health: contexto.health || null,
    componentes: contexto.componentes || {},
    timestamp: agora()
  };
}

function schemaConfigPadrao(perfil) {
  return {
    campos: perfil.configSchema?.campos || [
      { chave: 'timeout_ms', tipo: 'number', padrao: 5000 },
      { chave: 'baud_rate', tipo: 'number', padrao: 9600 },
      { chave: 'porta_tcp', tipo: 'number', padrao: 9000 },
      { chave: 'departamento_padrao', tipo: 'number', padrao: 1 },
      { chave: 'unidade', tipo: 'string', padrao: 'kg' }
    ],
    versao_schema: perfil.configSchema?.versao || '1.0'
  };
}

function compararConfig(atual = {}, desejada = {}) {
  const diferencas = [];
  const chaves = new Set([...Object.keys(atual || {}), ...Object.keys(desejada || {})]);
  for (const chave of chaves) {
    const a = atual[chave];
    const b = desejada[chave];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diferencas.push({ chave, atual: a ?? null, desejada: b ?? null });
    }
  }
  return {
    iguais: diferencas.length === 0,
    diferencas,
    timestamp: agora()
  };
}

function mapearProdutoPlu(produto = {}, perfil = {}) {
  const codigo = produto.codigo ?? produto.plu ?? produto.id;
  return {
    plu: codigo != null ? String(codigo) : null,
    descricao: produto.descricao || produto.nome || '',
    preco: Number(produto.preco ?? produto.valor ?? 0),
    departamento: Number(produto.departamento ?? produto.departamento_id ?? 1),
    unidade: produto.unidade || 'kg',
    validade_dias: produto.validade_dias ?? null,
    fabricante: perfil.fabricante,
    protocolo: (perfil.protocolos || [])[0] || null
  };
}

module.exports = {
  agora,
  montarCapacidades,
  montarIdentidade,
  calcularHealthDriver,
  montarDiagnostico,
  schemaConfigPadrao,
  compararConfig,
  mapearProdutoPlu
};
