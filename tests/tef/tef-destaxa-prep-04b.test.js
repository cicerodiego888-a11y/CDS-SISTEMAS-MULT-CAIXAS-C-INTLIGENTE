/**
 * TEF-DESTAXA-PREP-04B — preparação até conexão do PPC930.
 * Zero chamadas transacionais.
 */
'use strict';

const assert = require('assert');
const { criarAdapter } = require('../../backend/services/tef/tefFactory');
const tefConfigService = require('../../backend/services/tef/tefConfigService');
const {
  montarDiagnosticoPinpad,
  montarEstadoPreparacaoDestaxa
} = require('../../backend/services/tef/tefDiagnosticoService');
const {
  ESTADOS,
  ESTADOS_PREPARACAO
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');

let passou = 0;
let falhou = 0;

async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

async function main() {
  console.log('\nTEF-DESTAXA-PREP-04B — preparação sem transação\n');

  await test('Factory usa DestaxaRealAdapter em homologação', () => {
    const adapter = criarAdapter({ provedor: 'destaxa', ambiente: 'homologacao' });
    assert.ok(adapter instanceof DestaxaRealAdapter);
  });

  await test('perfil de preparação usa somente resolver oficial e valores seguros', () => {
    const config = tefConfigService.criarConfiguracaoPreparacaoDestaxa({});
    assert.strictEqual(config.tefProvedor, 'destaxa');
    assert.strictEqual(config.tefAmbiente, 'homologacao');
    assert.strictEqual(config.tipoIntegracao, 'dll');
    assert.strictEqual(config.tefTentativas, 1);
    assert.strictEqual(config.sdkPath, '');
    assert.strictEqual(config.exePath, '');
    assert.strictEqual(config.pinpadHabilitado, false);
    assert.strictEqual(config.pinpadModelo, 'GERTEC_PPC930');
    assert.strictEqual(config.portaCom, '');
    assert.strictEqual(config.serial, '');
  });

  await test('configuração Destaxa é válida sem estabelecimento/loja/terminal', () => {
    const config = tefConfigService.criarConfiguracaoPreparacaoDestaxa({});
    const resultado = tefConfigService.validarConfiguracao(config);
    assert.strictEqual(resultado.valida, true, resultado.pendencias.join('; '));
    assert.strictEqual(resultado.modoAdapter, 'real');
  });

  const deteccaoAusente = {
    _comPortaConfig: true,
    detectado: false,
    estado: 'NAO_DETECTADO',
    porta: null,
    portaDetectada: false,
    dispositivoConfirmado: false,
    fonteDeteccao: null,
    driver: null,
    usb: null,
    driverStatus: 'nao_confirmado',
    usbStatus: 'nao_confirmado',
    dispositivo: null
  };

  const configPreparacao = tefConfigService.criarConfiguracaoPreparacaoDestaxa({});
  const pinpad = montarDiagnosticoPinpad(
    configPreparacao,
    { pinpad: { habilitado: false, configurado: false } },
    { gertecPPC930: deteccaoAusente },
    'destaxa',
    true,
    'real'
  );

  await test('PPC930 pré-configurado fica AGUARDANDO_CONEXAO sem COM inventada', () => {
    assert.strictEqual(pinpad.preConfigurado, true);
    assert.strictEqual(pinpad.habilitado, false);
    assert.strictEqual(pinpad.codigo, 'GERTEC_PPC930');
    assert.strictEqual(pinpad.portaCom, null);
    assert.strictEqual(pinpad.estado, ESTADOS_PREPARACAO.PINPAD_NOT_DETECTED);
    assert.strictEqual(pinpad.status, 'AGUARDANDO_CONEXAO');
    assert.strictEqual(pinpad.interfaceEsperada, 'USB_CDC_SERIAL');
    assert.match(pinpad.observacao, /COM nunca deve ser presumida/);
  });

  await test('diagnóstico separa DLL, Client, PinPad e bloqueio transacional', () => {
    const preparo = montarEstadoPreparacaoDestaxa({
      adapterDiag: {
        detalhes: {
          dllExists: true,
          dllLoaded: true,
          dllPath: 'resolver-oficial/libdll-integracao-tef.dll',
          dllArch: 'x64'
        }
      },
      adapterTeste: {
        detalhes: {
          clientInitialized: true,
          estado: ESTADOS.CLIENT_INITIALIZED,
          clientResultCode: '00'
        }
      },
      middlewareDestaxa: { dllEncontrada: true },
      vspague: {
        detectado: true,
        executando: true,
        pid: 123,
        responding: true
      },
      pinpad
    });

    assert.strictEqual(preparo.dll.estado, ESTADOS.DLL_LOADED);
    assert.strictEqual(preparo.client.estado, ESTADOS.CLIENT_INITIALIZED);
    assert.strictEqual(preparo.client.codigo, '00');
    assert.strictEqual(preparo.pinpad.estado, ESTADOS_PREPARACAO.PINPAD_NOT_DETECTED);
    assert.strictEqual(preparo.transacao.estado, ESTADOS_PREPARACAO.TRANSACTION_BLOCKED);
    assert.strictEqual(preparo.readyForTransaction, false);
    assert.match(preparo.mensagem, /preparado até o ponto de conexão/);
  });

  await test('autorizarPagamento continua bloqueado sem chamar DLL transacional', async () => {
    let chamadaTransacional = false;
    const bridge = {
      iniciarTransacaoDestaxa() {
        chamadaTransacional = true;
        throw new Error('não deveria chamar transação');
      }
    };
    const adapter = new DestaxaRealAdapter({}, { bridge });
    const resposta = await adapter.autorizarPagamento();
    assert.strictEqual(resposta.sucesso, false);
    assert.strictEqual(resposta.codigo, 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA');
    assert.strictEqual(chamadaTransacional, false);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
