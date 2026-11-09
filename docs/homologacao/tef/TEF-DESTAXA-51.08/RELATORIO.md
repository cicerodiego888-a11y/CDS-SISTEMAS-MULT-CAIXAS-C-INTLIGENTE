# TEF-DESTAXA-51.08 — Abertura controlada do PDV workspace e validação 51.05

**Status:** CONCLUÍDA (preparação operacional; **sem** transação financeira)  
**Data:** 2026-11-09 (~15:30 America/Sao_Paulo)  
**Classificação final:** **PREPARADO**  
**Autorização financeira:** **não concedida** nesta sprint (proibida)

---

## 1. Workspace utilizado

`C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE`

Confirmado como CWD antes do start. **Não** usados: `C:\CDS-SISTEMAS`, `C:\Program Files\CDS PDV`.

---

## 2. Comando de inicialização

```text
.\node_modules\.bin\electron.cmd electron-pdv.js --cds-forcar-local
```

- WorkingDirectory = workspace autorizado  
- Wrapper cmd PID **12344**  
- Logs de boot redirecionados (somente captura) para:  
  - `docs/homologacao/tef/TEF-DESTAXA-51.08/pdv-stdout.log`  
  - `docs/homologacao/tef/TEF-DESTAXA-51.08/pdv-stderr.log`

### Pré-checks (antes do start)

| Item | Resultado |
| --- | --- |
| Entrypoint `electron-pdv.js` | Presente (190 bytes) |
| Outra instância PDV/Electron | Ausente |
| NativeHost / operação em voo | Ausente |
| V$Pague reiniciado | **Não** (PID 10256 preservado) |
| Logs / financeiro anterior | Preservados |

---

## 3. PID e responsividade

| Papel | PID | Responding | Evidência |
| --- | --- | --- | --- |
| Main Electron | **6464** | **True** | Título janela **CDS Sistemas - PDV** |
| GPU | 5680 | True | filho de 6464 |
| Network utility | 11160 | True | filho de 6464 |
| Renderer | 11588 | True | `--app-path="C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE"` |
| Backend HTTP | — | — | `HTTP LISTENING` porta **3001** (~727 ms) |

CommandLine do main (prova de workspace, não só disco):

```text
"C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE\node_modules\electron\dist\electron.exe" electron-pdv.js --cds-forcar-local
```

Auditoria de boot da **instância viva** (`[RC3.16.4][ELECTRON-AUDIT] startup`):

