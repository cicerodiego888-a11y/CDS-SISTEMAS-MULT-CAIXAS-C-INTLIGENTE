'use strict';

/**
 * Política oficial MIIP V2 — hierarquia de identificação.
 * Não é um motor novo: filtra a decisão do pipeline existente.
 *
 * 1. Código de barras exato
 * 2. Código interno explícito OU mapeamento fornecedor (CNPJ + cProd);
 *    mapeamento antigo gravado automaticamente (auto_*) só sugere
 * 3. Nome — só sem barras e sem código interno; nunca AUTO
 * 4. Sem correspondência → pendente
 */

const MiipAction = require('./MiipAction');
const { normalizarGtin } = require('../utils/normalizarGtin');
const { normalizarCnpj } = require('../utils/normalizarCnpj');
const { normalizarCodigoFornecedor } = require('../utils/normalizarCodigoFornecedor');

const MOTOR_GTIN = 'motor_gtin';
const MOTOR_FORNECEDOR = 'motor_associacao_fornecedor';

/**
 * Gravada em cada resultado de importação. Resultado sem esta versão foi decidido por regra
 * anterior e é revalidado na leitura (MiipRevalidacaoResultadoPersistido).
 */
const VERSAO_REGRA_IDENTIFICACAO = 'miip-v2-s43b';

/** "SEM GTIN", vazio e GTIN só com zeros não identificam produto. */
function gtinIdentificador(valor) {
  const gtin = normalizarGtin(valor);
  if (!gtin || /^0+$/.test(gtin)) return null;
  return gtin;
}

const CRITERIOS = Object.freeze({
  CODIGO_BARRAS: 'CODIGO_BARRAS',
  CODIGO_INTERNO: 'CODIGO_INTERNO',
  MAPEAMENTO_FORNECEDOR: 'MAPEAMENTO_FORNECEDOR',
  NOME: 'NOME',
  SEM_CORRESPONDENCIA: 'SEM_CORRESPONDENCIA'
});

function texto(valor) {
  if (valor == null) return '';
  return String(valor).trim();
}

function gtinXml(item) {
  return gtinIdentificador(
    item?.codigoBarras ?? item?.codigo_barras ?? item?.gtin ?? item?.cean ?? item?.cEAN
  );
}

function temCodigoBarrasXml(item) {
  return Boolean(gtinXml(item));
}

function codigoInternoXml(item) {
  return texto(item?.codigoInterno ?? item?.codigo_interno ?? item?.codigo_interno_cds);
}

function codigoFornecedorXml(item) {
  return texto(
    item?.codigoFornecedor
    ?? item?.codigo_fornecedor
    ?? item?.cProd
    ?? item?.cprod
  );
}

function gtinCandidato(candidato) {
  const snap = candidato?.snapshot || {};
  const prod = candidato?.produto || {};
  return gtinIdentificador(
    candidato?.codigoBarras
    ?? candidato?.codigo_barras
    ?? snap.codigoBarras
    ?? snap.codigo_barras
    ?? snap.gtin
    ?? prod.codigo_barras
    ?? prod.gtin
    ?? prod.codigoBarras
  );
}

function codigoInternoCandidato(candidato) {
  const snap = candidato?.snapshot || {};
  const prod = candidato?.produto || {};
  return texto(candidato?.codigo ?? snap.codigo ?? prod.codigo);
}

function motores(candidato) {
  return Array.isArray(candidato?.motoresQueVotaram) ? candidato.motoresQueVotaram : [];
}

function evidenciasTipos(candidato) {
  return (candidato?.evidencias || []).map((ev) => String(ev?.tipo || '').toLowerCase());
}

function evidenciasDoMotor(candidato, motor) {
  return (candidato?.evidencias || []).filter((ev) => ev?.motor === motor);
}

function valorEvidencia(evidencias, tipo) {
  const ev = evidencias.find((e) => e?.tipo === tipo);
  return ev ? ev.valor : undefined;
}

