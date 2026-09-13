# RC15.3 — Envio Individual para Balança no Cadastro do Produto

## Objetivo

Permitir envio imediato de um único produto pesável à balança a partir do cadastro, reutilizando o Motor Universal (sem lógica nova de protocolo / sem alterar o Driver Oficial).

## Localização

Cadastro de Produtos → card **Configurações** (Produto Pesável) → painel **Balança Toledo**.

## Visibilidade do botão

Exibido somente quando:

- Produto salvo (com `id`)
- Ativo
- Pesável (`produto_fracionado`)
- PLU válido (1–10 dígitos)

Oculto para unidade, serviços e combos.

## API

```
POST /api/equipamentos/{id}/upload-produto
Body: { "produtoId": 125 }
```

Backend carrega o produto no banco (nunca confia no payload do front), valida e chama:

```
ToledoPluEngine.uploadOne(produto)
  → UploadPluOperation
  → ToledoPluBuilder
  → Driver Oficial
  → Balança
```

Consulta de última sync:

```
GET /api/equipamentos/plu/ultima-sync?produto_id=125
```

## Fluxo do operador

1. Alterar preço  
2. Salvar (modal permanece aberto se elegível)  
3. Enviar para Balança  
4. Feedback: ⏳ → ✅ / ❌  
5. Atualiza última sincronização e resultado **🟢 Sincronizado**

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `PluController.js` | `uploadProduto`, `ultimaSync`, `carregarProdutoPorId` |
| `ToledoPluEngine.js` | `uploadOne` (alias de `upload`) |
| `ToledoPluRepository.js` | `ultimaConfirmada` |
| `equipamentos.js` (rotas) | `POST /:id/upload-produto`, `GET /plu/ultima-sync` |
| `produtos.js` | Painel UI + envio |

## Teste

```
npm run test:upload-produto-cadastro
```
