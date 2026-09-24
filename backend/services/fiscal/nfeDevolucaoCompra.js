/**
 * NF-e de Devolução de Compra — MVP produção (RC1).
 * Reutiliza motor oficial: certificado, assinatura, validação, SOAP, parser, DANFE, numeração.
 * Builder específico: xmlBuilderNfeDevolucaoCompra (finNFe=4 + DFeReferenciado por item).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dbPadrao = require('../../database');
let dbOverride = null;
function setDbForTests(dbInst) {
  dbOverride = dbInst || null;
}
function db() {
  return dbOverride || dbPadrao;
}
const { getFiscalConfig } = require('./configService');
const { assinarNFe } = require('./signer');
const { montarLote, enviarLote } = require('./soapClient');
const { onlyDigits, compactarXml } = require('./utils');
const { getFiscalSubDir } = require('./paths');
const { validarXmlFiscal, extrairTotais } = require('./validarXmlFiscal');
const { auditarNfe, formatarMensagemAuditoria } = require('./auditoriaFiscalNfe');
const { adquirirLock, liberarLock } = require('./nfeEmissionLockService');
const { preflightNfeDevolucao, assertPreflightAprovado } = require('./nfeDevolucaoPreflight');
const {
  buscarDocumentoPorChave,
  buscarDocumentoPorNumeroSerie,
  parseChaveNfe,
  salvarDebugIdentidade
} = require('./nfeIdentityService');
const { calcularHashXml } = require('./nfeXmlIdentityService');
const { parseRetornoAutorizacaoNfe } = require('./nfeRetornoAutorizacao');
const {
  classificarResultadoEmissaoNfe,
  deveBloquearNovaTransmissao
} = require('./classificarResultadoEmissaoNfe');
const { gerarDanfeNfeHtml } = require('./danfeNfe');
const { buildXmlNFeDevolucaoCompra } = require('./xmlBuilderNfeDevolucaoCompra');
const { resolverMunicipioDestinatario } = require('./municipioIbge');
const { adaptarImpostoEspelhadoAoCrt } = require('./resolverIcmsCrtEmitente');
const {
  espelharTributosNfeDevolucaoCompra,
  validarEspelhamentoAntesTransmissao
} = require('./espelharTributosNfeDevolucaoCompra');
const {
  garantirTabelasSaldoDevolucao,
  carregarSaldosDevolucaoCompra,
  validarQuantidadesContraSaldo,
  persistirItensNfeDevolucao,
  cancelarNfeDevolucaoCompra,
  listarNotasDevolucaoCompra,
  STATUS
} = require('./controleSaldoDevolucaoCompra');
const {
  carregarEValidarCertificadoNfe,
  getUrlNFe55,
  proximoNumeroNFeVenda
} = require('./nfeEmissorVenda');
const {
  garantirSchemaLifecycle,
  aposPersistirEmissao,
  cancelarNfeDevolucaoOficial,
  consultarSituacaoDevolucao,
  reenviarNfeDevolucao,
  listarEventosDevolucao,
  obterPainelStatus,
  obterXmlVersionado
} = require('./nfeDevolucaoLifecycleService');
const {
  uiDoEstado,
  podeReenviarDevolucao,
  podeCancelarDevolucao,
  mensagemRejeicaoDetalhada,
  podeGerarNovaIdentidadeDevolucao,
  mensagemNovaIdentidadeDevolucao,
  xmlRejeicaoFiscalDefinitiva
} = require('./nfeDevolucaoEstados');
const {
  obterRascunhoDevolucaoCompra,
  salvarRascunhoDevolucaoCompra,
  excluirRascunhoDevolucaoCompra
} = require('./rascunhoDevolucaoCompra');
const {
  garantirTabelasSubstituicaoDevolucao,
  resolverContextoSubstituicao210240,
  resolverOrigemSubstituicao210240,
  trace210240,
  registrarAuditoriaExcecaoSaldo,
  efetivarSubstituicaoAposAutorizacao,
  calcularSaldoDisponivelParaDevolucao,
  montarBlocoDevolucaoRelacionada,
  obterSubstituicaoPorAnterior
} = require('./nfeDevolucaoSubstituicaoService');
const configService = require('../configuracaoService');

async function carregarSaldosComExcecao210240(compraId, origemDevolucaoId, rascunho) {
  await garantirTabelasSubstituicaoDevolucao();
  return calcularSaldoDisponivelParaDevolucao({
    compraId,
    origemDevolucaoId,
    rascunho,
    itensSolicitados: [],
    carregarSaldos: carregarSaldosDevolucaoCompra
  });
}

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug/nfe-devolucao');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo || ''), 'utf8');
}

function registrarDiagnosticoEmissao(compraId, dados = {}) {
  const seguro = {
    em: new Date().toISOString(),
    compraId: Number(compraId) || null,
    notaId: dados.notaId || null,
    numero: dados.numero || null,
    serie: dados.serie || null,
    chave: dados.chave || null,
    ambiente: dados.ambiente != null ? dados.ambiente : null,
    servico: dados.servico || 'NFeAutorizacao4',
    status: dados.status || null,
    classeResultado: dados.classeResultado || null,
    cStat: dados.cStat || null,
    xMotivo: dados.xMotivo || null,
    nRec: dados.nRec || dados.recibo || null,
    protocolo: dados.protocolo || null,
    etapa: dados.etapa || null,
    erroTecnico: dados.erroTecnico ? String(dados.erroTecnico).slice(0, 500) : null,
    stack: dados.stack ? String(dados.stack).split('\n').slice(0, 8).join('\n') : null
  };
  salvarDebug(`${compraId || 'x'}-diagnostico-emissao.json`, JSON.stringify(seguro, null, 2));
}

async function garantirTabelas() {
  return new Promise((resolve, reject) => {
    db().run(`
      CREATE TABLE IF NOT EXISTS nfe_devolucoes_compra (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER NOT NULL,
        numero INTEGER,
        serie INTEGER,
        chave_acesso TEXT,
        chave_referenciada TEXT,
        protocolo TEXT,
        ambiente INTEGER,
        status TEXT,
        natureza_operacao TEXT,
        cfop TEXT,
        xml_enviado TEXT,
        xml_retorno TEXT,
        danfe_html TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) return reject(err);
      const alters = [
        `ALTER TABLE nfe_devolucoes_compra ADD COLUMN chave_referenciada TEXT`,
        `ALTER TABLE nfe_devolucoes_compra ADD COLUMN natureza_operacao TEXT`,
        `ALTER TABLE nfe_devolucoes_compra ADD COLUMN cfop TEXT`,
        `ALTER TABLE nfe_devolucoes_compra ADD COLUMN danfe_html TEXT`
      ];
      let i = 0;
      const next = () => {
        if (i >= alters.length) {
          return garantirSchemaLifecycle().then(resolve).catch(reject);
        }
        db().run(alters[i++], () => next());
      };
      next();
    });
  });
}

function obterNotaAutorizadaPorCompra(compraId) {
  return new Promise((resolve, reject) => {
    db().get(`
      SELECT * FROM nfe_devolucoes_compra
      WHERE compra_id = ? AND status = 'autorizada'
      ORDER BY id DESC LIMIT 1
    `, [compraId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function obterNotaEmAndamento(compraId) {
  return new Promise((resolve, reject) => {
    db().get(`
      SELECT * FROM nfe_devolucoes_compra
      WHERE compra_id = ? AND status IN (
        'pendente','soap_enviado','enviada','aguardando_retorno',
        'lote_enviado','enviando','assinando','validando','processando'
      )
      ORDER BY id DESC LIMIT 1
    `, [compraId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function obterUltimaNotaPorCompra(compraId) {
  return new Promise((resolve, reject) => {
    db().get(`
      SELECT * FROM nfe_devolucoes_compra
      WHERE compra_id = ?
      ORDER BY id DESC LIMIT 1
    `, [compraId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function anexarClassificacao(resultado) {
  const cls = classificarResultadoEmissaoNfe(resultado);
  resultado.classeResultado = cls.classe;
  if (resultado.cStat == null && cls.cStat) resultado.cStat = cls.cStat;
  if (resultado.xMotivo == null && cls.xMotivo) resultado.xMotivo = cls.xMotivo;
  return resultado;
}

function modeloDaChaveNfe(chave) {
  const d = onlyDigits(chave);
  return d.length === 44 ? d.slice(20, 22) : '';
}

function avaliarValidacaoNfeOrigemDevolucao({
  compra,
  chave,
  saldos,
  fonteXml,
  espelhamentoOk
} = {}) {
  const erros = [];
  if (!compra) {
    erros.push({ codigo: 'INEXISTENTE', mensagem: 'NF-e inexistente.' });
    return { ok: false, erros };
  }
  const d = onlyDigits(chave || compra.chave_acesso);
  if (d.length !== 44) {
    erros.push({ codigo: 'CHAVE_INVALIDA', mensagem: 'Chave de acesso inválida.' });
  }
  const modelo = String(compra.modelo_nf || modeloDaChaveNfe(d) || '')
    .replace(/\D/g, '')
    .padStart(2, '0')
    .slice(-2);
  if (d.length === 44 && modelo && modelo !== '55') {
    erros.push({
      codigo: 'MODELO',
      mensagem: 'Somente NF-e modelo 55 pode ser utilizada para devolução.'
    });
  }
  const cancelada = String(compra.status || '').toLowerCase() === 'cancelada'
    || Boolean(saldos && saldos.compraCancelada);
  if (cancelada) {
    erros.push({
      codigo: 'CANCELADA',
      mensagem: 'Esta NF-e está cancelada e não pode ser utilizada para devolução.'
    });
  }
  if (saldos && Number(saldos.totais && saldos.totais.saldo) <= 0) {
    erros.push({
      codigo: 'SEM_PRODUTOS',
      mensagem: 'Não há produtos disponíveis para devolução nesta NF-e.'
    });
  }
  if (espelhamentoOk === false && !fonteXml) {
    erros.push({
      codigo: 'XML',
      mensagem: 'XML da NF-e original não está disponível.'
    });
  }
  return { ok: erros.length === 0, erros };
}

function listarOrigensNfeDevolucaoCompra(filtros = {}) {
  const chave = onlyDigits(filtros.chave);
  const numero = String(filtros.numero || '').trim();
  const serie = String(filtros.serie || '').trim();
  const fornecedor = String(filtros.fornecedor || '').trim();
  const data = String(filtros.data || '').trim();
  const compraId = Number(filtros.compraId || filtros.compra || 0);

  let sql = `
    SELECT
      c.id,
      c.numero_nf,
      c.serie_nf,
      c.modelo_nf,
      c.chave_acesso,
      c.data_emissao,
      c.data_compra,
      c.fornecedor,
      c.fornecedor_cnpj,
      c.valor_total_nota,
      c.total,
      c.status
    FROM compras c
    WHERE 1=1
  `;
  const params = [];
  if (compraId > 0) {
    sql += ' AND c.id = ?';
    params.push(compraId);
  }
  if (chave) {
    sql += ' AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.chave_acesso,\'\'),\'.\',\'\'),\'/\',\'\'),\'-\',\'\'),\' \',\'\') LIKE ?';
    params.push(`%${chave}%`);
  }
  if (numero) {
    sql += ' AND CAST(c.numero_nf AS TEXT) LIKE ?';
    params.push(`%${numero}%`);
  }
  if (serie) {
    sql += ' AND CAST(c.serie_nf AS TEXT) LIKE ?';
    params.push(`%${serie}%`);
  }
  if (fornecedor) {
    sql += ' AND (c.fornecedor LIKE ? OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.fornecedor_cnpj,\'\'),\'.\',\'\'),\'/\',\'\'),\'-\',\'\'),\' \',\'\') LIKE ?)';
    const like = `%${fornecedor}%`;
    params.push(like, `%${onlyDigits(fornecedor) || fornecedor}%`);
  }
  if (data) {
    sql += ' AND (date(c.data_emissao) = date(?) OR date(c.data_compra) = date(?))';
    params.push(data, data);
  }
  sql += ' ORDER BY c.data_compra DESC, c.id DESC LIMIT 80';

  return new Promise((resolve, reject) => {
    db().all(sql, params, (err, rows) => {
      if (err) return reject(err);
      const origens = (rows || []).map((r) => {
        const ch = onlyDigits(r.chave_acesso);
        const st = String(r.status || '').toLowerCase();
        const modelo = String(r.modelo_nf || modeloDaChaveNfe(ch) || '').replace(/\D/g, '');
        return {
          compraId: r.id,
          numero: r.numero_nf,
          serie: r.serie_nf,
          modelo: modelo || r.modelo_nf,
          data: r.data_emissao || r.data_compra,
          fornecedor: r.fornecedor,
          valor: r.valor_total_nota != null ? r.valor_total_nota : r.total,
          status: st === 'cancelada' ? 'Cancelada' : 'Autorizada',
          status_raw: r.status,
          chave_acesso: ch
        };
      });
      resolve(origens);
    });
  });
}

function carregarCompraCabecalho(compraId) {
  return new Promise((resolve, reject) => {
    db().get(`
      SELECT c.*,
        f.id AS fornecedor_id,
        f.rua, f.numero, f.bairro, f.cidade, f.uf, f.cep, f.inscricao_estadual,
        f.codigo_municipio,
        f.cpf_cnpj AS fornecedor_doc_cadastro
      FROM compras c
      LEFT JOIN fornecedores f
        ON REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(f.cpf_cnpj,''),'.',''),'/',''),'-',''),' ','') =
           REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.fornecedor_cnpj,''),'.',''),'/',''),'-',''),' ','')
      WHERE c.id = ?
    `, [compraId], (err, compra) => {
      if (err) return reject(err);
      if (!compra) {
        return reject(Object.assign(new Error('Compra não encontrada.'), {
          code: 'COMPRA_NAO_ENCONTRADA',
          statusCode: 404
        }));
      }
      resolve(compra);
    });
  });
}

function persistirCodigoMunicipioFornecedor(compra) {
  const cMun = resolverMunicipioDestinatario({
    cidade: compra.cidade,
    uf: compra.uf,
    codigoMunicipio: compra.codigo_municipio
  });
  if (cMun) compra.codigo_municipio = cMun;
  const fornecedorId = Number(compra.fornecedor_id);
  if (!cMun || !fornecedorId) return Promise.resolve(cMun);
  return new Promise((resolve) => {
    db().run(
      'UPDATE fornecedores SET codigo_municipio = ? WHERE id = ?',
      [cMun, fornecedorId],
      () => resolve(cMun)
    );
  });
}

function carregarItensCompra(compraId) {
  return new Promise((resolve, reject) => {
    db().all(`
      SELECT
        ci.*,
        p.nome AS produto_nome,
        p.codigo AS produto_codigo,
        p.codigo_barras AS produto_codigo_barras,
        p.ncm AS produto_ncm,
        p.unidade AS produto_unidade,
        p.csosn AS produto_csosn,
        COALESCE((
          SELECT SUM(cd.quantidade)
          FROM compras_devolucoes cd
          WHERE cd.compra_item_id = ci.id
        ), 0) AS quantidade_devolvida
      FROM compras_itens ci
      LEFT JOIN produtos p ON p.id = ci.produto_id
      WHERE ci.compra_id = ?
      ORDER BY ci.id
    `, [compraId], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function carregarItensDevolucaoInterna(compraId) {
  return new Promise((resolve, reject) => {
    db().all(`
      SELECT
        cd.*,
        ci.descricao_produto,
        ci.codigo_barras,
        ci.ncm,
        ci.unidade,
        ci.preco_unitario,
        ci.custo_unitario_final,
        p.nome AS produto_nome,
        p.codigo AS produto_codigo,
        p.codigo_barras AS produto_codigo_barras,
        p.ncm AS produto_ncm,
        p.unidade AS produto_unidade,
        p.csosn AS produto_csosn
      FROM compras_devolucoes cd
      INNER JOIN compras_itens ci ON ci.id = cd.compra_item_id
      LEFT JOIN produtos p ON p.id = cd.produto_id
      WHERE cd.compra_id = ?
      ORDER BY cd.id
    `, [compraId], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function mapearTributosItem(compra, item) {
  const raw = String(item.csosn || item.produto_csosn || compra.csosn_cst_xml || compra.csosn_cst || '').trim();
  const digits = raw.replace(/\D/g, '');
  return {
    csosn: digits.length === 3 ? digits : '',
    cst: digits.length === 2 ? digits : String(compra.csosn_cst || '').replace(/\D/g, '').slice(0, 2),
    origem: item.origem != null && item.origem !== '' ? item.origem : 0,
    cst_pis: compra.cst_pis_xml || compra.cst_pis || '',
    cst_cofins: compra.cst_cofins_xml || compra.cst_cofins || '',
    cst_ipi: compra.cst_ipi_xml || compra.cst_ipi || ''
  };
}

function sugerirCfop(compra, config) {
  const ufEmpresa = String(config?.uf || '').toUpperCase();
  const ufForn = String(compra.uf || '').toUpperCase();
  return ufEmpresa && ufForn && ufEmpresa !== ufForn ? '6202' : '5202';
}

const CFOP_DESCRICOES_DEVOLUCAO = Object.freeze({
  '1202': 'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
  '1411': 'Devolução de mercadoria adquirida ou recebida de terceiros em operação com ST',
  '2202': 'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
  '2411': 'Devolução de mercadoria adquirida ou recebida de terceiros em operação com ST',
  '5201': 'Devolução de compra para industrialização',
  '5202': 'Devolução de compra para comercialização',
  '5411': 'Devolução de compra para comercialização em operação com ST',
  '6201': 'Devolução de compra para industrialização',
  '6202': 'Devolução de compra para comercialização',
  '6411': 'Devolução de compra para comercialização em operação com ST'
});

function descricaoCfopDevolucao(cfop) {
  const d = onlyDigits(cfop).slice(0, 4);
  if (!d) return '';
  const desc = CFOP_DESCRICOES_DEVOLUCAO[d];
  const fmt = d.length === 4 ? `${d[0]}.${d.slice(1)}` : d;
  return desc ? `${fmt} — ${desc}` : `${fmt} — CFOP informado`;
}

function round2prev(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Monta XML da devolução (espelhamento + totais oficiais) sem numerar, assinar ou transmitir.
 * @param {object} opts
 * @param {boolean} [opts.reservarNumero] — só a emissão real deve consumir o sequencial.
 */
