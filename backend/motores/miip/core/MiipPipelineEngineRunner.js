/**
 * MiipPipelineEngineRunner — Executa engines via MotorRegistry no Pipeline.
 *
 * Sprint RC1 + RC9.3: Canonical → Attribute → Synonym → GTIN → Fornecedor → MUBC → Similarity
 *
 * @module motores/miip/core/MiipPipelineEngineRunner
 */

const MotorRegistry = require('./MotorRegistry');
const MiipEvidence = require('./MiipEvidence');
const ProductCompatibilityGuard = require('../utils/ProductCompatibilityGuard');

const ENGINES_IDENTIFICACAO = Object.freeze([
  'motor_gtin',
  'motor_associacao_fornecedor',
  'motor_mubc'
]);

const CODIGO_CANONICAL = 'motor_canonical';
const CODIGO_ATTRIBUTE = 'motor_attribute_extractor';
const CODIGO_SYNONYMS = 'motor_synonyms';
const CODIGO_SIMILARITY = 'motor_similarity';
const CODIGO_MUBC = 'motor_mubc';
const CODIGO_COMPAT = ProductCompatibilityGuard.MOTOR_CODIGO;

/**
 * @param {import('./MotorRegistry')} [motorRegistry]
 * @returns {Function}
 */
function criarResolverEngines(motorRegistry = MotorRegistry) {
  return (_config, _context) => motorRegistry.listarAtivos().map((motor) => ({
    codigo: motor.codigo,
    prioridade: Number(motor.prioridade ?? 0),
    instancia: motor.instancia
  }));
}

/**
 * @private
 * @param {Object} candidatos
 * @returns {Object|null}
 */
function obterMelhorCandidato(candidatos) {
  if (!Array.isArray(candidatos) || candidatos.length === 0) return null;
  return candidatos.reduce((melhor, atual) => {
    const scoreMelhor = Number(melhor?.scoreTotal ?? melhor?.scorePonderado ?? 0);
    const scoreAtual = Number(atual?.scoreTotal ?? atual?.scorePonderado ?? 0);
    return scoreAtual > scoreMelhor ? atual : melhor;
  }, candidatos[0]);
}

/**
 * @private
 */
function veioDoMubc(candidato) {
  const motores = candidato?.motoresQueVotaram || [];
  return motores.includes(CODIGO_MUBC);
}

/**
 * @private
 * @param {Object} instancias
 * @param {string} nome
 * @param {import('./MiipContext')|Object} contexto
 * @returns {Promise<Object|null>}
 */
async function construirSemanticDeNome(instancias, nome, contexto) {
  if (!nome) return null;

  const canonical = instancias[CODIGO_CANONICAL];
  const attribute = instancias[CODIGO_ATTRIBUTE];
  const synonyms = instancias[CODIGO_SYNONYMS];

  if (!canonical || !attribute) return null;

  await canonical.identificar({ produtoNome: nome }, contexto);
  const canonicalProduct = canonical.obterUltimoCanonical?.() ?? null;
  if (!canonicalProduct) return null;

  await attribute.identificar(canonicalProduct, contexto);
  let semantic = attribute.obterUltimoSemantic?.() ?? null;

  if (semantic && synonyms) {
    await synonyms.identificar(semantic, contexto);
    semantic = synonyms.obterUltimoSemantic?.() ?? semantic;
  }

  return semantic;
}

/**
 * Remove candidatos MUBC comercialmente incompatíveis ANTES da similaridade.
 * Identidade forte (GTIN/Associação) não passa por este filtro (não veioDoMubc).
 *
 * @private
 */
