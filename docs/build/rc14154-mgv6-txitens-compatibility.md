# RC14.15.4 — MGV6 TXITENS.TXT Compatibility V1.0

## Objetivo

Ajustar o Bridge MGV6 para gerar o arquivo operacional no padrão **TXITENS.TXT**, com **exatamente 320 caracteres por registro** (produto), encoding **WINDOWS-1252** e terminador **CRLF**.

**Status:** `IMPLEMENTADO — COMPATIBILIDADE INICIAL`  
**Não declarar:** `MGV6 homologado`.

## Regra fundamental

```
320 caracteres = CADA REGISTRO (produto)
≠ tamanho total do arquivo
```

| Produtos | Registros | Conteúdo |
|----------|-----------|----------|
| 1 | 1 × 320 | + CRLF |
| 10 | 10 × 320 | + CRLF cada |
| 101 | 101 × 320 | + CRLF cada |

Padding: espaços à direita até completar 320.  
Overflow (> 320 no conteúdo lógico): erro `MGV6_RECORD_OVERFLOW` — **sem truncar**.

## Arquivo operacional

| Antes | Depois |
|-------|--------|
| `CDS.TXT` (variável) | `TXITENS.TXT` (320/registro) |

Config antiga `fileName=CDS.TXT` é **normalizada** para `TXITENS.TXT` (não gera os dois).

Pasta continua configurável por equipamento (ex. pasta TXT do MGV6 no cliente).

## Estrutura do registro (campos comprovados)

```
TIPO_REGISTRO (2) + CODIGO (9) + PRECO (9) + DESCRICAO (...) + ESPAÇOS → 320
```

Posições comprovadas pelo Bridge (amostras):

| Campo | Início | Fim |
|-------|--------|-----|
| tipoRegistro | 0 | 2 |
| código | 2 | 11 |
| preço | 11 | 20 |
| descrição | 20 | … |
| padding | após descrição | 320 |

Prioridade do código: PLU → codigo_balanca → codigo (sem truncar).

## Fluxo

```
MGV6SyncService → MGV6FileBuilder (320) → MGV6Exporter (TXITENS.TXT) → [MGV6.exe se autoLaunch]
```

Modo `MGV6`: sem TCP / handshake / upload-plus.  
Modo `TCP`: inalterado.

## Testes

```bash
npm run test:mgv6-txitens-v1
npm run test:mgv6-v1
npm run test:mgv6-operational-v1
```

Fixtures: `tests/fixtures/mgv6/expected.TXITENS.TXT`, `expected-101.TXITENS.TXT`, `estrutura-txitens.json`.

> O `TXITENS.TXT` real do cliente **não estava disponível no disco** no momento da implementação. A fixture estrutural usa o layout de campos já comprovado + regra de 320/padding da RC. Homologação física na balança permanece pendente.

## Teste real no cliente (checklist)

1. `modo_envio = MGV6`
2. Pasta: `C:\Program Files (x86)\Toledo do Brasil\MGV6\TXT\`
3. Enviar 1 produto pesável
4. Confirmar `TXITENS.TXT`, 1 registro, 320 chars, CRLF
5. MGV6 processa → produto na balança

## Não alterado

ToledoPrixIVDriver, ConnectionManager, protocolo 90AX, PLU TCP, Discovery, Fingerprint, Monitor.
