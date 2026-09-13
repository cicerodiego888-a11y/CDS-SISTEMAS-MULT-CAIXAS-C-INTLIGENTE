/**
 * RC4.0.2 — Painel Operacional Fiscal (Central de Inteligência).
 * Amplia a Central: fila, dashboard, SEFAZ, rejeições, eventos, lote.
 * Não altera motores / XML / SOAP / regras / schema.
 */

'use strict';

const db = require('../../database');
const configService = require('../configuracaoService');
const { getFiscalConfig } = require('../fiscal/configService');
const { VendaOrigin } = require('../vendas/VendaOrigin');

function assertModuloNfe() {
  if (!configService.recursoHabilitado('nfe')) {
    const err = new Error('Módulo NF-e desabilitado.');
    err.statusCode = 404;
    err.codigo = 'MODULO_NFE_DESABILITADO';
    throw err;
  }
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

/** Estrutura extensível — novos documentos sem redesenhar a tela */
const TIPOS_DOCUMENTO_FISCAL = Object.freeze([
  { id: 'nfe', label: 'NF-e', modelo: 55, ativo: true },
  { id: 'nfce', label: 'NFC-e', modelo: 65, ativo: false, preparado: true },
  { id: 'mdfe', label: 'MDF-e', modelo: 58, ativo: false, preparado: true },
  { id: 'cte', label: 'CT-e', modelo: 57, ativo: false, preparado: true },
  { id: 'cte_os', label: 'CT-e OS', modelo: 67, ativo: false, preparado: true },
  { id: 'cce', label: 'CC-e', modelo: null, ativo: false, preparado: true },
  { id: 'manifestacao', label: 'Manifestação', modelo: null, ativo: false, preparado: true },
  { id: 'eventos', label: 'Eventos', modelo: null, ativo: false, preparado: true }
]);

const FILTROS_RAPIDOS = Object.freeze([
  { id: 'todos', label: 'Todos' },
  { id: 'aguardando', label: 'Aguardando Faturamento' },
  { id: 'pendencias', label: 'Pendências' },
  { id: 'prontas', label: 'Prontas para Emitir' },
  { id: 'transmitidas', label: 'Transmitidas' },
  { id: 'autorizadas', label: 'Autorizadas' },
  { id: 'rejeitadas', label: 'Rejeitadas' },
  { id: 'canceladas', label: 'Canceladas' },
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: 'ultimos_7', label: 'Últimos 7 dias' }
]);

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function classificarSituacaoFiscal(row) {
  const st = String(row.nfe_status || '').toLowerCase();
  const doc = onlyDigits(row.cliente_cpf || '');
  const docOk = (doc.length === 11 || doc.length === 14) && !/^0+$/.test(doc);

  if (st === 'autorizada') return { situacao_fiscal: 'autorizada', status_nfe: 'autorizada', pronta: false };
  if (st === 'cancelada') return { situacao_fiscal: 'cancelada', status_nfe: 'cancelada', pronta: false };
  if (st === 'denegada') return { situacao_fiscal: 'denegada', status_nfe: 'denegada', pronta: false };
  if (st === 'rejeitada') return { situacao_fiscal: 'rejeitada', status_nfe: 'rejeitada', pronta: false };
  if (['processando', 'enviada', 'transmitida', 'pendente', 'em_processamento'].includes(st)) {
    return { situacao_fiscal: 'transmitida', status_nfe: st || 'transmitida', pronta: false };
  }
  if (!row.nota_id) {
    if (!docOk) return { situacao_fiscal: 'pendencias', status_nfe: 'sem_nfe', pronta: false };
    return { situacao_fiscal: 'aguardando', status_nfe: 'sem_nfe', pronta: true };
  }
  return { situacao_fiscal: 'aguardando', status_nfe: st || 'pendente', pronta: docOk };
}

function situacaoComercial(row) {
  if (row.pedido_status) return String(row.pedido_status);
  if (row.origem === VendaOrigin.FATURAMENTO || row.origem === 'faturamento') return 'FATURADO';
  return row.origem || 'VENDA';
}

/**
 * Fila operacional ampliada — acompanha todas as NF-e em processamento e histórico filtrável.
 */