async function montarDocumentoXmlDevolucaoCompra(compraId, opcoes = {}) {
  await garantirTabelas();
  await garantirTabelasSaldoDevolucao();
  const id = Number(compraId);

  const compra = await carregarCompraCabecalho(id);
  await persistirCodigoMunicipioFornecedor(compra);
  if (String(compra.status || '').toLowerCase() === 'cancelada') {
    throw Object.assign(new Error('Compra cancelada — não é possível emitir NF-e de devolução.'), {
      code: 'COMPRA_CANCELADA',
      statusCode: 400
    });
  }
  if (opcoes.refNFe) {
    compra.chave_acesso = onlyDigits(opcoes.refNFe);
  }
  const refNFe = onlyDigits(compra.chave_acesso);
  if (refNFe.length !== 44) {
    throw Object.assign(
      new Error('Compra sem chave da NF-e original (44 dígitos).'),
      { code: 'REF_NFE_INVALIDA', statusCode: 400 }
    );
  }

  const config = opcoes.fiscalConfig || await getFiscalConfig();
  config.serie = Number(config.serieNfe || config.serie || 1);

  const rascunho = await obterRascunhoDevolucaoCompra(id);
  const cfopPadrao = onlyDigits(opcoes.cfop || (rascunho && rascunho.cfop) || sugerirCfop(compra, config)).slice(0, 4)
    || sugerirCfop(compra, config);

  const contexto210240 = await resolverContextoSubstituicao210240({
    compraId: id,
    origemDevolucaoId: opcoes.origemNfeDevolucaoId
      || (rascunho && (rascunho.origem_nfe_devolucao_id || rascunho.documento_original_id))
      || null,
    rascunho,
    chaveAnterior: opcoes.chaveAnterior
  });
  trace210240('emissao_inicio', {
    compraId: id,
    rascunhoId: rascunho && rascunho.id,
    origemNfeDevolucaoId: contexto210240.origemDevolucaoId,
    documento_original_id: rascunho && rascunho.documento_original_id,
    substituicaoId: contexto210240.substituicaoId,
    chaveNFAnterior: contexto210240.chaveAnterior,
    evento210240: contexto210240.ativo,
    origemResolvida: contexto210240.fonte
  });

  // Reconciliação SEFAZ antes do saldo — NF cancelada externamente não pode bloquear nova devolução
  if (opcoes.pularReconciliacaoSefaz !== true) {
    try {
      const {
        reconciliarDevolucoesCompraComSefaz
      } = require('./nfeDevolucaoLifecycleService');
      await reconciliarDevolucoesCompraComSefaz(id, {
        origem: 'emissao',
        forcar: opcoes.forcarReconciliacaoSefaz === true,
        usuarioId: opcoes.usuarioId || opcoes.usuario_id || null,
        usuarioNome: opcoes.usuarioNome || opcoes.usuario_nome || null,
        consultarProtocolo: opcoes.consultarProtocolo,
        getFiscalConfig: opcoes.getFiscalConfig
      });
    } catch (reconErr) {
      // Não bloqueia a emissão por falha de consulta; saldo usa status local atual
      try {
        // eslint-disable-next-line no-console
        console.warn(
          '[DEVOLUCAO][RECONCILIACAO_SEFAZ] falha na reconciliação pré-emissão:',
          reconErr.message || reconErr
        );
      } catch (_) { /* ignore */ }
    }
  }

  const origemDev = contexto210240.origemDevolucaoId
    || opcoes.origemNfeDevolucaoId
    || (rascunho && (rascunho.origem_nfe_devolucao_id || rascunho.documento_original_id))
    || null;
  const pularSaldo = opcoes.pularValidacaoSaldo === true;

  let itens;
  if (Array.isArray(opcoes.itens) && opcoes.itens.length) {
    const itensCompra = await carregarItensCompra(id);
    itens = resolverItensDoBody(compra, itensCompra, opcoes.itens, cfopPadrao);
  } else if (rascunho && Array.isArray(rascunho.itens) && rascunho.itens.length) {
    const itensCompra = await carregarItensCompra(id);
    itens = resolverItensDoBody(compra, itensCompra, rascunho.itens, cfopPadrao);
    if (opcoes.observacoes == null && rascunho.observacoes) opcoes.observacoes = rascunho.observacoes;
  }

  const calculo = await calcularSaldoDisponivelParaDevolucao({
    compraId: id,
    origemDevolucaoId: origemDev,
    rascunho,
    itensSolicitados: (itens || []).filter((i) => Number(i.quantidade) > 0),
    carregarSaldos: carregarSaldosDevolucaoCompra
  });
  const { saldos, saldosNormais, excecao } = calculo;
  if (!pularSaldo && Number(calculo.saldoDisponivel || 0) <= 0 && !(excecao && excecao.aplicar && excecao.quantidadeRestante > 0)) {
    throw Object.assign(
      new Error('Compra totalmente devolvida — não há saldo disponível para nova NF-e.'),
      { code: 'SALDO_ZERADO', statusCode: 400 }
    );
  }

  if (!itens) {
    itens = saldos.itens
      .filter((s) => s.saldo > 0)
      .map((s) => {
        const trib = mapearTributosItem(compra, s);
        return {
          compra_item_id: s.compra_item_id,
          id: s.compra_item_id,
          produto_id: s.produto_id,
          produto_nome: s.produto_nome,
          produto_codigo: s.produto_codigo,
          ncm: s.ncm,
          unidade: s.unidade,
          quantidade: s.saldo,
          valor_unitario: s.valor_unitario,
          cfop: cfopPadrao,
          ...trib
        };
      });
  }
  if (!itens.length || !itens.some((i) => Number(i.quantidade) > 0)) {
    throw Object.assign(
      new Error('Quantidades inválidas para emissão da NF-e de devolução.'),
      { code: 'QTD_INVALIDA', statusCode: 400 }
    );
  }

  const itensAtivos = itens.filter((i) => Number(i.quantidade) > 0);
  if (itensAtivos.length && !calculo.itens.length) {
    await calcularSaldoDisponivelParaDevolucao({
      compraId: id,
      origemDevolucaoId: origemDev || (excecao && excecao.devolucaoAnteriorId),
      rascunho,
      itensSolicitados: itensAtivos,
      carregarSaldos: carregarSaldosDevolucaoCompra
    }).catch(() => {});
  }
  const bloqueadosCalculo = (calculo.itens || []).filter((i) => i.resultado === 'BLOQUEADO');
  const validacaoSaldo = validarQuantidadesContraSaldo({
    saldos,
    itensSolicitados: itensAtivos.map((i) => ({
      compra_item_id: i.compra_item_id || i.id,
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      produto_nome: i.produto_nome
    })),
    compraCancelada: saldos.compraCancelada,
    excecaoSubstituicao: excecao
  });
  if (!pularSaldo && (bloqueadosCalculo.length || !validacaoSaldo.ok)) {
    throw Object.assign(
      new Error(validacaoSaldo.erros.join(' | ')),
      { code: 'SALDO_INSUFICIENTE', statusCode: 400, erros: validacaoSaldo.erros }
    );
  }
  if (excecao && excecao.aplicar) {
    await registrarAuditoriaExcecaoSaldo({
      substituicaoId: (await obterSubstituicaoPorAnterior(excecao.devolucaoAnteriorId))?.id,
      excecao,
      saldosNormais,
      saldosExcecao: saldos,
      itensSolicitados: itensAtivos.map((i) => ({
        compra_item_id: i.compra_item_id || i.id,
        quantidade: i.quantidade
      })),
      usuarioId: opcoes.usuarioId,
      usuarioNome: opcoes.usuarioNome
    }).catch(() => {});
  }

  if (opcoes.pararAposValidacaoSaldo === true) {
    return {
      id,
      compra,
      config,
      cfopPadrao,
      refNFe,
      saldos,
      saldosNormais,
      excecao,
      contexto210240,
      rascunho,
      itensAtivos,
      calculo,
      validacaoSaldo,
      espelhamento: { ok: true, itens: itensAtivos },
      numero: Number(opcoes.numeroPreview || 1),
      built: { xmlSemAssinatura: '', infCpl: opcoes.observacoes || null }
    };
  }

  const espelhamento = opcoes.pularEspelhamento === true
    ? { ok: true, itens: itensAtivos, fonteXml: 'teste' }
    : await espelharTributosNfeDevolucaoCompra({
    compraId: id,
    chave: refNFe,
    itens: itensAtivos,
    cfopPadrao,
    exigirXml: true
  });
  const validacaoEsp = opcoes.pularEspelhamento === true
    ? { ok: true, erros: [] }
    : validarEspelhamentoAntesTransmissao(espelhamento, espelhamento.itens);
  if (!validacaoEsp.ok) {
    throw Object.assign(
      new Error(`Inconsistência fiscal: ${validacaoEsp.erros.join(' | ')}`),
      { code: 'VALIDACAO_FISCAL', statusCode: 400, erros: validacaoEsp.erros }
    );
  }

  espelhamento.itens = (espelhamento.itens || []).map((item) =>
    adaptarImpostoEspelhadoAoCrt(item, config.crt)
  );

  const numero = opcoes.reservarNumero
    ? await proximoNumeroNFeVenda()
    : Number(opcoes.numeroPreview || 1);
  const built = buildXmlNFeDevolucaoCompra({
    config,
    compra,
    itens: espelhamento.itens,
    numero,
    observacoes: opcoes.observacoes,
    cfopOverride: cfopPadrao
  });

  salvarDebug(`${id}-01-original.xml`, built.xmlSemAssinatura);
  if (built.diagnosticoIpiDevol) {
    salvarDebug(`${id}-diagnostico-ipi-devol.json`, JSON.stringify(built.diagnosticoIpiDevol, null, 2));
  }
  salvarDebug(`${id}-resolucao-icms-crt.json`, JSON.stringify({
    geradoEm: new Date().toISOString(),
    processo: {
      resolver: require.resolve('./resolverIcmsCrtEmitente'),
      builder: require.resolve('./xmlBuilderNfeDevolucaoCompra'),
      pid: process.pid,
      execPath: process.execPath
    },
    crtEmitente: String(config.crt),
    reservarNumero: Boolean(opcoes.reservarNumero),
    transmitido: false,
    itens: built.resolucaoIcms || []
  }, null, 2));

  return {
    id,
    compra,
    config,
    cfopPadrao,
    refNFe,
    saldos,
    saldosNormais,
    excecao,
    contexto210240,
    rascunho,
    calculo,
    itensAtivos,
    espelhamento,
    numero,
    built
  };
}

