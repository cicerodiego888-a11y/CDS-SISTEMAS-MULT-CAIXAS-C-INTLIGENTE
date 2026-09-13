/**
 * RC3.3 — Fechamento RES_NFE → Ciência → DistDFe (NSU) → PROC_NFE.
 * Todos os acessos SEFAZ, certificado e banco são dublês em memória.
 */

const assert = require('assert');
const CentralManifestacaoDfeService = require(
  '../../backend/motores/central-entradas/services/CentralManifestacaoDfeService'
);
const {
  POLITICAS_MANIFESTACAO,
  MENSAGEM_AGUARDANDO_XML,
  extrairRetornoManifestacao,
  prepararEnvelopeAssinado
} = CentralManifestacaoDfeService;
const { DocumentoFiscalStatus } = require(
  '../../backend/motores/central-entradas/core/DocumentoFiscalStatus'
);
const { DocumentoDfeTipo } = require(
  '../../backend/motores/central-entradas/core/DocumentoDfeTipo'
);
const { TIPOS_EVENTO } = require(
  '../../backend/motores/central-entradas/config/centralEventosTipos'
);
const { CentralSyncExecucaoService } = require(
  '../../backend/motores/central-entradas/services/CentralSyncExecucaoService'
);
const CentralConfiguracaoService = require(
  '../../backend/motores/central-entradas/services/CentralConfiguracaoService'
);
const CentralConfiguracaoRepository = require(
  '../../backend/motores/central-entradas/repositories/CentralConfiguracaoRepository'
);

const CHAVE = '35260112345678000199550010000000641000000064';
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
      console.error(`         ${error.stack || error.message}`);
    });
}

function retornoManifestacao(cStat = '135', xMotivo = 'Evento registrado e vinculado a NF-e') {
  return `<soap:Envelope><soap:Body><retEnvEvento versao="1.00">
    <cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>
    <retEvento><infEvento>
      <tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>91</cOrgao>
      <cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>
      <chNFe>${CHAVE}</chNFe><tpEvento>210210</tpEvento>
      <nProt>135260000000001</nProt><dhRegEvento>2026-07-15T20:00:00-03:00</dhRegEvento>
    </infEvento></retEvento>
  </retEnvEvento></soap:Body></soap:Envelope>`;
}

