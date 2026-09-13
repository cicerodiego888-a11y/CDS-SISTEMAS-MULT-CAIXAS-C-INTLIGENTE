# Integração Real com Adquirentes TEF

## Visão Geral

Este documento descreve como implementar a integração real com os adquirentes TEF (SiTef e PayGo) usando os SDKs nativos.

## Status Atual

**ADAPTERS ATUAIS:**
- `sitefAdapter.js` - Stub que simula comunicação com SiTef
- `paygoAdapter.js` - Stub que simula comunicação com PayGo

**ESTRUTURA IMPLEMENTADA:**
- Suporte a múltiplas bandeiras (Visa, Mastercard, Elo, Hipercard, Amex, Discover, JCB, Diners, Aura)
- Estrutura de certificação (`tefCertificationService.js`)
- Serviço de homologação (`tefHomologacaoService.js`)
- Validação fiscal (`tefFiscalValidator.js`)

## Integração Real - SiTef (Software Express)

### Pré-requisitos

1. **SDK CliSiTef**
   - Download: www.softwareexpress.com.br
   - Versão: Consultar documentação mais recente
   - Arquivos necessários:
     - `clisitef.dll` (Windows)
     - `libclisitef.so` (Linux)
     - `libclisitef.dylib` (macOS)

2. **Certificação**
   - Contato: Software Express
   - Processo de homologação obrigatório
   - Ambiente de teste fornecido pelo adquirente

### Implementação com FFI

**Opção 1: Usar ffi-napi**

```bash
npm install ffi-napi ref-napi
```

```javascript
const ffi = require('ffi-napi');
const ref = require('ref-napi');

// Carregar DLL do SiTef
const clisitef = ffi.Library('clisitef', {
  'ConfiguraIntegracao': ['int', ['string', 'string', 'string', 'string', 'string']],
  'IniciaFuncaoSiTefInterativo': ['int', ['int', 'string', 'pointer']],
  'ContinuaFuncaoSiTefInterativo': ['int', ['pointer', 'pointer', 'pointer', 'pointer']],
  'FinalizaFuncaoSiTefInterativo': ['int', ['int', 'pointer']],
  'VerificaPresencaPinPad': ['int', []]
});

class SitefRealAdapter {
  async autorizar(dados) {
    // Configurar integração
    const resultadoConfig = clisitef.ConfiguraIntegracao(
      dados.terminal_id,
      dados.filial_id,
      dados.operador_id,
      dados.parametros,
      dados.rede
    );
    
    if (resultadoConfig !== 0) {
      throw new Error('Erro ao configurar SiTef');
    }
    
    // Iniciar transação
    const buffer = Buffer.alloc(1024);
    const resultado = clisitef.IniciaFuncaoSiTefInterativo(
      1, // Função de venda
      dados.valor_formatado,
      buffer
    );
    
    // Processar resposta
    if (resultado === 0) {
      return this._parsearResposta(buffer.toString());
    } else {
      throw new Error(`Erro SiTef: ${resultado}`);
    }
  }
  
  _parsearResposta(resposta) {
    // Parsear resposta do SDK
    const campos = resposta.split('\n');
    return {
      status: campos[0],
      nsu: campos[1],
      autorizacao: campos[2],
      bandeira: campos[3]
    };
  }
}
```

**Opção 2: Usar Wrapper Oficial**

Se a Software Express fornecer wrapper Node.js oficial:

```bash
npm install clisitef-node
```

```javascript
const CliSiTef = require('clisitef-node');

class SitefRealAdapter {
  async autorizar(dados) {
    const cliente = new CliSiTef({
      terminal: dados.terminal_id,
      filial: dados.filial_id
    });
    
    try {
      const resultado = await cliente.venda({
        valor: dados.valor,
        tipo: dados.tipo,
        parcelas: dados.parcelas
      });
      
      return {
        status: resultado.status === 'OK' ? 'aprovado' : 'negado',
        nsu: resultado.nsu,
        autorizacao: resultado.autorizacao,
        bandeira: resultado.bandeira
      };
    } catch (error) {
      throw new Error(`Erro SiTef: ${error.message}`);
    }
  }
}
```

### Especificações Técnicas

**Funções Principais:**
- `ConfiguraIntegracao` - Configura parâmetros de integração
- `IniciaFuncaoSiTefInterativo` - Inicia transação interativa
- `ContinuaFuncaoSiTefInterativo` - Continua processamento
- `FinalizaFuncaoSiTefInterativo` - Finaliza transação
- `VerificaPresencaPinPad` - Verifica PinPad conectado

**Tipos de Transação:**
- 1: Venda
- 2: Cancelamento
- 3: Consulta
- 4: Reimpressão

