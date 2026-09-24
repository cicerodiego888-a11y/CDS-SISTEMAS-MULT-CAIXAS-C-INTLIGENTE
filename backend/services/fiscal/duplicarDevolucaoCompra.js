/**
 * Duplica NF-e de devolução autorizada como novo rascunho.
 * Não copia identidade fiscal (chave/número/protocolo/status) nem altera a NF origem.
 * Referência fiscal permanece a NF-e de compra original (DFeReferenciado / nItem da origem).
 */

'use strict';

const db = require('../../database');
const { gravarAuditoria } = require('../auditoria');
const {
  obterRascunhoDevolucaoCompra,
  salvarRascunhoDevolucaoCompra
} = require('./rascunhoDevolucaoCompra');
const {
  obterManifestacao210240,
  obterUltimaManifestacao,
  criarRelacaoSubstituicao,
  montarObservacaoSubstituicao,
  TP_EVENTO_210240
} = require('./nfeDevolucaoSubstituicaoService');
const {
  carregarXmlNfeCompraOrigem,
  parsearDetsDoXml,
  casarItemOrigem
} = require('./espelharTributosNfeDevolucaoCompra');

const OPERACAO_AUDITORIA = 'DUPLICACAO_DEVOLUCAO';
const inflight = new Set();

const STATUS_PERMITIDOS = new Set(['autorizada', 'autorizado']);
const STATUS_BLOQUEADOS = new Set([
  'cancelada',
  'cancelado',
  'rejeitada',
  'rejeitado',
  'inutilizada',
  'inutilizado',
  'rascunho',
  'denegada',
  'denegado'
]);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
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

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function round4(v) {
  return Math.round((Number(v) || 0) * 10000) / 10000;
}

function erro(message, code, statusCode = 400, extra = {}) {
  return Object.assign(new Error(message), { code, statusCode, ...extra });
}

function podeDuplicarNota(nota) {
  if (!nota || !nota.id) {
    return { ok: false, motivo: 'NF-e não encontrada.', code: 'DOCUMENTO_INVALIDO' };
  }
  const status = String(nota.status || '').toLowerCase();
  if (STATUS_BLOQUEADOS.has(status) || !STATUS_PERMITIDOS.has(status)) {
    return { ok: false, motivo: `NF-e com status "${nota.status}" não pode ser duplicada.`, code: 'STATUS_INVALIDO' };
  }
  return { ok: true };
}

function extrairNItemOrigemDoXmlAutorizado(xml, nItemDev) {
  const bloco = String(xml || '').match(
    new RegExp(`<det\\s+nItem="${Number(nItemDev)}"[^>]*>([\\s\\S]*?)</det>`, 'i')
  );
  if (!bloco) return 0;
  const ref = bloco[1].match(/<DFeReferenciado>[\s\S]*?<nItem>\s*(\d+)\s*<\/nItem>/i);
  return ref ? Number(ref[1]) : 0;
}

function recalcularItemRascunho(item) {
  const quantidade = round4(item.quantidade);
  const valor_unitario = Number(item.valor_unitario != null ? item.valor_unitario : 0);
  return {
    ...item,
    quantidade,
    valor_unitario,
    valor_total: round2(quantidade * valor_unitario)
  };
}

function recalcularTotaisRascunho(itens) {
  const linhas = (itens || []).map(recalcularItemRascunho);
  return {
    itens: linhas,
    vProd: round2(linhas.reduce((s, i) => s + Number(i.valor_total || 0), 0)),
    qtdItens: linhas.length
  };
}

async function carregarNotaDevolucao(notaId) {
  const nota = await dbGet(`SELECT * FROM nfe_devolucoes_compra WHERE id = ?`, [Number(notaId)]);
  return nota;
}