async function filtrarCandidatosPorCompatibilidade(instancias, candidatos, meta, context, item) {
  const encontrados = candidatos.length;
  const bloqueados = [];
  const restantes = [];

  for (const cand of candidatos) {
    if (!veioDoMubc(cand)) {
      restantes.push(cand);
      continue;
    }

    const nomeCandidato = cand?.produto?.nome
      ?? cand?.produtoNome
      ?? cand?.nome
      ?? cand?.snapshot?.nome
      ?? '';
    const semanticCandidato = await construirSemanticDeNome(instancias, nomeCandidato, context);

    const motivosMatch = cand?.atributosExtraidos?.matchMotivos
      || cand?.atributosExtraidos?.motivosRelevancia
      || [];

    const guard = ProductCompatibilityGuard.avaliar({
      itemXml: item || {},
      produtoCds: {
        ...(cand.produto || {}),
        nome: nomeCandidato,
        ncm: cand?.snapshot?.ncm ?? cand?.produto?.ncm ?? cand?.ncm,
        snapshot: cand.snapshot || null,
        atributosExtraidos: cand.atributosExtraidos || null
      },
      semanticXml: meta.semanticProduct,
      semanticCds: semanticCandidato,
      motivosMatch
    });

    if (guard.bloqueado || guard.compativel === false) {
      bloqueados.push({
        produtoId: cand.produtoId ?? cand.produto?.id ?? null,
        nome: nomeCandidato,
        motivos: guard.motivos || [],
        divergencias: guard.divergencias || [],
        nivel: guard.nivel
      });
      continue;
    }

    restantes.push(cand);
  }

  candidatos.length = 0;
  candidatos.push(...restantes);

  meta.compatibilityDiagnostico = {
    quantidadeCandidatosEncontrados: encontrados,
    quantidadeCandidatosCompativeis: restantes.length,
    quantidadeCandidatosBloqueados: bloqueados.length,
    candidatosBloqueados: bloqueados.slice(0, 20),
    motor: CODIGO_COMPAT
  };

  if (meta.mubcDiagnostico && typeof meta.mubcDiagnostico === 'object') {
    meta.mubcDiagnostico.compatibility = meta.compatibilityDiagnostico;
  }
}

/**
 * Pontua candidatos MUBC via Motor Similarity (comparação + score).
 * Compatibilidade é filtrada antes — incompatível nunca recebe score.
 * Não altera candidatos de GTIN/Associação (score de identidade preservado).
 *
 * @private
 */
async function pontuarCandidatosComSimilarity(instancia, instancias, candidatos, meta, context, item) {
  // Compatibilidade SEMPRE antes da similaridade — mesmo sem semanticProduct
  // (o Guard pode usar nome/NCM; incompatível não pode ser pontuado).
  if (candidatos.length > 0) {
    await filtrarCandidatosPorCompatibilidade(instancias, candidatos, meta, context, item);
  }

  if (!candidatos.length) {
    meta.similarityResult = null;
    return;
  }

  if (!meta.semanticProduct || typeof instancia.comparar !== 'function') {
    return;
  }

  let melhorSim = null;
  const alvo = candidatos.filter(veioDoMubc);
  const lista = alvo.length > 0 ? alvo : [obterMelhorCandidato(candidatos)].filter(Boolean);

  for (const cand of lista) {
    const nomeCandidato = cand?.produto?.nome
      ?? cand?.produtoNome
      ?? cand?.nome
      ?? cand?.snapshot?.nome
      ?? '';
    const semanticCandidato = await construirSemanticDeNome(instancias, nomeCandidato, context);
    if (!semanticCandidato) continue;

    const sim = instancia.comparar(meta.semanticProduct, semanticCandidato);
    const scoreSim = Number(sim?.score ?? 0);

    if (veioDoMubc(cand) && scoreSim > 0) {
      const relevancia = Number(cand.scoreTotal ?? 0);
      // Similarity pontua; relevância MUBC serve de piso suave (máx 94)
      // Somente após CompatibilityGuard (candidato já filtrado)
      cand.scoreTotal = Math.min(94, Math.max(relevancia, Math.round(scoreSim)));
      cand.evidencias = [
        ...(cand.evidencias || []),
        MiipEvidence.agora({
          motor: CODIGO_SIMILARITY,
          tipo: 'similarity',
          descricao: 'Similaridade semântica',
          peso: scoreSim,
          valor: scoreSim,
          score: scoreSim
        })
      ];
      if (!cand.motoresQueVotaram.includes(CODIGO_SIMILARITY)) {
        cand.motoresQueVotaram.push(CODIGO_SIMILARITY);
      }
    }

    if (!melhorSim || scoreSim > Number(melhorSim.score ?? 0)) {
      melhorSim = sim;
    }
  }

  if (melhorSim) {
    meta.similarityResult = melhorSim;
  } else {
    const melhor = obterMelhorCandidato(candidatos);
    if (melhor && meta.semanticProduct) {
      const nomeCandidato = melhor?.produto?.nome ?? melhor?.snapshot?.nome ?? '';
      const semanticCandidato = await construirSemanticDeNome(instancias, nomeCandidato, context);
      if (semanticCandidato) {
        meta.similarityResult = instancia.comparar(meta.semanticProduct, semanticCandidato);
      }
    }
  }
}

