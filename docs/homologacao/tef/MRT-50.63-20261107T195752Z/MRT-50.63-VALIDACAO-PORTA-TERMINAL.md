# MRT-50.63 — Validação final da configuração do terminal Destaxa

**Status: CONCLUÍDA**

Gerado em 2026-11-07T19:57:52Z. Investigação estática + pré-voo ambiental. **Nenhuma cobrança. Gate OFF. Sem `iniciaTransacaoDestaxa` / `continuaTransacaoDestaxa` / `finalizaTransacaoDestaxa`. Sem comandos ao PinPad. Sem abertura do banco oficial. Sem NativeHost iniciado. Sem alteração de driver/firmware/Windows/perfil/chave. Sem SEFAZ.**

Diretório: `docs/homologacao/tef/MRT-50.63-20261107T195752Z`

A tentativa única de R$ 1,00 em débito **permanece reservada** e **não foi usada**.

---

## 1. Status e escopo

| Critério | Resultado |
| --- | --- |
| Origem da configuração serial | Identificada: `tef_pinpads.porta_com` → `config.portaCom` |
| Divergência COM3/COM4 | Explicada (histórico Windows/CDC + snapshots) |
| Porta efetiva do fluxo | Documentada: PinPad mediado por V$Pague; COM só no preflight CDS |
| Débito/crédito MRT-50.62 | Preservado (revalidação estática OK) |
| Ambiente PPC-930 / V$Pague | Verificado |
| Gate OFF | Comprovado |
| Chamada financeira | Nenhuma |

**Arquivos de código alterados nesta sprint:** nenhum.

---

## 2. Arquivos inspecionados

### Código
- `backend/services/tef/tefConfigService.js` (origem `portaCom`, `compararPortaPinpad`, `analisarPortaCom`)
- `backend/repositories/tefConfigRepository.js` (`porta_com` em `tef_pinpads`)
- `backend/services/tef/adapters/DestaxaRealAdapter.js` (match porta configurada × detectada; bloqueio sem fallback)
- `backend/services/tef/sdkDetector.js` / `pinpads/detectarPpc930.js` / `pinpads/GertecPPC930.js`
- `backend/services/tef/destaxa/destaxaProtocolo.js` (CRT modalidade)
- `backend/services/tef/destaxa/destaxaDllLogConfig.js` / `destaxaMapeamentoTerminal.js` / `DestaxaNativeBridge.js`
- Terminal Registry / Router (projeção de `portaCom`; sem abertura serial Destaxa)

### Evidências históricas acessíveis (sem DB)
- `docs/build/tef-ppc930-05/06/11-report.json` (COM3)
- `docs/build/tef-auditoria-08-report.json` (COM3)
- `docs/build/tef-destaxa-11-config-por-pdv-report.json`, `mrt-09-…`, `mrt-18-…` (COM4)
- Relatórios MRT-50.60 / 50.61 / 50.62

### Artefatos desta sprint
- `MRT-50.63-VALIDACAO-PORTA-TERMINAL.md` (este)
- `mrt-50.63-resultado.json`
- `analise-porta.json`
- `preparacao-sessao-nativehost.md`
- `preflight.json`, `crt-static-revalidation.json`, `observability.jsonl`
- `windows-serial.json`, `windows-pnp-ppc.json`, `vspague-process.json`, `vspague-ports-netstat.txt`, `env-overrides.json`, `historico-com3-com4.json`

---

## 3. Origem da configuração da porta

| Camada | Detalhe |
| --- | --- |
| Persistência | Coluna `porta_com` em `tef_pinpads` (banco oficial SQLite) |
| Serviço | `tefConfigService.obterConfiguracao()` expõe `portaCom` |
| Overrides de ambiente | `TEF_PORTA_COM` / `DESTAXA_PINPAD_PORT` **ausentes** (null) |
| Cache arquivo sem DB | Nenhum hit em AppData / ProgramData / `C:\CDS-SISTEMAS` |
| Valor persistido **hoje** | **Não lido** (banco oficial proibido nesta sprint) |

Não há contrato no código Destaxa para “gravar COM4 automaticamente” a partir do Windows. A porta persistida é cadastro; o adapter só **compara**.

---

## 4. Porta efetiva do fluxo Destaxa

```
PDV/CDS  →  DLL Destaxa (TCP Client / V$Pague)  →  PinPad (serial gerenciada pelo Client)
                ↑
         porta_com do CDS NÃO entra na string da DLL como COM serial
```

Evidências de contrato:

1. **`iniciaClientDestaxa`**: parâmetros de comunicação documentados são TCP do Client (`porta_comunicacao_cliente` / endereço), não a COM do PPC-930. `DestaxaNativeBridge` não injeta `portaCom` serial.
2. **CRT / TX**: `buildCrtInput` monta valor/modalidade; sem campo de porta serial.
3. **`DestaxaRealAdapter.prepararAutorizacao`**: lê `config.portaCom`, detecta PPC-930 no Windows e **exige igualdade exata** (case-insensitive). Divergência → `DESTAXA_PINPAD_NAO_DETECTADO` **antes** de qualquer TX.
4. **Fallback automático de porta:** **não existe**. O detector não substitui a porta persistida pela detectada para liberar a autorização.
5. **Mediação:** comunicação PinPad na cobrança é **inteiramente via V$Pague** (`VSPagueClient.exe`). O CDS não abre a COM4 para a DLL Destaxa.

