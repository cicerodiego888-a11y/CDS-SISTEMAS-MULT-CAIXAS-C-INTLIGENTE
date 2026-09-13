/**
 * RC4.0.0 / RC4.0.1 / RC4.0.2 — Central de Faturamento (Centro Operacional Fiscal).
 * Recebe venda já criada pela Expedição. Não altera estoque/financeiro/motores.
 * Emite NF-e exclusivamente via emitirNfePorVendaId.
 * RC4.0.1: pendências, timeline, documentos, resumo, log SEFAZ, alertas.
 * RC4.0.2: painel operacional (fila ampla, dashboard, lote, eventos).
 */

'use strict';

const fs = require('fs');
const db = require('../../database');
const configService = require('../configuracaoService');
const { getFiscalConfig } = require('../fiscal/configService');
const { emitirNfePorVendaId, obterNotaNfePorVenda } = require('../fiscal/nfeEmissorVenda');

function assertModuloNfe() {
  if (!configService.recursoHabilitado('nfe')) {
    const err = new Error('Módulo NF-e desabilitado.');
    err.statusCode = 404;
    err.codigo = 'MODULO_NFE_DESABILITADO';
    throw err;
  }
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
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

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

async function carregarVendaCompleta(vendaId) {
  const id = Number(vendaId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Venda inválida.');
    err.statusCode = 400;
    throw err;
  }

  const venda = await dbGet(`
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
      c.uf AS cliente_uf
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.id = ?
  `, [id]);

  if (!venda) {
    const err = new Error('Venda não encontrada.');
    err.statusCode = 404;
    throw err;
  }

  const itens = await dbAll(`
    SELECT
      vi.*,
      p.nome AS produto_nome,
      p.ncm AS produto_ncm,
      p.cfop AS produto_cfop,
      p.csosn AS produto_csosn,
      p.origem AS produto_origem,
      p.codigo AS produto_codigo,
      p.unidade AS produto_unidade
    FROM vendas_itens vi
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE vi.venda_id = ?
    ORDER BY vi.id
  `, [id]);

  let pedido = null;
  if (venda.pedido_id) {
    pedido = await dbGet(`SELECT * FROM pedidos WHERE id = ?`, [venda.pedido_id]);
  }

  const nota = await obterNotaNfePorVenda(id);

  return { venda, itens, pedido, nota };
}

async function listarFila(query = {}) {
  const Painel = require('./CentralPainelOperacionalService');
  return Painel.listarFilaOperacional(query);
}

function itemChecklist(codigo, rotulo, nivel, detalhe = '') {
  return { codigo, rotulo, nivel, detalhe: detalhe || '' };
}

function inspecionarCertificado(config) {
  const certPath = String(config.certificadoPath || '').trim();
  if (!certPath || !fs.existsSync(certPath)) {
    return { instalado: false, valido: false, diasRestantes: null, detalhe: 'Certificado A1/PFX não encontrado' };
  }
  try {
    const { carregarCertificadoPfx } = require('../fiscal/certificateService');
    const forge = require('node-forge');
    const pfx = carregarCertificadoPfx(certPath, config.certificadoSenha || '');
    const cert = forge.pki.certificateFromPem(pfx.certPem);
    const notAfter = cert.validity.notAfter;
    const dias = Math.floor((notAfter.getTime() - Date.now()) / 86400000);
    if (dias < 0) {
      return { instalado: true, valido: false, diasRestantes: dias, detalhe: `Vencido em ${notAfter.toISOString().slice(0, 10)}` };
    }
    return {
      instalado: true,
      valido: true,
      diasRestantes: dias,
      detalhe: `Válido até ${notAfter.toISOString().slice(0, 10)} (${dias} dias)`
    };
  } catch (e) {
    return { instalado: true, valido: false, diasRestantes: null, detalhe: e.message || 'Falha ao ler certificado' };
  }
}

/**
 * @param {object} pacote — retorno de carregarVendaCompleta
 * @param {object} [dadosNfe]
 */
async function montarChecklist(pacote, dadosNfe = {}) {
  const { venda, itens, pedido, nota } = pacote;
  const itensList = Array.isArray(itens) ? itens : [];
  const itensFiscais = itensList.filter(
    (i) => Number(i.quantidade_fiscal || 0) > 0 && Number(i.valor_fiscal || 0) > 0
  );

  const nome = String(venda.cliente_nome || '').trim();
  const cpfCnpj = onlyDigits(
    dadosNfe.dest_cnpj
    || dadosNfe.dest_cpf
    || dadosNfe.dest_documento
    || venda.cliente_cpf
    || venda.cpf_cnpj_nota
    || ''
  );
  const docOk = (cpfCnpj.length === 11 || cpfCnpj.length === 14) && !/^0+$/.test(cpfCnpj);

  const rua = String(dadosNfe.dest_logradouro || venda.cliente_rua || '').trim();
  const cidade = String(dadosNfe.dest_municipio || venda.cliente_cidade || '').trim();
  const uf = String(dadosNfe.dest_uf || venda.cliente_uf || '').trim();
  const cep = onlyDigits(dadosNfe.dest_cep || venda.cliente_cep || '');
  const indIe = String(dadosNfe.dest_ind_ie || dadosNfe.indIEDest || '9').trim();

  const natureza = String(
    dadosNfe.natureza_operacao
    || pedido?.natureza_operacao
    || nota?.natureza_operacao
    || 'VENDA DE MERCADORIA'
  ).trim();
  const cfop = onlyDigits(dadosNfe.cfop || pedido?.cfop || nota?.cfop || '5102');

  let config = {};
  try {
    config = await getFiscalConfig({ validarUrls: false });
  } catch (e) {
    config = { _erro: e.message };
  }

  const certInfo = inspecionarCertificado(config);
  const serie = Number(config.serieNfe || config.serie || 0);
  const numero = Number(config.numeroAtual || 0)
    || Number(await dbGet(`SELECT valor FROM configuracoes WHERE chave = 'fiscal_numero_atual_nfe'`).then((r) => r?.valor).catch(() => 0))
    || 0;
  const ambiente = Number(config.ambiente) === 1 ? 1 : 2;
  const ambienteOk = !config._erro && (Number(config.ambiente) === 1 || Number(config.ambiente) === 2);

  const ncmRuins = itensFiscais.filter((i) => onlyDigits(i.produto_ncm || i.ncm || '').length < 8);
  const cfgRuins = itensFiscais.filter((i) => {
    const csosn = String(i.produto_csosn || i.csosn || '').trim();
    const cfopItem = onlyDigits(i.produto_cfop || i.cfop || cfop || '');
    return !csosn || cfopItem.length !== 4;
  });

  const xmlPronto = Boolean(
    (nota && (nota.xml_enviado || nota.xml_retorno))
    || (docOk && itensFiscais.length > 0 && natureza && cfop.length === 4 && certInfo.valido)
  );

  const checklistItens = [
    itemChecklist('cpf_cnpj', 'Cliente possui CPF/CNPJ', docOk ? 'ok' : 'erro', docOk ? cpfCnpj : 'Ausente ou inválido'),
    itemChecklist('nome', 'Cliente possui Nome', nome.length >= 2 ? 'ok' : 'erro', nome || 'Nome ausente'),
    itemChecklist('cep', 'Cliente possui CEP', cep.length === 8 ? 'ok' : 'erro', cep.length === 8 ? cep : 'CEP ausente'),
    itemChecklist('municipio', 'Cliente possui Município', cidade ? 'ok' : 'erro', cidade || 'Município ausente'),
    itemChecklist('uf', 'Cliente possui UF', uf.length === 2 ? 'ok' : 'erro', uf || 'UF ausente'),
    itemChecklist('endereco', 'Cliente possui Endereço', rua ? 'ok' : 'erro', rua || 'Logradouro ausente'),
    itemChecklist('ind_ie', 'Cliente possui Indicador IE', ['1', '2', '9'].includes(indIe) ? 'ok' : 'atencao', `indIEDest=${indIe || '?'}`),
    itemChecklist('natureza', 'Natureza da Operação', natureza.length >= 2 ? 'ok' : 'erro', natureza || 'Informe a natureza'),
    itemChecklist('cfop', 'CFOP', cfop.length === 4 ? 'ok' : 'erro', cfop || 'CFOP inválido'),
    itemChecklist('ncm', 'Todos os produtos possuem NCM', ncmRuins.length === 0 && itensFiscais.length > 0 ? 'ok' : (itensFiscais.length ? 'erro' : 'atencao'), ncmRuins.length ? `${ncmRuins.length} sem NCM` : 'NCM ok'),
    itemChecklist('cfg_produtos', 'Produtos com configuração fiscal', cfgRuins.length === 0 && itensFiscais.length > 0 ? 'ok' : (itensFiscais.length ? 'erro' : 'atencao'), cfgRuins.length ? `${cfgRuins.length} sem CSOSN/CFOP` : 'Configuração ok'),
    itemChecklist('itens_fiscais', 'Itens fiscais do Motor', itensFiscais.length > 0 ? 'ok' : 'erro', itensFiscais.length ? `${itensFiscais.length} item(ns)` : 'Sem parcela fiscal'),
    itemChecklist('cert_instalado', 'Certificado Digital instalado', certInfo.instalado ? 'ok' : 'erro', certInfo.detalhe),
    itemChecklist('cert_valido', 'Certificado válido', certInfo.valido ? 'ok' : 'erro', certInfo.detalhe),
    itemChecklist('serie', 'Série configurada', serie > 0 ? 'ok' : 'atencao', serie > 0 ? String(serie) : 'Usará padrão 1'),
    itemChecklist('numeracao', 'Numeração disponível', 'ok', `Próximo: ${numero || '(auto)'}`),
    itemChecklist('ambiente', 'Ambiente configurado', ambienteOk ? 'ok' : 'erro', ambienteOk ? (ambiente === 1 ? 'Produção' : 'Homologação') : (config._erro || 'Não configurado')),
    itemChecklist('csc', 'CSC (quando NFC-e)', 'ok', 'Não aplicável — NF-e modelo 55'),
    itemChecklist('xml_pronto', 'XML pronto para geração', xmlPronto ? 'ok' : 'atencao', xmlPronto ? 'Dados suficientes / XML existente' : 'Complete pendências antes de gerar')
  ];

  const resumo = {
    ok: checklistItens.filter((i) => i.nivel === 'ok').length,
    atencao: checklistItens.filter((i) => i.nivel === 'atencao').length,
    erro: checklistItens.filter((i) => i.nivel === 'erro').length
  };
  const podeEmitir = resumo.erro === 0;
  const mensagemBloqueio = podeEmitir
    ? null
    : 'Existem pendências fiscais que impedem a emissão.';

  return {
    success: true,
    pode_emitir: podeEmitir,
    mensagem_bloqueio: mensagemBloqueio,
    itens: checklistItens,
    resumo,
    dados_avaliados: {
      natureza,
      cfop,
      ambiente,
      serie: serie || 1,
      documento: docOk ? cpfCnpj : null,
      cert: certInfo
    }
  };
}

function montarAlertas(checklist, pacote, dadosNfe = {}) {
  const alertas = [];
  const cert = checklist.dados_avaliados?.cert || {};
  if (cert.diasRestantes != null && cert.diasRestantes >= 0 && cert.diasRestantes <= 30) {
    alertas.push({ nivel: 'atencao', codigo: 'CERT_VENCIMENTO', texto: `Certificado vence em ${cert.diasRestantes} dias` });
  }
  if (cert.diasRestantes != null && cert.diasRestantes < 0) {
    alertas.push({ nivel: 'erro', codigo: 'CERT_VENCIDO', texto: 'Certificado Digital vencido' });
  }
  const num = Number(checklist.dados_avaliados?.serie);
  if (checklist.itens?.find((i) => i.codigo === 'cpf_cnpj' && i.nivel === 'erro')) {
    alertas.push({ nivel: 'erro', codigo: 'SEM_DOC', texto: 'Cliente sem documento (CPF/CNPJ)' });
  }
  if (checklist.itens?.find((i) => i.codigo === 'ncm' && i.nivel === 'erro')) {
    alertas.push({ nivel: 'erro', codigo: 'SEM_NCM', texto: 'Produto sem NCM' });
  }
  if (checklist.itens?.find((i) => i.codigo === 'cfg_produtos' && i.nivel === 'erro')) {
    alertas.push({ nivel: 'erro', codigo: 'SEM_CFG_PROD', texto: 'Produto sem configuração fiscal' });
  }
  if (checklist.dados_avaliados?.ambiente === 2) {
    alertas.push({ nivel: 'atencao', codigo: 'HOMOLOG', texto: 'Ambiente em Homologação' });
  }
  const numeroTxt = checklist.itens?.find((i) => i.codigo === 'numeracao')?.detalhe || '';
  const mNum = numeroTxt.match(/(\d+)/);
  if (mNum && Number(mNum[1]) > 900000) {
    alertas.push({ nivel: 'atencao', codigo: 'NUM_LIMITE', texto: 'Numeração próxima do limite' });
  }
  void num;
  void pacote;
  void dadosNfe;
  return alertas;
}

function etapaTimeline(id, rotulo, status, meta = {}) {
  return {
    id,
    rotulo,
    status, // pendente | atual | concluido | erro
    data: meta.data || null,
    hora: meta.hora || null,
    usuario: meta.usuario || null,
    mensagem: meta.mensagem || '',
    cstat: meta.cstat || null,
    sugestao: meta.sugestao || null
  };
}

function splitDateTime(raw) {
  if (!raw) return { data: null, hora: null };
  const s = String(raw).replace('T', ' ');
  const [d, h] = s.split(' ');
  return { data: d || null, hora: (h || '').slice(0, 8) || null };
}

async function montarTimeline(pacote) {
  const { venda, pedido, nota } = pacote;
  let historico = [];
  if (nota?.id) {
    try {
      const { listarHistoricoNfe } = require('../fiscal/nfeCentralService');
      historico = await listarHistoricoNfe(nota.id, 50);
    } catch (_) { /* ignore */ }
  }

  const st = String(nota?.status || '').toLowerCase();
  const pedidoDt = splitDateTime(pedido?.created_at || pedido?.criado_em);
  const vendaDt = splitDateTime(venda?.data_venda || venda?.created_at);
  const notaDt = splitDateTime(nota?.created_at);
  const updDt = splitDateTime(nota?.updated_at || nota?.ultima_tentativa_em);

  const etapas = [
    etapaTimeline('pedido', 'Pedido Criado', pedido ? 'concluido' : 'pendente', {
      ...pedidoDt,
      usuario: pedido?.operador_nome || null,
      mensagem: pedido ? `Pedido #${pedido.id}` : 'Sem pedido vinculado'
    }),
    etapaTimeline('separacao', 'Separação', pedido ? 'concluido' : 'pendente', {
      mensagem: 'Etapa logística comercial'
    }),
    etapaTimeline('expedicao', 'Expedição', venda ? 'concluido' : 'pendente', {
      ...vendaDt,
      mensagem: venda ? `Venda #${venda.id} gerada no Núcleo` : 'Aguardando expedição'
    }),
    etapaTimeline('venda', 'Venda Criada', venda ? 'concluido' : 'pendente', {
      ...vendaDt,
      mensagem: venda ? `Total ${Number(venda.total || 0).toFixed(2)}` : ''
    }),
    etapaTimeline('central', 'Central de Faturamento', 'atual', {
      mensagem: 'Conferência e emissão fiscal'
    }),
    etapaTimeline('validacao', 'Validação Fiscal', st ? 'concluido' : 'atual', {
      mensagem: st ? `Status: ${st}` : 'Checklist em andamento'
    }),
    etapaTimeline('xml_gerado', 'XML Gerado', nota?.xml_enviado ? 'concluido' : 'pendente', {
      ...notaDt,
      mensagem: nota?.xml_enviado ? 'XML enviado disponível' : 'Aguardando geração'
    }),
    etapaTimeline('xml_assinado', 'XML Assinado', nota?.xml_enviado ? 'concluido' : 'pendente', {
      mensagem: nota?.xml_enviado ? 'Assinatura aplicada' : ''
    }),
    etapaTimeline('transmitido', 'Transmitido', nota?.xml_retorno || st ? 'concluido' : 'pendente', {
      ...updDt,
      mensagem: nota?.ultima_tentativa_em ? `Tentativa em ${nota.ultima_tentativa_em}` : ''
    }),
    etapaTimeline('processado', 'Processado pela SEFAZ', nota?.xml_retorno ? 'concluido' : 'pendente', {
      cstat: nota?.cstat_consulta || null,
      mensagem: nota?.xmotivo_consulta || nota?.erro_mensagem || ''
    }),
    etapaTimeline('autorizado', 'Autorizado', st === 'autorizada' ? 'concluido' : (st && st !== 'autorizada' ? 'erro' : 'pendente'), {
      ...updDt,
      mensagem: st === 'autorizada' ? `Protocolo ${nota?.protocolo || '—'}` : (nota?.erro_mensagem || st || ''),
      cstat: nota?.erro_codigo || nota?.cstat_consulta || null,
      sugestao: nota?.erro_sugestao || null
    }),
    etapaTimeline('danfe', 'DANFE Gerada', nota?.danfe_html ? 'concluido' : 'pendente', {
      mensagem: nota?.danfe_html ? 'DANFE disponível' : ''
    }),
    etapaTimeline('entrega', 'Pronto para Entrega', st === 'autorizada' ? 'concluido' : 'pendente', {
      mensagem: st === 'autorizada' ? 'Documento autorizado' : 'Aguardando autorização'
    })
  ];

  const eventos = (historico || []).map((h) => {
    const dt = splitDateTime(h.criado_em || h.created_at);
    return {
      evento: h.acao,
      ...dt,
      usuario: h.usuario_nome || null,
      detalhes: h.detalhes || null
    };
  });

  const temRejeicao = Boolean(
    nota && (st === 'rejeitada' || st === 'denegada' || nota.erro_codigo || nota.erro_mensagem)
    && st !== 'autorizada'
  );
  return {
    etapas,
    eventos,
    rejeicao: temRejeicao ? {
      codigo: nota.erro_codigo || nota.cstat_consulta || null,
      descricao: nota.erro_mensagem || nota.xmotivo_consulta || st,
      sugestao: nota.erro_sugestao || null
    } : null
  };
}

function montarResumoFiscal(pacote, dadosNfe = {}, checklist = null) {
  const { venda, itens, pedido, nota } = pacote;
  const itensList = Array.isArray(itens) ? itens : [];
  const vProd = itensList.reduce((s, i) => s + Number(i.valor_fiscal || i.subtotal || 0), 0);
  const frete = Number(dadosNfe.frete != null ? dadosNfe.frete : (pedido?.frete || venda.frete || 0));
  const desconto = Number(dadosNfe.desconto != null ? dadosNfe.desconto : (venda.desconto || 0));
  const acrescimo = Number(dadosNfe.acrescimo != null ? dadosNfe.acrescimo : (pedido?.acrescimo || 0));
  const valorNota = Number(venda.valor_fiscal != null ? venda.valor_fiscal : venda.total || 0);
  return {
    numero: nota?.numero || null,
    serie: nota?.serie || checklist?.dados_avaliados?.serie || null,
    modelo: 55,
    ambiente: nota?.ambiente != null ? nota.ambiente : checklist?.dados_avaliados?.ambiente,
    cfop: dadosNfe.cfop || pedido?.cfop || nota?.cfop || checklist?.dados_avaliados?.cfop || null,
    natureza: dadosNfe.natureza_operacao || pedido?.natureza_operacao || nota?.natureza_operacao || null,
    valor: valorNota,
    qtd_itens: itensList.length,
    peso: Number(dadosNfe.peso != null ? dadosNfe.peso : (pedido?.peso || 0)),
    volumes: Number(dadosNfe.volumes != null ? dadosNfe.volumes : (pedido?.volumes || 0)),
    transportadora: dadosNfe.transportadora || pedido?.transportadora || null,
    forma_pagamento: venda.forma_pagamento || null,
    valor_produtos: vProd,
    valor_nota: valorNota,
    valor_frete: frete,
    valor_desconto: desconto,
    valor_acrescimo: acrescimo,
    valor_final: valorNota
  };
}

function montarLogSefaz(pacote) {
  const { nota } = pacote;
  if (!nota) {
    return {
      disponivel: false,
      mensagem: 'Ainda não houve transmissão à SEFAZ.'
    };
  }
  const rejeicao = nota.status !== 'autorizada' && (nota.erro_mensagem || nota.xmotivo_consulta);
  return {
    disponivel: true,
    ultima_transmissao: nota.ultima_tentativa_em || nota.updated_at || nota.created_at || null,
    ultima_resposta: nota.consultado_em || nota.updated_at || null,
    cStat: nota.cstat_consulta || nota.erro_codigo || null,
    xMotivo: nota.xmotivo_consulta || nota.erro_mensagem || null,
    protocolo: nota.protocolo || null,
    chave: nota.chave_acesso || null,
    tempo_ms: nota.tempo_resposta_ms || null,
    tentativas: nota.tentativas || 0,
    tem_xml_enviado: Boolean(nota.xml_enviado),
    tem_xml_retorno: Boolean(nota.xml_retorno),
    status: nota.status,
    rejeicao: rejeicao ? {
      motivo: nota.erro_mensagem || nota.xmotivo_consulta,
      possivel_causa: nota.erro_sugestao || 'Consulte o XML enviado e o checklist.',
      link_xml: `/api/central-faturamento/vendas/${nota.venda_id}/xml`
    } : null
  };
}

function montarAcoesDocumentos(pacote) {
  const nota = pacote.nota;
  const st = String(nota?.status || '').toLowerCase();
  const autorizada = st === 'autorizada';
  const cancelada = st === 'cancelada';
  const temXml = Boolean(nota && (nota.xml_enviado || nota.xml_retorno));
  const temDanfe = Boolean(nota?.danfe_html);
  const temChave = Boolean(nota?.chave_acesso);
  const podeReenviar = nota && !autorizada && !cancelada && st !== 'denegada';

  return {
    visualizar_xml: { habilitado: temXml, label: 'Visualizar XML' },
    download_xml: { habilitado: temXml, label: 'Download XML' },
    visualizar_danfe: { habilitado: temDanfe, label: 'Visualizar DANFE' },
    reimprimir_danfe: { habilitado: temDanfe, label: 'Reimprimir DANFE' },
    copiar_chave: { habilitado: temChave, label: 'Copiar Chave de Acesso', valor: nota?.chave_acesso || null },
    consultar_situacao: { habilitado: Boolean(nota?.id), label: 'Consultar Situação' },
    reenviar: { habilitado: Boolean(podeReenviar), label: 'Reenviar NF-e' },
    cancelar: { habilitado: autorizada, label: 'Cancelar NF-e' },
    carta_correcao: { habilitado: false, label: 'Carta de Correção', preparado: true, mensagem: 'Estrutura preparada — disponível em RC futura' },
    manifestacao: { habilitado: false, label: 'Manifestação', preparado: true, mensagem: 'Estrutura preparada — disponível em RC futura' }
  };
}

const MODULOS_FUTUROS = Object.freeze([
  { id: 'nfe', label: 'NF-e', ativo: true },
  { id: 'nfce', label: 'NFC-e', ativo: false, preparado: true },
  { id: 'mdfe', label: 'MDF-e', ativo: false, preparado: true },
  { id: 'cte', label: 'CT-e', ativo: false, preparado: true },
  { id: 'devolucao', label: 'Devolução', ativo: false, preparado: true },
  { id: 'cce', label: 'Carta de Correção', ativo: false, preparado: true },
  { id: 'inutilizacao', label: 'Inutilização', ativo: false, preparado: true },
  { id: 'manifestacao', label: 'Manifestação do Destinatário', ativo: false, preparado: true }
]);

async function obterPacote(vendaId, dadosNfe = {}) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  const checklist = await montarChecklist(pacote, dadosNfe);
  const alertas = montarAlertas(checklist, pacote, dadosNfe);
  const timeline = await montarTimeline(pacote);
  const resumo_fiscal = montarResumoFiscal(pacote, dadosNfe, checklist);
  const log_sefaz = montarLogSefaz(pacote);
  const documentos = montarAcoesDocumentos(pacote);
  const statusFiscal = pacote.nota?.status
    || (checklist.pode_emitir ? 'aguardando_emissao' : 'pendencias');

  return {
    success: true,
    ...pacote,
    status_comercial: pacote.pedido?.status || 'FATURADO',
    status_logistico: 'expedido',
    status_fiscal: statusFiscal,
    checklist,
    pendencias: checklist,
    alertas,
    timeline,
    resumo_fiscal,
    log_sefaz,
    documentos,
    modulos_futuros: MODULOS_FUTUROS,
    mensagem_bloqueio: checklist.mensagem_bloqueio
  };
}

