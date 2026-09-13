/**
 * RC3.3.3 — Hardening: NSU, mutex, idempotência, fallback, E2E e recuperação.
 */

const assert = require('assert');
const CentralNsuService = require(
  '../../backend/motores/central-entradas/services/CentralNsuService'
);
const { CentralSyncExecucaoService } = require(
  '../../backend/motores/central-entradas/services/CentralSyncExecucaoService'
);
const CentralManifestacaoDfeService = require(
  '../../backend/motores/central-entradas/services/CentralManifestacaoDfeService'
);
const { DocumentoFiscalStatus } = require(
  '../../backend/motores/central-entradas/core/DocumentoFiscalStatus'
);
const { DocumentoDfeTipo } = require(
  '../../backend/motores/central-entradas/core/DocumentoDfeTipo'
);
const { TIPOS_EVENTO } = require(
  '../../backend/motores/central-entradas/config/centralEventosTipos'
);
const { TRANSICOES_PERMITIDAS, validarTransicao } = require(
  '../../backend/motores/central-entradas/core/MaquinaEstadosDocumento'
);
const { ETAPAS_CICLO_DFE } = require(
  '../../backend/motores/central-entradas/core/CicloDfeEstadosMap'
);

let passou = 0;
let falhou = 0;
const metricas = [];

