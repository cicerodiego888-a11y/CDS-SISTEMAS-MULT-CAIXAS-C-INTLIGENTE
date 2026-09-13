/**
 * RC3 — Controle inteligente de saldo de devoluções de compra.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS,
  statusDoSaldo,
  validarQuantidadesContraSaldo,
  round3
} = require('../../backend/services/fiscal/controleSaldoDevolucaoCompra');

function simularLedger(comprado) {
  const movimentos = []; // { qtd, status }
  return {
    emitir(qtd) {
      const devolvido = movimentos
        .filter((m) => m.status === 'autorizada')
        .reduce((s, m) => s + m.qtd, 0);
      const saldo = round3(comprado - devolvido);
      if (qtd > saldo + 1e-9) {
        return { ok: false, saldo, erro: 'excede' };
      }
      movimentos.push({ qtd: round3(qtd), status: 'autorizada' });
      return {
        ok: true,
        saldoApos: round3(comprado - devolvido - qtd),
        devolvido: round3(devolvido + qtd)
      };
    },
    cancelarUltima() {
      for (let i = movimentos.length - 1; i >= 0; i--) {
        if (movimentos[i].status === 'autorizada') {
          movimentos[i].status = 'cancelada';
          break;
        }
      }
    },
    saldo() {
      const devolvido = movimentos
        .filter((m) => m.status === 'autorizada')
        .reduce((s, m) => s + m.qtd, 0);
      return round3(Math.max(0, comprado - devolvido));
    },
    countAutorizadas() {
      return movimentos.filter((m) => m.status === 'autorizada').length;
    }
  };
}

describe('RC3 — statusDoSaldo', () => {
  it('não devolvido', () => {
    assert.equal(statusDoSaldo({ quantidadeComprada: 100, quantidadeDevolvida: 0, saldo: 100 }), STATUS.NAO_DEVOLVIDO);
  });
  it('parcialmente devolvido', () => {
    assert.equal(statusDoSaldo({ quantidadeComprada: 100, quantidadeDevolvida: 30, saldo: 70 }), STATUS.PARCIAL);
  });
  it('totalmente devolvido', () => {
    assert.equal(statusDoSaldo({ quantidadeComprada: 100, quantidadeDevolvida: 100, saldo: 0 }), STATUS.TOTAL);
  });
  it('saldo insuficiente quando solicitada > saldo', () => {
    assert.equal(
      statusDoSaldo({ quantidadeComprada: 100, quantidadeDevolvida: 70, saldo: 30, solicitada: 40 }),
      STATUS.SALDO_INSUFICIENTE
    );
  });
});

describe('RC3 — validarQuantidadesContraSaldo', () => {
  const saldos = {
    itens: [{
      compra_item_id: 1,
      produto_nome: 'Produto A',
      quantidade_comprada: 100,
      quantidade_devolvida: 30,
      saldo: 70
    }]
  };

  it('bloqueia quantidade maior que saldo', () => {
    const out = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 80 }],
      compraCancelada: false
    });
    assert.equal(out.ok, false);
    assert.match(out.erros.join(' '), /Saldo insuficiente/);
  });

  it('bloqueia quantidade zero', () => {
    const out = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 0 }],
      compraCancelada: false
    });
    assert.equal(out.ok, false);
  });

  it('bloqueia item inexistente', () => {
    const out = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 999, quantidade: 1 }],
      compraCancelada: false
    });
    assert.equal(out.ok, false);
    assert.match(out.erros.join(' '), /inexistente/i);
  });

  it('bloqueia compra cancelada', () => {
    const out = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 10 }],
      compraCancelada: true
    });
    assert.equal(out.ok, false);
    assert.match(out.erros.join(' '), /cancelada/i);
  });

  it('aceita quantidade dentro do saldo', () => {
    const out = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 70 }],
      compraCancelada: false
    });
    assert.equal(out.ok, true);
  });
});

describe('RC3 — devoluções parciais (ledger simulado)', () => {
  it('devolução total em uma NF-e', () => {
    const L = simularLedger(100);
    const r = L.emitir(100);
    assert.equal(r.ok, true);
    assert.equal(r.saldoApos, 0);
    assert.equal(L.saldo(), 0);
  });

  it('duas devoluções parciais', () => {
    const L = simularLedger(100);
    assert.equal(L.emitir(30).saldoApos, 70);
    assert.equal(L.emitir(20).saldoApos, 50);
    assert.equal(L.countAutorizadas(), 2);
    assert.equal(L.saldo(), 50);
  });

  it('cinco devoluções parciais até zerar', () => {
    const L = simularLedger(100);
    assert.equal(L.emitir(20).ok, true);
    assert.equal(L.emitir(20).ok, true);
    assert.equal(L.emitir(20).ok, true);
    assert.equal(L.emitir(20).ok, true);
    assert.equal(L.emitir(20).ok, true);
    assert.equal(L.saldo(), 0);
    assert.equal(L.countAutorizadas(), 5);
    assert.equal(L.emitir(1).ok, false);
  });

  it('tentativa de exceder saldo', () => {
    const L = simularLedger(100);
    L.emitir(80);
    const r = L.emitir(30);
    assert.equal(r.ok, false);
    assert.equal(r.saldo, 20);
  });

  it('cancelamento reabre saldo', () => {
    const L = simularLedger(100);
    L.emitir(40);
    assert.equal(L.saldo(), 60);
    L.cancelarUltima();
    assert.equal(L.saldo(), 100);
    assert.equal(L.emitir(100).ok, true);
    assert.equal(L.saldo(), 0);
  });

  it('cenário 30+20+50 = total', () => {
    const L = simularLedger(100);
    assert.equal(L.emitir(30).saldoApos, 70);
    assert.equal(L.emitir(20).saldoApos, 50);
    assert.equal(L.emitir(50).saldoApos, 0);
    assert.equal(L.emitir(1).ok, false);
  });
});
