/**
 * HOMOLOGAÇÃO — Motor Equipamentos + MIP + PDV
 * Somente validação (sem novas features).
 *
 * Executar: node tests/homologacao/homologacao-motor-mip-pdv.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const { obterPreset, listarPresets } = require('../../backend/motores/equipamentos/layouts/presetsEtiqueta');
const { parseEtiquetaComLayout } = require('../../backend/motores/equipamentos/layouts/ConfiguravelEtiquetaParser');
const { LayoutEtiquetaService } = require('../../backend/motores/equipamentos/services/LayoutEtiquetaService');
const {
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresService,
  ProdutoIdentidadeService,
  TIPOS_IDENTIFICADOR,
  setProdutoIdentidadeEnabled
} = require('../../backend/motores/produto-identidade');

const CODIGO_TOLEDO = '2000067010019';
const PLU = '67';

const resultados = [];
let passou = 0;
let falhou = 0;
let consultas = 0;

function registrar(cenario, status, detalhe, metricas = {}) {
  resultados.push({ cenario, status, detalhe, ...metricas });
  if (status === 'APROVADO') {
    passou += 1;
    console.log(`  ✔ C${cenario} APROVADO — ${detalhe}`);
  } else if (status === 'REPROVADO') {
    falhou += 1;
    console.log(`  ✖ C${cenario} REPROVADO — ${detalhe}`);
  } else {
    console.log(`  ◐ C${cenario} ${status} — ${detalhe}`);
  }
}

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function lerArquivo(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

async function criarDbHomolog() {
  const file = path.join(os.tmpdir(), `homolog-eq-mip-${Date.now()}.db`);
  const db = await openDb(file);
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo VARCHAR(50) UNIQUE,
      nome VARCHAR(200) NOT NULL,
      codigo_barras TEXT,
      unidade TEXT,
      preco_venda DECIMAL(10,2) DEFAULT 0,
      ativo INTEGER DEFAULT 1
    )
  `);
  await new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });
  return db;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' HOMOLOGAÇÃO — Motor Equipamentos + MIP + PDV');
  console.log('══════════════════════════════════════════════════\n');

  const t0Total = process.hrtime.bigint();
  const db = await criarDbHomolog();
  const ids = new ProdutoIdentificadoresService({ db });

  // Seed: interno, EAN, PLU 67 (mesmo produto físico da etiqueta)
  const rInterno = await run(db, `
    INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda, ativo)
    VALUES ('ABC123', 'Produto Interno', NULL, 'UN', 5.00, 1)
  `);
  await ids.espelharCodigoEBarras(rInterno.lastID, { codigo: 'ABC123' });

  const rEan = await run(db, `
    INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda, ativo)
    VALUES ('7891000100103', 'Produto EAN', '7891000100103', 'UN', 8.50, 1)
  `);
  await ids.espelharCodigoEBarras(rEan.lastID, {
    codigo: '7891000100103',
    codigo_barras: '7891000100103'
  });

  const rPlu = await run(db, `
    INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda, ativo)
    VALUES ('67', 'Produto PLU 67 KG', NULL, 'KG', 10.01, 1)
  `);
  await ids.espelharCodigoEBarras(rPlu.lastID, { codigo: '67' });
  await ids.upsertPrincipal(rPlu.lastID, TIPOS_IDENTIFICADOR.PLU, PLU, { origem: 'homolog' });

  setProdutoIdentidadeEnabled(true);
  const mip = new ProdutoIdentidadeService({ db });

  // ─── C1 Código interno ───────────────────────────────────────────
  {
    consultas += 1;
    const t0 = process.hrtime.bigint();
    const r = await mip.resolve('ABC123', { origem: 'homolog' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r?.encontrado && Number(r.produtoId) === rInterno.lastID) {
      registrar(1, 'APROVADO', `interno ABC123 → produto ${r.produtoId}`, { tempoMipMs: ms.toFixed(2) });
    } else {
      registrar(1, 'REPROVADO', `esperado produto ${rInterno.lastID}, obtido ${JSON.stringify(r)}`);
    }
  }

  // ─── C2 EAN ──────────────────────────────────────────────────────
  {
    consultas += 1;
    const t0 = process.hrtime.bigint();
    const r = await mip.resolve('7891000100103', { origem: 'homolog' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r?.encontrado && Number(r.produtoId) === rEan.lastID) {
      registrar(2, 'APROVADO', `EAN → produto ${r.produtoId}`, { tempoMipMs: ms.toFixed(2) });
    } else {
      registrar(2, 'REPROVADO', `EAN não localizou produto esperado`);
    }
  }

  // ─── C3 PLU 67 ───────────────────────────────────────────────────
  {
    consultas += 1;
    const t0 = process.hrtime.bigint();
    const r = await mip.resolve(PLU, { origem: 'homolog' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r?.encontrado && Number(r.produtoId) === rPlu.lastID) {
      registrar(3, 'APROVADO', `PLU 67 → produto ${r.produtoId}`, { tempoMipMs: ms.toFixed(2) });
    } else {
      registrar(3, 'REPROVADO', `PLU 67 não localizou produto`);
    }
  }

  // ─── C4 Etiqueta Toledo ──────────────────────────────────────────
  {
    const layout = obterPreset('toledo_prix4_uno_valor');
    const t0Parse = process.hrtime.bigint();
    const parsed = parseEtiquetaComLayout(CODIGO_TOLEDO, layout);
    const tempoParseMs = Number(process.hrtime.bigint() - t0Parse) / 1e6;

    if (!parsed || parsed.plu !== PLU) {
      registrar(4, 'REPROVADO', `parser não extraiu PLU 67 (obtido ${parsed && parsed.plu})`);
    } else {
      consultas += 1;
      const t0Mip = process.hrtime.bigint();
      const r = await mip.resolve(parsed.plu, { origem: 'homolog_apos_motor' });
      const tempoMipMs = Number(process.hrtime.bigint() - t0Mip) / 1e6;
      const mesmoProduto = r?.encontrado && Number(r.produtoId) === rPlu.lastID;
      const temValor = Number(parsed.valorTotal) === 10.01;
      if (mesmoProduto && temValor && parsed.tipoPayload === 'VALOR') {
        registrar(4, 'APROVADO',
          `2000067010019 → PLU 67 → produto ${r.produtoId} · R$ ${parsed.valorTotal}`,
          {
            tempoInterpretacaoMs: tempoParseMs.toFixed(2),
            tempoMipMs: tempoMipMs.toFixed(2),
            tempoTotalMs: (tempoParseMs + tempoMipMs).toFixed(2)
          });
      } else {
        registrar(4, 'REPROVADO', `produto/valor inconsistentes (mesmoProduto=${mesmoProduto}, valor=${parsed.valorTotal})`);
      }
    }
  }

  // ─── C5 Troca de layout ──────────────────────────────────────────
  {
    const ordem = [
      ['toledo_prix4_uno_valor', '67'],
      ['filizola_valor', '6'],
      ['urano_valor', '6'],
      ['outro', '67']
    ];
    let ok = true;
    const detalhes = [];
    for (const [presetId, pluEsperado] of ordem) {
      const p = parseEtiquetaComLayout(CODIGO_TOLEDO, obterPreset(presetId));
      const plu = p && p.plu;
      detalhes.push(`${presetId}→${plu}`);
      if (plu !== pluEsperado) ok = false;
    }
    // confirmar que definirLayoutAtivo altera resultado do serviço
    const svc = new LayoutEtiquetaService();
    let layoutAtual = obterPreset('toledo_prix4_uno_valor');
    svc.obterLayoutAtivo = async () => layoutAtual;
    const a = await svc.interpretarEtiqueta(CODIGO_TOLEDO);
    layoutAtual = obterPreset('filizola_valor');
    const b = await svc.interpretarEtiqueta(CODIGO_TOLEDO);
    const trocaImediata = a.resultado?.plu === '67' && b.resultado?.plu === '6';
    if (ok && trocaImediata) {
      registrar(5, 'APROVADO', `parser reage ao layout: ${detalhes.join(' | ')}`);
    } else {
      registrar(5, 'REPROVADO', `troca não imediata ou PLUs divergentes: ${detalhes.join(' | ')}`);
    }
  }

  // ─── C6 Sem layout ativo ─────────────────────────────────────────
  {
    const pdvSrc = lerArquivo('frontend/pdv/js/pdv.js');
    const svcSrc = lerArquivo('backend/motores/equipamentos/services/LayoutEtiquetaService.js');
    const msgEsperada = 'Nenhuma balança configurada para o PDV.';
    const temMensagem = pdvSrc.includes(msgEsperada) && svcSrc.includes(msgEsperada);
    const semFallbackDefault = svcSrc.includes('// RC1: sem configuração cadastrada → null')
      && !/async obterLayoutAtivo\(\) \{[\s\S]*?return this\.obterLayoutDefault\(\);\s*\}/.test(svcSrc);
    const legadoNaoInterpreta = pdvSrc.includes('etiquetas de balança NUNCA passam pelo parser legado')
      && !/adicionarProdutoPorCodigoLegado[\s\S]*?interpretarCodigoBalanca\(/.test(pdvSrc);

    const svc = new LayoutEtiquetaService();
    svc.obterLayoutAtivo = async () => null;
    const out = await svc.interpretarEtiqueta(CODIGO_TOLEDO);
    const runtimeOk = out.semLayoutAtivo === true
      && out.sucesso === false
      && out.mensagem === msgEsperada
      && out.resultado == null;

    if (temMensagem && runtimeOk && legadoNaoInterpreta && semFallbackDefault) {
      registrar(6, 'APROVADO',
        'sem layout → mensagem amigável; não interpreta; legado não parseia etiqueta');
    } else {
      registrar(6, 'REPROVADO',
        `msg=${temMensagem} runtime=${runtimeOk} legadoLimpo=${legadoNaoInterpreta} semDefault=${semFallbackDefault} out=${JSON.stringify(out && out.mensagem)}`);
    }
  }

  // ─── C7 Etiqueta inválida / produto inexistente ──────────────────
  {
    const layout = obterPreset('toledo_prix4_uno_valor');
    const parsed = parseEtiquetaComLayout('2000099010001', layout);
    consultas += 1;
    const r = await mip.resolve(parsed.plu, { origem: 'homolog' });
    const pdvSrc = lerArquivo('frontend/pdv/js/pdv.js');
    const naoTrava = pdvSrc.includes('Produto não encontrado')
      || pdvSrc.includes('fallback legado')
      || pdvSrc.includes('showNotification');
    if (parsed?.plu === '99' && r && r.encontrado === false && naoTrava) {
      registrar(7, 'APROVADO',
        `PLU 99 sem produto → naoEncontrado; PDV tem caminho de notificação/fallback (não bloqueia)`);
    } else {
      registrar(7, 'REPROVADO', `falha no tratamento de etiqueta sem produto`);
    }
  }

  // ─── Critérios transversais (auditoria de código) ────────────────
  {
    const pdvSrc = lerArquivo('frontend/pdv/js/pdv.js');
    const motorAntesMip = pdvSrc.includes('interpretarEtiquetaViaMotorEquipamentos')
      && pdvSrc.includes('aposMotorEquipamentos: true');
    const naoEnviaEanCompleto = pdvSrc.includes('aposMotorEquipamentos')
      && pdvSrc.includes('semLayoutAtivo');
    const parserHardcodeNoHotPath = !lerArquivo('backend/motores/equipamentos/layouts/ConfiguravelEtiquetaParser.js')
      .includes('ToledoPrix4');
    const temAuditoria = pdvSrc.includes('pdvAuditoriaEquipamentos')
      && pdvSrc.includes('tempoMotorMs')
      && pdvSrc.includes('tempoParserMs')
      && pdvSrc.includes('tempoMipMs')
      && pdvSrc.includes('tempoTotalMs')
      && pdvSrc.includes('quantidadeConsultas')
      && pdvSrc.includes('layoutUtilizado')
      && pdvSrc.includes('pluExtraido')
      && pdvSrc.includes('pdvAuditoriaEquipamentosHabilitada');
    const auditoriaSoDebug = pdvSrc.includes('pdv_homologacao')
      && pdvSrc.includes('pdv_debug')
      && pdvSrc.includes('PDV_HOMOLOGACAO');

    console.log('\n── Critérios transversais ──');
    console.log(`  Motor antes do MIP (PDV):     ${motorAntesMip ? '✔' : '✖'}`);
    console.log(`  PDV não manda EAN ao MIP:     ${naoEnviaEanCompleto ? '✔' : '✖'}`);
    console.log(`  Parser sem hardcode Toledo:   ${parserHardcodeNoHotPath ? '✔' : '✖'}`);
    console.log(`  Auditoria estruturada:        ${temAuditoria ? '✔' : '✖'}`);
    console.log(`  Auditoria só Homolog/Debug:   ${auditoriaSoDebug ? '✔' : '✖'}`);
    console.log(`  Presets layout disponíveis:   ${listarPresets().length}`);
    console.log(`  Consultas MIP nesta suíte:    ${consultas}`);

    if (temAuditoria && auditoriaSoDebug) {
      registrar('AUD', 'APROVADO', 'auditoria estruturada presente e restrita a Homologação/Debug');
    } else {
      registrar('AUD', 'REPROVADO',
        `auditoria incompleta (estruturada=${temAuditoria}, gate=${auditoriaSoDebug})`);
    }
  }

  await closeDb(db);

  const tempoTotalMs = Number(process.hrtime.bigint() - t0Total) / 1e6;
  console.log('\n══════════════════════════════════════════════════');
  console.log(` Resultado: ${passou} aprovados · ${falhou} reprovados · tempo suíte ${tempoTotalMs.toFixed(0)} ms`);
  console.log('══════════════════════════════════════════════════\n');

  // Resumo formal
  console.log('RESUMO POR CENÁRIO');
  for (const r of resultados) {
    const tag = r.status === 'APROVADO' ? '✔' : '✖';
    const tempos = [
      r.tempoInterpretacaoMs != null ? `parse=${r.tempoInterpretacaoMs}ms` : null,
      r.tempoMipMs != null ? `mip=${r.tempoMipMs}ms` : null,
      r.tempoTotalMs != null ? `total=${r.tempoTotalMs}ms` : null
    ].filter(Boolean).join(' · ');
    console.log(`  ${tag} C${r.cenario}: ${r.status}${tempos ? ` (${tempos})` : ''}`);
  }

  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
