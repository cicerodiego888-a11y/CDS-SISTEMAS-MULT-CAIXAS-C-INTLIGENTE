/**
 * MotorUniversalBuscaCandidatos (MUBC) — Geração de candidatos quando GTIN/Associação falham.
 *
 * Responsabilidade única: encontrar candidatos no cadastro CDS.
 * Nunca decide. Nunca cadastra. Relevância interna apenas ordena Top 20
 * (score ≤ 94 para não competir com AUTO_ASSOCIAR de GTIN/Associação).
 *
 * @class MotorUniversalBuscaCandidatos
 * @module motores/miip/engines/mubc/MotorUniversalBuscaCandidatos
 */

const IMotorIdentificacao = require('../../core/IMotorIdentificacao');
const MiipConfidence = require('../../core/MiipConfidence');
const MiipCandidate = require('../../core/MiipCandidate');
const MiipEvidence = require('../../core/MiipEvidence');
const ItemIdentificavelDTO = require('../../contracts/ItemIdentificavelDTO');
const { ProdutoRepository } = require('../../repositories/ProdutoRepository');
const { normalizarGtin } = require('../../utils/normalizarGtin');
const { normalizarCodigoFornecedor } = require('../../utils/normalizarCodigoFornecedor');
const { extrairTokensDescricao, avaliarDescricao } = require('../../utils/evidenciaDescricao');
const SynonymDictionary = require('../../utils/SynonymDictionary');
const metricsCollector = require('../../metrics/MiipMetricsCollector');
const motorLogService = require('../../logs/MiipMotorLogService');

const MOTOR_CODIGO = 'motor_mubc';
const LIMITE_CANDIDATOS = 20;
const SCORE_MAX_MUBC = 94;

/** cProd não pontua aqui: código do fornecedor só identifica via mapeamento CNPJ + cProd (motor de associação). */
const PESOS = Object.freeze({
  gtin_exato: 90,
  codigo_interno: 80,
  plu: 78,
  gtin_parcial: 68,
  descricao_base: 35,
  descricao_token: 8,
  sinonimo: 6,
  marca: 12,
  ncm: 10,
  cest: 6,
  unidade_ok: 5,
  unidade_diff: -12,
  embalagem_ok: 4,
  embalagem_diff: -6
});

const PESO_POR_MOTIVO = Object.freeze({
  gtin_exato: PESOS.gtin_exato,
  codigo_interno: PESOS.codigo_interno,
  plu: PESOS.plu,
  gtin_parcial: PESOS.gtin_parcial,
  marca: PESOS.marca,
  ncm: PESOS.ncm,
  cest: PESOS.cest,
  unidade: PESOS.unidade_ok,
  unidade_diff: PESOS.unidade_diff,
  embalagem: PESOS.embalagem_ok,
  embalagem_diff: PESOS.embalagem_diff
});

/**
 * Pontuação MUBC a partir dos motivos de relevância. Motivo sem peso (ex.: codigo_fornecedor
 * gravado por versão antiga) não pontua.
 *
 * @param {Array<{tipo: string, tokens?: number, quantidade?: number}>} motivos
 * @returns {number}
 */
function pontuarMotivos(motivos) {
  let score = 0;
  (motivos || []).forEach((m) => {
    const tipo = m?.tipo;
    if (tipo === 'descricao' || tipo === 'descricao_medida') {
      score += PESOS.descricao_base + Math.min(Number(m.tokens) || 1, 5) * PESOS.descricao_token;
    } else if (tipo === 'sinonimo') {
      score += Math.min(Number(m.quantidade) || 1, 3) * PESOS.sinonimo;
    } else if (PESO_POR_MOTIVO[tipo] != null) {
      score += PESO_POR_MOTIVO[tipo];
    }
  });
  return Math.max(0, Math.min(SCORE_MAX_MUBC, Math.round(score)));
}

