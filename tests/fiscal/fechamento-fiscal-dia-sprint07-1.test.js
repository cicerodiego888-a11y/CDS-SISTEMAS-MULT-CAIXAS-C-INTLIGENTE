/**
 * Sprint 07.1 — Correção do fluxo de finalização do Fechamento Fiscal do Dia
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint07-1.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
const SVC = fs.readFileSync(path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalService.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fechamento-fiscal.js'), 'utf8');

describe('Sprint 07.1 — finalização Fechamento Fiscal do Dia', () => {
  it('TESTE A — modal Não: blur antes do hide e foco restaurado', () => {
    assert.match(FRONT, /function ffdBlurSeDentro/);
    assert.match(FRONT, /hide\.bs\.modal/);
    assert.match(FRONT, /hidden\.bs\.modal/);
    assert.match(FRONT, /id="ffdConfirmNao">Não/);
    assert.match(FRONT, /finalizar\(false\)/);
    assert.match(FRONT, /function ffdFocoSeguro/);
    assert.doesNotMatch(FRONT, /aria-hidden="false"/);
    assert.doesNotMatch(FRONT, /removeAttribute\('aria-hidden'\)/);
  });

  it('TESTE B — Sim executa uma vez e fecha o modal', () => {
    assert.match(FRONT, /if \(decidido\) return/);
    assert.match(FRONT, /finalizar\(true\)/);
    assert.match(FRONT, /id="ffdConfirmSim">Sim/);
    assert.match(FRONT, /ev\.preventDefault\(\)/);
    assert.match(FRONT, /ev\.stopPropagation\(\)/);
  });

  it('TESTE C — prévia com data do fechamento e indicadores reais', () => {
    assert.match(FRONT, /data_fechamento: data/);
    assert.match(FRONT, /valor_informado: total/);
    assert.match(FRONT, /body\.indicadores/);
    assert.match(FRONT, /ffdIndElegiveis/);
    assert.match(FRONT, /ffdPrevDistribuido/);
    assert.match(SVC, /resolverDataFechamento\(params, fechamento\)/);
    assert.match(SVC, /fechamento\?\.data_fechamento/);
    assert.match(ROTA, /data_fechamento: body\.data_fechamento/);
  });

  it('TESTE D — diferença de conciliação bloqueia avanço', () => {
    assert.match(FRONT, /function ffdDiferencaConciliacao/);
    assert.match(FRONT, /function ffdRecebimentosConciliados/);
    assert.match(FRONT, /function ffdBloqueioAvanco/);
    assert.match(FRONT, /diferença de/);
    assert.match(FRONT, /Pendente de conciliação/);
  });

  it('TESTE E — composição deixa de ser traço após prévia', () => {
    assert.match(FRONT, /if \(!previa\) \{/);
    assert.match(FRONT, /ffdFmtMoney\(previa\.valor_distribuido\)/);
    assert.match(FRONT, /ind\.produtos_elegiveis/);
  });

  it('TESTE F — validar reutiliza endpoint oficial e mostra erro real', () => {
    assert.match(FRONT, /\/validar/);
    assert.match(FRONT, /function ffdErroApi/);
    assert.match(FRONT, /Pendências fiscais/);
    assert.match(FRONT, /ffdBloqueioAvanco\('validar'\)/);
  });

  it('TESTE G — preparar só após validação e usa preparar-emissao', () => {
    assert.match(FRONT, /\/preparar-emissao/);
    assert.match(FRONT, /Execute a validação fiscal antes de preparar/);
    assert.match(FRONT, /PRONTO_EMISSAO/);
  });

  it('TESTE H — produção não é trava artificial na UI', () => {
    assert.match(FRONT, /transmissão habilitada|transmissaoHabilitada|transmissao_habilitada/);
    assert.doesNotMatch(FRONT, /permanece bloqueada nesta versão/);
    assert.doesNotMatch(FRONT, /Transmissão somente em homologação/);
    assert.match(ROTA, /producao_bloqueada: false/);
  });

  it('TESTE I — polling único sem apagar prévia/recebimentos', () => {
    assert.match(FRONT, /FFD_POLL_MS = 10000/);
    assert.match(FRONT, /if \(__ffdEstado\.pollTimer\)/);
    assert.match(FRONT, /clearInterval\(__ffdEstado\.pollTimer\)/);
    assert.match(FRONT, /ffdModalAberto\(\) \|\| ffdUsuarioEditandoTela\(\) \|\| ffdOpsAtivas\(\)/);
    assert.match(FRONT, /ff\.previa_vendas && ff\.previa_vendas\.length && !silencioso/);
    assert.doesNotMatch(FRONT, /setInterval\([\s\S]{0,80}setInterval/);
  });

  it('TESTE J — lock impede clique duplicado nas operações críticas', () => {
    assert.match(FRONT, /function ffdComLock/);
    assert.match(FRONT, /if \(__ffdEstado\.ops\[chave\]\) return null/);
    assert.match(FRONT, /ffdComLock\('previa'/);
    assert.match(FRONT, /ffdComLock\('validar'/);
    assert.match(FRONT, /ffdComLock\('preparar'/);
    assert.match(FRONT, /ffdComLock\('salvar'/);
  });

  it('conciliação não é sinônimo de pronto para emissão', () => {
    assert.match(FRONT, /Conciliação dos recebimentos/);
    assert.match(FRONT, /Ainda é necessário atualizar a prévia e validar/);
  });

  it('erros de API incluem detalhes e não só "Erro ao processar"', () => {
    assert.match(FRONT, /console\.error\('\[FFD\] erro API'/);
    assert.match(ROTA, /detalhes: detalhes \|\| undefined/);
    assert.match(FRONT, /Não foi possível preparar o fechamento/);
  });

  it('não altera motores comercial/fiscal/estoque/financeiro', () => {
    const comercial = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    assert.match(comercial, /INSERT INTO vendas_itens/);
    assert.doesNotMatch(FRONT, /quantidade_fiscal\s*=/);
    assert.doesNotMatch(FRONT, /Motor Comercial/);
  });
});
