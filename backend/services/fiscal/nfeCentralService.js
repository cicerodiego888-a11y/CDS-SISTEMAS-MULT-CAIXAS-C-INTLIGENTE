/**
 * Central operacional de NF-e (pós-emissão) — Sprint 3.3.
 * Não altera Núcleo Transacional nem emissão NFC-e.
 */

'use strict';

const db = require('../../database');
const { getFiscalConfig } = require('./configService');
const { consultarProtocolo } = require('./consultaProtocoloRuntime');
const { ModelType } = require('./core/ModelType');
const { gravarAuditoria } = require('../auditoria');
const { cancelarNfe } = require('./cancelarNfe');
const configService = require('../configuracaoService');
const { podeReenviar } = require('./nfeErros');
const { parseRetornoAutorizacaoNfe } = require('./nfeRetornoAutorizacao');

function garantirColunasNfeCentral() {
  return new Promise((resolve) => {
    const cols = [
      'protocolo_cancelamento TEXT',
      'xml_cancelamento TEXT',
      'motivo_cancelamento TEXT',
      'consultado_em DATETIME',
      'cstat_consulta TEXT',
      'xmotivo_consulta TEXT',
      'usuario_id INTEGER',
      'usuario_nome TEXT'
    ];
    let pending = cols.length;
    if (!pending) return resolve();
    cols.forEach((def) => {
      const name = def.split(' ')[0];
      db.run(`ALTER TABLE nfe_notas ADD COLUMN ${def}`, () => {
        pending -= 1;
        if (pending <= 0) resolve();
      });
    });
  });
}

