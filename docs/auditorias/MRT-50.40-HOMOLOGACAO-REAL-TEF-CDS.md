# MRT-50.40 — Homologação real da infraestrutura ERP/PDV

## Conclusão executiva

**Resultado: PARCIAL — startup de desenvolvimento concluído; homologação TEF real não aprovada.**

ERP e PDV iniciaram pelo fluxo normal com Electron 22.3.27, conectaram ao banco oficial, iniciaram o backend e carregaram a interface de login. O contexto SafeStorage esperado foi validado e os logs registraram a recuperação da chave original. Porém, o fingerprint não foi emitido pelo log desta execução e não foi recalculado, conforme a orientação de não reabrir a prova MRT-50.38. O NativeHost Destaxa não foi iniciado; portanto, a disponibilidade real do cliente e a comunicação Destaxa não foram comprovadas.

O diagnóstico RC3.16.6 continuou em `ERRO`: o manifesto diverge do checkout. Em desenvolvimento essa condição foi apenas advertida e não impediu a inicialização; o pacote ASAR não foi iniciado nem homologado. No PDV também ocorreu erro ao resolver a política F12 por ausência de caixa identificado. Nenhum login, operação financeira ou operação TEF foi executado.

## Escopo e ambiente

- Banco autorizado: `C:\ProgramData\MercantilFiscal\dados\mercadao.db`.
- ERP: `npm run start:erp`; PDV: `npm run start:pdv`.
- Em ambos: `DB_DIR` apontou para o diretório do banco, `DESTAXA_REAL_TRANSACTION_ENABLED=0`, e `TEF_ENCRYPTION_KEY` foi removida do ambiente herdado antes do lançamento.
- Electron observado: `22.3.27`; runtime Node reportado pelo diagnóstico: `16.17.1`.
- Nenhum arquivo de código ou configuração do projeto foi alterado. Este relatório é o único arquivo criado.
- Os dois aplicativos foram fechados graciosamente após a observação. A porta 3001 ficou sem listener e não restou processo NativeHost.

## Inicialização ERP

**Classificação: CONCLUÍDO para startup de desenvolvimento até a interface.**

Logs observados:

```text
[TEF] Contexto criptográfico do perfil validado:
  modulo: erp
  userDataPath: ...\AppData\Roaming\cds-sistemas-erp
  localStateSha256: 26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040
  localStateInstalado: false
[TEF] Chave original recuperada pelo armazenamento protegido:
  modulo: erp
  etapa: provisionamento-da-chave
  origem: armazenamento-protegido
{"tag":"BOOT","evento":"DATABASE READY",...}
{"tag":"BOOT","evento":"HTTP LISTENING",...,"port":3001}
{"tag":"BOOT","evento":"BACKGROUND READY",...}
```

O perfil específico do ERP foi selecionado; o backend conectou ao banco e a porta 3001 respondeu HTTP 200 em `/ping`. A janela carregou a interface do ERP. Não foi observado erro de configuração criptográfica do TefManager nos logs, mas seu estado interno não foi consultado por uma API de diagnóstico.

## Inicialização PDV

**Classificação: CONCLUÍDO até a interface de login; BLOQUEADO para prontidão operacional do caixa.**

Logs observados:

```text
[TEF] Contexto criptográfico do perfil validado:
  modulo: pdv
  userDataPath: ...\AppData\Roaming\cds-sistemas-pdv
  localStateSha256: 26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040
  localStateInstalado: false
[TEF] Chave original recuperada pelo armazenamento protegido:
  modulo: pdv
  etapa: provisionamento-da-chave
  origem: armazenamento-protegido
{"tag":"BOOT","evento":"DATABASE READY",...}
{"tag":"BOOT","evento":"HTTP LISTENING",...,"port":3001}
{"tag":"BOOT","evento":"BACKGROUND READY",...}
```

O PDV conectou ao banco, `/ping` respondeu HTTP 200 e a janela carregou `/login?modulo=pdv`. Antes de qualquer login, o frontend registrou:

