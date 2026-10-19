const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');
const db = require('../../database');
const { getFiscalDir, getFiscalSubDir } = require('./paths');

function dbGet(sql, params = [], dbOverride) {
  const dbConn = dbOverride || db;
  return new Promise((resolve, reject) => {
    dbConn.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function dbAll(sql, params = [], dbOverride) {
  const dbConn = dbOverride || db;
  return new Promise((resolve, reject) => {
    dbConn.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function normalizarData(valor) {
  const texto = String(valor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return null;
  }
  return texto;
}

function csvEscape(valor) {
  const texto = String(valor ?? '');
  if (/[;"\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function linhaCsv(campos) {
  return `${campos.map(csvEscape).join(';')}\n`;
}

function agoraLocalBrasil() {
  const agora = new Date();
  const dataBrasil = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');
  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

/**
 * RC3.19 — Extrai o XML autorizado da NFC-e.
 *
 * Prioridade:
 *   1. xml_retorno com <nfeProc> (XML oficial autorizado + protocolo SEFAZ)
 *   2. xml_enviado com <NFe> (XML assinado enviado — fallback compatível)
 *   3. <NFe> extraído de xml_retorno
 *
 * Não utiliza o XML de envio como prova isolada de autorização: prefere o
 * retorno SEFAZ quando este contém o nfeProc completo.
 */
function extrairXmlNfceAutorizado(nota) {
  const retorno = String(nota?.xml_retorno || '');
  const nfeProc = retorno.match(/<nfeProc[\s\S]*?<\/nfeProc>/i);
  if (nfeProc) {
    return nfeProc[0];
  }

  const xmlEnviado = String(nota?.xml_enviado || '').trim();
  if (xmlEnviado && xmlEnviado.includes('<NFe')) {
    return xmlEnviado.startsWith('<?xml')
      ? xmlEnviado
      : `<?xml version="1.0" encoding="UTF-8"?>\n${xmlEnviado}`;
  }

  const nfe = retorno.match(/<NFe[\s\S]*?<\/NFe>/i);
  if (nfe) {
    return nfe[0];
  }

  return null;
}

/** Mesmo extrator da NFC-e — NF-e usa xml_enviado / xml_retorno em nfe_notas. */
const extrairXmlNfeAutorizado = extrairXmlNfceAutorizado;

function nomeArquivoNfce(nota) {
  const chave = String(nota.chave_acesso || '').replace(/\D/g, '');
  if (chave.length === 44) {
    return `${chave}.xml`;
  }
  const numero = nota.numero || nota.venda_codigo || nota.id;
  const serie = nota.serie || 1;
  return `NFCE_${serie}_${numero}.xml`;
}

function nomeArquivoNfe(nota) {
  const chave = String(nota.chave_acesso || '').replace(/\D/g, '');
  if (chave.length === 44) {
    return `${chave}.xml`;
  }
  const numero = nota.numero || nota.venda_codigo || nota.id;
  const serie = nota.serie || 1;
  return `NFE_${serie}_${numero}.xml`;
}

function nomeArquivoEntrada(doc) {
  const chave = String(doc.chave_acesso || doc.chave || '').replace(/\D/g, '');
  if (chave.length === 44) {
    return `${chave}.xml`;
  }
  const numero = doc.numero_nf || doc.numero || doc.id;
  return `ENTRADA_${numero}.xml`;
}

/**
 * RC3.18 — XML de entrada pela Central de Entradas (fonte oficial).
 * Fallback legado (notas_recebidas*) + disco apenas se a chave ainda não estiver na Central.
 */
async function buscarXmlEntradaCentral(doc) {
  if (doc?.xml && String(doc.xml).trim()) {
    return String(doc.xml);
  }
  return buscarXmlEntradaLegado(doc);
}

async function buscarXmlEntradaLegado(compra) {
  const chave = String(compra.chave_acesso || compra.chave || '').replace(/\D/g, '');

  if (chave.length === 44) {
    // @deprecated RC1 — fallback; preferir central_entradas_documentos
    const dfe = await dbGet('SELECT xml FROM notas_recebidas_dfe WHERE chave = ? LIMIT 1', [chave]);
    if (dfe?.xml) {
      return dfe.xml;
    }

    const recebida = await dbGet('SELECT xml FROM notas_recebidas WHERE chave = ? LIMIT 1', [chave]);
    if (recebida?.xml) {
      return recebida.xml;
    }
  }

  const pastasBusca = [
    getFiscalSubDir('xml/entradas'),
    getFiscalSubDir('xml'),
    getFiscalSubDir('entradas'),
    path.join(getFiscalDir(), 'entradas')
  ];

  const candidatos = [];
  if (chave.length === 44) {
    candidatos.push(`${chave}.xml`, `NFe${chave}.xml`);
  }
  if (compra.numero_nf || compra.numero) {
    const num = compra.numero_nf || compra.numero;
    candidatos.push(`ENTRADA_${num}.xml`, `${num}.xml`);
  }
  candidatos.push(`compra_${compra.id}.xml`);

  for (const pasta of pastasBusca) {
    if (!fs.existsSync(pasta)) continue;
    for (const nome of candidatos) {
      const caminho = path.join(pasta, nome);
      if (fs.existsSync(caminho)) {
        return fs.readFileSync(caminho, 'utf8');
      }
    }
  }

  return null;
}

/** @deprecated alias — mantido para compatibilidade interna */
async function buscarXmlEntrada(compra) {
  return buscarXmlEntradaCentral(compra);
}

function garantirPasta(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function escreverArquivo(caminho, conteudo) {
  garantirPasta(path.dirname(caminho));
  fs.writeFileSync(caminho, conteudo, 'utf8');
  return caminho;
}

/**
 * RC3.19 — NFC-e autorizadas para exportação contábil.
 *
 * LEFT JOIN vendas: NFC-e do Fechamento Fiscal do Dia consolida várias vendas
 * e NÃO possui venda_id. O INNER JOIN anterior eliminava essas notas.
 *
 * Data fiscal:
 *   - convencional (venda_id): v.data_venda, fallback n.created_at
 *   - consolidada (fechamento): fd.data_hora_autorizacao → fd.data_hora_emissao → n.created_at
 *
 * Valor:
 *   - convencional: v.total
 *   - consolidada: fd.valor_total
 */
async function buscarNfceAutorizadas(dataInicial, dataFinal, dbOverride) {
  return dbAll(`
    SELECT
      n.*,
      v.codigo AS venda_codigo,
      v.data_venda,
      CASE WHEN n.venda_id IS NOT NULL THEN v.total ELSE fd.valor_total END AS venda_total,
      v.forma_pagamento,
      v.status AS venda_status,
      c.nome AS cliente_nome,
      c.cpf_cnpj AS cliente_cpf,
      fd.valor_total AS fechamento_valor_total,
      fd.data_hora_autorizacao AS fechamento_data_autorizacao,
      fd.data_hora_emissao AS fechamento_data_emissao,
      CASE
        WHEN n.venda_id IS NOT NULL THEN COALESCE(v.data_venda, n.created_at)
        ELSE COALESCE(fd.data_hora_autorizacao, fd.data_hora_emissao, n.created_at)
      END AS data_fiscal
    FROM nfce_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN fechamentos_fiscais_documentos fd ON fd.id = n.fechamento_documento_id
    WHERE DATE(
      CASE
        WHEN n.venda_id IS NOT NULL THEN COALESCE(v.data_venda, n.created_at)
        ELSE COALESCE(fd.data_hora_autorizacao, fd.data_hora_emissao, n.created_at)
      END
    ) >= ?
      AND DATE(
        CASE
          WHEN n.venda_id IS NOT NULL THEN COALESCE(v.data_venda, n.created_at)
          ELSE COALESCE(fd.data_hora_autorizacao, fd.data_hora_emissao, n.created_at)
        END
      ) <= ?
      AND (
        LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
        OR (
          n.xml_retorno IS NOT NULL
          AND n.xml_retorno LIKE '%<cStat>100</cStat>%'
          AND LOWER(TRIM(COALESCE(n.status, ''))) NOT IN ('cancelada', 'rejeitada', 'erro')
        )
      )
    ORDER BY n.created_at ASC, n.id ASC
  `, [dataInicial, dataFinal], dbOverride);
}

/**
 * RC3.19 — Recuperação histórica idempotente.
 *
 * Documentos AUTORIZADOS do fechamento fiscal emitidos antes da integração
 * Sprint 08.1 podem não estar em nfce_notas. Antes de exportar, sincroniza
 * todos os fechamentos com documentos autorizados no período.
 *
 * NÃO transmite. NÃO cria venda. Reutiliza persistirNfceAutorizadaDoFechamento.
 */
async function sincronizarHistoricoNfcePeriodo(dataInicial, dataFinal, dbOverride) {
  const dbConn = dbOverride || db;
  try {
    const { sincronizarHistoricoNfceDoFechamento } = require('../fechamento-fiscal/NfceHistoricoOficialService');
    const fechamentos = await dbAll(`
      SELECT DISTINCT ff.id
      FROM fechamentos_fiscais ff
      INNER JOIN fechamentos_fiscais_documentos fd ON fd.fechamento_fiscal_id = ff.id
      WHERE UPPER(fd.status) = 'AUTORIZADO'
        AND DATE(COALESCE(fd.data_hora_autorizacao, fd.data_hora_emissao, fd.criado_em)) >= ?
        AND DATE(COALESCE(fd.data_hora_autorizacao, fd.data_hora_emissao, fd.criado_em)) <= ?
    `, [dataInicial, dataFinal], dbConn);

    let sincronizados = 0;
    for (const ff of fechamentos) {
      try {
        await sincronizarHistoricoNfceDoFechamento(dbConn, ff.id);
        sincronizados += 1;
      } catch (err) {
        console.warn(`[CONTABILIDADE] Falha ao sincronizar histórico NFC-e do fechamento ${ff.id}:`, err.message);
      }
    }
    return { sincronizados };
  } catch (err) {
    console.warn('[CONTABILIDADE] Falha ao sincronizar histórico NFC-e do período:', err.message);
    return { sincronizados: 0, erro: err.message };
  }
}

/** RC3.18 — NF-e modelo 55 autorizadas (nfe_notas). */
async function buscarNfeAutorizadas(dataInicial, dataFinal) {
  return dbAll(`
    SELECT
      n.*,
      v.codigo AS venda_codigo,
      v.data_venda,
      v.total AS venda_total,
      v.forma_pagamento,
      v.status AS venda_status,
      c.nome AS cliente_nome,
      c.cpf_cnpj AS cliente_cpf
    FROM nfe_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE DATE(COALESCE(n.created_at, v.data_venda, n.updated_at)) >= ?
      AND DATE(COALESCE(n.created_at, v.data_venda, n.updated_at)) <= ?
      AND (
        LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
        OR (
          n.xml_retorno IS NOT NULL
          AND n.xml_retorno LIKE '%<cStat>100</cStat>%'
          AND LOWER(TRIM(COALESCE(n.status, ''))) NOT IN ('cancelada', 'rejeitada', 'erro', 'erro_assinatura')
        )
      )
    ORDER BY n.created_at ASC, n.id ASC
  `, [dataInicial, dataFinal]);
}

/**
 * RC3.18 — entradas pela Central de Entradas (oficial).
 * Completa com compras+legado apenas para chaves ainda ausentes na Central.
 */
async function buscarEntradasPeriodo(dataInicial, dataFinal) {
  const daCentral = await dbAll(`
    SELECT
      id,
      chave AS chave_acesso,
      chave,
      numero AS numero_nf,
      numero,
      serie,
      fornecedor,
      cnpj_fornecedor,
      data_emissao,
      data_entrada,
      valor_total AS valor_total_nota,
      valor_total AS total,
      xml,
      status,
      'central_entradas' AS origem_xml
    FROM central_entradas_documentos
    WHERE DATE(COALESCE(data_emissao, data_entrada, created_at)) >= ?
      AND DATE(COALESCE(data_emissao, data_entrada, created_at)) <= ?
      AND xml IS NOT NULL
      AND TRIM(xml) <> ''
      AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelada', 'excluida', 'rejeitada')
    ORDER BY COALESCE(data_emissao, data_entrada, created_at) ASC, id ASC
  `, [dataInicial, dataFinal]);

  const chaves = new Set(
    daCentral.map((d) => String(d.chave || d.chave_acesso || '').replace(/\D/g, '')).filter((c) => c.length === 44)
  );

  const compras = await buscarComprasEntrada(dataInicial, dataFinal);
  const complementos = [];
  for (const compra of compras) {
    const chave = String(compra.chave_acesso || '').replace(/\D/g, '');
    if (chave.length === 44 && chaves.has(chave)) continue;
    complementos.push({
      ...compra,
      chave,
      origem_xml: 'legado_compras'
    });
  }

  return [...daCentral, ...complementos];
}

async function buscarComprasEntrada(dataInicial, dataFinal) {
  return dbAll(`
    SELECT *
    FROM compras
    WHERE DATE(COALESCE(data_emissao, data_entrada, data_compra)) >= ?
      AND DATE(COALESCE(data_emissao, data_entrada, data_compra)) <= ?
      AND LOWER(TRIM(COALESCE(status, 'concluida'))) NOT IN ('cancelada')
      AND (
        (chave_acesso IS NOT NULL AND TRIM(chave_acesso) <> '')
        OR (numero_nf IS NOT NULL AND TRIM(numero_nf) <> '')
      )
    ORDER BY COALESCE(data_emissao, data_entrada, data_compra) ASC, id ASC
  `, [dataInicial, dataFinal]);
}

function gerarCsvVendas(notas, tipoDoc = 'NFC-e') {
  let csv = linhaCsv(['Tipo', 'Data', 'Número', 'Cliente', 'CPF/CNPJ', 'Valor', 'Forma Pagamento', 'Situação']);
  for (const nota of notas) {
    csv += linhaCsv([
      tipoDoc,
      (nota.data_fiscal || nota.data_venda || nota.created_at || '').toString().slice(0, 10),
      nota.numero || nota.venda_codigo || '',
      nota.cliente_nome || 'Consumidor',
      nota.cliente_cpf || '',
      Number(nota.venda_total || 0).toFixed(2).replace('.', ','),
      nota.forma_pagamento || '',
      nota.status || nota.venda_status || ''
    ]);
  }
  return csv;
}

function gerarCsvVendasMisto(notasNfce, notasNfe) {
  let csv = linhaCsv(['Tipo', 'Data', 'Número', 'Cliente', 'CPF/CNPJ', 'Valor', 'Forma Pagamento', 'Situação']);
  const append = (notas, tipoDoc) => {
    for (const nota of notas) {
      csv += linhaCsv([
        tipoDoc,
        (nota.data_fiscal || nota.data_venda || nota.created_at || '').toString().slice(0, 10),
        nota.numero || nota.venda_codigo || '',
        nota.cliente_nome || 'Consumidor',
        nota.cliente_cpf || '',
        Number(nota.venda_total || 0).toFixed(2).replace('.', ','),
        nota.forma_pagamento || '',
        nota.status || nota.venda_status || ''
      ]);
    }
  };
  append(notasNfce, 'NFC-e');
  append(notasNfe, 'NF-e');
  return csv;
}

function gerarCsvCompras(compras) {
  let csv = linhaCsv(['Data', 'Fornecedor', 'CNPJ', 'Número NF', 'Valor Total']);
  for (const compra of compras) {
    csv += linhaCsv([
      (compra.data_emissao || compra.data_entrada || compra.data_compra || '').toString().slice(0, 10),
      compra.fornecedor || '',
      compra.fornecedor_cnpj || compra.cnpj_fornecedor || '',
      compra.numero_nf || compra.numero || '',
      Number(compra.valor_total_nota || compra.valor_total || compra.total || 0).toFixed(2).replace('.', ',')
    ]);
  }
  return csv;
}

function gerarCsvResumo({
  dataInicial,
  dataFinal,
  qtdNfce,
  qtdNfe,
  totalVendas,
  qtdEntradas,
  totalCompras,
  dataGeracao
}) {
  let csv = linhaCsv(['Campo', 'Valor']);
  csv += linhaCsv(['Período', `${dataInicial} a ${dataFinal}`]);
  csv += linhaCsv(['Quantidade NFC-e', qtdNfce]);
  csv += linhaCsv(['Quantidade NF-e', qtdNfe]);
  csv += linhaCsv(['Valor Total Vendas', totalVendas.toFixed(2).replace('.', ',')]);
  csv += linhaCsv(['Quantidade NF Entrada', qtdEntradas]);
  csv += linhaCsv(['Valor Total Compras', totalCompras.toFixed(2).replace('.', ',')]);
  csv += linhaCsv(['Data de Geração', dataGeracao]);
  return csv;
}

function normalizarOpcoesExportacao(opcoes = {}) {
  const flag = (v, def = true) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).trim().toLowerCase();
    if (['0', 'false', 'nao', 'não', 'off', 'no'].includes(s)) return false;
    if (['1', 'true', 'sim', 'yes', 'on'].includes(s)) return true;
    return def;
  };
  return {
    incluirNfce: flag(opcoes.incluirNfce ?? opcoes.nfce, true),
    incluirNfe: flag(opcoes.incluirNfe ?? opcoes.nfe, true),
    incluirEntradas: flag(opcoes.incluirEntradas ?? opcoes.entradas, true),
    incluirRelatorios: flag(opcoes.incluirRelatorios ?? opcoes.relatorios, true),
    incluirManifesto: flag(opcoes.incluirManifesto ?? opcoes.manifesto, true)
  };
}

function criarZipAPartirDaPasta(origem, destinoZip, nomePastaNoZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinoZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(destinoZip));
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(origem, nomePastaNoZip || false);
    archive.finalize();
  });
}

function removerPastaRecursiva(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function exportarContabilidade({ dataInicial, dataFinal, ...opcoesBody } = {}) {
  const inicio = normalizarData(dataInicial);
  const fim = normalizarData(dataFinal);
  const opcoes = normalizarOpcoesExportacao(opcoesBody);

  if (!inicio || !fim) {
    const erro = new Error('Informe data inicial e data final válidas (AAAA-MM-DD).');
    erro.statusCode = 400;
    throw erro;
  }

  if (inicio > fim) {
    const erro = new Error('A data inicial não pode ser maior que a data final.');
    erro.statusCode = 400;
    throw erro;
  }

  if (
    !opcoes.incluirNfce &&
    !opcoes.incluirNfe &&
    !opcoes.incluirEntradas &&
    !opcoes.incluirRelatorios &&
    !opcoes.incluirManifesto
  ) {
    const erro = new Error('Selecione ao menos um item para exportar.');
    erro.statusCode = 400;
    throw erro;
  }

  // RC3.19 — recupera documentos autorizados do fechamento que ainda não
  // estão em nfce_notas (histórico anterior à Sprint 08.1). Idempotente.
  if (opcoes.incluirNfce) {
    await sincronizarHistoricoNfcePeriodo(inicio, fim);
  }

  const notasNfce = await buscarNfceAutorizadas(inicio, fim);
  const notasNfe = await buscarNfeAutorizadas(inicio, fim);
  const entradas = await buscarEntradasPeriodo(inicio, fim);

  const temDocs =
    notasNfce.length > 0 ||
    notasNfe.length > 0 ||
    entradas.length > 0;

  if (!temDocs) {
    const erro = new Error('Nenhum documento encontrado para o período informado.');
    erro.statusCode = 404;
    throw erro;
  }

  const [anoRef, mesRef] = fim.split('-');
  const nomePasta = `CONTABILIDADE_${anoRef}-${mesRef}`;
  const nomeZip = `CONTABILIDADE_${anoRef}_${mesRef}.zip`;
  const baseTemp = garantirPasta(path.join(os.tmpdir(), 'cds-contabilidade'));
  const raizExportacao = path.join(baseTemp, `${nomePasta}_${Date.now()}`);
  const pastaXmlNfce = opcoes.incluirNfce ? garantirPasta(path.join(raizExportacao, 'XML_NFCE')) : null;
  const pastaXmlNfe = opcoes.incluirNfe ? garantirPasta(path.join(raizExportacao, 'XML_NFE')) : null;
  const pastaXmlEntradas = opcoes.incluirEntradas
    ? garantirPasta(path.join(raizExportacao, 'XML_ENTRADAS'))
    : null;
  const pastaRelatorios =
    opcoes.incluirRelatorios || opcoes.incluirManifesto
      ? garantirPasta(path.join(raizExportacao, 'RELATORIOS'))
      : null;
  const arquivosGerados = [];
  const xmlAusentes = [];
  let xmlsNfceExportados = 0;
  let xmlsNfeExportados = 0;
  let xmlsEntradasExportados = 0;

  const quantidadeNfceConsolidadas = opcoes.incluirNfce
    ? notasNfce.filter((n) => n.venda_id == null).length
    : 0;

  if (opcoes.incluirNfce) {
    for (const nota of notasNfce) {
      const xml = extrairXmlNfceAutorizado(nota);
      const nomeArquivo = nomeArquivoNfce(nota);
      const caminhoDestino = path.join(pastaXmlNfce, nomeArquivo);

      if (!xml) {
        xmlAusentes.push({
          tipo: 'NFCE',
          referencia: nota.chave_acesso || `venda_${nota.venda_id || 'fechamento'}`,
          caminhoEsperado: caminhoDestino
        });
        console.warn(`[CONTABILIDADE] XML NFC-e ausente: nota ${nota.id} / venda ${nota.venda_id}`);
        continue;
      }

      escreverArquivo(caminhoDestino, xml);
      arquivosGerados.push(`XML_NFCE/${nomeArquivo}`);
      xmlsNfceExportados += 1;
    }
  }

  if (opcoes.incluirNfe) {
    for (const nota of notasNfe) {
      const xml = extrairXmlNfeAutorizado(nota);
      const nomeArquivo = nomeArquivoNfe(nota);
      const caminhoDestino = path.join(pastaXmlNfe, nomeArquivo);

      if (!xml) {
        xmlAusentes.push({
          tipo: 'NFE',
          referencia: nota.chave_acesso || `venda_${nota.venda_id}`,
          caminhoEsperado: caminhoDestino
        });
        console.warn(`[CONTABILIDADE] XML NF-e ausente: nota ${nota.id} / venda ${nota.venda_id}`);
        continue;
      }

      escreverArquivo(caminhoDestino, xml);
      arquivosGerados.push(`XML_NFE/${nomeArquivo}`);
      xmlsNfeExportados += 1;
    }
  }

  if (opcoes.incluirEntradas) {
    for (const doc of entradas) {
      const xml = await buscarXmlEntradaCentral(doc);
      const nomeArquivo = nomeArquivoEntrada(doc);
      const caminhoDestino = path.join(pastaXmlEntradas, nomeArquivo);

      if (!xml) {
        xmlAusentes.push({
          tipo: 'ENTRADA',
          referencia: doc.chave_acesso || doc.chave || `entrada_${doc.id}`,
          caminhoEsperado: caminhoDestino
        });
        console.warn(`[CONTABILIDADE] XML de entrada ausente: ${doc.id}`);
        continue;
      }

      escreverArquivo(caminhoDestino, xml);
      arquivosGerados.push(`XML_ENTRADAS/${nomeArquivo}`);
      xmlsEntradasExportados += 1;
    }
  }

  const totalVendasNfce = notasNfce.reduce((sum, nota) => sum + Number(nota.venda_total || 0), 0);
  const totalVendasNfe = notasNfe.reduce((sum, nota) => sum + Number(nota.venda_total || 0), 0);
  const totalCompras = entradas.reduce(
    (sum, compra) => sum + Number(compra.valor_total_nota || compra.valor_total || compra.total || 0),
    0
  );
  const dataGeracao = agoraLocalBrasil();

  let caminhoVendas = null;
  let caminhoCompras = null;
  let caminhoResumo = null;
  let caminhoManifesto = null;

  if (opcoes.incluirRelatorios && pastaRelatorios) {
    caminhoVendas = escreverArquivo(
      path.join(pastaRelatorios, 'vendas.csv'),
      gerarCsvVendasMisto(
        opcoes.incluirNfce ? notasNfce : [],
        opcoes.incluirNfe ? notasNfe : []
      )
    );
    arquivosGerados.push('RELATORIOS/vendas.csv');

    caminhoCompras = escreverArquivo(
      path.join(pastaRelatorios, 'compras.csv'),
      gerarCsvCompras(opcoes.incluirEntradas ? entradas : [])
    );
    arquivosGerados.push('RELATORIOS/compras.csv');

    caminhoResumo = escreverArquivo(
      path.join(pastaRelatorios, 'resumo.csv'),
      gerarCsvResumo({
        dataInicial: inicio,
        dataFinal: fim,
        qtdNfce: opcoes.incluirNfce ? notasNfce.length : 0,
        qtdNfe: opcoes.incluirNfe ? notasNfe.length : 0,
        totalVendas:
          (opcoes.incluirNfce ? totalVendasNfce : 0) +
          (opcoes.incluirNfe ? totalVendasNfe : 0),
        qtdEntradas: opcoes.incluirEntradas ? entradas.length : 0,
        totalCompras: opcoes.incluirEntradas ? totalCompras : 0,
        dataGeracao
      })
    );
    arquivosGerados.push('RELATORIOS/resumo.csv');
  }

  if (opcoes.incluirManifesto && pastaRelatorios) {
    const manifestoLinhas = [
      `Exportação para contabilidade - ${dataGeracao}`,
      `Período: ${inicio} a ${fim}`,
      `Pasta raiz: ${nomePasta}/`,
      `Opções: NFC-e=${opcoes.incluirNfce} NF-e=${opcoes.incluirNfe} Entradas=${opcoes.incluirEntradas} CSV=${opcoes.incluirRelatorios}`,
      '',
      'Arquivos gerados:'
    ];

    arquivosGerados.forEach((item) => {
      manifestoLinhas.push(`- ${nomePasta}/${item}`);
    });

    if (xmlAusentes.length > 0) {
      manifestoLinhas.push('', 'XML ausentes (registrados no log):');
      xmlAusentes.forEach((item) => {
        manifestoLinhas.push(`- ${item.tipo} ${item.referencia} (esperado em ${item.caminhoEsperado})`);
      });
    }

    caminhoManifesto = escreverArquivo(
      path.join(pastaRelatorios, 'manifesto_exportacao.txt'),
      `${manifestoLinhas.join('\n')}\n`
    );
    arquivosGerados.push('RELATORIOS/manifesto_exportacao.txt');
  }

  if (arquivosGerados.length === 0) {
    removerPastaRecursiva(raizExportacao);
    const erro = new Error('Nenhum arquivo pôde ser gerado para o período informado.');
    erro.statusCode = 404;
    throw erro;
  }

  const caminhoZip = path.join(baseTemp, nomeZip);
  await criarZipAPartirDaPasta(raizExportacao, caminhoZip, nomePasta);

  return {
    nomeZip,
    nomePasta,
    caminhoZip,
    raizExportacao,
    arquivosGerados: arquivosGerados.map((item) => `${nomePasta}/${item}`),
    caminhosAbsolutos: {
      raiz: raizExportacao,
      zip: caminhoZip,
      vendasCsv: caminhoVendas,
      comprasCsv: caminhoCompras,
      resumoCsv: caminhoResumo,
      manifesto: caminhoManifesto
    },
    resumo: {
      periodo: `${inicio} a ${fim}`,
      quantidadeNfce: opcoes.incluirNfce ? notasNfce.length : 0,
      quantidadeNfceConsolidadas,
      quantidadeNfe: opcoes.incluirNfe ? notasNfe.length : 0,
      valorTotalVendas:
        (opcoes.incluirNfce ? totalVendasNfce : 0) +
        (opcoes.incluirNfe ? totalVendasNfe : 0),
      quantidadeEntradas: opcoes.incluirEntradas ? entradas.length : 0,
      valorTotalCompras: opcoes.incluirEntradas ? totalCompras : 0,
      dataGeracao,
      xmlAusentes: xmlAusentes.length,
      xmlsNfceExportados,
      xmlsNfeExportados,
      xmlsEntradasExportados,
      opcoes
    }
  };
}

function limparExportacaoTemporaria(resultado) {
  if (!resultado) return;
  removerPastaRecursiva(resultado.raizExportacao);
  if (resultado.caminhoZip && fs.existsSync(resultado.caminhoZip)) {
    fs.unlinkSync(resultado.caminhoZip);
  }
}

module.exports = {
  exportarContabilidade,
  limparExportacaoTemporaria,
  normalizarOpcoesExportacao,
  buscarNfceAutorizadas,
  buscarNfeAutorizadas,
  sincronizarHistoricoNfcePeriodo,
  extrairXmlNfceAutorizado,
  extrairXmlNfeAutorizado,
  nomeArquivoNfce,
  nomeArquivoNfe,
  gerarCsvVendasMisto,
  gerarCsvResumo
};
