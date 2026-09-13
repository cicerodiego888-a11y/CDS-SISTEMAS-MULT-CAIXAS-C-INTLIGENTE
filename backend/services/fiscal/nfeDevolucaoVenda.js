/**
 * NF-e de Devolução de Venda — MVP produção (RC5).
 * Reutiliza motor oficial: certificado, assinatura, validação, SOAP, parser, DANFE, numeração.
 * Builder específico: xmlBuilderNfeDevolucaoVenda (finNFe=4, tpNF=0 + NFref).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfig } = require('./configService');
const { assinarNFe } = require('./signer');
const { montarLote, enviarLote } = require('./soapClient');
const { onlyDigits, compactarXml } = require('./utils');
const { getFiscalSubDir } = require('./paths');
const { validarXmlFiscal } = require('./validarXmlFiscal');
const { auditarNfe, formatarMensagemAuditoria } = require('./auditoriaFiscalNfe');
const { adaptarImpostoEspelhadoAoCrt } = require('./resolverIcmsCrtEmitente');
const { adquirirLock, liberarLock } = require('./nfeEmissionLockService');
const { preflightNfeDevolucao, assertPreflightAprovado } = require('./nfeDevolucaoPreflight');
const { buscarDocumentoPorChave, buscarDocumentoPorNumeroSerie } = require('./nfeIdentityService');
const { parseRetornoAutorizacaoNfe } = require('./nfeRetornoAutorizacao');
const { gerarDanfeNfeHtml } = require('./danfeNfe');
const { buildXmlNFeDevolucaoVenda } = require('./xmlBuilderNfeDevolucaoVenda');
const {
  espelharTributosNfeDevolucaoVenda,
  validarEspelhamentoAntesTransmissao
} = require('./espelharTributosNfeDevolucaoCompra');
const {
  garantirTabelasSaldoDevolucaoVenda,
  carregarSaldosDevolucaoVenda,
  validarQuantidadesContraSaldo,
  persistirItensNfeDevolucaoVenda,
  cancelarNfeDevolucaoVenda,
  listarNotasDevolucaoVenda,
  STATUS
} = require('./controleSaldoDevolucaoVenda');
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
} = require('./nfeDevolucaoLifecycleVenda');
const {
  uiDoEstado,
  podeReenviarDevolucao,
  podeCancelarDevolucao,
  podeGerarNovaIdentidadeDevolucao,
  mensagemNovaIdentidadeDevolucao,
  mensagemRejeicaoDetalhada
} = require('./nfeDevolucaoEstados');
const { retornarEstoqueNfeDevolucaoVenda } = require('./estoqueNfeDevolucaoVenda');
const configService = require('../configuracaoService');

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug/nfe-devolucao');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo || ''), 'utf8');
}

async function garantirTabelas() {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS nfe_devolucoes_venda (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
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
        `ALTER TABLE nfe_devolucoes_venda ADD COLUMN chave_referenciada TEXT`,
        `ALTER TABLE nfe_devolucoes_venda ADD COLUMN natureza_operacao TEXT`,
        `ALTER TABLE nfe_devolucoes_venda ADD COLUMN cfop TEXT`,
        `ALTER TABLE nfe_devolucoes_venda ADD COLUMN danfe_html TEXT`
      ];
      let i = 0;
      const next = () => {
        if (i >= alters.length) {
          return garantirSchemaLifecycle().then(resolve).catch(reject);
        }
        db.run(alters[i++], () => next());
      };
      next();
    });
  });
}

function obterNotaEmAndamento(vendaId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM nfe_devolucoes_venda
      WHERE venda_id = ? AND status IN (
        'pendente','soap_enviado','enviada','aguardando_retorno',
        'lote_enviado','enviando','assinando','validando','processando'
      )
      ORDER BY id DESC LIMIT 1
    `, [vendaId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function carregarNfeAutorizadaPorVenda(vendaId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT id, chave_acesso, numero, serie, status, xml_enviado, xml_retorno
      FROM nfe_notas
      WHERE venda_id = ?
        AND LOWER(TRIM(COALESCE(status, ''))) = 'autorizada'
      ORDER BY id DESC LIMIT 1
    `, [vendaId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function carregarVendaCabecalho(vendaId) {
  const venda = await new Promise((resolve, reject) => {
    db.get(`
      SELECT
        v.*,
        c.nome AS cliente_nome,
        c.cpf_cnpj AS cliente_cpf,
        c.telefone AS cliente_telefone,
        c.email AS cliente_email,
        c.cep AS cliente_cep,
        c.rua AS cliente_rua,
        c.numero AS cliente_numero,
        c.bairro AS cliente_bairro,
        c.cidade AS cliente_cidade,
        c.uf AS cliente_uf,
        c.inscricao_estadual AS cliente_ie
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
    `, [vendaId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });

  if (!venda) {
    throw Object.assign(new Error('Venda não encontrada.'), {
      code: 'VENDA_NAO_ENCONTRADA',
      statusCode: 404
    });
  }

  if (String(venda.status_venda || venda.status || '').toLowerCase() === 'cancelada') {
    throw Object.assign(new Error('Venda cancelada — não é possível emitir NF-e de devolução.'), {
      code: 'VENDA_CANCELADA',
      statusCode: 400
    });
  }

  if (!venda.cliente_id) {
    throw Object.assign(new Error('Venda sem cliente identificado — informe cliente_id para devolução.'), {
      code: 'CLIENTE_NAO_IDENTIFICADO',
      statusCode: 400
    });
  }

  const docCliente = onlyDigits(
    venda.cliente_cpf || venda.cpf_cnpj_nota || venda.cliente_documento || ''
  );
  if (!(docCliente.length === 11 || docCliente.length === 14) || /^0+$/.test(docCliente)) {
    throw Object.assign(
      new Error('Cliente sem CPF/CNPJ válido — não é possível emitir NF-e de devolução.'),
      { code: 'CLIENTE_SEM_DOCUMENTO', statusCode: 400 }
    );
  }

  const nfeOrigem = await carregarNfeAutorizadaPorVenda(vendaId);
  if (!nfeOrigem) {
    throw Object.assign(
      new Error('Venda sem NF-e autorizada em nfe_notas — devolução fiscal indisponível.'),
      { code: 'NFE_ORIGEM_AUSENTE', statusCode: 400 }
    );
  }

  const chave = onlyDigits(nfeOrigem.chave_acesso);
  if (chave.length !== 44) {
    throw Object.assign(
      new Error('NF-e de venda sem chave de acesso válida (44 dígitos).'),
      { code: 'REF_NFE_INVALIDA', statusCode: 400 }
    );
  }

  return {
    ...venda,
    chave_acesso: chave,
    numero_nf: nfeOrigem.numero,
    serie_nf: nfeOrigem.serie,
    nfe_nota_id: nfeOrigem.id
  };
}

function carregarItensVenda(vendaId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        vi.*,
        p.nome AS produto_nome,
        p.codigo AS produto_codigo,
        p.codigo_barras AS produto_codigo_barras,
        p.ncm AS produto_ncm,
        p.unidade AS produto_unidade,
        p.csosn AS produto_csosn,
        p.origem AS produto_origem,
        COALESCE((
          SELECT SUM(i.quantidade)
          FROM nfe_devolucao_venda_itens i
          INNER JOIN nfe_devolucoes_venda n ON n.id = i.nfe_devolucao_id
          WHERE i.venda_item_id = vi.id
            AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
        ), 0) AS quantidade_devolvida
      FROM vendas_itens vi
      LEFT JOIN produtos p ON p.id = vi.produto_id
      WHERE vi.venda_id = ?
      ORDER BY vi.id
    `, [vendaId], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function mapearTributosItem(venda, item) {
  const raw = String(item.csosn || item.produto_csosn || venda.csosn || '').trim();
  const digits = raw.replace(/\D/g, '');
  return {
    csosn: digits.length === 3 ? digits : '',
    cst: digits.length === 2 ? digits : String(venda.cst || '').replace(/\D/g, '').slice(0, 2),
    origem: item.origem != null && item.origem !== ''
      ? item.origem
      : (item.produto_origem != null ? item.produto_origem : 0),
    cst_pis: venda.cst_pis || '',
    cst_cofins: venda.cst_cofins || '',
    cst_ipi: venda.cst_ipi || ''
  };
}

function sugerirCfop(venda, config) {
  const ufEmpresa = String(config?.uf || '').toUpperCase();
  const ufCliente = String(venda.cliente_uf || venda.uf || '').toUpperCase();
  return ufEmpresa && ufCliente && ufEmpresa !== ufCliente ? '2202' : '1202';
}

/**
 * Pré-preenchimento para a Central NF-e modo DEVOLUÇÃO (RC5: saldo por item).
 */
