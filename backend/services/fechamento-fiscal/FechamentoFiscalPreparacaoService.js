/**
 * Sprint 03 — Preparação / orquestração fiscal do Fechamento Fiscal do Dia.
 * Reutiliza motor NFC-e existente. NÃO transmite à SEFAZ automaticamente.
 * NÃO altera estoque / financeiro / caixa / vendas comerciais.
 */

'use strict';

const crypto = require('crypto');
const { arredondarMoeda, toCentavos } = require('../fiscal/modeloTotais');
const { STATUS, DOC_STATUS, STATUS_PODEM_PREPARAR, TP_EMIS } = require('./constants');
const {
  validarPreparacaoFiscal,
  ratearRecebimentosPorDocumentos,
  hashIdempotencia,
  formatarErrosUsuario,
  agoraLocal,
  onlyDigits
} = require('./FechamentoFiscalValidacaoService');
const { snapshotComercial } = require('./FechamentoFiscalElegibilidadeService');

function getDb(dbOverride) {
  if (dbOverride) return dbOverride;
  return require('../../database');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function logTecnico(evento, payload = {}) {
  // eslint-disable-next-line no-console
  console.log(`[FechamentoFiscal:Prep] ${evento}`, JSON.stringify(payload));
}

async function carregarProdutos(db, produtoIds) {
  const ids = [...new Set((produtoIds || []).map(Number).filter((n) => n > 0))];
  const map = new Map();
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all(
    db,
    `SELECT id, nome, ncm, cest, cfop, csosn, origem, unidade
     FROM produtos WHERE id IN (${placeholders})`,
    ids
  );
  for (const r of rows) map.set(Number(r.id), r);
  return map;
}

async function carregarPreviaCompleta(db, fechamentoId) {
  const vendas = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_previa_vendas
     WHERE fechamento_fiscal_id = ? ORDER BY sequencia`,
    [fechamentoId]
  );
  const itens = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_previa_itens
     WHERE fechamento_fiscal_id = ? ORDER BY previa_venda_id, ordem, id`,
    [fechamentoId]
  );
  const porVenda = new Map();
  for (const it of itens) {
    const list = porVenda.get(it.previa_venda_id) || [];
    list.push(it);
    porVenda.set(it.previa_venda_id, list);
  }
  return vendas.map((v) => ({
    ...v,
    itens: porVenda.get(v.id) || []
  }));
}

