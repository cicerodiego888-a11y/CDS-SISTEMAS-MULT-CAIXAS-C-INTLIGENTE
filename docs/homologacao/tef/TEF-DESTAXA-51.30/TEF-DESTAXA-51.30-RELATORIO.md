# TEF-DESTAXA-51.30 — Relatório

**Sprint:** Validação da identidade efetivamente enviada ao servidor  
**Tipo:** Análise estática + cruzamento de logs (sem alterações operacionais)  
**Data:** 2026-11-10 (America/Sao_Paulo)  
**Base:** INVESTIGACAO-00151, TEF-DESTAXA-51.29, bytecode V$PagueClient 5.0.0, logs 09/11 e 10/11  

**Conclusão:** **MAC virtual (Hyper-V/WSL) é a identidade primária usada no Identificar** — comprovado por origem de código + logs + conf.  
Não implementar correção nesta sprint.

---

## 0. Restrições cumpridas

Somente leitura/análise estática. Sem V$PagueClient adicional iniciado por esta sprint, sem Identificar/Ativar manuais, sem alteração de MAC/WSL/Hyper-V/`.conf`/cadastro/DLL/NativeHost/CRT/COM4/gate/`id=1`/TefManager.

*(O log corrente mostra um segundo Identificar espontâneo às 15:03:59 com o mesmo `HostMacAddressGet` — apenas observado em leitura.)*

---

## 1. Campo efetivamente utilizado na identificação

| Camada | Elemento | Classificação |
| --- | --- | --- |
| Serviço | `V&SCommService/V&SPagueServer/Identificar` (`SERVICO_NOME_IDENTIFY`) | **COMPROVADA** (logs + código) |
| Método Client | `VeSPagueClientToServer.ServicoIdentificarEnviar` | **COMPROVADA** (bytecode) |
| Montagem de identidade | `ConnectionIdentifierSet` / `ConnectionIdentifierGet` | **COMPROVADA** |
| Campos nomeados no Identifier | `as_hostname`, **`as_mac_address`**, `as_estabelecimento`, `as_loja`, `as_terminal`, `as_cnpj_cpf` | **COMPROVADA** (bytecode `IdentifierSet`) |
| Lista de MACs associada | `listMacAddress` + `HOST_HARDWARE_ADDRESS` | **COMPROVADA** |
| Forma observada em runtime | `hostname(mac0;mac1;mac2;…)` | **COMPROVADA** (logs `ThreadReceive finalizada` + blob do `.conf`) |

**Campo primário de identidade MAC:** `as_mac_address` / `mac0` da identidade de conexão — alinhado a `HostMacAddressGet()`.

---

## 2. Origem do valor (fluxo estático)

```text
NetworkInterface.getNetworkInterfaces()
        │
        ├─► lib/VeSUtil.HostHardwareAddressGet()
        │      • getHardwareAddress() em TODAS as NICs
        │      • SEM isVirtual / isLoopback / isUp
        │      • resultado → VBIMain.HOST_HARDWARE_ADDRESS[]
        │      • HostMacAddressGet() no log = 1º elemento
        │         (default visual "00:00:00:00:00:00" se vazio)
        │
        └─► vespague/common/VeSPagueUtil.getPhysicalMacAddresses()
               • filtra isVirtual / isLoopback / !isUp
               • formata MAC "%02X:"

VeSPagueClient.getMacAdressList(hostMac: String)
        • usa HOST_HARDWARE_ADDRESS + getPhysicalMacAddresses()
        • contains/add → macAdressList (base do MacAdressFilter no log)

VeSPagueClientToServer
        • ConnectionIdentifierSet(..., HOST_HARDWARE_ADDRESS / listMacAddress, ...)
        • IdentifierSet(as_hostname, as_mac_address, ...)
        • ServicoIdentificarEnviar → SERVICE_IDENTIFY
```

### Pontos comprovados pelo código

