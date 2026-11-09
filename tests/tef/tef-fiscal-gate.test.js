'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tefFiscalContextService = require('../../backend/services/tef/tefFiscalContextService');

const tefManagerPath = require.resolve('../../backend/services/tef/TefManager');
const tefConfigServicePath = require.resolve('../../backend/services/tef/tefConfigService');
const tefManagerMock = { autorizar: async () => ({ sucesso: false }) };
const tefConfigServiceMock = { obterConfiguracao: async () => ({ tefHabilitado: true }) };
require.cache[tefManagerPath] = {
  id: tefManagerPath,
  filename: tefManagerPath,
  loaded: true,
  exports: tefManagerMock
};
require.cache[tefConfigServicePath] = {
  id: tefConfigServicePath,
  filename: tefConfigServicePath,
  loaded: true,
  exports: tefConfigServiceMock
};

const OrquestradorPagamento = require('../../backend/services/OrquestradorPagamento');
const TefManager = require('../../backend/services/tef/TefManager');
const tefConfigService = require('../../backend/services/tef/tefConfigService');

function bancoVendaFiscal({ valorFiscal = 40, recebido = 0, tefExistente = 0 } = {}) {
  return {
    get(sql, params, callback) {
      if (sql.includes('FROM vendas')) {
        callback(null, { id: Number(params[0]), valor_fiscal: valorFiscal });
        return;
      }
      if (sql.includes('WHERE idempotency_key = ?')) {
        callback(null, null);
        return;
      }
      if (sql.includes('FROM venda_recebimentos')) {
        callback(null, { total: recebido });
        return;
      }
      if (sql.includes('FROM tef_transacoes')) {
        callback(null, { total: tefExistente });
        return;
      }
      callback(new Error(`Consulta inesperada no teste: ${sql}`));
    }
  };
}

async function comTEFMockado(callback) {
  const autorizarOriginal = TefManager.autorizar;
  const obterConfiguracaoOriginal = tefConfigService.obterConfiguracao;
  const chamadas = [];

  TefManager.autorizar = async (dados) => {
    chamadas.push(dados);
    return {
      sucesso: true,
      status: 'aprovado',
      transacao_id: `teste-${chamadas.length}`
    };
  };
  tefConfigService.obterConfiguracao = async () => ({ tefHabilitado: true });

  try {
    await callback(chamadas);
  } finally {
    TefManager.autorizar = autorizarOriginal;
    tefConfigService.obterConfiguracao = obterConfiguracaoOriginal;
  }
}

async function test(name, callback) {
  await callback();
  console.log(`OK ${name}`);
}

