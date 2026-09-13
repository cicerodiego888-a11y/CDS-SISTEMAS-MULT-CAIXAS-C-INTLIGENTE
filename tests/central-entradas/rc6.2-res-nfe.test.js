/**
 * Testes — RC6.2 Tratamento inteligente de RES_NFE
 * Sem HTTP / SEFAZ / Parser real / MIIP real.
 *
 * Executar: npm run test:central-entradas-rc6.2
 */

const assert = require('assert');
const { DocumentoFiscalStatus, LABELS_UI } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const {
  podeTransicionar,
  validarTransicao,
  TRANSICOES_PERMITIDAS
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const DocumentoDfeClassifier = require('../../backend/motores/central-entradas/services/DocumentoDfeClassifier');
const CentralDfePersistenciaService = require('../../backend/motores/central-entradas/services/CentralDfePersistenciaService');
const CentralProcessamentoService = require('../../backend/motores/central-entradas/services/CentralProcessamentoService');

let passou = 0;
let falhou = 0;

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

const XML_RES_NFE = `<?xml version="1.0"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>23260707196033002141550090012840571375100827</chNFe>
  <CNPJ>07196033002141</CNPJ>
  <xNome>FORNECEDOR TESTE</xNome>
  <dhEmi>2026-07-10T10:00:00-03:00</dhEmi>
  <vNF>100.00</vNF>
</resNFe>`;

const XML_PROC_NFE = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe23260707196033002141550090012840571375100899">
      <ide><nNF>1</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-07-10T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>07196033002141</CNPJ><xNome>FORNECEDOR</xNome></emit>
      <total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;

const XML_NFE = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe23260707196033002141550090012840571375100900">
    <ide><nNF>2</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-07-10T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>07196033002141</CNPJ><xNome>FORNECEDOR</xNome></emit>
    <total><ICMSTot><vNF>20.00</vNF></ICMSTot></total>
  </infNFe>
</NFe>`;

function criarReposMemoria() {
  const docs = new Map();
  let seq = 1;
  const historico = [];

  return {
    documentosRepository: {
      buscarPorChave: async (chave) => {
        for (const d of docs.values()) {
          if (d.chave === chave) return d;
        }
        return null;
      },
      buscarPorId: async (id) => docs.get(id) || null,
      inserir: async (dados) => {
        const doc = {
          id: seq++,
          ...dados,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        docs.set(doc.id, doc);
        return doc;
      },
      atualizar: async (id, patch) => {
        const doc = docs.get(id);
        if (!doc) return null;
        Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
        return doc;
      },
      listarPendentesProcessamento: async () => [...docs.values()].filter(
        (d) => d.status === DocumentoFiscalStatus.SINCRONIZADA && !d.parseJson
      ),
      _docs: docs
    },
    historicoRepository: {
      inserir: async (row) => {
        historico.push(row);
        return { id: historico.length, ...row };
      },
      _rows: historico
    }
  };
}

async function main() {
  console.log('\n=== Testes RC6.2 — RES_NFE / AGUARDANDO_XML_COMPLETO ===\n');

  await test('auditoria: não existia estado equivalente — AGUARDANDO_XML_COMPLETO criado', () => {
    assert.strictEqual(
      DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      'AGUARDANDO_XML_COMPLETO'
    );
    assert.strictEqual(
      LABELS_UI[DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO],
      'Aguardando XML Completo'
    );
    assert.ok(TRANSICOES_PERMITIDAS[DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO]);
  });

  await test('transições AGUARDANDO_XML_COMPLETO → SINCRONIZADA / DESCARTADA', () => {
    assert.strictEqual(
      podeTransicionar(
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
        DocumentoFiscalStatus.SINCRONIZADA
      ),
      true
    );
    assert.strictEqual(
      podeTransicionar(
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
        DocumentoFiscalStatus.DESCARTADA
      ),
      true
    );
    assert.strictEqual(
      podeTransicionar(
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
        DocumentoFiscalStatus.EM_PROCESSAMENTO
      ),
      false
    );
    assert.strictEqual(
      validarTransicao(
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
        DocumentoFiscalStatus.ERRO
      ).valido,
      false
    );
  });

  await test('RES_NFE persiste como AGUARDANDO_XML_COMPLETO e nunca ERRO', async () => {
    const mem = criarReposMemoria();
    const svc = new CentralDfePersistenciaService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository
    });
    svc.existeCompraComChave = async () => false;

    const resultado = await svc.persistirDocumentoDfe({
      xml: XML_RES_NFE,
      nsu: '1',
      origem: 'dfe'
    });

    assert.strictEqual(resultado.tipoDfe, DocumentoDfeTipo.RES_NFE);
    assert.strictEqual(resultado.novo, true);
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.notStrictEqual(resultado.documento.status, DocumentoFiscalStatus.ERRO);
    assert.strictEqual(
      resultado.documento.statusDetalhe,
      CentralDfePersistenciaService.DETALHE_RES_NFE
    );
    assert.strictEqual(
      mem.historicoRepository._rows[0].detalhe,
      CentralDfePersistenciaService.DETALHE_RES_NFE
    );
  });

  await test('RES_NFE não entra em listarPendentesProcessamento (não chama Parser/MIIP)', async () => {
    const mem = criarReposMemoria();
    const svc = new CentralDfePersistenciaService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository
    });
    svc.existeCompraComChave = async () => false;

    await svc.persistirDocumentoDfe({ xml: XML_RES_NFE, origem: 'dfe' });
    const pendentes = await mem.documentosRepository.listarPendentesProcessamento();
    assert.strictEqual(pendentes.length, 0);
  });

  await test('processar() com RES_NFE em AGUARDANDO_XML_COMPLETO não chama Parser', async () => {
    let parserChamado = false;
    let miipChamado = false;

    const mem = criarReposMemoria();
    const persist = new CentralDfePersistenciaService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository
    });
    persist.existeCompraComChave = async () => false;
    const { documento } = await persist.persistirDocumentoDfe({ xml: XML_RES_NFE, origem: 'dfe' });

    // Injeta stubs via monkey-patch do módulo usado pelo processamento seria invasivo;
    // validamos o gate oficial: só SINCRONIZADA processa.
    assert.strictEqual(documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);

    const processamento = new CentralProcessamentoService({
      documentosRepository: {
        buscarPorId: async () => documento
      },
      historicoService: { registrar: async () => {} },
      transitionService: {
        transicionar: async () => {
          throw new Error('não deveria transicionar RES_NFE');
        }
      }
    });

    // Substitui parse interno: se chegar a chamar, falha o teste
    const NFeParserService = require('../../backend/shared/nfe/NFeParserService');
    const parseOriginal = NFeParserService.parse;
    NFeParserService.parse = async () => {
      parserChamado = true;
      throw new Error('Parser não deveria ser chamado');
    };

    try {
      const resultado = await processamento.processar(documento.id);
      assert.strictEqual(resultado.sucesso, false);
      assert.ok(/não pode ser processado|AGUARDANDO_XML_COMPLETO/i.test(resultado.mensagem || ''));
      assert.strictEqual(parserChamado, false);
      assert.strictEqual(miipChamado, false);
      assert.notStrictEqual(documento.status, DocumentoFiscalStatus.ERRO);
    } finally {
      NFeParserService.parse = parseOriginal;
    }
  });

  await test('PROC_NFE continua SINCRONIZADA (pipeline atual)', async () => {
    assert.strictEqual(
      DocumentoDfeClassifier.classificar(XML_PROC_NFE),
      DocumentoDfeTipo.PROC_NFE
    );
    const mem = criarReposMemoria();
    const svc = new CentralDfePersistenciaService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository
    });
    svc.existeCompraComChave = async () => false;

    const resultado = await svc.persistirDocumentoDfe({ xml: XML_PROC_NFE, origem: 'dfe' });
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    const pendentes = await mem.documentosRepository.listarPendentesProcessamento();
    assert.strictEqual(pendentes.length, 1);
  });

  await test('NFE continua SINCRONIZADA (pipeline atual)', async () => {
    assert.strictEqual(DocumentoDfeClassifier.classificar(XML_NFE), DocumentoDfeTipo.NFE);
    const mem = criarReposMemoria();
    const svc = new CentralDfePersistenciaService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository
    });
    svc.existeCompraComChave = async () => false;

    const resultado = await svc.persistirDocumentoDfe({ xml: XML_NFE, origem: 'dfe' });
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
  });

  await test('DESCONHECIDO sem chave permanece ignorado (comportamento atual)', async () => {
    const mem = criarReposMemoria();
    const svc = new CentralDfePersistenciaService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository
    });
    const resultado = await svc.persistirDocumentoDfe({
      xml: '<retDistDFeInt versao="1.01"/>',
      origem: 'dfe'
    });
    assert.strictEqual(resultado.tipoDfe, DocumentoDfeTipo.DESCONHECIDO);
    assert.strictEqual(resultado.ignorado, true);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