function criarCenario(opcoes = {}) {
  let agora = new Date('2026-07-15T23:00:00.000Z');
  const documento = {
    id: 1,
    chave: CHAVE,
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    xml: '<resNFe/>',
    nsu: '000000000000001'
  };
  const eventos = [];
  const historico = [];
  let consultas = 0;
  let manifestacoes = 0;
  let nsuControle = {
    ultNsu: '000000000000001',
    maxNsu: '000000000000001',
    dataSincronizacao: '2026-07-15T20:00:00.000Z'
  };

  const documentosRepository = {
    buscarPorId: async () => documento,
    listarPorStatus: async () => [documento]
  };
  const eventosRepository = {
    listar: async (filtros) => eventos
      .filter((e) => e.tipo === filtros.tipo && e.documentoId === filtros.documentoId)
      .sort((a, b) => b.id - a.id)
      .slice(0, filtros.limite || 50),
    inserir: async (dados) => {
      const duplicado = eventos.find(
        (e) => e.tipo === dados.tipo && e.documentoId === (dados.documentoId ?? dados.documento_id)
          && ['MANIFESTACAO_ACEITA', 'MANIFESTACAO_CLAIM', 'PARSER_CONCLUIDO', 'MIIP_CONCLUIDO'].includes(dados.tipo)
      );
      if (duplicado) {
        const err = new Error('UNIQUE constraint failed');
        throw err;
      }
      const evento = {
        id: eventos.length + 1,
        createdAt: agora.toISOString(),
        ...dados,
        documentoId: dados.documentoId ?? dados.documento_id
      };
      eventos.push(evento);
      return evento;
    },
    inserirUnico: async (dados) => {
      try {
        const evento = await eventosRepository.inserir(dados);
        return { evento, criado: true, conflito: false };
      } catch (error) {
        if (/UNIQUE/i.test(error.message)) {
          const existentes = await eventosRepository.listar({
            tipo: dados.tipo,
            documentoId: dados.documentoId ?? dados.documento_id,
            limite: 1
          });
          return { evento: existentes[0] || null, criado: false, conflito: true };
        }
        throw error;
      }
    },
    removerPorTipoDocumento: async (tipo, documentoId) => {
      const antes = eventos.length;
      for (let i = eventos.length - 1; i >= 0; i -= 1) {
        if (eventos[i].tipo === tipo && eventos[i].documentoId === documentoId) {
          eventos.splice(i, 1);
        }
      }
      return eventos.length < antes;
    },
    contar: async (filtros) => (
      eventos.filter((e) => e.tipo === filtros.tipo && e.documentoId === filtros.documentoId).length
    )
  };
  const emitirEvento = async (dados) => eventosRepository.inserir(dados);

  const service = new CentralManifestacaoDfeService({
    documentosRepository,
    historicoRepository: {
      inserir: async (dados) => {
        historico.push(dados);
        return { id: historico.length, ...dados };
      },
      listarPorDocumento: async () => [...historico]
    },
    eventosRepository,
    nsuRepository: {
      buscarPorCnpjAmbiente: async () => nsuControle
    },
    nsuService: {
      buscarPorCnpjAmbiente: async () => nsuControle,
      avaliarCooldown: (controle) => {
        if (!controle?.dataSincronizacao) return { ativo: false };
        if (String(controle.ultNsu) !== String(controle.maxNsu) && !controle.cooldownAte) {
          return { ativo: false };
        }
        if (controle.cooldownAte) {
          const ate = new Date(controle.cooldownAte);
          if (agora < ate) {
            return { ativo: true, proximaConsultaEm: ate.toISOString() };
          }
        }
        const ultima = new Date(controle.dataSincronizacao);
        const proxima = new Date(ultima.getTime() + 60 * 60 * 1000);
        if (String(controle.ultNsu) === String(controle.maxNsu) && agora < proxima) {
          return { ativo: true, proximaConsultaEm: proxima.toISOString() };
        }
        return { ativo: false };
      }
    },
    configuracaoService: {
      obterPoliticaManifestacao: async () => (
        opcoes.politica || POLITICAS_MANIFESTACAO.AUTOMATICA_CIENCIA
      ),
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: {
          ambiente: 2,
          uf: 'SP',
          codigoUf: '35',
          cnpj: '12345678000199',
          certificadoPath: 'certificado.pfx',
          certificadoSenha: 'senha'
        }
      })
    },
    prepararEnvelopeAssinado: () => '<soap:Envelope><evento><Signature/></evento></soap:Envelope>',
    enviarManifestacao: async () => {
      manifestacoes += 1;
      if (opcoes.erroManifestacao) throw new Error(opcoes.erroManifestacao);
      return {
        success: true,
        source: opcoes.fallback ? 'FALLBACK' : 'PLATFORM',
        fallbackUtilizado: Boolean(opcoes.fallback),
        tempoTotalMs: 25,
        body: retornoManifestacao(
          opcoes.cStatManifestacao || '135',
          opcoes.xMotivoManifestacao
        )
      };
    },
    sincronizarDfe: async () => {
      consultas += 1;
      if (opcoes.erroConsulta) throw new Error(opcoes.erroConsulta);
      const cStat = opcoes.cStatConsulta || '138';
      if (cStat === '138') {
        documento.status = DocumentoFiscalStatus.SINCRONIZADA;
        documento.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        documento.xml = '<nfeProc/>';
        documento.nsu = '000000000000002';
        nsuControle = {
          ultNsu: '000000000000002',
          maxNsu: '000000000000002',
          dataSincronizacao: agora.toISOString()
        };
      }
      if (cStat === '137') {
        nsuControle = {
          ultNsu: nsuControle.ultNsu,
          maxNsu: nsuControle.maxNsu,
          dataSincronizacao: agora.toISOString()
        };
      }
      if (cStat === '656') {
        nsuControle = {
          ...nsuControle,
          cooldownAte: new Date(agora.getTime() + 60 * 60 * 1000).toISOString(),
          ultimoCstat: '656',
          dataSincronizacao: agora.toISOString()
        };
      }
      return {
        sucesso: cStat !== '656',
        cStat,
        ultNsu: nsuControle.ultNsu,
        maxNsu: nsuControle.maxNsu,
        proximaConsultaEm: nsuControle.cooldownAte || null,
        mensagem: cStat === '656'
          ? 'Consumo indevido'
          : (cStat === '137' ? 'Nenhum documento localizado' : 'ok')
      };
    },
    // RC3.3.6+ — fallback consChNFe: sem PROC nos testes RC3.3 (exceto se injetado).
    consultarNotaPorChave: async () => ({
      sucesso: true,
      cStat: '137',
      notasNovas: 0,
      notasDuplicadas: 0,
      mensagem: 'Nenhum documento localizado'
    }),
    emitirEvento,
    agora: () => agora
  });

  return {
    service,
    documento,
    eventos,
    historico,
    get consultas() { return consultas; },
    get manifestacoes() { return manifestacoes; },
    avancarHoras(h) {
      agora = new Date(agora.getTime() + h * 60 * 60 * 1000);
    },
    setNsu(controle) {
      nsuControle = { ...nsuControle, ...controle };
    },
    setNsuControle(valor) {
      nsuControle = { ...nsuControle, ...valor };
    },
    avancar(ms) {
      agora = new Date(agora.getTime() + ms);
    }
  };
}

