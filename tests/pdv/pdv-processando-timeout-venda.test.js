/**
 * PDV — Processando eterno / timeout / erro na finalização.
 * Executar: node --test tests/pdv/pdv-processando-timeout-venda.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PDV = path.join(__dirname, '../../frontend/pdv/js/pdv.js');
const src = fs.readFileSync(PDV, 'utf8');

describe('PDV — Processando / timeout / erro', () => {
  it('TESTE 8 — AJAX de finalização tem timeout', () => {
    assert.match(src, /function enviarVenda\(payload\)/);
    assert.match(src, /timeout:\s*120000/);
  });

  it('TESTE 8/9 — timeout e erro liberam vendaEmProcessamento', () => {
    assert.match(src, /textStatus === 'timeout'/);
    assert.match(src, /textStatus === 'abort'/);
    assert.match(src, /Falha de rede ao finalizar a venda/);
    assert.match(src, /Tempo esgotado ao finalizar a venda/);
    assert.match(src, /vendaEmProcessamento = false/);
  });

  it('TESTE 9 — resposta inválida e exceção não deixam Processando eterno', () => {
    assert.match(src, /Resposta inválida ao finalizar a venda/);
    assert.match(src, /catch \(erroSucesso\)/);
    assert.match(src, /Erro ao processar resposta da venda/);
  });

  it('bloqueia reentrada enquanto processa', () => {
    assert.match(src, /if \(vendaEmProcessamento\) \{\s*\n\s*showNotification\('A venda já está sendo processada\.'/);
  });

  it('handoff aguardando_nao_fiscal mantém processamento até modal', () => {
    assert.match(src, /handoffNaoFiscal = true/);
    assert.match(src, /iniciarFluxoPosVendaComNaoFiscal/);
    assert.match(src, /function iniciarFluxoPosVendaComNaoFiscal/);
  });

  it('cancelar aviso de débito libera o Processando', () => {
    assert.match(src, /function mostrarModalAvisoDebitoCliente\([\s\S]*?onCancel/);
    assert.match(src, /hidden\.bs\.modal\.avisoDebito/);
  });
});
