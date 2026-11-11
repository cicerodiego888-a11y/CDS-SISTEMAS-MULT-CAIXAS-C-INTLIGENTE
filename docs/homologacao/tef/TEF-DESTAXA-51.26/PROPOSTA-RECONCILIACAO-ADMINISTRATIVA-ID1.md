# Proposta de reconciliação administrativa — `tef_transacoes.id=1`

**Natureza:** documento de auditoria / proposta — **somente leitura**  
**Data:** 2026-11-10 (America/Sao_Paulo)  
**Contexto:** Sprint 51.26 permanece **NO-GO**; PinPad COM4 detectado; V$Pague UP (PID 18472 / :60906)  
**Escopo desta entrega:** evidências, estado atual e transição administrativa **recomendada**  
**Proibições desta entrega:** alterar banco · liberar pendência · DLL · NativeHost · confirmação · desfazimento · CRT · alterar código 51.20/51.25

**Status do registro:** **NÃO ALTERADO** nesta entrega.  
**Execução da reconciliação:** **AGUARDANDO AUTORIZAÇÃO EXPRESSA**.

---

## 1. Resumo executivo

A operação local `id=1` permanece **`pendente`**, com NSU/autorização **null**, classificação financeira **UNKNOWN** e operacional **PENDING_WITH_EVIDENCE**. Ela continua a bloquear novas autorizações exclusivas.

Há evidência local forte de: INSERT pré-DLL → TX_START → retorno **99** → TX_CONTINUE bloqueado por segurança CDS (`HOST_SECURITY_OPERATION_BLOCKED`, pré-51.20) → ciclo CDS **inconclusivo**. No V$Pague histórico: timeouts da AC, leitura de cartão posterior e encerramento com **resposta 78** (“cancelada pela Aplicação Comercial”) — **sem** NSU Destaxa no CDS.

A **resposta oficial Destaxa disponível no escopo CDS** até o momento refere-se ao **contrato de fluxo da DLL** (inicia → continua → confirma/desfaz; A1; bloqueio de pendência) — documentada na auditoria **51.24**. Essa resposta **não comprova o estado financeiro** da operação `id=1` (declaração explícita da própria sprint 51.24 / contexto Destaxa).

A consulta formal investigativa da operação (**51.18**) foi **preparada**; no repositório **não há** protocolo escrito Destaxa respondendo existência/NSU/estado financeiro de `id=1`.

**Recomendação:** manter UNKNOWN e o bloqueio até (1) resposta formal Destaxa **sobre esta operação** anexada e (2) autorização expressa de Product Owner para a transição administrativa correspondente (matriz A–F).

---

## 2. Identidade da operação (evidências cruzadas)

| Campo | Valor | Fonte |
| --- | --- | --- |
| Banco | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` | 51.17 / 51.26 readonly |
| `tef_transacoes.id` | **1** | DB |
| Valor | R$ **1,00** | DB |
| Modalidade | **débito** (`cartao_debito`) | DB |
| Provedor | destaxa | DB |
| Status local | **pendente** | DB (inalterado até 2026-11-10) |
| NSU | **null** | DB |
| Autorização | **null** | DB |
| `venda_id` | **null** (órfã) | DB |
| `idempotency_key` | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` | DB |
| `operation_id` | `op_ef2ed65b9230_744378e59797f9a7` | `tef_logs` INICIO (51.17) |
| Fingerprint | `90b41858f0aff5d47c573e5c3d86bc62` | 51.17 |
| `requestId` TX_START | `d3cd929385f4281e` | NativeHost obs (51.17/18) |
| Auth excepcional | `5aed71f2b6e19f7f14303f69242c6796` **CONSUMED** | 51.03/17 |
| Lease | `lease_94f8eeedd1bbebbe` INCONCLUSIVO | 51.17 |
| Sessão V$Pague | `vspg-id-66c550a0` | 51.18 |
| Janela horária | 2026-11-09 **13:58:43–14:06:10** (UTC−3) | 51.17/18 |
| `criado_em` / `atualizado_em` | `2026-11-09 16:58:43` / `16:59:12` | DB (UTC storage) |

---

## 3. Estado atual (2026-11-10)

| Dimensão | Classificação | Evidência |
| --- | --- | --- |
| Financeiro CDS | **UNKNOWN** | Sem NSU/autorização/aprovação ou recusa emissor no CDS |
| Operacional CDS | **PENDING_WITH_EVIDENCE** | Linha `pendente` + trilha START→99→CONTINUE bloqueado |
| Status DB | `pendente` | Readonly 51.26 |
| Bloqueio novas TX | **ATIVO** | `criarTransacaoExclusiva` + `pendentesCount=1` |
| Gate financeiro | **OFF** | `DESTAXA_REAL_TRANSACTION_ENABLED` |
| Código 51.20 / 51.25 | Preservado | Hashes 51.26 |
| Homologação CRT | **NO-GO** | Relatório 51.26 |