async function main() {
  console.log('\n=== RC3.3 — Fechamento do ciclo DF-e ===\n');

  await test('parser da manifestação usa cStat do retEvento, protocolo e data', () => {
    const retorno = extrairRetornoManifestacao(retornoManifestacao());
    assert.strictEqual(retorno.cStat, '135');
    assert.strictEqual(retorno.aceita, true);
    assert.strictEqual(retorno.protocolo, '135260000000001');
    assert.strictEqual(retorno.dataRegistro, '2026-07-15T20:00:00-03:00');
  });

  await test('configuração oficial contém as três políticas e inicia em MANUAL', () => {
    assert.deepStrictEqual(
      [...CentralConfiguracaoService.POLITICAS_MANIFESTACAO],
      ['MANUAL', 'AUTOMATICA_CIENCIA', 'CONFIRMAR_OPERADOR']
    );
    const padrao = CentralConfiguracaoRepository.DEFAULTS.find(
      ([chave]) => chave === 'manifestacao_destinatario_politica'
    );
    assert.ok(padrao);
    assert.strictEqual(padrao[1], 'MANUAL');
  });

  await test('envelope pronto reutiliza builder, certificado e signer existentes', () => {
    let certificadoCarregado = false;
    let eventoAssinado = false;
    const envelope = prepararEnvelopeAssinado(
      { certificadoPath: 'cert.pfx', certificadoSenha: '1234' },
      {
        montarEnvelopeManifestacao: () => (
          '<soap:Envelope><evento><infEvento Id="ID210210">'
          + '<cOrgao>23</cOrgao><dhEvento>2026-07-15T20:00:00Z</dhEvento>'
          + '</infEvento></evento></soap:Envelope>'
        ),
        carregarCertificado: (path, senha) => {
          certificadoCarregado = path === 'cert.pfx' && senha === '1234';
          return { privateKeyPem: 'KEY', certPem: 'CERT' };
        },
        assinarEvento: (evento, key, cert) => {
          eventoAssinado = evento.includes('infEvento')
            && evento.includes('<cOrgao>91</cOrgao>')
            && !evento.includes('Z</dhEvento>')
            && key === 'KEY'
            && cert === 'CERT';
          return {
            xmlAssinado: '<evento><infEvento Id="ID210210"/><Signature/></evento>'
          };
        }
      }
    );
    assert.strictEqual(certificadoCarregado, true);
    assert.strictEqual(eventoAssinado, true);
    assert.match(envelope, /<Signature\/>/);
  });

  await test('após Ciência não consulta DistDFe imediatamente e mantém AGUARDANDO', async () => {
    const cenario = criarCenario();
    const primeiro = await cenario.service.processarCandidatos();
    assert.strictEqual(primeiro.concluidos, 0);
    assert.strictEqual(cenario.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.strictEqual(cenario.documento.tipoDocumento, DocumentoDfeTipo.RES_NFE);
    assert.strictEqual(cenario.manifestacoes, 1);
    assert.strictEqual(cenario.consultas, 0);
    assert.ok(cenario.eventos.some((e) => e.tipo === TIPOS_EVENTO.CIENCIA_ENVIADA));
    assert.ok(cenario.eventos.some((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA));
    assert.ok(cenario.historico.some((h) => h.detalhe === MENSAGEM_AGUARDANDO_XML));

    const segundo = await cenario.service.processarDocumento(1, {
      confirmado: true,
      apenasManifestacao: true
    });
    assert.strictEqual(segundo.aguardandoDisponibilizacao, true);
    assert.strictEqual(cenario.manifestacoes, 1);
    assert.strictEqual(cenario.consultas, 0);
  });

  await test('DistDFe por NSU promove PROC_NFE somente após janela segura', async () => {
    const cenario = criarCenario();
    await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(cenario.consultas, 0);

    const bloqueado = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(bloqueado.aguardandoDisponibilizacao, true);
    assert.strictEqual(bloqueado.mensagem, MENSAGEM_AGUARDANDO_XML);
    assert.strictEqual(cenario.consultas, 0);

    cenario.avancar(60 * 60 * 1000 + 1);
    cenario.setNsuControle({
      ultNsu: '000000000000001',
      maxNsu: '000000000000050',
      dataSincronizacao: '2026-07-15T20:00:00.000Z'
    });
    const promovido = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(promovido.xmlCompleto, true);
    assert.strictEqual(cenario.consultas, 1);
    assert.strictEqual(cenario.documento.tipoDocumento, DocumentoDfeTipo.PROC_NFE);
  });

  await test('cStat 137 mantém AGUARDANDO e bloqueia nova DistDFe por 1 hora', async () => {
    const cenario = criarCenario({ cStatConsulta: '137' });
    await cenario.service.processarDocumento(1, { confirmado: true });
    cenario.avancar(60 * 60 * 1000 + 1);
    cenario.setNsuControle({
      ultNsu: '000000000000001',
      maxNsu: '000000000000050',
      dataSincronizacao: '2026-07-15T20:00:00.000Z'
    });

    const primeiro = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(primeiro.cStat, '137');
    assert.strictEqual(primeiro.aguardandoDisponibilizacao, true);
    assert.strictEqual(primeiro.mensagem, MENSAGEM_AGUARDANDO_XML);
    assert.strictEqual(cenario.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.strictEqual(cenario.consultas, 1);

    const bloqueado = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(bloqueado.aguardandoDisponibilizacao, true);
    assert.strictEqual(cenario.consultas, 1);
  });

  await test('cStat 656 bloqueia repetição por uma hora', async () => {
    const cenario = criarCenario({ cStatConsulta: '656' });
    await cenario.service.processarDocumento(1, { confirmado: true });
    cenario.avancar(60 * 60 * 1000 + 1);
    cenario.setNsuControle({
      ultNsu: '000000000000001',
      maxNsu: '000000000000050',
      dataSincronizacao: '2026-07-15T20:00:00.000Z'
    });

    const resultado = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.cStat, '656');
    assert.match(resultado.mensagem, /1 hora/i);
    await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(cenario.consultas, 1);
  });

  await test('timeout na manifestação não dispara DistDFe', async () => {
    const cenario = criarCenario({ erroManifestacao: 'timeout' });
    const resultado = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(resultado.sucesso, false);
    assert.match(resultado.mensagem, /timeout/i);
    assert.strictEqual(cenario.consultas, 0);
    assert.ok(cenario.eventos.some((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_REJEITADA));

    const bloqueado = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(bloqueado.sucesso, false);
    assert.match(bloqueado.mensagem, /1 hora/i);
    assert.strictEqual(cenario.manifestacoes, 1);
  });

  await test('fallback do runtime é rejeitado pela Central (RC3.3.3)', async () => {
    const cenario = criarCenario({ fallback: true });
    const resultado = await cenario.service.processarDocumento(1, { confirmado: true });
    assert.strictEqual(resultado.sucesso, false);
    assert.match(resultado.mensagem, /fallback legado/i);
    assert.ok(!cenario.eventos.some((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA));
    assert.ok(cenario.eventos.some((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_REJEITADA));
    assert.strictEqual(cenario.consultas, 0);
  });

  await test('políticas MANUAL e CONFIRMAR não executam ciclo automático', async () => {
    const manual = criarCenario({ politica: POLITICAS_MANIFESTACAO.MANUAL });
    const rManual = await manual.service.processarCandidatos();
    assert.strictEqual(rManual.executado, false);
    assert.strictEqual(manual.manifestacoes, 0);

    const confirmar = criarCenario({ politica: POLITICAS_MANIFESTACAO.CONFIRMAR_OPERADOR });
    const rConfirmar = await confirmar.service.processarCandidatos();
    assert.strictEqual(rConfirmar.executado, false);
    const semConfirmacao = await confirmar.service.processarDocumento(1);
    assert.strictEqual(semConfirmacao.requerConfirmacao, true);
    assert.strictEqual(confirmar.manifestacoes, 0);
  });

  await test('cooldown persistido bloqueia distNSU quando ultNSU = maxNSU', async () => {
    let chamadasSefaz = 0;
    const sync = new CentralSyncExecucaoService({
      sincronizacaoService: {
        sincronizar: async () => {
          chamadasSefaz += 1;
          return { sucesso: true };
        }
      },
      configuracaoService: {
        obterContextoOperacional: async () => ({
          ok: true,
          contexto: { cnpj: '12345678000199', ambiente: 2 }
        }),
        obterResumo: async () => ({ syncMaxDocumentos: 10 }),
        verificarHorarioPermitido: async () => ({ permitido: true })
      },
      nsuRepository: {
        buscarPorCnpjAmbiente: async () => ({
          ultNsu: '000000000000100',
          maxNsu: '000000000000100',
          dataSincronizacao: new Date().toISOString()
        })
      },
      notificacoesService: {
        notificarSyncConcluida: async () => null
      },
      emitirEvento: async () => null
    });
    const resultado = await sync.executar();
    assert.strictEqual(resultado.codigo, 'AGUARDAR_JANELA_DFE');
    assert.strictEqual(resultado.ignorado, true);
    assert.strictEqual(chamadasSefaz, 0);
  });

  console.log(`\nResultado RC3.3: ${passou} passou; ${falhou} falhou.\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