function montarResumoPreviaDevolucao({ built, compra, itensEspelhados, observacoes, cfop }) {
  const totaisXml = extrairTotais(built.xmlSemAssinatura || '');
  const itens = (itensEspelhados || [])
    .filter((i) => Number(i.quantidade) > 0)
    .map((i) => {
      const qtd = Number(i.quantidade || 0);
      const vu = Number(i.valor_unitario || 0);
      const desc = round2prev(i.vDesc != null ? i.vDesc : i.v_desc);
      const total = round2prev(i.vProd != null ? i.vProd : (qtd * vu));
      return {
        codigo: i.produto_codigo || i.cProd || i.produto_id || '',
        produto: i.produto_nome || i.descricao_produto || i.xProd || '',
        unidade: i.unidade || i.produto_unidade || 'UN',
        quantidade: qtd,
        valor_unitario: round2prev(vu),
        desconto: desc,
        total
      };
    });

  return {
    emitido: false,
    transmitido: false,
    natureza: built.natOp || 'DEVOLUCAO DE COMPRA',
    finNFe: 4,
    cfop: onlyDigits(cfop || built.cfop).slice(0, 4),
    cfopDescricao: descricaoCfopDevolucao(cfop || built.cfop),
    chaveOriginal: built.refNFe,
    modelo: '55',
    serie: built.serie,
    numero: built.numero != null ? built.numero : null,
    statusPrevia: 'Pronta para emissão',
    destinatario: {
      nome: compra.fornecedor || '',
      cnpj: onlyDigits(compra.fornecedor_cnpj || compra.fornecedor_doc_cadastro || compra.cnpj || ''),
      ie: compra.inscricao_estadual || '',
      logradouro: compra.rua || '',
      numero: compra.numero || '',
      bairro: compra.bairro || '',
      municipio: compra.cidade || '',
      uf: compra.uf || '',
      cep: compra.cep || '',
      cMun: compra.codigo_municipio || ''
    },
    fornecedor: compra.fornecedor || '',
    cnpj: onlyDigits(compra.fornecedor_cnpj || compra.fornecedor_doc_cadastro || compra.cnpj || ''),
    observacoes: observacoes || '',
    itens,
    totais: {
      vProd: totaisXml.vProd,
      vDesc: totaisXml.vDesc,
      vFrete: totaisXml.vFrete,
      vSeg: totaisXml.vSeg,
      vOutro: totaisXml.vOutro,
      vIPI: totaisXml.vIPI,
      vIPIDevol: totaisXml.vIPIDevol,
      vST: totaisXml.vST,
      vFCPST: totaisXml.vFCPST,
      vNF: totaisXml.vNF
    },
    tributos: {
      vICMS: totaisXml.vICMS || 0,
      vST: totaisXml.vST || 0,
      vFCPST: totaisXml.vFCPST || 0,
      vIPI: totaisXml.vIPI || 0,
      vIPIDevol: totaisXml.vIPIDevol || 0,
      vPIS: totaisXml.vPIS || 0,
      vCOFINS: totaisXml.vCOFINS || 0,
      pisCofinsInformativos: true
    }
  };
}

