/**
 * ProductCompatibilityGuard — Barreira de compatibilidade comercial MIIP.
 *
 * Similaridade NÃO é compatibilidade.
 * Avalia se um candidato pode seguir para Similarity / ranking.
 * Não acessa banco, não cria associação, não decide o produto final.
 *
 * @module motores/miip/utils/ProductCompatibilityGuard
 */

'use strict';

const MOTOR_CODIGO = 'motor_compatibility_guard';

const IDENTIFICADORES_FORTES = Object.freeze([
  'gtin_exato',
  'codigo_fornecedor',
  'codigo_interno',
  'plu'
]);

/** Tokens que sozinhos não reabilitam equivalência. */
const MATERIAL_GENERICO = Object.freeze([
  'ACO', 'AÇO', 'INOX', 'INOXIDAVEL', 'METAL', 'PLASTICO', 'PLÁSTICO',
  'MADEIRA', 'BORRACHA', 'ALUMINIO', 'ALUMÍNIO', 'COBRE', 'PVC'
]);

const metricas = {
  compatibility_guard_executions: 0,
  compatibility_guard_blocked: 0,
  compatibility_guard_compatible: 0,
  bloqueio_por_tipo: 0,
  bloqueio_por_ncm: 0,
  bloqueio_por_dimensao: 0
};

/**
 * @returns {Object}
 */
function obterMetricas() {
  return { ...metricas };
}

/**
 * @returns {void}
 */
function reiniciarMetricas() {
  Object.keys(metricas).forEach((k) => {
    metricas[k] = 0;
  });
}

/**
 * @param {*} valor
 * @returns {string}
 */
function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {*} valor
 * @returns {string|null}
 */
function extrairValorCampo(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'object') {
    const v = valor.valor ?? valor.normalizado ?? valor.value ?? null;
    return v == null || v === '' ? null : String(v);
  }
  return String(valor);
}

/**
 * @param {Object|null} semantic
 * @param {string} campo
 * @returns {string|null}
 */
function lerSemantic(semantic, campo) {
  if (!semantic) return null;
  return extrairValorCampo(semantic[campo]);
}

/**
 * Fallback: extrai tipo comercial do nome quando semantic não trouxe tipo.
 * @param {string|null|undefined} nome
 * @returns {string|null}
 */
function obterTipoDeNome(nome) {
  const texto = String(nome || '').trim();
  if (!texto) return null;
  try {
    const AttributeParser = require('./AttributeParser');
    const CanonicalNormalizer = require('./CanonicalNormalizer');
    const attrs = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(texto));
    return normalizarTexto(attrs?.tipo?.valor || '') || null;
  } catch {
    return null;
  }
}

/**
 * @param {Object|null} item
 * @param {Object|null} semantic
 * @returns {string|null}
 */
function obterTipo(item, semantic) {
  return normalizarTexto(
    lerSemantic(semantic, 'tipo')
    || item?.tipo
    || item?.tipo_produto
    || ''
  )
    || obterTipoDeNome(
      item?.produto_nome
      || item?.nome
      || item?.descricao
      || item?.produtoNome
    )
    || null;
}

/**
 * @param {Object|null} item
 * @param {Object|null} semantic
 * @param {Object|null} produto
 * @returns {string|null}
 */
function obterNcm(item, semantic, produto) {
  const bruto = lerSemantic(semantic, 'ncm')
    || item?.ncm
    || produto?.ncm
    || produto?.snapshot?.ncm
    || '';
  const digits = String(bruto).replace(/\D/g, '');
  return digits.length >= 4 ? digits : null;
}

/**
 * @param {string|null} ncm
 * @returns {string|null}
 */
function capituloNcm(ncm) {
  if (!ncm || ncm.length < 2) return null;
  return ncm.slice(0, 2);
}

/**
 * @param {Array|Object|null} motivos
 * @returns {string[]}
 */
function normalizarMotivosMatch(motivos) {
  if (!motivos) return [];
  if (Array.isArray(motivos)) {
    return motivos.map((m) => {
      if (typeof m === 'string') return m.toLowerCase();
      return String(m?.tipo || m?.codigo || m?.motivo || '').toLowerCase();
    }).filter(Boolean);
  }
  if (typeof motivos === 'object') {
    return Object.keys(motivos)
      .filter((k) => motivos[k])
      .map((k) => k.toLowerCase());
  }
  return [];
}

