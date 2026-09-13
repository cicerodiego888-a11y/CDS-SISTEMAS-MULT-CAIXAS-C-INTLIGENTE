# MUC — Contrato Público Oficial (RC2.1)

**Versão do contrato:** 1.0.0  
**Versão do motor:** RC2.1  
**Tag:** `MUC_RC2.1_ENTERPRISE`  
**Status:** ARQUITETURA CONGELADA  

---

## 1. Objetivo do Motor

O **Motor Universal de Conversão (MUC)** é o único ponto oficial de conversão entre unidades de compra (apresentações comerciais) e unidades de estoque no CDS. Nenhum módulo externo deve implementar lógica própria de conversão.

## 2. Responsabilidades

| Responsabilidade | Descrição |
|------------------|-----------|
| Conversão | Transformar quantidade/custo de compra → estoque |
| Inferência | Determinar fator e tipo de conversão |
| Aprendizado | Registrar padrões fornecedor/GTIN (MIIP) |
| Auditoria | Rastrear toda conversão executada |
| Observabilidade | Métricas e exportação de dashboard |

## 3. Fluxo Oficial

```
Entrada (ConversaoDTO)
    ↓
Pipeline interno (NÃO PÚBLICO)
    ↓
Saída (ResultadoConversaoDTO)
```

Consumidores interagem **somente** com a facade `obterMuc(db)`.

## 4. Garantias

- **Stateless:** o core não mantém estado entre chamadas.
- **Imutabilidade:** todos os DTOs públicos são `Object.freeze`.
- **Rastreabilidade:** `correlationId`, `hashConversao`, auditoria.
- **Compatibilidade retroativa:** RC1 funcional preservado em RC2.x.
- **Estabilidade:** componentes internos podem evoluir sem quebrar integrações.

## 5. APIs Públicas (exclusivas)

Somente estes métodos são contrato oficial. Novas APIs exigem revisão arquitetural.

### `muc.converter(input, opcoes?)`

Executa conversão via pipeline oficial.

- **Entrada:** objeto compatível com `ConversaoDTO`
- **Saída:** `ResultadoConversaoDTO`
- **Opções:** `correlationId`, `fornecedorCnpj`, `gtin`, `usarCache`

### `muc.processarItemCompra(item, produto, opcoes?, callback?)`

Processa item de compra com resolução de apresentação, auditoria e aprendizado.

- **Saída:** `ResultadoConversaoDTO`

### `muc.simular({ quantidadeCompra, quantidadePorApresentacao, valorTotal })`

Simulação sem persistência.

- **Saída:** `ResultadoConversaoDTO`

### `muc.buscarApresentacao(criterio, callback)`

Busca apresentação comercial.

- **Critério:** `{ apresentacaoId }` ou `{ produtoId, gtin?, codigoFornecedor?, fornecedorCnpj? }`
- **Saída:** `ProdutoApresentacaoDTO | null`

### `muc.aprender(dados, callback?)`

Registra aprendizado MIIP.

- **Dados:** `{ produtoId, apresentacaoId?, fornecedorCnpj, gtin?, codigoFornecedor?, tipoApresentacao, fatorConversao, tipoConversao, confianca?, descricao? }`

### `muc.exportarMetricas(formato?)`

Exporta métricas (`'json'` default | `'markdown'`).

### `muc.obterVersao()`

Retorna objeto imutável com versão, status, tag e versões de contrato/eventos.

## 6. DTOs Públicos (contratos oficiais)

| DTO | Factory | Uso |
|-----|---------|-----|
| `ConversaoDTO` | `criarConversaoDTO(raw)` | Entrada de conversão |
| `ResultadoConversaoDTO` | `criarResultadoConversaoDTO(dados)` | Saída de conversão |
| `ProdutoApresentacaoDTO` | `criarProdutoApresentacaoDTO(row)` | Apresentação comercial |
| `RegraConversaoDTO` | `criarRegraConversaoDTO(tipoConversao)` | Metadados de regra |

Helpers: `resultadoParaJson()`, `resultadoFromJson()`.

**Proibido** acessar objetos internos do pipeline (`ctx`, `inferido`, `calculado`).