/**
 * Prévia da NF-e de devolução: mesmos totais do XML, sem emitir/transmitir/alterar saldo.
 */
async function previaNfeDevolucaoCompra(compraId, opcoes = {}) {
  const { obterProximaNumeracaoFiscal } = require('./numeracaoFiscalService');
  const cfgPeek = await getFiscalConfig({ validarUrls: false });
  cfgPeek.serie = Number(cfgPeek.serieNfe || cfgPeek.serie || 1);
  const peek = await obterProximaNumeracaoFiscal({
    cnpj: cfgPeek.cnpj,
    ambiente: cfgPeek.ambiente,
    modelo: '55',
    serie: cfgPeek.serie
  });
  const rascunhoPrevia = await obterRascunhoDevolucaoCompra(Number(compraId));
  const montado = await montarDocumentoXmlDevolucaoCompra(compraId, {
    ...opcoes,
    reservarNumero: false,
    numeroPreview: peek.numero,
    pularValidacaoSaldo: opcoes.pularValidacaoSaldo === true
  });
  const previa = montarResumoPreviaDevolucao({
    built: montado.built,
    compra: montado.compra,
    itensEspelhados: montado.espelhamento.itens,
    observacoes: opcoes.observacoes,
    cfop: montado.cfopPadrao
  });
  previa.modelo = '55';
  previa.serie = peek.serie;
  previa.numero = peek.numero;
  previa.statusPrevia = 'Pronta para emissão';
  const auditoria = auditarNfe({
    tipoDocumento: 'DEVOLUCAO_COMPRA',
    emitente: { cnpj: montado.config.cnpj },
    itens: montado.espelhamento.itens,
    xml: montado.built.xmlSemAssinatura,
    contexto: {
      compraId: Number(compraId),
      nfeNumero: montado.numero,
      debugPrefix: String(compraId),
      fase: 'pre_numeracao'
    }
  });
  return {
    success: true,
    ...previa,
    auditoria: {
      aprovado: auditoria.aprovado,
      resumo: auditoria.resumo,
      erros: auditoria.erros,
      avisos: auditoria.avisos
    }
  };
}

/**
 * Pré-preenchimento para a Central NF-e modo DEVOLUÇÃO (RC3: saldo por item).
 */
