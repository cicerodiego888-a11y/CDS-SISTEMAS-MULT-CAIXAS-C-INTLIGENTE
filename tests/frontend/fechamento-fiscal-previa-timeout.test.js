'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontendFile = path.join(
  __dirname,
  '../../frontend/erp/js/fechamento-fiscal-dia.js'
);
const serviceFile = path.join(
  __dirname,
  '../../backend/services/fechamento-fiscal/FechamentoFiscalService.js'
);
const frontend = fs.readFileSync(frontendFile, 'utf8');
const service = fs.readFileSync(serviceFile, 'utf8');
const previewHandler = frontend.match(
  /async function ffdAtualizarPrevia\(\) \{[\s\S]*?\n\}/
)?.[0] || '';

test('timeout de interface mantém a requisição e o lock ativos até resposta real', () => {
  assert.ok(previewHandler);
  assert.match(frontend, /FFD_PREVIA_TIMEOUT_MS = 120000/);
  assert.match(previewHandler, /Promise\.race/);
  assert.match(previewHandler, /request\.then/);
  assert.match(previewHandler, /if \(resultado\.demorou\)[\s\S]*?body = await request/);
  assert.match(previewHandler, /A solicitação continua ativa/);
  assert.match(previewHandler, /Aguardando servidor…/);
  assert.doesNotMatch(previewHandler, /AbortController|\.abort\(/);
  assert.doesNotMatch(previewHandler, /request\.then\(\(body\) => \{/);
  assert.match(frontend, /finally\s*\{\s*__ffdEstado\.ops\[chave\] = false/);
});

test('painel mostra processamento indeterminado e mantém as etapas sem confirmação pendentes', () => {
  const renderer = frontend.match(
    /function ffdRenderPreviaProcessamento\(opcoes = \{\}\) \{[\s\S]*?\n\}/
  )?.[0] || '';
  assert.ok(renderer);

  const elemento = {
    attributes: {},
    innerHTML: '',
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
  const context = {
    document: { getElementById: () => elemento }
  };
  vm.runInNewContext(`${renderer}; ffdRenderPreviaProcessamento();`, context);

  assert.equal(elemento.attributes['aria-busy'], 'true');
  assert.match(elemento.innerHTML, /Montando prévia fiscal\.\.\./);
  assert.match(elemento.innerHTML, /Aguarde enquanto o sistema distribui os valores/);
  assert.match(elemento.innerHTML, /Solicitação ativa: aguardando confirmação do servidor/);
  assert.equal((elemento.innerHTML.match(/data-state="pending"/g) || []).length, 5);
  assert.match(elemento.innerHTML, /spinner-border/);
  assert.doesNotMatch(elemento.innerHTML, /progressbar|%/);

  vm.runInNewContext(
    `${renderer}; ffdRenderPreviaProcessamento({ demorada: true });`,
    context
  );
  assert.match(elemento.innerHTML, /A geração está demorando/);
  assert.match(elemento.innerHTML, /aguardando resposta do servidor/);
});

test('atualizações paralelas da tela não substituem o painel durante o POST', () => {
  const renderer = frontend.match(
    /function ffdRenderPrevia\(previa\) \{[\s\S]*?\n\}/
  )?.[0] || '';
  assert.ok(renderer);

  const previaAtual = { id: 'atual' };
  let painelReexibido;
  const context = {
    __ffdEstado: {
      previa: previaAtual,
      previaRequestAtiva: true,
      previaDemorada: true
    },
    ffdRenderPreviaProcessamento(opcoes) {
      painelReexibido = opcoes;
    }
  };
  vm.runInNewContext(`${renderer}; ffdRenderPrevia({ id: 'persistida' });`, context);

  assert.equal(context.__ffdEstado.previa, previaAtual);
  assert.equal(painelReexibido.demorada, true);
});

test('sucesso e falha encerram o painel e não preservam composição anterior como atual', () => {
  assert.match(frontend, /el\.setAttribute\('aria-busy', 'false'\)/);
  assert.match(previewHandler, /__ffdEstado\.previa = null;\s*__ffdEstado\.indicadores = null;\s*ffdRenderPrevia\(null\);[\s\S]*?const request = fetch[\s\S]*?__ffdEstado\.previaRequestAtiva = true;[\s\S]*?ffdRenderPreviaProcessamento\(\)/);
  assert.match(previewHandler, /ffdRenderPrevia\(body\.previa\)/);
  assert.match(previewHandler, /A geração da prévia não foi concluída/);
  assert.match(previewHandler, /Tente novamente quando a operação anterior estiver encerrada/);
});

test('backend coalesce requests iguais e rejeita composição concorrente conflitante', () => {
  assert.match(service, /const previewsEmAndamento = new Map\(\)/);
  assert.match(service, /existente\.assinatura === assinatura/);
  assert.match(service, /PREVIA_EM_ANDAMENTO/);
});

test('timeout do worker encerra execução, rejeita saída sem resultado e preserva a fila', () => {
  const workerFile = path.join(
    __dirname,
    '../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoWorker.js'
  );
  const worker = fs.readFileSync(workerFile, 'utf8');

  assert.match(worker, /WORKER_TIMEOUT_MS = 90_000/);
  assert.match(worker, /PREVIA_WORKER_TIMEOUT/);
  assert.match(worker, /PREVIA_WORKER_NO_RESULT/);
  assert.match(worker, /worker\.terminate\(\)[\s\S]*?\.then\(\(\) => concluir\(\)\)/);
  assert.match(worker, /fila = tarefa\.catch\(\(\) => \{\}\)/);
});

test('conflito atualiza a tela com o último estado persistido e limpa prévia ausente', () => {
  assert.match(previewHandler, /err\.code === 'PREVIA_EM_ANDAMENTO'[\s\S]*?await ffdCarregarDia\(\)/);
  assert.match(previewHandler, /última prévia persistida/);
  assert.match(previewHandler, /A composição exibida é a última prévia persistida/);
  assert.match(frontend, /else if \(!silencioso\) \{\s*ffdRenderPrevia\(null\)/);
});

test('rastreia ciclo, worker e persistência sem registrar payload de recebimentos', () => {
  const workerFile = path.join(
    __dirname,
    '../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoWorker.js'
  );
  const routeFile = path.join(__dirname, '../../backend/rotas/fechamento-fiscal.js');
  const worker = fs.readFileSync(workerFile, 'utf8');
  const route = fs.readFileSync(routeFile, 'utf8');

  assert.match(service, /previa_geracao_inicio/);
  assert.match(service, /previa_geracao_fim/);
  assert.match(service, /previa_etapa_inicio/);
  assert.match(service, /previa_etapa_fim/);
  assert.match(service, /T9-persistence/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(worker, /previa_worker_enfileirado/);
  assert.match(worker, /previa_worker_message/);
  assert.match(worker, /previa_worker_error/);
  assert.match(worker, /previa_worker_exit/);
  assert.match(route, /x-correlation-id/);
  assert.match(route, /previa_rota_fim/);
  assert.match(previewHandler, /quantidade_comprovantes/);
  assert.match(previewHandler, /x-correlation-id/);
  assert.doesNotMatch(previewHandler, /PREVIA REQUEST[\s\S]{0,400}\.\.\.payloadPrevia/);
});
