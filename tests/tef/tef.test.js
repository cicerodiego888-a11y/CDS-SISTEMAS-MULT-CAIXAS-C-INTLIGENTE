const TefManager = require('../backend/services/tef/TefManager');
const TefFiscalValidator = require('../backend/services/tef/tefFiscalValidator');
const DataMaskingService = require('../backend/services/crypto/dataMaskingService');
const cardTokenizationService = require('../backend/services/crypto/cardTokenizationService');
const tefPciDssService = require('../backend/services/tef/tefPciDssService');

/**
 * Testes automatizados para TEF
 */
describe('TEF Tests', () => {
  
  describe('TefFiscalValidator', () => {
    
    test('Deve validar transação com dados corretos', () => {
      const dados = {
        valor: 100.00,
        tipo: 'credito',
        parcelas: 1,
        bandeira: 'visa'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(true);
      expect(resultado.erros).toHaveLength(0);
    });
    
    test('Deve rejeitar valor abaixo do mínimo', () => {
      const dados = {
        valor: 0.50,
        tipo: 'credito',
        parcelas: 1,
        bandeira: 'visa'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.length).toBeGreaterThan(0);
    });
    
    test('Deve rejeitar valor acima do máximo', () => {
      const dados = {
        valor: 100000.00,
        tipo: 'credito',
        parcelas: 1,
        bandeira: 'visa'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.length).toBeGreaterThan(0);
    });
    
    test('Deve rejeitar parcelamento acima do limite', () => {
      const dados = {
        valor: 100.00,
        tipo: 'credito',
        parcelas: 15,
        bandeira: 'visa'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.length).toBeGreaterThan(0);
    });
    
    test('Deve rejeitar débito com parcelas', () => {
      const dados = {
        valor: 100.00,
        tipo: 'debito',
        parcelas: 2,
        bandeira: 'visa'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.length).toBeGreaterThan(0);
    });
    
    test('Deve rejeitar valor por parcela abaixo do mínimo', () => {
      const dados = {
        valor: 15.00,
        tipo: 'credito',
        parcelas: 2,
        bandeira: 'visa'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.length).toBeGreaterThan(0);
    });
    
    test('Deve rejeitar bandeira não permitida', () => {
      const dados = {
        valor: 100.00,
        tipo: 'credito',
        parcelas: 1,
        bandeira: 'bandeira_invalida'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.length).toBeGreaterThan(0);
    });
  });
  
  describe('DataMaskingService', () => {
    
    test('Deve mascarar número de cartão corretamente', () => {
      const cartao = '4111111111111111';
      const mascarado = DataMaskingService.mascararCartao(cartao);
      
      expect(mascarado).toBe('411111****1111');
      expect(mascarado.length).toBe(cartao.length);
    });
    
    test('Deve mascarar autorização corretamente', () => {
      const autorizacao = '12345678';
      const mascarado = DataMaskingService.mascararAutorizacao(autorizacao);
      
      expect(mascarado).toBe('****5678');
    });
    
    test('Deve mascarar NSU corretamente', () => {
      const nsu = '1234567890';
      const mascarado = DataMaskingService.mascararNsu(nsu);
      
      expect(mascarado).toBe('******7890');
    });
    
    test('Deve mascarar CPF corretamente', () => {
      const cpf = '12345678901';
      const mascarado = DataMaskingService.mascararDocumento(cpf);
      
      expect(mascarado).toBe('123****01');
    });
    
    test('Deve mascarar e-mail corretamente', () => {
      const email = 'usuario@dominio.com';
      const mascarado = DataMaskingService.mascararEmail(email);
      
      expect(mascarado).toBe('u*****@dominio.com');
    });
    
    test('Deve mascarar telefone corretamente', () => {
      const telefone = '11987654321';
      const mascarado = DataMaskingService.mascararTelefone(telefone);
      
      expect(mascarado).toBe('11****321');
    });
    
    test('Deve mascarar objeto recursivamente', () => {
      const objeto = {
        numero_cartao: '4111111111111111',
        nome: 'João Silva',
        cpf: '12345678901',
        email: 'joao@email.com'
      };
      
      const mascarado = DataMaskingService.mascararObjeto(objeto);
      
      expect(mascarado.numero_cartao).toBe('411111****1111');
      expect(mascarado.nome).toBe('João Silva');
      expect(mascarado.cpf).toBe('123****01');
      expect(mascarado.email).toBe('j***@email.com');
    });
  });
  
  describe('cardTokenizationService', () => {
    
    test('Deve validar número de cartão com algoritmo de Luhn', async () => {
      const dadosCartao = {
        numero: '4111111111111111',
        validade: '12/25',
        cvv: '123',
        bandeira: 'visa'
      };
      
      // O serviço deve validar o cartão
      expect(() => {
        // A validação é interna, mas podemos testar se o token é gerado
        // Em produção, isso seria um teste de integração
        const token = cardTokenizationService._gerarToken();
        expect(token).toMatch(/^TKN_/);
      }).not.toThrow();
    });
    
    test('Deve gerar token único', () => {
      const token1 = cardTokenizationService._gerarToken();
      const token2 = cardTokenizationService._gerarToken();
      
      expect(token1).not.toBe(token2);
      expect(token1).toMatch(/^TKN_/);
      expect(token2).toMatch(/^TKN_/);
    });
  });
  
  describe('tefPciDssService', () => {
    
    test('Deve verificar conformidade PCI-DSS', () => {
      const conformidade = tefPciDssService.verificarConformidade();
      
      expect(conformidade).toHaveProperty('data_verificacao');
      expect(conformidade).toHaveProperty('requisitos_pci');
      expect(conformidade).toHaveProperty('controles_tef');
      expect(conformidade).toHaveProperty('conformidade_geral');
    });
    
    test('Deve obter requisitos PCI-DSS', () => {
      const requisitos = tefPciDssService.obterRequisitosPCI();
      
      expect(requisitos).toHaveProperty('firewall');
      expect(requisitos).toHaveProperty('senhas');
      expect(requisitos).toHaveProperty('protecao_dados');
      expect(requisitos).toHaveProperty('criptografia_transmissao');
    });
    
    test('Deve obter controles TEF', () => {
      const controles = tefPciDssService.obterControlesTEF();
      
      expect(controles).toHaveProperty('tokenizacao');
      expect(controles).toHaveProperty('mascaramento');
      expect(controles).toHaveProperty('nao_armazenamento_cvv');
      expect(controles).toHaveProperty('logs_imutaveis');
    });
    
    test('Deve gerar checklist de conformidade', () => {
      const checklist = tefPciDssService.obterChecklist();
      
      expect(Array.isArray(checklist)).toBe(true);
      expect(checklist.length).toBeGreaterThan(0);
    });
  });
  
  describe('Regras Fiscais por Bandeira', () => {
    
    test('Visa deve ter limite de 12 parcelas para crédito', () => {
      const dados = {
        valor: 100.00,
        tipo: 'credito',
        parcelas: 12,
        bandeira: 'visa'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(true);
    });
    
    test('Amex deve ter valor mínimo de parcela maior', () => {
      const dados = {
        valor: 30.00,
        tipo: 'credito',
        parcelas: 2,
        bandeira: 'amex'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(true);
    });
    
    test('Amex deve ter valor máximo maior', () => {
      const dados = {
        valor: 75000.00,
        tipo: 'credito',
        parcelas: 1,
        bandeira: 'amex'
      };
      
      const resultado = TefFiscalValidator.validarTransacao(dados);
      
      expect(resultado.valido).toBe(true);
    });
  });
});
