# INVESTIGAÇÃO DIRECIONADA — 00151

**Data:** 2026-11-10 (America/Sao_Paulo)  
**Contexto:** Sprint 51.28 registrou `[00151]` no boot do V$Pague; histórico Destaxa/PO já havia tratado cadastro (CNPJ/loja/terminal) e ativação em 09/11 12:24.  
**Escopo:** somente leitura. Sem alteração de cadastro, `.conf`, DLL, NativeHost, CRT, COM4, gate, `id=1` ou código TEF.

**Classificação:** **CAUSA COMPROVADA**

---

## Veredito

O `00151` da Sprint 51.28 **não é log histórico** e **não indica conf errada / cadastro Destaxa alterado no CDS**.

Ele reapareceu porque, no boot de **10/11 13:29:41**, o V$PagueClient apresentou ao servidor o MAC primário **`00:15:5D:53:C5:2C`** (vEthernet WSL), enquanto a sessão que ativou o terminal em **09/11 12:24:11** usou **`00:15:5D:10:29:A0`** — MAC que **não existe mais** neste host.

O `.conf` atual continua sendo o recebido na ativação (`V$PagueClient_Destaxa_LojaACB_TACB0120.conf`, versão `20261109120020`, LastWriteTime **09/11 12:24:13**) e ainda embute a identidade antiga com `00:15:5D:10:29:A0`.

---

## 1. Log da sessão 09/11 12:24 (sem 00151)

**Fonte:** `C:\VBI\V$Pague\Client\logs\archived\vspague-client-2026-11-09.0.gz`  
(rotacionado em 10/11 13:29:41 ao subir a sessão da 51.28)

| Campo | Valor |
| --- | --- |
| Start | `2026-11-09 12:24:11` |
| Sessão | `vspg-id-66c550a0` |
| `HostMacAddressGet()` | **`00:15:5D:10:29:A0`** |
| `MacAdressFilter` | `00:15:5D:10:29:A0 \| C0:A8:10:DB:EE:9E` |
| `HostIpAddressGet()` | `172.24.64.1` |
| Identificar | recebido |
| **00151** | **ausente** neste boot |
| Em seguida | `iniciando Destaxa-LojaACB-TACB0120` → serviço **Ativar** |
| Resultado | **`Terminal ativado`** (12:24:13) |
| Conf recebida | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` |
| Versão conf | `20261109120020` |
| Listener | `60906` Background |
| Uso posterior | 13:58:43 sessão CRT histórica (id=1) na **mesma** sessão `66c550a0` |

Trecho decisivo (após Identificar, **sem** ERROR 00151):

```text
12:24:12 Identificar recebido (vspg-id-66c550a0)
12:24:12 iniciando Destaxa-LojaACB-TACB0120
12:24:12 enviando Ativar
12:24:13 Terminal ativado
12:24:13 Novo arquivo de configuração recebido: V$PagueClient_Destaxa_LojaACB_TACB0120.conf
```

Boots **anteriores** do mesmo dia (10:38 / 11:43×2 / 11:47) tiveram 00151 — já documentados nas sprints 51.01–51.03. A sessão 12:24 foi a que **superou** esse estado.

---

## 2. Boot da sessão Sprint 51.28

**Fonte:** `C:\VBI\V$Pague\Client\logs\vspague-client.log` (arquivo corrente)

| Campo | Valor |
| --- | --- |
| Start | `2026-11-10 13:29:41` |
| PID | **18472** (`CreationDate` 10/11 13:29:40) |
| Sessão | `vspg-id-9bbc584a` |
| `HostMacAddressGet()` | **`00:15:5D:53:C5:2C`** |
| `MacAdressFilter` | `00:15:5D:53:C5:2C \| 00:15:5D:BC:1A:D0 \| C0:A8:10:DB:EE:9E` |
| `HostIpAddressGet()` | `172.24.64.1` |
| TLS cloud | OK (`app-partner.destaxa.cloud:60410`) |
| Identificar | recebido |
| **00151** | **`ERROR` em 13:29:42,769** — sessão atual |
| Depois do erro | ainda sobe `Destaxa-LojaACB-TACB0120` + listen `60906` |
| `Terminal ativado` / Ativar | **não ocorreram** neste boot |

Conclusão item 9: o 00151 da 51.28 **pertence à sessão atual** (`9bbc584a`), não a resíduo de log antigo.

---

## 3. Comparação `.conf`

| Item | Evidência |
| --- | --- |
| Arquivo único no Client | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` |
| LastWriteTime | **09/11/2026 12:24:13** (= momento da ativação) |
| Tamanho | 89271 bytes |
| Outros `.conf` | nenhum concorrente no diretório |
| Identidade no blob | `LojaACB`, `TACB0120`, `20261109120020`, hostname `desktop-4b8amm3`, MAC embutido **`00:15:5D:10:29:A0`** |
| Estabelecimento (blob) | CNPJ loja Destaxa ACB presente (formato com pontuação no blob serializado Java; alinhado ao tratamento anterior Destaxa) |

**Não há evidência de conf “errada” ou regenerada indevidamente após 12:24.** O PID 18472 usa o JAR/conf do Client com host/porta cloud corretos.

CommandLine do PID 18472:

```text
VSPagueClient ... -jar C:\VBI\V$Pague\Client\V$PagueClient.jar
  -h app-partner.destaxa.cloud -p 60410 -atv server -tls
```

---

## 4. Empresa / loja / terminal carregados

| Dimensão | 12:24 (OK) | 51.28 (00151) |
| --- | --- | --- |
| Aplicação título | Destaxa | Destaxa |
| Config nominal | Destaxa-LojaACB-TACB0120 | Destaxa-LojaACB-TACB0120 |
| Arquivo conf | mesmo nome / versão pós-Ativar | **mesmo arquivo** (não reescrito em 10/11) |
| Fluxo pós-Identificar | Ativar + Terminal ativado | **00151** → sobe listener sem Ativar |