async function obterChecklist(vendaId, dadosNfe = {}) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  const checklist = await montarChecklist(pacote, dadosNfe);
  return {
    ...checklist,
    alertas: montarAlertas(checklist, pacote, dadosNfe)
  };
}

async function consultarSituacao(vendaId, ctx = {}) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  if (!pacote.nota?.id) {
    const err = new Error('NF-e não encontrada para consulta.');
    err.statusCode = 404;
    throw err;
  }
  const nfeCentral = require('../fiscal/nfeCentralService');
  return nfeCentral.consultarSituacaoNfe(pacote.nota.id, {
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip
  });
}

async function salvarDadosFiscais(vendaId, dadosNfe = {}) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  const natureza = String(dadosNfe.natureza_operacao || '').trim() || null;
  const cfop = onlyDigits(dadosNfe.cfop || '') || null;

  if (pacote.pedido?.id && (natureza || cfop)) {
    try {
      await dbRun(
        `UPDATE pedidos SET
          natureza_operacao = COALESCE(?, natureza_operacao),
          cfop = COALESCE(?, cfop)
         WHERE id = ?`,
        [natureza, cfop, pacote.pedido.id]
      );
    } catch (_) { /* colunas podem não existir em legado */ }
  }

  if (pacote.nota?.id && pacote.nota.status !== 'autorizada') {
    await dbRun(
      `UPDATE nfe_notas SET
        natureza_operacao = COALESCE(?, natureza_operacao),
        cfop = COALESCE(?, cfop),
        updated_at = datetime('now','localtime')
       WHERE id = ?`,
      [natureza, cfop, pacote.nota.id]
    );
  }

  if (dadosNfe.observacoes != null || dadosNfe.dados_adicionais != null) {
    const obs = String(dadosNfe.observacoes || dadosNfe.dados_adicionais || '').trim();
    if (obs) {
      try {
        await dbRun(`UPDATE vendas SET observacao = ? WHERE id = ?`, [obs, Number(vendaId)]);
      } catch (_) { /* ignore */ }
    }
  }

  return { success: true, message: 'Dados fiscais salvos.', venda_id: Number(vendaId) };
}