async function prepararNfeDevolucaoVenda(vendaId) {
  await garantirTabelas();
  await garantirTabelasSaldoDevolucaoVenda();
  const id = Number(vendaId);
  const venda = await carregarVendaCabecalho(id);
  const config = await getFiscalConfig();
  config.serie = Number(config.serieNfe || config.serie || 1);
  const chave = onlyDigits(venda.chave_acesso);
  const cfopSugerido = sugerirCfop(venda, config);

  const saldos = await carregarSaldosDevolucaoVenda(id);
  const notas = await listarNotasDevolucaoVenda(id);

  const itensComSaldo = saldos.itens
    .filter((s) => s.saldo > 0)
    .map((s) => {
      const trib = mapearTributosItem(venda, s);
      return {
        venda_item_id: s.venda_item_id,
        produto_id: s.produto_id,
        produto_nome: s.produto_nome,
        produto_codigo: s.produto_codigo,
        ncm: s.ncm,
        unidade: s.unidade,
        quantidade: s.saldo,
        quantidade_maxima: s.saldo,
        quantidade_vendida: s.quantidade_vendida,
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

  const itensPainel = saldos.itens.map((s) => ({
    venda_item_id: s.venda_item_id,
    produto_id: s.produto_id,
    produto_nome: s.produto_nome,
    produto_codigo: s.produto_codigo,
    quantidade_vendida: s.quantidade_vendida,
    quantidade_devolvida: s.quantidade_devolvida,
    saldo: s.saldo,
    status_saldo: s.status,
    status_ui: s.status_ui
  }));

  let espelhamento = null;
  let itensFinais = itensComSaldo;
  let motivoEspelhamento = null;

  if (chave.length === 44 && itensComSaldo.length) {
    try {
      espelhamento = await espelharTributosNfeDevolucaoVenda({
        vendaId: id,
        chave,
        itens: itensComSaldo,
        cfopPadrao: cfopSugerido,
        exigirXml: false
      });
      if (espelhamento.ok) {
        itensFinais = espelhamento.itens.map((it) => {
          const saldoInfo = saldos.itens.find((s) => Number(s.venda_item_id) === Number(it.venda_item_id));
          return {
            ...it,
            quantidade_vendida: saldoInfo?.quantidade_vendida,
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

  const vendaCancelada = saldos.vendaCancelada;
  const semSaldo = saldos.totais.saldo <= 0;
  const podeEmitir = chave.length === 44
    && !vendaCancelada
    && !semSaldo
    && itensFinais.length > 0
    && Boolean(espelhamento?.ok);

  let motivoBloqueio = null;
  if (!chave || chave.length !== 44) motivoBloqueio = 'Venda sem chave da NF-e autorizada (44 dígitos).';
  else if (vendaCancelada) motivoBloqueio = 'Venda cancelada.';
  else if (semSaldo) motivoBloqueio = 'Venda totalmente devolvida — saldo zerado.';
  else if (!itensFinais.length) motivoBloqueio = 'Nenhum item com saldo disponível para devolução.';
  else if (!espelhamento?.ok) motivoBloqueio = motivoEspelhamento || 'Espelhamento fiscal da NF-e original indisponível.';

  return {
    tipoDocumento: 'DEVOLUCAO',
    finNFe: 4,
    tpNF: 0,
    origem: 'VENDA',
    vendaId: id,
    refNFe: chave,
    podeEmitir,
    motivoBloqueio,
    venda: {
      id: venda.id,
      cliente_id: venda.cliente_id,
      cliente_nome: venda.cliente_nome,
      cliente_cpf: venda.cliente_cpf || onlyDigits(venda.cpf_cnpj_nota || ''),
      total: venda.total,
      status: venda.status_venda || venda.status,
      chave_acesso: chave,
      numero_nf: venda.numero_nf,
      serie_nf: venda.serie_nf
    },
    cfopSugerido,
    camposEditaveis: ['quantidade', 'observacoes', 'cfop'],
    camposBloqueados: ['emitente', 'destinatario', 'refNFe', 'cst', 'csosn', 'tributos'],
    itens: itensFinais,
    itensPainel,
    controleSaldo: {
      statusVenda: saldos.statusVenda,
      statusVendaUi: saldos.statusVendaUi,
      totais: saldos.totais
    },
    financeiroOpcoes: ['estorno', 'credito_cliente', 'vale', 'conta_corrente', 'cancelamento_financeiro'],
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
          cancelar: podeCancelarDevolucao({ status: st })
        }
      };
    }),
    nfeDevolucao: notas.filter((n) => n.status === 'autorizada').slice(-1)[0] || null
  };
}

function resolverItensDoBody(venda, itensVenda, bodyItens, cfopPadrao) {
  return bodyItens.map((b) => {
    const base = itensVenda.find((i) => Number(i.id) === Number(b.venda_item_id || b.id))
      || itensVenda.find((i) => Number(i.produto_id) === Number(b.produto_id));
    if (!base) {
      throw Object.assign(new Error(`Item da venda não encontrado: ${b.venda_item_id || b.produto_id}`), {
        code: 'ITEM_NAO_ENCONTRADO',
        statusCode: 400
      });
    }
    const trib = mapearTributosItem(venda, base);
    const qtd = Number(b.quantidade);
    const max = Number(base.quantidade_fiscal || base.quantidade || 0);
    if (!(qtd > 0) || qtd > max + 1e-9) {
      throw Object.assign(
        new Error(`Quantidade inválida para o item ${base.produto_nome || base.id} (máx. ${max}).`),
        { code: 'QTD_INVALIDA', statusCode: 400 }
      );
    }
    return {
      ...base,
      ...trib,
      venda_item_id: base.id,
      quantidade: qtd,
      valor_unitario: Number(
        b.valor_unitario != null
          ? b.valor_unitario
          : (base.preco_unitario || base.valor_fiscal / Math.max(1, base.quantidade_fiscal || base.quantidade) || 0)
      ),
      cfop: onlyDigits(b.cfop || cfopPadrao).slice(0, 4) || cfopPadrao
    };
  });
}

function persistirNota(payload) {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO nfe_devolucoes_venda (
        venda_id, numero, serie, chave_acesso, chave_referenciada, protocolo, ambiente,
        status, natureza_operacao, cfop, xml_enviado, xml_retorno, danfe_html, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      payload.venda_id,
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
      resolve(this.lastID);
    });
  });
}

/**
 * Emite NF-e de devolução via pipeline oficial (sign → validate → SEFAZ → parse).
 * @param {number} vendaId
 * @param {object} [opcoes]
 */
async function emitirNFeDevolucaoVenda(vendaId, opcoes = {}) {
  const { traceNfe } = require('./nfeTrace');
  traceNfe('emitirNFeDevolucaoVenda', {
    vendaId,
    tipoDocumento: 'DEVOLUCAO',
    origem: 'VENDA',
    arquivo: __filename
  });

  if (!configService.recursoHabilitado('nfe')) {
    return {
      success: false,
      status: 'modulo_desabilitado',
      message: 'Módulo NF-e desabilitado na implantação.'
    };
  }

  await garantirTabelas();
  await garantirTabelasSaldoDevolucaoVenda();
  const id = Number(vendaId);
  let lockToken;
  try {
    lockToken = adquirirLock(`devolucao-venda:${id}`);
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
    return {
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
      message: 'Há uma NF-e de devolução em andamento para esta venda. Aguarde o retorno da SEFAZ.'
    };
  }

  const venda = await carregarVendaCabecalho(id);
  if (opcoes.refNFe) {
    venda.chave_acesso = onlyDigits(opcoes.refNFe);
  }
  const refNFe = onlyDigits(venda.chave_acesso);
  if (refNFe.length !== 44) {
    throw Object.assign(
      new Error('Venda sem chave da NF-e original (44 dígitos).'),
      { code: 'REF_NFE_INVALIDA', statusCode: 400 }
    );
  }

  const config = await getFiscalConfig();
  config.serie = Number(config.serieNfe || config.serie || 1);
  const cfopPadrao = onlyDigits(opcoes.cfop || sugerirCfop(venda, config)).slice(0, 4)
    || sugerirCfop(venda, config);

  const saldos = await carregarSaldosDevolucaoVenda(id);
  if (saldos.totais.saldo <= 0) {
    throw Object.assign(
      new Error('Venda totalmente devolvida — não há saldo disponível para nova NF-e.'),
      { code: 'SALDO_ZERADO', statusCode: 400 }
    );
  }

  let itens;
  if (Array.isArray(opcoes.itens) && opcoes.itens.length) {
    const itensVenda = await carregarItensVenda(id);
    itens = resolverItensDoBody(venda, itensVenda, opcoes.itens, cfopPadrao);
  } else {
    itens = saldos.itens
      .filter((s) => s.saldo > 0)
      .map((s) => {
        const trib = mapearTributosItem(venda, s);
        return {
          venda_item_id: s.venda_item_id,
          id: s.venda_item_id,
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
  const validacaoSaldo = validarQuantidadesContraSaldo({
    saldos,
    itensSolicitados: itensAtivos.map((i) => ({
      venda_item_id: i.venda_item_id || i.id,
      quantidade: i.quantidade,
      produto_nome: i.produto_nome
    })),
    vendaCancelada: saldos.vendaCancelada
  });
  if (!validacaoSaldo.ok) {
    throw Object.assign(
      new Error(validacaoSaldo.erros.join(' | ')),
      { code: 'SALDO_INSUFICIENTE', statusCode: 400, erros: validacaoSaldo.erros }
    );
  }

  const espelhamento = await espelharTributosNfeDevolucaoVenda({
    vendaId: id,
    chave: refNFe,
    itens: itensAtivos,
    cfopPadrao,
    exigirXml: true
  });
  const validacaoEsp = validarEspelhamentoAntesTransmissao(espelhamento, espelhamento.itens);
  if (!validacaoEsp.ok) {
    throw Object.assign(
      new Error(`Inconsistência fiscal: ${validacaoEsp.erros.join(' | ')}`),
      { code: 'VALIDACAO_FISCAL', statusCode: 400, erros: validacaoEsp.erros }
    );
  }

  espelhamento.itens = (espelhamento.itens || []).map((item) =>
    adaptarImpostoEspelhadoAoCrt(item, config.crt)
  );

  const builtPre = buildXmlNFeDevolucaoVenda({
    config,
    venda,
    itens: espelhamento.itens,
    numero: 1,
    observacoes: opcoes.observacoes,
    cfopOverride: cfopPadrao
  });
  const auditoriaPre = auditarNfe({
    tipoDocumento: 'DEVOLUCAO_VENDA',
    emitente: { cnpj: config.cnpj },
    itens: espelhamento.itens,
    xml: builtPre.xmlSemAssinatura,
    contexto: { vendaId: id, nfeNumero: 1, debugPrefix: `venda-${id}`, fase: 'pre_numeracao' }
  });
  if (!auditoriaPre.aprovado) {
    return {
      success: false,
      status: 'erro_validacao',
      code: 'AUDITORIA_FISCAL_REPROVADA',
      message: formatarMensagemAuditoria(auditoriaPre),
      auditoria: auditoriaPre
    };
  }

  const numero = await proximoNumeroNFeVenda();
  const built = buildXmlNFeDevolucaoVenda({
    config,
    venda,
    itens: espelhamento.itens,
    numero,
    observacoes: opcoes.observacoes,
    cfopOverride: cfopPadrao
  });

  const auditoria = auditarNfe({
    tipoDocumento: 'DEVOLUCAO_VENDA',
    emitente: { cnpj: config.cnpj },
    itens: espelhamento.itens,
    xml: built.xmlSemAssinatura,
    contexto: { vendaId: id, nfeNumero: numero, debugPrefix: `venda-${id}` }
  });
  if (!auditoria.aprovado) {
    return {
      success: false,
      status: 'erro_validacao',
      code: 'AUDITORIA_FISCAL_REPROVADA',
      message: formatarMensagemAuditoria(auditoria),
      auditoria
    };
  }
  const documentosPorChave = await buscarDocumentoPorChave(built.chave);
  const documentosPorNumero = await buscarDocumentoPorNumeroSerie({
    numero,
    serie: built.serie,
    ambiente: config.ambiente
  });
  const preflight = preflightNfeDevolucao({
    tipoDocumento: 'DEVOLUCAO_VENDA',
    xml: built.xmlSemAssinatura,
    built,
    config,
    itens: espelhamento.itens,
    vendaId: id,
    documentosPorChave,
    documentosPorNumero
  });
  try {
    assertPreflightAprovado(preflight);
  } catch (pfErr) {
    return {
      success: false,
      status: 'erro_validacao',
      code: 'PREFLIGHT_REPROVADO',
      message: pfErr.message,
      preflight
    };
  }

  traceNfe('emitirNFeDevolucaoVenda→buildXml', {
    vendaId: id,
    numero,
    chave: built.chave,
    finNFe: 4,
    tpNF: 0,
    refNFe: built.refNFe,
    espelhamento: true,
    fonteXml: espelhamento.fonteXml,
    qtdItens: espelhamento.itens.length
  });
  salvarDebug(`venda-${id}-01-original.xml`, built.xmlSemAssinatura);
  salvarDebug(`venda-${id}-rc2-espelhamento.json`, JSON.stringify({
    fonteXml: espelhamento.fonteXml,
    ajustes: espelhamento.ajustes,
    comparacaoFiscal: espelhamento.comparacaoFiscal,
    tributacaoOriginal: espelhamento.tributacaoOriginal
  }, null, 2));
  salvarDebug(`venda-${id}-rc3-saldo.json`, JSON.stringify({
    totaisAntes: saldos.totais,
    itensSolicitados: itensAtivos.map((i) => ({
      venda_item_id: i.venda_item_id || i.id,
      quantidade: i.quantidade
    }))
  }, null, 2));

  let xmlAssinado;
  try {
    const { privateKeyPem, certPem } = carregarEValidarCertificadoNfe(config);
    const assinatura = assinarNFe(built.xmlSemAssinatura, privateKeyPem, certPem);
    xmlAssinado = compactarXml(assinatura?.xmlAssinado || '');
    if (!xmlAssinado) throw new Error('Assinatura da NF-e de devolução não gerou XML.');
    salvarDebug(`venda-${id}-02-assinada.xml`, xmlAssinado);
  } catch (signErr) {
    const { classificarErro } = require('./nfeErros');
    const rawMsg = String(signErr.message || signErr);
    const amigavel = classificarErro({ erro: rawMsg });
    const notaId = await persistirNota({
      venda_id: id,
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
      venda_id: id,
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
  salvarDebug(`venda-${id}-03-retorno.xml`, raw);
  const parsed = parseRetornoAutorizacaoNfe(raw);
  let status = parsed.status || 'pendente';
  const protocolo = parsed.nProt || null;
  const chaveFinal = onlyDigits(parsed.chNFe || built.chave);

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
          cliente_nome: venda.cliente_nome
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
    venda_id: id,
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
    danfe_html: danfeHtml
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
  if (status === 'autorizada') {
    saldosApos = await persistirItensNfeDevolucaoVenda({
      nfeDevolucaoId: notaId,
      vendaId: id,
      itens: espelhamento.itens,
      usuarioId: opcoes.usuarioId || null,
      usuarioNome: opcoes.usuarioNome || null
    });
    try {
      await retornarEstoqueNfeDevolucaoVenda(notaId);
    } catch (estErr) {
      console.warn('[rc5] falha ao retornar estoque na autorização:', estErr.message);
    }
    if (opcoes.usuarioId || opcoes.usuarioNome) {
      await new Promise((resolve) => {
        db.run(
          `UPDATE nfe_devolucoes_venda SET usuario_id = ?, usuario_nome = ? WHERE id = ?`,
          [opcoes.usuarioId || null, opcoes.usuarioNome || null, notaId],
          () => resolve()
        );
      });
    }
  }

  const msgDetalhada = (status === 'rejeitada' || status === 'denegada')
    ? mensagemRejeicaoDetalhada(parsed.cStat, parsed.xMotivo)
    : null;

  return {
    success: status === 'autorizada',
    tipoDocumento: 'DEVOLUCAO',
    finNFe: 4,
    tpNF: 0,
    origem: 'VENDA',
    vendaId: id,
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
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    danfeHtml: Boolean(danfeHtml),
    controleSaldo: saldosApos
      ? { statusVenda: saldosApos.statusVenda, totais: saldosApos.totais }
      : { statusVenda: saldos.statusVenda, totais: saldos.totais },
    message: status === 'autorizada'
      ? 'NF-e de devolução autorizada com sucesso.'
      : (msgDetalhada || parsed.xMotivo || `NF-e de devolução não autorizada (status: ${status}).`),
    retorno: raw
  };
  } finally {
    liberarLock(lockToken);
  }
}

async function obterNfeDevolucaoVendaPorId(notaId) {
  await garantirTabelas();
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM nfe_devolucoes_venda WHERE id = ?`, [Number(notaId)], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function listarHistoricoDevolucaoVenda(vendaId) {
  await garantirTabelas();
  await garantirTabelasSaldoDevolucaoVenda();
  const venda = await carregarVendaCabecalho(vendaId);
  const saldos = await carregarSaldosDevolucaoVenda(vendaId);
  const notas = await listarNotasDevolucaoVenda(vendaId);

  return {
    nfeOriginal: {
      chave: onlyDigits(venda.chave_acesso),
      numero: venda.numero_nf,
      serie: venda.serie_nf,
      cliente: venda.cliente_nome
    },
    controleSaldo: {
      statusVenda: saldos.statusVenda,
      statusVendaUi: saldos.statusVendaUi,
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
          cancelar: podeCancelarDevolucao({ status: st })
        }
      };
    })
  };
}

module.exports = {
  emitirNFeDevolucaoVenda,
  prepararNfeDevolucaoVenda,
  obterNfeDevolucaoVendaPorId,
  listarHistoricoDevolucaoVenda,
  cancelarNfeDevolucaoVenda,
  cancelarNfeDevolucaoOficial,
  consultarSituacaoDevolucao,
  reenviarNfeDevolucao,
  listarEventosDevolucao,
  obterPainelStatus,
  obterXmlVersionado,
  garantirTabelas,
  sugerirCfop,
  STATUS
};
