# RC14.15.5 — MGV6 TXITENS.TXT — Aderência ao Arquivo Real do Cliente V1.0

## Objetivo

Corrigir/validar o Bridge MGV6 para gerar `TXITENS.TXT` **exatamente** de acordo com o arquivo real do cliente (`TXITENS(1).TXT`).

**Status:** `IMPLEMENTADA — TXITENS.TXT REAL CLIENT COMPATIBILITY V1.0`  
**Declaração:** MGV6 — **compatibilidade baseada em arquivo real do cliente**  
**Não declarar:** MGV6 homologado.

## Arquivo de referência

Registro lógico comprovado:

```text
01000000099000299000TESTE CDS SISTEMAS
```

+ espaços até 320 caracteres + `CRLF`.

Produto golden:

| Campo | Valor |
|-------|--------|
| Código / PLU | 99 → `000000099` |
| Nome | TESTE CDS SISTEMAS |
| Campo numérico 11–19 | `000299000` (R$ 2,99 em centavos no layout comprovado) |

Fixture oficial:

`tests/fixtures/mgv6/real-client/TXITENS.TXT`

## Estrutura física

| Posição | Campo | Tamanho | Exemplo |
|---------|-------|---------|---------|
| 0–1 | Tipo registro | 2 | `01` |
| 2–10 | Código | 9 | `000000099` |
| 11–19 | Campo numérico MGV6 | 9 | `000299000` |
| 20–319 | Descrição + padding | 300 | `TESTE CDS SISTEMAS` + espaços |

- Registro = **exatamente 320** caracteres
- CRLF **não** entra nos 320
- Encoding: **WINDOWS-1252**
- Arquivo operacional: **TXITENS.TXT** (`CDS.TXT` legado → normalizado)
- Layout ID: **`MGV6-REAL-CLIENT-V1`**

## Campo numérico 11–19

Função centralizada: `formatarCampoNumericoMgv6()`.

Nesta instalação, o fixture real comprova a forma `0` + centavos(5) + `000` para o produto de teste (2,99 → `000299000`).  
O significado semântico completo para outros produtos deve ser confirmado com arquivos reais adicionais — **não inferir nesta RC**.

## Descrição

- Inicia na posição **20**
- Sem delimitadores artificiais
- Área máxima **300** caracteres
- Overflow → `MGV6_DESCRIPTION_OVERFLOW` (sem truncar)
- Padding somente com **espaços** (nunca zeros)

## Tamanho final

`record.length === 320` obrigatório.  
Caso contrário → `MGV6_RECORD_SIZE_INVALID`.

## Pipeline

```
modo_envio = MGV6
  → MGV6SyncService → MGV6FileBuilder → MGV6Exporter → TXITENS.TXT
  → (opcional) MGV6.exe

modo_envio = TCP
  → pipeline Toledo TCP (inalterado)
```

Proibido em MGV6: `/connect`, `/upload-plus`, handshake, ConnectionManager, Driver Toledo.

## Testes

```bash
npm run test:mgv6-txitens-real-v1
npm run test:mgv6-txitens-v1
npm run test:mgv6-operational-v1
npm run test:mgv6-v1
```

O teste golden compara **byte a byte** o buffer gerado com `real-client/TXITENS.TXT`.

## Limitações

- Homologação física na balança via MGV6.exe permanece pendente
- Semântica completa do campo 11–19 depende de mais amostras reais
- `TXITENS(1).TXT` original não estava no disco no momento da RC; a fixture foi gerada a partir do conteúdo real fornecido na especificação e validada pelo builder

## Não alterado

ToledoPrixIVDriver, ConnectionManager, protocolo 90AX, PLU TCP, Discovery, Fingerprint, Monitor.
