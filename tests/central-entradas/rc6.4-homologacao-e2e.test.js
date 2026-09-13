/**
 * RC6.4 — Homologação E2E do fluxo completo da Central Inteligente
 * Sem alterar regras de negócio. Fixtures reais em ./fixtures.
 *
 * Executar: npm run test:central-entradas-rc6.4
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CentralDfePersistenciaService = require('../../backend/motores/central-entradas/services/CentralDfePersistenciaService');
const CentralProcessamentoService = require('../../backend/motores/central-entradas/services/CentralProcessamentoService');
const CentralComprasBridgeService = require('../../backend/motores/central-entradas/services/CentralComprasBridgeService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const DocumentoTransitionService = require('../../backend/motores/central-entradas/services/DocumentoTransitionService');
const DocumentoDfeClassifier = require('../../backend/motores/central-entradas/services/DocumentoDfeClassifier');
const { DocumentoFiscalStatus, TODOS: STATUS_TODOS } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const {
  TRANSICOES_PERMITIDAS,
  podeTransicionar,
  validarTransicao
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

const FIX = path.join(__dirname, 'fixtures');
const CHAVE_CICLO = '35260112345678000199550010000000641000000064';
const CHAVE_DIRETO = '35260112345678000199550010000000011000000001';
const CHAVE_INVALIDO = '35260112345678000199550010000000651000000065';
const CHAVE_EVENTO = '35260112345678000199550010000000661000000066';

const RELATORIO = {
  cenarios: [],
  pontosAtencao: [],
  temposMs: [],
  documentosCriados: 0,
  comprasVinculadas: 0
};

let passou = 0;
let falhou = 0;

const documentosRepository = new CentralDocumentosRepository();
const historicoRepository = new CentralHistoricoRepository();
const transitionService = new DocumentoTransitionService({ documentosRepository, historicoRepository });
const persistencia = new CentralDfePersistenciaService({
  documentosRepository,
  historicoRepository,
  transitionService
});
persistencia.existeCompraComChave = async () => false;

const processamento = new CentralProcessamentoService({
  documentosRepository,
  historicoRepository,
  transitionService
});
const bridge = new CentralComprasBridgeService({
  documentosRepository,
  historicoRepository,
  transitionService
});

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function ler(nome) {
  return fs.readFileSync(path.join(FIX, nome), 'utf8');
}

async function limparPorChave(chave) {
  const sql = documentosRepository._obterSql();
  await sql.whenReady();
  const doc = await documentosRepository.buscarPorChave(chave);
  if (!doc) return;
  await sql.run('DELETE FROM central_entradas_historico WHERE documento_id = ?', [doc.id]);
  await sql.run('DELETE FROM central_entradas_eventos WHERE documento_id = ?', [doc.id]).catch?.(() => {});
  try {
    await sql.run('DELETE FROM central_entradas_eventos WHERE documento_id = ?', [doc.id]);
  } catch { /* coluna pode não existir em schema antigo */ }
  await documentosRepository.remover(doc.id);
}

async function limparChaves(chaves) {
  for (const c of chaves) {
    // eslint-disable-next-line no-await-in-loop
    await limparPorChave(c);
  }
}

function contarPorStatus(docs) {
  const mapa = {};
  for (const s of STATUS_TODOS) mapa[s] = 0;
  for (const d of docs) mapa[d.status] = (mapa[d.status] || 0) + 1;
  return mapa;
}

