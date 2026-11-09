'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
delete process.env.DESTAXA_NATIVE_HOST_ENTRY;
delete process.env.TEF_ENCRYPTION_KEY;

const diretorioTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt-50-21-'));
const caminhoBanco = path.resolve(__dirname, '../../backend/database.js');
const caminhoTefManager = path.resolve(__dirname, '../../backend/services/tef/TefManager.js');
const bancoFalso = {
  escritas: 0,
  ultimaLinha: null,
  whenReady(callback) {
    callback(null);
  },
  run(sql, params, callback) {
    this.escritas += 1;
    if (sql.includes('INSERT INTO tef_transacoes')) {
      this.ultimaLinha = {
        id: this.escritas,
        status: 'pendente',
        payload_retorno: params[14]
      };
    }
    if (typeof callback === 'function') {
      callback.call({ lastID: this.escritas, changes: 1 }, null);
    }
  },
  get(sql, params, callback) {
    callback(null, this.ultimaLinha);
  },
  all(sql, params, callback) {
    callback(null, []);
  }
};

const managerFalso = {
  async garantirRecuperacao() {},
  obterTravaResultadoTardio() {
    return null;
  },
  listarTravasPendencias() {
    return [];
  }
};
const carregarModuloOriginal = Module._load;
Module._load = function carregarModulo(request, parent, isMain) {
  let resolvido;
  try {
    resolvido = Module._resolveFilename(request, parent, isMain);
  } catch (_) {
    resolvido = null;
  }
  if (resolvido === caminhoBanco) return bancoFalso;
  if (resolvido === caminhoTefManager) return { tefManager: managerFalso };
  return carregarModuloOriginal.call(this, request, parent, isMain);
};

const cryptoService = require('../../backend/services/crypto/cryptoService');
const repository = require('../../backend/services/tef/tefRepository');
const pendencias = require('../../backend/services/tef/tefPendenciasService');
const adapterCiclo = require('../../backend/services/tef/tefAdapterCiclo');
const continuidade = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
const hydrator = require('../../backend/services/fiscal/tefPagamentoHydrator');
const cardTokenization = require('../../backend/services/crypto/cardTokenizationService');
const TefBackupService = require('../../backend/services/tef/tefBackupService');
const { criarAmbienteNativeHost } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');

Module._load = carregarModuloOriginal;

const resultados = [];

async function caso(nome, executar) {
  try {
    await executar();
    resultados.push({ nome, status: 'PASSOU' });
  } catch (error) {
    resultados.push({ nome, status: 'FALHOU', erro: error.stack || error.message });
  }
}

function erroDeChave(code) {
  return (error) => error && error.code === code;
}

function criarTransacao(repositoryService, payload) {
  return new Promise((resolve, reject) => {
    repositoryService.criarTransacao({
      tipo: 'credito',
      valor: 1,
      payload_retorno: payload
    }, (error, id) => (error ? reject(error) : resolve(id)));
  });
}

function obterTransacao(repositoryService, id) {
  return new Promise((resolve, reject) => {
    repositoryService.obterTransacaoPorId(id, (error, row) => (
      error ? reject(error) : resolve(row)
    ));
  });
}

