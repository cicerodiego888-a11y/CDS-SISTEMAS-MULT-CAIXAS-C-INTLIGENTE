# MRT-50.69 — CRT real débito R$ 1,00 (única tentativa)

**Classificação: `INCONCLUSIVA`**

Gerado em 2026-11-07T21:01:22Z. Confirmação explícita do usuário recebida. Uma única `TX_START` CRT débito R$1,00 foi enviada ao caminho nativo. Sem retry. Gate OFF e NativeHost encerrado após o resultado.

Diretório: `docs/homologacao/tef/MRT-50.69-20261107T204400Z`

## Resultado da única CRT

| Campo | Valor |
| --- | --- |
| transactionId | `mrt69_6d7712cbd568da8f` |
| Entrada CRT | `transacao_valor=1.00;transacao_tipo_cartao=Débito;transacao_pagamento=A vista` |
| Modalidade | débito (`cartao_debito`) |
| Valor | R$ 1,00 (100 centavos) |
| Operação Host | `TX_START` / `CRT` |
| `naoExecutada` | `false` (chamada financeira ocorreu) |
| Código Destaxa | **`05`** — Dados coletados insuficientes ou inválidos |
| Estado | `ERROR` |
| financialState | `UNKNOWN` |
| Continuação 99 | não solicitada (`requerContinuacao=false`) |
| `TX_CONTINUE` / `TX_FINALIZE` | **não** chamados |
| Retry | **não** (proibido; não realizado) |

## Comunicação com Gertec PPC-930 / PinPad

| Evidência | Observado |
| --- | --- |
| COM4 Windows (PPC-920/930) | Presente no pré-voo e na revalidação |
| `porta_com=COM4` | Confirmado (leitura RO prévia) |
| DISPLAY / COLETA / OPCAO (ação 99) | **Nenhum** — Client não pediu continuidade |
| Interação PinPad registrada no ciclo | **Não** (`pinpadEvidencia=false`) |
| Tempo da `TX_START` nativa | ~695 ms (`nativa.inicio` → `nativa.fim`) |

Interpretação: a DLL/Client retornou `05` sem abrir ciclo de coleta no PinPad. Não houve handshake DISPLAY/COLETA observável nesta tentativa. Comunicação serial efetiva continua mediada pelo V$Pague (60603/60906, PID 44484); CDS não abriu COM4 diretamente.

## Gate financeiro

| Momento | Estado |
| --- | --- |
| Pré-execução | OFF (`0`) |
| Janela autorizada | ON às `2026-11-07T21:01:21.021Z` |
| Pós-resultado | OFF às `2026-11-07T21:01:22.233Z` (`pos-ciclo-crt`) |
| Processo após fim | `DESTAXA_REAL_TRANSACTION_ENABLED=0`, `habilitado=false` |

## NativeHost

| Campo | Valor |
| --- | --- |
| PID (sessão financeira) | `66404` |
| INIT_CLIENT | `00` / `CLIENT_INITIALIZED` |
| ENABLE_REAL | sucesso |
| Encerramento | `STOPPED`, `encerrado=true`, `forcado=false`, `adiado=false`, classificação `ENCERRAMENTO_CONTROLADO` |
| Residual após fim | **0** |

## Cadeia observada (sessão financeira)

1. Gate ON (confirmação explícita).
2. NativeHost READY + SECURITY_BOOTSTRAP.
3. LOAD → INIT_CLIENT (`00`) → ENABLE_REAL.
4. SECURITY_BOOTSTRAP com permit pontual `TX_START` + transactionId.
5. `TX_START` CRT → retorno Destaxa **`05`** (~695 ms).
6. Gate OFF imediato.
7. SHUTDOWN NativeHost → `STOPPED`.

## Tentativas de harness anteriores à CRT (sem cobrança efetiva)

Antes da CRT acima, o launcher falhou em setup (módulo de evidência, export do client, bootstrap sem permit). Nessas falhas: **nenhuma** `iniciaTransacaoDestaxa` com `naoExecutada=false` e código Destaxa de cobrança. A única CRT nativa executada foi a de `mrt69_6d7712cbd568da8f` → `05`.

## Integridade dos originais (hashes-pos)

| Artefato | Hash pós |
| --- | --- |
| Local State | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` |
| Marcador | `AE1854015EE634865EFA93FD774DDC4A6E1EC491089BF22CCFDD30A61467388C` |
| `.tef-signing-key.v1` | `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167` |
| DLL | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |

## Artefatos

- `runner-result.json` — classificação e evidências
- `runner-stdout.jsonl` / `observability.jsonl` — IPC e lifecycle
- `revalidacao-execucao.json` — pré-condições imediatamente antes do spawn
- `hashes-pre.json` / `hashes-pos.json`
- `AGUARDANDO-CONFIRMACAO.md` — estado pré-confirmação (histórico)

## Parecer

**INCONCLUSIVA.** A única CRT autorizada foi executada no caminho real (gate ON → ENABLE_REAL → `TX_START`) e o Client Destaxa respondeu `05` (“Dados coletados insuficientes ou inválidos”) sem solicitar ação 99 no PinPad. Não há evidência de DISPLAY/COLETA/OPCAO nem de aprovação/recusa de cartão. Estado financeiro `UNKNOWN`. Gate desligado e NativeHost encerrado. **Sem retry**, conforme regra da sprint.