1. **`HostMacAddressGet` ≠ filtro “só NIC física Wi-Fi”.**  
   Vem de `HostHardwareAddressGet` sem exclusão de virtuais. **COMPROVADA.**

2. **Existe caminho “physical” separado** (`getPhysicalMacAddresses` com `isVirtual`). **COMPROVADA.**  
   Usado em `getMacAdressList` e no fluxo de **Ativar** (`ClientWindowActivePdv` / `ClientBackgroundActivePdv` / `PostActive.host_mac`).

3. **Identificar monta identidade com `HOST_HARDWARE_ADDRESS` e `listMacAddress`.** **COMPROVADA.**

4. Valor exato atribuído a `as_mac_address` em uma instrução isolada (sem descompilação completa / sem captura TLS): **NÃO COMPROVADA byte-a-byte**.  
   Correlação com `HostMacAddressGet` / `mac0`: **COMPROVADA por logs+conf** (abaixo).

---

## 3. MAC encontrado no código (famílias)

| Fonte no Client | Natureza | Observação |
| --- | --- | --- |
| `HostHardwareAddressGet` | Todos os `getHardwareAddress()` | Inclui Hyper-V `00:15:5D:*` quando presentes |
| `getPhysicalMacAddresses` | Subconjunto com `isVirtual/isLoopback/isUp` | Em tese exclui virtuais; na prática o log de `MacAdressFilter` ainda lista `00:15:5D:*` (ver §6) |
| `getMacAdressList(hostMac)` | Combina hardware + physical + `hostMac` | Alimenta `MacAdressFilter` |
| `ActiveDataIntegration.hostMac` / `PostActive.host_mac` | Ativação integrada | Caminho Ativar (CNPJ/assinatura), distinto do Identificar de boot |

Nenhum literal de MAC da estação está hardcoded no Client; os valores são lidos em runtime das NICs.

---

## 4. MAC encontrado nos logs

### Sessão 09/11 12:24 — `vspg-id-66c550a0` (ativada, sem 00151)

| Campo | Valor |
| --- | --- |
| `HostMacAddressGet()` | **`00:15:5D:10:29:A0`** (Hyper-V) |
| `MacAdressFilter` | `00:15:5D:10:29:A0 \| C0:A8:10:DB:EE:9E` |
| Identificar | enviado/recebido **sem** 00151 |
| Em seguida | Ativar → **Terminal ativado** |
| Identidade em `ThreadReceive` (sessões do mesmo MAC) | `desktop-4b8amm3(00:15:5D:10:29:A0;C0:A8:10:DB:EE:A2;…;C0:A8:10:DB:EE:9E;…)` |
| `.conf` atual (pós-Ativar) | `desktop-4b8amm3(00:15:5D:10:29:A0;C0:A8:10:DB:EE:A2;…;C0:A8:10:DB:EE:9E;…)` |

Wi-Fi física `C0:A8:10:DB:EE:9E` aparece **na lista**, mas **não** como `mac0` / `HostMacAddressGet`.

### Sessão 10/11 13:29 — `vspg-id-9bbc584a` (51.28, com 00151)

| Campo | Valor |
| --- | --- |
| `HostMacAddressGet()` | **`00:15:5D:53:C5:2C`** (vEthernet WSL) |
| `MacAdressFilter` | `00:15:5D:53:C5:2C \| 00:15:5D:BC:1A:D0 \| C0:A8:10:DB:EE:9E` |
| Identificar | enviado/recebido → **`[00151]`** |
| Ativar | **não** ocorreu neste boot |

### Correlação 00151 × MAC primário

Boots com `HostMacAddressGet` Hyper-V **diferente** do MAC da ativação (`10:29:A0`) → 00151.  
Boot com o **mesmo** `10:29:A0` após cadastro/ativação → Identificar OK.  
**COMPROVADA** a dependência do desfecho de Identificar ao MAC primário logado (não ao Wi-Fi isolado).

---