**Códigos de Retorno:**
- 0: Sucesso
- 1: Erro
- -1: PinPad não encontrado
- -2: Erro de comunicação

## Integração Real - PayGo

### Pré-requisitos

1. **SDK PayGo**
   - Download: www.paygo.com.br
   - Versão: Consultar documentação mais recente
   - Arquivos necessários:
     - `paygo.dll` (Windows)
     - `libpaygo.so` (Linux)

2. **Certificação**
   - Contato: PayGo
   - Processo de homologação obrigatório
   - Ambiente de teste fornecido pelo adquirente

### Implementação com FFI

```javascript
const ffi = require('ffi-napi');

// Carregar DLL do PayGo
const paygo = ffi.Library('paygo', {
  'PGO_IniciaFuncao': ['int', ['int', 'string', 'pointer']],
  'PGO_ContinuaFuncao': ['int', ['pointer', 'pointer', 'pointer']],
  'PGO_FinalizaFuncao': ['int', ['int', 'pointer']],
  'PGO_VerificaPinPad': ['int', []]
});

class PaygoRealAdapter {
  async autorizar(dados) {
    // Verificar PinPad
    const pinpadPresente = paygo.PGO_VerificaPinPad();
    if (pinpadPresente !== 0) {
      throw new Error('PinPad não encontrado');
    }
    
    // Iniciar transação
    const buffer = Buffer.alloc(1024);
    const resultado = paygo.PGO_IniciaFuncao(
      1, // Função de venda
      dados.valor_formatado,
      buffer
    );
    
    // Processar resposta
    if (resultado === 0) {
      return this._parsearResposta(buffer.toString());
    } else {
      throw new Error(`Erro PayGo: ${resultado}`);
    }
  }
  
  _parsearResposta(resposta) {
    const campos = resposta.split('\n');
    return {
      status: campos[0],
      nsu: campos[1],
      autorizacao: campos[2],
      bandeira: campos[3]
    };
  }
}
```

## Passos para Implementação

### 1. Obter SDKs

1. Entrar em contato com os adquirentes:
   - SiTef: Software Express - www.softwareexpress.com.br
   - PayGo: PayGo - www.paygo.com.br

2. Solicitar:
   - SDKs para Node.js ou DLLs nativas
   - Documentação técnica
   - Ambiente de teste/homologação
   - Credenciais de teste

### 2. Configurar Ambiente de Desenvolvimento

1. Instalar dependências:
```bash
npm install ffi-napi ref-napi
```

2. Copiar DLLs para diretório do projeto:
```
backend/services/tef/adapters/sdks/
  ├── clisitef.dll
  ├── paygo.dll
  └── README.md
```

3. Configurar variáveis de ambiente:
```env
SITEF_SDK_PATH=./backend/services/tef/adapters/sdks/clisitef.dll
PAYGO_SDK_PATH=./backend/services/tef/adapters/sdks/paygo.dll
```

### 3. Implementar Adapters Reais

1. Criar novos arquivos:
   - `backend/services/tef/adapters/sitefRealAdapter.js`
   - `backend/services/tef/adapters/paygoRealAdapter.js`

2. Implementar funções FFI conforme especificações dos adquirentes

3. Substituir stubs por adapters reais no `TefManager.js`

### 4. Testar em Ambiente de Homologação

1. Usar `tefHomologacaoService.js` para executar testes

2. Validar com todas as bandeiras suportadas

3. Registrar resultados no `tefCertificationService.js`

### 5. Obter Certificação Oficial

1. Submeter documentação aos adquirentes

2. Passar por auditoria técnica

3. Obter certificados oficiais

4. Atualizar informações no sistema

## Considerações de Segurança

### PCI-DSS

- **Não armazenar dados sensíveis:** CVV, PIN, track data
- **Criptografia:** Usar AES-256 para dados em repouso
- **Tokenização:** Implementar tokenização de dados de cartão
- **Mascaramento:** Mascarar dados em logs e exibições
- **Logs imutáveis:** Usar hash de integridade

### Boas Práticas

- **Validação:** Validar todos os dados antes de enviar ao SDK
- **Tratamento de erros:** Tratar todos os códigos de erro
- **Timeout:** Implementar timeout para chamadas ao SDK
- **Retry:** Implementar retry com backoff para falhas transitórias
- **Circuit Breaker:** Implementar circuit breaker para proteção

## Exemplo de Implementação Completa

