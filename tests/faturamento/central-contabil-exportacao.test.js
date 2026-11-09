'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');

const databaseModule = require.resolve('../../backend/database');
assert.equal(require.cache[databaseModule], undefined);

const {
  exportarContabilidade,
  limparExportacaoTemporaria,
  sincronizarHistoricoNfcePeriodo
} = require('../../backend/services/fiscal/exportarContabilidadeService');
const {
  criarHandlerExportarContabilidade
} = require('../../backend/services/fiscal/exportarContabilidadeHandler');

assert.equal(require.cache[databaseModule], undefined);

const CHAVE = '23261047627408000151650010000100031688469487';
const CHAVE_DIVERGENTE = '23261047627408000151650010000100041688469486';
const PROTOCOLO = '223260874568598';
const DIGEST = 'RPeZioxYXIKEETEmulTDX8EzfzY=';

function xmlAssinado(chave = CHAVE) {
  return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>23</cUF></ide></infNFe>`
    + `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference>`
    + `<DigestValue>${DIGEST}</DigestValue></Reference></SignedInfo><SignatureValue>fixture</SignatureValue></Signature>`
    + `</NFe>`;
}

function nfeProc({ chave = CHAVE, protocolo = PROTOCOLO, cStat = '100' } = {}) {
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}" versao="4.00">`
    + `<ide><cUF>23</cUF></ide></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">`
    + `<SignedInfo><Reference><DigestValue>${DIGEST}</DigestValue></Reference></SignedInfo>`
    + `<SignatureValue>fixture</SignatureValue></Signature></NFe>`
    + `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infProt>`
    + `<chNFe>${chave}</chNFe><cStat>${cStat}</cStat><xMotivo>Autorizado</xMotivo>`
    + `<nProt>${protocolo}</nProt><digVal>${DIGEST}</digVal></infProt></protNFe></nfeProc>`;
}

function notaNfce(overrides = {}) {
  return {
    id: 10003,
    venda_id: 501,
    status: 'autorizada',
    chave_acesso: CHAVE,
    protocolo: PROTOCOLO,
    xml_enviado: xmlAssinado(),
    xml_retorno: `<retEnviNFe>${nfeProc()}</retEnviNFe>`,
    xml_autorizado: nfeProc(),
    created_at: '2001-01-15 12:00:00',
    ...overrides
  };
}

