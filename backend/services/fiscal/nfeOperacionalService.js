/**
 * Operação resiliente NF-e — Sprint 3.4.
 * Monitor, fila, log, diagnóstico, reenvio e consulta automática.
 * Não altera Núcleo / Pedido / Faturamento / NFC-e.
 */

'use strict';

const fs = require('fs');
const dns = require('dns').promises;
const https = require('https');
const forge = require('node-forge');
const db = require('../../database');
const { getFiscalConfig } = require('./configService');
const { carregarCertificadoPfx } = require('./certificateService');
const { consultarStatusServico } = require('./statusServico');
const { ModelType } = require('./core/ModelType');
const { OperationType } = require('./core/OperationType');
const { EnvironmentType } = require('./core/EnvironmentType');
const { FiscalWebServices } = require('./core/FiscalWebServices');
const {
  classificarErro,
  podeReenviar,
  statusParaFila,
  statusOperacionalDeErro,
  respostaAmigavel
} = require('./nfeErros');
const { parseRetornoAutorizacaoNfe } = require('./nfeRetornoAutorizacao');
const { registrarHistoricoNfe, obterNfeNotaPorId, consultarSituacaoNfe, garantirColunasNfeCentral } = require('./nfeCentralService');

const BACKOFF_MS = [5000, 15000, 30000, 60000, 120000];
const consultaTimers = new Map();