```text
[F12] Não foi possível identificar o caixa atual.
[F12] Erro ao resolver F12 inicial via policy: Error: caixa-nao-identificado
[F12] mecanismo antigo não será usado como fonte do PDV.
```

Assim, a tela de login foi carregada, mas a tela operacional do PDV e a resolução de caixa não foram homologadas.

## Chave e cliente Destaxa

| Item | Resultado |
|---|---|
| Contexto Local State ERP/PDV | **CONCLUÍDO** — ambos validaram o SHA-256 esperado acima e os perfis separados. |
| Recuperação da chave | **CONCLUÍDO** — os dois logs indicaram `armazenamento-protegido`; nenhum valor da chave foi impresso. |
| Fingerprint `1c6d56245ac4e501` | **NÃO COMPROVADO nesta execução** — não aparece nos logs capturados. A recuperação/fingerprint aprovados no MRT-50.38 foram tratados como ponto de partida, sem repetir a prova. |
| Erro criptográfico do TefManager | **Não observado** nos logs. O estado interno do manager não foi consultado diretamente. |
| NativeHost / disponibilidade Destaxa | **NÃO COMPROVADO** — nenhum processo `DestaxaNativeHost.js` foi observado e o host não foi iniciado. Não houve comunicação validada com DLL, V$Pague ou PinPad. |
| Transação real | **Não executada** — gate mantido em `0`; `tef_transacoes` permaneceu sem registros. |

## Integridade RC3.16.6

**Classificação: BLOQUEADO para pacote íntegro/ASAR; não impediu o modo de desenvolvimento observado.**

- **ERP:** diagnóstico `ERRO`, 14 itens: manifesto `pdv` incompatível com o módulo `erp`, 12 hashes divergentes e divergência de `package.json` efetivo versus manifesto.
- **PDV:** diagnóstico `ERRO`, 12 hashes divergentes. O manifesto aponta `pdv`; não foi reportada incompatibilidade de módulo no diagnóstico do PDV.
- Entre os arquivos com hashes divergentes estavam `backend/database.js`, `backend/services/tef/tefSigningKeyProvisioner.js`, `electron-common.js`, `electron-pdv.js` e arquivos fiscais/frontend.
- O manifesto registra Node `24.19.0`, enquanto o runtime observado foi Node `16.17.1`.
- Nos dois processos, `rodandoDeAsar=false`; o próprio diagnóstico informou que, em desenvolvimento, a inconsistência não aborta. Não foram regenerados manifestos nem alterados arquivos para contornar o gate.
- Também houve aviso `clearCodeCaches falhou: Insufficient number of arguments`; `clearCache` foi concluído, mas `clearCodeCaches` não. Não impediu a abertura da interface.

## Banco, migrações e efeitos observados

As verificações do arquivo e consultas de estado foram somente leitura. O backend executou seu startup normal, incluindo inicialização idempotente de schema, migrações e rotinas de background, conforme autorização da sprint.

| Verificação | Baseline | Após ERP | Estado final após PDV |
|---|---:|---:|---:|
| SHA-256 do arquivo do banco | `5FE544656BB065193BCC24FCD1BFD7481E038DC8EA469DB54EF51D9984680536` | `ED2BE4F7CA70CFCA50B226E610F002165F8D4A6B7F82B86E151BCFE6F6957736` | `797EF4B3C5F1A3FE4D83F52F09F99759502FC69ABDCAAB564CD0721DC4C9CBD4` |
| `quick_check` | `ok` | `ok` | `ok` |
| Hash do schema | `22EE38BA6F07B379FF85687956F1C711261FE844B4F1142C43C47FF62EDF954F` | igual ao baseline | versão final `758`; nenhuma alteração DDL efetiva foi observada nos logs do PDV |
| `financeiro` (linhas) | 224 | 224 | 224 |
| `contas_receber` (linhas) | 0 | 0 | 0 |
| `tef_transacoes` (linhas) | 0 | 0 | 0 |
| `tef_transacoes` UNKNOWN | 0 | 0 | 0 |
| `tef_logs` (linhas) | 1 | 1 | 1 |

