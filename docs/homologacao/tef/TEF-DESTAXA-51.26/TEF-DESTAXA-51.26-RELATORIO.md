# TEF-DESTAXA-51.26 — Homologação controlada (janela 30 min)

**Decisão:** **NO-GO PARA TESTE CONTROLADO**  
**CRT real:** **NÃO EXECUTADO** (sem autorização específica)  
**Homologação operacional:** **NÃO DECLARADA**

### Recheck 13:30−13:31 (−03:00)

Reabertura passiva da janela após subida do V$Pague. **Decisão permanece NO-GO.**  
Evidência: `recheck-inicio.json`, `recheck-1330.json`.

| Item no recheck | Status |
| --- | --- |
| V$Pague | **UP** — PID **18472**, listener **60906**, cloud `app-partner.destaxa.cloud:60410` TLS |
| PinPad COM4 | **presente** (PPC-920/930) |
| Código 51.20 / 51.25 | **preservado** (hashes iguais) |
| Gate | **OFF** |
| PDV / Electron workspace | **ainda AUSENTE** |
| NativeHost | **não inicializado** (sem autorização Fase 3) |
| id=1 pendente UNKNOWN | **ainda ativa** (bloqueia nova TX) |
| Autorização CRT específica | **ausente** |

---

## 1. Horário de início e encerramento

| Marco | Horário (America/Sao_Paulo) |
| --- | --- |
| **Início** | **2026-11-10 13:22:31 −03:00** |
| Fase 1 (diagnóstico) | 13:22:31 → ~13:22:47 |
| Fase 2 (bloqueios técnicos) | ~13:23:00 → ~13:23:45 |
| Fase 3 (prep operacional) | **NÃO EXECUTADA** — sem autorização de init |
| Fase 4 (GO/NO-GO) | ~13:24:05 → **13:24:30 −03:00** |
| **Encerramento 1ª passagem** | **2026-11-10 13:24:56 −03:00** |
| **Recheck** | **13:30:38 → 13:31:14 −03:00** — ainda **NO-GO** |

Artefatos: `janela-inicio.json`, `fase1-diagnostico.json`, `fase2-bloqueios.json`, `fase3-fase4.json`, `recheck-1330.json`.

---

## 2. Diagnóstico do PDV

| Item | Resultado |
| --- | --- |
| Workspace | `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |
| `package.json` Electron | **22.3.27** |
| `node_modules/electron` FileVersion | **22.3.27** |
| Processo Electron / `electron-pdv` / `--cds-forcar-local` | **AUSENTE** |
| Backend HTTP :3001 | **sem listener** |
| Execução a partir do workspace | **não comprovada** (PDV não está rodando) |

**Bloqueio:** PDV não está aberto a partir do workspace nesta janela.

---

## 3. Diagnóstico V$Pague

| Item | 13:22 (1ª passagem) | 13:30 (recheck) |
| --- | --- | --- |
| Instalação | `C:\VBI\V$Pague\Client` existe | igual |
| Config Destaxa | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` | igual |
| Processo | **NENHUM** | **VSPagueClient.exe PID 18472** |
| Listener | nenhum | **:::60906** |
| Cloud | — | `app-partner.destaxa.cloud:60410` TLS |
| Comunicação CDS↔V$Pague via NativeHost | não testada | **não testada** (sem init autorizado) |

**Atualização:** V$Pague **em execução** no recheck. Isso **remove** o bloqueio “V$Pague parado”, mas **não basta** para GO (faltam PDV, NativeHost, autorização CRT e resolução da pendência id=1).

---

## 4. Diagnóstico NativeHost

| Item | Resultado |
| --- | --- |
| Processo NativeHost | **AUSENTE** |
| Inicialização nesta sprint | **NÃO realizada** (Fase 3 exige autorização específica) |
| Comunicação comprovada | **NÃO** |

---

## 5. Diagnóstico DLL

| Item | Resultado |
| --- | --- |
| Workspace x64 | `resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` (136782 bytes) |
| Pacote oficial 1.83 Desktop | mesmo tamanho **136782** — **match** |
| Program Files CDS ERP | 136782 bytes (presente) |
| Inicialização/chamada DLL | **NÃO** (Fase 1/3: proibido sem autorização) |

DLL **disponível** no disco; runtime **não** exercitado.

---

## 6. Diagnóstico PinPad / COM4

| Item | Resultado |
| --- | --- |
| Dispositivo | **PPC-920/930 CDC USB-to-Serial Port (COM4)** |
| Status PnP | **OK** |
| VID/PID | USB `VID_1753` `PID_C902` (Gertec) |
| Abertura COM4 / driver IO | **NÃO** (somente identificação passiva) |

PinPad **fisicamente presente**. Comunicação operacional **não comprovada** nesta sprint.

---

## 7. Hashes e versões

