/**
 * Utilitários da Central de Revisão MIIP (Sprint 6B).
 * Funções puras — testáveis sem DOM.
 *
 * @module motores/miip/utils/miipCentralRevisaoUtils
 */

const MOTOR_LABELS = Object.freeze({
  motor_gtin: 'Código de barras',
  motor_associacao_fornecedor: 'Histórico do fornecedor'
});

/**
 * @param {number} ms
 * @returns {string}
 */
function formatarTempoProcessamento(ms) {
  const totalSeg = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const horas = Math.floor(totalSeg / 3600);
  const minutos = Math.floor((totalSeg % 3600) / 60);
  const segundos = totalSeg % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(horas)}:${pad(minutos)}:${pad(segundos)}`;
}

/**
 * @param {Object} resumo
 * @param {number} [confirmadosManualmente]
 * @returns {number}
 */
function calcularPrecisaoImportacao(resumo = {}, confirmadosManualmente = 0) {
  const total = Number(resumo.totalItens ?? 0);
  if (total <= 0) return 0;

  const automaticos = Number(resumo.identificadosAutomaticamente ?? 0);
  const confirmados = Number(confirmadosManualmente ?? 0);
  return Math.round(((automaticos + confirmados) / total) * 100);
}

/**
 * @param {Object} resultado
 * @returns {boolean}
 */
function isPendencia(resultado) {
  return Boolean(resultado?.precisaConfirmacao || resultado?.precisaCadastro);
}

/**
 * @param {Object[]} resultados
 * @returns {Object[]}
 */
function extrairPendencias(resultados = []) {
  return resultados
    .map((resultado, posicao) => ({
      ...resultado,
      _posicaoOriginal: posicao
    }))
    .filter(isPendencia);
}

/**
 * Ordenação: maior certeza → menor certeza → sem candidato.
 *
 * @param {Object[]} pendencias
 * @returns {Object[]}
 */
function ordenarPendencias(pendencias = []) {
  return [...pendencias].sort((a, b) => {
    const semCandidatoA = Boolean(a.precisaCadastro && !a.produtoEncontrado);
    const semCandidatoB = Boolean(b.precisaCadastro && !b.produtoEncontrado);

    if (semCandidatoA && !semCandidatoB) return 1;
    if (!semCandidatoA && semCandidatoB) return -1;

    const scoreA = Number(a.score ?? 0);
    const scoreB = Number(b.score ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;

    return Number(a.indice ?? 0) - Number(b.indice ?? 0);
  });
}

/**
 * @param {Object} candidato
 * @param {string|null} motor
 * @returns {string[]}
 */
function extrairEvidencias(candidato, motor) {
  const evidencias = [];

  if (motor && MOTOR_LABELS[motor]) {
    evidencias.push(MOTOR_LABELS[motor]);
  }

  const lista = Array.isArray(candidato?.evidencias) ? candidato.evidencias : [];
  lista.forEach((ev) => {
    const texto = ev?.descricao || ev?.tipo || ev?.valor;
    if (texto && !evidencias.includes(texto)) {
      evidencias.push(String(texto));
    }
  });

  if (candidato?.produto?.marca && !evidencias.includes('Marca')) {
    evidencias.push('Marca');
  }

  return evidencias;
}

/**
 * @param {number} score
 * @returns {string}
 */
function scoreParaRotulo(score) {
  const valor = Number(score ?? 0);
  if (valor >= 95) return 'ALTA';
  if (valor >= 80) return 'MEDIA';
  if (valor > 0) return 'BAIXA';
  return 'NENHUMA';
}

/**
 * Monta sessão de revisão a partir da importação XML.
 *
 * @param {Object} dadosImportacao
 * @returns {Object}
 */
function montarSessaoRevisao(dadosImportacao = {}) {
  const miip = dadosImportacao.miip_importacao || {};
  const resultados = Array.isArray(miip.resultados) ? miip.resultados : [];
  const itens = Array.isArray(dadosImportacao.itens)
    ? dadosImportacao.itens.map((item) => ({ ...item }))
    : [];

  const pendencias = ordenarPendencias(extrairPendencias(resultados));

  return {
    operacaoId: miip.operacaoId || dadosImportacao.chave_acesso || null,
    resumo: {
      totalItens: Number(miip.resumo?.totalItens ?? itens.length),
      identificadosAutomaticamente: Number(miip.resumo?.identificadosAutomaticamente ?? 0),
      precisamConfirmacao: Number(miip.resumo?.precisamConfirmacao ?? 0),
      precisamCadastro: Number(miip.resumo?.precisamCadastro ?? 0),
      tempoProcessamento: Number(miip.resumo?.tempoProcessamento ?? 0)
    },
    fornecedor: dadosImportacao.fornecedor || '',
    fornecedorCnpj: dadosImportacao.fornecedor_cnpj || '',
    resultados,
    itens,
    pendencias,
    indiceAtual: 0,
    resolvidas: [],
    ignoradas: [],
    aprendizados: 0,
    confirmadosManualmente: 0
  };
}

/**
 * @param {Object} sessao
 * @returns {Object|null}
 */
function obterPendenciaAtual(sessao) {
  if (!sessao || !Array.isArray(sessao.pendencias) || sessao.pendencias.length === 0) {
    return null;
  }
  return sessao.pendencias[sessao.indiceAtual] ?? null;
}

/**
 * @param {Object} sessao
 * @returns {boolean}
 */
function todasPendenciasResolvidas(sessao) {
  if (!sessao) return true;
  const total = sessao.pendencias?.length ?? 0;
  const resolvidas = (sessao.resolvidas?.length ?? 0) + (sessao.ignoradas?.length ?? 0);
  return total === 0 || resolvidas >= total;
}

/**
 * @param {Object} sessao
 * @param {Object} pendencia
 * @param {'confirmado'|'ignorado'|'cadastro'} status
 * @param {Object} [opcoes]
 * @returns {Object}
 */
function registrarResolucaoPendencia(sessao, pendencia, status, opcoes = {}) {
  const copia = {
    ...sessao,
    resolvidas: [...(sessao.resolvidas || [])],
    ignoradas: [...(sessao.ignoradas || [])],
    itens: [...(sessao.itens || [])]
  };

  const indiceItem = Number(pendencia?.indice ?? -1);
  if (indiceItem >= 0 && copia.itens[indiceItem]) {
    const item = { ...copia.itens[indiceItem] };

    if (status === 'confirmado' && opcoes.produtoId) {
      item.produto_id = Number(opcoes.produtoId);
      item.miip_revisao_status = 'confirmado';
      if (opcoes.produtoNome) item.produto_nome_associado = opcoes.produtoNome;
    } else if (status === 'ignorado') {
      item.miip_revisao_status = 'ignorado';
    } else if (status === 'cadastro') {
      item.miip_revisao_status = 'cadastro_pendente';
    }

    copia.itens[indiceItem] = item;
  }

  if (status === 'ignorado') {
    copia.ignoradas.push(pendencia.indice);
  } else {
    copia.resolvidas.push(pendencia.indice);
    if (status === 'confirmado' && opcoes.aprendeu) {
      copia.aprendizados += 1;
      copia.confirmadosManualmente += 1;
    }
  }

  if (copia.indiceAtual < (copia.pendencias?.length ?? 0) - 1) {
    copia.indiceAtual += 1;
  }

  return copia;
}

/**
 * @param {Object} sessao
 * @returns {Object}
 */
function montarEstatisticasFinais(sessao) {
  const resumo = sessao?.resumo || {};
  const precisao = calcularPrecisaoImportacao(resumo, sessao?.confirmadosManualmente ?? 0);

  return {
    totalItens: resumo.totalItens ?? 0,
    identificadosAutomaticamente: resumo.identificadosAutomaticamente ?? 0,
    aprendeu: sessao?.aprendizados ?? 0,
    precisao,
    tempoProcessamento: resumo.tempoProcessamento ?? 0,
    tempoFormatado: formatarTempoProcessamento(resumo.tempoProcessamento ?? 0)
  };
}

/**
 * @param {Object} sessao
 * @param {number} [direcao]
 * @returns {Object}
 */
function proximaPendenciaNaoResolvida(sessao, direcao = 1) {
  const pendencias = sessao?.pendencias || [];
  const total = pendencias.length;
  if (total === 0) return sessao;

  let idx = Number(sessao.indiceAtual ?? 0);

  for (let passo = 0; passo < total; passo += 1) {
    idx = (idx + direcao + total) % total;
    const pendencia = pendencias[idx];
    const indice = pendencia?.indice;
    const resolvida = (sessao.resolvidas || []).includes(indice);
    const ignorada = (sessao.ignoradas || []).includes(indice);

    if (!resolvida && !ignorada) {
      return { ...sessao, indiceAtual: idx };
    }
  }

  return { ...sessao, indiceAtual: idx };
}

/**
 * @param {Object} sessao
 * @returns {number}
 */
function contarPendenciasAbertas(sessao) {
  const pendencias = sessao?.pendencias || [];
  return pendencias.filter((p) => {
    const indice = p.indice;
    return !(sessao.resolvidas || []).includes(indice)
      && !(sessao.ignoradas || []).includes(indice);
  }).length;
}

/**
 * RC7.5 — Validação do botão Confirmar Produto (sem navegação).
 * @param {Object} pendencia
 * @returns {{ ok: boolean, mensagem?: string, produtoId?: number }}
 */
function validarConfirmacaoProduto(pendencia) {
  const produtoId = pendencia?.produtoEncontrado?.id
    ?? pendencia?.produtoId
    ?? null;
  if (!produtoId) {
    return { ok: false, mensagem: 'Selecione um produto para continuar.' };
  }
  return { ok: true, produtoId: Number(produtoId) };
}

/**
 * Resultado de conclusão da revisão MIIP.
 * A navegação indica ao caller (Central) que deve chamar finalizar-entrada → Compras.
 * MIIP em si não grava compra nem navega.
 *
 * @param {Object} sessao
 * @param {Object} [meta]
 * @returns {Object}
 */
function montarResultadoConclusaoRevisao(sessao, meta = {}) {
  return {
    itens: sessao?.itens || [],
    estatisticas: montarEstatisticasFinais(sessao),
    navegacao: {
      abrirCompra: true,
      abrirPedido: false,
      permanecerNaCentral: false,
      proximaAcao: 'ABRIR_COMPRA',
      motivo: meta.motivoEncerramento || 'manual'
    }
  };
}

module.exports = {
  MOTOR_LABELS,
  formatarTempoProcessamento,
  calcularPrecisaoImportacao,
  isPendencia,
  extrairPendencias,
  ordenarPendencias,
  extrairEvidencias,
  scoreParaRotulo,
  montarSessaoRevisao,
  obterPendenciaAtual,
  todasPendenciasResolvidas,
  registrarResolucaoPendencia,
  montarEstatisticasFinais,
  proximaPendenciaNaoResolvida,
  contarPendenciasAbertas,
  validarConfirmacaoProduto,
  montarResultadoConclusaoRevisao
};
