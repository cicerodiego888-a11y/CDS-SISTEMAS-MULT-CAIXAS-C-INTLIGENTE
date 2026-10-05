# Configuração da impressora por caixa

## Passo a passo para chegar na configuração

1. Acesse o ERP.
2. Vá para a área de gerenciamento de caixas.
3. Localize o caixa desejado na tabela.
4. Clique no botão de impressora na linha do caixa.
5. No modal que abrir, selecione a impressora do cupom.
6. Clique em Salvar.

## Local da tela

- Página: [frontend/erp/pages/caixas.html](../frontend/erp/pages/caixas.html)
- Lógica do front-end: [frontend/erp/js/caixas.js](../frontend/erp/js/caixas.js)

### Funções principais

- `configurarImpressoraCaixa(caixaId)`
- `salvarImpressoraCaixa()`

## Backend e persistência

Ao salvar, o frontend envia a configuração para a API:

- `PUT /api/caixas/:id/impressora-cupom`

Definida em:

- [backend/rotas/caixas.js](../backend/rotas/caixas.js)

Persistência:

- coluna `caixas.impressora_cupom`
- declarada em [backend/database.js](../backend/database.js)

## Fluxo de uso após salvar

A resolução da impressora é feita em:

- [frontend/shared/js/fiscalImpressao.js](../frontend/shared/js/fiscalImpressao.js)
- [frontend/shared/js/cupomPrintPolicy.js](../frontend/shared/js/cupomPrintPolicy.js)
- [electron.js](../electron.js)

Regra:

- se o caixa atual tiver impressora configurada, usa a impressora do caixa;
- se não tiver, usa o fallback legado da configuração global;
- o valor final vai para `deviceName` e entra no `webContents.print(...)` do Electron.

## Fallback antigo

A configuração global antiga permanece em:

- [backend/rotas/configuracoes.js](../backend/rotas/configuracoes.js)
- chave: `impressora_cupom`

## Resumo rápido

ERP -> Caixas -> botão da impressora -> selecionar impressora -> salvar -> API `PUT /api/caixas/:id/impressora-cupom` -> `caixas.impressora_cupom` -> runtime usa `deviceName` -> Electron imprime.