async function executar() {
  try {
    await caso('Ausência de chave bloqueia criptografia e descriptografia', () => {
      assert.strictEqual(cryptoService.secretKey, undefined);
      assert.throws(
        () => cryptoService.criptografar('payload'),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
      assert.throws(
        () => cryptoService.descriptografar('00'.repeat(16) + ':' + '00'.repeat(16)),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
    });

    await caso('Chave inválida é recusada sem divulgar seu conteúdo', () => {
      const chaveInvalida = 'z'.repeat(64);
      process.env.TEF_ENCRYPTION_KEY = chaveInvalida;
      assert.throws(
        () => cryptoService.criptografar('payload'),
        (error) => error.code === 'TEF_CRYPTO_KEY_INVALID'
          && !error.message.includes(chaveInvalida)
      );
    });

    await caso('Chave fixa de desenvolvimento é inelegível para criptografia', () => {
      const chaveDesenvolvimento = '0123456789abcdef'.repeat(4);
      process.env.TEF_ENCRYPTION_KEY = chaveDesenvolvimento;
      assert.throws(
        () => cryptoService.criptografar('payload'),
        erroDeChave('TEF_CRYPTO_KEY_INVALID')
      );
      assert.throws(
        () => cryptoService.descriptografar('00'.repeat(16) + ':' + '00'.repeat(16)),
        erroDeChave('TEF_CRYPTO_KEY_INVALID')
      );
    });

    const chaveEfemera = crypto.randomBytes(32).toString('hex');
    process.env.TEF_ENCRYPTION_KEY = chaveEfemera;
    const payload = {
      idempotency_key: 'mrt50.21-isolated',
      status: 'CONFIRMED_SUCCESS'
    };

    await caso('Chave efêmera mantém o formato AES e permite round-trip', () => {
      const cifrado = cryptoService.criptografarObjeto(payload);
      assert.match(cifrado, /^[0-9a-f]{32}:(?:[0-9a-f]{2})+$/i);
      assert.deepStrictEqual(cryptoService.descriptografarObjeto(cifrado), payload);
    });

    await caso('Persistência e reinicialização recuperam payload com a mesma chave', async () => {
      const id = await criarTransacao(repository, payload);
      const linha = await obterTransacao(repository, id);
      const caminhoPayload = path.join(diretorioTemporario, 'payload.enc');
      const payloadCriptografado = linha.payload_retorno_criptografado;
      fs.writeFileSync(caminhoPayload, payloadCriptografado, 'utf8');

      assert.strictEqual(payloadCriptografado.includes(chaveEfemera), false);
      assert.strictEqual(payloadCriptografado.includes(JSON.stringify(payload)), false);

      const caminhoCryptoService = require.resolve('../../backend/services/crypto/cryptoService');
      delete require.cache[caminhoCryptoService];
      const servicoReiniciado = require('../../backend/services/crypto/cryptoService');
      const restaurado = servicoReiniciado.descriptografarObjeto(
        fs.readFileSync(caminhoPayload, 'utf8')
      );
      assert.deepStrictEqual(restaurado, payload);
    });

    const cifrado = cryptoService.criptografarObjeto(payload);
    delete process.env.TEF_ENCRYPTION_KEY;

    await caso('Repositório não persiste escrita quando a chave está ausente', async () => {
      const escritasAntes = bancoFalso.escritas;
      await assert.rejects(
        criarTransacao(repository, payload),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
      await assert.rejects(
        obterTransacao(repository, bancoFalso.ultimaLinha.id),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
      await new Promise((resolve, reject) => {
        repository.atualizarTransacao(
          bancoFalso.ultimaLinha.id,
          { payload_retorno: payload },
          (error) => (error ? resolve(error) : reject(new Error('Atualização deveria falhar.')))
        );
      }).then((error) => assert.strictEqual(error.code, 'TEF_CRYPTO_KEY_UNAVAILABLE'));
      assert.strictEqual(bancoFalso.escritas, escritasAntes);
    });

    await caso('Listagem de pendências propaga indisponibilidade da chave', async () => {
      await assert.rejects(
        pendencias.listarPendenciasOperacionais({
          tefManager: managerFalso,
          db: bancoFalso,
          linhasPendentes: [{
            id: 'mrt50.21-isolated',
            status: 'pendente',
            payload_retorno: cifrado
          }]
        }),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
    });

    await caso('Recuperação incompleta impede listagem de pendências', async () => {
      await assert.rejects(
        pendencias.listarPendenciasOperacionais({
          db: bancoFalso,
          tefManager: {
            async garantirRecuperacao() {
              const error = new Error('Recuperação incompleta.');
              error.code = 'TEF_RECOVERY_INCOMPLETE';
              throw error;
            }
          },
          linhasPendentes: []
        }),
        (error) => error.code === 'TEF_RECOVERY_INCOMPLETE'
      );
    });

    await caso('Hidratação do ciclo falha fechada sem chave', () => {
      assert.throws(
        () => adapterCiclo.hidratarTransacaoParaCiclo({ payload_retorno: cifrado }),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
    });

    await caso('Continuidade não converte falha de descriptografia em objeto vazio', async () => {
      const conexaoFalsa = {
        get(sql, params, callback) {
          callback(null, {
            id: 21,
            status: 'pendente',
            payload_retorno: cifrado
          });
        }
      };
      await assert.rejects(
        continuidade.buscarTransacao(21, conexaoFalsa),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
    });

    await caso('Hidratação fiscal não segue com payload TEF ilegível', () => {
      assert.throws(
        () => hydrator.hidratarMetadadosPagamentoTef([{
          tef_transacao_id: 21,
          tef_payload_retorno: cifrado
        }]),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
    });

    await caso('Tokenização não grava dados quando a chave está ausente', async () => {
      const escritasAntes = bancoFalso.escritas;
      await assert.rejects(
        cardTokenization.tokenizar({
          numero: '4111111111111111',
          validade: '12/30'
        }),
        erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
      );
      assert.strictEqual(cardTokenization.tokenStore.size, 0);
      assert.strictEqual(bancoFalso.escritas, escritasAntes);

      const getOriginal = bancoFalso.get;
      bancoFalso.get = (sql, params, callback) => callback(null, {
        dados_criptografados: JSON.stringify({
          numero: cifrado,
          validade: cifrado,
          bandeira: 'VISA',
          nome_portador: null
        })
      });
      try {
        await assert.rejects(
          cardTokenization.detokenizar('mrt50.21-token'),
          erroDeChave('TEF_CRYPTO_KEY_UNAVAILABLE')
        );
      } finally {
        bancoFalso.get = getOriginal;
      }
    });

    await caso('Backup reporta falha sem gravar arquivo quando a chave falta', async () => {
      const backup = TefBackupService;
      backup.backupDir = path.join(diretorioTemporario, 'backups');
      backup._obterDadosBackup = async () => ({ transacoes: [], logs: [] });
      const erroOriginal = console.error;
      const registrosErro = [];
      console.error = (...args) => registrosErro.push(args.join(' '));
      let resultado;
      try {
        resultado = await backup.executarBackup();
      } finally {
        console.error = erroOriginal;
      }
      assert.strictEqual(resultado.sucesso, false);
      assert.strictEqual(registrosErro.join('\n').includes(chaveEfemera), false);
      assert.strictEqual(fs.existsSync(backup.backupDir)
        ? fs.readdirSync(backup.backupDir).length
        : 0, 0);

      const caminhoBackupExistente = path.join(diretorioTemporario, 'backup-existing.enc');
      fs.writeFileSync(caminhoBackupExistente, cifrado, 'utf8');
      const registrosErroRestauracao = [];
      console.error = (...args) => registrosErroRestauracao.push(args.join(' '));
      let resultadoRestauracao;
      try {
        resultadoRestauracao = await backup.restaurarBackup(caminhoBackupExistente);
      } finally {
        console.error = erroOriginal;
      }
      assert.strictEqual(resultadoRestauracao.sucesso, false);
      assert.strictEqual(registrosErroRestauracao.join('\n').includes(chaveEfemera), false);
    });

    await caso('Chave privada não é encaminhada ao ambiente do NativeHost', () => {
      const envHost = criarAmbienteNativeHost(
        {
          NODE_ENV: 'test',
          TEF_ENCRYPTION_KEY: chaveEfemera,
          DESTAXA_REAL_TRANSACTION_ENABLED: '0'
        },
        {},
        'public-test-key'
      );
      assert.strictEqual(envHost.TEF_ENCRYPTION_KEY, undefined);
      assert.strictEqual(envHost.DESTAXA_REAL_TRANSACTION_ENABLED, '0');
    });

    const falhas = resultados.filter((resultado) => resultado.status !== 'PASSOU');
    console.log(JSON.stringify({
      resultados,
      total: resultados.length,
      falhas: falhas.length
    }, null, 2));
    if (falhas.length) process.exitCode = 1;
  } finally {
    fs.rmSync(diretorioTemporario, { recursive: true, force: true });
  }
}

executar().catch((error) => {
  console.error('Falha no harness MRT-50.21.');
  process.exitCode = 1;
});