## 7. Eventos Oficiais (v1.0.0)

Envelope padrão:

```json
{
  "tipo": "MUC_CONVERSAO_EXECUTADA",
  "timestamp": "ISO-8601",
  "correlationId": "hex",
  "payload": { }
}
```

| Evento | Payload mínimo |
|--------|----------------|
| `MUC_CONVERSAO_EXECUTADA` | `produtoId`, `tipoConversao`, `quantidadeEstoque`, `confianca` |
| `MUC_CONVERSAO_CONFIRMADA` | `produtoId`, `correlationId` |
| `MUC_CONVERSAO_MANUAL` | idem EXECUTADA |
| `MUC_APRESENTACAO_APRENDIDA` | `produtoId`, `apresentacaoId` |
| `MUC_ERRO` | `message` |
| `MUC_INFERENCIA_FALHOU` | `erro` |

Campos obrigatórios do envelope: `tipo`, `timestamp`, `correlationId`, `payload`.

## 8. Componentes Internos (NÃO PÚBLICOS)

Alteráveis em qualquer RC futuro. **Importação proibida** por módulos externos.

| Caminho | Conteúdo |
|---------|----------|
| `backend/motores/muc/core/` | Parser, validação, inferência, cálculo |
| `backend/motores/muc/pipeline/` | Orquestração PipelineMuc |
| `backend/motores/muc/repositorios/` | Acesso a dados |
| `backend/motores/muc/cache/` | MotorCacheConversao |
| `backend/motores/muc/auditoria/` | Persistência auditoria |
| `backend/motores/muc/aprendizado/` | MotorAprendizado (interno) |
| `backend/motores/muc/eventos/` | BarramentoEventos (interno) |
| `backend/motores/muc/observabilidade/` | MucMetricas (interno) |

## 9. Política de Importação

### ✅ Permitido

```javascript
const { obterMuc, criarResultadoConversaoDTO } = require('./motores/muc');
// ou entrypoint explícito:
const MUC = require('./motores/muc/public');
```

### ❌ Proibido (módulos externos)

```javascript
require('./motores/muc/core/MotorConversao');
require('./motores/muc/pipeline/PipelineMuc');
require('./motores/muc/core/ParserApresentacoes');
require('./motores/muc/core/MotorInferencia');
require('./motores/muc/repositorios/...');
```

Exceção: testes internos em `tests/muc/` e bootstrap em `database.js` (`garantirSchemaMuc`).

## 10. Versionamento

| Tipo de mudança | Impacto na versão |
|-----------------|-------------------|
| Mudança interna (pipeline, core) | Sem alteração da versão pública |
| Mudança em DTO público | **Major** (ex: RC2 → RC3) |
| Mudança em método público existente | **Major** |
| Novo método público | **Minor** (ex: RC2.1 → RC2.2) |
| Correção interna / patch | **Patch** (ex: RC2.1.1) |

Sequência: `RC2.0` → `RC2.1` → `RC2.2` → `RC3.0`

## 11. Compatibilidade

- RC2.1 é **100% compatível** com integrações RC2.0 e RC1 funcional.
- Campos RC1 (`hash`) permanecem como alias.
- Métodos legados (`simularConversao`, `validarDistribuicao`) existem mas **não fazem parte** do contrato público.

## 12. Lifecycle

| Fase | Versão | Status |
|------|--------|--------|
| RC1 | RC1 | Congelado funcional |
| RC2 | RC2 | Enterprise certificado |
| RC2.1 | RC2.1 | **Arquitetura congelada** |
| RC3+ | — | Requer RFC arquitetural |

## 13. Entrada oficial recomendada

```javascript
const { obterMuc } = require('../motores/muc');
const muc = obterMuc(db);

const resultado = muc.converter({
  produtoId: 1,
  item: { quantidade_embalagens: 10, quantidade_por_embalagem: 12, valor_total_embalagem: 400 }
}, { correlationId: 'req-001' });

console.log(muc.obterVersao());
```

---

**Assinatura:** CDS Arquitetura — MUC RC2.1 Enterprise — 2026-07-31