class MotorUniversalBuscaCandidatos extends IMotorIdentificacao {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    super(config);
    this._produtoRepository = config.produtoRepository ?? new ProdutoRepository({
      db: config.db ?? null
    });
    this._metrics = config.metricsCollector ?? metricsCollector;
    this._logs = config.logService ?? motorLogService;
    this._ultimoDiagnostico = null;
  }

  getCodigo() {
    return MOTOR_CODIGO;
  }

  getDescricao() {
    return 'Busca universal de candidatos (descrição, NCM, marca, GTIN parcial, etc.)';
  }

  getPeso() {
    return 0.7;
  }

  /**
   * @returns {Object|null}
   */
  obterUltimoDiagnostico() {
    return this._ultimoDiagnostico;
  }

  /**
   * @private
   */
  _extrairTokens(nome) {
    return extrairTokensDescricao(nome);
  }

  /**
   * @private
   */
  _expandirSinonimos(tokens) {
    const extras = new Set();
    try {
      SynonymDictionary.carregar();
      tokens.forEach((token) => {
        const matches = SynonymDictionary.buscar(token) || [];
        matches.forEach((m) => {
          const s = String(m.sinonimo || m.synonym || '').toUpperCase().trim();
          if (s && s.length >= 2) extras.add(s);
        });
      });
    } catch {
      /* dicionário opcional */
    }
    return [...extras];
  }

  /**
   * @private
   */
  _normalizarUnidade(u) {
    const v = String(u || '').trim().toUpperCase();
    if (!v) return '';
    if (['UN', 'UND', 'UNID', 'PC', 'PEC', 'PÇ', 'PZA', 'PECA'].includes(v)) return 'UN';
    if (['CX', 'CXA', 'BOX'].includes(v)) return 'CX';
    if (['KG', 'QUILO', 'KILO'].includes(v)) return 'KG';
    if (['LT', 'L', 'LITRO', 'LITROS'].includes(v)) return 'LT';
    if (['MT', 'M', 'METRO'].includes(v)) return 'MT';
    return v;
  }

  /**
   * @private
   */
  _calcularRelevancia(hit, item, tokensXml, sinonimos) {
    const motivos = [];
    const motivosHit = new Set(hit.motivos || []);

    if (motivosHit.has('gtin_exato')) {
      motivos.push({ tipo: 'gtin_exato', rotulo: 'GTIN exato' });
    }
    if (motivosHit.has('codigo_interno')) {
      motivos.push({ tipo: 'codigo_interno', rotulo: 'Código interno' });
    }
    if (motivosHit.has('plu')) {
      motivos.push({ tipo: 'plu', rotulo: 'PLU' });
    }
    if (motivosHit.has('gtin_parcial')) {
      motivos.push({ tipo: 'gtin_parcial', rotulo: 'GTIN parcial' });
    }

    const nomeCad = String(hit.snapshot?.nome || '').toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const descricao = avaliarDescricao(tokensXml, hit.snapshot?.nome);
    if (descricao) {
      motivos.push(descricao.tipo === 'descricao'
        ? { tipo: 'descricao', rotulo: 'Descrição semelhante', tokens: descricao.tokens }
        : { tipo: 'descricao_medida', rotulo: 'Só medida ou unidade coincide', tokens: descricao.tokens });
    }

    let sinHit = 0;
    sinonimos.forEach((s) => {
      if (nomeCad.includes(s)) sinHit += 1;
    });
    if (sinHit > 0) {
      motivos.push({ tipo: 'sinonimo', rotulo: 'Sinônimo', quantidade: Math.min(sinHit, 3) });
    }

    const marcaXml = String(item.marca || item.marcaNome || '').trim().toUpperCase();
    const marcaCad = String(hit.snapshot?.marcaNome || hit.snapshot?.atributos?.marca || '').trim().toUpperCase();
    if ((marcaXml && marcaCad && (marcaCad.includes(marcaXml) || marcaXml.includes(marcaCad)))
      || motivosHit.has('marca')) {
      motivos.push({ tipo: 'marca', rotulo: 'Mesma marca' });
    }

    const ncmXml = String(item.ncm || '').replace(/\D/g, '');
    const ncmCad = String(hit.snapshot?.ncm || '').replace(/\D/g, '');
    if (ncmXml && ncmCad && ncmXml === ncmCad) {
      motivos.push({ tipo: 'ncm', rotulo: 'Mesmo NCM' });
    }

    const cestXml = String(item.cest || '').replace(/\D/g, '');
    const cestCad = String(hit.snapshot?.cest || '').replace(/\D/g, '');
    if (cestXml && cestCad && cestXml === cestCad) {
      motivos.push({ tipo: 'cest', rotulo: 'Mesmo CEST' });
    }

    const uXml = this._normalizarUnidade(item.unidade);
    const uCad = this._normalizarUnidade(hit.snapshot?.unidade);
    if (uXml && uCad) {
      motivos.push(uXml === uCad
        ? { tipo: 'unidade', rotulo: 'Mesma unidade' }
        : { tipo: 'unidade_diff', rotulo: 'Unidade diferente' });
    }

    const embXml = this._normalizarUnidade(item.embalagem || item.unidadeEmbalagem);
    const embCad = this._normalizarUnidade(hit.snapshot?.atributos?.embalagem);
    if (embXml && embCad) {
      motivos.push(embXml === embCad
        ? { tipo: 'embalagem', rotulo: 'Mesma embalagem' }
        : { tipo: 'embalagem_diff', rotulo: 'Embalagem diferente' });
    }

    return { score: pontuarMotivos(motivos), motivos };
  }

  /**
   * @private
   */
  _montarEvidencias(motivos, score) {
    return motivos.map((m) => MiipEvidence.agora({
      motor: MOTOR_CODIGO,
      tipo: m.tipo,
      descricao: m.rotulo,
      peso: Math.max(0, Math.min(100, score)),
      valor: m.tokens ?? m.tipo,
      score
    }));
  }

  /**
   * @private
   */
  _montarCandidato(hit, relevancia) {
    const snapshot = hit.snapshot;
    const ativo = snapshot?.ativo === 1 || snapshot?.ativo === true || snapshot?.ativo === '1';
    const confianca = relevancia.score >= 80
      ? MiipConfidence.ALTA
      : (relevancia.score >= 50 ? MiipConfidence.MEDIA : MiipConfidence.BAIXA);

    return MiipCandidate.create({
      produtoId: snapshot.id,
      snapshot,
      produto: {
        ...snapshot.toResumo(),
        marca: snapshot.marcaNome || null,
        fornecedor: snapshot.fornecedor || null,
        categoria_id: snapshot.categoria_id
      },
      scoreTotal: relevancia.score,
      confianca: ativo ? confianca : MiipConfidence.BAIXA,
      ranking: 0,
      evidencias: this._montarEvidencias(relevancia.motivos, relevancia.score),
      motoresQueVotaram: [MOTOR_CODIGO],
      atributosExtraidos: {
        origemDados: 'MUBC',
        motivosRelevancia: relevancia.motivos,
        matchMotivos: hit.motivos || []
      }
    });
  }

  /**
   * @private
   */
  _montarDiagnosticoVazio(item, tokens) {
    const gtin = normalizarGtin(item.codigoBarras);
    return {
      gtinEncontrado: false,
      associacaoEncontrada: false,
      mubcExecutado: true,
      quantidadeCandidatos: 0,
      motivos: [
        gtin ? 'GTIN inexistente no cadastro.' : 'GTIN ausente no XML.',
        'Associação fornecedor inexistente.',
        tokens.length ? 'Descrição sem correspondência suficiente.' : 'Descrição insuficiente para busca.',
        item.ncm ? 'NCM sem produto compatível localizado.' : 'NCM ausente.',
        'Nenhum produto compatível localizado.'
      ]
    };
  }

  /**
   * @param {ItemIdentificavelDTO|Object} item
   * @param {Object} [_contexto]
   * @returns {Promise<MiipCandidate[]>}
   */
  async identificar(item, _contexto) {
    const dto = item instanceof ItemIdentificavelDTO ? item : ItemIdentificavelDTO.create(item);
    const tokens = this._extrairTokens(dto.produtoNome);
    const sinonimos = this._expandirSinonimos(tokens);
    const gtin = normalizarGtin(dto.codigoBarras);
    const codigoFornecedor = normalizarCodigoFornecedor(dto.codigoFornecedor);

    const hits = await this._produtoRepository.buscarCandidatosUniversais({
      gtin,
      codigoInterno: dto.codigoInterno || (codigoFornecedor ? null : dto.codigo) || null,
      plu: dto.plu || null,
      tokens,
      sinonimos,
      ncm: dto.ncm,
      cest: dto.cest,
      marca: dto.marca || dto.marcaNome,
      unidade: dto.unidade,
      limite: 60
    });

    const candidatos = hits
      .map((hit) => {
        const rel = this._calcularRelevancia(hit, dto, tokens, sinonimos);
        if (rel.score < 25 && !(hit.motivos || []).some((m) =>
          ['gtin_exato', 'codigo_interno', 'plu', 'gtin_parcial'].includes(m))) {
          return null;
        }
        return this._montarCandidato(hit, rel);
      })
      .filter(Boolean)
      .sort((a, b) => b.scoreTotal - a.scoreTotal)
      .slice(0, LIMITE_CANDIDATOS)
      .map((c, i) => {
        c.ranking = i + 1;
        return c;
      });

    this._ultimoDiagnostico = candidatos.length === 0
      ? this._montarDiagnosticoVazio(dto, tokens)
      : {
        gtinEncontrado: false,
        associacaoEncontrada: false,
        mubcExecutado: true,
        quantidadeCandidatos: candidatos.length,
        top10: candidatos.slice(0, 10).map((c) => ({
          produtoId: c.produtoId,
          nome: c.produto?.nome,
          score: c.scoreTotal,
          motivos: (c.atributosExtraidos?.motivosRelevancia || []).map((m) => m.rotulo)
        })),
        motivos: []
      };

    this._logs.registrar({
      motor: MOTOR_CODIGO,
      evento: 'mubc_busca',
      item: dto.toJSON?.() ?? dto,
      quantidadeCandidatos: candidatos.length,
      top10: this._ultimoDiagnostico.top10 || [],
      diagnostico: this._ultimoDiagnostico
    });

    this._metrics.registrarExecucao({
      motor: MOTOR_CODIGO,
      encontrado: candidatos.length > 0,
      duracaoMs: 0
    });

    return candidatos;
  }

  /**
   * @param {ItemIdentificavelDTO|Object} item
   * @param {Object} [contexto]
   */
  async executar(item, contexto) {
    const startedAt = new Date().toISOString();
    const inicio = Date.now();
    let candidatos = [];
    let erro = null;
    try {
      candidatos = await this.identificar(item, contexto);
    } catch (error) {
      erro = error?.message || 'Erro MUBC';
      candidatos = [];
    }
    return {
      motor: MOTOR_CODIGO,
      candidatos,
      evidencias: candidatos.flatMap((c) => c.evidencias),
      diagnostico: this._ultimoDiagnostico,
      duracaoMs: Date.now() - inicio,
      startedAt,
      finishedAt: new Date().toISOString(),
      erro
    };
  }
}

module.exports = MotorUniversalBuscaCandidatos;
module.exports.MOTOR_CODIGO = MOTOR_CODIGO;
module.exports.LIMITE_CANDIDATOS = LIMITE_CANDIDATOS;
module.exports.SCORE_MAX_MUBC = SCORE_MAX_MUBC;
module.exports.pontuarMotivos = pontuarMotivos;