async function emitir(vendaId, body = {}, reqHttp = {}) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  const dadosNfe = body.dadosNfe || body || {};
  const checklist = await montarChecklist(pacote, dadosNfe);

  if (!checklist.pode_emitir) {
    const err = new Error(checklist.mensagem_bloqueio || 'Existem pendências fiscais que impedem a emissão.');
    err.statusCode = 400;
    err.codigo = 'CHECKLIST_BLOQUEADO';
    err.checklist = checklist;
    throw err;
  }

  if (pacote.nota && pacote.nota.status === 'autorizada') {
    return {
      success: true,
      reused: true,
      message: 'NF-e já autorizada para esta venda.',
      nfe: {
        success: true,
        status: 'autorizada',
        notaId: pacote.nota.id,
        numero: pacote.nota.numero,
        chaveAcesso: pacote.nota.chave_acesso,
        protocolo: pacote.nota.protocolo,
        danfeHtml: pacote.nota.danfe_html
      }
    };
  }

  const nfe = await emitirNfePorVendaId(Number(vendaId), {
    dadosNfe,
    pedidoId: pacote.venda.pedido_id || null,
    usuarioId: reqHttp.user?.id || body.usuarioId || null,
    usuarioNome: reqHttp.user?.nome || body.usuarioNome || null,
    forcarReemissao: Boolean(body.forcarReemissao)
  });

  return {
    success: Boolean(nfe?.success),
    nfe,
    checklist,
    message: nfe?.message || (nfe?.success ? 'NF-e autorizada.' : 'NF-e não autorizada.')
  };
}