## 5. Comparação das duas sessões

| Dimensão | 09/11 `66c550a0` | 10/11 `9bbc584a` |
| --- | --- | --- |
| Serviço | Identificar | Identificar |
| `HostMacAddressGet` | `00:15:5D:10:29:A0` | `00:15:5D:53:C5:2C` |
| Tipo NIC do primário | Hyper-V (virtual) | Hyper-V/WSL (virtual) |
| Wi-Fi no filtro | sim (`…:EE:9E`) | sim (`…:EE:9E`) |
| Resultado Identificar | OK → Ativar | **00151** |
| Conf gerada | identidade com `mac0=10:29:A0` | conf antiga preservada |

**COMPROVADA:** ambas as sessões usam MAC **virtual Hyper-V** como `HostMacAddressGet`; a diferença operacional é **qual** virtual está em primeiro lugar, não a troca para Wi-Fi.

---

## 6. O que é comprovado vs o que depende da Destaxa

### COMPROVADO (código)

- Identificar é montado em `ServicoIdentificarEnviar` com `ConnectionIdentifier*` / `IdentifierSet`.  
- Campos `as_hostname` + `as_mac_address` (+ loja/terminal/CNPJ quando aplicável).  
- `HostMacAddressGet` deriva de `HostHardwareAddressGet` **sem** filtro `isVirtual`.  
- `getPhysicalMacAddresses` existe e filtra `isVirtual`/`isLoopback`/`isUp`.  
- `getMacAdressList(hostMac)` combina hardware + physical.

### COMPROVADO (logs / conf)

- `HostMacAddressGet` = MAC Hyper-V nas sessões relevantes.  
- Identidade persistida/observada: `hostname(mac0;…)` com **`mac0 = HostMacAddressGet`**.  
- Wi-Fi entra como MAC secundário na lista, não como primário.  
- Mudança de `mac0` Hyper-V correlaciona com 00151 após ativação sob outro Hyper-V.

### NÃO COMPROVADO

- Dump TLS do XML/binário exato do frame Identificar (não autorizado / não capturado).  
- Se `NetworkInterface.isVirtual()` retorna `true` para vEthernet WSL neste host (explicaria Hyper-V ainda no `MacAdressFilter`).  
- Se o Partner Cloud, ao receber a **lista**, ignora `mac0` e escolhe Wi-Fi internamente.

### DEPENDE DA DESTAXA

- Sentido exato de “MAC capturado é o físico”:  
  - (A) hardware L2 (`getHardwareAddress`) vs IP software — compatível com Hyper-V como “MAC hardware”; ou  
  - (B) NIC física Wi-Fi vs adaptador virtual — **não** sustentado pelos logs locais de identidade primária.  
- Se o filtro de licença usa só Wi-Fi enquanto Identificar usa `mac0` Hyper-V.  
- Procedimento oficial quando `mac0` virtual muda após Ativar.

---

## 7. Conclusão da sprint

| Pergunta | Resposta |
| --- | --- |
| Qual identidade MAC o Client coloca como primária no fluxo Identificar? | **`HostMacAddressGet()` = primeiro `HOST_HARDWARE_ADDRESS`** |
| Nas sessões 09/11 e 10/11, isso foi virtual ou Wi-Fi? | **Virtual Hyper-V/WSL** (`00:15:5D:…`) |
| Wi-Fi física foi a identidade primária enviada? | **Não** (aparece na lista/`MacAdressFilter`, não como `mac0`) |
| Classificação final | **MAC virtual enviado (identidade primária)** |

**Nuance:** “MAC físico” na linguagem Destaxa pode significar endereço de hardware L2 (não IP). Isso **não** contradiz o fato local de o hardware escolhido ser o da NIC virtual Hyper-V. Esclarecimento semântico: **DEPENDE DA DESTAXA**.

**Não implementar correção nesta sprint.**

FIM DO RELATÓRIO TEF-DESTAXA-51.30.