function garantirSchemaOperacional() {
  return new Promise((resolve) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS nfe_operacional_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nota_id INTEGER,
        venda_id INTEGER,
        usuario_id INTEGER,
        usuario_nome TEXT,
        empresa TEXT,
        filial TEXT,
        documento TEXT,
        acao TEXT NOT NULL,
        retorno_sefaz TEXT,
        cstat TEXT,
        tempo_resposta_ms INTEGER,
        tentativas INTEGER DEFAULT 0,
        sucesso INTEGER DEFAULT 0,
        detalhes TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, () => {
      const cols = [
        'fila_estado TEXT',
        'tentativas INTEGER DEFAULT 0',
        'ultima_tentativa_em DATETIME',
        'erro_codigo TEXT',
        'erro_mensagem TEXT',
        'erro_sugestao TEXT',
        'tempo_resposta_ms INTEGER',
        'consulta_auto_tentativas INTEGER DEFAULT 0',
        'proxima_consulta_em DATETIME'
      ];
      let pending = cols.length;
      cols.forEach((def) => {
        db.run(`ALTER TABLE nfe_notas ADD COLUMN ${def}`, () => {
          pending -= 1;
          if (pending <= 0) resolve();
        });
      });
    });
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function registrarLogOperacional({
  notaId = null,
  vendaId = null,
  usuarioId = null,
  usuarioNome = null,
  empresa = null,
  filial = null,
  documento = null,
  acao,
  retornoSefaz = null,
  cStat = null,
  tempoRespostaMs = null,
  tentativas = 0,
  sucesso = false,
  detalhes = null
}) {
  await garantirSchemaOperacional();
  await runAsync(`
    INSERT INTO nfe_operacional_logs (
      nota_id, venda_id, usuario_id, usuario_nome, empresa, filial, documento,
      acao, retorno_sefaz, cstat, tempo_resposta_ms, tentativas, sucesso, detalhes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    notaId, vendaId, usuarioId, usuarioNome, empresa, filial, documento,
    acao,
    retornoSefaz != null ? String(retornoSefaz).slice(0, 4000) : null,
    cStat,
    tempoRespostaMs,
    tentativas,
    sucesso ? 1 : 0,
    typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes || {})
  ]);
}

async function atualizarEstadoOperacional(notaId, patch = {}) {
  await garantirSchemaOperacional();
  const fields = [];
  const params = [];
  const map = {
    status: 'status',
    fila_estado: 'fila_estado',
    tentativas: 'tentativas',
    ultima_tentativa_em: 'ultima_tentativa_em',
    erro_codigo: 'erro_codigo',
    erro_mensagem: 'erro_mensagem',
    erro_sugestao: 'erro_sugestao',
    tempo_resposta_ms: 'tempo_resposta_ms',
    consulta_auto_tentativas: 'consulta_auto_tentativas',
    proxima_consulta_em: 'proxima_consulta_em',
    recibo: 'recibo',
    protocolo: 'protocolo',
    cstat_consulta: 'cstat_consulta',
    xmotivo_consulta: 'xmotivo_consulta',
    consultado_em: 'consultado_em'
  };
  Object.keys(map).forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      fields.push(`${map[k]} = ?`);
      params.push(patch[k]);
    }
  });
  if (!fields.length) return;
  fields.push(`updated_at = datetime('now','localtime')`);
  params.push(Number(notaId));
  await runAsync(`UPDATE nfe_notas SET ${fields.join(', ')} WHERE id = ?`, params);
}

async function aplicarResultadoEmissao(notaId, resultado = {}, meta = {}) {
  await garantirSchemaOperacional();
  const raw = resultado.xml_retorno || resultado.sefaz || resultado.message || '';
  // RC3.16.3 — resultado oficial = protNFe/infProt (nunca cStat do lote sozinho)
  const parsed = parseRetornoAutorizacaoNfe(raw);
  const cStat = parsed.cStat;
  const xMotivo = parsed.xMotivo;
  const recibo = parsed.recibo;

  let status = resultado.status;
  let erro = null;

  // Preferir classificação do parser quando há XML de retorno
  if (raw && typeof raw === 'string' && (raw.includes('<cStat') || raw.includes('<protNFe') || raw.includes('<retEnviNFe'))) {
    status = parsed.status;
  }

  if (status === 'autorizada' || parsed.sucesso) {
    status = 'autorizada';
    await atualizarEstadoOperacional(notaId, {
      status: 'autorizada',
      fila_estado: 'autorizado',
      protocolo: parsed.nProt || meta.protocolo || null,
      recibo: recibo || null,
      cstat_consulta: cStat || '100',
      xmotivo_consulta: xMotivo || 'Autorizado o uso da NF-e',
      erro_codigo: null,
      erro_mensagem: null,
      erro_sugestao: null,
      tempo_resposta_ms: meta.tempoRespostaMs || null,
      ultima_tentativa_em: new Date().toISOString().slice(0, 19).replace('T', ' '),
      consultado_em: parsed.dhRecbto
        ? String(parsed.dhRecbto).replace('T', ' ').slice(0, 19)
        : new Date().toISOString().slice(0, 19).replace('T', ' ')
    });
  } else if (status === 'aguardando_retorno' && !parsed.temInfProt) {
    // Somente lote 104/105 SEM infProt — consulta automática
    erro = classificarErro({ cStat: cStat || parsed.cStatLote, xMotivo: xMotivo || parsed.xMotivoLote });
    status = 'aguardando_retorno';
    await atualizarEstadoOperacional(notaId, {
      status,
      fila_estado: 'aguardando',
      recibo: recibo || null,
      cstat_consulta: cStat || parsed.cStatLote,
      xmotivo_consulta: xMotivo || parsed.xMotivoLote,
      erro_codigo: erro.codigo,
      erro_mensagem: erro.mensagem,
      erro_sugestao: erro.sugestao,
      tempo_resposta_ms: meta.tempoRespostaMs || null,
      ultima_tentativa_em: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });
    agendarConsultaAutomatica(notaId, 0);
  } else {
    // Rejeição / denegação / erro — nunca "aguardando" se já há infProt
    erro = classificarErro({
      cStat,
      xMotivo,
      erro: resultado.message || xMotivo || raw,
      xml: raw
    });
    status = status === 'denegada' || parsed.status === 'denegada'
      ? 'denegada'
      : (resultado.status === 'erro_assinatura'
        ? 'erro_assinatura'
        : (resultado.status === 'erro_transmissao' && !cStat
          ? 'erro_transmissao'
          : statusOperacionalDeErro(erro)));
    if (parsed.status === 'rejeitada' || parsed.temInfProt) {
      status = parsed.status === 'denegada' ? 'denegada' : 'rejeitada';
    }
    await atualizarEstadoOperacional(notaId, {
      status,
      fila_estado: statusParaFila(status),
      protocolo: parsed.nProt || null,
      recibo: recibo || null,
      cstat_consulta: cStat,
      xmotivo_consulta: xMotivo,
      erro_codigo: erro.codigo,
      erro_mensagem: erro.mensagem || xMotivo,
      erro_sugestao: erro.sugestao,
      tempo_resposta_ms: meta.tempoRespostaMs || null,
      ultima_tentativa_em: new Date().toISOString().slice(0, 19).replace('T', ' '),
      consultado_em: parsed.dhRecbto
        ? String(parsed.dhRecbto).replace('T', ' ').slice(0, 19)
        : null
    });
  }

  await registrarLogOperacional({
    notaId,
    vendaId: meta.vendaId,
    usuarioId: meta.usuarioId,
    usuarioNome: meta.usuarioNome,
    empresa: meta.empresa,
    documento: meta.chave || meta.numero || parsed.chNFe,
    acao: meta.acao || 'emissao',
    retornoSefaz: xMotivo || String(raw).slice(0, 500),
    cStat,
    tempoRespostaMs: meta.tempoRespostaMs,
    tentativas: meta.tentativas || 1,
    sucesso: status === 'autorizada',
    detalhes: {
      status,
      erroCodigo: erro?.codigo || null,
      cStatLote: parsed.cStatLote,
      cStatAutorizacao: cStat,
      xMotivo,
      nProt: parsed.nProt,
      dhRecbto: parsed.dhRecbto,
      chNFe: parsed.chNFe,
      temInfProt: parsed.temInfProt,
      xmlEnviadoResumo: meta.xmlEnviado ? String(meta.xmlEnviado).slice(0, 200) : null,
      xmlRecebidoResumo: raw ? String(raw).slice(0, 400) : null
    }
  });

  return {
    status,
    erro,
    cStat,
    xMotivo,
    nProt: parsed.nProt,
    dhRecbto: parsed.dhRecbto,
    chNFe: parsed.chNFe,
    cStatLote: parsed.cStatLote
  };
}

async function obterMonitorNfe() {
  await garantirSchemaOperacional();
  const rows = await allAsync(`
    SELECT LOWER(COALESCE(status,'')) AS status, COUNT(*) AS qtd
    FROM nfe_notas
    GROUP BY LOWER(COALESCE(status,''))
  `);

  const contadores = {
    emitindo: 0,
    aguardando_retorno: 0,
    autorizada: 0,
    rejeitada: 0,
    cancelada: 0,
    erro_comunicacao: 0,
    pendente_reenvio: 0,
    outros: 0
  };

  for (const r of rows) {
    const s = r.status;
    const q = Number(r.qtd) || 0;
    if (s === 'emitindo' || s === 'transmitindo' || s === 'pendente') contadores.emitindo += q;
    else if (s === 'aguardando_retorno' || s === 'lote_processamento') contadores.aguardando_retorno += q;
    else if (s === 'autorizada') contadores.autorizada += q;
    else if (s === 'rejeitada' || s === 'denegada' || s === 'cancelamento_rejeitado') contadores.rejeitada += q;
    else if (s === 'cancelada') contadores.cancelada += q;
    else if (s === 'erro_comunicacao' || s === 'erro_transmissao' || s === 'timeout' || s === 'servico_indisponivel' || s === 'erro_assinatura') {
      contadores.erro_comunicacao += q;
      if (s !== 'erro_assinatura' && s !== 'rejeitada') contadores.pendente_reenvio += q;
    } else if (s === 'pendente_reenvio' || s === 'reenvio') contadores.pendente_reenvio += q;
    else contadores.outros += q;
  }

  // notas reenviáveis explícitas
  const reenv = await getAsync(`
    SELECT COUNT(*) AS qtd FROM nfe_notas
    WHERE LOWER(status) IN ('erro_comunicacao','erro_transmissao','timeout','servico_indisponivel','pendente_reenvio','aguardando_retorno')
       OR erro_codigo IN ('FALHA_COMUNICACAO','TIMEOUT','SERVICO_INDISPONIVEL','LOTE_PROCESSAMENTO')
  `);
  contadores.pendente_reenvio = Number(reenv?.qtd) || contadores.pendente_reenvio;

  return {
    success: true,
    atualizadoEm: new Date().toISOString(),
    contadores,
    totais: rows
  };
}

async function listarFilaOperacional(filtros = {}) {
  await garantirSchemaOperacional();
  const where = ['1=1'];
  const params = [];

  if (filtros.estado) {
    where.push('LOWER(COALESCE(n.fila_estado, "")) = LOWER(?)');
    params.push(filtros.estado);
  }
  if (filtros.status) {
    where.push('LOWER(n.status) = LOWER(?)');
    params.push(filtros.status);
  }
  if (filtros.busca) {
    const q = `%${String(filtros.busca).trim()}%`;
    where.push('(CAST(n.numero AS TEXT) LIKE ? OR n.chave_acesso LIKE ? OR IFNULL(c.nome,"") LIKE ? OR CAST(n.venda_id AS TEXT) LIKE ?)');
    params.push(q, q, q, q);
  }
  if (filtros.dataInicio) {
    where.push("date(n.created_at) >= date(?)");
    params.push(filtros.dataInicio);
  }
  if (filtros.dataFim) {
    where.push("date(n.created_at) <= date(?)");
    params.push(filtros.dataFim);
  }

  const ordemMap = {
    data: 'n.created_at',
    numero: 'n.numero',
    status: 'n.status',
    tentativas: 'n.tentativas',
    atualizado: 'n.updated_at'
  };
  const col = ordemMap[filtros.ordenar] || 'n.updated_at';
  const dir = String(filtros.direcao || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const limite = Math.min(Math.max(Number(filtros.limite) || 200, 1), 500);

  const rows = await allAsync(`
    SELECT
      n.id, n.venda_id, n.pedido_id, n.numero, n.serie, n.chave_acesso,
      n.status, n.fila_estado, n.protocolo, n.recibo,
      n.erro_codigo, n.erro_mensagem, n.erro_sugestao,
      n.tentativas, n.ultima_tentativa_em, n.tempo_resposta_ms,
      n.consulta_auto_tentativas, n.proxima_consulta_em,
      n.created_at, n.updated_at,
      v.total AS valor, c.nome AS cliente_nome
    FROM nfe_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${col} ${dir}
    LIMIT ?
  `, [...params, limite]);

  return rows.map((r) => ({
    ...r,
    pode_reenviar: podeReenviar({ status: r.status, erroCodigo: r.erro_codigo }),
    fila_estado: r.fila_estado || statusParaFila(r.status)
  }));
}

async function listarLogsOperacionais(filtros = {}) {
  await garantirSchemaOperacional();
  const where = ['1=1'];
  const params = [];
  if (filtros.notaId) {
    where.push('nota_id = ?');
    params.push(Number(filtros.notaId));
  }
  if (filtros.acao) {
    where.push('acao = ?');
    params.push(filtros.acao);
  }
  if (filtros.documento) {
    where.push('documento LIKE ?');
    params.push(`%${filtros.documento}%`);
  }
  const limite = Math.min(Math.max(Number(filtros.limite) || 100, 1), 300);
  return allAsync(`
    SELECT * FROM nfe_operacional_logs
    WHERE ${where.join(' AND ')}
    ORDER BY id DESC
    LIMIT ?
  `, [...params, limite]);
}

function checkItem(nome, nivel, mensagem, detalhe = null) {
  return { nome, nivel, mensagem, detalhe }; // nivel: ok | alerta | erro
}

async function pingHttps(hostname, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname,
      path: '/',
      method: 'HEAD',
      timeout: timeoutMs,
      rejectUnauthorized: false
    }, (res) => {
      resolve({ ok: true, statusCode: res.statusCode });
      res.resume();
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

async function executarDiagnosticoFiscal() {
  await garantirSchemaOperacional();
  const itens = [];
  let config = null;

  try {
    config = await getFiscalConfig({ validarUrls: false });
  } catch (err) {
    itens.push(checkItem('Configuração', 'erro', 'Não foi possível carregar a configuração fiscal.', err.message));
    return { success: false, itens, resumo: { ok: 0, alerta: 0, erro: 1 } };
  }

  // Certificado instalado
  if (config.certificadoPath && fs.existsSync(config.certificadoPath)) {
    itens.push(checkItem('Certificado instalado', 'ok', 'Arquivo do certificado encontrado.', config.certificadoPath));
  } else {
    itens.push(checkItem('Certificado instalado', 'erro', 'Certificado Digital não encontrado.', config.certificadoPath || null));
  }

  // Senha + validade
  try {
    if (!config.certificadoPath || !config.certificadoSenha) {
      itens.push(checkItem('Senha do certificado', 'erro', 'Senha do certificado não configurada.'));
      itens.push(checkItem('Validade do certificado', 'erro', 'Não foi possível validar a validade.'));
    } else {
      const pfx = carregarCertificadoPfx(config.certificadoPath, config.certificadoSenha);
      itens.push(checkItem('Senha do certificado', 'ok', 'Senha aceita pelo certificado.'));
      const cert = forge.pki.certificateFromPem(pfx.certPem);
      const notAfter = cert.validity.notAfter;
      const notBefore = cert.validity.notBefore;
      const agora = new Date();
      const dias = Math.floor((notAfter.getTime() - agora.getTime()) / 86400000);
      if (agora > notAfter) {
        itens.push(checkItem('Validade do certificado', 'erro', 'Certificado Digital vencido.', notAfter.toISOString()));
      } else if (dias <= 30) {
        itens.push(checkItem('Validade do certificado', 'alerta', `Certificado vence em ${dias} dia(s).`, notAfter.toISOString()));
      } else {
        itens.push(checkItem('Validade do certificado', 'ok', `Válido até ${notAfter.toLocaleDateString('pt-BR')}.`, {
          notBefore: notBefore.toISOString(),
          notAfter: notAfter.toISOString()
        }));
      }
    }
  } catch (err) {
    const amigavel = classificarErro({ erro: err.message });
    itens.push(checkItem('Senha do certificado', 'erro', amigavel.mensagem, amigavel.sugestao));
    itens.push(checkItem('Validade do certificado', 'erro', 'Não foi possível ler o certificado.', amigavel.codigo));
  }

  // Ambiente / UF
  const amb = Number(config.ambiente) === 1 ? 'Produção' : 'Homologação';
  itens.push(checkItem('Ambiente', Number(config.ambiente) === 1 ? 'alerta' : 'ok', `Ambiente: ${amb} (${config.ambiente}).`));
  if (config.codigoUf || config.uf) {
    itens.push(checkItem('UF', 'ok', `UF configurada: ${config.uf || ''} (${config.codigoUf || ''}).`));
  } else {
    itens.push(checkItem('UF', 'erro', 'UF não configurada.'));
  }

  // WebService (registry)
  try {
    const platform = new FiscalWebServices();
    const ambiente = Number(config.ambiente) === 1 ? EnvironmentType.PRODUCAO : EnvironmentType.HOMOLOGACAO;
    const resolution = platform.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.AUTORIZACAO,
      ambiente,
      uf: 'SVRS',
      versao: '4.00'
    });
    if (resolution.success && resolution.definition?.endpoint) {
      itens.push(checkItem('WebService', 'ok', 'Endpoint de autorização NF-e resolvido.', resolution.definition.endpoint));
    } else {
      itens.push(checkItem('WebService', 'erro', 'Não foi possível resolver o WebService NF-e.', resolution.error));
    }
  } catch (err) {
    itens.push(checkItem('WebService', 'erro', 'Falha ao resolver WebService.', err.message));
  }

  // Data/Hora
  const agora = new Date();
  itens.push(checkItem('Data/Hora', 'ok', `Horário do servidor: ${agora.toLocaleString('pt-BR')}.`, agora.toISOString()));

  // DNS + Internet
  const host = Number(config.ambiente) === 1 ? 'nfe.svrs.rs.gov.br' : 'nfe-homologacao.svrs.rs.gov.br';
  try {
    const addrs = await dns.lookup(host);
    itens.push(checkItem('DNS', 'ok', `DNS resolvido para ${host}.`, addrs.address));
  } catch (err) {
    itens.push(checkItem('DNS', 'erro', `Falha de DNS para ${host}.`, err.message));
  }

  const ping = await pingHttps(host);
  if (ping.ok) {
    itens.push(checkItem('Internet', 'ok', `Conectividade HTTPS com ${host}.`, `HTTP ${ping.statusCode}`));
  } else {
    itens.push(checkItem('Internet', 'erro', `Sem conectividade com ${host}.`, ping.error));
  }

  // Comunicação SEFAZ (status serviço — SVRS; runtime NFCE compartilhado no SVRS)
  try {
    const started = Date.now();
    const st = await consultarStatusServico({
      ambiente: config.ambiente,
      cUF: config.codigoUf || '23',
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha
    });
    const ms = Date.now() - started;
    const body = String(st.body || '');
    const cStat = (body.match(/<cStat>(\d+)<\/cStat>/) || [])[1] || st.cStat;
    if (st.success && (cStat === '107' || cStat === '100')) {
      itens.push(checkItem('Comunicação SEFAZ', 'ok', `Serviço em operação (cStat ${cStat}).`, `${ms} ms`));
    } else if (st.success) {
      itens.push(checkItem('Comunicação SEFAZ', 'alerta', `SEFAZ respondeu com cStat ${cStat || '-'}.`, `${ms} ms`));
    } else {
      const amigavel = classificarErro({ erro: st.error || st.message, body });
      itens.push(checkItem('Comunicação SEFAZ', 'erro', amigavel.mensagem, amigavel.sugestao));
    }
  } catch (err) {
    const amigavel = classificarErro({ erro: err.message });
    itens.push(checkItem('Comunicação SEFAZ', 'erro', amigavel.mensagem, amigavel.sugestao));
  }

  const resumo = { ok: 0, alerta: 0, erro: 0 };
  itens.forEach((i) => {
    if (i.nivel === 'ok') resumo.ok += 1;
    else if (i.nivel === 'alerta') resumo.alerta += 1;
    else resumo.erro += 1;
  });

  await registrarLogOperacional({
    acao: 'diagnostico',
    sucesso: resumo.erro === 0,
    detalhes: resumo,
    empresa: config.nomeEmpresa || config.cnpj
  });

  return { success: true, itens, resumo, ambiente: amb, empresa: config.nomeEmpresa, cnpj: config.cnpj };
}

async function reenviarNfe(notaId, ctx = {}) {
  // RC3.16.11 — TRACE
  const { traceNfe } = require('./nfeTrace');
  traceNfe('reenviarNfe', {
    notaId,
    usuarioId: ctx.usuarioId || null
  });

  await garantirSchemaOperacional();
  await garantirColunasNfeCentral();
  const nota = await obterNfeNotaPorId(notaId);
  if (!nota) {
    throw Object.assign(new Error('NF-e não encontrada.'), { statusCode: 404, amigavel: respostaAmigavel('DESCONHECIDO') });
  }
  if (!podeReenviar({ status: nota.status, erroCodigo: nota.erro_codigo })) {
    const err = Object.assign(new Error('Reenvio não permitido para esta situação.'), {
      statusCode: 400,
      amigavel: {
        success: false,
        mensagem: 'Reenvio não permitido para esta situação.',
        codigo: 'REENVIO_BLOQUEADO',
        sugestao: 'Notas autorizadas, canceladas, denegadas ou inutilizadas não podem ser reenviadas.'
      }
    });
    throw err;
  }

  const tentativas = (Number(nota.tentativas) || 0) + 1;
  await atualizarEstadoOperacional(nota.id, {
    status: 'emitindo',
    fila_estado: 'transmitindo',
    tentativas,
    ultima_tentativa_em: new Date().toISOString().slice(0, 19).replace('T', ' ')
  });

  await registrarHistoricoNfe({
    notaId: nota.id,
    evento: 'reenvio',
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip,
    detalhes: { tentativa: tentativas, statusAnterior: nota.status }
  });

  const started = Date.now();
  const { emitirNfePorVendaId } = require('./nfeEmissorVenda');
  let resultado;
  try {
    traceNfe('nfeOperacional→emitirNfePorVendaId', {
      notaId: nota.id,
      vendaId: nota.venda_id,
      pedidoId: nota.pedido_id,
      numeroNota: nota.numero,
      serie: nota.serie
    });
    resultado = await emitirNfePorVendaId(nota.venda_id, {
      forcarReemissao: true,
      pedidoId: nota.pedido_id,
      usuarioId: ctx.usuarioId,
      usuarioNome: ctx.usuarioNome,
      dadosNfe: {
        natureza_operacao: nota.natureza_operacao,
        cfop: nota.cfop
      }
    });
  } catch (err) {
    const amigavel = classificarErro({ erro: err.message });
    await atualizarEstadoOperacional(nota.id, {
      status: statusOperacionalDeErro(amigavel),
      fila_estado: 'erro',
      erro_codigo: amigavel.codigo,
      erro_mensagem: amigavel.mensagem,
      erro_sugestao: amigavel.sugestao,
      tentativas,
      tempo_resposta_ms: Date.now() - started
    });
    await registrarLogOperacional({
      notaId: nota.id,
      vendaId: nota.venda_id,
      usuarioId: ctx.usuarioId,
      usuarioNome: ctx.usuarioNome,
      documento: nota.chave_acesso || String(nota.numero),
      acao: 'reenvio',
      retornoSefaz: amigavel.mensagem,
      tempoRespostaMs: Date.now() - started,
      tentativas,
      sucesso: false,
      detalhes: { codigo: amigavel.codigo }
    });
    throw Object.assign(new Error(amigavel.mensagem), { statusCode: 502, amigavel: respostaAmigavel(amigavel) });
  }

  const notaAtual = await obterNfeNotaPorId(nota.id) || nota;
  await aplicarResultadoEmissao(notaAtual.id || nota.id, {
    status: resultado.status,
    message: resultado.message,
    xml_retorno: resultado.xml_retorno || resultado.message
  }, {
    vendaId: nota.venda_id,
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    chave: resultado.chaveAcesso || nota.chave_acesso,
    numero: resultado.numero || nota.numero,
    tempoRespostaMs: Date.now() - started,
    tentativas,
    acao: 'reenvio'
  });

  if (resultado.status === 'autorizada' || resultado.success) {
    return {
      success: true,
      mensagem: 'NF-e reenviada e autorizada.',
      codigo: 'OK',
      status: 'autorizada',
      notaId: nota.id,
      chaveAcesso: resultado.chaveAcesso,
      protocolo: resultado.protocolo
    };
  }

  const amigavel = classificarErro({
    erro: resultado.message,
    xml: resultado.xml_retorno
  });
  return {
    success: false,
    mensagem: amigavel.mensagem,
    codigo: amigavel.codigo,
    sugestao: amigavel.sugestao,
    status: resultado.status,
    notaId: nota.id
  };
}

function cancelarTimerConsulta(notaId) {
  const t = consultaTimers.get(Number(notaId));
  if (t) {
    clearTimeout(t);
    consultaTimers.delete(Number(notaId));
  }
}

function agendarConsultaAutomatica(notaId, tentativaIndex = 0) {
  const id = Number(notaId);
  cancelarTimerConsulta(id);
  const delay = BACKOFF_MS[Math.min(tentativaIndex, BACKOFF_MS.length - 1)];
  const proxima = new Date(Date.now() + delay).toISOString().slice(0, 19).replace('T', ' ');
  atualizarEstadoOperacional(id, {
    proxima_consulta_em: proxima,
    consulta_auto_tentativas: tentativaIndex
  }).catch(() => {});

  const timer = setTimeout(async () => {
    consultaTimers.delete(id);
    try {
      await executarConsultaAutomatica(id, tentativaIndex);
    } catch (err) {
      console.warn('[nfe-auto-consulta]', id, err.message);
      if (tentativaIndex + 1 < BACKOFF_MS.length) {
        agendarConsultaAutomatica(id, tentativaIndex + 1);
      }
    }
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  consultaTimers.set(id, timer);
}

async function executarConsultaAutomatica(notaId, tentativaIndex = 0) {
  const nota = await obterNfeNotaPorId(notaId);
  if (!nota) return;
  const st = String(nota.status || '').toLowerCase();
  if (!['aguardando_retorno', 'lote_processamento', 'pendente_reenvio'].includes(st) && nota.erro_codigo !== 'LOTE_PROCESSAMENTO') {
    return;
  }
  if (!nota.chave_acesso || String(nota.chave_acesso).replace(/\D/g, '').length !== 44) {
    if (tentativaIndex + 1 < BACKOFF_MS.length) agendarConsultaAutomatica(notaId, tentativaIndex + 1);
    return;
  }

  const started = Date.now();
  await atualizarEstadoOperacional(notaId, { fila_estado: 'consulta' });

  let out;
  try {
    out = await consultarSituacaoNfe(notaId, { usuarioNome: 'sistema-auto' });
  } catch (err) {
    await registrarLogOperacional({
      notaId,
      vendaId: nota.venda_id,
      documento: nota.chave_acesso,
      acao: 'consulta_automatica',
      retornoSefaz: err.message,
      tempoRespostaMs: Date.now() - started,
      tentativas: tentativaIndex + 1,
      sucesso: false
    });
    if (tentativaIndex + 1 < BACKOFF_MS.length) agendarConsultaAutomatica(notaId, tentativaIndex + 1);
    return;
  }

  await registrarLogOperacional({
    notaId,
    vendaId: nota.venda_id,
    documento: nota.chave_acesso,
    acao: 'consulta_automatica',
    retornoSefaz: out.xMotivo || out.cStat,
    cStat: out.cStat,
    tempoRespostaMs: Date.now() - started,
    tentativas: tentativaIndex + 1,
    sucesso: out.status === 'autorizada' || out.status === 'cancelada',
    detalhes: { status: out.status }
  });

  await registrarHistoricoNfe({
    notaId,
    evento: 'consulta_automatica',
    usuarioNome: 'sistema-auto',
    detalhes: { tentativa: tentativaIndex + 1, cStat: out.cStat, status: out.status }
  });

  if (out.cStat === '105' || out.cStat === '104' || out.status === 'aguardando_retorno') {
    if (tentativaIndex + 1 < BACKOFF_MS.length) {
      agendarConsultaAutomatica(notaId, tentativaIndex + 1);
    } else {
      await atualizarEstadoOperacional(notaId, {
        status: 'pendente_reenvio',
        fila_estado: 'reenvio',
        erro_codigo: 'LOTE_PROCESSAMENTO',
        erro_mensagem: 'Lote ainda em processamento após várias consultas.',
        erro_sugestao: 'Use REENVIAR ou consulte manualmente a situação.'
      });
    }
    return;
  }

  await atualizarEstadoOperacional(notaId, {
    fila_estado: statusParaFila(out.status),
    consulta_auto_tentativas: tentativaIndex + 1,
    proxima_consulta_em: null
  });
}

async function retomarConsultasPendentes() {
  await garantirSchemaOperacional();
  const rows = await allAsync(`
    SELECT id FROM nfe_notas
    WHERE LOWER(status) IN ('aguardando_retorno','lote_processamento')
       OR erro_codigo = 'LOTE_PROCESSAMENTO'
    ORDER BY id DESC
    LIMIT 50
  `);
  rows.forEach((r, idx) => agendarConsultaAutomatica(r.id, Math.min(idx % BACKOFF_MS.length, 2)));
}

module.exports = {
  garantirSchemaOperacional,
  registrarLogOperacional,
  atualizarEstadoOperacional,
  aplicarResultadoEmissao,
  obterMonitorNfe,
  listarFilaOperacional,
  listarLogsOperacionais,
  executarDiagnosticoFiscal,
  reenviarNfe,
  agendarConsultaAutomatica,
  retomarConsultasPendentes,
  BACKOFF_MS
};