async function listarFilaOperacional(query = {}) {
  assertModuloNfe();
  const limite = Math.min(500, Math.max(1, Number(query.limite) || 100));
  const filtro = String(query.filtro || query.status || 'todos').toLowerCase();
  const busca = String(query.q || query.busca || '').trim();
  const tipoDoc = String(query.tipo_documento || 'nfe').toLowerCase();

  const where = [`COALESCE(v.origem, '') IN (?, ?)`];
  const params = [VendaOrigin.FATURAMENTO, VendaOrigin.NF_AVULSA];

  // Filtros de período
  if (filtro === 'hoje') {
    where.push(`date(COALESCE(v.data_venda, v.created_at)) = date('now','localtime')`);
  } else if (filtro === 'ontem') {
    where.push(`date(COALESCE(v.data_venda, v.created_at)) = date('now','localtime','-1 day')`);
  } else if (filtro === 'ultimos_7') {
    where.push(`date(COALESCE(v.data_venda, v.created_at)) >= date('now','localtime','-7 days')`);
  }

  // Filtros de status fiscal
  if (filtro === 'aguardando') {
    where.push(`n.id IS NULL`);
  } else if (filtro === 'pendencias') {
    where.push(`(
      n.id IS NULL AND (
        c.cpf_cnpj IS NULL OR TRIM(COALESCE(c.cpf_cnpj,'')) = '' OR REPLACE(REPLACE(REPLACE(COALESCE(c.cpf_cnpj,''),'.',''),'-',''),'/','') GLOB '0*'
      )
      OR LOWER(COALESCE(n.status,'')) = 'rejeitada'
    )`);
  } else if (filtro === 'prontas') {
    where.push(`n.id IS NULL`);
    where.push(`c.cpf_cnpj IS NOT NULL AND LENGTH(REPLACE(REPLACE(REPLACE(COALESCE(c.cpf_cnpj,''),'.',''),'-',''),'/','')) IN (11, 14)`);
  } else if (filtro === 'transmitidas') {
    where.push(`LOWER(COALESCE(n.status,'')) IN ('processando','enviada','transmitida','pendente','em_processamento')`);
  } else if (filtro === 'autorizadas') {
    where.push(`LOWER(COALESCE(n.status,'')) = 'autorizada'`);
  } else if (filtro === 'rejeitadas') {
    where.push(`LOWER(COALESCE(n.status,'')) = 'rejeitada'`);
  } else if (filtro === 'canceladas') {
    where.push(`LOWER(COALESCE(n.status,'')) = 'cancelada'`);
  } else if (filtro === 'todos' || filtro === 'hoje' || filtro === 'ontem' || filtro === 'ultimos_7') {
    // sem filtro extra de status — mostra fila ampla (não finalizadas + recentes autorizadas)
    if (filtro === 'todos') {
      where.push(`(
        n.id IS NULL
        OR LOWER(COALESCE(n.status,'')) NOT IN ('autorizada','cancelada','denegada')
        OR date(COALESCE(n.updated_at, n.created_at, v.data_venda)) >= date('now','localtime','-7 days')
      )`);
    }
  }

  if (busca) {
    const digits = onlyDigits(busca);
    const like = `%${busca}%`;
    const parts = [
      `CAST(v.id AS TEXT) LIKE ?`,
      `CAST(v.pedido_id AS TEXT) LIKE ?`,
      `COALESCE(c.nome, v.cliente_nome, '') LIKE ?`,
      `CAST(n.numero AS TEXT) LIKE ?`,
      `COALESCE(n.chave_acesso,'') LIKE ?`
    ];
    params.push(like, like, like, like, like);
    if (digits.length >= 3) {
      parts.push(`REPLACE(REPLACE(REPLACE(COALESCE(c.cpf_cnpj,''),'.',''),'-',''),'/','') LIKE ?`);
      params.push(`%${digits}%`);
      parts.push(`REPLACE(COALESCE(n.chave_acesso,''),' ','') LIKE ?`);
      params.push(`%${digits}%`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }

  if (query.pedido) {
    where.push(`v.pedido_id = ?`);
    params.push(Number(query.pedido));
  }
  if (query.venda) {
    where.push(`v.id = ?`);
    params.push(Number(query.venda));
  }
  if (query.numero_nfe) {
    where.push(`n.numero = ?`);
    params.push(Number(query.numero_nfe));
  }
  if (query.chave) {
    where.push(`n.chave_acesso LIKE ?`);
    params.push(`%${onlyDigits(query.chave)}%`);
  }
  if (query.cliente) {
    where.push(`(COALESCE(c.nome, v.cliente_nome, '') LIKE ? OR COALESCE(c.cpf_cnpj,'') LIKE ?)`);
    const q = `%${query.cliente}%`;
    params.push(q, q);
  }
  if (query.cpf_cnpj) {
    where.push(`REPLACE(REPLACE(REPLACE(COALESCE(c.cpf_cnpj,''),'.',''),'-',''),'/','') LIKE ?`);
    params.push(`%${onlyDigits(query.cpf_cnpj)}%`);
  }

  params.push(limite);

  const rows = await dbAll(`
    SELECT
      v.id AS venda_id,
      v.pedido_id,
      v.data_venda,
      v.created_at AS venda_created_at,
      v.total,
      v.valor_fiscal,
      v.origem,
      v.cliente_id,
      COALESCE(c.nome, v.cliente_nome, '') AS cliente_nome,
      c.cpf_cnpj AS cliente_cpf,
      p.status AS pedido_status,
      n.id AS nota_id,
      n.status AS nfe_status,
      n.numero AS nfe_numero,
      n.serie AS nfe_serie,
      n.chave_acesso,
      n.protocolo,
      n.erro_codigo,
      n.erro_mensagem,
      n.usuario_nome AS responsavel,
      n.usuario_id AS responsavel_id,
      n.tentativas,
      n.updated_at AS nfe_updated_at,
      n.created_at AS nfe_created_at,
      n.ultima_tentativa_em,
      n.consultado_em,
      n.tempo_resposta_ms
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN pedidos p ON p.id = v.pedido_id
    LEFT JOIN nfe_notas n ON n.id = (
      SELECT n2.id FROM nfe_notas n2
      WHERE n2.venda_id = v.id
      ORDER BY n2.id DESC LIMIT 1
    )
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(n.updated_at, n.ultima_tentativa_em, v.data_venda, v.created_at) DESC, v.id DESC
    LIMIT ?
  `, params);

  const itens = (rows || []).map((r) => {
    const cls = classificarSituacaoFiscal(r);
    return {
      tipo_documento: tipoDoc,
      pedido_id: r.pedido_id,
      venda_id: r.venda_id,
      cliente_nome: r.cliente_nome,
      cliente_cpf: r.cliente_cpf,
      valor: r.valor_fiscal != null ? Number(r.valor_fiscal) : Number(r.total || 0),
      data: r.data_venda || r.venda_created_at,
      situacao_comercial: situacaoComercial(r),
      situacao_fiscal: cls.situacao_fiscal,
      status_nfe: cls.status_nfe,
      pronta_emitir: cls.pronta,
      nota_id: r.nota_id,
      nfe_numero: r.nfe_numero,
      nfe_serie: r.nfe_serie,
      chave_acesso: r.chave_acesso,
      protocolo: r.protocolo,
      erro_codigo: r.erro_codigo,
      erro_mensagem: r.erro_mensagem,
      responsavel: r.responsavel || null,
      tentativas: r.tentativas || 0,
      ultima_atualizacao: r.nfe_updated_at || r.ultima_tentativa_em || r.consultado_em || r.data_venda || r.venda_created_at,
      acoes: {
        abrir: true,
        emitir: cls.pronta || (!r.nota_id && cls.situacao_fiscal === 'aguardando'),
        reenviar: ['rejeitada', 'processando', 'pendente', 'enviada'].includes(cls.status_nfe),
        consultar: Boolean(r.nota_id),
        danfe: cls.status_nfe === 'autorizada',
        xml: Boolean(r.nota_id),
        cancelar: cls.status_nfe === 'autorizada'
      }
    };
  });

  // Refino pós-query para "prontas" (sem NCM não dá para saber em SQL leve — mantém heurística doc)
  let filtrados = itens;
  if (filtro === 'prontas') {
    filtrados = itens.filter((i) => i.pronta_emitir || i.situacao_fiscal === 'aguardando');
  }

  return {
    success: true,
    filtro,
    filtros_disponiveis: FILTROS_RAPIDOS,
    tipos_documento: TIPOS_DOCUMENTO_FISCAL,
    total: filtrados.length,
    itens: filtrados
  };
}

async function obterDashboard() {
  assertModuloNfe();
  const origens = [VendaOrigin.FATURAMENTO, VendaOrigin.NF_AVULSA];

  const baseJoin = `
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN nfe_notas n ON n.id = (
      SELECT n2.id FROM nfe_notas n2 WHERE n2.venda_id = v.id ORDER BY n2.id DESC LIMIT 1
    )
    WHERE COALESCE(v.origem, '') IN (?, ?)
  `;

  const [
    aguardando,
    pendencias,
    autorizadasHoje,
    rejeitadas,
    reenvios,
    ultimaSefaz,
    tempos
  ] = await Promise.all([
    dbGet(`SELECT COUNT(*) AS c ${baseJoin} AND n.id IS NULL`, origens),
    dbGet(`
      SELECT COUNT(*) AS c ${baseJoin}
      AND (
        (n.id IS NULL AND (c.cpf_cnpj IS NULL OR TRIM(COALESCE(c.cpf_cnpj,'')) = ''))
        OR LOWER(COALESCE(n.status,'')) = 'rejeitada'
      )
    `, origens),
    dbGet(`
      SELECT COUNT(*) AS c FROM nfe_notas n
      WHERE LOWER(n.status) = 'autorizada'
        AND date(COALESCE(n.updated_at, n.created_at)) = date('now','localtime')
    `),
    dbGet(`SELECT COUNT(*) AS c FROM nfe_notas n WHERE LOWER(n.status) = 'rejeitada'`),
    dbGet(`
      SELECT COALESCE(SUM(CASE WHEN tentativas > 1 THEN tentativas - 1 ELSE 0 END), 0) AS c
      FROM nfe_notas
    `),
    dbGet(`
      SELECT
        COALESCE(ultima_tentativa_em, consultado_em, updated_at, created_at) AS quando,
        tempo_resposta_ms,
        erro_codigo,
        erro_mensagem,
        status,
        cstat_consulta
      FROM nfe_notas
      ORDER BY COALESCE(ultima_tentativa_em, consultado_em, updated_at, created_at) DESC
      LIMIT 1
    `),
    dbGet(`
      SELECT
        AVG(CASE WHEN tempo_resposta_ms > 0 THEN tempo_resposta_ms END) AS media_ms,
        AVG(
          CASE WHEN LOWER(status) = 'autorizada' AND created_at IS NOT NULL AND updated_at IS NOT NULL
            THEN (julianday(updated_at) - julianday(created_at)) * 86400000
          END
        ) AS media_ate_auth_ms
      FROM nfe_notas
      WHERE date(created_at) >= date('now','localtime','-30 days')
    `)
  ]);

  return {
    success: true,
    indicadores: {
      aguardando_faturamento: Number(aguardando?.c || 0),
      pendencias_fiscais: Number(pendencias?.c || 0),
      autorizadas_hoje: Number(autorizadasHoje?.c || 0),
      rejeitadas: Number(rejeitadas?.c || 0),
      tempo_medio_emissao_ms: tempos?.media_ms != null ? Math.round(tempos.media_ms) : null,
      tempo_medio_autorizacao_ms: tempos?.media_ate_auth_ms != null ? Math.round(tempos.media_ate_auth_ms) : null,
      quantidade_reenvios: Number(reenvios?.c || 0),
      ultima_comunicacao_sefaz: ultimaSefaz?.quando || null
    },
    tipos_documento: TIPOS_DOCUMENTO_FISCAL
  };
}

async function obterStatusSefaz() {
  assertModuloNfe();
  let config = {};
  try {
    config = await getFiscalConfig({ validarUrls: false });
  } catch (e) {
    config = { _erro: e.message };
  }

  const ambiente = Number(config.ambiente) === 1 ? 1 : 2;
  const ultima = await dbGet(`
    SELECT
      COALESCE(ultima_tentativa_em, consultado_em, updated_at, created_at) AS quando,
      tempo_resposta_ms,
      erro_codigo,
      erro_mensagem,
      status,
      cstat_consulta,
      xmotivo_consulta
    FROM nfe_notas
    ORDER BY COALESCE(ultima_tentativa_em, consultado_em, updated_at, created_at) DESC
    LIMIT 1
  `);

  const ultimoErro = ultima?.erro_mensagem || ultima?.xmotivo_consulta || null;
  const tempo = ultima?.tempo_resposta_ms != null ? Number(ultima.tempo_resposta_ms) : null;
  // Heurística: disponível se última comunicação < 24h sem erro crítico de conexão, ou sem histórico
  let disponivel = true;
  let motivoIndisp = null;
  if (config._erro) {
    disponivel = false;
    motivoIndisp = config._erro;
  } else if (ultimoErro && /timeout|ECONNREFUSED|ENOTFOUND|indispon/i.test(String(ultimoErro))) {
    disponivel = false;
    motivoIndisp = ultimoErro;
  }

  return {
    success: true,
    ambiente,
    ambiente_label: ambiente === 1 ? 'Produção' : 'Homologação',
    homologacao: ambiente === 2,
    producao: ambiente === 1,
    ultima_comunicacao: ultima?.quando || null,
    tempo_resposta_ms: tempo,
    ultimo_erro: ultimoErro,
    ultimo_cstat: ultima?.cstat_consulta || ultima?.erro_codigo || null,
    disponivel,
    status_label: disponivel ? 'Disponível' : 'Indisponível',
    motivo_indisponibilidade: motivoIndisp
  };
}

async function obterPainelRejeicoes(query = {}) {
  assertModuloNfe();
  const limite = Math.min(50, Math.max(5, Number(query.limite) || 20));
  const rows = await dbAll(`
    SELECT
      COALESCE(NULLIF(TRIM(erro_codigo), ''), NULLIF(TRIM(cstat_consulta), ''), '999') AS codigo,
      COALESCE(
        NULLIF(TRIM(erro_mensagem), ''),
        NULLIF(TRIM(xmotivo_consulta), ''),
        'Rejeição sem descrição'
      ) AS descricao,
      COUNT(*) AS quantidade,
      MAX(COALESCE(updated_at, created_at, ultima_tentativa_em)) AS ultima_ocorrencia,
      MAX(id) AS ultima_nota_id
    FROM nfe_notas
    WHERE LOWER(COALESCE(status,'')) = 'rejeitada'
       OR (erro_codigo IS NOT NULL AND TRIM(erro_codigo) != '' AND LOWER(COALESCE(status,'')) != 'autorizada')
    GROUP BY codigo, descricao
    ORDER BY quantidade DESC, ultima_ocorrencia DESC
    LIMIT ?
  `, [limite]);

  return {
    success: true,
    itens: (rows || []).map((r) => ({
      codigo: String(r.codigo),
      descricao: r.descricao,
      quantidade: Number(r.quantidade || 0),
      ultima_ocorrencia: r.ultima_ocorrencia,
      ultima_nota_id: r.ultima_nota_id,
      filtro_sugerido: 'rejeitadas'
    }))
  };
}

async function listarEventosGlobais(query = {}) {
  assertModuloNfe();
  const limite = Math.min(200, Math.max(10, Number(query.limite) || 50));

  // Preferencial: logs operacionais NF-e
  let eventos = [];
  try {
    eventos = await dbAll(`
      SELECT
        id,
        nota_id,
        venda_id,
        usuario_id,
        usuario_nome,
        acao,
        cstat,
        sucesso,
        detalhes,
        criado_em AS data_hora
      FROM nfe_operacional_logs
      ORDER BY id DESC
      LIMIT ?
    `, [limite]);
  } catch (_) {
    eventos = [];
  }

  // Complemento: auditoria módulo nfe
  let auditoria = [];
  try {
    auditoria = await dbAll(`
      SELECT
        id,
        usuario_id,
        usuario_nome,
        acao,
        referencia_id AS nota_id,
        detalhes,
        criado_em AS data_hora
      FROM auditoria
      WHERE LOWER(COALESCE(modulo,'')) = 'nfe'
      ORDER BY id DESC
      LIMIT ?
    `, [limite]);
  } catch (_) {
    auditoria = [];
  }

  const mapAcao = (acao) => {
    const a = String(acao || '').toLowerCase();
    if (/cancel/.test(a)) return 'cancelou';
    if (/reenv|retry/.test(a)) return 'reenviou';
    if (/consult/.test(a)) return 'consultou';
    if (/imprim|danfe|print/.test(a)) return 'imprimiu';
    if (/emit|autoriz/.test(a)) return 'emitiu';
    if (/alter|dados|salvar|fiscal/.test(a)) return 'alterou dados fiscais';
    return a || 'evento';
  };

  const unidos = [
    ...eventos.map((e) => ({
      fonte: 'operacional',
      id: `op-${e.id}`,
      venda_id: e.venda_id,
      nota_id: e.nota_id,
      usuario: e.usuario_nome || 'sistema',
      acao: e.acao,
      acao_label: mapAcao(e.acao),
      data_hora: e.data_hora,
      cstat: e.cstat,
      sucesso: Boolean(e.sucesso)
    })),
    ...auditoria.map((e) => ({
      fonte: 'auditoria',
      id: `aud-${e.id}`,
      venda_id: null,
      nota_id: e.nota_id,
      usuario: e.usuario_nome || 'sistema',
      acao: e.acao,
      acao_label: mapAcao(e.acao),
      data_hora: e.data_hora,
      cstat: null,
      sucesso: true
    }))
  ]
    .sort((a, b) => String(b.data_hora || '').localeCompare(String(a.data_hora || '')))
    .slice(0, limite)
    .map((e) => {
      const s = String(e.data_hora || '').replace('T', ' ');
      const [data, hora] = s.split(' ');
      return {
        ...e,
        data: data || null,
        hora: (hora || '').slice(0, 8) || null
      };
    });

  return { success: true, total: unidos.length, eventos: unidos };
}

/**
 * Ações em lote — orquestra endpoints existentes sem alterar motores.
 */
async function executarAcoesLote(body = {}, ctx = {}) {
  assertModuloNfe();
  const acao = String(body.acao || '').toLowerCase();
  const vendaIds = Array.isArray(body.venda_ids) ? body.venda_ids.map(Number).filter((n) => n > 0) : [];
  if (!acao) {
    const err = new Error('Informe a ação do lote.');
    err.statusCode = 400;
    throw err;
  }
  if (!vendaIds.length) {
    const err = new Error('Selecione ao menos uma venda.');
    err.statusCode = 400;
    throw err;
  }
  if (vendaIds.length > 30) {
    const err = new Error('Limite de 30 vendas por lote.');
    err.statusCode = 400;
    throw err;
  }

  const Central = require('./CentralFaturamentoService');
  const resultados = [];

  for (const vendaId of vendaIds) {
    try {
      let out = null;
      if (acao === 'emitir') {
        out = await Central.emitir(vendaId, body.dadosNfe ? { dadosNfe: body.dadosNfe } : {}, ctx.reqHttp || {});
      } else if (acao === 'reenviar') {
        out = await Central.reenviar(vendaId, {
          usuarioId: ctx.usuarioId,
          usuarioNome: ctx.usuarioNome,
          ip: ctx.ip,
          reqHttp: ctx.reqHttp
        });
      } else if (acao === 'consultar' || acao === 'consultar_situacao') {
        out = await Central.consultarSituacao(vendaId, {
          usuarioId: ctx.usuarioId,
          usuarioNome: ctx.usuarioNome,
          ip: ctx.ip
        });
      } else if (acao === 'xml' || acao === 'exportar_xml') {
        out = await Central.obterXml(vendaId);
      } else if (acao === 'danfe' || acao === 'imprimir_danfe') {
        out = await Central.obterDanfe(vendaId);
      } else if (acao === 'cancelar') {
        const pacote = await Central.carregarVendaCompleta(vendaId);
        if (!pacote.nota?.id) throw new Error('Nota não encontrada.');
        const just = body.justificativa || body.motivo || '';
        if (String(just).trim().length < 15) throw new Error('Justificativa inválida (mín. 15).');
        out = await Central.cancelarNota(pacote.nota.id, just, {
          usuarioId: ctx.usuarioId,
          usuarioNome: ctx.usuarioNome,
          ip: ctx.ip,
          forcarPrazo: Boolean(body.forcarPrazo)
        });
      } else {
        throw new Error(`Ação não suportada: ${acao}`);
      }
      resultados.push({ venda_id: vendaId, success: true, resultado: out });
    } catch (e) {
      resultados.push({
        venda_id: vendaId,
        success: false,
        error: e.message,
        codigo: e.codigo || undefined
      });
    }
  }

  const ok = resultados.filter((r) => r.success).length;
  return {
    success: ok > 0,
    acao,
    total: resultados.length,
    ok,
    falhas: resultados.length - ok,
    resultados
  };
}

/** Pacote inicial da tela operacional */
async function obterPainelInicial(query = {}) {
  assertModuloNfe();
  const [dashboard, sefaz, rejeicoes, fila, eventos] = await Promise.all([
    obterDashboard(),
    obterStatusSefaz(),
    obterPainelRejeicoes({ limite: 10 }),
    listarFilaOperacional(query),
    listarEventosGlobais({ limite: 30 })
  ]);

  return {
    success: true,
    dashboard: dashboard.indicadores,
    sefaz,
    rejeicoes: rejeicoes.itens,
    fila,
    eventos: eventos.eventos,
    filtros_disponiveis: FILTROS_RAPIDOS,
    tipos_documento: TIPOS_DOCUMENTO_FISCAL,
    atualizado_em: new Date().toISOString()
  };
}

module.exports = {
  TIPOS_DOCUMENTO_FISCAL,
  FILTROS_RAPIDOS,
  listarFilaOperacional,
  obterDashboard,
  obterStatusSefaz,
  obterPainelRejeicoes,
  listarEventosGlobais,
  executarAcoesLote,
  obterPainelInicial,
  classificarSituacaoFiscal
};
