/**
 * Testes — Motor de Sincronização do Motor Equipamentos (Sprint 4)
 * Cobre DTOs, Mappers e constantes de fila (sem tocar em banco/hardware).
 * Executar: npm run test:equipamentos-sync
 */

const assert = require('assert');

const ProdutoDTO = require('../../backend/motores/equipamentos/dto/ProdutoDTO');
const PromocaoDTO = require('../../backend/motores/equipamentos/dto/PromocaoDTO');
const DepartamentoDTO = require('../../backend/motores/equipamentos/dto/DepartamentoDTO');
const EtiquetaDTO = require('../../backend/motores/equipamentos/dto/EtiquetaDTO');

const ProdutoMapper = require('../../backend/motores/equipamentos/services/ProdutoMapper');
const PromocaoMapper = require('../../backend/motores/equipamentos/services/PromocaoMapper');
const DepartamentoMapper = require('../../backend/motores/equipamentos/services/DepartamentoMapper');
const EtiquetaMapper = require('../../backend/motores/equipamentos/services/EtiquetaMapper');

const queueManager = require('../../backend/motores/equipamentos/queue/QueueManager');
const equipamentosEvents = require('../../backend/motores/equipamentos/events/EquipamentosEvents');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

async function main() {
  console.log('\n=== Testes Motor de Sincronização — Sprint 4 ===\n');

  await test('ProdutoMapper produz ProdutoDTO desacoplado do banco', () => {
    const dto = ProdutoMapper.toDTO({ id: 10, codigo: '55', nome: 'Banana', preco_venda: 4.99, unidade: 'kg' });
    assert.ok(dto instanceof ProdutoDTO);
    assert.strictEqual(dto.descricao, 'Banana');
    assert.strictEqual(dto.preco, 4.99);
    assert.strictEqual(dto.pesavel, true);
    const json = dto.toJSON();
    assert.ok(!('id' in json), 'DTO não deve carregar id bruto do banco como campo próprio');
    assert.ok('plu' in json && 'descricao' in json && 'preco' in json);
  });

  await test('ProdutoDTO.validar detecta preço inválido', () => {
    const dto = new ProdutoDTO({ plu: 1, descricao: 'X', preco: -1 });
    const v = dto.validar();
    assert.strictEqual(v.valido, false);
  });

  await test('PromocaoMapper produz PromocaoDTO', () => {
    const dto = PromocaoMapper.toDTO({ produto_codigo: '9', preco_promocional: 2.5, status: 'ativa' });
    assert.ok(dto instanceof PromocaoDTO);
    assert.strictEqual(dto.ativa, true);
    assert.strictEqual(dto.precoPromocional, 2.5);
  });

  await test('DepartamentoMapper produz DepartamentoDTO', () => {
    const dto = DepartamentoMapper.toDTO({ id: 3, nome: 'Hortifruti' });
    assert.ok(dto instanceof DepartamentoDTO);
    assert.strictEqual(dto.nome, 'Hortifruti');
    assert.strictEqual(dto.validar().valido, true);
  });

  await test('EtiquetaMapper produz EtiquetaDTO', () => {
    const dto = EtiquetaMapper.toDTO({ codigo: '5', nome: 'Maçã', preco_venda: 7 });
    assert.ok(dto instanceof EtiquetaDTO);
    assert.strictEqual(dto.layout, 'padrao');
    assert.strictEqual(dto.validar().valido, true);
  });

  await test('QueueManager expõe todos os comandos SYNC_*', () => {
    const c = queueManager.COMANDOS;
    ['SYNC_PRODUTO', 'SYNC_PROMOCAO', 'SYNC_DEPARTAMENTO', 'SYNC_ETIQUETA', 'REMOVER_PRODUTO'].forEach((cmd) => {
      assert.strictEqual(c[cmd], cmd, `comando ausente: ${cmd}`);
    });
  });

  await test('QueueManager.validarComando rejeita comando inválido', () => {
    const v = queueManager.validarComando({ equipamentoId: 1, comando: 'XPTO' });
    assert.strictEqual(v.valido, false);
  });

  await test('EquipamentosEvents expõe canais sync.*', () => {
    const canais = equipamentosEvents.CANAIS;
    ['SYNC_INICIADO', 'SYNC_PRODUTO', 'SYNC_PROMOCAO', 'SYNC_DEPARTAMENTO', 'SYNC_ETIQUETA', 'SYNC_CANCELADO', 'SYNC_ERRO', 'SYNC_FINALIZADO'].forEach((k) => {
      assert.ok(canais[k] && canais[k].startsWith('sync.'), `canal ausente: ${k}`);
    });
  });

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