function registrarHistoricoNfe({
  notaId,
  evento,
  usuarioId = null,
  usuarioNome = null,
  detalhes = null,
  ip = null
}) {
  return gravarAuditoria({
    usuario_id: usuarioId,
    usuario_nome: usuarioNome,
    modulo: 'nfe',
    acao: evento,
    referencia_tipo: 'nfe_nota',
    referencia_id: notaId != null ? Number(notaId) : null,
    detalhes: detalhes || {},
    ip_requisicao: ip
  }).catch((err) => {
    console.warn('[nfe-central] falha ao gravar histórico:', err.message);
    return null;
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function montarFiltrosListaNfe(alias, filtros, { nomeParteSql, docParteSql }) {
  const where = ['1=1'];
  const params = [];
  if (filtros.numero != null && String(filtros.numero).trim() !== '') {
    where.push(`${alias}.numero = ?`);
    params.push(Number(filtros.numero));
  }
  if (filtros.serie != null && String(filtros.serie).trim() !== '') {
    where.push(`${alias}.serie = ?`);
    params.push(Number(filtros.serie));
  }
  if (filtros.situacao) {
    where.push(`LOWER(${alias}.status) = LOWER(?)`);
    params.push(String(filtros.situacao).trim());
  }
  if (filtros.cliente) {
    const q = `%${String(filtros.cliente).trim()}%`;
    where.push(`(${nomeParteSql} LIKE ? OR IFNULL(${docParteSql}, "") LIKE ?)`);
    params.push(q, q);
  }
  if (filtros.chave) {
    where.push(`${alias}.chave_acesso LIKE ?`);
    params.push(`%${String(filtros.chave).replace(/\D/g, '')}%`);
  }
  if (filtros.dataInicio) {
    where.push(`date(${alias}.created_at) >= date(?)`);
    params.push(filtros.dataInicio);
  }
  if (filtros.dataFim) {
    where.push(`date(${alias}.created_at) <= date(?)`);
    params.push(filtros.dataFim);
  }
  return { where, params };
}

async function listarNfeNotas(filtros = {}) {
  const limite = Math.min(Math.max(Number(filtros.limite) || 200, 1), 500);
  const tipoFiltro = String(filtros.tipo || '').trim().toUpperCase();

  const vendaF = montarFiltrosListaNfe('n', filtros, {
    nomeParteSql: 'c.nome',
    docParteSql: 'c.cpf_cnpj'
  });
  const compraF = montarFiltrosListaNfe('d', filtros, {
    nomeParteSql: 'co.fornecedor',
    docParteSql: 'co.fornecedor_cnpj'
  });
  const devVendaF = montarFiltrosListaNfe('d', filtros, {
    nomeParteSql: 'c.nome',
    docParteSql: 'c.cpf_cnpj'
  });

  const vendas = (!tipoFiltro || tipoFiltro === 'VENDA')
    ? await dbAll(`
      SELECT
        n.id,
        n.venda_id,
        n.pedido_id,
        n.numero,
        n.serie,
        n.chave_acesso,
        n.ambiente,
        n.status,
        n.protocolo,
        n.recibo,
        n.protocolo_cancelamento,
        n.consultado_em,
        n.cstat_consulta,
        n.xmotivo_consulta,
        n.natureza_operacao,
        n.cfop,
        n.created_at,
        n.updated_at,
        n.usuario_nome AS usuario_emissao,
        n.fila_estado,
        n.tentativas,
        n.ultima_tentativa_em,
        n.erro_codigo,
        n.erro_mensagem,
        n.erro_sugestao,
        n.tempo_resposta_ms,
        v.total AS valor,
        v.codigo AS venda_codigo,
        v.operador_id,
        COALESCE(n.usuario_nome, u.username, u.nome) AS usuario_responsavel,
        c.nome AS cliente_nome,
        c.cpf_cnpj AS cliente_documento,
        CASE WHEN n.danfe_html IS NOT NULL AND n.danfe_html <> '' THEN 1 ELSE 0 END AS tem_danfe,
        CASE WHEN n.xml_retorno IS NOT NULL AND n.xml_retorno <> '' THEN 1 ELSE 0 END AS tem_xml,
        'VENDA' AS tipo
      FROM nfe_notas n
      LEFT JOIN vendas v ON v.id = n.venda_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN usuarios u ON u.id = COALESCE(n.usuario_id, v.operador_id)
      WHERE ${vendaF.where.join(' AND ')}
    `, vendaF.params).catch(() => [])
    : [];

  const devCompra = (!tipoFiltro || tipoFiltro === 'DEVOLUCAO_COMPRA')
    ? await dbAll(`
      SELECT
        d.id,
        NULL AS venda_id,
        NULL AS pedido_id,
        d.numero,
        d.serie,
        d.chave_acesso,
        d.ambiente,
        d.status,
        d.protocolo,
        d.recibo,
        NULL AS protocolo_cancelamento,
        NULL AS consultado_em,
        NULL AS cstat_consulta,
        NULL AS xmotivo_consulta,
        d.natureza_operacao,
        d.cfop,
        d.created_at,
        d.updated_at,
        d.usuario_nome AS usuario_emissao,
        NULL AS fila_estado,
        NULL AS tentativas,
        NULL AS ultima_tentativa_em,
        NULL AS erro_codigo,
        NULL AS erro_mensagem,
        NULL AS erro_sugestao,
        NULL AS tempo_resposta_ms,
        NULL AS valor,
        NULL AS venda_codigo,
        NULL AS operador_id,
        d.usuario_nome AS usuario_responsavel,
        co.fornecedor AS cliente_nome,
        co.fornecedor_cnpj AS cliente_documento,
        CASE WHEN d.danfe_html IS NOT NULL AND d.danfe_html <> '' THEN 1 ELSE 0 END AS tem_danfe,
        CASE WHEN IFNULL(d.xml_autorizado, d.xml_retorno) IS NOT NULL
          AND IFNULL(d.xml_autorizado, d.xml_retorno) <> '' THEN 1 ELSE 0 END AS tem_xml,
        'DEVOLUCAO_COMPRA' AS tipo
      FROM nfe_devolucoes_compra d
      LEFT JOIN compras co ON co.id = d.compra_id
      WHERE ${compraF.where.join(' AND ')}
    `, compraF.params).catch(() => [])
    : [];

  const devVenda = (!tipoFiltro || tipoFiltro === 'DEVOLUCAO_VENDA')
    ? await dbAll(`
      SELECT
        d.id,
        d.venda_id,
        NULL AS pedido_id,
        d.numero,
        d.serie,
        d.chave_acesso,
        d.ambiente,
        d.status,
        d.protocolo,
        d.recibo,
        NULL AS protocolo_cancelamento,
        NULL AS consultado_em,
        NULL AS cstat_consulta,
        NULL AS xmotivo_consulta,
        d.natureza_operacao,
        d.cfop,
        d.created_at,
        d.updated_at,
        d.usuario_nome AS usuario_emissao,
        NULL AS fila_estado,
        NULL AS tentativas,
        NULL AS ultima_tentativa_em,
        NULL AS erro_codigo,
        NULL AS erro_mensagem,
        NULL AS erro_sugestao,
        NULL AS tempo_resposta_ms,
        NULL AS valor,
        NULL AS venda_codigo,
        NULL AS operador_id,
        d.usuario_nome AS usuario_responsavel,
        c.nome AS cliente_nome,
        c.cpf_cnpj AS cliente_documento,
        CASE WHEN d.danfe_html IS NOT NULL AND d.danfe_html <> '' THEN 1 ELSE 0 END AS tem_danfe,
        CASE WHEN IFNULL(d.xml_autorizado, d.xml_retorno) IS NOT NULL
          AND IFNULL(d.xml_autorizado, d.xml_retorno) <> '' THEN 1 ELSE 0 END AS tem_xml,
        'DEVOLUCAO_VENDA' AS tipo
      FROM nfe_devolucoes_venda d
      LEFT JOIN vendas v ON v.id = d.venda_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE ${devVendaF.where.join(' AND ')}
    `, devVendaF.params).catch(() => [])
    : [];

  return [...vendas, ...devCompra, ...devVenda]
    .sort((a, b) => {
      const ta = String(a.created_at || '');
      const tb = String(b.created_at || '');
      if (ta !== tb) return tb.localeCompare(ta);
      return Number(b.id || 0) - Number(a.id || 0);
    })
    .slice(0, limite)
    .map((r) => ({
      ...r,
      tipo: r.tipo || 'VENDA',
      pode_reenviar: r.tipo === 'VENDA'
        ? podeReenviar({ status: r.status, erroCodigo: r.erro_codigo })
        : false
    }));
}

function obterNfeNotaPorId(id) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        n.*,
        v.total AS valor,
        v.codigo AS venda_codigo,
        v.status_pagamento,
        COALESCE(n.usuario_nome, u.username, u.nome) AS usuario_responsavel,
        c.nome AS cliente_nome,
        c.cpf_cnpj AS cliente_documento
      FROM nfe_notas n
      LEFT JOIN vendas v ON v.id = n.venda_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN usuarios u ON u.id = COALESCE(n.usuario_id, v.operador_id)
      WHERE n.id = ?
    `, [Number(id)], (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function extrairXmlAutorizado(nota) {
  const retorno = String(nota?.xml_retorno || '');
  const enviado = String(nota?.xml_enviado || '');
  const nfeProc = retorno.match(/<nfeProc[\s\S]*?<\/nfeProc>/i);
  if (nfeProc) return nfeProc[0];
  if (retorno.includes('<protNFe') && enviado.includes('<NFe')) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
${enviado.match(/<NFe[\s\S]*?<\/NFe>/i)?.[0] || enviado}
${retorno.match(/<protNFe[\s\S]*?<\/protNFe>/i)?.[0] || ''}
</nfeProc>`;
  }
  return retorno || enviado || '';
}

async function consultarSituacaoNfe(notaId, ctx = {}) {
  await garantirColunasNfeCentral();
  const nota = await obterNfeNotaPorId(notaId);
  if (!nota) {
    throw Object.assign(new Error('NF-e não encontrada.'), { statusCode: 404 });
  }
  const chave = String(nota.chave_acesso || '').replace(/\D/g, '');
  if (chave.length !== 44) {
    throw Object.assign(new Error('NF-e sem chave de acesso válida.'), { statusCode: 400 });
  }

  const config = await getFiscalConfig();
  const consulta = await consultarProtocolo({
    chave,
    modelo: ModelType.NFE,
    ambiente: nota.ambiente || config.ambiente,
    cUF: config.codigoUf,
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha
  });

  if (!consulta.success) {
    await registrarHistoricoNfe({
      notaId: nota.id,
      evento: 'consulta_erro',
      usuarioId: ctx.usuarioId,
      usuarioNome: ctx.usuarioNome,
      ip: ctx.ip,
      detalhes: { chave, erro: consulta.error || consulta.message }
    });
    throw Object.assign(new Error(consulta.error || 'Falha na consulta SEFAZ.'), {
      statusCode: 502,
      body: consulta
    });
  }

  const body = String(consulta.body || '');
  // RC3.16.3 — consulta também prioriza infProt
  const parsed = parseRetornoAutorizacaoNfe(body);
  const cStat = parsed.cStat || consulta.cStat || null;
  const xMotivo = parsed.xMotivo || consulta.xMotivo || null;
  const protocolo = parsed.nProt || (body.match(/<nProt>(\d+)<\/nProt>/) || [])[1] || nota.protocolo;

  let statusNovo = nota.status;
  if (parsed.temInfProt || parsed.status === 'autorizada' || parsed.status === 'rejeitada' || parsed.status === 'denegada') {
    statusNovo = parsed.status;
  } else if (cStat === '100' || cStat === '150') statusNovo = 'autorizada';
  else if (cStat === '101' || cStat === '135' || cStat === '155') statusNovo = 'cancelada';
  else if (cStat === '110' || cStat === '301' || cStat === '302') statusNovo = 'denegada';
  else if ((cStat === '105' || cStat === '104') && !parsed.temInfProt) statusNovo = 'aguardando_retorno';
  else if (cStat) statusNovo = 'rejeitada';

  await new Promise((resolve, reject) => {
    db.run(`
      UPDATE nfe_notas SET
        status = ?,
        protocolo = COALESCE(?, protocolo),
        cstat_consulta = ?,
        xmotivo_consulta = ?,
        erro_mensagem = CASE
          WHEN ? IN ('rejeitada','denegada') THEN COALESCE(?, erro_mensagem)
          WHEN ? = 'autorizada' THEN NULL
          ELSE erro_mensagem
        END,
        erro_codigo = CASE WHEN ? = 'autorizada' THEN NULL ELSE erro_codigo END,
        consultado_em = datetime('now','localtime'),
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `, [
      statusNovo,
      protocolo,
      cStat,
      xMotivo,
      statusNovo,
      xMotivo,
      statusNovo,
      statusNovo,
      nota.id
    ], (err) => (err ? reject(err) : resolve()));
  });

  if (statusNovo === 'aguardando_retorno') {
    try {
      const { agendarConsultaAutomatica } = require('./nfeOperacionalService');
      agendarConsultaAutomatica(nota.id, 0);
    } catch (_) { /* opcional */ }
  }

  await registrarHistoricoNfe({
    notaId: nota.id,
    evento: 'consulta',
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip,
    detalhes: { chave, cStat, xMotivo, protocolo, status: statusNovo, temInfProt: parsed.temInfProt }
  });

  return {
    success: true,
    notaId: nota.id,
    chave,
    status: statusNovo,
    protocolo,
    cStat,
    xMotivo,
    dhRecbto: parsed.dhRecbto,
    consultadoEm: new Date().toISOString(),
    source: consulta.source
  };
}

async function cancelarNfeCentral(notaId, justificativa, ctx = {}) {
  await garantirColunasNfeCentral();
  const out = await cancelarNfe(notaId, justificativa, { forcarPrazo: Boolean(ctx.forcarPrazo) });

  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE nfe_notas SET motivo_cancelamento = ? WHERE id = ?`,
      [String(justificativa || '').trim(), out.notaId],
      (err) => (err ? reject(err) : resolve())
    );
  });

  await registrarHistoricoNfe({
    notaId: out.notaId,
    evento: out.success ? 'cancelamento' : 'cancelamento_rejeitado',
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip,
    detalhes: {
      chave: out.chaveAcesso,
      protocoloEvento: out.protocoloCancelamento,
      status: out.status
    }
  });

  return out;
}

async function listarHistoricoNfe(notaId, limite = 100) {
  const id = Number(notaId);
  const lim = Math.min(Math.max(Number(limite) || 100, 1), 300);
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM auditoria
       WHERE modulo = 'nfe' AND referencia_tipo = 'nfe_nota' AND referencia_id = ?
       ORDER BY criado_em DESC LIMIT ?`,
      [id, lim],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

async function obterFichaDocumentalNfe(notaId) {
  await garantirColunasNfeCentral();
  const nota = await obterNfeNotaPorId(notaId);
  if (!nota) {
    throw Object.assign(new Error('NF-e não encontrada.'), { statusCode: 404 });
  }

  let emitente = {};
  try {
    const cfg = await getFiscalConfig();
    emitente = {
      nome: cfg.nomeEmpresa || '',
      cnpj: cfg.cnpj || '',
      ie: cfg.ie || '',
      endereco: [cfg.logradouro, cfg.numero, cfg.bairro, cfg.municipio, cfg.uf, cfg.cep]
        .filter(Boolean)
        .join(', ')
    };
  } catch (_) { /* ignore */ }

  const itens = await new Promise((resolve, reject) => {
    if (!nota.venda_id) return resolve([]);
    db.all(
      `SELECT
         vi.id, vi.produto_id, vi.quantidade, vi.preco_unitario, vi.subtotal,
         vi.quantidade_fiscal, vi.valor_fiscal, vi.valor_nao_fiscal,
         p.nome AS produto_nome, p.codigo AS produto_codigo, p.ncm, p.cfop, p.unidade
       FROM vendas_itens vi
       LEFT JOIN produtos p ON p.id = vi.produto_id
       WHERE vi.venda_id = ?
       ORDER BY vi.id`,
      [nota.venda_id],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });

  const pagamentos = await new Promise((resolve, reject) => {
    if (!nota.venda_id) return resolve([]);
    db.all(
      `SELECT forma_pagamento, valor, tipo_recebimento, status
       FROM venda_recebimentos
       WHERE venda_id = ?
       ORDER BY id`,
      [nota.venda_id],
      (err, rows) => {
        if (err) return reject(err);
        if (rows && rows.length) return resolve(rows);
        db.all(
          `SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ? ORDER BY id`,
          [nota.venda_id],
          (e2, pags) => (e2 ? reject(e2) : resolve(pags || []))
        );
      }
    );
  });

  const historico = await listarHistoricoNfe(nota.id, 50);
  const st = String(nota.status || '').toLowerCase();
  const rejeitada = st === 'rejeitada' || st === 'denegada' || st === 'cancelamento_rejeitado';
  const timeline = [
    { id: 'criada', label: 'Criada', done: true, at: nota.created_at },
    {
      id: 'assinada',
      label: 'Assinada',
      done: Boolean(nota.xml_enviado) && st !== 'erro_assinatura',
      at: nota.created_at
    },
    {
      id: 'enviada',
      label: 'Transmitida',
      done: Boolean(nota.xml_retorno) || ['autorizada', 'rejeitada', 'denegada', 'cancelada', 'erro_transmissao'].includes(st),
      at: nota.updated_at || nota.created_at
    },
    {
      id: 'autorizada',
      label: 'Autorizada',
      done: st === 'autorizada' || st === 'cancelada',
      at: st === 'autorizada' || st === 'cancelada' ? (nota.updated_at || nota.created_at) : null,
      detail: st === 'autorizada'
        ? `cStat ${nota.cstat_consulta || '100'}${nota.protocolo ? ` · Prot. ${nota.protocolo}` : ''}`
        : null
    },
    {
      id: 'rejeitada',
      label: 'Rejeitada',
      done: rejeitada,
      at: rejeitada ? (nota.updated_at || nota.consultado_em || null) : null,
      optional: true,
      detail: rejeitada
        ? `cStat ${nota.cstat_consulta || '—'} · ${nota.xmotivo_consulta || nota.erro_mensagem || ''}`.trim()
        : null
    },
    {
      id: 'cancelada',
      label: 'Cancelada',
      done: st === 'cancelada',
      at: st === 'cancelada' ? (nota.updated_at || null) : null,
      optional: true
    }
  ];

  const { xml_enviado, xml_retorno, xml_cancelamento, danfe_html, ...meta } = nota;

  return {
    success: true,
    ficha: {
      nota: {
        ...meta,
        c_stat: nota.cstat_consulta || null,
        x_motivo: nota.xmotivo_consulta || nota.erro_mensagem || null,
        mensagem_sefaz: nota.xmotivo_consulta || nota.erro_mensagem || null,
        dh_recbto: nota.consultado_em || null,
        tem_xml: Boolean(xml_retorno || xml_enviado),
        tem_danfe: Boolean(danfe_html),
        tem_xml_cancelamento: Boolean(xml_cancelamento),
        pode_reenviar: podeReenviar({ status: nota.status, erroCodigo: nota.erro_codigo })
      },
      emitente,
      destinatario: {
        nome: nota.cliente_nome || 'Consumidor',
        documento: nota.cliente_documento || '',
        venda_codigo: nota.venda_codigo || null
      },
      totais: {
        valor: nota.valor != null ? Number(nota.valor) : null,
        status_pagamento: nota.status_pagamento || null
      },
      itens: itens.map((it) => ({
        codigo: it.produto_codigo || it.produto_id,
        nome: it.produto_nome || `Produto #${it.produto_id}`,
        ncm: it.ncm || '',
        cfop: it.cfop || nota.cfop || '',
        unidade: it.unidade || 'UN',
        quantidade: Number(it.quantidade_fiscal != null ? it.quantidade_fiscal : it.quantidade) || 0,
        preco_unitario: Number(it.preco_unitario) || 0,
        valor: Number(it.valor_fiscal != null ? it.valor_fiscal : it.subtotal) || 0
      })),
      pagamentos,
      informacoes_adicionais: {
        natureza_operacao: nota.natureza_operacao || '',
        cfop: nota.cfop || '',
        observacoes: null
      },
      sefaz: {
        situacao: nota.status,
        cStat: nota.cstat_consulta || null,
        xMotivo: nota.xmotivo_consulta || nota.erro_mensagem || null,
        protocolo: nota.protocolo || null,
        data: nota.consultado_em || nota.updated_at || null
      },
      timeline,
      historico: historico.map((e) => ({
        em: e.criado_em,
        usuario: e.usuario_nome,
        evento: e.acao,
        detalhes: e.detalhes
      }))
    }
  };
}

function recursoNfeAtivo() {
  return configService.recursoHabilitado('nfe');
}

module.exports = {
  garantirColunasNfeCentral,
  registrarHistoricoNfe,
  listarNfeNotas,
  obterNfeNotaPorId,
  obterFichaDocumentalNfe,
  extrairXmlAutorizado,
  consultarSituacaoNfe,
  cancelarNfeCentral,
  listarHistoricoNfe,
  recursoNfeAtivo
};