**Snapshot readonly (2026-11-10):** status `pendente`, nsu/autorizacao null, timestamps inalterados desde 51.17.

---

## 4. Linha do tempo histórica (logs)

| Local (UTC−3) | Evento | Fonte |
| --- | --- | --- |
| 13:54:10 | Auth 51.03 ISSUED | ledger |
| 13:58:43 | Auth CONSUMED; INSERT id=1; TX_START CRT débito R$1,00 | DB + logs + NativeHost |
| 13:59:12 | TX_START_RESULT **99**; persistência 99 + displayAck | logs |
| 13:59:12 | TX_CONTINUE → **`HOST_SECURITY_OPERATION_BLOCKED`** | logs CICLO_CRT |
| 13:59:12 | RETORNO `DESTAXA_CICLO_INCONCLUSIVO`; UNKNOWN; nsu null | logs |
| ≈14:01:12 | V$Pague timeout 120 s aguardando AC | V$Pague |
| ≈14:02:06 | Leitura cartão (VISA ELECTRON BIN 496068 parcial) / TLS | V$Pague |
| ≈14:04–14:06 | “Cancelada pela AC” **resposta 78**; finalizada no Client | V$Pague |
| pós-boot | TEF_RESULTADO_PENDENTE_RECUPERADO / RECONCILIACAO_PENDENTE | logs |

Artefatos: `docs/homologacao/tef/TEF-DESTAXA-51.17/` (`dump-id1.json`, `tef-logs-id1.json`, `RELATORIO.md`), `TEF-DESTAXA-51.18/CONSULTA-FORMAL-DESTAXA.md`.

---

## 5. O que a Destaxa respondeu (e o que não respondeu)

### 5.1 Resposta disponível (fluxo DLL / automação) — escopo 51.24

Conteúdo alinhado à orientação oficial de integração:

1. Chamar `iniciaTransacao` e receber retorno.  
2. Chamar `continuaTransacao` para sequenciar.  
3. Após dados/comprovante, enviar confirmação.  
4. Sem confirmação, operação pode ficar pendente de confirmação/desfazimento.  
5. DLL bloqueia nova requisição até confirmar/desfazer.  
6. Nova `iniciaTransacao` pode retornar **A1** se houver pendência.  
7. Em A1, finalizar com código correspondente (0 confirma / 9 cancela — docs/exemplos 1.83).  
8. Exemplos oficiais no pacote DLL 1.83.

**Limite explícito:** essa resposta **não comprova** se `id=1` foi aprovada, recusada, cancelada, inexistente ou liquidada no ambiente Destaxa.

### 5.2 Consulta formal da operação (51.18)

Documento preparado: `CONSULTA-FORMAL-DESTAXA.md` (existência, estado, NSU, captura, cancelamento, comunicação 13:58–14:06, procedimento de encerramento).

**No workspace:** **não há** arquivo de resposta formal Destaxa anexado respondendo as sete perguntas da 51.18.

### 5.3 Sinais **não** suficientes para encerrar UNKNOWN

| Sinal | Por quê não encerra |
| --- | --- |
| Código **99** | Continuidade, não aprovação |
| `HOST_SECURITY_OPERATION_BLOCKED` | Segurança CDS, não desfecho Destaxa |
| Resposta **78** V$Pague | Encerramento operacional Client; não DECLINED Destaxa comprovado no CDS |
| Timeout / ausência de NSU local | Inconclusivo |
| Resposta verbal de fluxo DLL | Contrato de integração ≠ estado de `id=1` |

(Conforme matriz 51.23 e testes associados.)

---

## 6. Capacidade interna CDS (sem executar agora)

Caminho formal já existente (51.23):

1. `reconciliarResultadoTardio` — exige trava `RECONCILIACAO_PENDENTE`, `confirmacao_explicita`, `usuario`, `observacao`, `financialState` ∈ {`CONFIRMED_SUCCESS`, `CONFIRMED_DENIED`, `CANCELLED`}.  
2. `reconciliarNativeHost` — release/commit assinado; status final `aprovado` | `negado` | `cancelado`.

`tentarLiberarInconclusiva()` → sempre proibida.  
`UNKNOWN` **não** é aceito como estado de reconciliação.

Lacunas conhecidas:

- Sem estado nativo “INEXISTENTE”.  
- Fluxo de reconciliação **não** grava automaticamente NSU/autorização vindos do protocolo Destaxa (melhoria futura, se cenário D).  
- Não inventar NSU.

---

## 7. Matriz de transição administrativa recomendada

**Pré-condição comum a todos os cenários:** protocolo escrito Destaxa referenciando IDs/horários de `id=1` + **autorização expressa** do Product Owner + sprint dedicada. **Nesta entrega: não executar.**