function produtoAtivo(candidato) {
  const ativo = candidato?.snapshot?.ativo ?? candidato?.produto?.ativo;
  return ativo == null || ativo === 1 || ativo === '1' || ativo === true;
}

/** Barras exato: código principal do cadastro ou GTIN localizado pelo motor de barras. */
function ehMatchBarrasExato(candidato, gtin) {
  if (!gtin || !produtoAtivo(candidato)) return false;
  if (gtinCandidato(candidato) === gtin) return true;
  const evGtin = evidenciasDoMotor(candidato, MOTOR_GTIN);
  return evGtin.some((ev) => ev?.tipo === 'gtin_exato' && gtinIdentificador(ev.valor) === gtin);
}

function ehMapeamentoFornecedor(candidato) {
  return motores(candidato).includes(MOTOR_FORNECEDOR)
    || evidenciasDoMotor(candidato, MOTOR_FORNECEDOR).length > 0;
}

/** Mapeamento persistido vale só para o mesmo CNPJ + cProd do item, associação ativa e produto ativo. */
function ehMapeamentoFornecedorValido(candidato, item) {
  if (!ehMapeamentoFornecedor(candidato)) return false;
  const cnpjItem = normalizarCnpj(item?.fornecedorCnpj ?? item?.fornecedor_cnpj);
  const cprodItem = normalizarCodigoFornecedor(codigoFornecedorXml(item));
  if (!cnpjItem || !cprodItem) return false;
  const evs = evidenciasDoMotor(candidato, MOTOR_FORNECEDOR);
  if (valorEvidencia(evs, 'associacao_fornecedor') == null) return false;
  if (normalizarCnpj(valorEvidencia(evs, 'fornecedor_cnpj')) !== cnpjItem) return false;
  if (normalizarCodigoFornecedor(valorEvidencia(evs, 'codigo_fornecedor')) !== cprodItem) return false;
  const status = candidato?.atributosExtraidos?.statusAssociacao;
  if (status != null && String(status).toLowerCase() !== 'ativa') return false;
  return produtoAtivo(candidato);
}

/** Mapeamento gravado sem confirmação humana (origem auto_*): serve só como sugestão. */
function ehMapeamentoAutomaticoLegado(candidato) {
  const origem = valorEvidencia(evidenciasDoMotor(candidato, MOTOR_FORNECEDOR), 'origem_associacao');
  return String(origem ?? '').trim().toLowerCase().startsWith('auto_');
}

function ehMatchInternoExato(candidato, internoXml) {
  if (!internoXml || !produtoAtivo(candidato)) return false;
  return codigoInternoCandidato(candidato) === internoXml;
}

/**
 * Nome só sugere com evidência real de semelhança (palavra descritiva em comum ou sinônimo).
 * Ter vindo do MUBC, coincidir só cProd, NCM, marca, unidade ou medida não basta.
 */
function ehMatchNome(candidato) {
  const tipos = evidenciasTipos(candidato);
  if (tipos.includes('gtin_exato') || tipos.includes('codigo_interno')) return false;
  if (ehMapeamentoFornecedor(candidato)) return false;
  if (motores(candidato).includes('motor_gtin')) return false;
  if (motores(candidato).includes('motor_associacao_fornecedor')) return false;
  return tipos.some((t) => t === 'descricao' || t === 'sinonimo');
}

function decidir(acao, candidatos, criterio, extras = {}) {
  const lista = Array.isArray(candidatos) ? candidatos.slice() : [];
  const melhor = lista[0] || null;
  const auto = acao === MiipAction.AUTO_VINCULAR && melhor;
  return {
    acao,
    criterio,
    origemDecisao: auto ? 'automatica' : (acao === MiipAction.CRIAR_NOVO ? 'pendente' : 'manual'),
    estado: auto ? 'identificado' : (acao === MiipAction.CRIAR_NOVO ? 'pendente' : 'revisao'),
    candidatos: lista,
    melhorCandidato: melhor,
    produtoId: auto ? Number(melhor.produtoId || melhor.produto_id || 0) || null : null,
    precisaConfirmacao: acao !== MiipAction.AUTO_VINCULAR,
    ...extras
  };
}