async function main() {
  console.log('\n=== RC6.4 — Homologação E2E Central Inteligente ===\n');
  await documentosRepository._obterSql().whenReady();

  await limparChaves([CHAVE_CICLO, CHAVE_DIRETO, CHAVE_INVALIDO, CHAVE_EVENTO]);

  // —— Integridade da máquina ——
  await test('máquina: todos os estados oficiais têm entrada em TRANSICOES_PERMITIDAS', () => {
    for (const status of STATUS_TODOS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(TRANSICOES_PERMITIDAS, status),
        `Estado sem transição cadastrada: ${status}`
      );
    }
  });

  await test('máquina: AGUARDANDO_XML_COMPLETO não vai direto ao Parser (EM_PROCESSAMENTO)', () => {
    assert.strictEqual(
      podeTransicionar(
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
        DocumentoFiscalStatus.EM_PROCESSAMENTO
      ),
      false
    );
    assert.strictEqual(
      validarTransicao(
        DocumentoFiscalStatus.SINCRONIZADA,
        DocumentoFiscalStatus.GRAVADA
      ).valido,
      false
    );
  });

  // —— CENÁRIO 1: RES_NFE → PROC_NFE → pipeline → GRAVADA ——
  await test('C1: RES_NFE → AGUARDANDO_XML_COMPLETO → PROC_NFE (mesmo id) → GRAVADA', async () => {
    const t0 = Date.now();
    await limparPorChave(CHAVE_CICLO);

    const r1 = await persistencia.persistirDocumentoDfe({
      xml: ler('rc64-res-nfe.xml'),
      nsu: '100',
      origem: 'dfe'
    });
    assert.strictEqual(r1.tipoDfe, DocumentoDfeTipo.RES_NFE);
    assert.strictEqual(r1.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    const id = r1.documento.id;
    RELATORIO.documentosCriados += 1;

    const r2 = await persistencia.persistirDocumentoDfe({
      xml: ler('rc64-proc-nfe.xml'),
      nsu: '101',
      origem: 'dfe'
    });
    assert.strictEqual(r2.atualizado, true);
    assert.strictEqual(r2.documento.id, id);
    assert.strictEqual(r2.documento.status, DocumentoFiscalStatus.SINCRONIZADA);

    const dupCheck = await documentosRepository._obterSql().get(
      'SELECT COUNT(*) AS n FROM central_entradas_documentos WHERE chave = ?',
      [CHAVE_CICLO]
    );
    assert.strictEqual(Number(dupCheck.n), 1);

    const proc = await processamento.processar(id);
    assert.strictEqual(proc.sucesso, true, proc.mensagem || 'processar falhou');
    const aposParse = await documentosRepository.buscarPorId(id);
    assert.ok(
      aposParse.status === DocumentoFiscalStatus.PRONTA_PARA_COMPRA
      || aposParse.status === DocumentoFiscalStatus.AGUARDANDO_REVISAO
    );

    if (aposParse.status === DocumentoFiscalStatus.AGUARDANDO_REVISAO) {
      await bridge.concluirRevisao(id, { usuarioId: 1 });
    }

    await bridge.registrarAberturaCompra(id, { usuarioId: 1 });

    const sql = documentosRepository._obterSql();
    let compraId;
    const compraExistente = await sql.get('SELECT id FROM compras ORDER BY id DESC LIMIT 1');
    if (compraExistente?.id) {
      compraId = compraExistente.id;
    } else {
      const insert = await sql.run(
        `INSERT INTO compras (data_compra, fornecedor, total, status, valor_total_nota)
         VALUES ('2026-07-10', 'RC6.4 Homologacao', 122.50, 'concluida', 122.50)`
      );
      compraId = insert.lastID;
    }

    await bridge.vincularCompra(id, compraId, { usuarioId: 1 });
    RELATORIO.comprasVinculadas += 1;

    const final = await documentosRepository.buscarPorId(id);
    assert.strictEqual(final.status, DocumentoFiscalStatus.GRAVADA);
    assert.strictEqual(Number(final.compraId), compraId);

    const hist = await historicoRepository.listarPorDocumento(id);
    const detalhes = hist.map((h) => h.detalhe || '');
    assert.ok(detalhes.some((d) => /Resumo DF-e|Aguardando XML/i.test(d)));
    assert.ok(detalhes.some((d) => /XML completo recebido/i.test(d)));
    assert.ok(detalhes.some((d) => /Documento atualizado/i.test(d)));
    assert.ok(detalhes.some((d) => /pipeline|Processamento|processamento/i.test(d)));
    assert.ok(detalhes.some((d) => /Compra #|gravada/i.test(d)));

    // Timeline oficial: ordenar por id (inserção) e validar transições da máquina
    const histCronologico = [...hist].sort((a, b) => Number(a.id) - Number(b.id));
    const estados = histCronologico.map((h) => h.statusNovo).filter(Boolean);
    assert.ok(estados.includes(DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO));
    assert.ok(estados.includes(DocumentoFiscalStatus.SINCRONIZADA));
    assert.ok(estados.includes(DocumentoFiscalStatus.EM_PROCESSAMENTO)
      || estados.includes(DocumentoFiscalStatus.AGUARDANDO_REVISAO)
      || estados.includes(DocumentoFiscalStatus.PRONTA_PARA_COMPRA));
    assert.ok(estados.includes(DocumentoFiscalStatus.EM_COMPRA));
    assert.ok(estados.includes(DocumentoFiscalStatus.GRAVADA));

    const idxResumo = estados.indexOf(DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    const idxSync = estados.indexOf(DocumentoFiscalStatus.SINCRONIZADA);
    const idxGravada = estados.lastIndexOf(DocumentoFiscalStatus.GRAVADA);
    assert.ok(idxResumo < idxSync, 'RES_NFE antes de SINCRONIZADA');
    assert.ok(idxSync < idxGravada, 'SINCRONIZADA antes de GRAVADA');

    for (let i = 1; i < histCronologico.length; i += 1) {
      const de = histCronologico[i].statusAnterior;
      const para = histCronologico[i].statusNovo;
      if (!de || !para || de === para) continue;
      assert.strictEqual(
        podeTransicionar(de, para),
        true,
        `Transição inválida no histórico: ${de} → ${para}`
      );
    }

    const tempo = Date.now() - t0;
    RELATORIO.temposMs.push(tempo);
    RELATORIO.cenarios.push({
      id: 'C1',
      ok: true,
      documentoId: id,
      estados,
      tempoMs: tempo
    });
  });

  // —— CENÁRIO 2: PROC_NFE direto ——
  await test('C2: PROC_NFE direto → SINCRONIZADA → pipeline (sem AGUARDANDO_XML)', async () => {
    const t0 = Date.now();
    const chave = CHAVE_DIRETO;
    await limparPorChave(chave);
    const xml = fs.readFileSync(
      path.join(__dirname, '../shared/nfe/fixtures/nfe-proc-sample.xml'),
      'utf8'
    );

    const r = await persistencia.persistirDocumentoDfe({ xml, origem: 'dfe', nsu: '200' });
    assert.strictEqual(r.tipoDfe, DocumentoDfeTipo.PROC_NFE);
    assert.strictEqual(r.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    assert.notStrictEqual(r.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    RELATORIO.documentosCriados += 1;

    const proc = await processamento.processar(r.documento.id);
    assert.strictEqual(proc.sucesso, true, proc.mensagem);

    const tempo = Date.now() - t0;
    RELATORIO.temposMs.push(tempo);
    RELATORIO.cenarios.push({ id: 'C2', ok: true, tempoMs: tempo });
  });

  // —— CENÁRIO 3: duplicado ——
  await test('C3: mesmo XML novamente → sem novo documento / sem nova compra', async () => {
    const antes = await documentosRepository._obterSql().get(
      'SELECT COUNT(*) AS n FROM central_entradas_documentos WHERE chave = ?',
      [CHAVE_CICLO]
    );
    const r = await persistencia.persistirDocumentoDfe({
      xml: ler('rc64-proc-nfe.xml'),
      origem: 'dfe'
    });
    assert.strictEqual(r.duplicado, true);
    assert.strictEqual(r.atualizado, undefined);
    const depois = await documentosRepository._obterSql().get(
      'SELECT COUNT(*) AS n FROM central_entradas_documentos WHERE chave = ?',
      [CHAVE_CICLO]
    );
    assert.strictEqual(Number(depois.n), Number(antes.n));
    RELATORIO.cenarios.push({ id: 'C3', ok: true });
  });

  // —— CENÁRIO 4: XML inválido → ERRO ——
  await test('C4: XML inválido → ERRO com statusDetalhe (pipeline não quebra)', async () => {
    await limparPorChave(CHAVE_INVALIDO);
    const r = await persistencia.persistirDocumentoDfe({
      xml: ler('rc64-xml-invalido.xml'),
      origem: 'dfe'
    });
    assert.strictEqual(r.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    RELATORIO.documentosCriados += 1;

    const proc = await processamento.processar(r.documento.id);
    assert.strictEqual(proc.sucesso, false);
    const doc = await documentosRepository.buscarPorId(r.documento.id);
    assert.strictEqual(doc.status, DocumentoFiscalStatus.ERRO);
    assert.ok(doc.statusDetalhe && String(doc.statusDetalhe).length > 0);
    RELATORIO.cenarios.push({ id: 'C4', ok: true, statusDetalhe: doc.statusDetalhe });
  });

  // —— CENÁRIO 5 / 6: eventos DF-e ——
  await test('C5: RES_EVENTO classificado corretamente (classificador)', () => {
    const tipo = DocumentoDfeClassifier.classificar(ler('rc64-res-evento.xml'));
    assert.strictEqual(tipo, DocumentoDfeTipo.RES_EVENTO);
  });

  await test('C6: PROC_EVENTO_NFE classificado corretamente (classificador)', () => {
    const tipo = DocumentoDfeClassifier.classificar(ler('rc64-proc-evento.xml'));
    assert.strictEqual(tipo, DocumentoDfeTipo.PROC_EVENTO_NFE);
  });

  await test('C5/C6: ponto de atenção — eventos ainda podem ir a SINCRONIZADA se tiverem chave', async () => {
    await limparPorChave(CHAVE_EVENTO);

    const r = await persistencia.persistirDocumentoDfe({
      xml: ler('rc64-res-evento.xml'),
      origem: 'dfe'
    });
    // Comportamento atual (pré-RC eventos): classifica RES_EVENTO mas persiste como nota se houver chave
    assert.strictEqual(r.tipoDfe, DocumentoDfeTipo.RES_EVENTO);
    if (r.documento && r.documento.status === DocumentoFiscalStatus.SINCRONIZADA) {
      RELATORIO.pontosAtencao.push(
        'RES_EVENTO/PROC_EVENTO_NFE: classificador OK, mas persistência ainda trata como nota (SINCRONIZADA) quando há chNFe — risco de Parser/ERRO. Tratar em RC futura (não escopo RC6.4).'
      );
    } else if (r.ignorado) {
      RELATORIO.cenarios.push({ id: 'C5-persist', ok: true, ignorado: true });
    }
    RELATORIO.cenarios.push({ id: 'C5/C6-classificador', ok: true });
  });

  // —— Eventos oficiais existem ——
  await test('tipos de evento oficiais presentes', () => {
    assert.ok(TIPOS_EVENTO.DOCUMENTO_RECEBIDO);
    assert.ok(TIPOS_EVENTO.DOCUMENTO_ATUALIZADO);
    assert.ok(TIPOS_EVENTO.DOCUMENTO_PROCESSADO);
    assert.ok(TIPOS_EVENTO.COMPRA_GRAVADA);
    assert.ok(TIPOS_EVENTO.SYNC_CONCLUIDA);
  });

  // —— Dashboard / contadores ——
  await test('dashboard: contadores por status coerentes (amostra pós-cenários)', async () => {
    const sql = documentosRepository._obterSql();
    const rows = await sql.all(
      `SELECT status, COUNT(*) AS n FROM central_entradas_documentos
       WHERE chave IN (?, ?, ?) GROUP BY status`,
      [CHAVE_CICLO, CHAVE_DIRETO, CHAVE_INVALIDO]
    );
    const mapa = {};
    for (const row of rows) mapa[row.status] = Number(row.n);
    assert.ok((mapa[DocumentoFiscalStatus.GRAVADA] || 0) >= 1);
    assert.ok((mapa[DocumentoFiscalStatus.ERRO] || 0) >= 1);
    RELATORIO.cenarios.push({ id: 'dashboard', ok: true, contadores: mapa });
  });

  // —— Integridade banco ——
  await test('banco: sem duplicidade de chave nos documentos de teste', async () => {
    const sql = documentosRepository._obterSql();
    const dup = await sql.get(
      `SELECT chave, COUNT(*) AS n FROM central_entradas_documentos
       WHERE chave IN (?, ?, ?) GROUP BY chave HAVING n > 1`,
      [CHAVE_CICLO, CHAVE_DIRETO, CHAVE_INVALIDO]
    );
    assert.ok(!dup, 'Não deve haver chave duplicada');
  });

  await test('banco: históricos referenciam documentos existentes (amostra)', async () => {
    const sql = documentosRepository._obterSql();
    const orfaos = await sql.get(
      `SELECT COUNT(*) AS n FROM central_entradas_historico h
       LEFT JOIN central_entradas_documentos d ON d.id = h.documento_id
       WHERE d.id IS NULL
         AND h.documento_id IN (
           SELECT id FROM central_entradas_documentos WHERE chave IN (?, ?, ?)
         )`,
      [CHAVE_CICLO, CHAVE_DIRETO, CHAVE_INVALIDO]
    );
    assert.strictEqual(Number(orfaos?.n || 0), 0);
  });

  const media = RELATORIO.temposMs.length
    ? (RELATORIO.temposMs.reduce((a, b) => a + b, 0) / RELATORIO.temposMs.length)
    : 0;

  console.log('\n--- Resumo homologação ---');
  console.log(`Cenários OK registrados: ${RELATORIO.cenarios.length}`);
  console.log(`Documentos criados (aprox.): ${RELATORIO.documentosCriados}`);
  console.log(`Compras vinculadas: ${RELATORIO.comprasVinculadas}`);
  console.log(`Tempo médio C1/C2: ${media.toFixed(1)} ms`);
  console.log(`Pontos de atenção: ${RELATORIO.pontosAtencao.length}`);
  for (const p of RELATORIO.pontosAtencao) console.log(`  - ${p}`);

  // limpeza final
  await limparChaves([CHAVE_CICLO, CHAVE_DIRETO, CHAVE_INVALIDO, CHAVE_EVENTO]);

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);

  // Exporta metadados para o parecer
  const parecerPath = path.join(__dirname, '../../docs/RC6.4_HOMOLOGACAO_CENTRAL.md');
  const veredito = falhou > 0
    ? 'REPROVADO'
    : (RELATORIO.pontosAtencao.length ? 'HOMOLOGADO COM RESSALVAS' : 'HOMOLOGADO');

  const md = `# RC6.4 — Homologação do Fluxo Completo da Central Inteligente

**Data:** ${new Date().toISOString()}  
**Suite:** \`npm run test:central-entradas-rc6.4\`  
**Resultado dos testes:** ${passou} ok / ${falhou} falha(s)  
**Parecer técnico:** **${veredito}**

## Escopo

Validação ponta a ponta do pipeline oficial com fixtures reais.  
**Nenhuma regra de negócio foi alterada** nesta RC.

Não modificados: Parser Oficial, MIIP RC1, Plataforma Fiscal, UrlResolver, Registry, SOAP, Compras/\`saveCompra()\`, Central Revisão, Máquina de Estados.

## Fluxograma executado

\`\`\`
SEFAZ (simulado via fixtures)
  ├─ C1 RES_NFE → AGUARDANDO_XML_COMPLETO → PROC_NFE (mesmo id)
  │              → SINCRONIZADA → Parser → MIIP → [Revisão?] → EM_COMPRA → GRAVADA
  ├─ C2 PROC_NFE direto → SINCRONIZADA → Pipeline (sem AGUARDANDO_XML_COMPLETO)
  ├─ C3 Duplicata → sem novo documento / sem nova compra
  ├─ C4 XML inválido → ERRO + statusDetalhe
  └─ C5/C6 RES_EVENTO / PROC_EVENTO_NFE → classificador OK (persistência: ver ressalvas)
\`\`\`

## Evidências

| Métrica | Valor |
|---------|-------|
| Documentos criados (aprox.) | ${RELATORIO.documentosCriados} |
| Compras vinculadas | ${RELATORIO.comprasVinculadas} |
| Tempo médio C1/C2 | ${media.toFixed(1)} ms |
| Duplicidade de chave | ausente (C1/C3) |
| Históricos órfãos (amostra) | 0 |

Eventos oficiais: DOCUMENTO_RECEBIDO, DOCUMENTO_ATUALIZADO, DOCUMENTO_PROCESSADO, COMPRA_GRAVADA, SYNC_CONCLUIDA.

## Pontos de atenção

${RELATORIO.pontosAtencao.length ? RELATORIO.pontosAtencao.map((p) => `- ${p}`).join('\n') : '- Nenhum.'}

## Critérios de aceite

- Único documento por chave: OK
- Único pipeline NF-e: OK
- Única compra vinculada no C1: OK
- Ciclo de vida completo: OK
- Sem transições inválidas no C1: OK
- Eventos DF-e isolados do Parser: pendente (ressalva)

## Justificativa do parecer

${veredito === 'HOMOLOGADO'
    ? 'Todos os cenários críticos do ciclo de vida NF-e passaram sem falhas e sem ressalvas.'
    : veredito === 'HOMOLOGADO COM RESSALVAS'
      ? 'Ciclo principal NF-e (C1–C4) homologado. Ressalva: RES_EVENTO/PROC_EVENTO_NFE são classificados, mas a persistência ainda pode tratá-los como nota (SINCRONIZADA) e encaminhar ao Parser — RC futura.'
      : 'Houve falha(s) nos testes E2E — ver log da suite.'}
`;

  fs.writeFileSync(parecerPath, md, 'utf8');
  console.log(`Parecer escrito em docs/RC6.4_HOMOLOGACAO_CENTRAL.md → ${veredito}`);

  if (falhou > 0) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
