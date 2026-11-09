# MRT-50.71 — Validação de configuração e roteamento Destaxa

| Campo | Valor |
|---|---|
| Timestamp | `20261107T211800Z` |
| Tipo | Auditoria operacional / preparação documental |
| Dependência | MRT-50.70 (INCONCLUSIVO) |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | `0` (OFF) — verificado |
| NativeHost / DLL / TX / mutações | **Nenhuma** |
| Banco | Somente leitura (`mode=ro` + `PRAGMA query_only=ON`) |
| MRT-50.69 | Permanece encerrada (`05` / `financialState=UNKNOWN`) — não reutilizada |

---

## 1. Resumo executivo

Os três códigos Destaxa de roteamento (`estabelecimento`, `loja`, `terminal`) **não estão comprovados** em nenhuma fonte oficial disponível no projeto nem no cadastro CDS (todos **null**). O identificador operacional V$Pague `LojaACB-TACB0120` / `Destaxa-LojaACB-TACB0120` está **comprovado** em log e no nome do `.conf`, mas **não** pode ser transformado automaticamente nos três campos da API.

Cadastro CDS confirma: provedor `destaxa`, ambiente `homologacao`, equipamento `GERTEC_PPC930`, `porta_com=COM4`. Windows PnP confirma COM4 = `PPC-920/930 CDC USB-to-Serial Port`. A porta efetiva selecionada no V$Pague para o PinPad permanece **NÃO VERIFICÁVEL** pelo `.conf` (serialização Java; 0 ocorrências de `COM4`) sem coleta manual na UI.

Doc oficial Destaxa 1.83: `estabelecimento` / `loja` / `terminal` são **opcionais** em `iniciaClientDestaxa`. Aplicação `CDS Sistemas` / `versao=1.0.3` foi aceita no `iniciar` (log 18:01:22). A CRT da 50.69 foi rejeitada pelo Client com `retorno:5` e mensagem sobre `transacao_tipo_cartao` — evidência de log já existente, sem nova TX nesta sprint.

**Parecer final: `PENDENTE DE FORNECEDOR`**

---

## 2. Códigos oficiais encontrados ou pendentes

| Item | Valor encontrado | Origem | Classificação |
|---|---|---|---|
| Código estabelecimento Destaxa | — | Banco CDS null; docs API sem literais de homologação ACB; `.conf` opaco | **PENDENTE DE CONFIRMAÇÃO OFICIAL DESTAXA/ACB** |
| Código loja Destaxa | — | Idem | **PENDENTE DE CONFIRMAÇÃO OFICIAL DESTAXA/ACB** |
| Código terminal Destaxa | — | Idem | **PENDENTE DE CONFIRMAÇÃO OFICIAL DESTAXA/ACB** |
| Identificador aplicação | `CDS Sistemas` | Constante CDS + log V$Pague `servico:iniciar` aceito | **COMPROVADO** (uso operacional); cadastro Partner Cloud ainda a confirmar com fornecedor |
| Versão aplicação | `1.0.3` | Init 50.69 / projeção 50.70 / log V$Pague | **COMPROVADO** |
| Identidade terminal V$Pague | `LojaACB-TACB0120` / `Destaxa-LojaACB-TACB0120` | Log Client + nome `.conf` | **COMPROVADO** como identidade de Client — **não** como trio API |
| Strings no `.conf` (não códigos API) | `LojaACB`, `ACBR`, `Destaxa - ACB`, CNPJ textual `18.760.540/0001-39` | Dump textual 50.70 | Existência **COMPROVADA**; **proibido** usar CNPJ/ACBR como substitutos dos códigos Destaxa sem confirmação oficial |

**Não inventado / não adotado:** mapear `LojaACB`→loja, `TACB0120`→terminal, CNPJ→estabelecimento, ou qualquer EST1/LJ1/T1 de fixture de teste.

Doc oficial consultada (somente leitura):  
`C:\Users\cicer\Desktop\DLL DESTAXA\1_83-...\1_83\docs\05-api-iniciaclientdestaxa.md` — campos `estabelecimento`/`loja`/`terminal` = **Não** obrigatórios.

---

## 3. Auditoria do cadastro CDS (Etapa B)

Fonte: `consulta-cadastro-ro.json` (este diretório). Gravacao: `false`.

### `tef_configuracao` (id=1)

| Campo | Esperado (referência) | Observado | Status |
|---|---|---|---|
| provedor | destaxa | `destaxa` | COMPROVADO |
| ambiente | homologacao | `homologacao` | COMPROVADO |
| tipo_integracao | dll | `dll` | COMPROVADO |
| empresa_codigo (→ estabelecimento) | null | `null` | COMPROVADO (ausência) |
| loja_codigo | null | `null` | COMPROVADO (ausência) |
| terminal_codigo | null | `null` | COMPROVADO (ausência) |
| pdv_codigo / caixa_codigo | — | `null` / `null` | COMPROVADO |
| ip_tef / porta_tef / sdk_path | — | `null` | COMPROVADO |