async function carregarItensNotaDevolucao(notaId) {
  return dbAll(`
    SELECT
      i.*,
      p.nome AS produto_nome,
      p.codigo AS produto_codigo,
      p.ncm AS produto_ncm,
      p.unidade AS produto_unidade,
      ci.descricao_produto,
      ci.codigo_barras,
      ci.ncm AS compra_ncm,
      ci.unidade AS compra_unidade,
      ci.preco_unitario,
      ci.custo_unitario_final
    FROM nfe_devolucao_compra_itens i
    LEFT JOIN produtos p ON p.id = i.produto_id
    LEFT JOIN compras_itens ci ON ci.id = i.compra_item_id
    WHERE i.nfe_devolucao_id = ?
    ORDER BY i.n_item, i.id
  `, [Number(notaId)]);
}

async function carregarCompra(compraId) {
  return dbGet(`SELECT * FROM compras WHERE id = ?`, [Number(compraId)]);
}

async function resolverVinculosNItemOrigem({ compraId, chaveOrigem, itens, xmlAutorizadoDev }) {
  const chave = onlyDigits(chaveOrigem);
  if (chave.length !== 44) {
    throw erro('NF-e de origem (chave referenciada) inválida ou ausente.', 'REF_ORIGEM_INVALIDA');
  }

  const carregado = await carregarXmlNfeCompraOrigem({ compraId, chave });
  if (!carregado.xml) {
    throw erro(
      'XML da NF-e original não encontrado. Não é possível determinar o nItem com segurança.',
      'XML_ORIGEM_AUSENTE'
    );
  }
  const dets = await parsearDetsDoXml(carregado.xml);
  const usados = new Set();
  const erros = [];

  const vinculados = (itens || []).map((item, idx) => {
    const persistido = Number(item.n_item_origem || item.nItemOrigem || 0);
    const doXmlDev = extrairNItemOrigemDoXmlAutorizado(xmlAutorizadoDev, item.n_item);
    const hint = persistido > 0 ? persistido : doXmlDev;
    const origem = casarItemOrigem({
      ...item,
      nItemOrigem: hint > 0 ? hint : undefined,
      n_item_origem: hint > 0 ? hint : undefined,
      n_item: undefined,
      nItem: undefined,
      produto_codigo: item.produto_codigo,
      produto_nome: item.produto_nome || item.descricao_produto,
      ncm: item.ncm || item.produto_ncm || item.compra_ncm,
      quantidade_comprada: item.quantidade_comprada,
      quantidade_original: item.quantidade_comprada,
      valor_unitario: item.valor_unitario
    }, dets, usados);

    if (!origem || !Number(origem.nItem)) {
      erros.push({
        item: idx + 1,
        compra_item_id: item.compra_item_id,
        produto: item.produto_nome || item.produto_codigo || item.descricao_produto,
        motivo: 'Não foi possível determinar o nItem da NF-e original com segurança.'
      });
      return { ...item, n_item_origem: null };
    }
    return { ...item, n_item_origem: Number(origem.nItem) };
  });

  if (erros.length) {
    throw erro(
      `Vínculo com a NF-e original incompleto. Corrija: ${erros.map((e) => e.produto || `item ${e.item}`).join(', ')}.`,
      'NITEM_ORIGEM_INDETERMINADO',
      400,
      { erros }
    );
  }
  return vinculados;
}

function montarPayloadRascunho({ nota, compra, itens, totais, observacoes }) {
  const chaveOrigem = onlyDigits(nota.chave_referenciada || compra.chave_acesso);
  return {
    fornecedor: compra.fornecedor || '',
    chave_nfe_original: chaveOrigem,
    cfop: nota.cfop || '5202',
    observacoes: observacoes || `Devolução referente à NF-e ${chaveOrigem}.`,
    origem_nfe_devolucao_id: Number(nota.id),
    documento_original_id: Number(nota.id),
    numero_base: nota.numero,
    numero_origem: compra.numero_nf || compra.numero || null,
    chave_referenciada: chaveOrigem,
    totais,
    itens: itens.map((item) => recalcularItemRascunho({
      compra_item_id: Number(item.compra_item_id),
      produto_id: item.produto_id != null ? Number(item.produto_id) : null,
      produto_nome: item.produto_nome || item.descricao_produto || null,
      produto_codigo: item.produto_codigo || null,
      ncm: item.ncm || item.produto_ncm || item.compra_ncm || null,
      unidade: item.unidade || item.produto_unidade || item.compra_unidade || null,
      quantidade: item.quantidade,
      valor_unitario: item.valor_unitario,
      cfop: item.cfop || nota.cfop || '5202',
      n_item_origem: Number(item.n_item_origem),
      v_desc: item.v_desc != null ? Number(item.v_desc) : 0,
      v_frete: item.v_frete != null ? Number(item.v_frete) : 0,
      v_seg: item.v_seg != null ? Number(item.v_seg) : 0,
      v_outro: item.v_outro != null ? Number(item.v_outro) : 0
    }))
  };
}

