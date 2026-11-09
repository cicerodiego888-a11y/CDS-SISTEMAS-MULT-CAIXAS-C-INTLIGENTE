# MRT-50.62 — Alinhamento PDV × Destaxa e pré-voo da homologação

**Status: CONCLUÍDA**

Gerado em 2026-11-07T19:54:38Z. Preparação e alinhamento de modalidade. **Sem cobrança. Gate OFF. Sem `iniciaTransacao*` / `continua*` / `finaliza*`. Sem PinPad. Sem banco oficial. Sem NativeHost iniciado.**

A única tentativa autorizada de R$ 1,00 em débito **permanece reservada**.

Diretório: `docs/homologacao/tef/MRT-50.62-20261107T195438Z`

## 1. Arquivos inspecionados e alterados

### Inspecionados
- `frontend/pdv/js/pdv.js` — botões `cartao_debito` / `cartao_credito` → `/tef/pagar` com `tipo`
- `frontend/shared/js/tefFluxoPagamento.js`
- `backend/rotas/tef.js`
- `backend/services/tef/tefFluxoPagamento.js`
- `backend/services/tef/TefManager.js`
- `backend/services/tef/adapters/DestaxaRealAdapter.js`
- `backend/services/tef/destaxa/destaxaProtocolo.js`
- `backend/services/tef/destaxa/DestaxaHostBridge.js` / `DestaxaNativeHostClient.js` / `DestaxaNativeHost.js` / `DestaxaNativeBridge.js`
- `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js`
- Docs oficiais 1.83: `04`, `06`, `07`, `08`, `09`
- Relatórios de config/porta (sem abrir `mercadao.db`)

### Alterados
- `backend/services/tef/destaxa/destaxaProtocolo.js` — `buildCrtInput` preserva modalidade documentada
- `backend/services/tef/adapters/DestaxaRealAdapter.js` — passa `tipoPdv`/`parcelas` para a entrada CRT

## 2. Fluxo da modalidade (PDV → DLL)

```
PDV: data-pagamento=cartao_debito|cartao_credito
  → TefFluxoPagamento.normalizarTipoTef(forma)
  → POST /tef/pagar { tipo, valor, parcelas, idempotency_key }
  → TefManager.autorizar (normaliza tipo novamente)
  → DestaxaRealAdapter.prepararAutorizacao / autorizarPagamento
  → buildCrtInput({ valorCentavos, tipoPdv, parcelas })
  → camposEntrada → DestaxaHostBridge → NativeHost → iniciaTransacaoDestaxa(CRT, entrada)
```

Regra CDS: a forma é escolhida no PDV **antes** do envio. Dinheiro/PIX/outras formas não passam por este CRT Destaxa. A Destaxa **não** substitui a classificação CDS.

### Antes desta sprint
`buildCrtInput` enviava apenas `transacao_valor=1.00`. Débito e crédito PDV colapsavam em CRT idêntico; a diferenciação ficava a cargo do retorno `99` no PinPad — risco de divergir da escolha do operador.

### Depois
Débito/crédito explícitos na entrada oficial:

| PDV `tipo` | Entrada CRT Destaxa |
| --- | --- |
| `cartao_debito` / `debito` | `transacao_valor=1.00;transacao_tipo_cartao=Débito;transacao_pagamento=A vista` |
| `cartao_credito` + parcelas>1 | `…;transacao_tipo_cartao=Credito;transacao_pagamento=Parcelado` |
| `cartao_credito` + 1 parcela | `…;Credito;A vista` |
| `cartao` / `tef` genérico | só `transacao_valor` (99 pode coletar tipo) |

Ortografia oficial docs/06: `Débito` | `Credito` | `A vista` | `Parcelado` | `Pré-datado`.

## 3. Contrato CRT validado (homologação R$ 1,00 débito)

| Campo | Valor | Fonte |
| --- | --- | --- |
| `operacao` | `CRT` | docs/06 (parâmetro separado) |
| `transacao_tipo_cartao` | `Débito` | docs/06 — opcional na doc; **preservado** quando PDV classifica débito |
| `transacao_pagamento` | `A vista` | docs/06 |
| `transacao_valor` | `1.00` | docs/06 + `formatarValorDestaxa(100)` |

Doc 06: entrada **não é obrigatória**; campos ausentes podem gerar `99`. Campos presentes são “algumas informações aceitas”. Inclusão explícita de `Débito` é **compatível** com a API e com o fluxo `99` para demais coletas (senha, etc.). Não há texto oficial proibindo pré-envio do tipo.

Validação estática (sem DLL): `validate-crt-input-result.json` → `ok: true`.

## 4. Retornos 99 / 00 / timeout / UNKNOWN

Inalterado e preservado:
- `99` → continuidade (`TX_CONTINUE`), não aprovação
- `00` conclusivo → `TX_FINALIZE(0)`
- Timeout operacional TefManager → UNKNOWN/PENDING sem cancelar DLL
- `retryAllowed: false` em caminhos Destaxa; idempotência / pendências / HOST_BUSY

## 5. Porta COM

| Fonte | Valor |
| --- | --- |
| Windows agora | **COM4** (`PPC-920/930 CDC USB-to-Serial Port`) |
| Variáveis de ambiente | nenhuma `TEF_PORTA` / `DESTAXA_PINPAD_PORT` |
| Banco oficial | **não aberto** |
| Relatórios acessíveis | mistos: COM4 (mrt-42, destaxa-07d/10/11) e COM3 histórico (ppc930-05/06/11, auditoria-08) |

**Divergência documentada:** hardware atual em COM4; config persistida não confirmada nesta sprint. Pré-voo da cobrança deve validar `portaCom` contra COM4 **sem improvisar** troca de driver.

## 6. Pré-voo NativeHost / Client / Gate

| Item | Estado |
| --- | --- |
| Gate | OFF (Process `0`, User/Machine vazios) |
| DLL SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |
| NativeHost ativo | não |
| V$Pague | PID `44484` |
| Client sessão atual | não iniciado (Host da 50.59 já STOPPED) |
| Preparação sessão futura | novo NativeHost + LOAD + `iniciaClientDestaxa` na sprint de cobrança, após confirmação explícita |

## 7. Testes

- Validação estática Node de `buildCrtInput` (débito/crédito/genérico) — passou
- Pré-voo ambiental (hash, gate, COM4, V$Pague, NativeHost ausente)
- Nenhuma chamada financeira

## 8. Evidências

- `MRT-50.62-ALINHAMENTO-PDV-DESTAXA.md`
- `mrt-50.62-resultado.json`
- `validate-crt-input-result.json`
- `preflight.json`
- `observability.jsonl`

## 9. Encerramento

Preparação concluída. **Parar.**

A execução da única cobrança de R$ 1,00 em débito continua em sprint separada e exige confirmação explícita do usuário imediatamente antes da chamada financeira.