/**
 * @param {Object} item - ItemIdentificavelDTO ou plain
 * @param {Object} resultado - MiipResult (candidatos + decisao do pipeline)
 * @returns {Object} decisão V2 + candidatos filtrados
 */
function aplicarPoliticaIdentificacaoV2(item, resultado) {
  const candidatos = Array.isArray(resultado?.candidatos) ? resultado.candidatos : [];
  const gtin = gtinXml(item);
  const interno = codigoInternoXml(item);
  const cprod = codigoFornecedorXml(item);
  const temBarras = Boolean(gtin);

  if (temBarras) {
    const exatos = candidatos.filter((c) => ehMatchBarrasExato(c, gtin));
    if (exatos.length === 1) {
      return decidir(MiipAction.AUTO_VINCULAR, exatos, CRITERIOS.CODIGO_BARRAS);
    }
    if (exatos.length > 1) {
      const idsExatos = new Set(exatos.map((c) => Number(c.produtoId || c.produto_id)));
      const escolhidos = candidatos.filter((c) => ehMapeamentoFornecedorValido(c, item)
        && !ehMapeamentoAutomaticoLegado(c)
        && idsExatos.has(Number(c.produtoId || c.produto_id)));
      if (escolhidos.length === 1) {
        return decidir(MiipAction.AUTO_VINCULAR, escolhidos, CRITERIOS.MAPEAMENTO_FORNECEDOR, {
          motivo: 'codigo_barras_repetido_resolvido_por_confirmacao'
        });
      }
      return decidir(MiipAction.REVISAR_MANUAL, exatos, CRITERIOS.CODIGO_BARRAS, {
        motivo: 'codigo_barras_ambiguo'
      });
    }
  }

  const mapeados = candidatos.filter((c) => ehMapeamentoFornecedorValido(c, item));
  const confirmados = mapeados.filter((c) => !ehMapeamentoAutomaticoLegado(c));
  if (confirmados.length === 1) {
    return decidir(MiipAction.AUTO_VINCULAR, confirmados, CRITERIOS.MAPEAMENTO_FORNECEDOR);
  }
  if (confirmados.length > 1) {
    return decidir(MiipAction.REVISAR_MANUAL, confirmados, CRITERIOS.MAPEAMENTO_FORNECEDOR, {
      motivo: 'mapeamento_ambiguo'
    });
  }
  if (mapeados.length > 0) {
    return decidir(MiipAction.SUGERIR, mapeados, CRITERIOS.MAPEAMENTO_FORNECEDOR, {
      motivo: 'mapeamento_automatico_requer_confirmacao',
      bloquearNome: true
    });
  }
  const mapeadosInvalidos = candidatos.filter(ehMapeamentoFornecedor);
  if (mapeadosInvalidos.length > 0) {
    return decidir(MiipAction.REVISAR_MANUAL, mapeadosInvalidos, CRITERIOS.MAPEAMENTO_FORNECEDOR, {
      motivo: 'mapeamento_fornecedor_invalido',
      bloquearNome: true
    });
  }

  if (interno) {
    const internos = candidatos.filter((c) => ehMatchInternoExato(c, interno));
    if (internos.length === 1) {
      return decidir(MiipAction.AUTO_VINCULAR, internos, CRITERIOS.CODIGO_INTERNO);
    }
    if (internos.length > 1) {
      return decidir(MiipAction.REVISAR_MANUAL, internos, CRITERIOS.CODIGO_INTERNO, {
        motivo: 'codigo_interno_ambiguo'
      });
    }
    return decidir(MiipAction.CRIAR_NOVO, [], CRITERIOS.SEM_CORRESPONDENCIA, {
      motivo: temBarras ? 'codigo_barras_sem_match_e_interno_divergente' : 'codigo_interno_divergente',
      bloquearNome: true
    });
  }

  if (temBarras) {
    const exatosInativos = candidatos.filter((c) => !produtoAtivo(c)
      && (gtinCandidato(c) === gtin || evidenciasDoMotor(c, MOTOR_GTIN).some((ev) => ev?.tipo === 'gtin_exato' && gtinIdentificador(ev.valor) === gtin)));
    return decidir(MiipAction.CRIAR_NOVO, exatosInativos, CRITERIOS.SEM_CORRESPONDENCIA, {
      motivo: exatosInativos.length > 0 ? 'codigo_barras_produto_inativo' : 'codigo_barras_sem_match',
      bloquearNome: true
    });
  }

  const porNome = candidatos.filter(ehMatchNome);
  if (porNome.length === 1) {
    return decidir(MiipAction.SUGERIR, porNome, CRITERIOS.NOME, {
      motivo: 'nome_unico_requer_revisao'
    });
  }
  if (porNome.length > 1) {
    return decidir(MiipAction.REVISAR_MANUAL, porNome, CRITERIOS.NOME, {
      motivo: 'nome_ambiguo'
    });
  }

  return decidir(MiipAction.CRIAR_NOVO, [], CRITERIOS.SEM_CORRESPONDENCIA, {
    motivo: 'sem_correspondencia'
  });
}

