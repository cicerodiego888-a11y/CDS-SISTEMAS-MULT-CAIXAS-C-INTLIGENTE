# RC15.1 — Tela Simples de Envio de Produtos para Balança

## Objetivo

Tela mínima para envio de PLUs à Toledo Prix IV Uno, usando exclusivamente o Motor Universal.

## Menu

Administração → **Toledo Prix IV** → **Enviar Produtos**  
(`data-page="enviar-produtos-balanca"`)

## API

```
POST /api/equipamentos/{id}/upload-plus
Body: { "plus": [1001, 1002, 1003] }
```

Fluxo:

```
UI → PluController.uploadPlus → ToledoPluEngine.uploadMany
   → UploadPluOperation → ToledoPluBuilder → Driver → Balança
```

Sem lógica nova no motor. Sem alteração no Driver Oficial.

## UI

- Seleção de equipamento Toledo
- Status de conexão
- Busca / seleção múltipla / selecionar todos
- Progresso + log em tempo real
- Envio sequencial (um PLU por chamada) para feedback ao vivo

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `PluController.js` | `uploadPlus` (cola) |
| `rotas/equipamentos.js` | rota `/:id/upload-plus` |
| `enviar-produtos-balanca.js` | tela |
| `index.html` / `app.js` | menu + router |

## RC15.2 — Somente produtos pesáveis

Filtro fixo na tela: **Produtos Pesáveis**.

Elegível no CDS quando:

- `produto_fracionado = 1` / `vendido_por_peso = 1` / `produto_pesavel = 1`
- ou `tipo_comercializacao = PESO` / `permite_balanca = true`

Excluídos: unidade, serviços, combos, inativos (`ativo = 0`).

Busca e seleção operam só sobre essa lista.  
`upload-plus` também restringe no SQL (`produto_fracionado = 1` e ativo).

## Testes

```bash
npm run test:enviar-produtos-balanca
```
