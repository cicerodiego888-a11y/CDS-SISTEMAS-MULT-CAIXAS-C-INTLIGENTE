# MRT-50.72 — Investigação controlada de `transacao_tipo_cartao`

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED=0` |
| NativeHost / DLL / TX / V$Pague | **Não executados** |
| Protocolo de produção | **Não alterado** |
| Estados UNKNOWN históricos | **Preservados** |
| Dependência | MRT-50.69 (`05`) + log V$Pague 18:01:22 + MRT-50.71 |

---

## 1. Classificação

### `INCOMPATIBILIDADE PROVÁVEL`

Não classificado como **CAUSA IDENTIFICADA** definitiva: a rejeição do Client está comprovada, e a divergência documental `Débito` (docs/06 + CDS) × `Debito` (examples oficiais + docs/07) é comprovada, mas a **aceitação** de `Debito` pelo V$Pague **não** foi verificada (TX proibida nesta sprint).

Não classificado como corrigido.

---

## 2. Evidência operacional (já existente — MRT-50.69 / log)

`C:\VBI\V$Pague\Client\logs\vspague-client.log` @ `2026-11-07 18:01:22`:

1. `servico:iniciar` com `aplicacao:CDS Sistemas` / `versao:1.0.3` → aceito.
2. `servico:executar` com `tipoCartao:Débito`, `valor:1.00`, `pagamento:A vista` → Client registra o valor **com acento**.
3. Erro: `Tag <transacao_tipo_cartao> inexistente ou seu conteudo é inválido`.
4. `retorno:5` → alinhado ao `05` da DLL / CDS.

Interpretação técnica: o valor **chegou** ao Client (não é tag ausente por truncamento óbvio); a falha reportada é de **conteúdo inválido** (ou mensagem genérica que também cobre inexistência). Encoding latin1 `0xE9` → `é` é **compatível** com a aparição de `Débito` no log Java.

---

## 3. Origem do valor no CDS

| Etapa | Arquivo | Comportamento |
|---|---|---|
| PDV → CRT | `destaxaProtocolo.js` `mapearTipoCartaoCrt` | `cartao_debito` → `TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO` = **`Débito`** (linhas ~111–141) |
| Montagem string | `buildCrtInput` / `buildTransactionInput` | `transacao_valor=…;transacao_tipo_cartao=Débito;transacao_pagamento=A vista` |
| Constante doc | `destaxaConstantes.js` `CAMPOS_ENTRADA_CRT_DOCUMENTADOS` | `Débito \| Credito` |
| Homologação 50.69 | `mrt-50-69-runner.js` | Mesma string CRT |
| Allowlist | `valorCampoCrtDocumentado` | Aceita só `Débito` / `Credito`; **`Debito` ASCII é rejeitado** e o campo é omitido |

Nenhuma outra conversão de acentuação ocorre após o mapeamento: o literal Unicode `Débito` segue até o buffer.

---

## 4. Encoding, buffer e tamanho

| Item | Evidência | Status |
|---|---|---|
| Encoding CDS | `ENCODING_DESTAXA = 'latin1'` (`destaxaConstantes.js`) | COMPROVADO |
| Doc DLL 04 | `char*` = bytes 0–255 “conforme tabela ASCII” | COMPROVADO (texto oficial; não especifica ISO-8859-1 vs UTF-8) |
| Buffer TX | `DestaxaNativeBridge.montarBufferEntrada`: `Buffer.from(texto,'latin1')` + 1 NUL; `tamanho` = bytes **sem** NUL | COMPROVADO |
| CRT 50.69 | 77 bytes latin1; `é` = `0xE9` (não UTF-8 `C3 A9`) | COMPROVADO (50.70 + teste 50.72) |
| `tamanho_entrada` doc Credito | exemplo docs/06 = 81; bate com latin1/UTF-8 ASCII | COMPROVADO |
| Truncamento do CRT | 77 bytes cabem; log mostra `Débito` completo | **Improvável** como causa |

Diferença `Débito` × `Debito` em latin1: **mesmo comprimento** (77); diferem só no byte `0xE9` vs `0x65`.

---

## 5. Contrato documental × exemplos oficiais Destaxa 1.83

| Fonte | Literal débito |
|---|---|
| `docs/06-api-iniciatransacaodestaxa.md` | **`Débito`** (com acento) |
| `docs/07` exemplo `opcao` | **`Debito\|Credito`** (sem acento em Debito) |
| `examples/java/.../App.java` `doDebit` | **`transacao_tipo_cartao=Debito`** |
| `examples/dotnet/Program.cs` `DoDebit` | **`transacao_tipo_cartao=Debito`** |
| `examples/clang` | só Credito nos trechos localizados |
| CDS produção | **`Débito`** (seguiu docs/06) |

CDS alinhou-se à **documentação narrativa** (06), não aos **exemplos de código** oficiais.

---

## 6. Tratamento do retorno `05`

| Camada | Comportamento |
|---|---|
| Doc 09 / `CODIGOS_RESULTADO['05']` | “Dados coletados insuficientes ou invalidos” |
| `classificarCodigoTransacao` | `05` → classificação `ERROR`, estado protocolo `ERROR` |
| `tefFinancialSafetyPolicy.classificarCodigoFinanceiro` | códigos não-00/03/04/09/99/08/A0/A1 → **`financialState=UNKNOWN`**, `retryAllowed=false` |
| Ciclo CRT 50.69 | `requerContinuacao=false`; sem CONTINUE; UNKNOWN preservado |

Origem técnica do `05` na 50.69: Client automation devolveu `retorno:5` com mensagem de `transacao_tipo_cartao`; DLL expôs `05` à AC. **Não** é código desconhecido; o mapeamento UNKNOWN é política financeira conservadora (não prova PinPad).

---

## 7. Hipóteses

| ID | Hipótese | Avaliação |
|---|---|---|
| H1 | Truncamento / tamanho errado do buffer CRT | **Refutada** para o cenário 50.69 (77 bytes; log completo) |
| H2 | UTF-8 enviado com tamanho latin1 | **Refutada** no caminho CDS (`montarBufferEntrada` latin1) |
| H3 | Conteúdo `Débito` rejeitado pelo validador do Client (enum ASCII `Debito`) | **PROVÁVEL** — log mostra parse + “conteudo inválido”; exemplos usam `Debito` |
| H4 | Tag realmente inexistente no contrato do Client de homologação | **POSSÍVEL** mas menos alinhada ao log (`tipoCartao:Débito` presente) |
| H5 | Encoding latin1 `0xE9` corrompe validação apesar do log | **IMPROVÁVEL** (Java exibiu `Débito`) |

---

## 8. Correção mínima proposta (NÃO implementada nesta sprint)

**Arquivo:** `backend/services/tef/destaxa/destaxaProtocolo.js`  
**Linhas:** ~111–114 (`TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO`) e impacto em `mapearTipoCartaoCrt` / allowlist.

**Mudança candidata (após confirmação Destaxa ou sprint de correção autorizada):**

1. Alterar literal de débito de `Débito` → `Debito` **ou** aceitar ambos com preferência alinhada aos examples.
2. Atualizar `CAMPOS_ENTRADA_CRT_DOCUMENTADOS` / testes MRT-50.62/50.67 que fixam a string acentuada.
3. Teste unitário: `buildCrtInput({ tipoPdv:'cartao_debito' }).texto` contém `=Debito;` e bytes latin1 sem `0xE9` no valor do tipo.

**Alternativa documental (sem mudar literal):** omitir `transacao_tipo_cartao` e deixar o Client coletar via `99` (docs/06: entrada opcional) — muda comportamento operacional; também exige aprovação.

**Não executar CRT nesta sprint para “provar” aceitação.**

---

## 9. Conformidade

Gate OFF; zero nativo; zero TX; zero alteração de protocolo/banco/UNKNOWN; testes 8/8 ok (`mrt-50-72-transacao-tipo-cartao-encoding.test.js`).

---

## Parecer

**`INCOMPATIBILIDADE PROVÁVEL`** entre o literal acentuado usado pelo CDS (docs/06) e o literal ASCII dos exemplos oficiais / opções do Client, com rejeição operacional comprovada do conteúdo `Débito` na MRT-50.69.

Aguardando aprovação para sprint de correção mínima (sem TX) ou confirmação Destaxa do literal canônico.