/**
 * Executa engines registrados na ordem oficial do pipeline.
 *
 * @param {import('./MotorRegistry')} [motorRegistry]
 * @returns {Function}
 */
function criarEngineExecutor(motorRegistry = MotorRegistry) {
  return async (engines, item, context) => {
    const candidatos = [];
    const produtosPorMotor = [];
    const instancias = {};
    const meta = {
      canonicalProduct: null,
      semanticProduct: null,
      similarityResult: null,
      mubcDiagnostico: null,
      compatibilityDiagnostico: null,
      tempoPorEngine: {}
    };

    for (const engine of engines) {
      const codigo = engine.codigo;
      const instancia = engine.instancia;
      if (!instancia || typeof instancia.identificar !== 'function') continue;

      instancias[codigo] = instancia;
      const inicio = Date.now();

      try {
        if (codigo === CODIGO_CANONICAL) {
          await instancia.identificar(item, context);
          meta.canonicalProduct = instancia.obterUltimoCanonical?.() ?? null;
        } else if (codigo === CODIGO_ATTRIBUTE) {
          const entrada = meta.canonicalProduct ?? item;
          await instancia.identificar(entrada, context);
          meta.semanticProduct = instancia.obterUltimoSemantic?.() ?? null;
        } else if (codigo === CODIGO_SYNONYMS) {
          const entrada = meta.semanticProduct ?? item;
          await instancia.identificar(entrada, context);
          meta.semanticProduct = instancia.obterUltimoSemantic?.() ?? meta.semanticProduct;
        } else if (codigo === CODIGO_MUBC) {
          // Só busca quando GTIN e Associação não geraram candidatos
          if (candidatos.length === 0) {
            const resultado = await instancia.identificar(item, context);
            const lista = Array.isArray(resultado) ? resultado : [];
            produtosPorMotor.push(
              lista.length > 0
                ? Number(lista[0].produtoId ?? lista[0].produto_id) || null
                : null
            );
            candidatos.push(...lista);
            meta.mubcDiagnostico = instancia.obterUltimoDiagnostico?.() ?? null;
          } else {
            produtosPorMotor.push(null);
            meta.mubcDiagnostico = {
              mubcExecutado: false,
              motivo: 'candidatos_ja_encontrados_gtin_ou_associacao',
              quantidadeCandidatos: 0
            };
          }
        } else if (ENGINES_IDENTIFICACAO.includes(codigo)) {
          const resultado = await instancia.identificar(item, context);
          const lista = Array.isArray(resultado) ? resultado : [];

          produtosPorMotor.push(
            lista.length > 0
              ? Number(lista[0].produtoId ?? lista[0].produto_id) || null
              : null
          );
          candidatos.push(...lista);
        } else if (codigo === CODIGO_SIMILARITY) {
          await pontuarCandidatosComSimilarity(instancia, instancias, candidatos, meta, context, item);
        } else {
          const resultado = await instancia.identificar(item, context);
          const lista = Array.isArray(resultado) ? resultado : [];
          candidatos.push(...lista);
        }
      } catch {
        if (ENGINES_IDENTIFICACAO.includes(codigo)) {
          produtosPorMotor.push(null);
        }
      }

      meta.tempoPorEngine[codigo] = Date.now() - inicio;
    }

    // Garantia: se Similarity não rodou (ou falhou antes do filtro),
    // ainda assim remove MUBC incompatíveis antes de devolver a coleção.
    if (
      meta.compatibilityDiagnostico == null
      && candidatos.some(veioDoMubc)
    ) {
      await filtrarCandidatosPorCompatibilidade(instancias, candidatos, meta, context, item);
    }

    candidatos._meta = {
      produtosPorMotor,
      canonicalProduct: meta.canonicalProduct,
      semanticProduct: meta.semanticProduct,
      similarityResult: meta.similarityResult,
      mubcDiagnostico: meta.mubcDiagnostico,
      compatibilityDiagnostico: meta.compatibilityDiagnostico,
      tempoPorEngine: meta.tempoPorEngine
    };

    return candidatos;
  };
}

module.exports = {
  criarResolverEngines,
  criarEngineExecutor,
  ENGINES_IDENTIFICACAO
};