**Conclusão:** o fluxo Destaxa **não “utiliza a COM4” abrindo serial no CDS**. A COM4 Windows é o alvo do **gate de consistência**. A comunicação PinPad é mediada pelo V$Pague. Não se presume gravação de COM4 sem identificar esse contrato — e o contrato identificado **não** é “DLL abre COM4”.

### Bloqueio formal residual

Sem ler `porta_com` no banco, o valor persistido atual permanece **não confirmado**. Se ainda for `COM3` enquanto o Windows enumera `COM4`, a próxima tentativa real será **bloqueada no preflight** (sem chamada financeira). Último snapshot acessível com `porta_com` (mrt-18, 2026-10-30) apontava **COM4**, mas isso **não substitui** leitura autorizada na sprint de cobrança.

---

## 5. Divergência COM3 × COM4

| Quando (aprox.) | Evidência | Porta |
| --- | --- | --- |
| TEF-PPC930-05 | Windows + `porta_com` | **COM3** (coincidiam) |
| 2026-10-29 ~16–17h | ppc930-06/11, auditoria-08 | **COM3** configurada |
| 2026-10-29 20:47 → 10-30 | destaxa-11, mrt-09, mrt-18 | **COM4** configurada |
| MRT-50.60 / 50.63 (agora) | Windows PnP/Serial | **COM4** OK |

**Explicação:** reatribuição Windows do dispositivo CDC USB-to-Serial do PPC-930 ao longo do tempo; relatórios CDS refletiram a porta então detectada/lida. Não há evidência de o runtime Destaxa “inventar” COM3. A referência histórica a COM3 é **legítima para a época** em que o Windows apresentava COM3.

---

## 6. Revalidação estática do fluxo de pagamento (MRT-50.62)

Código **não modificado** nesta sprint.

| Modalidade | Entrada CRT (`buildCrtInput`) |
| --- | --- |
| Débito (`cartao_debito`, 1×) | `transacao_valor=1.00;transacao_tipo_cartao=Débito;transacao_pagamento=A vista` |
| Crédito parcelado (`cartao_credito`, 3×) | `transacao_valor=1.00;transacao_tipo_cartao=Credito;transacao_pagamento=Parcelado` |

Demais controles (revisão estática, sem TX):

| Controle | Estado |
| --- | --- |
| Valor formatado | `1.00` a partir de 100 centavos |
| Coleta `99` | Preservada (campos explícitos não eliminam senha/coleta PinPad) |
| Anti-duplicidade | Identidades / pendências / Host busy (inalterado) |
| UNKNOWN sem retry | `retryAllowed: false` / política financeira (inalterado) |

---

## 7. Verificação do ambiente

| Item | Evidência |
| --- | --- |
| PPC-930 | `PPC-920/930 CDC USB-to-Serial Port (COM4)`, Status **OK** |
| COM4 | `Win32_SerialPort` DeviceID `COM4` |
| V$Pague | `VSPagueClient.exe` PID **44484**; **60603** e **60906** LISTENING |
| DLL SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` (match referência) |
| Gate | Process=`0`, User/Machine vazios → **OFF** |
| NativeHost prévio | **nenhum** |
| NativeHost nesta sprint | **não iniciado** |
| Perfil / chave | hashes Local State + signing key preservados (sem alteração) |
| Banco oficial | **não aberto** |

---

## 8. Preparação da sessão NativeHost

Documentada em `preparacao-sessao-nativehost.md`. Resumo:

1. Pré-condições ambientais (acima).
2. Novo processo NativeHost (não reutilizar sessão `STOPPED`).
3. `LOAD` + `iniciaClientDestaxa` → confirmar `CLIENT_INITIALIZED` / `00`.
4. Só depois, em sprint separada e com confirmação explícita: gate + única TX débito R$ 1,00.

**Nenhuma sessão nativa foi iniciada aqui.**

---

## 9. Testes executados

- Mapeamento estático da origem/resolução de `portaCom`.
- Busca de caches acessíveis sem DB (resultado: vazio).
- Enumeração Windows Serial/PnP + processo V$Pague + netstat.
- Hash DLL + variáveis de ambiente do gate e overrides de porta.
- Revalidação Node de `buildCrtInput` débito/crédito.
- **Zero** chamadas financeiras / PinPad / NativeHost / SQLite oficial.

---

## 10. Pendências impeditivas (para cobrança futura — não desta sprint)

1. **Confirmar `porta_com` persistida == COM4** com leitura autorizada (banco ou UI) imediatamente antes da TX.
2. **Gate OFF** até confirmação explícita imediata antes da chamada financeira.
3. **Nova sessão NativeHost** + `CLIENT_INITIALIZED` na sprint de execução.

---

## 11. Encerramento

**Parar.**

A execução da única tentativa de R$ 1,00 em débito permanece separada e depende de confirmação explícita imediatamente antes da chamada financeira.