```javascript
const ffi = require('ffi-napi');
const ref = require('ref-napi');
const cryptoService = require('../../crypto/cryptoService');
const DataMaskingService = require('../../crypto/dataMaskingService');

class SitefRealAdapter {
  constructor() {
    this.clisitef = null;
    this.configurado = false;
  }
  
  async inicializar(config) {
    try {
      this.clisitef = ffi.Library(config.sdk_path, {
        'ConfiguraIntegracao': ['int', ['string', 'string', 'string', 'string', 'string']],
        'IniciaFuncaoSiTefInterativo': ['int', ['int', 'string', 'pointer']],
        'ContinuaFuncaoSiTefInterativo': ['int', ['pointer', 'pointer', 'pointer', 'pointer']],
        'FinalizaFuncaoSiTefInterativo': ['int', ['int', 'pointer']],
        'VerificaPresencaPinPad': ['int', []]
      });
      
      // Configurar integração
      const resultado = this.clisitef.ConfiguraIntegracao(
        config.terminal_id,
        config.filial_id,
        config.operador_id,
        config.parametros,
        config.rede
      );
      
      if (resultado === 0) {
        this.configurado = true;
        return true;
      } else {
        throw new Error(`Erro ao configurar SiTef: ${resultado}`);
      }
    } catch (error) {
      console.error('Erro ao inicializar SiTef:', error);
      throw error;
    }
  }
  
  async verificarPinPad() {
    if (!this.clisitef) {
      throw new Error('SiTef não inicializado');
    }
    
    const resultado = this.clisitef.VerificaPresencaPinPad();
    return resultado === 0;
  }
  
  async autorizar(dados) {
    if (!this.configurado) {
      throw new Error('SiTef não configurado');
    }
    
    try {
      // Validar dados
      this._validarDados(dados);
      
      // Verificar PinPad
      const pinpadPresente = await this.verificarPinPad();
      if (!pinpadPresente) {
        throw new Error('PinPad não encontrado');
      }
      
      // Formatar valor
      const valorFormatado = this._formatarValor(dados.valor);
      
      // Iniciar transação
      const buffer = Buffer.alloc(2048);
      const resultado = this.clisitef.IniciaFuncaoSiTefInterativo(
        1, // Função de venda
        valorFormatado,
        buffer
      );
      
      // Processar resposta
      if (resultado === 0) {
        const resposta = this._parsearResposta(buffer.toString());
        
        // Mascarar dados sensíveis
        const respostaMascarada = DataMaskingService.mascararObjeto(resposta);
        
        return {
          status: resposta.status === 'OK' ? 'aprovado' : 'negado',
          nsu: resposta.nsu,
          autorizacao: resposta.autorizacao,
          bandeira: resposta.bandeira,
          dados_mascarados: respostaMascarada
        };
      } else {
        throw new Error(`Erro SiTef: ${resultado}`);
      }
    } catch (error) {
      console.error('Erro na autorização SiTef:', error);
      throw error;
    }
  }
  
  async cancelar(dados) {
    if (!this.configurado) {
      throw new Error('SiTef não configurado');
    }
    
    try {
      const buffer = Buffer.alloc(2048);
      const resultado = this.clisitef.IniciaFuncaoSiTefInterativo(
        2, // Função de cancelamento
        dados.nsu,
        buffer
      );
      
      if (resultado === 0) {
        const resposta = this._parsearResposta(buffer.toString());
        return {
          status: resposta.status === 'OK' ? 'cancelado' : 'erro',
          nsu: resposta.nsu
        };
      } else {
        throw new Error(`Erro SiTef: ${resultado}`);
      }
    } catch (error) {
      console.error('Erro no cancelamento SiTef:', error);
      throw error;
    }
  }
  
  _validarDados(dados) {
    if (!dados.valor || dados.valor <= 0) {
      throw new Error('Valor inválido');
    }
    
    if (!dados.tipo || !['debito', 'credito'].includes(dados.tipo)) {
      throw new Error('Tipo de pagamento inválido');
    }
  }
  
  _formatarValor(valor) {
    return Math.round(Number(valor) * 100).toString().padStart(10, '0');
  }
  
  _parsearResposta(resposta) {
    const campos = resposta.split('\n').filter(c => c.trim());
    return {
      status: campos[0] || '',
      nsu: campos[1] || '',
      autorizacao: campos[2] || '',
      bandeira: campos[3] || ''
    };
  }
  
  _detectarBandeira(dados) {
    if (dados.bandeira) return dados.bandeira;
    return 'Visa';
  }
  
  _obterBandeirasSuportadas() {
    return ['Visa', 'Mastercard', 'Elo', 'Hipercard', 'American Express', 'Discover', 'JCB', 'Diners Club', 'Aura'];
  }
}

module.exports = SitefRealAdapter;
```

## Suporte

Para dúvidas sobre integração:
- SiTef: Software Express - suporte@softwareexpress.com.br
- PayGo: PayGo - suporte@paygo.com.br
