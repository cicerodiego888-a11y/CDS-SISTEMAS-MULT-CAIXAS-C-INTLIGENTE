# Contratos Oficiais — Motor Equipamentos (Sprint 7)

Padronização de toda a comunicação interna do Motor Equipamentos.

## Princípios

- **Nenhum Driver** recebe objetos do banco de dados
- **Nenhum Driver** conhece Controllers ou SQLite
- **Toda comunicação** utiliza DTOs oficiais desta pasta
- **Regras de negócio** ficam em DTOs, Validadores e Normalizadores — **não nos Drivers**

## Estrutura

```
contracts/
├── ProdutoDTO.js          ← Contrato de produto
├── PromocaoDTO.js         ← Contrato de promoção
├── DepartamentoDTO.js     ← Contrato de departamento
├── EtiquetaDTO.js         ← Contrato de etiqueta
├── PesoDTO.js             ← Contrato de leitura de peso
├── StatusDTO.js           ← Contrato de status do equipamento
├── DiagnosticoDTO.js      ← Contrato de diagnóstico
├── EquipamentoDTO.js      ← Contrato de configuração de equipamento
├── ProdutoValidator.js    ← Validação de produto
├── PromocaoValidator.js     ← Validação de promoção
├── DepartamentoValidator.js ← Validação de departamento
├── EtiquetaValidator.js     ← Validação de etiqueta
├── ProdutoNormalizer.js     ← Normalização de produto
├── DepartamentoNormalizer.js← Normalização de departamento
├── EtiquetaNormalizer.js    ← Normalização de etiqueta
├── Serializer.js            ← Serialização genérica / por fabricante (stub)
├── ResponseFactory.js       ← Respostas padronizadas do motor
├── validationResult.js      ← Helper de resultado de validação
└── index.js                 ← Barrel export
```

A pasta `dto/` mantém re-exports de compatibilidade apontando para `contracts/`.

---

## Fluxo dos DTOs

Os DTOs são objetos de transporte **independentes do ERP e do SQLite**.

1. **Mapper ERP** (`services/ProdutoMapper`, etc.) converte entidade do ERP em DTO
2. O DTO carrega apenas campos do contrato (`plu`, `descricao`, `preco`, …)
3. `toJSON()` serializa para a fila sem métodos nem campos de banco (`id` do SQLite não trafega)
4. `fromJSON()` reidrata o DTO a partir do payload da fila

```javascript
const { ProdutoDTO } = require('./contracts');
const dto = new ProdutoDTO({ plu: 100, descricao: 'Banana', preco: 4.99 });
const plain = dto.toJSON();
const restaurado = ProdutoDTO.fromJSON(plain);
```

---

## Fluxo dos Validadores

Validadores concentram **regras de negócio** antes do envio ao driver.

1. Recebem instância de DTO ou objeto plano
2. Retornam `{ valido: boolean, erros: string[] }`
3. DTOs delegam `validar()` ao Validador correspondente
4. SyncManager cancela sincronização se `valido === false`
5. Drivers podem aplicar apenas regras **específicas do fabricante** (ex.: limites PLU Toledo)

```javascript
const { ProdutoValidator } = require('./contracts');
const resultado = ProdutoValidator.validar({ plu: 1, descricao: 'X', preco: -1 });
// { valido: false, erros: ['Preço inválido'] }
```

---

## Fluxo dos Normalizadores

Normalizadores preparam dados **após validação** e **antes da serialização**.

1. Recebem DTO validado
2. Aplicam formatação (trim, truncar descrição, arredondar preço, lowercase de unidade)
3. Retornam novo DTO normalizado
4. Driver Mapper usa DTO já normalizado para converter ao formato do fabricante

```javascript
const { ProdutoNormalizer } = require('./contracts');
const normalizado = ProdutoNormalizer.normalizar(dto);
// descricaoReduzida truncada em 22 chars, preco com 2 casas
```

---

## Fluxo do Serializer

O Serializer transforma DTOs em formatos de saída.

| Método | Uso |
|--------|-----|
| `serialize(dto)` | JSON genérico (implementado) |
| `serializeForFabricante(dto, fabricante)` | Formato vendor (stub nesta sprint) |
| `rehydratar(tipo, plain)` | Restaura DTO da fila |
| `identificarTipo(dto)` | Detecta tipo do DTO |

Nesta sprint **não há serialização específica por fabricante** — apenas estrutura preparada.

---

## Fluxo da ResponseFactory

Padroniza **todas as respostas** do Motor Equipamentos (espelha `tefContrato.js`).

| Função | Uso |
|--------|-----|
| `sucesso({ mensagem, dados, tipo })` | Operação bem-sucedida |
| `erro({ mensagem, erros, codigo })` | Falha ou cancelamento |
| `aviso({ mensagem, dados })` | Sucesso com alerta |
| `diagnostico({ componentes, simulado })` | Relatório de diagnóstico |
| `status({ online, conectado })` | Status do equipamento |
| `paraRespostaApi(retorno)` | Converte `sucesso` → `success` para HTTP |

O `SyncManager` já utiliza `ResponseFactory` para enfileiramento, cancelamento e erros.

---

## Diagrama completo

```
┌─────────────┐
│ Produto ERP │  (entidade do banco — NUNCA chega ao Driver)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Mapper    │  services/ProdutoMapper.toDTO()
└──────┬──────┘
       │
       ▼
┌─────────────┐
│     DTO     │  contracts/ProdutoDTO
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Validador  │  contracts/ProdutoValidator
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Normalizador│  contracts/ProdutoNormalizer
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Serializer  │  contracts/Serializer
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Driver    │  drivers/toledo/.../ToledoPrix4UnoDriver
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Equipamento │  Balança física (sprint futura)
└─────────────┘
```

---

## Testes

```bash
npm run test:equipamentos-contracts
npm run test:equipamentos-sync
npm run test:equipamentos-drivers
npm run test:equipamentos-toledo-prix4
```

## Import recomendado

```javascript
const {
  ProdutoDTO,
  ProdutoValidator,
  ProdutoNormalizer,
  Serializer,
  ResponseFactory
} = require('./contracts');
```