async function prepararNfeDevolucaoCompra(compraId) {
  await garantirTabelas();
  await garantirTabelasSaldoDevolucao();
  const id = Number(compraId);
  const compra = await carregarCompraCabecalho(id);
  const config = await getFiscalConfig();
  const chave = onlyDigits(compra.chave_acesso);
  const cfopSugerido = sugerirCfop(compra, config);

  await garantirTabelasSubstituicaoDevolucao();
  const rascunhoPre = await obterRascunhoDevolucaoCompra(id);
  const { saldos, saldosNormais, excecao } = await carregarSaldosComExcecao210240(
    id,
    rascunhoPre && (rascunhoPre.origem_nfe_devolucao_id || rascunhoPre.documento_original_id),
    rascunhoPre
  );
  const notas = await listarNotasDevolucaoCompra(id);

  const itensComSaldo = saldos.itens
    .filter((s) => s.saldo > 0)
    .map((s) => {
      const trib = mapearTributosItem(compra, s);
      return {
        compra_item_id: s.compra_item_id,
        produto_id: s.produto_id,
        produto_nome: s.produto_nome,
        produto_codigo: s.produto_codigo,
        ncm: s.ncm,
        unidade: s.unidade,
        quantidade: s.saldo,
        quantidade_maxima: s.saldo,
        quantidade_comprada: s.quantidade_comprada,
        quantidade_devolvida: s.quantidade_devolvida,
        saldo: s.saldo,
        status_saldo: s.status,
        status_ui: s.status_ui,
        valor_unitario: s.valor_unitario,
        cfop: cfopSugerido,
        editavel_quantidade: true,
        bloqueado_tributos: true,
        ...trib
      };
    });

  let espelhamento = null;
  let itensFinais = itensComSaldo;
  let motivoEspelhamento = null;

  if (chave.length === 44 && itensComSaldo.length) {
    try {
      espelhamento = await espelharTributosNfeDevolucaoCompra({
        compraId: id,
        chave,
        itens: itensComSaldo,
        cfopPadrao: cfopSugerido,
        exigirXml: false
      });
      if (espelhamento.ok) {
        itensFinais = espelhamento.itens.map((it) => {
          const saldoInfo = saldos.itens.find((s) => Number(s.compra_item_id) === Number(it.compra_item_id));
          return {
            ...it,
            quantidade_comprada: saldoInfo?.quantidade_comprada,
            quantidade_devolvida: saldoInfo?.quantidade_devolvida,
            saldo: saldoInfo?.saldo,
            quantidade_maxima: saldoInfo?.saldo,
            status_saldo: saldoInfo?.status,
            status_ui: saldoInfo?.status_ui
          };
        });
      } else {
        motivoEspelhamento = espelhamento.erro?.message
          || 'XML da NF-e original não encontrado para espelhamento fiscal.';
      }
    } catch (espErr) {
      motivoEspelhamento = espErr.message;
      espelhamento = { ok: false, erro: espErr };
    }
  }

  const compraCancelada = saldos.compraCancelada;
  const semSaldo = saldos.totais.saldo <= 0;
  const espelhamentoOk = Boolean(espelhamento?.ok) || !itensComSaldo.length;
  const podeEmitir = chave.length === 44
    && !compraCancelada
    && !semSaldo
    && itensFinais.length > 0
    && Boolean(espelhamento?.ok);

  let motivoBloqueio = null;
  if (!chave || chave.length !== 44) motivoBloqueio = 'Compra sem chave da NF-e (44 dígitos).';
  else if (compraCancelada) motivoBloqueio = 'Compra cancelada.';
  else if (semSaldo) motivoBloqueio = 'Compra totalmente devolvida — saldo zerado.';
  else if (!itensFinais.length) motivoBloqueio = 'Nenhum item com saldo disponível para devolução.';
  else if (!espelhamento?.ok) motivoBloqueio = motivoEspelhamento || 'Espelhamento fiscal da NF-e original indisponível.';

  const rascunho = await obterRascunhoDevolucaoCompra(id);
  if (rascunho && Array.isArray(rascunho.itens) && rascunho.itens.length) {
    const mapaSaldo = new Map((saldos.itens || []).map((s) => [Number(s.compra_item_id), s]));
    const mapaEmit = new Map((itensFinais || []).map((i) => [Number(i.compra_item_id), i]));
    itensFinais = rascunho.itens.map((r) => {
      const s = mapaSaldo.get(Number(r.compra_item_id)) || {};
      const e = mapaEmit.get(Number(r.compra_item_id)) || {};
      const trib = mapearTributosItem(compra, { ...s, ...e, ...r });
      return {
        ...s,
        ...e,
        ...trib,
        ...r,
        compra_item_id: Number(r.compra_item_id),
        quantidade: Number(r.quantidade),
        quantidade_maxima: Number(
          s.saldo > 0 ? s.saldo : (s.quantidade_comprada || r.quantidade || 0)
        ),
        valor_unitario: r.valor_unitario != null ? Number(r.valor_unitario) : Number(e.valor_unitario || s.valor_unitario || 0),
        n_item_origem: r.n_item_origem || e.nItemOrigem || null,
        editavel_rascunho: true
      };
    });
  }
  const validacaoOrigem = avaliarValidacaoNfeOrigemDevolucao({
    compra,
    chave,
    saldos,
    fonteXml: espelhamento?.fonteXml || null,
    espelhamentoOk: Boolean(espelhamento?.ok)
  });

  const itensPainel = saldos.itens.map((s) => {
    const emitivel = itensFinais.find((it) => Number(it.compra_item_id) === Number(s.compra_item_id));
    const trib = mapearTributosItem(compra, s);
    return {
      compra_item_id: s.compra_item_id,
      produto_id: s.produto_id,
      produto_nome: s.produto_nome,
      produto_codigo: s.produto_codigo,
      ncm: emitivel?.ncm || s.ncm,
      unidade: emitivel?.unidade || s.unidade,
      cfop_origem: emitivel?.cfop_original || emitivel?.cfop || s.cfop,
      cst: emitivel?.cst || trib.cst,
      csosn: emitivel?.csosn || trib.csosn,
      valor_unitario: emitivel?.valor_unitario != null ? emitivel.valor_unitario : s.valor_unitario,
      quantidade_comprada: s.quantidade_comprada,
      quantidade_devolvida: s.quantidade_devolvida,
      saldo: s.saldo,
      status_saldo: s.status,
      status_ui: s.status_ui,
      tributosEspelhados: emitivel?.tributosEspelhados || null
    };
  });

  const enderecoParts = [compra.rua, compra.numero, compra.bairro].filter(Boolean);

  return {
    tipoDocumento: 'DEVOLUCAO',
    finNFe: 4,
    origem: 'COMPRA',
    compraId: id,
    refNFe: chave,
    podeEmitir,
    motivoBloqueio,
    validacaoOrigem,
    naturezaOperacao: 'DEVOLUÇÃO DE COMPRA',
    compra: {
      id: compra.id,
      fornecedor: compra.fornecedor,
      fornecedor_cnpj: compra.fornecedor_cnpj || compra.fornecedor_doc_cadastro,
      fornecedor_ie: compra.inscricao_estadual || '',
      fornecedor_endereco: enderecoParts.join(', '),
      fornecedor_municipio: compra.cidade || '',
      fornecedor_uf: compra.uf || '',
      fornecedor_cep: compra.cep || '',
      fornecedor_completo: {
        razao_social: compra.fornecedor,
        cnpj: compra.fornecedor_cnpj || compra.fornecedor_doc_cadastro,
        ie: compra.inscricao_estadual || '',
        rua: compra.rua || '',
        numero: compra.numero || '',
        bairro: compra.bairro || '',
        municipio: compra.cidade || '',
        uf: compra.uf || '',
        cep: compra.cep || ''
      },
      total: compra.total,
      valor_total_nota: compra.valor_total_nota != null ? compra.valor_total_nota : compra.total,
      valor_produtos: compra.valor_produtos,
      valor_desconto: compra.valor_desconto,
      valor_frete: compra.valor_frete,
      status: compra.status,
      situacao: String(compra.status || '').toLowerCase() === 'cancelada' ? 'Cancelada' : 'Autorizada',
      chave_acesso: chave,
      numero_nf: compra.numero_nf,
      serie_nf: compra.serie_nf,
      modelo_nf: compra.modelo_nf || modeloDaChaveNfe(chave),
      data_emissao: compra.data_emissao || compra.data_compra,
      csosn_cst: compra.csosn_cst || compra.csosn_cst_xml,
      cst_pis: compra.cst_pis || compra.cst_pis_xml,
      cst_cofins: compra.cst_cofins || compra.cst_cofins_xml,
      cst_ipi: compra.cst_ipi || compra.cst_ipi_xml
    },
    cfopSugerido,
    camposEditaveis: ['quantidade', 'valor_unitario', 'observacoes', 'cfop'],
    camposBloqueados: ['emitente', 'destinatario', 'refNFe', 'cst', 'csosn', 'tributos'],
    itens: itensFinais,
    itensPainel,
    controleSaldo: {
      statusCompra: saldos.statusCompra,
      statusCompraUi: saldos.statusCompraUi,
      totais: saldos.totais,
      saldo_normal: (saldosNormais && saldosNormais.totais) || saldos.totais,
      saldo_excecao: excecao && excecao.aplicar ? saldos.totais : null,
      excecaoSubstituicao: saldos.excecaoSubstituicao || null
    },
    devolucaoRelacionada: montarBlocoDevolucaoRelacionada(excecao),
    tributacaoOriginal: espelhamento?.tributacaoOriginal || null,
    comparacaoFiscal: espelhamento?.comparacaoFiscal || [],
    ajustesFiscais: espelhamento?.ajustes || [],
    fonteXmlOrigem: espelhamento?.fonteXml || null,
    espelhamentoOk: Boolean(espelhamento?.ok),
    nfeDevolucoes: notas.map((n) => {
      const st = String(n.status || '').toLowerCase();
      return {
        id: n.id,
        status: n.status,
        statusUi: uiDoEstado(n.status),
        numero: n.numero,
        serie: n.serie,
        chave_acesso: n.chave_acesso,
        chave_referenciada: n.chave_referenciada || chave,
        protocolo: n.protocolo,
        recibo: n.recibo || null,
        consultado_em: n.consultado_em || null,
        sincronizado_em: n.sincronizado_em || null,
        rejeicao: n.rejeicao_codigo
          ? mensagemRejeicaoDetalhada(n.rejeicao_codigo, n.rejeicao_motivo)
          : null,
        created_at: n.created_at,
        quantidade_total: n.quantidade_total,
        tem_danfe: Boolean(n.tem_danfe),
        tem_danfe_cancelado: Boolean(n.tem_danfe_cancelado),
        tem_xml: Boolean(n.tem_xml),
        itens: n.itens || [],
        acoes: {
          downloadXml: Boolean(n.tem_xml),
          imprimirDanfe: Boolean(n.tem_danfe),
          consultar: Boolean(n.chave_acesso),
          reenviar: podeReenviarDevolucao({
            status: st,
            rejeicao_codigo: n.rejeicao_codigo,
            cstat_retorno: n.cstat_retorno
          }),
          gerarNovaIdentidade: podeGerarNovaIdentidadeDevolucao({
            status: st,
            rejeicao_codigo: n.rejeicao_codigo,
            cstat_retorno: n.cstat_retorno
          }),
          mensagemNovaIdentidade: podeGerarNovaIdentidadeDevolucao({
            status: st,
            rejeicao_codigo: n.rejeicao_codigo,
            cstat_retorno: n.cstat_retorno
          })
            ? mensagemNovaIdentidadeDevolucao({
              rejeicao_codigo: n.rejeicao_codigo,
              cstat_retorno: n.cstat_retorno
            })
            : null,
          cancelar: podeCancelarDevolucao({ status: st })
        }
      };
    }),
    nfeDevolucao: notas.filter((n) => n.status === 'autorizada').slice(-1)[0] || null,
    rascunho
  };
}

function resolverItensDoBody(compra, itensCompra, bodyItens, cfopPadrao) {
  return bodyItens.map((b) => {
    const base = itensCompra.find((i) => Number(i.id) === Number(b.compra_item_id || b.id))
      || itensCompra.find((i) => Number(i.produto_id) === Number(b.produto_id));
    if (!base) {
      throw Object.assign(new Error(`Item da compra não encontrado: ${b.compra_item_id || b.produto_id}`), {
        code: 'ITEM_NAO_ENCONTRADO',
        statusCode: 400
      });
    }
    const trib = mapearTributosItem(compra, base);
    const qtd = Number(b.quantidade);
    if (!(qtd > 0)) {
      throw Object.assign(
        new Error(`Quantidade inválida para o item ${base.produto_nome || base.id}.`),
        { code: 'QTD_INVALIDA', statusCode: 400 }
      );
    }
    return {
      ...base,
      ...trib,
      compra_item_id: base.id,
      quantidade: qtd,
      quantidade_comprada: Number(
        base.quantidade_comprada != null ? base.quantidade_comprada : (base.quantidade || 0)
      ),
      valor_unitario: Number(
        b.valor_unitario != null
          ? b.valor_unitario
          : (base.custo_unitario_final || base.preco_unitario || 0)
      ),
      n_item_origem: Number(b.n_item_origem || b.nItemOrigem || 0) || undefined,
      nItemOrigem: Number(b.n_item_origem || b.nItemOrigem || 0) || undefined,
      vDesc: Number(b.v_desc != null ? b.v_desc : (b.vDesc || 0)) || undefined,
      vFrete: Number(b.v_frete != null ? b.v_frete : (b.vFrete || 0)) || undefined,
      vSeg: Number(b.v_seg != null ? b.v_seg : (b.vSeg || 0)) || undefined,
      vOutro: Number(b.v_outro != null ? b.v_outro : (b.vOutro || 0)) || undefined,
      cfop: onlyDigits(b.cfop || cfopPadrao).slice(0, 4) || cfopPadrao
    };
  });
}