async function listarDocumentos(db, fechamentoId) {
  const docs = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_documentos
     WHERE fechamento_fiscal_id = ? ORDER BY sequencia, id`,
    [fechamentoId]
  );
  const itens = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_documentos_itens
     WHERE fechamento_fiscal_id = ? ORDER BY documento_id, ordem, id`,
    [fechamentoId]
  ).catch(() => []);
  const pags = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_documentos_pagamentos
     WHERE fechamento_fiscal_id = ? ORDER BY documento_id, id`,
    [fechamentoId]
  ).catch(() => []);

  const itensPorDoc = new Map();
  for (const it of itens) {
    const list = itensPorDoc.get(it.documento_id) || [];
    list.push(it);
    itensPorDoc.set(it.documento_id, list);
  }
  const pagsPorDoc = new Map();
  for (const p of pags) {
    const list = pagsPorDoc.get(p.documento_id) || [];
    list.push(p);
    pagsPorDoc.set(p.documento_id, list);
  }

  return docs.map((d) => ({
    ...d,
    checklist: d.checklist_json ? JSON.parse(d.checklist_json) : [],
    erros: d.erros_json ? JSON.parse(d.erros_json) : [],
    itens: itensPorDoc.get(d.id) || [],
    pagamentos: pagsPorDoc.get(d.id) || []
  }));
}

async function resolverConfigFiscal(deps) {
  if (typeof deps.getFiscalConfig === 'function') {
    return deps.getFiscalConfig();
  }
  const { getFiscalConfig } = require('../fiscal/configService');
  return getFiscalConfig({ validarUrls: false });
}

function peekNumeroProvisorio(config, sequencia) {
  // NÃO consome numeração — apenas visualização/preparação.
  // Usa a numeração oficial do CDS (fiscal_numero_atual / fluxo incrementaNumeroFiscal).
  // Não inventa série/número próprios do Fechamento Fiscal.
  const base = Number(
    config.numeroAtual != null
      ? config.numeroAtual
      : (config.numeracaoDocumentos?.nfce?.proximoNumero || 1)
  );
  const n = Number.isFinite(base) && base > 0 ? base : 1;
  return n + Number(sequencia || 1) - 1;
}

function montarItemXml(snapshot) {
  return {
    produto_id: snapshot.produto_id,
    produto_nome: snapshot.descricao,
    nome: snapshot.descricao,
    ncm: snapshot.ncm,
    produto_ncm: snapshot.ncm,
    cest: snapshot.cest,
    produto_cest: snapshot.cest,
    cfop: snapshot.cfop,
    csosn: snapshot.csosn,
    origem: snapshot.origem,
    unidade: snapshot.unidade,
    produto_unidade: snapshot.unidade,
    quantidade: snapshot.quantidade,
    quantidade_fiscal: snapshot.quantidade,
    quantidade_nao_fiscal: 0,
    preco_unitario: snapshot.valor_unitario,
    valor_fiscal: snapshot.valor_total,
    valor_nao_fiscal: 0,
    desconto_valor: snapshot.desconto || 0
  };
}

async function gerarXmlDocumento({ config, snapshotItens, pagamentos, valorTotal, numero, buildFn }) {
  const buildNfceXml = buildFn || require('../fiscal/xmlBuilder').buildNfceXml;
  const { mapearFormaPagamento } = require('../fiscal/xmlBuilder');
  const { validarXmlFiscal } = require('../fiscal/validarXmlFiscal');

  const itens = snapshotItens.map(montarItemXml);
  const venda = {
    total: valorTotal,
    desconto: 0,
    valor_fiscal: valorTotal,
    forma_pagamento: 'cartao',
    pagamentos: (pagamentos || []).map((p) => {
      const forma = p.forma_pagamento || 'cartao';
      const tPag = mapearFormaPagamento(forma);
      const row = {
        forma_pagamento: forma,
        valor: Number(p.valor),
        tipo_recebimento: 'fiscal'
      };
      // Sprint 08.0 — xPag só é permitido com tPag=99.
      // Mercado Pago / operadora NÃO pode ir para xPag em cartão (03/04) ou PIX (17) → cStat 442.
      if (tPag === '99') {
        const desc = p.xPag || p.descricao_pagamento || p.operadora || null;
        if (desc) {
          row.xPag = desc;
          row.descricao_pagamento = desc;
        }
      }
      return row;
    })
  };

  const built = buildNfceXml({
    config: {
      ...config,
      // sem certificado real nos testes — evita leitura de arquivo
      certificadoPath: config.certificadoPath || null,
      certificadoSenha: config.certificadoSenha || null
    },
    venda,
    itens,
    numero
  });

  const xml = built.xmlSemAssinatura;
  const validacao = validarXmlFiscal({
    xml,
    fase: 'pre_assinatura',
    modeloDoc: '65',
    validarXsd: false
  });

  const hash = crypto.createHash('sha256').update(xml).digest('hex');

  return {
    xml,
    hash,
    chave: built.chave || null,
    dhEmi: built.dhEmi || null,
    validacao,
    valores: built.valores || null
  };
}

/**
 * Valida + prepara documentos fiscais a partir da prévia.
 * Idempotente via preparacao_idempotency_key.
 */
async function prepararEmissao(fechamentoId, opts = {}, deps = {}) {
  const db = getDb(deps.db);
  const id = Number(fechamentoId);
  const snapshotAntes = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;

  const ff = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [id]);
  if (!ff) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  if (!STATUS_PODEM_PREPARAR.includes(ff.status)) {
    const err = new Error(`Status ${ff.status} não permite preparação fiscal.`);
    err.statusCode = 400;
    err.code = 'STATUS_INVALIDO';
    throw err;
  }

  if (opts.data_hora_emissao || opts.dhEmi || opts.forcar_dhEmi) {
    const err = new Error('Hora retroativa arbitrária não é permitida nesta preparação.');
    err.statusCode = 400;
    err.code = 'HORA_RETROATIVA_PROIBIDA';
    throw err;
  }

  const previaVendas = await carregarPreviaCompleta(db, id);
  const recebimentos = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id = ? ORDER BY id`,
    [id]
  );

  const produtoIds = [];
  for (const v of previaVendas) {
    for (const it of v.itens) produtoIds.push(it.produto_id);
  }
  const produtosPorId = await carregarProdutos(db, produtoIds);

  let configFiscal;
  try {
    configFiscal = await resolverConfigFiscal(deps);
  } catch (e) {
    const err = new Error(e.message || 'Configuração fiscal indisponível.');
    err.statusCode = 400;
    err.code = 'CONFIG_FISCAL';
    throw err;
  }

  const validacao = validarPreparacaoFiscal({
    fechamento: ff,
    previaVendas,
    produtosPorId,
    configFiscal,
    recebimentos,
    opts: {
      certificadoOpcional: deps.certificadoOpcional === true,
      bloquearProducaoEmTeste: deps.bloquearProducaoEmTeste === true,
      data_hora_emissao: opts.data_hora_emissao,
      dhEmi: opts.dhEmi,
      forcar_dhEmi: opts.forcar_dhEmi
    }
  });

  const idemKey = hashIdempotencia({
    fechamentoId: id,
    previaVendas,
    recebimentos,
    ambiente: configFiscal.ambiente,
    cnpj: configFiscal.cnpj || ff.cnpj
  });

  // Idempotência: já preparado com a mesma chave
  if (ff.preparacao_idempotency_key === idemKey && ff.status === STATUS.PRONTO_EMISSAO) {
    const docsExistentes = await listarDocumentos(db, id);
    if (docsExistentes.length) {
      logTecnico('preparacao_idempotente', { fechamento_id: id, documentos: docsExistentes.length });
      const snapshotDepois = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;
      return {
        ok: true,
        idempotente: true,
        status: STATUS.PRONTO_EMISSAO,
        validacao,
        documentos: docsExistentes,
        mensagem: 'DOCUMENTO PRONTO PARA EMISSÃO (idempotente)',
        protecao: {
          snapshot_antes: snapshotAntes,
          snapshot_depois: snapshotDepois,
          comercial_inalterado: snapshotAntes && snapshotDepois
            ? JSON.stringify(snapshotAntes) === JSON.stringify(snapshotDepois)
            : true
        }
      };
    }
  }

  if (!validacao.ok) {
    await run(
      db,
      `UPDATE fechamentos_fiscais
       SET status = ?, atualizado_em = ?, data_referencia_comercial = COALESCE(data_referencia_comercial, ?)
       WHERE id = ?`,
      [STATUS.ERRO, agoraLocal(), ff.data_fechamento, id]
    );
    const err = new Error(formatarErrosUsuario(validacao.erros) || 'Validação fiscal falhou.');
    err.statusCode = 400;
    err.code = 'VALIDACAO_FISCAL';
    err.erros = validacao.erros;
    err.checklist = validacao.checklist;
    err.validacao = validacao;
    throw err;
  }

  await run(db, 'BEGIN IMMEDIATE');
  try {
    // Trava de duplicidade: re-lê status
    const lock = await get(db, `SELECT status, preparacao_idempotency_key FROM fechamentos_fiscais WHERE id = ?`, [id]);
    if (lock.status === STATUS.EMITINDO || lock.status === STATUS.AUTORIZADO) {
      const err = new Error('Fechamento já em emissão/autorizado — preparação bloqueada.');
      err.statusCode = 409;
      err.code = 'DUPLICIDADE';
      throw err;
    }
    if (lock.preparacao_idempotency_key === idemKey && lock.status === STATUS.PRONTO_EMISSAO) {
      await run(db, 'ROLLBACK');
      return prepararEmissao(id, opts, { ...deps, capturarSnapshot: false });
    }

    await run(db, `UPDATE fechamentos_fiscais SET status = ?, atualizado_em = ? WHERE id = ?`, [
      STATUS.VALIDANDO,
      agoraLocal(),
      id
    ]);

    // Remove preparação anterior (substitui, não acumula)
    const docsAntigos = await all(db, `SELECT id FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ?`, [id]);
    for (const d of docsAntigos) {
      await run(db, `DELETE FROM fechamentos_fiscais_documentos_pagamentos WHERE documento_id = ?`, [d.id]);
      await run(db, `DELETE FROM fechamentos_fiscais_documentos_itens WHERE documento_id = ?`, [d.id]);
    }
    await run(db, `DELETE FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ?`, [id]);

    const rateio = ratearRecebimentosPorDocumentos(
      previaVendas.map((v) => ({ previa_venda_id: v.id, sequencia: v.sequencia, valor: v.valor })),
      recebimentos
    );

    const dataRef = ff.data_referencia_comercial || ff.data_fechamento;
    const dataPrep = agoraLocal();
    const documentosCriados = [];
    const gerarXml = opts.gerarXml !== false;

    for (let i = 0; i < previaVendas.length; i++) {
      const v = previaVendas[i];
      const pags = rateio[i].pagamentos;
      const snapshots = [];

      for (const it of v.itens) {
        const prod = produtosPorId.get(Number(it.produto_id));
        snapshots.push({
          produto_id: Number(it.produto_id),
          descricao: prod.nome,
          ncm: onlyDigits(prod.ncm),
          cest: onlyDigits(prod.cest) || null,
          cfop: String(prod.cfop).trim(),
          csosn: String(prod.csosn || '').trim(),
          origem: prod.origem != null ? Number(prod.origem) : 0,
          unidade: it.unidade || prod.unidade || 'UN',
          quantidade: Number(it.quantidade),
          valor_unitario: arredondarMoeda(it.valor_unitario),
          valor_total: arredondarMoeda(it.valor_total != null ? it.valor_total : it.valor),
          desconto: 0,
          acrescimo: 0
        });
      }

      const numeroProv = peekNumeroProvisorio(configFiscal, v.sequencia);
      let xml = null;
      let xmlHash = null;
      let chave = null;
      let checklist = validacao.checklist.map((c) => ({ ...c }));
      let docStatus = DOC_STATUS.VALIDADO;
      let errosDoc = [];

      if (gerarXml) {
        try {
          const gerado = await gerarXmlDocumento({
            config: configFiscal,
            snapshotItens: snapshots,
            pagamentos: pags,
            valorTotal: arredondarMoeda(v.valor),
            numero: numeroProv,
            buildFn: deps.buildNfceXml
          });
          xml = gerado.xml;
          xmlHash = gerado.hash;
          chave = gerado.chave;
          checklist = checklist.map((c) => (c.key === 'xml' ? { ...c, ok: true } : c));
          docStatus = DOC_STATUS.PRONTO_EMISSAO;
        } catch (xmlErr) {
          errosDoc.push({
            codigo: 'XML_ERRO',
            mensagem: xmlErr.message || String(xmlErr)
          });
          docStatus = DOC_STATUS.ERRO;
        }
      }

      const docIdem = `${idemKey}:v${v.sequencia}`;
      const ins = await run(
        db,
        `INSERT INTO fechamentos_fiscais_documentos (
          fechamento_fiscal_id, previa_venda_id, sequencia, status, valor_total,
          numero_provisorio, serie, ambiente, tp_emis,
          data_referencia_comercial, data_hora_preparacao, data_hora_emissao,
          chave_acesso_provisoria, xml_preparado, xml_hash,
          checklist_json, erros_json, idempotency_key, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          v.id,
          v.sequencia,
          docStatus,
          arredondarMoeda(v.valor),
          numeroProv,
          String(configFiscal.serie),
          Number(configFiscal.ambiente),
          TP_EMIS.NORMAL,
          dataRef,
          dataPrep,
          chave,
          xml,
          xmlHash,
          JSON.stringify(checklist),
          JSON.stringify(errosDoc),
          docIdem,
          dataPrep,
          dataPrep
        ]
      );

      let ordem = 0;
      for (const snap of snapshots) {
        await run(
          db,
          `INSERT INTO fechamentos_fiscais_documentos_itens (
            documento_id, fechamento_fiscal_id, produto_id, descricao, ncm, cest, cfop, csosn,
            origem, unidade, quantidade, valor_unitario, valor_total, desconto, acrescimo,
            snapshot_json, ordem, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ins.lastID,
            id,
            snap.produto_id,
            snap.descricao,
            snap.ncm,
            snap.cest,
            snap.cfop,
            snap.csosn,
            snap.origem,
            snap.unidade,
            snap.quantidade,
            snap.valor_unitario,
            snap.valor_total,
            snap.desconto,
            snap.acrescimo,
            JSON.stringify(snap),
            ordem++,
            dataPrep
          ]
        );
      }

      for (const p of pags) {
        await run(
          db,
          `INSERT INTO fechamentos_fiscais_documentos_pagamentos (
            documento_id, fechamento_fiscal_id, recebimento_id, operadora, cnpj,
            forma_pagamento, valor, observacao, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ins.lastID,
            id,
            p.recebimento_id,
            p.operadora,
            p.cnpj || null,
            p.forma_pagamento,
            p.valor,
            p.observacao,
            dataPrep
          ]
        );
      }

      documentosCriados.push({
        id: ins.lastID,
        sequencia: v.sequencia,
        status: docStatus,
        valor_total: arredondarMoeda(v.valor),
        numero_provisorio: numeroProv,
        serie: String(configFiscal.serie),
        ambiente: Number(configFiscal.ambiente),
        data_referencia_comercial: dataRef,
        data_hora_preparacao: dataPrep,
        data_hora_emissao: null,
        xml_hash: xmlHash,
        checklist,
        erros: errosDoc,
        itens: snapshots,
        pagamentos: pags
      });
    }

    const algumErro = documentosCriados.some((d) => d.status === DOC_STATUS.ERRO);
    const statusFinal = algumErro ? STATUS.ERRO : STATUS.PRONTO_EMISSAO;

    await run(
      db,
      `UPDATE fechamentos_fiscais
       SET status = ?,
           data_referencia_comercial = ?,
           data_hora_preparacao = ?,
           data_hora_emissao = NULL,
           tp_emis = ?,
           preparacao_idempotency_key = ?,
           atualizado_em = ?
       WHERE id = ?`,
      [statusFinal, dataRef, dataPrep, TP_EMIS.NORMAL, idemKey, agoraLocal(), id]
    );

    await run(db, 'COMMIT');

    // Auditoria best-effort (não usa tabelas comerciais)
    try {
      if (typeof deps.gravarAuditoria === 'function') {
        await deps.gravarAuditoria({
          usuario_id: opts.usuario_id || null,
          modulo: 'fechamento_fiscal',
          acao: 'preparar_emissao',
          referencia_tipo: 'fechamento_fiscal',
          referencia_id: id,
          detalhes: {
            data_referencia: dataRef,
            data_hora_preparacao: dataPrep,
            valor: ff.valor_informado,
            quantidade_documentos: documentosCriados.length,
            status: statusFinal,
            validacao_ok: !algumErro,
            erros: algumErro ? documentosCriados.flatMap((d) => d.erros) : [],
            xml_hashes: documentosCriados.map((d) => d.xml_hash).filter(Boolean),
            ambiente: configFiscal.ambiente
          }
        });
      }
    } catch (_) { /* ignore */ }

    logTecnico('preparacao_concluida', {
      fechamento_id: id,
      status: statusFinal,
      documentos: documentosCriados.length,
      ambiente: configFiscal.ambiente
    });

    const snapshotDepois = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;

    if (algumErro) {
      const err = new Error('Falha ao gerar XML de um ou mais documentos.');
      err.statusCode = 400;
      err.code = 'XML_ERRO';
      err.documentos = documentosCriados;
      err.validacao = validacao;
      throw err;
    }

    return {
      ok: true,
      idempotente: false,
      status: statusFinal,
      validacao: {
        ...validacao,
        checklist: (documentosCriados[0]?.checklist) || validacao.checklist.map((c) =>
          c.key === 'xml' ? { ...c, ok: true } : c
        )
      },
      documentos: documentosCriados,
      mensagem: 'DOCUMENTO PRONTO PARA EMISSÃO',
      data_referencia_comercial: dataRef,
      data_hora_preparacao: dataPrep,
      data_hora_emissao: null,
      ambiente: Number(configFiscal.ambiente),
      transmissao_habilitada: false,
      protecao: {
        snapshot_antes: snapshotAntes,
        snapshot_depois: snapshotDepois,
        comercial_inalterado: snapshotAntes && snapshotDepois
          ? JSON.stringify(snapshotAntes) === JSON.stringify(snapshotDepois)
          : true
      }
    };
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    if (err.code === 'VALIDACAO_FISCAL' || err.code === 'HORA_RETROATIVA_PROIBIDA') throw err;
    if (err.statusCode) throw err;
    throw err;
  }
}

async function validarSomente(fechamentoId, opts = {}, deps = {}) {
  const db = getDb(deps.db);
  const id = Number(fechamentoId);
  const ff = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [id]);
  if (!ff) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  const previaVendas = await carregarPreviaCompleta(db, id);
  const recebimentos = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id = ? ORDER BY id`,
    [id]
  );
  const produtoIds = [];
  for (const v of previaVendas) {
    for (const it of v.itens) produtoIds.push(it.produto_id);
  }
  const produtosPorId = await carregarProdutos(db, produtoIds);
  const configFiscal = await resolverConfigFiscal(deps);
  const validacao = validarPreparacaoFiscal({
    fechamento: ff,
    previaVendas,
    produtosPorId,
    configFiscal,
    recebimentos,
    opts: {
      certificadoOpcional: deps.certificadoOpcional === true,
      bloquearProducaoEmTeste: deps.bloquearProducaoEmTeste === true,
      data_hora_emissao: opts.data_hora_emissao,
      dhEmi: opts.dhEmi
    }
  });
  return {
    ok: validacao.ok,
    status: ff.status,
    validacao,
    mensagem_usuario: validacao.ok
      ? 'Validação fiscal OK — pronto para preparar emissão.'
      : formatarErrosUsuario(validacao.erros),
    transmissao_habilitada: false
  };
}

async function obterDocumentosPreparados(fechamentoId, deps = {}) {
  const db = getDb(deps.db);
  return listarDocumentos(db, Number(fechamentoId));
}

module.exports = {
  prepararEmissao,
  validarSomente,
  obterDocumentosPreparados,
  listarDocumentos,
  carregarPreviaCompleta,
  peekNumeroProvisorio,
  gerarXmlDocumento,
  ratearRecebimentosPorDocumentos,
  hashIdempotencia
};