| Cenário (Destaxa formal) | Transição CDS recomendada | Pré-requisitos extras | Riscos |
| --- | --- | --- | --- |
| **A** Inexistente | Avaliar `CANCELLED` → `cancelado` **somente** se PO mapear “inexistente”→cancelamento documental; **ou** sprint para procedimento dedicado | Protocolo de inexistência; não confundir com “não localizada” | Encerrar sem prova remota |
| **B** Recusada | `CONFIRMED_DENIED` → `negado` | Protocolo de recusa; sem NSU de aprovação | — |
| **C** Cancelada | `CANCELLED` → `cancelado` | Protocolo de cancelamento Destaxa (**não** basta 78) | — |
| **D** Aprovada | `CONFIRMED_SUCCESS` → `aprovado` | **NSU + autorização** no protocolo; sprint para persistir campos; **não** vincular venda/baixa fiscal sem auth fiscal separada | Risco fiscal se baixar sem venda |
| **E** Pendente/inconclusiva remota | **Manter UNKNOWN** / `pendente`; manter bloqueio | Continuar consulta | Bloqueio operacional permanece |
| **F** Não localizada | **Manter UNKNOWN** até evidência suficiente | Não localizar ≠ inexistência | Encerramento precoce |

### Transição **não** recomendada (proibida sem nova autorização de escopo)

- UPDATE/DELETE artificial de `id=1` só para “liberar caixa”.  
- `FINALIZE(0|9)` na DLL para “limpar” UNKNOWN histórico.  
- Retry / nova CRT reutilizando auth `5aed71f2…`.  
- Inferir desfecho só com resposta 78 / timeout / resposta de fluxo DLL.  
- Liberar pendência para homologação sob pressão de devolução do PinPad.

---

## 8. Checklist de autorização (antes de qualquer alteração)

Antes de tocar no registro ou em DLL/NativeHost, o responsável deve autorizar por escrito:

1. [ ] Protocolo Destaxa **sobre id=1** anexado (existência + estado + NSU/auth se houver).  
2. [ ] Cenário A–F escolhido e justificado.  
3. [ ] `financialState` alvo ∈ {SUCCESS, DENIED, CANCELLED} **ou** decisão de manter UNKNOWN.  
4. [ ] Usuário operador + observação citando protocolo + `confirmacao_explicita`.  
5. [ ] Confirmação de que **não** se executará CRT / estorno / finalize histórico nesta mesma autorização, salvo item explícito.  
6. [ ] Se cenário D: decisão sobre persistência de NSU/autorização e **não** criação automática de venda.  
7. [ ] Janela operacional separada da homologação PinPad (51.26 permanece NO-GO até pré-requisitos).

---

## 9. Rascunho de observação (para uso futuro, se autorizado)

```text
Reconciliação administrativa TEF-DESTAXA id=1
Referências: op_ef2ed65b9230_744378e59797f9a7 / requestId d3cd929385f4281e /
idempotency tef-fp-90b41858f0aff5d47c573e5c3d86bc62 /
janela 2026-11-09 13:58:43–14:06:10 America/Sao_Paulo /
consulta 51.18 / evidências 51.17 /
protocolo Destaxa: [ANEXAR NÚMERO/DATA] /
cenário: [A|B|C|D] /
financialState: [CONFIRMED_SUCCESS|CONFIRMED_DENIED|CANCELLED] /
NSU Destaxa: [se houver] / autorização Destaxa: [se houver].
Não houve CRT/retry nesta reconciliação. Não se utilizou resposta 78 isolada.
```

---

## 10. Conclusão e próximo passo

| Item | Decisão |
| --- | --- |
| Alterar `id=1` agora | **NÃO** |
| Liberar pendência agora | **NÃO** |
| Init NativeHost / CRT | **NÃO** (51.26 NO-GO) |
| Proposta documental | **ENTREGUE** (este arquivo) |
| Ação imediata recomendada | Obter/anexar **resposta formal Destaxa da operação**; Product Owner escolher cenário; **nova autorização expressa** para sprint de execução |

**Aguardando autorização antes de qualquer alteração no registro ou inicialização operacional.**

---

## 11. Índice de evidências

| Documento | Papel |
| --- | --- |
| `TEF-DESTAXA-51.17/RELATORIO.md` + dumps/logs | Classificação UNKNOWN / linha do tempo |
| `TEF-DESTAXA-51.18/CONSULTA-FORMAL-DESTAXA.md` | Pedido formal investigativo |
| `TEF-DESTAXA-51.23/RELATORIO.md` | Matriz A–F e arquitetura de reconciliação |
| `TEF-DESTAXA-51.24/TEF-DESTAXA-51.24-RELATORIO.md` | Contrato DLL; limite: não prova estado de id=1 |
| `TEF-DESTAXA-51.26/TEF-DESTAXA-51.26-RELATORIO.md` | NO-GO homologação; id=1 intacta |
| Readonly 2026-11-10 | Confirma `pendente`, nsu/auth null |

**FIM DA PROPOSTA — SEM EXECUÇÃO.**