function resolverItensDevolucaoInterna(compra, itensDev, cfopPadrao) {
  return itensDev.map((base) => {
    const trib = mapearTributosItem(compra, base);
    return {
      ...base,
      ...trib,
      quantidade: Number(base.quantidade || 0),
      valor_unitario: Number(base.valor_unitario || base.custo_unitario_final || base.preco_unitario || 0),
      cfop: cfopPadrao
    };
  });
}

function persistirNota(payload) {
  return new Promise((resolve, reject) => {
    db().run(`
      INSERT INTO nfe_devolucoes_compra (
        compra_id, numero, serie, chave_acesso, chave_referenciada, protocolo, ambiente,
        status, natureza_operacao, cfop, xml_enviado, xml_retorno, danfe_html, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      payload.compra_id,
      payload.numero,
      payload.serie,
      payload.chave_acesso,
      payload.chave_referenciada,
      payload.protocolo,
      payload.ambiente,
      payload.status,
      payload.natureza_operacao,
      payload.cfop,
      payload.xml_enviado,
      payload.xml_retorno,
      payload.danfe_html
    ], function onIns(err) {
      if (err) return reject(err);
      const id = this.lastID;
      const parsed = payload.chave_acesso
        ? require('./nfeIdentityService').parseChaveNfe(payload.chave_acesso)
        : null;
      db().run(
        `UPDATE nfe_devolucoes_compra
         SET xml_hash = ?, xml_assinado_hash = ?, cnf = ?, tp_emis = ?, identidade_congelada = 1
         WHERE id = ?`,
        [
          payload.xml_hash || null,
          payload.xml_assinado_hash || null,
          (parsed && parsed.cNF) || payload.cnf || null,
          (parsed && parsed.tpEmis) || '1',
          id
        ],
        () => resolve(id)
      );
    });
  });
}

/**
 * Emite NF-e de devolução via pipeline oficial (sign → validate → SEFAZ → parse).
 * @param {number} compraId
 * @param {object} [opcoes]
 */
async function emitirNFeDevolucaoCompra(compraId, opcoes = {}) {
  const { traceNfe } = require('./nfeTrace');
  traceNfe('emitirNFeDevolucaoCompra', {
    compraId,
    tipoDocumento: 'DEVOLUCAO',
    origem: 'COMPRA',
    arquivo: __filename
  });

  if (!opcoes.forcarEmissaoTeste && !configService.recursoHabilitado('nfe')) {
    return {
      success: false,
      status: 'modulo_desabilitado',
      message: 'Módulo NF-e desabilitado na implantação.'
    };
  }

  await garantirTabelas();
  await garantirTabelasSaldoDevolucao();
  const id = Number(compraId);
  let lockToken;
  try {
    lockToken = adquirirLock(`devolucao-compra:${id}`);
  } catch (lockErr) {
    if (lockErr.code === 'EMISSAO_EM_ANDAMENTO') {
      return {
        success: false,
        status: 'erro_validacao',
        code: lockErr.code,
        message: lockErr.message
      };
    }
    throw lockErr;
  }
  try {
  const emAndamento = await obterNotaEmAndamento(id);
  if (emAndamento) {
    return anexarClassificacao({
      success: false,
      reused: true,
      idNota: emAndamento.id,
      notaId: emAndamento.id,
      status: emAndamento.status,
      numero: emAndamento.numero,
      serie: emAndamento.serie,
      chave: emAndamento.chave_acesso,
      chaveAcesso: emAndamento.chave_acesso,
      protocolo: emAndamento.protocolo,
      recibo: emAndamento.recibo || null,
      cStat: emAndamento.cstat_retorno || null,
      xMotivo: emAndamento.xmotivo_retorno || emAndamento.rejeicao_motivo || null,
      message: 'Há uma NF-e de devolução em andamento para esta compra. Aguarde o retorno da SEFAZ.'
    });
  }

  const rascunhoAtual = await obterRascunhoDevolucaoCompra(id).catch(() => null);
  if (!opcoes.origemNfeDevolucaoId) {
    const ctxEmit = await resolverContextoSubstituicao210240({
      compraId: id,
      rascunho: rascunhoAtual,
      origemDevolucaoId: rascunhoAtual && (rascunhoAtual.origem_nfe_devolucao_id || rascunhoAtual.documento_original_id),
      chaveAnterior: opcoes.chaveAnterior
    });
    if (ctxEmit.ativo) opcoes.origemNfeDevolucaoId = ctxEmit.origemDevolucaoId;
    trace210240('emitir_contexto', {
      compraId: id,
      rascunhoId: rascunhoAtual && rascunhoAtual.id,
      origemNfeDevolucaoId: opcoes.origemNfeDevolucaoId,
      documento_original_id: rascunhoAtual && rascunhoAtual.documento_original_id,
      substituicaoId: ctxEmit.substituicaoId,
      chaveNFAnterior: ctxEmit.chaveAnterior,
      evento210240: ctxEmit.ativo,
      origemResolvida: ctxEmit.fonte
    });
  }
  const ultimaNota = await obterUltimaNotaPorCompra(id);
  const stUltima = String((ultimaNota && ultimaNota.status) || '').toLowerCase();
  const posteriorAoRascunho = Boolean(
    rascunhoAtual
    && ultimaNota
    && String(ultimaNota.created_at || '') >= String(rascunhoAtual.created_at || '')
  );
  const rejeicaoXmlDefinitiva = ultimaNota && xmlRejeicaoFiscalDefinitiva(ultimaNota);
  if (rejeicaoXmlDefinitiva) {
    opcoes.novaIdentidade = true;
  }
  const bloqueioTx = (ultimaNota && posteriorAoRascunho && stUltima !== 'autorizada' && stUltima !== 'cancelada'
    && !rejeicaoXmlDefinitiva && !opcoes.novaIdentidade)
    ? deveBloquearNovaTransmissao(ultimaNota)
    : { bloquear: false };
  if (bloqueioTx.bloquear) {
    registrarDiagnosticoEmissao(id, {
      notaId: ultimaNota.id,
      numero: ultimaNota.numero,
      serie: ultimaNota.serie,
      chave: ultimaNota.chave_acesso,
      status: ultimaNota.status,
      cStat: ultimaNota.cstat_retorno,
      xMotivo: ultimaNota.xmotivo_retorno,
      nRec: ultimaNota.recibo,
      protocolo: ultimaNota.protocolo,
      etapa: 'bloqueio_retransmissao',
      erroTecnico: bloqueioTx.motivo
    });
    return anexarClassificacao({
      success: false,
      reused: true,
      code: 'TRANSMISSAO_ANTERIOR',
      status: ultimaNota.status || 'erro_validacao',
      notaId: ultimaNota.id,
      idNota: ultimaNota.id,
      numero: ultimaNota.numero,
      serie: ultimaNota.serie,
      chave: ultimaNota.chave_acesso,
      chaveAcesso: ultimaNota.chave_acesso,
      protocolo: ultimaNota.protocolo,
      recibo: ultimaNota.recibo || null,
      cStat: ultimaNota.cstat_retorno || null,
      xMotivo: ultimaNota.xmotivo_retorno || ultimaNota.rejeicao_motivo || null,
      retorno: ultimaNota.xml_retorno || null,
      message: bloqueioTx.motivo
    });
  }

  const montado = await montarDocumentoXmlDevolucaoCompra(id, {
    ...opcoes,
    reservarNumero: false
  });
  if (opcoes.pararAposMontarXml === true) {
    return anexarClassificacao({
      success: true,
      status: 'xml_montado_sem_transmissao',
      transmitido: false,
      validacaoSaldoOk: true,
      compraId: id,
      xml: montado.built && montado.built.xmlSemAssinatura,
      infCpl: montado.built && montado.built.infCpl,
      refNFe: montado.refNFe,
      excecao: montado.excecao,
      contexto210240: montado.contexto210240,
      calculo: montado.calculo,
      message: 'Validação de saldo e montagem XML concluídas sem transmissão SEFAZ.'
    });
  }
  let {
    compra,
    config,
    cfopPadrao,
    saldos,
    itensAtivos,
    espelhamento,
    built
  } = montado;

  await salvarRascunhoDevolucaoCompra(id, {
    itens: itensAtivos,
    cfop: cfopPadrao,
    observacoes: opcoes.observacoes,
    fornecedor: compra.fornecedor,
    chave_nfe_original: compra.chave_acesso,
    origem_nfe_devolucao_id: (rascunhoAtual && (rascunhoAtual.origem_nfe_devolucao_id || rascunhoAtual.documento_original_id))
      || (montado.excecao && montado.excecao.devolucaoAnteriorId)
      || (montado.rascunho && montado.rascunho.origem_nfe_devolucao_id)
      || null
  }, {
    usuarioId: opcoes.usuarioId,
    usuarioNome: opcoes.usuarioNome
  }).catch(() => {});

  const auditoriaPre = auditarNfe({
    tipoDocumento: 'DEVOLUCAO_COMPRA',
    emitente: { cnpj: config.cnpj },
    itens: espelhamento.itens,
    xml: built.xmlSemAssinatura,
    contexto: { compraId: id, nfeNumero: montado.numero, debugPrefix: String(id), fase: 'pre_numeracao' }
  });
  if (!auditoriaPre.aprovado) {
    registrarDiagnosticoEmissao(id, {
      status: 'erro_validacao',
      classeResultado: 'VALIDATION_ERROR',
      etapa: 'validacao',
      erroTecnico: formatarMensagemAuditoria(auditoriaPre)
    });
    return anexarClassificacao({
      success: false,
      status: 'erro_validacao',
      code: 'AUDITORIA_FISCAL_REPROVADA',
      message: formatarMensagemAuditoria(auditoriaPre),
      auditoria: auditoriaPre
    });
  }

  const numero = await proximoNumeroNFeVenda();
  built = buildXmlNFeDevolucaoCompra({
    config,
    compra,
    itens: espelhamento.itens,
    numero,
    observacoes: opcoes.observacoes,
    cfopOverride: cfopPadrao
  });

  const auditoria = auditarNfe({
    tipoDocumento: 'DEVOLUCAO_COMPRA',
    emitente: { cnpj: config.cnpj },
    itens: espelhamento.itens,
    xml: built.xmlSemAssinatura,
    contexto: { compraId: id, nfeNumero: numero, debugPrefix: String(id) }
  });
  if (!auditoria.aprovado) {
    registrarDiagnosticoEmissao(id, {
      numero,
      serie: built.serie,
      chave: built.chave,
      ambiente: config.ambiente,
      status: 'erro_validacao',
      classeResultado: 'VALIDATION_ERROR',
      etapa: 'validacao',
      erroTecnico: formatarMensagemAuditoria(auditoria)
    });
    return anexarClassificacao({
      success: false,
      status: 'erro_validacao',
      code: 'AUDITORIA_FISCAL_REPROVADA',
      message: formatarMensagemAuditoria(auditoria),
      auditoria
    });
  }

  const parsedChave = parseChaveNfe(built.chave);
  salvarDebugIdentidade(String(id), '01-identidade.json', {
    chave: built.chave,
    numero,
    serie: built.serie,
    cNF: parsedChave && parsedChave.cNF,
    modelo: '55',
    ambiente: config.ambiente
  });
  const documentosPorChave = await buscarDocumentoPorChave(built.chave);
  const documentosPorNumero = await buscarDocumentoPorNumeroSerie({
    numero,
    serie: built.serie,
    ambiente: config.ambiente
  });
  const preflight = preflightNfeDevolucao({
    tipoDocumento: 'DEVOLUCAO_COMPRA',
    xml: built.xmlSemAssinatura,
    built,
    config,
    itens: espelhamento.itens,
    compraId: id,
    documentosPorChave,
    documentosPorNumero
  });
  salvarDebugIdentidade(String(id), '02-preflight.json', preflight);
  salvarDebugIdentidade(String(id), '03-xml-hash.json', {
    xmlHash: preflight.xmlHash,
    chave: built.chave
  });
  try {
    assertPreflightAprovado(preflight);
  } catch (pfErr) {
    return {
      success: false,
      status: 'erro_validacao',
      code: 'PREFLIGHT_REPROVADO',
      message: pfErr.message,
      preflight,
      auditoria: preflight.auditoria
    };
  }

  traceNfe('emitirNFeDevolucaoCompra→buildXml', {
    compraId: id,
    numero,
    chave: built.chave,
    finNFe: 4,
    refNFe: built.refNFe,
    espelhamento: true,
    fonteXml: espelhamento.fonteXml,
    qtdItens: espelhamento.itens.length
  });
  salvarDebug(`${id}-01-original.xml`, built.xmlSemAssinatura);
  if (built.diagnosticoIpiDevol) {
    salvarDebug(`${id}-diagnostico-ipi-devol.json`, JSON.stringify(built.diagnosticoIpiDevol, null, 2));
  }
  salvarDebug(`${id}-resolucao-icms-crt.json`, JSON.stringify({
    geradoEm: new Date().toISOString(),
    processo: {
      resolver: require.resolve('./resolverIcmsCrtEmitente'),
      builder: require.resolve('./xmlBuilderNfeDevolucaoCompra'),
      pid: process.pid,
      execPath: process.execPath
    },
    crtEmitente: String(config.crt),
    transmitido: false,
    itens: built.resolucaoIcms || []
  }, null, 2));
  salvarDebug(`${id}-rc2-espelhamento.json`, JSON.stringify({
    fonteXml: espelhamento.fonteXml,
    ajustes: espelhamento.ajustes,
    comparacaoFiscal: espelhamento.comparacaoFiscal,
    tributacaoOriginal: espelhamento.tributacaoOriginal
  }, null, 2));
  salvarDebug(`${id}-rc3-saldo.json`, JSON.stringify({
    totaisAntes: saldos.totais,
    itensSolicitados: itensAtivos.map((i) => ({
      compra_item_id: i.compra_item_id || i.id,
      quantidade: i.quantidade
    }))
  }, null, 2));

  let xmlAssinado;
  try {
    const { privateKeyPem, certPem } = carregarEValidarCertificadoNfe(config);
    const assinatura = assinarNFe(built.xmlSemAssinatura, privateKeyPem, certPem);
    xmlAssinado = compactarXml(assinatura?.xmlAssinado || '');
    if (!xmlAssinado) throw new Error('Assinatura da NF-e de devolução não gerou XML.');
    salvarDebug(`${id}-02-assinada.xml`, xmlAssinado);
  } catch (signErr) {
    const { classificarErro } = require('./nfeErros');
    const rawMsg = String(signErr.message || signErr);
    const amigavel = classificarErro({ erro: rawMsg });
    const notaId = await persistirNota({
      compra_id: id,
      numero,
      serie: built.serie,
      chave_acesso: built.chave,
      chave_referenciada: built.refNFe,
      protocolo: null,
      ambiente: config.ambiente,
      status: 'erro_assinatura',
      natureza_operacao: built.natOp,
      cfop: built.cfop,
      xml_enviado: built.xmlSemAssinatura,
      xml_retorno: rawMsg,
      danfe_html: null
    });
    await aposPersistirEmissao(notaId, {
      status: 'erro_assinatura',
      xmlGerado: built.xmlSemAssinatura,
      xmlRetorno: rawMsg,
      message: amigavel.mensagem || rawMsg,
      usuarioId: opcoes.usuarioId,
      usuarioNome: opcoes.usuarioNome,
      ip: opcoes.ip,
      computador: opcoes.computador
    });
    return {
      success: false,
      notaId,
      idNota: notaId,
      status: 'erro_assinatura',
      message: amigavel.mensagem || rawMsg,
      sugestao: amigavel.sugestao || null,
      code: 'ERRO_ASSINATURA'
    };
  }

  try {
    validarXmlFiscal({
      xml: xmlAssinado,
      fase: 'pos_assinatura',
      modeloDoc: '55',
      validarXsd: false
    });
  } catch (validErr) {
    return {
      success: false,
      status: 'erro_validacao',
      message: validErr.message || 'XML assinado inválido.',
      code: 'XML_INVALIDO'
    };
  }

  const loteXml = montarLote(xmlAssinado, String(numero));
  let soapResponse;
  try {
    soapResponse = await enviarLote({
      url: getUrlNFe55(config),
      loteXml,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha,
      cUF: config.codigoUf,
      versaoDados: '4.00'
    });
  } catch (commErr) {
    const notaId = await persistirNota({
      compra_id: id,
      numero,
      serie: built.serie,
      chave_acesso: built.chave,
      chave_referenciada: built.refNFe,
      protocolo: null,
      ambiente: config.ambiente,
      status: 'erro_comunicacao',
      natureza_operacao: built.natOp,
      cfop: built.cfop,
      xml_enviado: xmlAssinado,
      xml_retorno: String(commErr.message || commErr),
      danfe_html: null
    });
    await aposPersistirEmissao(notaId, {
      status: 'erro_comunicacao',
      xmlGerado: built.xmlSemAssinatura,
      xmlAssinado,
      xmlRetorno: String(commErr.message || commErr),
      message: 'Erro de comunicação com a SEFAZ ao emitir NF-e de devolução.',
      usuarioId: opcoes.usuarioId,
      usuarioNome: opcoes.usuarioNome,
      ip: opcoes.ip,
      computador: opcoes.computador
    });
    registrarDiagnosticoEmissao(id, {
      notaId,
      numero,
      serie: built.serie,
      chave: built.chave,
      ambiente: config.ambiente,
      status: 'erro_comunicacao',
      classeResultado: 'COMMUNICATION_ERROR',
      etapa: 'comunicacao',
      erroTecnico: commErr.message
    });
    return {
      success: false,
      notaId,
      idNota: notaId,
      status: 'erro_comunicacao',
      message: 'Erro de comunicação com a SEFAZ ao emitir NF-e de devolução.',
      detalhe: String(commErr.message || commErr),
      code: 'ERRO_COMUNICACAO'
    };
  }

  const raw = String(soapResponse.raw || soapResponse.message || '');
  salvarDebug(`${id}-03-retorno.xml`, raw);
  salvarDebugIdentidade(String(id), '04-transmissao.json', {
    chave: built.chave,
    numero,
    serie: built.serie,
    xmlHash: calcularHashXml(xmlAssinado)
  });
  const parsed = parseRetornoAutorizacaoNfe(raw);
  let status = parsed.status || 'pendente';
  const protocolo = parsed.nProt || null;
  const chaveFinal = onlyDigits(parsed.chNFe || built.chave);
  salvarDebugIdentidade(String(id), '05-retorno.json', {
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    status: parsed.status,
    chave: chaveFinal
  });

  let danfeHtml = null;
  if (status === 'autorizada') {
    try {
      const itensDanfe = (espelhamento.itens || []).filter((i) => Number(i.quantidade) > 0).map((i) => ({
        produto_nome: i.produto_nome || i.descricao_produto,
        quantidade_fiscal: Number(i.quantidade),
        valor_fiscal: Number(i.quantidade) * Number(i.valor_unitario || 0),
        preco_unitario: Number(i.valor_unitario || 0)
      }));
      danfeHtml = await gerarDanfeNfeHtml({
        venda: {
          valor_fiscal: built.totalProdutos,
          cliente_nome: compra.fornecedor
        },
        itens: itensDanfe,
        empresa: {
          nome: config.nomeEmpresa,
          cnpj: config.cnpj,
          ie: config.ie,
          endereco: config.logradouro || config.endereco
        },
        chave: chaveFinal,
        numero,
        serie: built.serie,
        protocolo,
        status,
        natureza: built.natOp,
        chaveReferenciada: built.refNFe
      });
    } catch (_) {
      /* DANFE opcional */
    }
  }

  const notaId = await persistirNota({
    compra_id: id,
    numero,
    serie: built.serie,
    chave_acesso: chaveFinal,
    chave_referenciada: built.refNFe,
    protocolo,
    ambiente: config.ambiente,
    status,
    natureza_operacao: built.natOp,
    cfop: built.cfop,
    xml_enviado: xmlAssinado,
    xml_retorno: raw,
    danfe_html: danfeHtml,
    xml_hash: calcularHashXml(built.xmlSemAssinatura),
    xml_assinado_hash: calcularHashXml(xmlAssinado)
  });

  const notaLifecycle = await aposPersistirEmissao(notaId, {
    parsed,
    status,
    xmlGerado: built.xmlSemAssinatura,
    xmlAssinado,
    xmlRetorno: raw,
    danfeGerado: Boolean(danfeHtml),
    usuarioId: opcoes.usuarioId,
    usuarioNome: opcoes.usuarioNome,
    ip: opcoes.ip,
    computador: opcoes.computador
  });
  status = (notaLifecycle && notaLifecycle.status) || status;

  let saldosApos = null;
  const rascPos = await obterRascunhoDevolucaoCompra(id).catch(() => null);
  const origemPos = await resolverOrigemSubstituicao210240({
    compraId: id,
    origemDevolucaoId: rascPos && (rascPos.origem_nfe_devolucao_id || rascPos.documento_original_id),
    rascunho: rascPos
  }).catch(() => ({ origemDevolucaoId: null }));
  if (status === 'autorizada') {
    if (origemPos && origemPos.origemDevolucaoId) {
      await efetivarSubstituicaoAposAutorizacao({
        devolucaoAnteriorId: origemPos.origemDevolucaoId,
        novaDevolucaoId: notaId,
        rascunhoId: rascPos && rascPos.id
      }).catch(() => {});
    }
    saldosApos = await persistirItensNfeDevolucao({
      nfeDevolucaoId: notaId,
      compraId: id,
      itens: espelhamento.itens,
      usuarioId: opcoes.usuarioId || null,
      usuarioNome: opcoes.usuarioNome || null
    });
    if (opcoes.usuarioId || opcoes.usuarioNome) {
      await new Promise((resolve) => {
        db().run(
          `UPDATE nfe_devolucoes_compra SET usuario_id = ?, usuario_nome = ? WHERE id = ?`,
          [opcoes.usuarioId || null, opcoes.usuarioNome || null, notaId],
          () => resolve()
        );
      });
    }
    await excluirRascunhoDevolucaoCompra(id).catch(() => {});
  }

  const msgDetalhada = (status === 'rejeitada' || status === 'denegada')
    ? mensagemRejeicaoDetalhada(parsed.cStat, parsed.xMotivo)
    : null;

  const outEmissao = anexarClassificacao({
    success: status === 'autorizada',
    tipoDocumento: 'DEVOLUCAO',
    finNFe: 4,
    origem: 'COMPRA',
    compraId: id,
    refNFe: built.refNFe,
    idNota: notaId,
    notaId,
    status,
    statusUi: uiDoEstado(status),
    numero,
    serie: built.serie,
    chave: chaveFinal,
    chaveAcesso: chaveFinal,
    protocolo: (notaLifecycle && notaLifecycle.protocolo) || protocolo,
    recibo: (notaLifecycle && notaLifecycle.recibo) || parsed.recibo || null,
    dhRecbto: parsed.dhRecbto || null,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    danfeHtml: Boolean(danfeHtml),
    controleSaldo: saldosApos
      ? { statusCompra: saldosApos.statusCompra, totais: saldosApos.totais }
      : { statusCompra: saldos.statusCompra, totais: saldos.totais },
    message: status === 'autorizada'
      ? 'NF-e de devolução autorizada com sucesso.'
      : (msgDetalhada || parsed.xMotivo || `NF-e de devolução não autorizada (status: ${status}).`),
    retorno: raw
  });
  registrarDiagnosticoEmissao(id, {
    notaId,
    numero,
    serie: built.serie,
    chave: chaveFinal,
    ambiente: config.ambiente,
    status,
    classeResultado: outEmissao.classeResultado,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    nRec: parsed.recibo,
    protocolo,
    etapa: 'sefaz'
  });
  return outEmissao;
  } finally {
    liberarLock(lockToken);
  }
}

async function criarNovaEmissaoDevolucao(compraId, opcoes = {}) {
  return emitirNFeDevolucaoCompra(compraId, { ...opcoes, novaIdentidade: true });
}

async function obterNfeDevolucaoPorId(notaId) {
  await garantirTabelas();
  return new Promise((resolve, reject) => {
    db().get(`SELECT * FROM nfe_devolucoes_compra WHERE id = ?`, [Number(notaId)], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function listarHistoricoDevolucaoCompra(compraId) {
  await garantirTabelas();
  await garantirTabelasSaldoDevolucao();
  const compra = await carregarCompraCabecalho(compraId);
  const saldos = await carregarSaldosDevolucaoCompra(compraId);
  const notas = await listarNotasDevolucaoCompra(compraId);

  return {
    nfeOriginal: {
      chave: onlyDigits(compra.chave_acesso),
      numero: compra.numero_nf,
      serie: compra.serie_nf,
      fornecedor: compra.fornecedor
    },
    controleSaldo: {
      statusCompra: saldos.statusCompra,
      statusCompraUi: saldos.statusCompraUi,
      totais: saldos.totais,
      itens: saldos.itens
    },
    devolucoes: notas.map((n) => {
      const st = String(n.status || '').toLowerCase();
      return {
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        chave_acesso: n.chave_acesso,
        chave_referenciada: n.chave_referenciada,
        protocolo: n.protocolo,
        recibo: n.recibo || null,
        status: n.status,
        statusUi: uiDoEstado(n.status),
        cStat: n.cstat_retorno || null,
        xMotivo: n.xmotivo_retorno || null,
        rejeicao: n.rejeicao_codigo
          ? mensagemRejeicaoDetalhada(n.rejeicao_codigo, n.rejeicao_motivo)
          : null,
        consultado_em: n.consultado_em || null,
        sincronizado_em: n.sincronizado_em || null,
        created_at: n.created_at,
        quantidade_total: n.quantidade_total,
        usuario_nome: n.usuario_nome,
        cancelado_em: n.cancelado_em,
        motivo_cancelamento: n.motivo_cancelamento,
        protocolo_cancelamento: n.protocolo_cancelamento || null,
        tem_danfe: Boolean(n.tem_danfe),
        tem_danfe_cancelado: Boolean(n.tem_danfe_cancelado),
        tem_xml: Boolean(n.tem_xml),
        itens: n.itens || [],
        acoes: {
          downloadXml: Boolean(n.tem_xml),
          imprimirDanfe: Boolean(n.tem_danfe),
          imprimirDanfeCancelado: Boolean(n.tem_danfe_cancelado),
          consultar: Boolean(n.chave_acesso),
          reenviar: podeReenviarDevolucao({
            status: st,
            rejeicao_codigo: n.rejeicao_codigo,
            cstat_retorno: n.cstat_retorno
          }),
          gerarNovaIdentidade: podeGerarNovaIdentidadeDevolucao({
            status: st,
            rejeicao_codigo: n.rejeicao_codigo,
            cstat_retorno: n.cstat_retorno
          }),
          mensagemNovaIdentidade: podeGerarNovaIdentidadeDevolucao({
            status: st,
            rejeicao_codigo: n.rejeicao_codigo,
            cstat_retorno: n.cstat_retorno
          })
            ? mensagemNovaIdentidadeDevolucao({
              rejeicao_codigo: n.rejeicao_codigo,
              cstat_retorno: n.cstat_retorno
            })
            : null,
          cancelar: podeCancelarDevolucao({ status: st })
        }
      };
    })
  };
}

module.exports = {
  setDbForTests,
  carregarSaldosComExcecao210240,
  emitirNFeDevolucaoCompra,
  criarNovaEmissaoDevolucao,
  previaNfeDevolucaoCompra,
  montarResumoPreviaDevolucao,
  montarDocumentoXmlDevolucaoCompra,
  prepararNfeDevolucaoCompra,
  listarOrigensNfeDevolucaoCompra,
  avaliarValidacaoNfeOrigemDevolucao,
  obterNfeDevolucaoPorId,
  listarHistoricoDevolucaoCompra,
  cancelarNfeDevolucaoCompra,
  cancelarNfeDevolucaoOficial,
  consultarSituacaoDevolucao,
  reconciliarDevolucoesCompraComSefaz: (...a) =>
    require('./nfeDevolucaoLifecycleService').reconciliarDevolucoesCompraComSefaz(...a),
  reenviarNfeDevolucao,
  listarEventosDevolucao,
  obterPainelStatus,
  obterXmlVersionado,
  garantirTabelas,
  sugerirCfop,
  STATUS
};