async function previewDuplicarDevolucaoCompra(notaId) {
  const nota = await carregarNotaDevolucao(notaId);
  const gate = podeDuplicarNota(nota);
  if (!gate.ok) throw erro(gate.motivo, gate.code, 400);

  const itens = await carregarItensNotaDevolucao(nota.id);
  if (!itens.length) {
    throw erro('Documento sem estrutura de itens válida para duplicação.', 'ITENS_INVALIDOS');
  }
  const compra = await carregarCompra(nota.compra_id);
  if (!compra) throw erro('Compra da NF-e não encontrada.', 'DOCUMENTO_INVALIDO');

  const chaveOrigem = onlyDigits(nota.chave_referenciada || compra.chave_acesso);
  const manif210240 = await obterManifestacao210240(nota.id);
  const outraManif = !manif210240 ? await obterUltimaManifestacao(nota.id) : null;
  const aviso210240 = manif210240
    ? 'Esta NF-e possui manifestação do destinatário 210240 — Operação não Realizada. A nova devolução será criada como uma nova emissão e permanecerá vinculada à NF-e anterior para rastreabilidade.'
    : null;
  return {
    success: true,
    podeDuplicar: true,
    notaId: Number(nota.id),
    compraId: Number(nota.compra_id),
    nfBase: nota.numero,
    destinatario: compra.fornecedor || '',
    destinatarioCnpj: compra.fornecedor_cnpj || '',
    nfOrigem: compra.numero_nf || null,
    chaveOrigem,
    chaveBase: nota.chave_acesso || null,
    qtdItens: itens.length,
    temManifestacao210240: Boolean(manif210240),
    tpEventoManifestacao: manif210240 ? TP_EVENTO_210240 : (outraManif && outraManif.tp_evento) || null,
    aviso210240,
    mensagem: aviso210240 || 'Será criado um novo rascunho. A NF-e original não será alterada.'
  };
}