async function reenviar(vendaId, ctx = {}) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  if (!pacote.nota?.id) {
    return emitir(vendaId, { forcarReemissao: true }, ctx.reqHttp || {});
  }
  const nfeOperacional = require('../fiscal/nfeOperacionalService');
  return nfeOperacional.reenviarNfe(pacote.nota.id, {
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip
  });
}

async function obterXml(vendaId) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  if (!pacote.nota) {
    const err = new Error('NF-e não encontrada para esta venda.');
    err.statusCode = 404;
    throw err;
  }
  const nfeCentral = require('../fiscal/nfeCentralService');
  const xml = nfeCentral.extrairXmlAutorizado(pacote.nota)
    || pacote.nota.xml_enviado
    || '';
  if (!xml) {
    const err = new Error('XML não disponível.');
    err.statusCode = 404;
    throw err;
  }
  return {
    success: true,
    xml,
    chave: pacote.nota.chave_acesso,
    status: pacote.nota.status,
    nota_id: pacote.nota.id
  };
}

async function obterDanfe(vendaId) {
  assertModuloNfe();
  const pacote = await carregarVendaCompleta(vendaId);
  if (!pacote.nota?.danfe_html) {
    const err = new Error('DANFE não disponível.');
    err.statusCode = 404;
    throw err;
  }
  return {
    success: true,
    danfe_html: pacote.nota.danfe_html,
    nota_id: pacote.nota.id,
    numero: pacote.nota.numero
  };
}

