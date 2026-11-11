# TEF-DESTAXA-51.29 — Relatório

**Sprint:** Estabilização da identidade de rede do V$PagueClient  
**Tipo:** Investigação / documentação (sem alterações operacionais)  
**Data:** 2026-11-10 (America/Sao_Paulo)  
**Base:** `TEF-DESTAXA-51.28/INVESTIGACAO-00151.md`, MRT-50.76, bytecode V$PagueClient 5.0.0  
**Classificação geral:** recomendação técnica entregue; **correção não implementada**

---

## 0. Escopo e restrições cumpridas

Somente leitura de logs, configuração, documentação local e análise estática do JAR (`V$PagueClient.jar` / `vspague-commons`).

**Não executado:** alteração de MAC, desativação/recriação WSL/Hyper-V, edição de `.conf`, cadastro Destaxa, Ativar/Identificar manual, NativeHost, DLL, CRT, COM4, gate, `id=1`, `TefManager.js`, operações fiscais/financeiras. **Não** iniciado processo adicional do V$PagueClient.

---

## 1. Como `HostMacAddressGet()` seleciona o MAC

### 1.1 Evidência de runtime (COMPROVADA)

Nos boots observados (MRT-50.76, 09/11, 10/11):

| Campo de log | Conteúdo típico |
| --- | --- |
| `HOST_MAC_ADDRESS` | lista completa de MACs enumerados |
| `HostMacAddressGet()` | **primeiro** MAC da identidade efetiva enviada no Identificar |
| `MacAdressFilter` | subconjunto (Hyper-V `00:15:5D:*` + Wi-Fi física `C0:A8:10:DB:EE:9E`) |

Padrão recorrente: com adaptadores Hyper-V presentes, `HostMacAddressGet()` **prioriza** `00:15:5D:*` (virtual), não o Wi-Fi.

### 1.2 Evidência de bytecode (COMPROVADA)

Em `lib/VeSUtil.class` (`vspague-commons-1.0.19-…`):

`HostHardwareAddressGet()`:

1. `NetworkInterface.getNetworkInterfaces()`
2. Para cada interface: `getHardwareAddress()` → hex
3. Acumula em lista e aplica `distinct()`

**Não há**, nesse método, chamadas a `isVirtual()`, `isLoopback()`, `isUp()`, filtro por `getDisplayName()` / `getName()`, nem preferência explícita por Wi-Fi/Ethernet físico.

Em `vespague/client/graphic/VeSPagueClient.class`:

- Log formata `HOST_MAC_ADDRESS` / `HostMacAddressGet()` / `MacAdressFilter`
- Métodos relacionados: `getMacAdressList`, `getPhysicalMacAddresses`, `hostMac`, `macAdressList`
- `HostMacAddressGet()` no log usa `HostHardwareAddressGet` (hardware)

**Interpretação comprovável:** a ordem de enumeração do SO + ausência de exclusão de NICs virtuais faz o Client “grudar” em Hyper-V/WSL quando existem.

### 1.3 O que permanece NÃO COMPROVADO

- Critério exato byte-a-byte de montagem de `MacAdressFilter` vs lista completa (há `getPhysicalMacAddresses`, mas a regra de filtro não está documentada nem totalmente reconstruída).  
- Se o Partner Cloud valida só o MAC primário ou o conjunto do filtro.  
- Se existe parâmetro oculto de sistema (`-D…`) para forçar MAC — **não encontrado** no Help do Client.

---

## 2. Existe configuração suportada para interface / `MacAdressFilter`?

### 2.1 Linha de comando oficial do Client (COMPROVADA — ausência)

`VSPagueClientCommandLine.Help` documenta argumentos como:

| Argumento | Função |
| --- | --- |
| host / porta server | endpoint V$PagueServer |
| porta AC | listen aplicação comercial |
| modo | TCP/IP (padrão) |
| traces | server / AC |
| `-elt` | EstabelecimentoLojaTerminal |
| `-atv` | novo processo de ativação |
| `-homolog` | ambiente homologação |
| `-remoteconfig` / `-getcard` / etc. | outros |