/**
 * @param {string[]} motivos
 * @returns {boolean}
 */
function temIdentificadorForte(motivos) {
  return IDENTIFICADORES_FORTES.some((id) => motivos.includes(id));
}

/**
 * Extrai medidas textuais simples da descrição canônica.
 * @param {Object|null} item
 * @param {Object|null} semantic
 * @returns {Array<{raw: string, unidade: string, valor: number}>}
 */
function extrairMedidas(item, semantic) {
  const fontes = [
    lerSemantic(semantic, 'comprimento'),
    lerSemantic(semantic, 'diametro'),
    lerSemantic(semantic, 'bitola'),
    item?.produto_nome || item?.nome || item?.descricao || '',
    semantic?.canonico || semantic?.original || ''
  ].filter(Boolean).join(' ');

  const texto = String(fontes).toUpperCase();
  const achados = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(POL|"|''|IN|M|CM|MM|MT)\b/gi;
  let m;
  while ((m = re.exec(texto)) !== null) {
    let unidade = m[2];
    if (unidade === '"' || unidade === "''" || unidade === 'IN') unidade = 'POL';
    if (unidade === 'MT') unidade = 'M';
    achados.push({
      raw: m[0],
      unidade: unidade.toUpperCase(),
      valor: Number(String(m[1]).replace(',', '.'))
    });
  }
  return achados;
}

/**
 * @param {Array} medXml
 * @param {Array} medCds
 * @returns {boolean}
 */
function medidasAbsurdamenteDivergentes(medXml, medCds) {
  if (!medXml.length || !medCds.length) return false;
  const fam = (u) => {
    if (['POL', 'IN'].includes(u)) return 'polegada';
    if (['M', 'CM', 'MM'].includes(u)) return 'metrica';
    return u;
  };
  const famsXml = new Set(medXml.map((x) => fam(x.unidade)));
  const famsCds = new Set(medCds.map((x) => fam(x.unidade)));
  // famílias distintas (polegada × métrica) → divergência dimensional forte
  if (famsXml.has('polegada') && famsCds.has('metrica')) return true;
  if (famsXml.has('metrica') && famsCds.has('polegada')) return true;
  return false;
}

/**
 * Avalia compatibilidade comercial entre item XML e produto CDS.
 *
 * @param {Object} entrada
 * @param {Object} [entrada.itemXml]
 * @param {Object} [entrada.produtoCds]
 * @param {Object} [entrada.semanticXml]
 * @param {Object} [entrada.semanticCds]
 * @param {Array|Object} [entrada.motivosMatch]
 * @returns {Object}
 */
function avaliar(entrada = {}) {
  metricas.compatibility_guard_executions += 1;

  const itemXml = entrada.itemXml || {};
  const produtoCds = entrada.produtoCds || {};
  const semanticXml = entrada.semanticXml || null;
  const semanticCds = entrada.semanticCds || null;
  const motivosMatch = normalizarMotivosMatch(
    entrada.motivosMatch
    || produtoCds?.atributosExtraidos?.matchMotivos
    || produtoCds?.atributosExtraidos?.motivosRelevancia
  );

  const regrasAplicadas = [];
  const motivos = [];
  const divergencias = [];

  // Identidade forte prevalece
  if (temIdentificadorForte(motivosMatch)) {
    regrasAplicadas.push('identificador_forte');
    metricas.compatibility_guard_compatible += 1;
    return {
      compativel: true,
      bloqueado: false,
      motivos: ['Identificador forte preservado'],
      divergencias: [],
      regrasAplicadas,
      nivel: 'COMPATIVEL',
      motor: MOTOR_CODIGO
    };
  }

  // GTIN parcial NÃO isenta
  if (motivosMatch.includes('gtin_parcial')) {
    regrasAplicadas.push('gtin_parcial_nao_isenta');
  }

  const tipoXml = obterTipo(itemXml, semanticXml);
  const tipoCds = obterTipo(produtoCds, semanticCds)
    || obterTipo(produtoCds?.produto, semanticCds)
    || obterTipo(produtoCds?.snapshot, semanticCds);

  const ncmXml = obterNcm(itemXml, semanticXml, null);
  const ncmCds = obterNcm(produtoCds, semanticCds, produtoCds?.snapshot || produtoCds?.produto || produtoCds);

  let tipoIncompativel = false;
  if (tipoXml && tipoCds && tipoXml !== tipoCds) {
    tipoIncompativel = true;
    regrasAplicadas.push('tipo_incompativel');
    metricas.bloqueio_por_tipo += 1;
    motivos.push('Tipo de produto incompatível');
    divergencias.push({
      tipo: 'incompatibilidade_tipo',
      severidade: 'ALTA',
      xml: tipoXml,
      cds: tipoCds,
      descricao: 'Tipo de produto incompatível',
      motor: MOTOR_CODIGO
    });
  }

  let ncmIncompativel = false;
  if (ncmXml && ncmCds && ncmXml !== ncmCds) {
    const capXml = capituloNcm(ncmXml);
    const capCds = capituloNcm(ncmCds);
    if (capXml && capCds && capXml !== capCds) {
      ncmIncompativel = true;
      regrasAplicadas.push('ncm_capitulo_divergente');
      divergencias.push({
        tipo: 'ncm_incompativel',
        severidade: 'ALTA',
        xml: ncmXml,
        cds: ncmCds,
        descricao: 'NCM com divergência fiscal forte',
        motor: MOTOR_CODIGO
      });
    } else {
      regrasAplicadas.push('ncm_diferente_mesmo_capitulo');
      divergencias.push({
        tipo: 'ncm_divergente',
        severidade: 'MEDIA',
        xml: ncmXml,
        cds: ncmCds,
        descricao: 'NCM diferente (mesmo capítulo)',
        motor: MOTOR_CODIGO
      });
    }
  }

  const medXml = extrairMedidas(itemXml, semanticXml);
  const medCds = extrairMedidas(
    { produto_nome: produtoCds?.nome || produtoCds?.produto?.nome || produtoCds?.snapshot?.nome },
    semanticCds
  );
  let dimensaoIncompativel = false;
  if (medidasAbsurdamenteDivergentes(medXml, medCds)) {
    dimensaoIncompativel = true;
    regrasAplicadas.push('dimensao_unidade_divergente');
    metricas.bloqueio_por_dimensao += 1;
    divergencias.push({
      tipo: 'dimensao_incompativel',
      severidade: 'MEDIA',
      xml: medXml.map((m) => m.raw).join(', '),
      cds: medCds.map((m) => m.raw).join(', '),
      descricao: 'Medidas com unidades incompatíveis',
      motor: MOTOR_CODIGO
    });
  }

  const materialXml = normalizarTexto(lerSemantic(semanticXml, 'material') || '');
  const materialCds = normalizarTexto(lerSemantic(semanticCds, 'material') || '');
  if (
    materialXml
    && materialCds
    && materialXml === materialCds
    && MATERIAL_GENERICO.includes(materialXml)
  ) {
    regrasAplicadas.push('material_generico_insuficiente');
  }

  // Hard block: tipo incompatível
  if (tipoIncompativel) {
    if (ncmIncompativel) {
      metricas.bloqueio_por_ncm += 1;
      motivos.push('NCM com divergência fiscal forte');
    }
    if (dimensaoIncompativel) {
      motivos.push('Medidas com unidades incompatíveis');
    }
    metricas.compatibility_guard_blocked += 1;
    return {
      compativel: false,
      bloqueado: true,
      motivos,
      divergencias,
      regrasAplicadas,
      nivel: 'INCOMPATIVEL',
      motor: MOTOR_CODIGO
    };
  }

  // Sem tipo confiável + NCM de capítulos totalmente distintos → suspeito/bloqueio conservador
  if (ncmIncompativel && !tipoXml && !tipoCds) {
    regrasAplicadas.push('ncm_sem_tipo_conservador');
    // não bloqueia só por NCM (regra explícita da sprint)
  }

  metricas.compatibility_guard_compatible += 1;
  return {
    compativel: true,
    bloqueado: false,
    motivos: motivos.length ? motivos : ['Compatível para similaridade'],
    divergencias,
    regrasAplicadas: regrasAplicadas.length ? regrasAplicadas : ['sem_bloqueio'],
    nivel: divergencias.length ? 'SUSPEITO' : 'COMPATIVEL',
    motor: MOTOR_CODIGO
  };
}

module.exports = {
  avaliar,
  obterMetricas,
  reiniciarMetricas,
  normalizarTexto,
  temIdentificadorForte,
  IDENTIFICADORES_FORTES,
  MOTOR_CODIGO
};