async function comTransacao(fn) {
  await dbRun('BEGIN IMMEDIATE');
  try {
    const out = await fn();
    await dbRun('COMMIT');
    return out;
  } catch (err) {
    try { await dbRun('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function duplicarDevolucaoCompra(notaId, opcoes = {}) {
  const id = Number(notaId);
  if (!id) throw erro('NF-e inválida.', 'DOCUMENTO_INVALIDO');

  const lockKey = `duplicar-dev:${id}`;
  if (inflight.has(lockKey)) {
    throw erro('Duplicação já em andamento para esta NF-e.', 'DUPLICACAO_EM_ANDAMENTO', 409);
  }
  inflight.add(lockKey);

  try {
    const nota = await carregarNotaDevolucao(id);
    const gate = podeDuplicarNota(nota);
    if (!gate.ok) throw erro(gate.motivo, gate.code, 400);

    const snapshotAntes = {
      id: nota.id,
      status: nota.status,
      chave_acesso: nota.chave_acesso,
      protocolo: nota.protocolo,
      numero: nota.numero,
      cstat_retorno: nota.cstat_retorno || null
    };

    const itensBrutos = await carregarItensNotaDevolucao(id);
    if (!itensBrutos.length) {
      throw erro('Documento sem estrutura de itens válida para duplicação.', 'ITENS_INVALIDOS');
    }

    const compra = await carregarCompra(nota.compra_id);
    if (!compra) throw erro('Compra da NF-e não encontrada.', 'DOCUMENTO_INVALIDO');

    const chaveOrigem = onlyDigits(nota.chave_referenciada || compra.chave_acesso);
    const xmlDev = nota.xml_autorizado || nota.xml_assinado || nota.xml_enviado || '';

    const itensVinculados = await resolverVinculosNItemOrigem({
      compraId: nota.compra_id,
      chaveOrigem,
      itens: itensBrutos,
      xmlAutorizadoDev: xmlDev
    });

    const totais = recalcularTotaisRascunho(itensVinculados);
    const manif210240 = await obterManifestacao210240(nota.id);
    const observacoes = manif210240
      ? montarObservacaoSubstituicao({
        numero: nota.numero,
        serie: nota.serie,
        chaveAnterior: nota.chave_acesso,
        chaveCompra: chaveOrigem
      })
      : `Devolução referente à NF-e ${chaveOrigem}.`;
    const payload = montarPayloadRascunho({
      nota,
      compra,
      itens: totais.itens,
      totais: { vProd: totais.vProd, qtdItens: totais.qtdItens },
      observacoes
    });

    const rascunho = await comTransacao(async () => {
      const salvo = await salvarRascunhoDevolucaoCompra(nota.compra_id, payload, {
        usuarioId: opcoes.usuarioId || null,
        usuarioNome: opcoes.usuarioNome || null
      });
      if (!salvo || !salvo.id) {
        throw erro('Falha ao persistir rascunho da nova devolução.', 'RASCUNHO_FALHOU', 500);
      }
      if (manif210240) {
        await criarRelacaoSubstituicao({
          notaAnterior: nota,
          rascunhoId: salvo.id,
          manifestacao: manif210240,
          observacao: observacoes,
          usuarioId: opcoes.usuarioId || null,
          usuarioNome: opcoes.usuarioNome || null
        });
      }
      await gravarAuditoria({
        usuario_id: opcoes.usuarioId || null,
        usuario_nome: opcoes.usuarioNome || null,
        modulo: 'nfe_devolucao_compra',
        acao: OPERACAO_AUDITORIA,
        referencia_tipo: 'nfe_devolucao_compra_rascunho',
        referencia_id: salvo.id,
        detalhes: {
          operacao: OPERACAO_AUDITORIA,
          documento_original_id: nota.id,
          novo_documento_id: salvo.id,
          compra_id: nota.compra_id,
          nf_base: nota.numero,
          chave_base: nota.chave_acesso,
          nf_origem: compra.numero_nf || null,
          chave_origem: chaveOrigem,
          qtd_itens: totais.qtdItens,
          vProd: totais.vProd
        },
        ip_requisicao: opcoes.ip || null
      });
      return salvo;
    });

    const notaDepois = await carregarNotaDevolucao(id);
    if (
      String(notaDepois.status) !== String(snapshotAntes.status)
      || String(notaDepois.chave_acesso || '') !== String(snapshotAntes.chave_acesso || '')
      || String(notaDepois.protocolo || '') !== String(snapshotAntes.protocolo || '')
    ) {
      throw erro('A NF-e original foi alterada indevidamente. Operação abortada.', 'INTEGRIDADE_ORIGEM', 500);
    }

    return {
      success: true,
      message: 'Nova devolução criada com sucesso.',
      rascunhoId: rascunho.id,
      compraId: Number(nota.compra_id),
      documentoOriginalId: Number(nota.id),
      novoDocumentoId: rascunho.id,
      status: rascunho.status,
      qtdItens: (rascunho.itens || []).length,
      vProd: totais.vProd,
      chaveOrigem,
      nfBase: nota.numero,
      nfOrigem: compra.numero_nf || null,
      destinatario: compra.fornecedor || '',
      temManifestacao210240: Boolean(manif210240),
      rascunho
    };
  } finally {
    inflight.delete(lockKey);
  }
}

module.exports = {
  OPERACAO_AUDITORIA,
  STATUS_PERMITIDOS,
  STATUS_BLOQUEADOS,
  podeDuplicarNota,
  recalcularItemRascunho,
  recalcularTotaisRascunho,
  extrairNItemOrigemDoXmlAutorizado,
  resolverVinculosNItemOrigem,
  previewDuplicarDevolucaoCompra,
  duplicarDevolucaoCompra
};