**Não há** flag documentada para: MAC preferido, filtro de interface, exclusão Hyper-V/WSL, ou `MacAdressFilter`.

O bat oficial apenas repassa `%*` + `-tls`.

### 2.2 `.conf` (COMPROVADA — não é seletor de MAC)

`V$PagueClient_Destaxa_LojaACB_TACB0120.conf` (LastWriteTime 09/11 12:24:13) **embute** identidade `desktop-4b8amm3(…MAC…)` recebida no **Ativar**, mas:

- não há documentação local de campo editável “preferred MAC”;  
- editar `.conf` para forçar MAC **não** é procedimento suportado nesta base documental;  
- sprint **proíbe** editar/substituir `.conf`.

### 2.3 `as_host_mac_address_exclude` (NÃO COMPROVADA como opção operacional)

Em `lib/VBIMain.class` existe `HostVerify` com parâmetros:

- `as_host_mac_address_exclude`
- `as_host_software_address_exclude`

Porém:

- **não** aparecem no Help do `VSPagueClientCommandLine`;  
- **não** há referência a esses símbolos nas classes do Client inspecionadas;  
- sem manual Destaxa/VBI local descrevendo o uso.

Logo: existência de símbolo interno = **COMPROVADA**; usabilidade oficial pelo operador CDS = **NÃO COMPROVADA** / **DEPENDE DA DESTAXA**.

### 2.4 Documentação local CDS (COMPROVADA)

MRT-50.76 já perguntava à Destaxa: *“Qual MAC deve ser o canônico quando existem Hyper-V + Wi-Fi no MacAdressFilter?”* — **sem resposta anexada** no workspace até esta sprint.

Pacote DLL 1.83 no workspace: **sem** manual de identidade MAC/interface encontrado nesta varredura.

---

## 3. O Client permite priorizar interface física estável?

| Afirmação | Classificação |
| --- | --- |
| Wi-Fi física estável presente (`C0:A8:10:DB:EE:9E`) e recorrente no `MacAdressFilter` | **COMPROVADA** |
| Client escolhe Wi-Fi como `HostMacAddressGet()` quando há Hyper-V Up | **COMPROVADA que NÃO** (padrão oposto nos boots) |
| Existe switch oficial documentado no Client para “priorizar física” | **NÃO COMPROVADA** (não encontrado) |
| Destaxa oferece procedimento de cadastro/filtro no Partner Cloud | **DEPENDE DA DESTAXA** |

---

## 4. Riscos de MAC virtual WSL/Hyper-V

| Risco | Classificação | Evidência |
| --- | --- | --- |
| MAC Hyper-V muda quando WSL/Default Switch é recriado | **COMPROVADA** | 09/11 `10:29:A0` → 10/11 `53:C5:2C`; histórico MRT-50.76 com outros `00:15:5D:*` |
| Identificar volta a **00151** após mudança de MAC primário | **COMPROVADA** | INVESTIGACAO-00151 |
| `.conf` permanece da ativação antiga enquanto identidade runtime diverge | **COMPROVADA** | conf 12:24:13 vs boot 13:29 |
| Listener 60906 pode subir mesmo com 00151 | **COMPROVADA** | boot 51.28 |
| Homologação CRT sob identidade instável | risco operacional **COMPROVADO** como dependência | CRT histórica usou sessão ativada com MAC estável naquele momento |
| Side-effect de desligar WSL/Hyper-V (dev, containers, VPN) | risco de ambiente | **NÃO mensurado aqui**; fora de escopo de execução |

---

## 5. Alternativas tecnicamente possíveis (sem implementar)

### A) Procedimento oficial Destaxa: re-vínculo / reativação ao MAC atual