### `tef_pinpads` (id=1 → `tef_configuracao_id=1`)

| Campo | Esperado | Observado | Status |
|---|---|---|---|
| codigo | GERTEC_PPC930 | `GERTEC_PPC930` | COMPROVADO |
| fabricante / modelo | Gertec / PPC930 | `Gertec` / `PPC930` | COMPROVADO |
| porta_com | COM4 | `COM4` | COMPROVADO |
| habilitado / ativo | 1 | `1` / `1` | COMPROVADO |
| status operacional CDS | — | `desconhecido` | COMPROVADO (não valida PinPad vivo) |
| serial / ultima_conexao | — | `null` / `null` | COMPROVADO |

### Outras tabelas

- `tef_configuracoes` (KV): **vazio** — sem códigos alternativos.
- Varredura de tabelas com colunas `empresa*` / `loja_cod*` / `terminal_cod*` / `estabelecimento*`: nenhuma outra tabela de configuração TEF Destaxa com literais oficiais preenchidos para roteamento DLL (demais hits são domínio fiscal/caixa/OF, não códigos Destaxa).

**Conclusão cadastro:** referência da sprint confirmada; **nenhum** código Destaxa gravável foi encontrado em modo RO. Nenhuma gravação realizada.

---

## 4. Evidências V$Pague (Etapa C)

Fontes: log existente + artefatos 50.70 + histórico mrt-17/18/34. **Sem** automação de UI, sem restart, sem teste de comunicação.

### Identidade / cadastro Client

