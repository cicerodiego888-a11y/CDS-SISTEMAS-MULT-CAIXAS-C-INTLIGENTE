# RC14.15.3 — Integração Operacional MGV6 V1.0

## Objetivo

Conectar a ação operacional **Enviar Selecionados** (e o envio individual do cadastro de produtos) ao Bridge MGV6 da RC14.15.1 quando o equipamento estiver configurado explicitamente com `modo_envio = MGV6`, mantendo o pipeline TCP intacto quando `modo_envio = TCP`.

**Status:** `IMPLEMENTADO — INTEGRAÇÃO OPERACIONAL V1.0`  
**Não declarar:** `MGV6 HOMOLOGADO`.

## Arquitetura

```
                    EQUIPAMENTO
                         │
                 ┌───────┴───────┐
                 │               │
             TCP MODE         MGV6 MODE
                 │               │
                 ▼               ▼
          ToledoPluEngine   MGV6SyncService
                 │               │
          Driver Toledo      FileBuilder
                 │               │
          ConnectionManager   Exporter
                 │               │
              TCP 9000        CDS.TXT
                 │               │
             Balança          MGV6.exe
                                 │
                              Balança
```

Um equipamento = um modo por vez. Pipelines mutuamente exclusivos.

## Configuração — `modo_envio`

Autoridade única em `equipamentos_configuracoes`:

| Chave | Valores | Default |
|-------|---------|---------|
| `modo_envio` | `TCP` \| `MGV6` | `TCP` (se ausente) |

Configuração de pasta/arquivo/encoding permanece em `mgv6.config` (RC14.15.1).  
Ao salvar o modo, a flag legado `enabled` em `mgv6.config` é sincronizada (não é segunda autoridade).

**Não migrar** equipamentos existentes automaticamente para MGV6.

## UI

### Cadastro da balança

Seção **Método de Envio**:

- ( ) TCP Oficial — comunicação direta via Driver Toledo
- ( ) MGV6 / Compatibilidade Toledo — exportação TXT → MGV6.exe

Quando MGV6: pasta, arquivo, encoding, terminador, modo variável, dígitos PLU, prefixo, autoLaunch, caminho do EXE.

Driver permanece distinto do método (ex.: Driver = Toledo Prix IV Uno; Método = MGV6; Transporte = Arquivo / MGV6).

### Enviar Produtos para Balança

`epbEnviarSelecionados()`:

1. Lê `modo_envio`
2. Se `MGV6` → `epbEnviarSelecionadosMGV6()` → `POST /api/equipamentos/mgv6/export`
3. Se `TCP` → `epbEnviarSelecionadosTCP()` → connect + `POST /:id/upload-plus`

No modo MGV6: sem connect, sem handshake, sem ACK na UI; log de exportação TXT.

### produtos.js

`enviarProdutoParaBalancaPorId` respeita o mesmo modo (MGV6 → export; TCP → upload-produto).

## Endpoints e bloqueios

| Endpoint | Comportamento |
|----------|---------------|
| `POST /api/equipamentos/:id/upload-plus` | Se `modo_envio=MGV6` → **409** `MODO_ENVIO_MGV6` **antes** de ConnectionManager |
| `POST /api/equipamentos/:id/upload-produto` | Idem |
| `POST /api/equipamentos/mgv6/export` | Se `modo_envio=TCP` → **409** `MODO_ENVIO_TCP` |
| `POST /api/equipamentos/mgv6/export-all` | Idem (via SyncService) |
| `GET/PUT .../mgv6/config/:id` | Expõe/salva `modo_envio` |

## Segurança

Reutiliza validadores RC14.15.1 (path traversal, pasta, permissão, EXE, nome de arquivo).  
Launcher: `shell:false`. UI não monta TXT.

## Testes

```bash
npm run test:mgv6-operational-v1
npm run test:mgv6-v1
npm run test:driver-identity
npm run test:driver-adapter
npm run test:connection-unification
npm run test:protocol-unification
npm run test:certification-v2
```

## Troubleshooting

| Sintoma | Ação |
|---------|------|
| Envio ainda tenta handshake | Conferir `modo_envio` no cadastro da balança (deve ser MGV6) e salvar config |
| `MODO_ENVIO_MGV6` no upload-plus | Equipamento em MGV6 — use a tela operacional ou `/mgv6/export` |
| `MODO_ENVIO_TCP` no export | Equipamento em TCP — não misturar pipelines |
| Pasta não encontrada | Configurar pasta absoluta existente e gravável |
| EXE não inicia | Só obrigatório se `autoLaunch=true`; default é `false` |

## Não alterado

ToledoPrixIVDriver, ConnectionManager, handshake 90AX, DriverRegistry, DriverIdentityResolver, DriverAdapter, OfficialDriverLoader.  
MGV6 continua Bridge — **não** é Driver.
