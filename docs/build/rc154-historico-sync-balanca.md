# RC15.4 — Histórico de Sincronização com a Balança

## Objetivo

Registrar todas as sincronizações com a balança para auditoria e suporte, sem alterar o Driver Oficial nem o Motor Universal.

## Tabela

`produto_balanca_sync_log`

| Campo | Uso |
|-------|-----|
| id | PK |
| produto_id | Produto |
| equipamento_id | Equipamento |
| plu | PLU enviado |
| operacao | `ENVIAR_PRODUTO` / `ENVIAR_LOTE` / `ENVIAR_TODOS` |
| resultado | `SUCESSO` / `ERRO` |
| mensagem | ACK / timeout / erro |
| tempo_ms | Duração |
| usuario_id | Operador |
| created_at | Horário |

## Quando registra

| Ação | Operação | Ponto |
|------|----------|-------|
| Enviar Produto (cadastro) | `ENVIAR_PRODUTO` | `PluController.uploadProduto` |
| Enviar Lote / Selecionados | `ENVIAR_LOTE` | `uploadPlus` / `uploadMany` |
| Selecionar Todos + enviar | `ENVIAR_TODOS` | `uploadPlus` com `operacao` no body |

Apenas camada de controller/serviço de log — motor e driver intactos.

## API

```
GET /api/equipamentos/plu/sync-log?produto_id=&equipamento_id=&limite=50
```

## UI

- Cadastro de Produto → painel Balança Toledo → **Histórico**
- Enviar Produtos → após conclusão → **Ver Histórico**

## Teste

```
npm run test:historico-sync-balanca
```