O hash da tabela `financeiro` foi idêntico entre baseline e pós-ERP (`573B01BF4E8BDF7993640FC603DE2D970A076E338F875D3713E958171A62850B`); `contas_receber`, `tef_transacoes` e `tef_logs` também mantiveram seus hashes nesse intervalo. Após o PDV, as contagens finais foram rechecadas, mas não foi possível comparar um hash pós-PDV por tabela com o formato do snapshot anterior. Portanto, a ausência de atualização in-place em `financeiro` durante o startup do PDV não fica provada apenas pela contagem.

O snapshot inicial identificou nove vendas candidatas à rotina de sincronização financeira e zero registros candidatos em `contas_receber`. O passo `financeiro-sync` terminou com `BACKGROUND STEP OK` nos dois aplicativos; o log não expôs o número de registros corrigidos. A tabela `financeiro` não mudou de hash após ERP e manteve 224 linhas no estado final. Nenhuma reversão de dados foi executada.

### Persistências não financeiras

Contagens baseline → final:

- `auditoria`: 2.219 → 2.221 (**+2**).
- `configuracoes_validade`: 207 → 209 (**+2**).
- `equipamentos_logs`: 162 → 164 (**+2**).
- `licenca_execucao`: 334.419 → 335.318 (**+899**).
- `obs_alert_history`: 30 → 32 (**+2**).
- `obs_metric_snapshots`: 2.277 → 2.283 (**+6**).

No pós-ERP, também mudaram hashes de `central_entradas_config`, `configuracoes`, `licenca`, `mib_estatisticas` e `sqlite_sequence`, sem mudança de contagem dessas tabelas. Os hashes finais dessas tabelas não foram comparados após o PDV. O arquivo do banco mudou de hash durante a execução; nenhuma alteração foi revertida.

Migrações/rotinas registradas nos logs:

- F12: configurações `f12_politica`, `f12_global_ativo`, `f12_controle` e `f12_escopo_admin` reportadas como inseridas; `[F12Policy] Migração concluída com sucesso`.
- Galeria de imagens: `0 criado(s), 480 já existente(s)`.
- MUC/MIB: schema reportado como garantido.
- `FechamentoFiscal` registrou tentativas de alteração de colunas já existentes (`duplicate column name`), marcadas como `alter ignorado`. O hash do schema não mudou entre baseline e pós-ERP.
- `financeiro-sync`, `equipamentos-monitor`, `central-sync`, `central-health` e `nfe-retoma` completaram os passos de background nos logs observados.

## Operações proibidas e testes

- `DESTAXA_REAL_TRANSACTION_ENABLED=0` durante os dois startups.
- Não foram iniciados CRT, débito/crédito, cobrança PIX, cancelamento ou operação no PinPad.
- Nenhum envio fiscal foi iniciado por esta execução.
- Não foram executados testes automatizados; a validação limitou-se ao startup real, `/ping`, interface carregada e consultas read-only ao banco.

## Classificação final

- **Inicialização ERP:** CONCLUÍDA em desenvolvimento.
- **Inicialização PDV:** CONCLUÍDA até login; caixa/política F12 não identificados.
- **Banco e integridade SQLite:** CONCLUÍDOS (`quick_check=ok`).
- **Preservação financeira:** sem mudança de hash em `financeiro` baseline→ERP; contagens finais estáveis; hash pós-PDV não comprovado.
- **Integridade do pacote:** BLOQUEADA pelo diagnóstico RC3.16.6; não bloqueou o modo de desenvolvimento, mas pacote ASAR não está aprovado.
- **Disponibilidade real do cliente Destaxa:** NÃO COMPROVADA; NativeHost não iniciado.
- **Homologação operacional TEF completa:** **NÃO APROVADA** até validar o fingerprint nesta execução conforme procedimento autorizado, resolver o erro de caixa/F12 do PDV e comprovar a disponibilidade do cliente Destaxa sem iniciar operação financeira.