| Evidência | Conteúdo | Status |
|---|---|---|
| Log 00:22:04 e 15:20:46 | `iniciando Destaxa-LojaACB-TACB0120` | COMPROVADO (identidade) |
| `.conf` | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` (presente; LastWriteTime 05/11/2026) | COMPROVADO |
| Histórico mrt-34 | Partner Cloud: “Terminal ativado” + entrega do `.conf` | COMPROVADO (histórico) |
| Terminal “ativo” agora na UI | — | **NÃO VERIFICÁVEL** nesta sprint (requer checklist operador) |
| PPC-930 associada ao terminal no V$Pague | — | **NÃO VERIFICÁVEL** (`.conf` lista modelos genéricos; sem vínculo legível COM/PPC-930) |
| Porta COM no V$Pague | literal `COM4` no dump = 0 | **NÃO VERIFICÁVEL** pelo arquivo |

### Erros já disponíveis no log (sem nova TX)

Arquivo: `C:\VBI\V$Pague\Client\logs\vspague-client.log`  
Extrato: `evidencias-vspague-log-ro.json`

Na janela da MRT-50.69 (`2026-11-07 18:01:22`):

1. `iniciar` com `aplicacao:CDS Sistemas`, `versao:1.0.3` → aceito (`retorno:1`).
2. `executar` CRT `tipoCartao:Débito`, `valor:1.00`, `pagamento:A vista` → Client erro: `Tag <transacao_tipo_cartao> inexistente ou seu conteudo é inválido` → `retorno:5`.

Isso **não** prova falha de PinPad nem valida/invalida os códigos nulos; prova que o Client rejeitou o conteúdo da tag no momento da CRT. Correlação com `05` da 50.69 é documental; estado financeiro UNKNOWN **não** foi alterado.

Erros anteriores no mesmo log: timeout Identificar (00:21) e “Problema de conexão!” (15:20) — rede Partner Cloud, sem menção a COM/PinPad.

### Procedimento manual pendente

Ver `checklist-operador-vspague.md` — operador deve informar status UI, associação PinPad e porta COM efetiva **sem** salvar alterações.

---

## 5. Situação da PPC-930 e COM

| Camada | Evidência | Status |
|---|---|---|
| Windows PnP / Serial | `PPC-920/930 CDC USB-to-Serial Port (COM4)` — Status OK (coletado RO nesta sprint) | COMPROVADO |
| CDS `tef_pinpads.porta_com` | `COM4` | COMPROVADO |
| Alinhamento Windows ↔ CDS | Ambos COM4 | COMPROVADO (coincidência) |
| V$Pague porta efetiva PinPad | Não legível no `.conf`; UI não consultada por automação | **NÃO VERIFICÁVEL** |
| Tríade Windows/CDS/V$Pague | Dois lados alinhados; terceiro pendente | **PENDENTE** (não DIVERGENTE comprovada) |
| PinPad operacional | CDS `status=desconhecido`; log Client sem linha PinPad | **NÃO VERIFICÁVEL** |

**Classificação COM4:** alinhada CDS↔Windows; associação operacional V$Pague **pendente de confirmação manual/fornecedor**.

---

## 6. Matriz de validação (Etapa E)

| Item | Evidência disponível | Status | Ação pendente |
|---|---|---|---|
| Estabelecimento | Banco null; API opcional; sem literal oficial ACB | **PENDENTE** | Confirmar código oficial Destaxa/ACB |
| Loja | Banco null; `LojaACB` só identidade/conf | **PENDENTE** | Confirmar código oficial (não usar `LojaACB` sem OK) |
| Terminal | Identidade `TACB0120` no Client; banco null | **PENDENTE** | Confirmar se `TACB0120` (ou outro) é o literal `terminal` da API |
| Aplicação | `CDS Sistemas` no init + aceito no log | **COMPROVADO** (envio/aceitação local) | Confirmar cadastro Partner Cloud com Destaxa |
| PPC-930 | CDS `GERTEC_PPC930`; Windows COM4 PPC-920/930 | **COMPROVADO** (cadastro local + PnP) | Confirmar associação no V$Pague (UI operador) |
| Porta COM | CDS COM4 = Windows COM4; V$Pague N/V | **PENDENTE** (parcial) | Confirmar porta efetiva no V$Pague |

Legenda usada: apenas **COMPROVADO** | **PENDENTE** | **DIVERGENTE** | **NÃO VERIFICÁVEL**.  
Nenhuma linha **DIVERGENTE** comprovada nesta sprint (ausência V$Pague ≠ divergência).

---

## 7. Pendências Destaxa/ACB (Etapa D)

Separação: **já documentado** × **confirmação fornecedor**.

### Já documentado (projeto / API / logs)

1. `estabelecimento` / `loja` / `terminal` são opcionais na doc 1.83 de `iniciaClientDestaxa`.
2. CDS envia só `versao` + `aplicacao` (+ logs) quando códigos null.
3. Identidade Client = `Destaxa-LojaACB-TACB0120`.
4. Aplicação enviada: `CDS Sistemas` / `1.0.3`; `iniciar` aceito.
5. CRT 50.69: Client retornou 5 com mensagem de `transacao_tipo_cartao` (log).
6. Doc CRT: `transacao_tipo_cartao` = `Débito` ou `Credito` (com acento em Débito na doc 06).

### Perguntas objetivas ao fornecedor

1. Qual é o código de **estabelecimento**?
2. Qual é o código de **loja**?
3. Qual é o código de **terminal**?
4. Os três campos são obrigatórios para CRT em homologação mesmo sendo opcionais na doc?
5. A aplicação `CDS Sistemas` está corretamente cadastrada no Partner Cloud?
6. O identificador `LojaACB-TACB0120` corresponde a qual cadastro (estabelecimento/loja/terminal)?
7. A PPC-930 está vinculada a esse terminal?
8. Qual porta COM deve estar associada ao equipamento no V$Pague?
9. Qual é o procedimento oficial para confirmar prontidão do PinPad **sem** executar compra?
10. *(extra, evidência 50.69)* O literal `Débito` (com acento) é o valor aceito pelo Client em homologação, ou deve ser outro (`Debito` / código)?

---

## 8. Proposta documental de configuração (Etapa F)

**Somente documental. Não implementar. Não gravar banco. Não alterar código.**

| Campo | Proposta |
|---|---|
| Código estabelecimento | **PENDENTE** |
| Código loja | **PENDENTE** |
| Código terminal | **PENDENTE** |
| Aplicação | `CDS Sistemas` (**COMPROVADO**) |
| Versão | `1.0.3` (**COMPROVADO**) |
| Equipamento | `GERTEC_PPC930` / Gertec PPC930 (**COMPROVADO** no CDS) |
| Porta COM (CDS/Windows) | `COM4` (**COMPROVADO** alinhamento local) |
| Porta COM (V$Pague) | **PENDENTE** confirmação UI/fornecedor |

Qualquer gravação futura de `empresa_codigo` / `loja_codigo` / `terminal_codigo` exige: (a) literais oficiais Destaxa/ACB; (b) aprovação explícita de sprint de configuração.

---

## 9. Próxima ação segura

1. Enviar ao Destaxa/ACB a lista da seção 7 (itens 1–10).
2. Operador preencher `checklist-operador-vspague.md` (somente leitura visual; sem salvar).
3. **Não** reabrir MRT-50.69; **não** nova CRT; **não** NativeHost; gate permanece OFF.
4. Após códigos oficiais + confirmação COM no V$Pague: sprint dedicada de **gravação aprovada** (se autorizada) → só então eventual CRT com autorização pontual nova e independente.

---

## 10. Conformidade das restrições

| Restrição | Cumprida |
|---|---|
| Gate OFF | Sim (`GATE=0`) |
| Sem NativeHost / DLL / PinPad / TX / retry / reconcile | Sim |
| Sem alteração código / banco / `.conf` / V$Pague | Sim |
| Sem inventar códigos | Sim |
| Sem SEFAZ / Git destrutivo / commit | Sim |
| Consulta DB RO | Sim |

---

## Parecer final

### `PENDENTE DE FORNECEDOR`

Roteamento Destaxa (estabelecimento/loja/terminal) permanece sem literais oficiais; cadastro CDS e COM4 local estão auditados; associação PinPad/COM no V$Pague e cadastro Partner Cloud dependem de Destaxa/ACB e coleta manual do operador.

**Aguardando aprovação. Nenhuma sprint seguinte iniciada automaticamente.**