function test(nome, fn) {
  const inicio = Date.now();
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      metricas.push({ nome, ms: Date.now() - inicio, ok: true });
      console.log(`  OK  ${nome} (${Date.now() - inicio}ms)`);
    })
    .catch((error) => {
      falhou += 1;
      metricas.push({ nome, ms: Date.now() - inicio, ok: false });
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.stack || error.message}`);
    });
}

function criarNsuRepoMemoria(inicial = {}) {
  let row = {
    id: 1,
    cnpj: '12345678000199',
    ambiente: 2,
    ultNsu: inicial.ultNsu || '000000000000010',
    maxNsu: inicial.maxNsu || '000000000000010',
    dataSincronizacao: inicial.dataSincronizacao || null,
    cooldownAte: null,
    ultimoCstat: null,
    updatedAt: new Date().toISOString()
  };

  return {
    obterOuCriar: async () => ({ ...row }),
    buscarPorCnpjAmbiente: async () => ({ ...row }),
    buscarPorId: async () => ({ ...row }),
    atualizarSincronizacaoSegura: async (id, dados) => {
      if (dados.preservarNsu) {
        row = {
          ...row,
          dataSincronizacao: dados.dataSincronizacao || row.dataSincronizacao,
          cooldownAte: dados.cooldownAte !== undefined ? dados.cooldownAte : row.cooldownAte,
          ultimoCstat: dados.ultimoCstat !== undefined ? dados.ultimoCstat : row.ultimoCstat
        };
        return { ...row };
      }
      const atual = row.ultNsu;
      if (String(dados.ultNsu) >= String(atual)) {
        row = {
          ...row,
          ultNsu: dados.ultNsu,
          maxNsu: dados.maxNsu,
          dataSincronizacao: dados.dataSincronizacao,
          cooldownAte: dados.cooldownAte !== undefined ? dados.cooldownAte : null,
          ultimoCstat: dados.ultimoCstat || row.ultimoCstat
        };
      } else {
        row = {
          ...row,
          dataSincronizacao: dados.dataSincronizacao || row.dataSincronizacao,
          ultimoCstat: dados.ultimoCstat || row.ultimoCstat
        };
      }
      return { ...row };
    },
    _peek: () => ({ ...row })
  };
}

async function main() {
  console.log('\n=== RC3.3.3 — Hardening Central ===\n');

  await test('NSU nunca regrede e 656 preserva checkpoint', async () => {
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000050',
      maxNsu: '000000000000050'
    });
    const service = new CentralNsuService({ nsuRepository: repo });
    const controle = await service.obterOuCriar('12345678000199', 2);

    const regressao = await service.aplicarRetornoDistDfe({
      controle,
      cStat: '138',
      xmlRetorno: '<retDistDFeInt><cStat>138</cStat><ultNSU>000000000000010</ultNSU><maxNSU>000000000000010</maxNSU></retDistDFeInt>',
      ultNsu: '000000000000010',
      maxNsu: '000000000000010'
    });
    assert.strictEqual(regressao.preservado, true);
    assert.strictEqual(regressao.ultNsu, '000000000000050');

    const consumo = await service.aplicarRetornoDistDfe({
      controle: regressao.controle,
      cStat: '656',
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo></retDistDFeInt>'
    });
    assert.strictEqual(consumo.preservado, true);
    assert.strictEqual(consumo.ultNsu, '000000000000050');
    assert.strictEqual(consumo.cooldownAtivo, true);
    assert.ok(consumo.proximaConsultaEm);
    assert.strictEqual(repo._peek().ultNsu, '000000000000050');
  });

  await test('mutex único: sync concorrente resulta em uma execução efetiva', async () => {
    let emCurso = 0;
    let maxParalelo = 0;
    let efetivas = 0;

    const sync = new CentralSyncExecucaoService({
      sincronizacaoService: {
        sincronizar: async () => {
          efetivas += 1;
          emCurso += 1;
          maxParalelo = Math.max(maxParalelo, emCurso);
          await new Promise((r) => setTimeout(r, 40));
          emCurso -= 1;
          return { sucesso: true, cStat: '137', ultNsu: '1', maxNsu: '1', mensagem: 'ok' };
        }
      },
      configuracaoService: {
        obterContextoOperacional: async () => ({ ok: false }),
        obterResumo: async () => ({ syncMaxDocumentos: 5 }),
        verificarHorarioPermitido: async () => ({ permitido: true })
      },
      nsuRepository: {
        buscarPorCnpjAmbiente: async () => null
      },
      notificacoesService: { notificarSyncConcluida: async () => null },
      emitirEvento: async () => null
    });

    const resultados = await Promise.all([
      sync.executar({ origem: 'manual', ignorarCooldown: true }),
      sync.executar({ origem: 'background', ignorarCooldown: true }),
      sync.comLockDistDfe('scheduler', async () => ({ sucesso: true, via: 'scheduler' }))
    ]);

    const ignorados = resultados.filter((r) => r.ignorado || r.codigo === 'SYNC_EM_ANDAMENTO');
    assert.strictEqual(efetivas, 1);
    assert.strictEqual(maxParalelo, 1);
    assert.ok(ignorados.length >= 2);
  });

  await test('idempotência: claim impede segunda Ciência da mesma chave', async () => {
    const eventos = [];
    const documento = {
      id: 9,
      chave: '35260112345678000199550010000000641000000064',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE
    };
    let envios = 0;
    const eventosRepository = {
      listar: async (f) => eventos
        .filter((e) => e.tipo === f.tipo && e.documentoId === f.documentoId)
        .sort((a, b) => b.id - a.id)
        .slice(0, f.limite || 50),
      inserir: async (dados) => {
        if (
          ['MANIFESTACAO_CLAIM', 'MANIFESTACAO_ACEITA'].includes(dados.tipo)
          && eventos.some((e) => e.tipo === dados.tipo && e.documentoId === dados.documentoId)
        ) {
          throw new Error('UNIQUE constraint failed');
        }
        const evento = { id: eventos.length + 1, ...dados, documentoId: dados.documentoId };
        eventos.push(evento);
        return evento;
      },
      inserirUnico: async (dados) => {
        try {
          const evento = await eventosRepository.inserir(dados);
          return { evento, criado: true, conflito: false };
        } catch {
          return { evento: null, criado: false, conflito: true };
        }
      },
      removerPorTipoDocumento: async (tipo, id) => {
        for (let i = eventos.length - 1; i >= 0; i -= 1) {
          if (eventos[i].tipo === tipo && eventos[i].documentoId === id) eventos.splice(i, 1);
        }
        return true;
      }
    };

    const service = new CentralManifestacaoDfeService({
      documentosRepository: {
        buscarPorId: async () => documento,
        listarPorStatus: async () => [documento]
      },
      historicoRepository: {
        inserir: async () => ({}),
        listarPorDocumento: async () => []
      },
      eventosRepository,
      nsuService: {
        buscarPorCnpjAmbiente: async () => ({ ultNsu: '1', maxNsu: '2' }),
        avaliarCooldown: () => ({ ativo: false })
      },
      configuracaoService: {
        obterPoliticaManifestacao: async () => 'AUTOMATICA_CIENCIA',
        obterContextoOperacional: async () => ({
          ok: true,
          contexto: {
            ambiente: 2,
            codigoUf: '35',
            cnpj: '12345678000199',
            certificadoPath: 'a',
            certificadoSenha: 'b'
          }
        })
      },
      prepararEnvelopeAssinado: () => '<e/>',
      enviarManifestacao: async () => {
        envios += 1;
        await new Promise((r) => setTimeout(r, 30));
        return {
          success: true,
          source: 'PLATFORM',
          fallbackUtilizado: false,
          tempoTotalMs: 10,
          body: '<retEvento><infEvento><cStat>135</cStat><xMotivo>ok</xMotivo><nProt>1</nProt><dhRegEvento>2026-07-15T20:00:00-03:00</dhRegEvento></infEvento></retEvento>'
        };
      },
      sincronizarDfe: async () => ({ sucesso: true, cStat: '137' }),
      emitirEvento: async (d) => eventosRepository.inserir(d)
    });

    const [a, b] = await Promise.all([
      service.processarDocumento(9, { confirmado: true, apenasManifestacao: true }),
      service.processarDocumento(9, { confirmado: true, apenasManifestacao: true })
    ]);

    assert.strictEqual(envios, 1);
    assert.ok(a.sucesso || b.sucesso);
    assert.ok(a.ignorado || b.ignorado || a.sucesso || b.sucesso);
    assert.strictEqual(
      eventos.filter((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA).length,
      1
    );
  });

  await test('máquina de estados: etapas do ciclo DF-e são válidas', () => {
    assert.strictEqual(
      ETAPAS_CICLO_DFE.RES_NFE.statusDocumento,
      DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
    );
    assert.strictEqual(
      validarTransicao(
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
        DocumentoFiscalStatus.SINCRONIZADA
      ).valido,
      true
    );
    assert.strictEqual(
      validarTransicao(
        DocumentoFiscalStatus.SINCRONIZADA,
        DocumentoFiscalStatus.EM_PROCESSAMENTO
      ).valido,
      true
    );
    assert.ok(TRANSICOES_PERMITIDAS[DocumentoFiscalStatus.EM_PROCESSAMENTO]
      .includes(DocumentoFiscalStatus.AGUARDANDO_REVISAO));
    assert.ok(TRANSICOES_PERMITIDAS[DocumentoFiscalStatus.EM_PROCESSAMENTO]
      .includes(DocumentoFiscalStatus.PRONTA_PARA_COMPRA));
  });

  await test('E2E simulado: RES_NFE → Ciência → cooldown → DistDFe → PROC → revisão', async () => {
    let agora = new Date('2026-07-15T10:00:00.000Z');
    const documento = {
      id: 3,
      chave: '35260112345678000199550010000000641000000064',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      xml: '<resNFe/>'
    };
    const eventos = [];
    const historico = [];
    let fase = 'ciencia';

    const eventosRepository = {
      listar: async (f) => eventos
        .filter((e) => e.tipo === f.tipo && e.documentoId === f.documentoId)
        .sort((a, b) => b.id - a.id)
        .slice(0, f.limite || 50),
      inserir: async (dados) => {
        if (
          ['MANIFESTACAO_CLAIM', 'MANIFESTACAO_ACEITA'].includes(dados.tipo)
          && eventos.some((e) => e.tipo === dados.tipo && e.documentoId === dados.documentoId)
        ) {
          throw new Error('UNIQUE constraint failed');
        }
        const evento = { id: eventos.length + 1, createdAt: agora.toISOString(), ...dados, documentoId: dados.documentoId };
        eventos.push(evento);
        return evento;
      },
      inserirUnico: async (dados) => {
        try {
          return { evento: await eventosRepository.inserir(dados), criado: true, conflito: false };
        } catch {
          return { evento: null, criado: false, conflito: true };
        }
      },
      removerPorTipoDocumento: async (tipo, id) => {
        for (let i = eventos.length - 1; i >= 0; i -= 1) {
          if (eventos[i].tipo === tipo && eventos[i].documentoId === id) eventos.splice(i, 1);
        }
        return true;
      }
    };

    const service = new CentralManifestacaoDfeService({
      documentosRepository: {
        buscarPorId: async () => documento,
        listarPorStatus: async () => [documento]
      },
      historicoRepository: {
        inserir: async (d) => { historico.push(d); return d; },
        listarPorDocumento: async () => [...historico]
      },
      eventosRepository,
      nsuService: {
        buscarPorCnpjAmbiente: async () => ({
          ultNsu: '000000000000001',
          maxNsu: '000000000000001',
          dataSincronizacao: '2026-07-15T08:00:00.000Z'
        }),
        avaliarCooldown: () => (fase === 'pos-ciencia-imediato'
          ? { ativo: true, proximaConsultaEm: new Date(agora.getTime() + 3600000).toISOString() }
          : { ativo: false })
      },
      configuracaoService: {
        obterPoliticaManifestacao: async () => 'AUTOMATICA_CIENCIA',
        obterContextoOperacional: async () => ({
          ok: true,
          contexto: {
            ambiente: 2, codigoUf: '35', cnpj: '12345678000199',
            certificadoPath: 'a', certificadoSenha: 'b'
          }
        })
      },
      prepararEnvelopeAssinado: () => '<e/>',
      enviarManifestacao: async () => ({
        success: true,
        source: 'PLATFORM',
        fallbackUtilizado: false,
        tempoTotalMs: 12,
        body: '<retEvento><infEvento><cStat>135</cStat><xMotivo>ok</xMotivo><nProt>1</nProt><dhRegEvento>2026-07-15T10:00:00-03:00</dhRegEvento></infEvento></retEvento>'
      }),
      sincronizarDfe: async () => {
        documento.status = DocumentoFiscalStatus.SINCRONIZADA;
        documento.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        documento.xml = '<nfeProc/>';
        return { sucesso: true, cStat: '138', ultNsu: '2', maxNsu: '2' };
      },
      emitirEvento: async (d) => eventosRepository.inserir(d),
      agora: () => agora
    });

    const ciencia = await service.processarDocumento(3, {
      confirmado: true,
      apenasManifestacao: true
    });
    assert.strictEqual(ciencia.aguardandoDisponibilizacao, true);
    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA));
    fase = 'pos-ciencia-imediato';

    const cedo = await service.processarDocumento(3, { confirmado: true });
    assert.strictEqual(cedo.aguardandoDisponibilizacao, true);

    fase = 'dist';
    agora = new Date(agora.getTime() + 60 * 60 * 1000 + 1);
    const completo = await service.processarDocumento(3, { confirmado: true });
    assert.strictEqual(completo.xmlCompleto, true);
    assert.strictEqual(documento.status, DocumentoFiscalStatus.SINCRONIZADA);

    // Simula Parser → MIIP → revisão
    documento.status = DocumentoFiscalStatus.EM_PROCESSAMENTO;
    assert.strictEqual(
      validarTransicao(DocumentoFiscalStatus.EM_PROCESSAMENTO, DocumentoFiscalStatus.AGUARDANDO_REVISAO).valido,
      true
    );
    documento.status = DocumentoFiscalStatus.AGUARDANDO_REVISAO;
  });

  await test('recuperação: queda após claim libera nova tentativa; após aceite não reenvia', async () => {
    const eventos = [];
    const documento = {
      id: 4,
      chave: '35260112345678000199550010000000641000000064',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE
    };
    let envios = 0;
    const eventosRepository = {
      listar: async (f) => eventos
        .filter((e) => e.tipo === f.tipo && e.documentoId === f.documentoId)
        .sort((a, b) => b.id - a.id)
        .slice(0, f.limite || 50),
      inserir: async (dados) => {
        if (
          ['MANIFESTACAO_CLAIM', 'MANIFESTACAO_ACEITA'].includes(dados.tipo)
          && eventos.some((e) => e.tipo === dados.tipo && e.documentoId === dados.documentoId)
        ) {
          throw new Error('UNIQUE constraint failed');
        }
        const evento = { id: eventos.length + 1, ...dados, documentoId: dados.documentoId };
        eventos.push(evento);
        return evento;
      },
      inserirUnico: async (dados) => {
        try {
          return { evento: await eventosRepository.inserir(dados), criado: true, conflito: false };
        } catch {
          return { evento: null, criado: false, conflito: true };
        }
      },
      removerPorTipoDocumento: async (tipo, id) => {
        for (let i = eventos.length - 1; i >= 0; i -= 1) {
          if (eventos[i].tipo === tipo && eventos[i].documentoId === id) eventos.splice(i, 1);
        }
        return true;
      }
    };

    const mkService = (falhar) => new CentralManifestacaoDfeService({
      documentosRepository: {
        buscarPorId: async () => documento,
        listarPorStatus: async () => [documento]
      },
      historicoRepository: {
        inserir: async () => ({}),
        listarPorDocumento: async () => []
      },
      eventosRepository,
      nsuService: {
        buscarPorCnpjAmbiente: async () => ({ ultNsu: '1', maxNsu: '2' }),
        avaliarCooldown: () => ({ ativo: false })
      },
      configuracaoService: {
        obterPoliticaManifestacao: async () => 'AUTOMATICA_CIENCIA',
        obterContextoOperacional: async () => ({
          ok: true,
          contexto: {
            ambiente: 2, codigoUf: '35', cnpj: '12345678000199',
            certificadoPath: 'a', certificadoSenha: 'b'
          }
        })
      },
      prepararEnvelopeAssinado: () => '<e/>',
      enviarManifestacao: async () => {
        envios += 1;
        if (falhar) throw new Error('queda simulada');
        return {
          success: true,
          source: 'PLATFORM',
          fallbackUtilizado: false,
          tempoTotalMs: 5,
          body: '<retEvento><infEvento><cStat>135</cStat><xMotivo>ok</xMotivo><nProt>1</nProt><dhRegEvento>2026-07-15T20:00:00-03:00</dhRegEvento></infEvento></retEvento>'
        };
      },
      sincronizarDfe: async () => ({ sucesso: true, cStat: '137' }),
      emitirEvento: async (d) => eventosRepository.inserir(d)
    });

    const falha = await mkService(true).processarDocumento(4, {
      confirmado: true,
      apenasManifestacao: true
    });
    assert.strictEqual(falha.sucesso, false);
    assert.ok(!eventos.some((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_CLAIM));

    // após rejeição recente, força consulta para simular reinício com forcar
    const ok = await mkService(false).processarDocumento(4, {
      confirmado: true,
      apenasManifestacao: true,
      forcarConsulta: true
    });
    assert.strictEqual(ok.sucesso, true);
    assert.strictEqual(envios, 2);

    const novamente = await mkService(false).processarDocumento(4, {
      confirmado: true,
      apenasManifestacao: true,
      forcarConsulta: true
    });
    assert.strictEqual(novamente.sucesso, true);
    assert.strictEqual(envios, 2);
  });

  const tempos = metricas.filter((m) => m.ok).map((m) => m.ms);
  const media = tempos.reduce((a, b) => a + b, 0) / (tempos.length || 1);
  const maximo = Math.max(...tempos, 0);

  console.log('\nPerformance (suite RC3.3.3):');
  console.log(`  tempo médio: ${media.toFixed(1)}ms`);
  console.log(`  tempo máximo: ${maximo}ms`);
  console.log(`\nResultado RC3.3.3: ${passou} passou; ${falhou} falhou.\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