function fakeReadOnlyDatabase({ nfce = [], nfe = [] } = {}) {
  const queries = [];
  return {
    queries,
    all(sql, params, callback) {
      queries.push({ sql, params });
      if (sql.includes('FROM nfce_notas n')) return callback(null, nfce);
      if (sql.includes('FROM nfe_notas n')) return callback(null, nfe);
      return callback(null, []);
    }
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function abrirZip(caminho) {
  const zip = fs.readFileSync(caminho);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(eocd, -1, 'ZIP deve conter o registro End of Central Directory');

  const quantidade = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const arquivos = new Map();

  for (let i = 0; i < quantidade; i += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50, 'entrada central do ZIP inválida');
    const metodo = zip.readUInt16LE(offset + 10);
    const crcEsperado = zip.readUInt32LE(offset + 16);
    const tamanhoCompactado = zip.readUInt32LE(offset + 20);
    const tamanhoOriginal = zip.readUInt32LE(offset + 24);
    const tamanhoNome = zip.readUInt16LE(offset + 28);
    const tamanhoExtra = zip.readUInt16LE(offset + 30);
    const tamanhoComentario = zip.readUInt16LE(offset + 32);
    const offsetLocal = zip.readUInt32LE(offset + 42);
    const nome = zip.toString('utf8', offset + 46, offset + 46 + tamanhoNome);

    assert.equal(zip.readUInt32LE(offsetLocal), 0x04034b50, `cabeçalho local inválido: ${nome}`);
    const inicioDados = offsetLocal + 30
      + zip.readUInt16LE(offsetLocal + 26)
      + zip.readUInt16LE(offsetLocal + 28);
    const dadosCompactados = zip.subarray(inicioDados, inicioDados + tamanhoCompactado);
    const dados = metodo === 8
      ? inflateRawSync(dadosCompactados)
      : metodo === 0
        ? Buffer.from(dadosCompactados)
        : assert.fail(`método de compressão ZIP não suportado: ${metodo}`);

    assert.equal(dados.length, tamanhoOriginal, `tamanho descompactado inválido: ${nome}`);
    assert.equal(crc32(dados), crcEsperado, `CRC inválido: ${nome}`);
    arquivos.set(nome, dados);
    offset += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return arquivos;
}

function apagarExportacao(resultado, tempDir) {
  if (resultado) limparExportacaoTemporaria(resultado);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

describe('Central Contábil — exportação isolada', () => {
  it('sincroniza o histórico usando a conexão injetada sem carregar o banco global', async () => {
    const db = fakeReadOnlyDatabase();
    const resultado = await sincronizarHistoricoNfcePeriodo(
      '2001-01-01',
      '2001-01-31',
      db
    );

    assert.deepEqual(resultado, { sincronizados: 0 });
    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].sql, /FROM fechamentos_fiscais ff/);
    assert.equal(require.cache[databaseModule], undefined);
  });

  it('handler injeta dependências, preserva cabeçalhos e envia o ZIP', async () => {
    const opcoesRecebidas = [];
    const resultado = {
      nomeZip: 'CONTABILIDADE_2001_01.zip',
      caminhoZip: 'caminho-controlado.zip',
      arquivosGerados: ['CONTABILIDADE_2001-01/RELATORIOS/manifesto_exportacao.txt'],
      resumo: { quantidadeNfce: 1 }
    };
    const listeners = {};
    let caminhoLido;
    let caminhoLimpo;
    let respostaEnviada = false;
    const stream = {
      on(evento, listener) {
        listeners[evento] = listener;
        return this;
      },
      pipe(resposta) {
        assert.strictEqual(resposta, res);
        respostaEnviada = true;
      }
    };
    const res = {
      headers: {},
      setHeader(nome, valor) {
        this.headers[nome] = valor;
      },
      on(evento, listener) {
        listeners[`response:${evento}`] = listener;
      },
      status(codigo) {
        this.statusCode = codigo;
        return this;
      },
      json(body) {
        this.body = body;
      }
    };
    const handler = criarHandlerExportarContabilidade({
      async exportarContabilidade(opcoes) {
        opcoesRecebidas.push(opcoes);
        return resultado;
      },
      limparExportacaoTemporaria(valor) {
        caminhoLimpo = valor;
      },
      fsApi: {
        createReadStream(caminho) {
          caminhoLido = caminho;
          return stream;
        }
      }
    });

    await handler({
      body: {
        dataInicial: '2001-01-01',
        dataFinal: '2001-01-31',
        incluirNfce: true,
        incluirNfe: false
      }
    }, res);

    assert.deepEqual(opcoesRecebidas, [{
      dataInicial: '2001-01-01',
      dataFinal: '2001-01-31',
      incluirNfce: true,
      incluirNfe: false,
      incluirEntradas: undefined,
      incluirRelatorios: undefined,
      incluirManifesto: undefined
    }]);
    assert.equal(caminhoLido, resultado.caminhoZip);
    assert.equal(res.headers['Content-Type'], 'application/zip');
    assert.equal(res.headers['X-Export-Filename'], resultado.nomeZip);
    assert.equal(res.headers['X-Export-Resumo'], JSON.stringify(resultado.resumo));
    assert.equal(respostaEnviada, true);

    listeners.close();
    assert.strictEqual(caminhoLimpo, resultado);
  });

  it('handler retorna erro controlado sem simular sucesso de exportação', async () => {
    const res = {
      status(codigo) {
        this.statusCode = codigo;
        return this;
      },
      json(body) {
        this.body = body;
      }
    };
    const handler = criarHandlerExportarContabilidade({
      async exportarContabilidade() {
        const error = new Error('Falha controlada ao exportar.');
        error.statusCode = 500;
        throw error;
      },
      limparExportacaoTemporaria() {
        assert.fail('não deve limpar exportação inexistente');
      },
      fsApi: { createReadStream() { assert.fail('não deve abrir ZIP inexistente'); } }
    });

    await handler({ body: {} }, res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Falha controlada ao exportar.' });
  });

  it('gera ZIP verificável com NFC-e válida, bloqueio e manifesto coerente', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-contabil-nfce-'));
    const db = fakeReadOnlyDatabase({
      nfce: [
        notaNfce(),
        notaNfce({
          id: 10004,
          chave_acesso: CHAVE_DIVERGENTE,
          xml_enviado: xmlAssinado(CHAVE_DIVERGENTE),
          xml_retorno: `<retEnviNFe>${nfeProc({ chave: CHAVE_DIVERGENTE, cStat: '150' })}</retEnviNFe>`,
          xml_autorizado: nfeProc({ chave: CHAVE_DIVERGENTE, cStat: '150' })
        })
      ]
    });
    let resultado;

    try {
      resultado = await exportarContabilidade({
        dataInicial: '2001-01-01',
        dataFinal: '2001-01-31',
        incluirNfce: true,
        incluirNfe: false,
        incluirEntradas: false,
        incluirRelatorios: false,
        incluirManifesto: true
      }, { dbOverride: db, tempDir });

      assert.equal(db.queries.length, 1);
      assert.match(db.queries[0].sql, /FROM nfce_notas n/);
      assert.equal(fs.existsSync(resultado.caminhoZip), true);
      assert.equal(resultado.resumo.quantidadeNfce, 2);
      assert.equal(resultado.resumo.xmlsNfceExportados, 1);
      assert.equal(resultado.resumo.xmlsNfceBloqueados, 1);
      assert.equal(resultado.resumo.quantidadeNfceBloqueadas, 1);

      const arquivos = abrirZip(resultado.caminhoZip);
      const nomeValido = `${resultado.nomePasta}/XML_NFCE/${CHAVE}.xml`;
      const nomeBloqueado = `${resultado.nomePasta}/XML_NFCE/${CHAVE_DIVERGENTE}.xml`;
      const nomeManifesto = `${resultado.nomePasta}/RELATORIOS/manifesto_exportacao.txt`;
      assert.equal(arquivos.has(nomeValido), true);
      assert.equal(arquivos.has(nomeBloqueado), false);
      assert.equal(arquivos.has(nomeManifesto), true);

      const xml = arquivos.get(nomeValido).toString('utf8');
      assert.match(xml, /^<\?xml|^<nfeProc\b/);
      assert.match(xml, /<nfeProc\b[^>]*versao="4\.00"/);
      assert.match(xml, new RegExp(`<infNFe Id="NFe${CHAVE}" versao="4\\.00"`));
      assert.match(xml, /<protNFe\b[^>]*versao="4\.00"/);
      assert.match(xml, new RegExp(`<chNFe>${CHAVE}</chNFe>`));
      assert.match(xml, /<cStat>100<\/cStat>/);
      assert.match(xml, new RegExp(`<nProt>${PROTOCOLO}</nProt>`));
      assert.match(xml, new RegExp(`<digVal>${DIGEST}</digVal>`));

      const manifesto = arquivos.get(nomeManifesto).toString('utf8');
      assert.match(manifesto, /Documentos não exportados como XML autorizado:/);
      assert.match(manifesto, /PROTOCOLO_NAO_AUTORIZADO/);
      assert.match(manifesto, new RegExp(CHAVE_DIVERGENTE));
      assert.match(manifesto, /NFC-e avaliadas: 2/);
      assert.match(manifesto, /XMLs NFC-e incluídos: 1/);
      assert.match(manifesto, /NFC-e bloqueadas: 1/);
    } finally {
      apagarExportacao(resultado, tempDir);
    }
  });

  it('mantém a exportação NF-e no fluxo independente legado', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-contabil-nfe-'));
    const xmlNfe = nfeProc();
    const db = fakeReadOnlyDatabase({
      nfe: [{
        id: 20003,
        venda_id: 601,
        status: 'autorizada',
        chave_acesso: CHAVE,
        xml_retorno: `<retEnviNFe>${xmlNfe}</retEnviNFe>`,
        created_at: '2001-01-15 12:00:00'
      }]
    });
    let resultado;

    try {
      resultado = await exportarContabilidade({
        dataInicial: '2001-01-01',
        dataFinal: '2001-01-31',
        incluirNfce: false,
        incluirNfe: true,
        incluirEntradas: false,
        incluirRelatorios: false,
        incluirManifesto: false
      }, { dbOverride: db, tempDir });

      assert.equal(db.queries.length, 1);
      assert.match(db.queries[0].sql, /FROM nfe_notas n/);
      assert.equal(resultado.resumo.quantidadeNfe, 1);
      assert.equal(resultado.resumo.xmlsNfeExportados, 1);
      const arquivos = abrirZip(resultado.caminhoZip);
      const nomeNfe = `${resultado.nomePasta}/XML_NFE/${CHAVE}.xml`;
      assert.equal(arquivos.has(nomeNfe), true);
      assert.match(arquivos.get(nomeNfe).toString('utf8'), /<nfeProc\b/);
    } finally {
      apagarExportacao(resultado, tempDir);
    }
  });
});