| Campo | Valor |
| --- | --- |
| `dirname` | `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |
| `modulo` | `pdv` |
| `rodandoDeAsar` | **false** |
| `execPath` | `...\node_modules\electron\dist\electron.exe` (workspace) |
| `versionElectron` | 22.3.27 |
| `versionErp` | 1.0.3 |

Event loop: Responding=True no main; HTTP up; sem hang observado nesta sprint.

---

## 4. Evidências de carregamento da 51.05

### 4.1 A instância leu os arquivos do workspace (não só “existem no disco”)

No boot, o próprio PDV executou integridade RC3.16.6 sobre a árvore carregada e reportou **hash divergente** (vs manifesto congelado) precisamente nos módulos alterados pela linha Destaxa/51.05, incluindo:

- `backend/services/tef/TefManager.js`
- `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js`
- `backend/services/tef/destaxa/destaxaContinuidadeContrato.js`
- `backend/services/tef/index.js`
- `frontend/pdv/js/pdvTefContinuidade.js`
- adapters/bridges Destaxa correlatos

Isso só ocorre se o processo **abriu e hasheou** esses paths relativos ao `dirname` do workspace. `rodandoDeAsar=false` confirma carga do filesystem do workspace.

`integridade: false` / status `ERRO` no manifesto é **esperado** após patches 51.05 sem republicar manifesto — **não** indica hang nem uso de árvore errada. Registrado como aviso operacional.

### 4.2 Símbolos 51.05 no mesmo app-path

Probe Node (somente leitura) resolvendo os **mesmos paths absolutos** do `dirname` da instância:

| Símbolo / marcador | Resultado |
| --- | --- |
| `ehColetaDelegadaAoPinPad` | `function` (`destaxaContinuidadeEstados.js`) |
| `resolverRespostaContinuidade` | `function` (`destaxaCrtCicloOrquestracao.js`) |
| `pinpad_ack_vazio` | presente no fonte do ciclo |
| `_liberarSlotExecucaoParaContinuidade` | presente em `TefManager.js` |
| Probe PinPad `transacao_cartao_numero` | `true` |

Paths resolvidos:

- `...\backend\services\tef\destaxa\destaxaContinuidadeEstados.js`
- `...\backend\services\tef\destaxa\destaxaCrtCicloOrquestracao.js`

Arquivo novo `destaxaContinuidadeEstados.js` pode não constar no manifesto antigo (não listado em “hash divergente”); é requerido pelo ciclo que **foi** hasheado no boot.

### 4.3 Encadeamento de prova

1. Main 6464 → CommandLine workspace + `electron-pdv.js --cds-forcar-local`  
2. Renderer → `--app-path` = workspace  
3. Audit boot → `dirname` = workspace, `rodandoDeAsar=false`  
4. Integridade boot → leu `TefManager` / `destaxaCrtCicloOrquestracao` / `pdvTefContinuidade` dessa árvore  
5. Símbolos 51.05 presentes nessa árvore  

**Conclusão:** a instância aberta **utiliza o workspace correto** com o código 51.05.

---

## 5. Estado do TefManager

| Item | Achado |
| --- | --- |
| Perfil TEF | `[TEF] Contexto criptográfico do perfil validado` (`modulo: pdv`) |
| Chave | `[TEF] Chave original recuperada pelo armazenamento protegido` |
| userData | `C:\Users\cicer\AppData\Roaming\cds-sistemas-pdv` |
| Backend | HTTP **3001** no mesmo boot |
| NativeHost | **Não** iniciado (correto — sem TX) |
| Slot `_emExecucao` / hang | Sem evidência de bloqueio; main Responding |

Nenhuma chamada TEF operacional foi feita para “pingar” o manager além do boot natural.

---

## 6. Estado V$Pague e PinPad (somente leitura)

| Item | Valor |
| --- | --- |
| VSPagueClient | PID **10256**, Responding, desde 12:24:10 (**não reiniciado**) |
| Listener | TCP **60906** LISTENING (10256) |
| Versão (log histórico) | Client **5.0.0** |
| COM4 | OK — `PPC-920/930 CDC USB-to-Serial Port` |
| PinPad conhecido | Gertec PPC-930 (sessão 51.03) |
| Comunicação operacional | **Nenhuma** nesta sprint |

---

## 7. Estado do gate

| Escopo | `DESTAXA_REAL_TRANSACTION_ENABLED` |
| --- | --- |
| User | vazio |
| Machine | vazio |
| Process (shell) | `0` |

Gate permanece **OFF**. Não habilitado.

---

## 8. Ledger intacto

Arquivo: `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`

| Momento | SHA256 | mtime UTC |
| --- | --- | --- |
| Antes do start | `5CE9D885483A6629FCBC1555F32E184E94BAE88E5FD46541C5062D9A7B953B0B` | 2026-11-09T16:58:43.030Z |
| Depois da validação | **idêntico** | **idêntico** |

Conteúdo: auth `5aed71f2b6e19f7f14303f69242c6796` permanece **CONSUMED** (100 centavos). **Sem** emissão/consumo/alteração.

---

## 9. Bloqueios / avisos encontrados

| Severidade | Item |
| --- | --- |
| Aviso | Integridade RC3.16.6 = `ERRO` por hashes divergentes pós-51.05 (manifesto desatualizado). Não impede boot; documentar republicação de manifesto em sprint própria se necessário. |
| Aviso | Central Entradas / MIIP health crítico no stdout — **fora do escopo TEF**; não bloqueou PDV. |
| Info | Ledger ainda **CONSUMED** — próxima CRT exigirá **nova** auth excepcional com ordem expressa (fora desta sprint). |
| Info | Risco residual **TABELA EXPIRADA** (51.03/07) permanece no PinPad — não exercitado aqui. |

**Nenhum bloqueio** que anule a classificação PREPARADO para o objetivo desta sprint (PDV aberto + 51.05 em execução no workspace).

---

## 10. Restrições respeitadas

Sem venda de teste, CRT, TX_*, DLL, NativeHost operacional, emissão/consumo de auth, alteração de ledger, gate ON, reinício V$Pague, config Destaxa, fiscal/F12/SEFAZ, serialização `informacao=`, pagamento.

---

## STATUS FINAL

**PREPARADO** — PDV workspace aberto, responsivo, `dirname`/CommandLine/`app-path` no workspace autorizado, módulos 51.05 evidenciados via boot+integridade+símbolos.

Isto **não** autoriza emissão/consumo de autorização excepcional nem qualquer operação financeira. Etapa financeira posterior exige ordem expressa e pontual do responsável.