| Arquivo | Hash SHA-256 | Esperado |
| --- | --- | --- |
| `TefManager.js` | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` | 51.20 **OK** |
| `DestaxaRealAdapter.js` | `8D3B60ECCBCBB18EACB6D84785BF15ABC786F8BC7C2117E043851FCE846892A9` | 51.25 **OK** |
| `destaxaCrtCicloOrquestracao.js` | `EF42EEF025625F148CD48C209714A84E715EAAE2FBB3448B6DAB47A79540ABC6` | 51.25 **OK** |
| `destaxaProtocolo.js` | `084F846AD8D9844C37CDB5BAFD17586E70A535E45274030F86370329EDBB2804` | 51.25 **OK** |
| `DestaxaNativeBridge.js` | `989E8C08BB893CB2C7BF4626ACFA8A38E0B0AF867F98D2F90AEF7F1E2494FE78` | 51.25 **OK** |

Marcadores: `intentCicloAutomaticoContinue` **sim**; `persistirEvidenciasAntesFinalize` / `_confirmarPersistenciaEvidencias00` **sim**.

Código de produção **não modificado** nesta sprint (nenhuma falha concreta localizada exigindo patch).

---

## 8. Persistência pré-FINALIZE

Auditoria estática Fase 2 — **15/15 checks OK**, incluindo:

- `exigirEvidenciasAntesFinalize: true` no Adapter  
- Extração NSU/autorização/comprovantes  
- Mapeamento via `resultadoInicio`  
- FINALIZE condicionado a persistência confirmada  
- Falha de persistência bloqueia FINALIZE (sem `FINALIZE(9)` automático)  
- A1 bloqueado sem auto-finalize  
- UNKNOWN sem retry  
- Bloqueio de nova TX com pendência (`criarTransacaoExclusiva` + mensagem de pendente)

Testes isolados reexecutados: **51.25 18/18 OK**, **51.19 16/16 OK**.

---

## 9. Estado do gate

```json
{
  "env": "DESTAXA_REAL_TRANSACTION_ENABLED",
  "raw": null,
  "habilitado": false
}
```

Process / User / Machine: vazios. **Gate permanece OFF.**  
Nenhuma autorização específica para CRT real foi fornecida nesta sprint → gate **não** foi ligado.

---

## 10. Estado da operação id=1

Readonly `C:\ProgramData\MercantilFiscal\dados\mercadao.db`:

| Campo | Valor |
| --- | --- |
| id | 1 |
| status | `pendente` |
| valor | 1 (R$ 1,00) |
| tipo | `cartao_debito` |
| nsu / autorizacao | **null** |
| idempotency_key | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| atualizado_em | `2026-11-09 16:59:12` (inalterado) |
| pendentesCount | **1** |

Classificação: **UNKNOWN** documental. **Não** alterada / reconciliada / finalizada.

**Bloqueio adicional:** pendência `id=1` impede nova autorização via `criarTransacaoExclusiva` enquanto status=`pendente`. Sprint proíbe liberar essa pendência.

---

## 11. Testes executados

| Suite | Resultado | Tipo |
| --- | --- | --- |
| `tef-destaxa-51-25-persistencia-confirmacao.test.js` | 18/18 OK | isolado / mock |
| `tef-destaxa-51-19-host-security-continue.test.js` | 16/16 OK | isolado / mock |
| CRT / DLL / NativeHost real | **não executado** | — |

---

## 12. Bloqueios encontrados

1. **PDV/Electron não em execução** no workspace (recheck 13:30 — ainda ausente).  
2. ~~V$Pague Client não em execução~~ → **resolvido no recheck** (PID 18472 / :60906). Comunicação CDS↔Client **ainda não comprovada**.  
3. **NativeHost não inicializado** (sem autorização Fase 3).  
4. **Pendência financeira UNKNOWN `tef_transacoes.id=1`** bloqueia nova TX; não pode ser liberada nesta sprint.  
5. **Sem autorização específica de CRT** (valor/modalidade/terminal/operação única).  
6. Gate OFF (correto sem autorização) → caminho financeiro real não liberado.

Itens **OK** (não bastam para GO): código 51.20/51.25, DLL 1.83 no disco, Electron 22.3.27 instalado, PinPad COM4 PnP OK, V$Pague UP (recheck), testes isolados.

---

## 13. Resultado GO / NO-GO

### **NO-GO PARA TESTE CONTROLADO** (mantido no recheck 13:30)

Motivo sintético: V$Pague subiu, mas **PDV ausente**, **NativeHost não iniciado**, pendência histórica **id=1** ativa e **sem** autorização financeira específica para CRT.

Não foi forçado GO para cumprir prazo.

---

## 14. CRT real

**Não houve CRT real.**  
Sem evidências de TX_START/CONTINUE/FINALIZE operacionais nesta janela.

---

## 15. Pendências (para reabrir janela)

1. ~~Subir V$Pague~~ → UP no recheck 13:30 (PID 18472 / :60906).  
2. Abrir PDV **do workspace** (`electron-pdv` / `--cds-forcar-local`) e validar hashes em runtime.  
3. Autorização **explícita** de produto para CRT: valor, modalidade, terminal, operação única — **sem** reusar auth antiga e **sem** liberar id=1.  
4. Tratar id=1 via proposta administrativa (abaixo) **após** Destaxa formal + autorização expressa.  
5. Só então: autorização Fase 3 (NativeHost) + eventual autorização CRT (Fase financeira).

### Proposta administrativa id=1 (sem execução)

Documento: [`PROPOSTA-RECONCILIACAO-ADMINISTRATIVA-ID1.md`](./PROPOSTA-RECONCILIACAO-ADMINISTRATIVA-ID1.md)  
Estado: evidências consolidadas; **aguardando autorização** antes de qualquer UPDATE/reconciliação/init.

---

**FIM DA SPRINT TEF-DESTAXA-51.26 — NO-GO.**
