/**
 * Testes — Contratos Oficiais do Motor Equipamentos (Sprint 7)
 * Executar: npm run test:equipamentos-contracts
 */

const assert = require('assert');

const contracts = require('../../backend/motores/equipamentos/contracts');
const {
  ProdutoDTO,
  PromocaoDTO,
  DepartamentoDTO,
  EtiquetaDTO,
  PesoDTO,
  StatusDTO,
  DiagnosticoDTO,
  EquipamentoDTO,
  ProdutoValidator,
  PromocaoValidator,
  DepartamentoValidator,
  EtiquetaValidator,
  ProdutoNormalizer,
  DepartamentoNormalizer,
  EtiquetaNormalizer,
  Serializer,
  ResponseFactory
} = contracts;

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
  console.log('\n=== Testes Contratos — Motor Equipamentos (Sprint 7) ===\n');

  // ─── DTOs ───────────────────────────────────────────────────
  await test('ProdutoDTO validar delega ao ProdutoValidator', () => {
    const dto = new ProdutoDTO({ plu: 1, descricao: 'Teste', preco: 5 });
    assert.strictEqual(dto.validar().valido, true);
    const invalido = new ProdutoDTO({ descricao: 'X', preco: 1 });
    assert.strictEqual(invalido.validar().valido, false);
  });

  await test('ProdutoDTO toJSON não expõe campos de banco', () => {
    const dto = new ProdutoDTO({ plu: 1, descricao: 'X', preco: 1 });
    const json = dto.toJSON();
    assert.ok(!('id' in json));
    assert.ok('plu' in json);
  });

  await test('ProdutoDTO.fromJSON reidrata corretamente', () => {
    const dto = ProdutoDTO.fromJSON({ plu: 99, descricao: 'Y', preco: 2 });
    assert.ok(dto instanceof ProdutoDTO);
    assert.strictEqual(dto.plu, 99);
  });

  await test('PromocaoDTO valida preço promocional', () => {
    const ok = new PromocaoDTO({ plu: 1, precoPromocional: 3 }).validar();
    const bad = new PromocaoDTO({ plu: 1, precoPromocional: -1 }).validar();
    assert.strictEqual(ok.valido, true);
    assert.strictEqual(bad.valido, false);
  });

  await test('DepartamentoDTO exige código e nome', () => {
    assert.strictEqual(new DepartamentoDTO({ codigo: 1, nome: 'A' }).validar().valido, true);
    assert.strictEqual(new DepartamentoDTO({ codigo: 1 }).validar().valido, false);
  });

  await test('EtiquetaDTO exige layout', () => {
    assert.strictEqual(new EtiquetaDTO({ layout: 'padrao' }).validar().valido, true);
    assert.strictEqual(new EtiquetaDTO({ layout: '' }).validar().valido, false);
  });

  await test('PesoDTO valida valor e unidade', () => {
    assert.strictEqual(new PesoDTO({ valor: 1.5, unidade: 'kg' }).validar().valido, true);
    assert.strictEqual(new PesoDTO({ valor: -1 }).validar().valido, false);
  });

  await test('StatusDTO serializa status de equipamento', () => {
    const dto = new StatusDTO({ online: true, fabricante: 'Toledo' });
    const json = dto.toJSON();
    assert.strictEqual(json.online, true);
    assert.strictEqual(json.fabricante, 'Toledo');
  });

  await test('DiagnosticoDTO inclui comunicacao_real', () => {
    const dto = new DiagnosticoDTO({ sucesso: true, comunicacaoReal: false });
    assert.strictEqual(dto.toJSON().comunicacao_real, false);
  });

  await test('EquipamentoDTO valida config ethernet', () => {
    const ok = new EquipamentoDTO({
      fabricante: 'Toledo',
      modelo: 'Prix 4 Uno',
      driverCodigo: 'TOLEDO_PRIX4_UNO',
      host: '192.168.1.1'
    });
    assert.strictEqual(ok.validar().valido, true);
    const bad = new EquipamentoDTO({ fabricante: 'Toledo' });
    assert.strictEqual(bad.validar().valido, false);
  });

  // ─── Validadores ────────────────────────────────────────────
  await test('ProdutoValidator rejeita unidade inválida', () => {
    const r = ProdutoValidator.validar({ plu: 1, descricao: 'X', preco: 1, unidade: 'litro' });
    assert.strictEqual(r.valido, false);
  });

  await test('PromocaoValidator rejeita datas invertidas', () => {
    const r = PromocaoValidator.validar({
      plu: 1,
      precoPromocional: 5,
      dataInicio: '2026-12-01',
      dataFim: '2026-01-01'
    });
    assert.strictEqual(r.valido, false);
  });

  await test('DepartamentoValidator rejeita origem inválida', () => {
    const r = DepartamentoValidator.validar({ codigo: 1, nome: 'X', origemTipo: 'invalido' });
    assert.strictEqual(r.valido, false);
  });

  await test('EtiquetaValidator rejeita preço negativo', () => {
    const r = EtiquetaValidator.validar({ layout: 'padrao', preco: -1 });
    assert.strictEqual(r.valido, false);
  });

  // ─── Normalizadores ─────────────────────────────────────────
  await test('ProdutoNormalizer trunca descrição reduzida', () => {
    const longa = 'A'.repeat(30);
    const dto = ProdutoNormalizer.normalizar({ plu: 1, descricao: longa, preco: 1 });
    assert.ok(dto.descricaoReduzida.length <= 22);
  });

  await test('DepartamentoNormalizer trunca nome longo', () => {
    const dto = DepartamentoNormalizer.normalizar({ codigo: 1, nome: 'N'.repeat(50) });
    assert.ok(dto.nome.length <= 30);
  });

  await test('EtiquetaNormalizer normaliza layout para lowercase', () => {
    const dto = EtiquetaNormalizer.normalizar({ layout: 'PADRAO' });
    assert.strictEqual(dto.layout, 'padrao');
  });

  // ─── Serializer ─────────────────────────────────────────────
  await test('Serializer.serialize produz JSON genérico', () => {
    const dto = new ProdutoDTO({ plu: 1, descricao: 'X', preco: 1 });
    const out = Serializer.serialize(dto);
    assert.strictEqual(out.formato, 'json');
    assert.strictEqual(out.implementado, true);
    assert.strictEqual(out.tipo, 'produto');
  });

  await test('Serializer.serializeForFabricante é stub', () => {
    const dto = new ProdutoDTO({ plu: 1, descricao: 'X', preco: 1 });
    const out = Serializer.serializeForFabricante(dto, 'toledo');
    assert.strictEqual(out.implementado, false);
    assert.strictEqual(out.fabricante, 'toledo');
  });

  await test('Serializer.rehydratar restaura DTO da fila', () => {
    const dto = Serializer.rehydratar('produto', { plu: 5, descricao: 'Z', preco: 3 });
    assert.ok(dto instanceof ProdutoDTO);
    assert.strictEqual(dto.plu, 5);
  });

  // ─── ResponseFactory ────────────────────────────────────────
  await test('ResponseFactory.sucesso padroniza resposta', () => {
    const r = ResponseFactory.sucesso({ mensagem: 'OK', dados: { id: 1 } });
    assert.strictEqual(r.sucesso, true);
    assert.strictEqual(r.status, 'sucesso');
    assert.deepStrictEqual(r.dados, { id: 1 });
  });

  await test('ResponseFactory.erro padroniza falha', () => {
    const r = ResponseFactory.erro({ mensagem: 'Falha', erros: ['campo X'] });
    assert.strictEqual(r.sucesso, false);
    assert.ok(r.erros.includes('campo X'));
  });

  await test('ResponseFactory.aviso marca aviso', () => {
    const r = ResponseFactory.aviso({ mensagem: 'Atenção' });
    assert.strictEqual(r.aviso, true);
    assert.strictEqual(r.sucesso, true);
  });

  await test('ResponseFactory.diagnostico estrutura relatório', () => {
    const r = ResponseFactory.diagnostico({ simulado: true, componentes: { protocol: true } });
    assert.strictEqual(r.simulado, true);
    assert.strictEqual(r.comunicacao_real, false);
  });

  await test('ResponseFactory.status retorna online/conectado', () => {
    const r = ResponseFactory.status({ online: true, conectado: false });
    assert.strictEqual(r.online, true);
    assert.strictEqual(r.conectado, false);
  });

  await test('ResponseFactory.paraRespostaApi converte para HTTP', () => {
    const api = ResponseFactory.paraRespostaApi({ sucesso: true, mensagem: 'OK', dados: { x: 1 } });
    assert.strictEqual(api.success, true);
    assert.strictEqual(api.message, 'OK');
    assert.deepStrictEqual(api.data, { x: 1 });
  });

  // ─── Barrel export ────────────────────────────────────────────
  await test('contracts/index exporta todos os módulos', () => {
    assert.ok(contracts.ProdutoDTO);
    assert.ok(contracts.ResponseFactory);
    assert.ok(contracts.Serializer);
    assert.ok(contracts.ProdutoNormalizer);
  });

  // ─── Compatibilidade dto/ ─────────────────────────────────────
  await test('dto/ re-export aponta para contracts', () => {
    const LegacyDTO = require('../../backend/motores/equipamentos/dto/ProdutoDTO');
    assert.strictEqual(LegacyDTO, ProdutoDTO);
  });

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