A divergência comprovada **não** é troca de loja/terminal no arquivo; é a **identidade de terminal apresentada no Identificar** (hostname+MAC).

---

## 5. MAC / interface de rede

### Histórico de `HostMacAddressGet()` em 09–10/11

| Boot | MAC primário | Resultado Identificar |
| --- | --- | --- |
| 09/11 10:38 | `00:15:5D:F9:A6:40` | 00151 |
| 09/11 11:43 / 11:47 | `00:15:5D:10:29:A0` | 00151 (ainda pré-ativação) |
| **09/11 12:24** | **`00:15:5D:10:29:A0`** | **sem 00151 → Terminal ativado** |
| **10/11 13:29 (51.28)** | **`00:15:5D:53:C5:2C`** | **00151** |

### Estado atual das placas (leitura 10/11)

| Interface | Status | MAC |
| --- | --- | --- |
| vEthernet (WSL) | Up | **`00-15-5D-53-C5-2C`** ← escolhido agora |
| vEthernet (Default Switch) | Up | `00-15-5D-BC-1A-D0` |
| Wi-Fi AX201 | Up | `C0-A8-10-DB-EE-9E` |
| Bluetooth PAN | Disconnected | `C0-A8-10-DB-EE-A2` |

**`00:15:5D:10:29:A0` (MAC da ativação) não está presente** em nenhum adaptador atual.

Ambos os MACs Hyper-V (`00:15:5D:*`) são virtuais. O Client prioriza esse tipo em `HostMacAddressGet()`; quando o adaptador Hyper-V muda (recriação WSL/Default Switch), a identidade vista pela Destaxa muda — mesmo com Wi-Fi estável e mesmo `.conf`.

---

## 6. Instâncias duplicadas

| Verificação | Resultado |
| --- | --- |
| Processos `VSPagueClient` / java V$Pague | **somente PID 18472** |
| Tentativas históricas bind 60603 | várias em 09/11 10:22–10:37 (“Application already running”) — **não** no boot 51.28 |

Sem duplicidade na sessão atual.

---

## 7. Portas 60603 e 60906

| Porta | Estado atual | Owner |
| --- | --- | --- |
| **60603** | LISTENING | **18472** apenas |
| **60906** | LISTENING | **18472** apenas |

Sem conflito de porta no boot da 51.28. (Conflitos 60603 do dia 09/11 foram de tentativas paralelas **antes** da ativação.)

---

## 8. PID × configuração esperada

| Check | Status |
| --- | --- |
| PID 18472 = processo do log 13:29:41 | **OK** (StartTime alinhado) |
| Host/porta cloud Destaxa | **OK** (`app-partner.destaxa.cloud:60410`) |
| Conf LojaACB / TACB0120 | **OK** (arquivo da ativação 12:24) |
| Identidade MAC alinhada à ativação | **FALHA** (`53:C5:2C` ≠ `10:29:A0`) |

---

## 9. 00151: sessão atual vs histórico

| Ocorrência | Natureza |
| --- | --- |
| 09/11 10:38 / 11:43 / 11:47 | Histórico pré-ativação (já conhecido) |
| 09/11 12:24 | **Sem 00151** — ativação bem-sucedida |
| **10/11 13:29:42** | **Sessão atual 51.28** (`vspg-id-9bbc584a`) |

O relatório 51.28 registrou corretamente um 00151 **do boot corrente**, não um eco do arquivo de 09/11.

---

## 10. Causa comprovada

### Causa

**Mudança do MAC primário usado pelo V$PagueClient no Identificar** após a ativação de 09/11 12:24:

- Ativado / embutido no conf: `00:15:5D:10:29:A0`
- Apresentado em 10/11 13:29: `00:15:5D:53:C5:2C` (WSL Hyper-V)

Com isso, o servidor Destaxa responde **00151** (terminal não cadastrado/desabilitado **para aquela identidade de máquina**), apesar de:

- conf LojaACB/TACB0120 correta;
- TLS OK;
- listener 60906 subir;
- cadastro Destaxa já tratado anteriormente para o terminal da identidade antiga.

### O que **não** é a causa (evidência)

- Conf trocada / gerada errada após 12:24 — LastWriteTime intacto.  
- PID usando outro JAR/host — CommandLine aponta Client oficial + cloud Destaxa.  
- Duplicidade de Client ou conflito 60603/60906 no boot 51.28.  
- Log histórico mal interpretado — linha 00151 está no `vspague-client.log` corrente.  
- Necessidade de “novo conf CDS” sem causa — a causa é identidade de rede, não mapeamento local inventado.

### Implicação operacional (sem executar)

Reiniciar o Client **sem** restaurar a identidade MAC alinhada à ativação tende a repetir 00151. Qualquer correção de cadastro/MAC/filtro de interface deve ser **autorizada** com Destaxa/PO — fora deste escopo.

---

## Proibições respeitadas

Sem alteração de cadastro Destaxa, sem novo `.conf`, sem NativeHost, DLL, CRT, COM4, gate, `id=1`, `TefManager.js` ou correções 51.20/51.25.

---

## Próximos passos sugeridos (somente orientação)

1. Destaxa/infra: alinhar cadastro do terminal ao MAC **efetivo** estável, **ou** estabilizar interface usada por `HostMacAddressGet()` (evitar Hyper-V/WSL como identidade primária).  
2. Após alinhamento: novo boot controlado e verificação de Identificar **sem** 00151 + eventual `Terminal ativado`/`Ativar` se exigido.  
3. Só então retomar autorização NativeHost/CRT.

**FIM DA INVESTIGAÇÃO 00151.**