- **O quê:** Destaxa confirma se o terminal `TACB0120` deve ser atualizado no Partner Cloud para o MAC atual (`00:15:5D:53:C5:2C` e/ou Wi-Fi), e qual passo oficial (`Ativar`, portal, suporte) após estabilizar a NIC.  
- **Consequência:** alinha cadastro ↔ `HostMacAddressGet()`; pode exigir novo boot controlado.  
- **Classificação:** **DEPENDE DA DESTAXA** (caminho preferencial).  
- **Risco:** se o MAC continuar sendo Hyper-V, o problema **recorrerá** no próximo recreate.

### B) Estabilizar identidade no SO para NIC física (Wi-Fi `…:EE:9E`)

- **O quê (conceitual):** fazer com que a enumeração de `NetworkInterface` apresente a física como identidade estável usada pelo Client (hoje o Client não filtra virtuais).  
- **Consequência:** potencial `HostMacAddressGet()` = Wi-Fi; ainda pode exigir **Ativar/re-cadastro** Destaxa porque o terminal foi ativado sob outro MAC.  
- **Classificação da eficácia:** **DEPENDE DA DESTAXA** (se aceitam Wi-Fi) + mudança OS **fora desta sprint** (proibida aqui).  
- **Riscos:** impacto WSL/Hyper-V; sem garantia de ordem de enumeração Java; não há knob oficial no Client.

### C) Descobrir/usar exclusão oficial (`mac_address_exclude` / filtro)

- **O quê:** Destaxa/VBI documentar se `HostVerify` / exclusões são suportadas em produção e como parametrizar.  
- **Consequência:** se existir, permitiria excluir `00:15:5D:*` sem “inventar” conf.  
- **Classificação:** **DEPENDE DA DESTAXA** (símbolo interno existe; uso operacional **NÃO COMPROVADO**).  
- **Risco:** uso não oficial = suporte fragilizado.

### D) Editar `.conf` localmente para embutir outro MAC

- **Classificação:** **NÃO COMPROVADA** como suportada; **proibida** nesta sprint.  
- **Risco alto:** dessincronia com Partner Cloud; ativação seguinte pode sobrescrever; 00151 pode persistir se Identificar usar MAC runtime, não só blob.

### E) Manter Hyper-V e apenas “ignorar” 00151 porque 60906 sobe

- **Classificação:** **COMPROVADA** como fato (listener sobe), **inadequada** como estabilização.  
- **Risco:** Identificar rejeitado; CRT/cloud imprevisível; falsa sensação de prontidão (já marcada PARCIAL na 51.28).

### F) Novo `.conf` sem causa / remap CDS

- **Proibido** e **sem evidência** de necessidade: conf atual é o da ativação válida. Problema é identidade runtime × cadastro.

---

## 6. Recomendação técnica fundamentada

1. **Tratar a causa como identidade de terminal volátil (Hyper-V/WSL), não como conf corrompida** — COMPROVADA (51.28).  
2. **Não editar `.conf` nem inventar mapeamento CDS** — restrição + ausência de suporte local.  
3. **Abrir consulta objetiva à Destaxa** (texto abaixo) pedindo o procedimento oficial de atualização/vinculação quando o MAC do Identificar muda, e se há forma suportada de fixar NIC física / excluir virtuais.  
4. **Somente após resposta Destaxa + autorização PO:** sprint operacional futura (boot controlado / eventual Ativar / validar ausência de 00151).  
5. Meta de estabilidade: identidade cujo `HostMacAddressGet()` **não mude** entre boots (preferencialmente NIC física estável **se Destaxa confirmar**).

---

## 7. Consulta objetiva à Destaxa (pronta para envio)