async function cancelarNota(notaId, justificativa, ctx = {}) {
  assertModuloNfe();
  const nfeCentral = require('../fiscal/nfeCentralService');
  return nfeCentral.cancelarNfeCentral(notaId, justificativa, {
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip,
    forcarPrazo: Boolean(ctx.forcarPrazo)
  });
}

module.exports = {
  listarFila,
  obterPacote,
  obterChecklist,
  salvarDadosFiscais,
  emitir,
  reenviar,
  obterXml,
  obterDanfe,
  cancelarNota,
  consultarSituacao,
  montarChecklist,
  montarAlertas,
  montarTimeline,
  montarResumoFiscal,
  montarLogSefaz,
  montarAcoesDocumentos,
  carregarVendaCompleta,
  MODULOS_FUTUROS,
  // RC4.0.2 — painel operacional
  obterPainelInicial: (...a) => require('./CentralPainelOperacionalService').obterPainelInicial(...a),
  obterDashboard: (...a) => require('./CentralPainelOperacionalService').obterDashboard(...a),
  obterStatusSefaz: (...a) => require('./CentralPainelOperacionalService').obterStatusSefaz(...a),
  obterPainelRejeicoes: (...a) => require('./CentralPainelOperacionalService').obterPainelRejeicoes(...a),
  listarEventosGlobais: (...a) => require('./CentralPainelOperacionalService').listarEventosGlobais(...a),
  executarAcoesLote: (...a) => require('./CentralPainelOperacionalService').executarAcoesLote(...a),
  TIPOS_DOCUMENTO_FISCAL: require('./CentralPainelOperacionalService').TIPOS_DOCUMENTO_FISCAL,
  FILTROS_RAPIDOS: require('./CentralPainelOperacionalService').FILTROS_RAPIDOS
};