function aplicarPoliticaNoResultado(item, resultado) {
  const v2 = aplicarPoliticaIdentificacaoV2(item, resultado || {});
  const decisaoAnterior = resultado?.decisao && typeof resultado.decisao === 'object'
    ? resultado.decisao
    : {};
  const resultadoNovo = resultado && typeof resultado === 'object' ? resultado : {};
  resultadoNovo.candidatos = v2.candidatos;
  resultadoNovo.decisao = {
    ...decisaoAnterior,
    acao: v2.acao,
    melhorCandidato: v2.melhorCandidato,
    precisaConfirmacao: v2.precisaConfirmacao,
    precisaCadastro: v2.acao === MiipAction.CRIAR_NOVO,
    conflito: v2.acao === MiipAction.REVISAR_MANUAL,
    criterio: v2.criterio,
    origemDecisao: v2.origemDecisao,
    estadoAssociacao: v2.estado,
    motivo: v2.motivo || decisaoAnterior.motivo,
    identificacaoV2: true,
    regraIdentificacao: VERSAO_REGRA_IDENTIFICACAO
  };
  resultadoNovo.identificacaoV2 = {
    criterio: v2.criterio,
    origemDecisao: v2.origemDecisao,
    estado: v2.estado,
    produtoId: v2.produtoId,
    motivo: v2.motivo || null,
    bloquearNome: v2.bloquearNome === true
  };
  return resultadoNovo;
}

function montarAssociacaoLinha(item, indice, v2, produtoId) {
  return {
    linha_xml: item?.nItem ?? item?.nitem ?? item?.item_key ?? indice,
    codigo_barras: item?.codigoBarras ?? item?.codigo_barras ?? null,
    cProd: codigoFornecedorXml(item) || null,
    codigo_interno: codigoInternoXml(item) || null,
    descricao_xml: item?.produtoNome ?? item?.produto_nome ?? item?.descricao ?? null,
    produto_id: produtoId != null ? Number(produtoId) : (v2?.produtoId || null),
    criterio: v2?.criterio || v2?.decisao?.criterio || null,
    origem_decisao: v2?.origemDecisao || v2?.decisao?.origemDecisao || null,
    estado: v2?.estado || v2?.decisao?.estadoAssociacao || null
  };
}

module.exports = {
  CRITERIOS,
  VERSAO_REGRA_IDENTIFICACAO,
  MOTOR_GTIN,
  MOTOR_FORNECEDOR,
  aplicarPoliticaIdentificacaoV2,
  aplicarPoliticaNoResultado,
  montarAssociacaoLinha,
  gtinIdentificador,
  temCodigoBarrasXml,
  codigoInternoXml,
  codigoFornecedorXml
};