```text
Assunto: Procedimento oficial — identidade MAC do V$PagueClient / 00151 após troca de HostMacAddressGet

Estação: desktop-4b8amm3
Client: V$PagueClient 5.0.0 (Destaxa)
Endpoint: app-partner.destaxa.cloud:60410 (TLS)
Identidade conf: Destaxa-LojaACB-TACB0120
Arquivo: V$PagueClient_Destaxa_LojaACB_TACB0120.conf (versão 20261109120020; recebido em Ativar 2026-11-09 12:24:13)

Fatos:
1) Em 2026-11-09 12:24:11, HostMacAddressGet()=00:15:5D:10:29:A0 → Identificar sem 00151 → Terminal ativado.
2) Em 2026-11-10 13:29:41, HostMacAddressGet()=00:15:5D:53:C5:2C (vEthernet WSL) → Identificar com [00151].
3) O MAC 00:15:5D:10:29:A0 não existe mais nos adaptadores da estação.
4) Wi-Fi física estável: C0:A8:10:DB:EE:9E (aparece no MacAdressFilter, mas não é HostMacAddressGet quando há Hyper-V).
5) Conf local não foi regenerado após a ativação; não há PID duplicado na sessão atual.

Perguntas:
Q1) Qual é o procedimento oficial para atualizar/re-vincular a identidade do terminal quando HostMacAddressGet() muda após Ativar?
Q2) O Partner Cloud valida apenas o MAC primário (HostMacAddressGet) ou também o MacAdressFilter?
Q3) Existe configuração/suporte oficial para o Client priorizar interface física (ex.: Wi-Fi C0:A8:10:DB:EE:9E) ou excluir MACs Hyper-V/WSL (00:15:5D:*)?
Q4) O parâmetro interno de exclusão de MAC (HostVerify / mac_address_exclude), se existir para o produto Destaxa, é suportado em produção? Como parametrizar?
Q5) Após estabilizar a NIC desejada, devemos executar novo Ativar, apenas Identificar, ou há ação exclusiva no portal Partner Cloud?
Q6) Qual MAC deve ser considerado canônico para homologação desta estação (Hyper-V atual vs Wi-Fi física)?

Restrições CDS: não alteraremos cadastro/.conf/MAC/adaptadores sem orientação oficial Destaxa + autorização interna.
```

---

## 8. Matriz de conclusões

| # | Conclusão | Classificação |
| --- | --- | --- |
| 1 | 00151 da 51.28 veio de troca de `HostMacAddressGet` Hyper-V/WSL | **COMPROVADA** |
| 2 | `HostHardwareAddressGet` enumera NICs via `NetworkInterface` sem filtrar virtuais | **COMPROVADA** |
| 3 | Help do Client não expõe opção de MAC/interface | **COMPROVADA** |
| 4 | `.conf` atual é o da ativação 12:24; não é seletor documentado de MAC | **COMPROVADA** |
| 5 | Existe símbolo `as_host_mac_address_exclude` no commons | **COMPROVADA** (existência) |
| 6 | Esse exclusor é opção operacional suportada Destaxa | **NÃO COMPROVADA** / **DEPENDE DA DESTAXA** |
| 7 | Client pode ser configurado (doc oficial) para preferir Wi-Fi | **NÃO COMPROVADA** |
| 8 | Destaxa deve informar procedimento oficial de re-vínculo/Ativar/filtro | **DEPENDE DA DESTAXA** |
| 9 | Editar `.conf` resolve 00151 com segurança | **NÃO COMPROVADA** (e proibida) |
| 10 | Correção implementada nesta sprint | **não aplicável** — documentação apenas |

---

## 9. Critério de conclusão

Entregue:

- investigação estática de seleção de MAC;  
- ausência comprovada de knob CLI documentado;  
- riscos de identidade virtual;  
- alternativas com consequências;  
- consulta Destaxa pronta;  
- recomendação: **aguardar Destaxa** antes de qualquer estabilização operacional.

**Não declarar ambiente pronto para CRT** com base nesta sprint.

FIM DO RELATÓRIO TEF-DESTAXA-51.29.