async function main() {
  await test('venda fiscal autoriza TEF no backend, inclusive com confirmação manual configurada', async () => {
    await comTEFMockado(async (chamadas) => {
      const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
        totalFiscal: 50,
        totalNaoFiscal: 0,
        formaPagamento: 'cartao_credito',
        pagamentos: [{ forma_pagamento: 'cartao_credito', valor: 50 }],
        tefHabilitado: true,
        modoConfirmacaoFiscal: 'MANUAL'
      });

      assert.equal(resultado.sucesso, true);
      assert.equal(chamadas.length, 1);
      assert.equal(chamadas[0].valor, 50);
      assert.equal(
        tefFiscalContextService.validarContextoFiscal(chamadas[0].contextoFiscal, chamadas[0]),
        true
      );
    });
  });

  await test('venda não fiscal não inicia TEF', async () => {
    await comTEFMockado(async (chamadas) => {
      const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
        totalFiscal: 0,
        totalNaoFiscal: 50,
        formaPagamento: 'cartao_credito',
        pagamentos: [{ forma_pagamento: 'cartao_credito', valor: 50 }],
        tefHabilitado: true,
        modoConfirmacaoFiscal: 'TEF'
      });

      assert.equal(resultado.sucesso, true);
      assert.equal(chamadas.length, 0);
    });
  });

  await test('venda mista limita TEF à parcela fiscal calculada pelo backend', async () => {
    await comTEFMockado(async (chamadas) => {
      const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
        totalFiscal: 30,
        totalNaoFiscal: 70,
        formaPagamento: 'misto',
        pagamentos: [{ forma_pagamento: 'cartao_credito', valor: 100 }],
        tefHabilitado: true,
        modoConfirmacaoFiscal: 'TEF'
      });

      assert.equal(resultado.sucesso, true);
      assert.equal(chamadas.length, 1);
      assert.equal(chamadas[0].valor, 30);
      assert.ok(chamadas[0].valor <= 30);
    });
  });

  await test('venda mista com total fiscal zero não inicia TEF', async () => {
    await comTEFMockado(async (chamadas) => {
      const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
        totalFiscal: 0,
        totalNaoFiscal: 100,
        formaPagamento: 'misto',
        pagamentos: [{ forma_pagamento: 'cartao_credito', valor: 100 }],
        tefHabilitado: true,
        modoConfirmacaoFiscal: 'TEF'
      });

      assert.equal(resultado.sucesso, true);
      assert.equal(chamadas.length, 0);
    });
  });

  await test('ID TEF enviado pelo cliente não substitui autorização fiscal do backend', async () => {
    await comTEFMockado(async (chamadas) => {
      const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
        totalFiscal: 50,
        totalNaoFiscal: 0,
        formaPagamento: 'cartao_credito',
        pagamentos: [{
          forma_pagamento: 'cartao_credito',
          valor: 50,
          tef_transacao_id: 123
        }],
        tefHabilitado: true,
        modoConfirmacaoFiscal: 'TEF'
      });

      assert.equal(resultado.sucesso, false);
      assert.equal(chamadas.length, 0);
    });
  });

  await test('rota direta sem venda persistida bloqueia modoFiscal e totalFiscal enviados pelo cliente', async () => {
    let chamadasAutorizacao = 0;
    const resultado = await tefFiscalContextService.autorizarPagamentoFiscal({
      vendaId: null,
      valor: 40,
      tipo: 'cartao_credito',
      modoFiscal: true,
      totalFiscal: 40,
      db: bancoVendaFiscal(),
      autorizar: async () => {
        chamadasAutorizacao += 1;
      }
    });

    assert.equal(resultado.ok, false);
    assert.equal(resultado.codigo, 'TEF_CONTEXTO_FISCAL_AUSENTE');
    assert.equal(chamadasAutorizacao, 0);
  });

  await test('rota direta autoriza quando venda persistida tem saldo fiscal suficiente', async () => {
    let chamadasAutorizacao = 0;
    const resultado = await tefFiscalContextService.autorizarPagamentoFiscal({
      vendaId: 7,
      valor: 40,
      tipo: 'cartao_credito',
      idempotencyKey: 'fiscal-7-1',
      db: bancoVendaFiscal({ valorFiscal: 40 }),
      autorizar: async (contextoFiscal) => {
        chamadasAutorizacao += 1;
        assert.equal(
          tefFiscalContextService.validarContextoFiscal(contextoFiscal, {
            valor: 40,
            tipo: 'cartao_credito'
          }),
          true
        );
        return { sucesso: true };
      }
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.resultado.sucesso, true);
    assert.equal(chamadasAutorizacao, 1);
  });

  await test('rota direta rejeita valor acima do saldo fiscal após recebimentos existentes', async () => {
    let chamadasAutorizacao = 0;
    const resultado = await tefFiscalContextService.autorizarPagamentoFiscal({
      vendaId: 8,
      valor: 31,
      tipo: 'cartao_credito',
      db: bancoVendaFiscal({ valorFiscal: 50, recebido: 15, tefExistente: 5 }),
      autorizar: async () => {
        chamadasAutorizacao += 1;
      }
    });

    assert.equal(resultado.ok, false);
    assert.equal(resultado.codigo, 'TEF_VALOR_EXCEDE_SALDO_FISCAL');
    assert.equal(chamadasAutorizacao, 0);
  });

  await test('TefManager bloqueia chamada sem contexto antes de iniciar roteamento TEF', async () => {
    const contextoFalsificado = { valorCentavos: 100, tipo: 'cartao_credito' };
    assert.equal(
      tefFiscalContextService.validarContextoFiscal(contextoFalsificado, {
        tipo: 'cartao_credito',
        valor: 1
      }),
      false
    );

    const managerSource = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/tef/TefManager.js'),
      'utf8'
    );
    const gateOffset = managerSource.indexOf('tefFiscalContextService.validarContextoFiscal(');
    const routeOffset = managerSource.indexOf('tefRouterIntegration.resolverRotaAutorizacao(');
    assert.ok(gateOffset >= 0);
    assert.ok(routeOffset > gateOffset);
  });

  await test('PDV delega autorização à venda backend e não chama a rota pré-venda', async () => {
    const pdvSource = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/pdv/js/pdv.js'),
      'utf8'
    );
    assert.doesNotMatch(
      pdvSource,
      /dados\.pagamentos = await processarPagamentosMistosTEF\(pagamentosMistos\)/
    );
    assert.doesNotMatch(
      pdvSource,
      /await processarVendaFiscalNaoFiscal\(dados,\s*fluxoAB\.valorA\)/
    );
    assert.match(pdvSource, /dados\.pagamentos = normalizarPagamentosSemTef\(pagamentosMistos\)/);
  });

  await test('venda rejeita metadados TEF e IDs de transação fornecidos pelo cliente', async () => {
    const vendaSource = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.match(vendaSource, /TEF_CONTEXT_CLIENTE_NAO_CONFIAVEL/);
    assert.doesNotMatch(vendaSource, /const idTef = p\.tef_transacao_id/);

    const routeSource = fs.readFileSync(
      path.resolve(__dirname, '../../backend/rotas/tef.js'),
      'utf8'
    );
    assert.match(routeSource, /tefFiscalContextService\.autorizarPagamentoFiscal/);
  });

  console.log('\nTodos os testes do gate fiscal TEF passaram.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
