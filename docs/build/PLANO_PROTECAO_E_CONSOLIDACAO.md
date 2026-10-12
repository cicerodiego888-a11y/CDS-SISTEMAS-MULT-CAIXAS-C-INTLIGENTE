# Sprint 4.0 — Proteção e consolidação do trabalho pendente

Data: 2026-10-10  
Escopo: diagnóstico, proteção e planejamento. Nenhuma correção funcional, nenhum commit, nenhum teste alterado, nenhum banco aberto.

> **Atualização da Sprint 4.1 (Validação comparativa), 2026-10-10.** Os resultados estão na **seção 10**. As seções 1 a 9 foram mantidas e corrigidas onde a Sprint 4.1 desmentiu algo; cada correção indica "(Sprint 4.1)". As principais correções:
> - Duas falhas tidas como "antigas" **foram introduzidas por alterações pendentes**: `central-nfe-apresentacao-compra` e `central-nfe-produto-existente-novo-sqlite-e2e`.
> - As três falhas suspeitas (`release-composition`, `sprint313-central-vendas-faturadas` e `correcao-nf-margem-01`) **já falham no HEAD puro, pela mesma causa**.
> - O ERP instalado **não** é o build de 06/10 22:30: é um build de 06/10 08:41.
> - Há código-fonte necessário ao sistema que está **ignorado pelo Git**: `backend/motores/miip/logs/*.js` e os scripts de build em `scripts/`.

**Resumo**
- **Repositório.** A branch `main` está no commit `431df09`. O pacote instalado é anterior a ele (correção da Sprint 4.1, seção 10.5). Há **111 entradas pendentes**:
  - 78 arquivos modificados;
  - 1 arquivo novo registrado só como "intenção de adicionar", sem conteúdo no índice;
  - 32 arquivos não rastreados.
  - Além disso, há 2 scripts de homologação ignorados pelo `.gitignore`.
- **Backup.** Feito fora do repositório e fora do OneDrive, com hash de cada arquivo conferido. O patch aplica limpo sobre o HEAD, exceto num PDF gerado.
- **Pendências.** As alterações se dividem em 7 grupos. Dois deles **não pertencem às sprints desta sessão** e não têm relatório:
  - relatórios, ranking e entregas (08/10);
  - unidade CENTO e conversão sugerida (09/10 09:26).
- **Dependência crítica.** Uma das sprints depende desse segundo grupo.
- **Segredos.** Nenhuma credencial encontrada nos arquivos candidatos. Há dados de negócio em documentos, a decidir (seção 9).

---

## 1. Estado do repositório

| Item | Valor |
|---|---|
| Branch | `main`, rastreando `origin/main` (sem commits à frente ou atrás no último `fetch`; nenhum `fetch` feito agora) |
| Último commit | `431df09` — 2026-10-06 22:27 — "implemetação Diversas" |
| Commits anteriores | `896a8e8` (05/10), `129ecc0` (26/09), `b173f1a` (24/09), `40612ae` (23/09) |
| Pacote instalado | **(Corrigido na Sprint 4.1.)** `C:\Program Files\CDS ERP\resources\app.asar` tem data de 06/10 **08:41** e foi instalado às 16:38; ele **não** é o build de 22:30. O SHA-256 dele não coincide com nenhum manifesto: nem o do HEAD (build do `896a8e8`), nem o da árvore (build do `431df09`). Portanto, o commit de origem do pacote instalado **não é identificável**. O build de 22:30 (`dist\erp\win-unpacked`, `electron-build-manifest.json`) **não está instalado**. Nenhum dos dois contém `MiipIdentificacaoV2Policy.js` nem `ConfirmacaoConversaoEntradaNfe.js` (seção 10.5) |
| Versão (`package.json`) | 1.0.3, sem alteração pendente |
| Worktrees | repositório principal + `%TEMP%\cds-baseline-head` (HEAD `431df09`, limpo, 0 alterações) |
| Stash | vazio |
| Índice | nenhum conteúdo preparado (`git diff --cached` vazio). `ConfirmacaoConversaoEntradaNfe.js` aparece como `A` por "intent-to-add" (`git add -N`): o índice tem a entrada, não o conteúdo |
| Final de linha | `core.autocrlf=true`; `.gitattributes`: `* text=auto`, `*.js/html/css/json eol=lf`. 8 arquivos com aviso CRLF/LF; `MotorConversaoCalculo.js` tem finais de linha mistos (+34/−5 no diff bruto, +31/−2 ignorando CR) |
| Exclusões locais | `.git/info/exclude` vazio; `core.excludesfile` não definido |

**Contagem (`git status --porcelain -uall`):**

| Tipo | Qtde |
|---|---|
| Modificados (só na árvore de trabalho) | 78 |
| Novo com intent-to-add | 1 |
| Não rastreados | 32 (inclui os dois relatórios de auditoria desta sessão; com este plano, 33) |
| Removidos / renomeados | 0 / 0 |

**Diferença HEAD → árvore:** os arquivos rastreados somam +4.857/−1.127 linhas, ignorando CR (inclui as 831 do arquivo intent-to-add). Os maiores:
- `backend/rotas/compras.js` (+504/−19);
- `ConfirmacaoConversaoEntradaNfe.js` (+831, novo);
- `CentralRevisaoPersistenteService.js` (+536);
- `miip-central-revisao.js` (+491/−342);
- `frontend/erp/js/compras.js` (+388/−4);
- `miip-central-revisao.css` (+223/−221).

**Ignorados relevantes** (não aparecem no `git status`):

| Caminho | Regra | Observação |
|---|---|---|
| `scripts/homologacao/sprint31-reidentificar-miip-documentos.js` | `.gitignore:40 scripts/` | Seção 3 |
| `scripts/homologacao/sprint26-mapeamentos-miip.js` | `.gitignore:40 scripts/` | Seção 3 |
| `backend/certificados/`, `backend/storage/certificados/`, `backend/storage/temp-certificados/` | `.gitignore` | Certificados: **nunca** usar `git add -f` aqui |
| `dados/`, `*.db`, `backend/banco/mercadao.db`, `logs/`, `*.log`, `tmp/` | `.gitignore` | Dados e logs; fora de qualquer commit |
| `cds.zip`, `CDS SISTEMAS.zip` | `.gitignore` | Conteúdo não inspecionado; não incluir |
| `backend/scripts/` | `.gitignore` | Nenhum arquivo alterado depois de 06/10 |

---

## 2. Inventário das alterações pendentes

Lista completa, com o grupo provável de cada arquivo. A atribuição usa:
- os relatórios `AUDITORIA_GERAL_ENTRADA_NFE_XML_ATE_EFETIVACAO.md` (seções 1 a 24) e `AUDITORIA_COMPLETA_CENTRAL_ENTRADAS.md`;
- os diffs por bloco (`git diff -U0`);
- as datas de modificação;
- o histórico desta sessão, que começou em 09/10 às 13:39.

Legenda de confiança: **C** = comprovado pelo diff e pelo relatório; **P** = provável (data + relatório, sem verificação por bloco); **?** = sem atribuição segura.

### 2.1 Backend

| Arquivo | Δ (sem CR) | Grupo | Conf. |
|---|---|---|---|
| `backend/motores/central-entradas/CentralEntradasOrchestrator.js` | +16 | Núcleo (2, 2.7, 2.8) | C |
| `backend/motores/central-entradas/CentralEntradasService.js` | +16 | Núcleo (2, 2.7, 2.8) | C |
| `backend/motores/central-entradas/services/CentralComprasBridgeService.js` | +34/−2 | Núcleo (2, 2.7, 2.8) | C |
| `backend/motores/central-entradas/services/CentralDecisaoProdutoLinha.js` (novo) | novo | Núcleo (2.7) | C |
| `backend/motores/central-entradas/services/CentralRevisaoPersistenteService.js` | +536/−1 | Núcleo (1, 2, 2.6, 2.7, 2.8, 2.9) | C |
| `backend/motores/mib/schema/mibSchema.js` | +20/−6 | Núcleo (1) | C |
| `backend/motores/miip/MiipService.js` | +31/−27 | Núcleo (1, 2.6) | C |
| `backend/motores/miip/contracts/ItemIdentificavelDTO.js` | +2/−2 | Núcleo (1) | C |
| `backend/motores/miip/core/MiipIdentificacaoV2Policy.js` (novo) | novo | Núcleo (1, 2.6, 3.1) | C |
| `backend/motores/miip/core/MiipImportacaoResultado.js` | +2 | Núcleo (2.6) | C |
| `backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor.js` | +8 | Núcleo (2.6) | C |
| `backend/motores/miip/engines/gtin/MotorGTIN.js` | +10/−2 | Núcleo (2.6) | C |
| `backend/motores/miip/engines/mubc/MotorUniversalBuscaCandidatos.js` | +21/−10 | Núcleo (3.1) | C |
| `backend/motores/miip/repositories/ProdutoRepository.js` | +71/−15 | Núcleo (1, 2.6) | C |
| `backend/motores/miip/services/MiipImportacaoXmlService.js` | +1 | Núcleo (2.6) | C |
| `backend/motores/miip/services/MiipLearningService.js` | +78/−7 | Núcleo (2.4, 2.6) | P |
| `backend/motores/miip/utils/MiipResultadoImportacaoMapper.js` | +4/−1 | Núcleo (2.6) | C |
| `backend/motores/miip/utils/ProductCompatibilityGuard.js` | +1/−1 | Núcleo (3.1) | C |
| `backend/motores/miip/utils/mapearItemCompra.js` | +28/−3 | Núcleo (1) | C |
| `backend/motores/muc/aprendizado/MotorAprendizado.js` | +7 | Núcleo (2) | C |
| `backend/motores/muc/core/MotorConversaoCalculo.js` | +31/−2 | Núcleo (2) | C |
| `backend/motores/produto-identidade/services/EntradasProdutoIdentificacaoService.js` | +11 | Sprint 3.4 | C |
| `backend/rotas/central-entradas.js` | +72 | Núcleo (1, 2, 2.7, 2.8) | C |
| `backend/rotas/compras.js` | +504/−19 | Núcleo (1, 2, 2.2, 2.7, 2.9) **e** Sprint 3.4 | C |
| `backend/rotas/importacao-inicial-produtos.js` | +3/−1 | Sprint 3.4 | C |
| `backend/rotas/produtos.js` | +87/−30 | Núcleo (1 + correção da Sprint 2) **e** Sprint 3.4 | C |
| `backend/rotas/vendas.js` | +32/−1 | Preexistente — Relatórios | ? (08/10 10:41) |
| `backend/services/importacao-inicial-produtos/importer.js` | +38/−4 | Sprint 3.4 | C |
| `backend/services/importacao-inicial-produtos/index.js` | +4/−2 | Sprint 3.4 | C |
| `backend/services/relatorios/RelatorioVendasService.js` (novo) | novo | Preexistente — Relatórios | ? (08/10 09:43) |
| `backend/services/unidades/ConfirmacaoConversaoEntradaNfe.js` (intent-to-add) | +831 | Núcleo (2, 2.2, 2.8, 2.9) | C |
| `backend/services/unidades/MotorUnidadesMedida.js` | +59/−9 | Preexistente — Unidades CENTO | ? (09/10 09:26) |
| `backend/shared/nfe/enriquecerParseComMiip.js` | +3 | Núcleo (2.6) | C |

### 2.2 Frontend

| Arquivo | Δ (sem CR) | Grupo | Conf. |
|---|---|---|---|
| `frontend/css/entregas-erp.css` (novo) | novo | Preexistente — Entregas | ? (08/10 11:47) |
| `frontend/css/miip-central-revisao.css` | +223/−221 | Núcleo (2, 2.6, 3.2) | C |
| `frontend/css/pdv.css` | −14 | Sprint 3.3 | C |
| `frontend/erp/index.html` | +12/−6 | Preexistente — menu Relatórios + CSS de entregas | ? (08/10 11:00) |
| `frontend/erp/js/app.js` | +11/−4 | **Misto:** manifestos da Sprint 3.1 + ranking/entregas preexistentes | C (por bloco) |
| `frontend/erp/js/central-entradas-ux.js` | +27 | Sprint 3.5 | C |
| `frontend/erp/js/central-entradas.js` | +42/−42 | Sprints 3.5, 3.6, 3.7, 3.8 + filtro padrão "Em Revisão" | C (todos os blocos conferidos) |
| `frontend/erp/js/compras.js` | +388/−4 | Núcleo (2, 2.6, 2.7, 2.8, 3.0) | P (blocos 99–183 e 3818 não conferidos um a um) |
| `frontend/erp/js/entregas-erp-ux.js` (novo) | novo | Preexistente — Entregas | ? (08/10 11:47) |
| `frontend/erp/js/financeiro-relatorios.js` | +138/−10 | Preexistente — Relatórios | ? (08/10 09:45) |
| `frontend/erp/js/importacao-inicial-produtos.js` | +4 | Sprint 3.4 | C |
| `frontend/erp/js/miip-central-revisao.js` | +491/−342 | Núcleo (1, 2, 2.6, 3.1, 3.2) | C |
| `frontend/erp/js/produtos.js` | +37/−8 | **Misto:** Sprint 3.3 + trava de duplo clique (anterior à Sprint 1) + constante `CAMPO_PRODUTO_EMBALAGEM` sem uso | C (por bloco) |
| `frontend/erp/js/ranking-produtos.js` (novo) | novo | Preexistente — Ranking | ? (08/10 10:42) |
| `frontend/pdv/js/pdv.js` | +23/−21 | Sprint 3.3 | C |
| `frontend/shared/js/buscaProdutoTexto.js` | +34 | Sprint 3.3 | C |
| `frontend/shared/js/pdvBuscaProduto.js` | +7/−19 | Sprint 3.3 | C |

### 2.3 Testes

| Arquivo | Grupo | Conf. |
|---|---|---|
| `tests/central-entradas/sprint35-aviso-consumo-indevido.test.js` (novo) | 3.5 | C |
| `tests/central-entradas/sprint36-painel-operacional-simplificado.test.js` (novo) | 3.6 (ajustado na 3.8) | C |
| `tests/central-entradas/sprint37-menu-sem-xml-legado.test.js` (novo) | 3.7 | C |
| `tests/central-entradas/sprint38-modo-no-cabecalho.test.js` (novo) | 3.8 | C |
| `tests/compras/central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js` (mod.) | Núcleo (2.1, 2.8) | C |
| `tests/compras/central-nfe-produto-existente-novo-sqlite-e2e.test.js` (mod.) | Núcleo (2) | C |
| `tests/compras/entrada-central-nfe-sqlite-e2e.test.js` (mod.) | Núcleo (2) | C |
| `tests/compras/helpers/centralNfeE2eHarness.js` (mod.) | Núcleo (2, 2.8) | C |
| `tests/compras/rc840-unidades-isolamento.test.js` (mod.) | Preexistente — Unidades CENTO | ? (09/10 09:26) |
| `tests/compras/central-nfe-sem-associacao.test.js` (novo) | Núcleo (1) | C |
| `tests/compras/central-nfe-sprint26-identificacao-efetivacao-sqlite-e2e.test.js` (novo) | Núcleo (2.6) | C |
| `tests/compras/central-nfe-sprint27-protecao-produto-sqlite-e2e.test.js` (novo) | Núcleo (2.7, 2.8) | C |
| `tests/compras/central-nfe-sprint28-atomicidade-conversao-sqlite-e2e.test.js` (novo) | Núcleo (2.8, 2.9) | C |
| `tests/compras/central-nfe-sprint29-fator-conversao-sqlite-e2e.test.js` (novo) | Núcleo (2.9) | C |
| `tests/compras/central-nfe-sprint29-transacoes-sqlite-e2e.test.js` (novo) | Núcleo (2.9) | C |
| `tests/compras/fluxo-confirmacao-conversao-e2e.test.js` (novo) | Núcleo (2) | C |
| `tests/compras/sprint2-confirmacao-conversao.test.js` (novo) | Núcleo (2, 2.8) | C |
| `tests/compras/sprint28-selo-conversao.test.js` (novo) | Núcleo (2.8) | C |
| `tests/miip/auditoria-miip-cprod-candidato-incompativel.test.js` (novo) | Núcleo (auditoria 20 + 3.1) | C |
| `tests/miip/miip-aprendizado-governanca.test.js` (novo) | Núcleo (2.4, 2.6) | P |
| `tests/miip/miip-v2-identificacao-hierarquia.test.js` (novo) | Núcleo (1, 2.3) | C |
| `tests/miip/miip-v2-sprint26-identificacao-simples.test.js` (novo) | Núcleo (2.6) | C |
| `tests/miip/sprint31-comparacao-revisao-ui.test.js` (novo) | Núcleo (3.1) | C |
| `tests/miip/sprint32-revisao-sem-dashboard-ui.test.js` (novo) | Núcleo (3.2) | C |
| `tests/miip/miip-fornecedor-pipeline.test.js` (mod.) | Núcleo (1) | C |
| `tests/miip/miip-learning-service.test.js` (mod.) | Núcleo (2.4) | P |
| `tests/miip/miip-mubc-aprendizado.test.js` (mod.) | Núcleo (2.4) | P |
| `tests/miip/motor-mubc.test.js` (mod.) | Núcleo (3.1) | C |
| `tests/miip/product-compatibility-guard.test.js` (mod.) | Núcleo (3.1) | C |
| `tests/pdv/pdv-busca-marca-nome.test.js` (mod.) | 3.3 | C |
| `tests/produtos/sprint33-nome-marca-exibicao.test.js` (novo) | 3.3 | C |
| `tests/produtos/sprint34-cadastro-automatico-pesquisa-imediata.test.js` (novo) | 3.4 | C |
| `tests/produtos/auditoria-cadastro-pesquisa-integridade.test.js` (novo) | Auditoria de integridade de 09/10 (antes da Sprint 1) | P |
| `tests/produtos/cadastro-transacao-backfill.test.js` (novo) | Núcleo (1) | C |
| 13 × `tests/produtos/importacao-inicial-*.test.js`, `formacao-preco-persistido-v118`, `sprint17-normalizacao-categoria` (mod.) | 3.4 — **só a DDL do fixture** (`nome_busca TEXT`; `ativo` na Sprint 17), conferido linha a linha | C |
| `tests/sql/rc4315-insert-alignment.test.js` (mod.) | Núcleo (1): INSERT de produtos de 37 → 39 colunas | P |

Observação: o relatório da Sprint 3.4 fala em "12 arquivos `importacao-inicial-*`", mas o Git mostra 13. Os 13 têm a mesma alteração de uma linha na DDL. A diferença está só na contagem do relatório.

### 2.4 Documentos e artefatos

| Arquivo | Natureza | Recomendação |
|---|---|---|
| `docs/build/AUDITORIA_GERAL_ENTRADA_NFE_XML_ATE_EFETIVACAO.md` (novo) | Relatório das Sprints 1–3.4 | Commit de documentação, após decisão sobre dados de negócio (seção 9) |
| `docs/build/AUDITORIA_COMPLETA_CENTRAL_ENTRADAS.md` (novo) | Auditoria de 10/10 | Idem |
| `docs/build/auditoria-integridade-idempotencia-e2e.md` (novo) | Auditoria de 09/10 | Idem; cita o valor da senha padrão do admin semeado (linha 174; ver 2.5) |
| `docs/build/PLANO_PROTECAO_E_CONSOLIDACAO.md` (novo) | Este plano | Idem |
| `docs/build/release-certification-report.{json,md,pdf}` | **Gerados** pelo build de 06/10 22:29 (commit `431df09`) | Não entrar em commit de sprint; regenerar no próximo build |
| `electron-build-manifest.json` | **Gerado** pelo build de 06/10 22:30 | Idem |
| `docs/RC6.4_HOMOLOGACAO_CENTRAL.md` | **Gerado** por teste (09/10): só data e tempo médio mudaram; o parecer "REPROVADO 11/2" já estava no HEAD | Não versionar a regeneração |
| `docs/historico/relatorios/MIIP_READINESS_REPORT.md` | **Gerado**: só a data mudou | Idem |
| `docs/build/auditoria-busca-cadastro-produtos.{json,md}` | **Gerados** por teste (10/10 08:57): datas e contagens | Idem |

### 2.5 Segredos, credenciais e dados pessoais

Varredura nas linhas adicionadas dos 79 rastreados, nos 32 não rastreados e nos 2 scripts. Padrões procurados:
- senha, token, secret, chave de API, Bearer, chave privada, certificado;
- CNPJ, CPF, e-mail.

Nenhum valor foi copiado para este relatório.

| Achado | Onde | Avaliação |
|---|---|---|
| `localStorage.getItem('token')` / `Authorization: Bearer ${token}` | `miip-central-revisao.js`, `financeiro-relatorios.js` | Leitura do token da sessão em tempo de execução; nenhum valor fixo |
| `getJwtSecret()` | `ConfirmacaoConversaoEntradaNfe.js:10,200` | Usa o segredo configurado; nenhum valor no código |
| `token`/`tokens` | MUBC, testes de busca | Palavras da busca por nome; não são credenciais |
| CNPJs em 9 arquivos de teste | `tests/compras/*`, `tests/miip/*` | Padrões sintéticos: raízes 00/11/12/22/33/44/55, com 3 a 5 dígitos distintos. Quatro deles têm dígito verificador inválido. Nenhum coincide com o CNPJ do fornecedor real, que aparece mascarado nos relatórios |
| Razão social de fornecedor e CNPJ **mascarado** | `AUDITORIA_GERAL…md` (seção 20) | Dado de negócio, não pessoal. Decidir se mascara antes do commit |
| Caminho do banco real (`C:\ProgramData\MercantilFiscal\dados\mercadao.db`) | `AUDITORIA_GERAL…md` (seções 14, 19, 21) | Não é segredo; expõe a estrutura da instalação |
| Valor da senha padrão do admin semeado | `auditoria-integridade-idempotencia-e2e.md` (linha 174) | O valor já está no código (`backend/database.js`), mas o documento o repete. **Recomendado remover o valor do texto antes do commit** |
| Scripts `sprint26`/`sprint31` | `scripts/homologacao/` | Sem CNPJ, sem nomes de fornecedor e sem credenciais. O `sprint26` contém ids de mapeamentos e produtos do banco de teste |

Nenhum certificado, `.pfx`, `.db` ou `.env` está entre os candidatos.

---

## 3. Análise dos scripts ignorados

### 3.1 `scripts/homologacao/sprint31-reidentificar-miip-documentos.js` (docs 179 e 264)

| Pergunta | Resposta |
|---|---|
| Caminho | `scripts/homologacao/sprint31-reidentificar-miip-documentos.js` (17.562 bytes, 09/10 23:13) |
| Por que é ignorado | `.gitignore:40 scripts/` ignora a pasta inteira (`git check-ignore -v`) |
| Finalidade | Refazer a identificação MIIP dos documentos 179 e 264, gravada pela busca antiga que tratava o cProd do fornecedor como código interno do CDS (caso POLPA × Frango, AUD-04). Uso previsto: **depois** de publicar o pacote com a Sprint 3.1 |
| Dependências | Node, `sqlite3`, `backend/motores/miip/getMiipService`, `MiipImportacaoXmlService`, `backend/database` (para fechar). **Depende do código da árvore atual:** com o código do HEAD (`431df09`) reproduziria a identificação errada. Precisa do sistema fechado nos caixas e no ERP |
| Modos | Simulação (padrão); `--aplicar --confirmo-reidentificacao`; `--reverter <log> --confirmo-reidentificacao` |
| Escritas na simulação | Não grava no banco informado: abre em `OPEN_READONLY` e faz `VACUUM INTO` numa pasta temporária `%TEMP%\cds-s31-reidentificar-*`. O pipeline roda nessa cópia (`DB_DIR` apontado para ela) |
| Escritas em `--aplicar` | Cópia de segurança `VACUUM INTO` em `<pasta do banco>\backups\sprint31\`. Depois, uma transação `BEGIN IMMEDIATE` com:<ul><li>`UPDATE central_entradas_documentos` (`parse_json`, `miip_resumo_json`, `updated_at`; dentro do JSON pode definir `produto_id` se o código atual vincular automaticamente);</li><li>`INSERT` em `central_entradas_historico`;</li><li>log JSON com o estado anterior.</li></ul> |
| Escritas em `--reverter` | Restaura `parse_json`, `miip_resumo_json` e `updated_at`. Faz **`DELETE` de uma linha** de `central_entradas_historico`, filtrada por id, documento e marca `[sprint31-reidentificacao]` |
| Proteções | Exige a flag de confirmação para gravar. Status permitido em lista fechada. Recusa documento com compra. Pula itens com produto definido, decisão na revisão ou conversão confirmada. Compara o SHA-256 antes de gravar e antes de reverter. Usa uma transação com `ROLLBACK` |
| Já foi aplicado? | **Não:** a pasta `C:\ProgramData\MercantilFiscal\dados\backups\sprint31` não existe (verificado só por `Test-Path`, sem abrir o banco). Foi ensaiado numa cópia (seção 21.4 do relatório geral) |
| Necessário? | **Sim.** É o procedimento reversível documentado para corrigir os docs 179/264 (AUD-04). Se a pasta for limpa ou o repositório clonado em outra máquina, ele se perde |

### 3.2 `scripts/homologacao/sprint26-mapeamentos-miip.js` (também ignorado)

| Pergunta | Resposta |
|---|---|
| Finalidade | Correção auditada de 33 mapeamentos fornecedor + código (`miip_associacoes`) do banco de teste (Sprint 2.6): 10 re-apontados e 23 desativados |
| Escritas | `UPDATE miip_associacoes` (status `inativa` + metadados), `INSERT` dos registros corrigidos, `VACUUM INTO` (cópia de segurança), log JSON. A reversão faz `DELETE` dos registros criados (`origem = correcao_auditoria_sprint26`) e restaura status e metadados |
| Já foi aplicado? | **Sim**, em 09/10 às 23:42 UTC, no banco `C:\ProgramData\…\mercadao.db`, confirmado pelo usuário como banco de teste (seção 14.3). A cópia de segurança (141 MB) e o log (81 KB) existem em `C:\ProgramData\MercantilFiscal\dados\backups\sprint26\` |
| Necessário? | Sim, para **reverter** aquela aplicação: o comando de reversão depende deste arquivo. Os ids embutidos são específicos daquele banco. **Não deve ser executado em outro banco** (ele confere as pré-condições, mas o conteúdo não se aplica a clientes) |

Nenhum dos dois scripts foi executado nesta sprint.

---

## 4. Agrupamento provável por sprint

### Grupo "Relatórios, Ranking e Entregas" (preexistente, sem atribuição segura)
- **Arquivos:**
  - `RelatorioVendasService.js` (novo);
  - `backend/rotas/vendas.js`: `GET /relatorio/fiscal` e `ordenar_por` em produtos mais vendidos;
  - `financeiro-relatorios.js`;
  - `ranking-produtos.js` (novo);
  - `entregas-erp-ux.js` (novo);
  - `entregas-erp.css` (novo);
  - `frontend/erp/index.html`: menu Relatórios visível e CSS de entregas;
  - blocos de ranking e entregas em `app.js`.
- **Origem:** datas de 08/10, das 09:43 às 11:47. É anterior a esta sessão e não há relatório. O relatório da Sprint 1 já dizia: "alterações preexistentes (compras/unidades, ranking, entregas, etc.) não foram apagadas".
- **Testes:** nenhum teste cobre relatórios, ranking ou entregas-ERP. **(Sprint 4.1)** A suspeita sobre `release-composition` e `sprint313-central-vendas-faturadas` foi **descartada**: as duas falhas acontecem no HEAD puro, pela mesma causa (seção 10.1).
- **Electron:** desconhecido. O grupo nunca foi visto no app (seção 10.3).
- **Dependências:** `app.js` passa a chamar `loadEntregasErp` (definida em `entregas-erp-ux.js`) no lugar de `loadEntregas`. **Sem `entregas-erp-ux.js`, a tela Entregas mostra erro.**
- **Risco de separar:** baixo, se `app.js` for separado por bloco. Os blocos de ranking/entregas e os da Sprint 3.1 não se sobrepõem.

### Grupo "Unidade CENTO e conversão sugerida" (preexistente, sem atribuição segura)
- **Arquivos:** `MotorUnidadesMedida.js` e `tests/compras/rc840-unidades-isolamento.test.js`. Os dois foram modificados em 09/10 às 09:26, antes da sessão.
- **Finalidade aparente:**
  - unidade CENTO (CT/CEN/CENTENA);
  - texto "1 CX = N UN";
  - campos `tipoPendencia`, `requerConfirmacao`, `conversaoSugerida`, `produtoId` e `codigoBarras` no resultado de `resolverQuantidadeEntradaNfe`.
- **Dependência crítica:** `ConfirmacaoConversaoEntradaNfe.js` (Sprint 2) lê `resultado.requerConfirmacao`, `resultado.tipoPendencia === 'CONVERSAO_UNIDADE'` e `resultado.conversaoSugerida` (linhas 130, 131 e 261). **Este grupo precisa entrar antes do núcleo ou junto com ele.**
- **Testes:** `rc840` (2 casos novos de CENTO); não há registro de execução isolada. As E2E da Sprint 2 em diante rodaram com este código presente.
- **(Sprint 4.1)** Avaliação completa na seção 10.2. Descobriu-se um efeito fora da NF-e: o cadastro de produto passa a gravar `CENTO` onde antes gravava `UN`.

### Grupo "Núcleo Central / MIIP / Compras / Cadastro" (Sprints 1, 2, 2.1–2.9, 3.0, 3.1, 3.2 e a parte de servidor da 3.4)
- **Arquivos:** todos os marcados "Núcleo" na seção 2, mais os da Sprint 3.4 (ver justificativa abaixo).
- **Finalidade:**
  - política MIIP V2;
  - fim do uso de cProd como código interno;
  - associação por linha;
  - confirmação de conversão com selo;
  - proteção do produto decidido;
  - atomicidade e transações;
  - modal de troca no Electron (3.0);
  - módulo de comparação e "Semelhança X/100" (3.1);
  - revisão sem dashboard comercial (3.2).
- **Testes executados (registros):**
  - **Sprint 1:** 20/20.
  - **Sprints 2.3, 2.4 e 2.5:** sem falhas.
  - **Sprints 2.6 a 2.9:** E2E SQLite PASS, com fotografias idênticas nas recusas.
  - **Sprint 3.1:** casos obrigatórios PASS; 53 regressões com 49 PASS e 4 FAIL antigos.
  - **Sprint 3.2:** 10/10; 50 PASS e 4 FAIL antigos.
- **Electron:** a Sprint 3.0 homologou o fluxo Central → revisão → MUC → Compras → efetivação no Electron real, numa cópia do banco, com o código até a 3.0. As Sprints 1, 2.x, 3.1 e 3.2 têm o Electron registrado como **BLOCKED** nos relatórios. A 3.0 cobre parte delas, e as Sprints 3.1/3.2 não foram vistas no Electron.
- **Interdependência** (os mesmos arquivos foram tocados por várias sprints):
  - `backend/rotas/compras.js`: 1, 2, 2.2, 2.7, 2.9, 3.4;
  - `CentralRevisaoPersistenteService.js`: 1, 2, 2.6, 2.7, 2.8, 2.9;
  - `miip-central-revisao.js`: 1, 2, 2.6, 3.1, 3.2;
  - `MiipIdentificacaoV2Policy.js`: 1, 2.6, 3.1;
  - `frontend/erp/js/compras.js`: 2, 2.6, 2.7, 2.8, 3.0;
  - `backend/rotas/produtos.js`: 1, correção da 2, 3.4.
- **Por que a Sprint 3.4 fica junto:** o `compras.js` do servidor chama `limparCacheCatalogo()` (em `EntradasProdutoIdentificacaoService.js`) e o publicador exportado por `rotas/produtos.js`. A rota de importação também depende desse publicador. Separar exigiria dividir por bloco um diff de cerca de 520 linhas.
- **Risco de separar por sprint:** **alto**. Os commits intermediários não corresponderiam a nenhum estado testado e poderiam não carregar. **Recomendação: um único commit para este grupo** (seção 7).

### Sprint 3.3 — Exibição "NOME — MARCA"
- **Arquivos:**
  - `buscaProdutoTexto.js`, `pdvBuscaProduto.js`, `pdv.js`, `pdv.css`;
  - `frontend/erp/js/produtos.js`;
  - `tests/pdv/pdv-busca-marca-nome.test.js`, `tests/produtos/sprint33-nome-marca-exibicao.test.js`.
- **Conteúdo do `produtos.js`:** blocos da 3.3, a trava `__cdsProdutoSalvando` (anterior à Sprint 1, citada no relatório da Sprint 1 como "sprint anterior, mantido") e a constante `CAMPO_PRODUTO_EMBALAGEM`, declarada e **não usada** em lugar nenhum.
- **Testes:** 9 casos PASS; teste antigo 3/3. Regressões: 102 arquivos, 90 PASS e 12 FAIL antigos. Controle por mutação OK. Ensaio visual no navegador (Edge headless, 1366×768).
- **Electron:** BLOCKED.
- **Dependências:** nenhuma com o núcleo.
- **Risco de separar:** baixo. O `produtos.js` pode entrar inteiro neste commit, desde que a trava e a constante sejam documentadas na mensagem.

### Sprint 3.4 — Pesquisa imediata após cadastro
- **Arquivos exclusivos:**
  - `EntradasProdutoIdentificacaoService.js`, `importer.js`, `importacao-inicial-produtos/index.js`;
  - `rotas/importacao-inicial-produtos.js`, `frontend/erp/js/importacao-inicial-produtos.js`;
  - `sprint34-cadastro-automatico-pesquisa-imediata.test.js`;
  - 15 fixtures (só DDL).
- **Arquivos compartilhados com o núcleo:** `backend/rotas/compras.js` e `backend/rotas/produtos.js`.
- **Testes:** 17/17 (5/17 no código anterior). Regressões: 64/64 nas de referência; 18/19, 44/54 e 75/79, com falhas antigas idênticas por nome.
- **Electron:** BLOCKED.
- **Risco de separar:** alto (ver grupo Núcleo). **Fica dentro do commit do núcleo.**

### Sprints 3.5, 3.6, 3.7 e 3.8 + filtro padrão "Em Revisão" (UX da Central)
- **Arquivos:** `frontend/erp/js/central-entradas.js`, `frontend/erp/js/central-entradas-ux.js` e 4 testes novos (`tests/central-entradas/sprint35…sprint38`). Todos os blocos do diff de `central-entradas.js` foram conferidos:
  - estado inicial dos filtros;
  - `renderChipModoOperacaoCentral`;
  - `renderPainelOperacaoCentral`;
  - `renderCabecalhoUx1Central`;
  - `renderAtividadeRodapeUx1`;
  - `pollNotificacoesCentral`;
  - `sincronizarCentralEntradas`;
  - `loadCentralEntradas`.
- **Testes:** 13/13, 7/7, 4/4 e 6/6. As falhas antigas (`rc3753`, `central-entradas-sprint9`, `rc333-hardening`, `rc743-operational-gate`) são idênticas na cópia de controle.
- **Electron:** não validado pelas sprints. O usuário viu a tela de filtros no app (captura da conversa), mas isso não foi registrado como validação.
- **Dependências:** nenhuma com os outros grupos. O backend de sincronização não foi alterado.
- **Risco de separar:** baixo como um commit único. Separar em quatro commits exigiria `git add -p` dentro do mesmo arquivo e não traz benefício real; **recomendado um commit para 3.5–3.8**.

### Outras alterações sem atribuição segura
- Constante `CAMPO_PRODUTO_EMBALAGEM` em `frontend/erp/js/produtos.js`: sem uso.
- Blocos de `frontend/erp/js/compras.js` nas linhas ~99–183 (auxiliares de sugestão MIIP) e ~3818: prováveis da 2.6/2.7 pelo assunto, mas não conferidos um a um.
- `correcao-nf-margem-01` falha com `calcularMargemEntradaManualCompra is not defined` dentro de `compras.js` (seção 22). **(Sprint 4.1)** A mesma falha, com 24/4, ocorre no HEAD puro; não é causada pelas pendências.
- `tests/produtos/auditoria-cadastro-pesquisa-integridade.test.js` e `tests/sql/rc4315-insert-alignment.test.js`: auditoria de 09/10 e Sprint 1 (prováveis).
- Artefatos gerados (seção 2.4).

---

## 5. Estado dos testes e validações

**Nada foi executado na Sprint 4.0.** Os resultados abaixo vêm dos relatórios. **(Sprint 4.1)** As falhas conhecidas foram executadas no HEAD puro e na árvore atual; o resultado, que corrige a lista abaixo, está na seção 10.1.

**Já passaram (no estado da sprint correspondente):**
- **Sprint 1:** 20 obrigatórios.
- **Sprints 2.1 a 2.9:** testes de cada sprint, ≤2 min por arquivo.
- **Sprint 3.1:** `auditoria-miip-cprod`, `sprint31-comparacao`, `motor-mubc`, `product-compatibility-guard`, `miip-v2-sprint26` (17).
- **Sprint 3.2:** `sprint32-revisao` (10).
- **Sprint 3.3:** `sprint33` (9), `pdv-busca-marca-nome` (3).
- **Sprint 3.4:** `sprint34` (17); 64/64 de referência.
- **Sprints 3.5 a 3.8:** 13 + 7 + 4 + 6.

**Falhas conhecidas, iguais na cópia de controle (AUD-17):**
- **(Sprint 4.1) Saíram desta lista, porque passam no HEAD e falham só na árvore atual:** `central-nfe-apresentacao-compra` (4) e `central-nfe-produto-existente-novo` (2). Ver seção 10.1.
- **Compras, Produtos e MIB:** `correcao-nf-margem-01` (4), `rc43110`, `rc43112`, `rc43112.1`, `rc43112.2`, `rc43116`, `rc4312-central-fluxos`, `rc4314-insert-compras-alignment`, `importacao-inicial-navegacao-v103`, `lista-estoque-ux` (2), `mib-sprint03`, `mib-sprint04`, `mip-sprint08-hardening`.
- **MIIP e Central:** `miip-rc94-ux`, `central-entradas-sprint2`.
- **Vendas, faturamento e outros:** `rc2-central-vendas-faturadas`, `sprint313-central-vendas-faturadas` (8), `release-composition`, `tef-destaxa-07a-auditoria-pdv`, `vendas-entrega` ux01/02/03/03.3.
- **Central:** `rc3753-ux-cooldown-656`, `central-entradas-sprint9`, `rc333-hardening`, `rc743-operational-gate`.

**Dependem de ambiente ou do Electron:**
- `rc3753` e `central-entradas-sprint9`: o Node 24 define `navigator` sem `onLine` (causa comprovada).
- `rc743` e `rc333`: o Gate em `CONFIG_ERROR` no ambiente de teste (AUD-18, não verificado).
- `mip-sprint08-hardening`: script que sai com código ≠ 0.
- **Electron:** só a Sprint 3.0 foi homologada no app real. As demais estão BLOCKED.

**Ressalva importante sobre as "falhas antigas":** as cópias de controle das Sprints 3.1 a 3.8 reverteram **só os arquivos da própria sprint**. Elas continham as alterações preexistentes (relatórios, entregas, unidades) e as das sprints anteriores. Portanto, "antiga" significa **"anterior àquela sprint"**, e **não "presente no HEAD `431df09`"**. Três falhas têm relação direta com arquivos preexistentes:
- `release-composition` (lê `index.html`);
- `sprint313-central-vendas-faturadas` (lê `vendas.js`);
- `correcao-nf-margem-01` (função ausente em `compras.js`).

**(Sprint 4.1)** A ressalva foi resolvida executando os testes no HEAD puro. As três falhas acima são do HEAD. Em compensação, duas falhas que eram tidas como "antigas" foram causadas por pendências (seção 10.1).

**Testes desatualizados que podem mascarar defeitos:**
- Expectativas mudadas por desenho. Conferir na revisão do commit que a mudança é a regra nova, e não um afrouxamento:
  - `motor-mubc` e `product-compatibility-guard`: cProd deixou de ser identificador forte;
  - `miip-fornecedor-pipeline`: código de barras vence fornecedor;
  - `pdv-busca-marca-nome`: formato novo;
  - `sprint36`: ajustado na 3.8;
  - `central-nfe-edicao-linha-qtrib`: 2.1 e selo da 2.8;
  - `sprint2-confirmacao-conversao` e `sprint27`: passaram a enviar o selo.
- `central-nfe-produto-existente-novo`: espera `PENDENCIAS_CONVERSAO` e recebe `LINHA_CENTRAL_NAO_IDENTIFICADA` desde a 2.2. Foi registrado como "previsto", mas o teste continua vermelho. Pode esconder uma regressão real no mesmo arquivo. **(Sprint 4.1)** No HEAD ele passa 11/11; na árvore atual, 9/2.
- **(Sprint 4.1)** `central-nfe-apresentacao-compra`: no HEAD passa 25/25; na árvore atual, 21/4. O teste monta `compras.js` por trechos, e a função `extrairOrigemLinhaNfeCompra`, usada pelo novo `normalizeItemCompra`, fica fora desses trechos. Numa cópia de verificação com a função incluída, passa 25/25. O comportamento está preservado e o teste está desatualizado.
- 15 fixtures com DDL reduzida: corrigidos só na coluna. Outras colunas do schema real continuam fora do fixture.

**Testes necessários antes da consolidação** (na árvore completa, ≤2 min por arquivo, banco isolado):
1. Os 4 da UX da Central (3.5–3.8).
2. O núcleo:
   - os 10 novos de `tests/compras`;
   - os 6 novos e os 5 modificados de `tests/miip`;
   - `central-nfe-edicao-linha-qtrib`, `entrada-central-nfe-sqlite-e2e`, `central-nfe-produto-existente-novo`;
   - `cadastro-transacao-backfill`, `auditoria-cadastro-pesquisa-integridade`;
   - `sprint34` e os 15 fixtures;
   - `rc4315`, `rc840`.
3. Sprint 3.3: `sprint33`, `pdv-busca-marca-nome` e as 64 de referência.
4. **As falhas conhecidas executadas também no worktree `%TEMP%\cds-baseline-head` (HEAD puro).** É o único jeito de separar "já falhava no HEAD" de "falha por causa de alteração pendente não atribuída". O worktree não tem `node_modules`; usar `NODE_PATH` apontando para o `node_modules` do repositório, sem copiar nem instalar nada.

---

## 6. Riscos de perda, mistura ou dependência

| # | Risco | Grau | Mitigação |
|---|---|---|---|
| 1 | **Perda:** 111 entradas e 2 scripts existem só na árvore de trabalho de uma máquina. Não há stash, commit nem cópia | Alto → **mitigado** | Backup criado nesta sprint (seção 7.1) |
| 2 | **Perda dos scripts:** ignorados pelo Git; o `sprint26` é necessário para reverter uma aplicação já feita | Alto | Estão no backup. Versionar exige decisão (seção 9) |
| 3 | **Mistura:** `app.js`, `produtos.js` (frontend) e `compras.js`/`produtos.js` (backend) misturam grupos | Médio | Separar `app.js` por bloco ou commitar o grupo de entregas antes; núcleo em um commit |
| 4 | **Dependência oculta:** a Sprint 2 depende do `MotorUnidadesMedida.js` preexistente | Alto | Grupo "Unidades" antes do núcleo ou junto com ele |
| 5 | **Dependência oculta:** em `app.js`, `entregas` passou a chamar `loadEntregasErp` | Médio | Commitar `app.js` com `entregas-erp-ux.js`, ou separar o bloco |
| 6 | **Grupo sem dono validado:** relatórios, ranking e entregas (08/10) sem relatório nem teste. **(Sprint 4.1)** Não está ligado às falhas suspeitas | Médio | Decisão humana antes de commitar; validar no Electron (seção 10.3) |
| 7 | **Final de linha:** 8 arquivos com aviso CRLF/LF e `MotorConversaoCalculo.js` com finais mistos | Baixo | O primeiro commit normaliza para LF (ruído de diff); não usar `--renormalize` no repositório inteiro |
| 8 | **PDF tratado como texto:** `release-certification-report.pdf` cai em `* text=auto`; o patch desse PDF não aplica no HEAD (conversão de fim de linha) | Médio para artefatos | Não commitar o PDF gerado; avaliar `*.pdf binary` no `.gitattributes` numa sprint futura |
| 9 | **Intent-to-add:** `ConfirmacaoConversaoEntradaNfe.js` tem entrada vazia no índice; um `git commit -a` incluiria o arquivo inteiro de surpresa | Baixo | Commits só com lista explícita de arquivos |
| 10 | **Artefatos gerados misturados com código:** relatórios de build e de teste | Baixo | Fora dos commits de sprint |
| 11 | **Pacote do cliente:** sem nada disto (AUD-01). Commitar não publica: a validação real só vem no Electron com o pacote novo | Alto (P0) | Homologação no Electron antes de autorizar o build |
| 12 | **Reidentificação 179/264:** se rodada com o código do HEAD, regrava o erro | Alto | Só depois do pacote novo instalado; nunca nesta fase |
| 13 | **`npm start` em execução** (terminal do usuário) | Baixo | Lê os arquivos, não os altera; nenhum comando desta sprint mexeu nele. Na Sprint 4.1 ele já tinha terminado (código 1) |
| 14 | **(Sprint 4.1) Código-fonte ignorado pelo Git:** `backend/motores/miip/logs/` (3 `.js` + README) cai na regra `logs/` (`.gitignore:5`). Esses arquivos são exigidos pelo `MiipTelemetryService` e por 8 motores MIIP. Um clone limpo **não carrega o MIIP**, e os testes MIIP do HEAD só rodaram depois de copiá-los para o worktree. O build funciona por acaso, porque lê do disco | **Alto** | Decisão: exceção `!backend/motores/miip/logs/` no `.gitignore` ou `git add -f` dos 4 arquivos. Eles estão fora do backup da Sprint 4.0 (seção 10.6) |
| 15 | **(Sprint 4.1) Scripts de build ignorados:** `npm run build`, `build:all`, `build:cds-ui` e outros 7 scripts do `package.json` chamam arquivos de `scripts/` (ignorada, 0 rastreados). Um clone limpo não gera pacote | Alto | Mesma decisão do item anterior para `scripts/` (seção 10.6) |
| 16 | **(Sprint 4.1) Arquivos soltos no pacote:** `out.txt`, `tmp-rc833.txt` (rastreados) e `.vscode/tasks.json` entram no `app.asar` instalado e no build de 22:30. Isso causa a falha de `release-composition` no HEAD | Baixo | Excluir no `build.files` numa sprint própria (não feito) |
| 17 | **(Sprint 4.1) CENTO muda o cadastro de produto:** `normalizarUnidadeComercial('CT'/'CEN'/'CENTO'/'CENTENA')` passa de `UN` para `CENTO`, e `exigeQuantidadePorEmbalagem` passa de falso para verdadeiro. Afeta `POST`/`PUT /api/produtos` com compra por embalagem | Médio | Aprovação explícita; conferir se "CT" significa cento para os fornecedores reais (pode ser "cartela") (seção 10.2) |
| 18 | **(Sprint 4.1) Testes que regravam artefatos rastreados:** `mib-audit-01` reescreve `docs/build/auditoria-busca-cadastro-produtos.*`; `rc6.4-homologacao-e2e`, o `RC6.4_HOMOLOGACAO_CENTRAL.md`; `miip-readiness`, o `MIIP_READINESS_REPORT.md`; `rc4317-app-integrity`, o `electron-build-manifest.json` | Baixo | Não incluir esses arquivos nos commits de sprint; refazer o retrato da árvore depois de cada bateria de testes |

---

## 7. Plano recomendado de backup, validação e commits

### 7.1 Backup (feito nesta sprint)

- **Verificação prévia:** não havia cópia equivalente.
  - `%TEMP%\cds-baseline-head` é o HEAD limpo.
  - As pastas `%TEMP%\cds-s3x` são cópias de controle parciais.
  - Não há stash.
- **Local:** `C:\Users\cicer\CDS-backups\sprint40-protecao-20261010-110026\`. Fica no perfil local, fora do repositório e fora do OneDrive (`C:\Users\cicer\OneDrive`).
- **Conteúdo:**
  - `pendente-rastreados.patch`: `git diff HEAD --binary`, 401.213 bytes;
  - `arquivos/`: cópia dos **113** arquivos, com os caminhos preservados (79 rastreados, 32 não rastreados e 2 scripts);
  - `MANIFESTO.txt`: branch, HEAD, SHA-256 do patch e SHA-256 de cada arquivo.
  - Cada cópia teve o hash conferido contra o original.
- **Não incluídos:** banco, certificados, logs, `.zip`, `node_modules`.
- **Teste do patch:** `git apply --check` no worktree do HEAD passou para todos os arquivos, exceto o PDF gerado (risco 8). O PDF íntegro está em `arquivos/`.
- **Não incluído (criado depois do backup):** este relatório.
- **Original:** nenhum arquivo do repositório foi alterado.
- **Recomendação:** guardar também uma cópia em mídia externa. Antes de cada etapa de consolidação, refazer o backup e comparar com o `MANIFESTO.txt`.

### 7.2 Validação antes de qualquer commit

1. Rodar a lista de testes da seção 5 na árvore completa.
2. Rodar as falhas conhecidas no HEAD puro (seção 5, item 4) e classificar cada uma: "falha no HEAD" ou "causada por pendência".
3. Homologar no Electron, numa **cópia** do banco (`VACUUM INTO`, como na seção 19 do relatório geral), com o código da árvore completa. Roteiro mínimo:
   1. **Central:** filtro inicial "Em Revisão", modo no cabeçalho azul, painel sem NSU, menu sem "XML Legado", sincronização com 656 sem mensagem técnica.
   2. **Revisão:** item do doc 264 sem Frango, "Semelhança X/100", sem dashboard comercial.
   3. **Entrada com conversão:** SIM/NÃO com selo; troca de produto pelo modal; efetivação com estoque, financeiro e XML coerentes.
   4. **Compra manual com produto novo:** pesquisa imediata no Cadastro e no PDV.
   5. **Importação Inicial:** pesquisa imediata do produto importado.
   6. **Produtos e PDV:** exibição "NOME — MARCA".
   7. Se o grupo preexistente for incluído: Relatórios (Financeiro, Ranking) e Entregas.

### 7.3 Commits propostos (ordem)

Cada commit deve usar uma lista explícita de arquivos (`git add -- <arquivos>`). `git add -p` só em `app.js`, se o grupo de entregas ficar de fora. Depois de cada commit, conferir com `git diff --cached --stat` antes e `git show --stat` depois.

**Commit 1 — Unidade CENTO e conversão sugerida (preexistente)**
- **Objetivo:** base exigida pela confirmação de conversão.
- **Arquivos:** `backend/services/unidades/MotorUnidadesMedida.js`, `tests/compras/rc840-unidades-isolamento.test.js`.
- **Pré-requisito:** decisão humana de que essa alteração é desejada (seção 9).
- **Testes:** `rc840`, `muc-*`, testes de `tests/unidades`. **(Sprint 4.1)** Na árvore atual, `rc840`, `sprint2-confirmacao-conversao` (19), `fluxo-confirmacao-conversao-e2e` (6) e `sprint28-selo-conversao` (6) passam. O `rc840` do HEAD já falhava no HEAD, por motivo de tela (seção 10.2).
- **Atenção (Sprint 4.1):** sozinho sobre o HEAD, este commit muda o cadastro de produto (risco 17). Ele não tem consumidor dos campos novos até o commit 3. Isso reforça fazer os commits 1 e 3 em sequência imediata, ou juntos.
- **Validação:** coberta pelo item 3 do roteiro (conversão).
- **Critério:** testes verdes ou com falha idêntica ao HEAD; aprovação do responsável.

**Commit 2 — Relatórios, Ranking e Entregas (preexistente)** — *opcional; só com aprovação*
- **Arquivos:**
  - `RelatorioVendasService.js`, `backend/rotas/vendas.js`;
  - `financeiro-relatorios.js`, `ranking-produtos.js`;
  - `entregas-erp-ux.js`, `entregas-erp.css`;
  - `frontend/erp/index.html`;
  - `frontend/erp/js/app.js` **inteiro**. Os blocos da 3.1 só incluem `miip-central-revisao-inteligente.js`, que já existe no HEAD, então são inofensivos neste ponto.
- **Testes:** `release-composition`, `sprint313-central-vendas-faturadas`, `rc2-central-vendas-faturadas`, `vendas-entrega/*`, comparados com o HEAD.
- **Validação:** telas Financeiro, Ranking e Entregas no Electron.
- **Critério:** nenhuma falha nova em relação ao HEAD; aprovação do responsável.
- **Se recusado:** o bloco de entregas/ranking de `app.js` fica fora (`git add -p`) e o restante do `app.js` vai no commit 3.

**Commit 3 — Núcleo: entrada NF-e, Central, MIIP V2, conversão confirmada, Compras e cadastro (Sprints 1 a 3.2 e Sprint 3.4)**
- **Objetivo:** consolidar, num estado testado, as sprints interdependentes. Separar por sprint criaria estados intermediários nunca testados (seção 4).
- **Arquivos:**
  - todos os marcados "Núcleo" e "Sprint 3.4" nas seções 2.1, 2.2 e 2.3, incluindo `ConfirmacaoConversaoEntradaNfe.js`, `CentralDecisaoProdutoLinha.js` e `MiipIdentificacaoV2Policy.js`;
  - `frontend/erp/js/app.js`, se não tiver entrado no commit 2 (só os blocos da 3.1);
  - os 15 fixtures;
  - `rc4315` e `auditoria-cadastro-pesquisa-integridade`.
- **Pré-requisitos:** commit 1; seção 7.2 concluída.
- **Testes:** lista do núcleo e da 3.4 na seção 5.
- **Validação:** itens 2 a 5 do roteiro.
- **Critério:** testes verdes ou com falha idêntica ao HEAD; roteiro no Electron com evidência; revisão das expectativas alteradas (seção 5); mensagem do commit listando as sprints.
- **(Sprint 4.1) Bloqueio pelo critério acima:** `central-nfe-apresentacao-compra` (21/4) e `central-nfe-produto-existente-novo-sqlite-e2e` (9/2) passam no HEAD e falham com este commit. Antes do commit, alguém precisa decidir se esses testes devem ser atualizados (a mudança é de regra, seção 10.1) ou se o código deve ser corrigido. Pelas restrições, nada foi alterado.

**Commit 4 — Sprint 3.3: exibição "NOME — MARCA"**
- **Arquivos:** `buscaProdutoTexto.js`, `pdvBuscaProduto.js`, `pdv.js`, `pdv.css`, `frontend/erp/js/produtos.js` e os 2 testes.
- **Observação:** `produtos.js` leva junto a trava de duplo clique e a constante sem uso. Registrar isso na mensagem ou remover a constante numa sprint própria.
- **Testes:** `sprint33`, `pdv-busca-marca-nome` e as 64 de referência.
- **Validação:** item 6 do roteiro.
- **Critério:** testes verdes; conferência visual.

**Commit 5 — Sprints 3.5 a 3.8 e filtro padrão: UX da Central**
- **Arquivos:** `central-entradas.js`, `central-entradas-ux.js` e os 4 testes `tests/central-entradas/sprint35…38`.
- **Testes:** os 4 novos; `rc3753` e `central-entradas-sprint9` com a falha de ambiente conhecida.
- **Validação:** item 1 do roteiro.
- **Critério:** testes verdes; conferência visual.

**Commit 6 — Documentação**
- **Arquivos:** `AUDITORIA_GERAL_…md`, `AUDITORIA_COMPLETA_…md`, `auditoria-integridade-idempotencia-e2e.md`, este plano.
- **Pré-requisito:** remover o valor da senha padrão citado e decidir sobre razão social e caminhos (seção 9).
- **Critério:** varredura de segredos sem achados.

**Commit 7 — Scripts de homologação** — *depende de decisão*
- **Opções:**
  1. exceção no `.gitignore` (`!scripts/homologacao/`), numa sprint própria;
  2. `git add -f` só dos dois arquivos;
  3. mover para uma pasta versionada.
- **Critério:** o script continua recusando gravar sem a flag de confirmação; o `sprint26` traz o aviso "somente banco de teste".

**Não commitar:** os artefatos gerados (seção 2.4). Descartá-los exigiria `git restore`, que é destrutivo; por isso fica como decisão humana. Uma alternativa é simplesmente deixá-los fora dos commits até o próximo build regenerá-los.

**Depois dos commits:** build versionado (1.0.4), instalação, novo roteiro no Electron com o pacote. Só então a reidentificação dos docs 179/264: simular, aplicar e guardar o log.

**Se a separação 1–5 for rejeitada:** a alternativa honesta é **um único commit de consolidação** com os commits 1, 3, 4 e 5, e o 2 se aprovado. Isso perde a rastreabilidade por sprint, mas corresponde exatamente ao estado testado. A separação proposta já evita cortes artificiais: o único corte por bloco é opcional e fica em `app.js`.

---

## 8. Comandos destrutivos evitados

Nenhum dos comandos abaixo foi executado:
- `git reset` (qualquer modo), `git clean`, `git checkout -- <arq>`, `git checkout <commit>` na árvore principal, `git restore`, `git switch`;
- `git stash` (push/pop/apply/drop: alteram a árvore de trabalho);
- `git add` (inclusive `-A`, `.`, `-u`, `-p`, `-f`), `git commit`, `git rm`, `git mv`, `git push`, `git fetch`/`pull`;
- `git apply`/`git am` na árvore principal. Houve só `git apply --check` no worktree do HEAD, que não grava nada;
- `git add --renormalize`, formatadores (`prettier`, `eslint --fix`), conversão de fim de linha;
- `git worktree remove`/`prune` (o `%TEMP%\cds-baseline-head` foi preservado), `git gc`, `git prune`;
- alteração de `.gitignore`, `.git/info/exclude`, `core.excludesfile`, `.gitattributes` ou configuração do Git;
- execução de `sprint26-mapeamentos-miip.js`, `sprint31-reidentificar-miip-documentos.js` ou qualquer reidentificação, backfill ou migração;
- abertura de qualquer banco (real, de teste ou cópia);
- `npm install`, `npm run build`, `electron-builder`, publicação de pacote;
- execução de testes (resultados reaproveitados dos relatórios).

Comandos executados, todos somente leitura (exceto o backup, que gravou fora do repositório):
- `git branch`, `log`, `status`, `diff` (`--stat`, `--numstat`, `-U0`, `--cached`), `ls-files`, `check-ignore`, `check-attr`, `config --get`, `grep`, `remote -v`, `rev-parse`, `worktree list`, `stash list`;
- `git -C %TEMP%\cds-baseline-head apply --check`;
- `git diff HEAD --binary --output=<backup>`;
- `Copy-Item` e `Get-FileHash` para o backup;
- leitura dos scripts e relatórios;
- `Test-Path` e listagem das pastas de backup em `ProgramData`, sem abrir o banco.

Efeito colateral inerente: `git status`/`git diff` podem atualizar o cache de metadados do `.git/index` (datas e tamanhos). Nenhum conteúdo é alterado.

---

## 9. Pendências que exigem decisão humana

1. **Grupo "Relatórios, Ranking e Entregas" (08/10):** quem fez, se está pronto e se entra na consolidação (commit 2) ou fica pendente.
2. **Grupo "Unidade CENTO e conversão sugerida" (09/10 09:26):** confirmar que é desejado. A Sprint 2 depende dele (commit 1).
3. **Versionamento dos scripts** `scripts/homologacao/*`: exceção no `.gitignore`, `git add -f` dos dois arquivos, ou mudança de pasta.
4. **Artefatos gerados** (seção 2.4): descartar (`git restore`, destrutivo) ou apenas não commitar até o próximo build.
5. **Documentos com dados de negócio:** retirar o valor da senha padrão citado em `auditoria-integridade-idempotencia-e2e.md`. Decidir se a razão social do fornecedor e os caminhos de instalação ficam nos relatórios.
6. **Granularidade:** aceitar o plano de 5 commits de código (seção 7.3) ou preferir um único commit de consolidação.
7. **Constante `CAMPO_PRODUTO_EMBALAGEM`** sem uso em `produtos.js`: manter no commit 4 ou remover numa sprint própria.
8. **Homologação no Electron:** quem executa, com qual cópia de banco e se a sincronização SEFAZ fica desligada na cópia (ambiente fiscal = produção, como na seção 19).
9. **Banco alvo da reidentificação dos docs 179/264**, depois do pacote novo: confirmar de novo que `C:\ProgramData\MercantilFiscal\dados\mercadao.db` é banco de teste. A confirmação anterior foi dada para a Sprint 2.6.
10. **`.gitattributes`:** marcar `*.pdf binary` numa sprint futura (risco 8).
11. **Backup:** manter em `C:\Users\cicer\CDS-backups\…` e copiar para mídia externa.
12. **Versão do pacote** (1.0.3 → 1.0.4) e momento do build.

**Sprint 4.0 encerrada.** As decisões novas da Sprint 4.1 estão na seção 10.7.

---

## 10. Sprint 4.1 — Validação comparativa e decisões de consolidação

Data: 2026-10-10. Nenhum código funcional, teste, banco, `.gitignore` ou configuração do Git foi alterado. Não houve `git add`, commit, instalação nem execução de script de reidentificação. A árvore de trabalho foi fotografada antes dos testes (status + SHA-256 dos 112 arquivos pendentes) e conferida depois: **idêntica**. O backup da Sprint 4.0 foi preservado.

### 10.1 Comparação com o HEAD puro

**Método**
- **Controle:** worktree `%TEMP%\cds-baseline-head`, no commit `431df09`, limpo. O `node_modules` é uma junção para o do repositório; nada foi instalado.
- **Ajuste necessário no controle:** os módulos `backend/motores/miip/logs/*.js` são ignorados pelo Git e não existem num checkout limpo (risco 14). Sem eles, todo teste que carrega o MIIP quebra no HEAD com `Cannot find module`, o que daria uma comparação falsa. Os 4 arquivos foram copiados para o worktree, com hash conferido. Lá eles também ficam ignorados, e o `git status` do worktree continua limpo. A primeira bateria no HEAD, feita sem eles, foi descartada.
- **Execução:** `node --test <arquivo>` com `CDS_TEST_ISOLAR_BANCO=1`, sem `DB_DIR`/`PORT`/`JWT_SECRET` herdados, e limite de 120 s por arquivo. O executor é `%TEMP%\cds-s41\run-regressoes.js <raiz> <arquivos…>`, e a saída de cada falha fica em `%TEMP%\cds-s41\<bateria>\falha-<arquivo>.txt`.
- **Comando de exemplo:** `node %TEMP%\cds-s41\head4\run-regressoes.js %TEMP%\cds-baseline-head tests/electron/release-composition.test.js` (e o mesmo com a raiz do repositório).
- **Banco:** o `database.js` do HEAD e o da árvore recusam o banco real com `CDS_TEST_ISOLAR_BANCO=1` e usam `%TEMP%\cds-sistemas-test-db`.

**Os três testes pedidos**

| Teste | HEAD (pass/fail) | Árvore atual | Causa | Classificação |
|---|---|---|---|---|
| `release-composition` | 6/2 | 7/1 | **Comum:** `out.txt`, `tmp-rc833.txt` (rastreados desde o HEAD) e `.vscode/tasks.json` entram na seleção do electron-builder, mas não no manifesto que o teste monta. **Só no HEAD:** falta `backend/certificados/ICP-Brasilv5-correto.pem`, que é ignorado e por isso não existe no worktree (ambiente) | **Já falhava no HEAD.** Sem relação com `index.html` |
| `sprint313-central-vendas-faturadas` | 2/8 | 2/8 | "Módulo Expedição desabilitado"; a tela não tem /Vendas faturadas/ | **Já falhava no HEAD**, mesma causa. Sem relação com `vendas.js` |
| `correcao-nf-margem-01` | 24/4 | 24/4 | `ReferenceError: calcularMargemEntradaManualCompra is not defined`; /Atualizar preço/; placeholder de margem | **Já falhava no HEAD**, mesma causa |

**Outras falhas conhecidas**
- **Mesma contagem e mesma causa no HEAD e na árvore:**
  - `rc2-central-vendas-faturadas` (6/1, /Visualizar DANFE/);
  - `rc43110`, `rc43112`, `rc43112.1`, `rc43112.2`, `rc43116`, `rc4312-central-fluxos`, `rc4314-insert-compras-alignment` (asserções de texto sobre `compras.js`/MUC; ex.: "INSERT compras_itens — 36 colunas = 36 placeholders");
  - `importacao-inicial-navegacao-v103` (/Estoque Inicial/) e `lista-estoque-ux` (2, /25 KG/);
  - `mib-sprint03`, `mib-sprint04` ("front Cadastro/PDV usam busca operacional"), `mip-sprint08-hardening` ("documentos oficiais existem"), `miip-rc94-ux` (`motivosSemCandidatoPadrao`);
  - `central-entradas-sprint2`, `central-entradas-sprint9` e `rc3753` (`navigator.onLine` no Node 24), `rc333-hardening`, `rc743-operational-gate` (Gate em `CONFIG_ERROR`);
  - `tef-destaxa-07a` ("mensagem ausente no adapter HEAD");
  - `vendas-entrega` ux01, ux02, ux03 e ux03.3 (botão Entrega e coluna Total).
- **Introduzidas por alterações pendentes** (antes classificadas como "antigas"):

| Teste | HEAD | Árvore | Causa | Avaliação |
|---|---|---|---|---|
| `central-nfe-apresentacao-compra` | **25/0** | 21/4 | `ReferenceError: extrairOrigemLinhaNfeCompra is not defined`. O `normalizeItemCompra` pendente (linha ~3658; chamadas em ~3818) usa essa função, definida na linha ~7038. O teste extrai `compras.js` por trechos, e essa linha fica fora deles | **Teste desatualizado; comportamento preservado.** Numa cópia de verificação (`%TEMP%\cds-s41\apresentacao\`), com a função real incluída no trecho, passa **25/25**. Provável origem: Sprint 2/2.2 |
| `central-nfe-produto-existente-novo-sqlite-e2e` | **11/0** | 9/2 | Espera `PENDENCIAS_CONVERSAO` (422) e recebe `LINHA_CENTRAL_NAO_IDENTIFICADA`. Os casos são "conversão impossível no backend é bloqueada antes da transação (422)" e "Sprint 3 — produto existente × produto novo" | **Mudança de regra da Sprint 2.2** (a validação de identificação passou a vir antes da de conversão). Provavelmente o teste está desatualizado, **mas isso não foi provado.** Precisa de decisão (10.7) |

- **Passam nos dois:** `entrada-central-nfe-sqlite-e2e` (HEAD 5/0; árvore 5/0) e `central-nfe-edicao-linha-qtrib-sqlite-e2e` (HEAD 7/0 na versão do HEAD; árvore 15/0 na versão atual).

### 10.2 Unidade CENTO (`MotorUnidadesMedida.js`)

**Problema que resolve.** NF-e de fornecedores que vendem por cento, em que uCom = `CENTO`/`CT`/`CEN`/`CENTENA` e uTrib está na unidade de estoque (ex.: 5 CENTO = 500 M). No HEAD, essas siglas não eram reconhecidas: a entrada da NF-e mantinha a sigla crua, e o cadastro a trocava por `UN`. Além disso, quando não há conversão cadastrada, o motor passa a **sugerir** o fator pela NF-e (`fatorSugerido = qTrib/qCom`, texto `"1 CENTO = 100 M"`) em vez de só recusar. Também passa a marcar o resultado como pendência que exige confirmação. Essa é a base da confirmação SIM/NÃO da Sprint 2.

**O que muda, verificado em execução no HEAD e na árvore:**

| Entrada | HEAD: NF-e / cadastro / exige qtd. por embalagem | Árvore: NF-e / cadastro / exige |
|---|---|---|
| `CT`, `CEN`, `CENTENA` | sigla crua / `UN` / não | `CENTO` / `CENTO` / **sim** |
| `CENTO` | `CENTO` / `UN` / não | `CENTO` / `CENTO` / **sim** |
| `CX` (controle) | `CAIXA` / `CAIXA` / sim | igual |

Em `resolverQuantidadeEntradaNfe`, todos os retornos ganham `produtoId`, `produtoNome`, `codigoBarras`, `tipoPendencia` e `podeContinuar`. Os ramos `FATOR_CONVERSAO_AUSENTE` e `DIVERGENCIA_QTRIB_FATOR` ganham `requerConfirmacao: true` e `tipoPendencia: 'CONVERSAO_UNIDADE'`. O primeiro ganha ainda `unidadeTributavel`, `fatorSugerido` e `conversaoSugerida`, e a mensagem de erro é reescrita.

**Quem depende**
- **Backend:**
  - `ConfirmacaoConversaoEntradaNfe.js` (novo, Sprint 2): lê `requerConfirmacao`, `tipoPendencia` (linhas 130 e 131), `fatorSugerido` e `conversaoSugerida` (linhas 260 e 261);
  - o mesmo arquivo é usado por `backend/rotas/compras.js` (validação da efetivação e `quantidadeAutorizadaEntradaNfe`) e por `CentralRevisaoPersistenteService.js` (pendências, SIM/NÃO, selo);
  - `MotorConversaoCalculo.js` (MUC): só usa `ok`, `erro` e `codigo`. Com `ok: false`, ele continua lançando o erro; o `podeContinuar: true` não libera nada sozinho;
  - `backend/rotas/produtos.js` (linhas 2584 e 3018): `normalizarUnidadeComercial` no cadastro e na edição de produto com compra por embalagem (efeito da tabela acima);
  - `services/importacao-inicial-produtos/helpers.js` e `motores/muc/core/MotorConversao.js` importam o motor.
- **Telas:**
  - `frontend/erp/js/compras.js` (linhas ~113 e ~7110): mostra `conversao_sugerida`/`fator_sugerido` na pendência;
  - `miip-central-revisao.js` (linha 1752): mostra a "Proposta" na Central.
- **Correção da Sprint 4.0:** a referência a `backend/rotas/central-entradas.js:824` (`requerConfirmacao` → 409) era um falso vínculo. Aquela linha trata do ciclo DF-e (manifestação) e não usa este motor.

**Compatibilidade com os contratos atuais**
- **Aditiva para quem só lê `ok`/`codigo`/`quantidadeEstoque`/`fatorConversao`:** o MUC e as rotas antigas não mudam.
- **A mensagem de `erro` mudou de texto.** Nenhum teste nem código compara a frase antiga.
- **Mudança de comportamento real no cadastro de produto** (risco 17): siglas de cento deixam de virar `UN`. Produtos já gravados não mudam, porque não há migração. Mas uma edição salva de um produto com `unidade_comercial` `CT` passará a gravar `CENTO` e a exigir quantidade por embalagem.
- **Ambiguidade:** algumas empresas usam `CT` para "cartela" ou "cartucho". O mapeamento `CT → CENTO` vale para todos os fornecedores. Hoje não há outro mapeamento de `CT` no sistema.
- **Lista do frontend:** `produto-apresentacao-resolver.js` não tem o rótulo `CENTO` e mostra a sigla crua. Isso é só cosmético.
- **Dependência inversa:** sem este grupo, `ConfirmacaoConversaoEntradaNfe.js` não detecta a pendência pelos campos novos. Ele ainda detecta pelos códigos `FATOR_CONVERSAO_AUSENTE`/`DIVERGENCIA_QTRIB_FATOR` (linhas 132 e 133), mas perde a sugestão. Por isso o grupo deve entrar antes do núcleo ou junto com ele.

**Testes que comprovam** (árvore atual, ≤2 min cada)

| Teste | Resultado | O que prova |
|---|---|---|
| `tests/compras/rc840-unidades-isolamento.test.js` | PASS | Normalização de CENTO/CEN/CT; "5 CENTO = 500 M, fator 100" |
| `tests/compras/sprint2-confirmacao-conversao.test.js` | 19/19 | Caso 11 "CENTO para metros" (inclui `CENTENA` e uCom `CT`); SIM/NÃO; registro com `xml_original.uCom = CENTO` |
| `tests/compras/fluxo-confirmacao-conversao-e2e.test.js` | 6/6 | Fluxo com uCom `CENTO` até a efetivação |
| `tests/compras/sprint28-selo-conversao.test.js` | 6/6 | Selo da conversão com CENTO |

- **No HEAD:** o `rc840` do HEAD (sem os casos CENTO) falha 0/1 em "UI cadastro tem Unidade Comercial e Valor da Embalagem", porque o `frontend/erp/js/produtos.js` do HEAD não contém `unidade_comercial`. É uma falha do HEAD, sem relação com CENTO.
- **Lacuna:** nenhum teste cobre o efeito no cadastro (`POST`/`PUT /api/produtos` com `CT`).

**Nada foi alterado nesses arquivos.**

### 10.3 Relatórios, Ranking, Entregas e `app.js`

**Dependências confirmadas**

| De | Para | Natureza |
|---|---|---|
| `app.js` (manifesto `entregas`) | `/erp/js/entregas-erp-ux.js` | O script é carregado sob demanda ao abrir a página |
| `app.js` (`case 'entregas'`) | `loadEntregasErp` (definida em `entregas-erp-ux.js`) | Antes chamava `loadEntregas` (de `pdv/js/entregas.js`, rastreado e inalterado) |
| `entregas-erp-ux.js` | `window.loadEntregas` (`pdv/js/entregas.js`) | É uma camada **por cima** da tela original. Chama `loadEntregas()` e depois acrescenta busca, ícones e títulos, com um `MutationObserver` sobre `#conteudoEntregas` |
| `index.html` | `/css/entregas-erp.css` (novo) | Estilo da busca e dos ícones |
| `app.js` (manifesto e `case 'ranking-produtos'`) | `ranking-produtos.js` (novo) → `loadRankingProdutos` | Página nova |
| `ranking-produtos.js` | `GET /api/vendas/relatorio/produtos-mais-vendidos?ordenar_por=` | A rota existe no HEAD; `ordenar_por` é pendente em `vendas.js` |
| `financeiro-relatorios.js` | `GET /api/vendas/relatorio/fiscal` | A rota é **nova** em `vendas.js` e usa `RelatorioVendasService.js` (não rastreado) |
| `index.html` (menu Relatórios visível) | páginas `financeiro` e `ranking-produtos` | Antes o menu era um item oculto, "Em breve" |

**O que quebra se forem separados**
1. **`app.js` sem `entregas-erp-ux.js`:** o carregador sob demanda rejeita a página (`Falha ao carregar script ERP: /erp/js/entregas-erp-ux.js`) e a tela **Entregas deixa de abrir**. Se o arquivo existir mas não definir a função, aparece "Erro ao carregar vendas para entrega.".
2. **`app.js` sem `ranking-produtos.js`:** o mesmo vale para a página Ranking. Ela só é alcançável pelo menu novo do `index.html`.
3. **`index.html` sem `app.js`:** o menu mostra "Ranking de Produtos" e o clique cai numa página sem tratamento.
4. **`financeiro-relatorios.js` sem `vendas.js` + `RelatorioVendasService.js`:** o relatório fiscal recebe 404.
5. **`vendas.js` sem `RelatorioVendasService.js`:** o `require` falha e **toda a rota `/api/vendas` deixa de carregar**. Esse é o pior caso: afeta vendas, não só relatórios.
6. **`entregas-erp-ux.js` sozinho, sem `app.js`:** inofensivo, porque não seria carregado.
7. **Blocos da Sprint 3.1 no `app.js`:** só acrescentam `miip-central-revisao-inteligente.js`, que já é rastreado no HEAD. Não dependem deste grupo, e este grupo não depende deles.

**Recomendação.** O grupo é coeso, mas **não tem teste nem validação no app**. Proposta: **não incluí-lo agora.** Manter o commit 2 como opcional e só fazê-lo depois de abrir Financeiro, Ranking e Entregas na homologação do Electron (10.5, item 7 do roteiro). Ele deve entrar **inteiro**, com os 8 arquivos (`RelatorioVendasService.js`, `vendas.js`, `financeiro-relatorios.js`, `ranking-produtos.js`, `entregas-erp-ux.js`, `entregas-erp.css`, `index.html`, `app.js`), nunca em partes, por causa dos itens 1, 4 e 5. Se ficar de fora, o `app.js` entra no commit 3 com `git add -p`, levando só os 2 blocos da 3.1, e os outros 7 arquivos ficam pendentes **juntos**.

### 10.4 Artefatos gerados e documentação

| Arquivo | Estado | Gerado por | Reprodutível? | Diferença | Recomendação |
|---|---|---|---|---|---|
| `docs/build/release-certification-report.{json,md,pdf}` | M | `ReleaseCertificationService`, via `tests/e2e/release-certification/run.js`, chamado por `build:erp` e `release` | Sim | Rodada do build de 06/10 22:29; ±70/±18 linhas, PDF binário | Não commitar nos commits de sprint; o próximo build regenera |
| `electron-build-manifest.json` | M | `escreverManifestoBuild` (`build-erp-oficial.js`; também `rc4317-app-integrity.test.js`) | Sim | Commit `896a8e8` → `431df09`, hashes do build de 22:30 | Idem. O valor atual descreve um build **não instalado** |
| `docs/RC6.4_HOMOLOGACAO_CENTRAL.md` | M | `tests/central-entradas/rc6.4-homologacao-e2e.test.js` | Sim | Data e tempos (4 linhas) | Idem |
| `docs/historico/relatorios/MIIP_READINESS_REPORT.md` | M | `MiipAuditService` / `miip-readiness.test.js` | Sim | Data (1 linha) | Idem |
| `docs/build/auditoria-busca-cadastro-produtos.{json,md}` | M | `tests/stable/mib-audit-01-busca-cadastro-produtos.test.js` (rodado na bateria da Sprint 3.4, 10/10 08:57) | Sim | ±36/±12 linhas | Idem |
| `docs/build/AUDITORIA_GERAL_ENTRADA_NFE_XML_ATE_EFETIVACAO.md` | ?? | Manual (sessões de auditoria e Sprints 2.x/3.x) | **Não** | 188 KB | Commit 6 (documentação) |
| `docs/build/AUDITORIA_COMPLETA_CENTRAL_ENTRADAS.md` | ?? | Manual (auditoria de 10/10) | **Não** | 30 KB | Commit 6 |
| `docs/build/auditoria-integridade-idempotencia-e2e.md` | ?? | Manual (09/10) | **Não** | 15 KB; contém a senha (abaixo) | Commit 6, **depois** da remoção |
| `docs/build/PLANO_PROTECAO_E_CONSOLIDACAO.md` | ?? | Manual (Sprints 4.0/4.1) | **Não** | Este documento | Commit 6 |

- **Nada foi apagado ou descartado.**
- **Alerta:** quatro testes regravam artefatos rastreados quando executados (risco 18). Nenhum deles rodou na Sprint 4.1, e o retrato da árvore confirmou que nada mudou.
- **`package.json`:** aparecia como modificado no início da conversa, mas o conteúdo é idêntico ao do HEAD. Era só metadado de data, e hoje não aparece no `git status`.

**Senha padrão do administrador**
- **Onde:** `docs/build/auditoria-integridade-idempotencia-e2e.md`, **linha 174**, na tabela de pontos de segurança: "Admin seed senha `<valor>`". O valor vem do seed em `backend/database.js` (~3295).
- **Situação no Git:** o arquivo **não é rastreado**. O valor **nunca entrou no histórico**, então não é preciso reescrever o histórico.
- **Cópias fora do repositório:** o valor também está na cópia do backup da Sprint 4.0 (`C:\Users\cicer\CDS-backups\sprint40-protecao-…\arquivos\docs\build\`), que é local.
- **Este plano:** não contém o valor.
- **Proposta (não aplicada):**
  1. Trocar a célula da linha 174 por "Admin seed com **senha padrão do código** (`backend/database.js`, ~3295). Definir `ADMIN_SEED_PASSWORD` e bloquear o primeiro login se ainda for o padrão".
  2. Antes do commit 6, procurar o valor nos arquivos do commit com `git grep -n -F` sobre o conteúdo preparado. Isso deve ser feito pelo responsável, sem imprimir o valor no relatório.
  3. Numa sprint de segurança separada, tirar o valor literal do `database.js` (exigir `ADMIN_SEED_PASSWORD` ou gerar uma senha aleatória no primeiro boot). Isso é mudança de código e está fora desta etapa.

### 10.5 Homologação no Electron com cópia isolada

> **Correção (Sprint 4.2):** a conclusão abaixo vale para arquivos e banco, **não para rede**. A sincronização disparada pelo frontend ao abrir a Central fez uma consulta real à SEFAZ (ver 11.3).

**É possível isolar? Sim**, com estas garantias verificadas no código:
- `electron.js` só usa `C:\ProgramData\MercantilFiscal\dados` se `DB_DIR` não estiver definido (`process.env.DB_DIR || …`).
- `database.js` usa `DB_DIR` quando definido.
- Todos os outros caminhos gravados fora do banco usam `process.env.PROGRAMDATA`:
  - `server.js` (armazenamento `CDS Sistemas`);
  - `configuracaoService` e `rotas/configuracoes.js`;
  - `produtoImagemUpload.js`;
  - `nfeTrace.js`;
  - engenharia reversa e laboratório de equipamentos;
  - `backupManual.js` (que, além disso, prefere a pasta do próprio banco).
- Logo, definindo `DB_DIR` e `PROGRAMDATA` **dentro da cópia**, no processo do Electron, nada é gravado em `C:\ProgramData`.
- **Serviços de rede ao iniciar:** `CentralSyncBackgroundService`, `health`, `nfeOperacionalService.retomarConsultasPendentes`, equipamentos, monitor e integração de equipamentos. A cópia herda ambiente fiscal = produção, então esses serviços são **desligados** no wrapper, como na Sprint 3.0.
- **Outros serviços ao iniciar:** `observabilidade` só observa, e o plugin `business-monitor` só faz leitura local periódica. O `backend/backup.js` (Google Drive) não é carregado por nenhum módulo.
- **Perfil do Electron:** `userData` próprio, dentro da cópia.
- **Porta:** própria (3096). O `npm start` do usuário não está em execução e nenhuma porta 3000/3001/3095–3097 estava ocupada.
- **Código usado:** o da árvore de trabalho (`electron.js` do repositório). **Não usa nem altera** o ERP instalado em `C:\Program Files\CDS ERP`, e nada é instalado.
- **Migrações:** ao iniciar, o backend aplica as migrações de schema da árvore atual (ex.: `mibSchema.js`) **na cópia**. Isso só é aceitável porque a cópia é descartável e marcada. O wrapper recusa iniciar sem o marcador.

**Arquivos preparados (não executados)** em `%TEMP%\cds-s41\electron\`, todos com sintaxe conferida (`node --check` e o parser do PowerShell):

| Arquivo | Função | Travas |
|---|---|---|
| `criar-copia.js` | `VACUUM INTO` a partir de uma origem aberta **somente leitura**; grava `COPIA_HOMOLOGACAO_SPRINT41.txt` com origem, data e SHA-256, e cria `programdata\` | Destino só dentro de `%TEMP%`; recusa destino igual ao banco real; não sobrescreve; **origem em ProgramData exige `--origem-autorizada`** |
| `electron-main.js` | Wrapper: `userData` na cópia, desliga os serviços de rede e carrega o `electron.js` do repositório | Recusa se `DB_DIR` estiver fora de `%TEMP%` ou for o banco real, se `PROGRAMDATA` estiver fora de `DB_DIR`, se faltar o marcador, se `PORT` for 3000/3001 ou vazia, ou se faltar `JWT_SECRET` |
| `iniciar-homologacao.ps1` | Define `DB_DIR`, `PROGRAMDATA=<cópia>\programdata`, `PORT`, um `JWT_SECRET` aleatório e o log em `<cópia>\electron.log`; chama `node_modules\.bin\electron.cmd` | Confere `%TEMP%`, o marcador e se a porta está livre |

**Pré-requisitos (decisão do usuário)**
1. **Origem da cópia:**
   - **(a)** a cópia existente da Sprint 3.0 (`%TEMP%\cds-s30-electron\mercadao.db`, já descartável, sem tocar no ProgramData). Ela já contém as compras de homologação da 3.0 (NF 930001/930002);
   - **(b)** uma cópia nova de `C:\ProgramData\MercantilFiscal\dados\mercadao.db`, aberta somente leitura. Exige autorização explícita, porque abre o banco do ProgramData.
2. Quem opera o app. A automação via CDP foi bloqueada na Sprint 3.0; a recomendação é operação manual pelo usuário, com capturas de tela.
3. XMLs sintéticos de teste: o `prep.js` da Sprint 3.0 gera XML com CNPJ do banco e só lê o banco; ele pode ser adaptado.

**Sequência proposta (após autorização):**
1. `node %TEMP%\cds-s41\electron\criar-copia.js %TEMP%\cds-s30-electron\mercadao.db %TEMP%\cds-s41-electron`
2. `powershell -File %TEMP%\cds-s41\electron\iniciar-homologacao.ps1 -Copia %TEMP%\cds-s41-electron`
3. Roteiro da seção 7.2, item 3, mais:
   - item 7 (Financeiro, Ranking, Entregas: abrir, filtrar, buscar pedido);
   - uma NF-e com uCom `CENTO` ou `CT` (conferir sugestão, SIM/NÃO e quantidade);
   - edição de um produto com unidade comercial `CT` na cópia, para observar o risco 17.
4. Ao final: fechar o Electron, guardar o log e as capturas, e conferir que `C:\ProgramData\MercantilFiscal` não mudou (lista e data dos arquivos, sem abrir o banco). Apagar a cópia só com autorização.

**Não foi executado nada disso nesta sprint.**

### 10.6 Scripts ignorados: riscos de versionamento e de reversão

Os dois scripts ficam em `scripts/homologacao/` (seção 3). Estão no backup da Sprint 4.0, com hash conferido. Não foram executados.

| Risco | `sprint26-mapeamentos-miip.js` | `sprint31-reidentificar-miip-documentos.js` |
|---|---|---|
| **Versionar com `git add -f`** | Os ids de `miip_associacoes` e de produtos embutidos são do banco de teste. Versionado, vira um "script de correção" que alguém pode rodar em cliente. As pré-condições reduzem o risco, mas o conteúdo não se aplica a outro banco | Depende do código MIIP da árvore atual. Sobre o código do HEAD ou do pacote instalado, ele **regrava a identificação errada** (risco 12) |
| **Versionar com exceção no `.gitignore`** (`!scripts/homologacao/`) | Mesmo risco, e passa a valer para qualquer script novo da pasta | Idem |
| **Não versionar** | A reversão da aplicação de 09/10 depende deste arquivo e do log em `C:\ProgramData\…\backups\sprint26\`. Perder qualquer um dos dois impede reverter de forma auditada | Perde-se o procedimento reversível dos docs 179/264 |
| **Reversão** | Faz `DELETE` dos registros com `origem = correcao_auditoria_sprint26` e restaura status e metadados. Se esses mapeamentos forem usados ou editados depois, reverter pode desfazer decisões posteriores. Rodar a simulação antes | Restaura `parse_json`/`miip_resumo_json` e faz `DELETE` de uma linha marcada de `central_entradas_historico`. Recusa se o SHA-256 mudou desde a aplicação. Só existe se tiver havido `--aplicar`, o que ainda não aconteceu |
| **Pacote** | `scripts/**` é excluído do build: não entra no pacote | Idem |

**Outros arquivos ignorados encontrados nesta verificação** (contexto para a decisão):
- **`backend/motores/miip/logs/`:** `MiipAprendizadoLogService.js`, `MiipIntegracaoLogService.js`, `MiipMotorLogService.js` e `README.md`. É **código de produção** e está ignorado (risco 14). **Não está no backup da Sprint 4.0**, porque não é pendência do Git. A única cópia extra está no worktree de controle.
- **`scripts/`:** 73 arquivos (0,6 MB), entre eles 10 chamados por scripts do `package.json`: `prebuild-electron.js` (`build`, `build:all`), `build-cds-ui-bundle.js`, `criar-flag-modo-local.js`, `gerar-icones-branding.js`, `miip-benchmark-rc1.js`, `miip-gerar-readiness-report*.js`, `seed-central-entradas-demo.js`, `tef/destaxa-07b/runner.js` e `test-tef-fluxo-api.js` (risco 15). Também não estão no backup.
- **`backend/scripts/`:** 7 scripts de migração e auditoria, sem uso em tempo de execução.

O `.gitignore` não foi alterado.

### 10.7 Decisões pendentes de aprovação

1. **Testes introduzidos pelas pendências** (10.1):
   - **(a)** `central-nfe-apresentacao-compra`: atualizar o teste para incluir `extrairOrigemLinhaNfeCompra` no trecho extraído. A verificação mostrou 25/25 com o comportamento preservado;
   - **(b)** `central-nfe-produto-existente-novo`: confirmar que a ordem nova (identificação antes de conversão) é a regra desejada. Se for, ajustar a expectativa; se não, corrigir o código.

   As duas mudanças precisam de autorização, porque a regra é "não alterar testes antigos apenas para fazê-los passar". Sem uma delas, o commit 3 não atende o critério "falha idêntica ao HEAD".
2. **CENTO** (10.2): aprovar o grupo, incluindo o efeito no cadastro (risco 17), e confirmar que `CT` significa cento para os fornecedores atendidos. Alternativa: aprovar só `CENTO`/`CENTENA` e decidir `CT`/`CEN` numa sprint própria, o que seria mudança de código.
3. **Relatórios/Ranking/Entregas** (10.3): adiar até a homologação no Electron (recomendado) ou incluir agora como commit 2, sempre com os 8 arquivos juntos.
4. **Artefatos gerados** (10.4): não commitar e deixar o próximo build regenerar (recomendado), ou restaurar o HEAD (`git restore`, destrutivo).
5. **Senha padrão no documento** (10.4): aprovar a redação proposta para a linha 174 antes do commit 6.
6. **Homologação no Electron** (10.5): autorizar a execução, escolher a origem da cópia (a: cópia da Sprint 3.0; b: nova, a partir do ProgramData) e definir quem opera o app.
7. **Código ignorado** (riscos 14 e 15): versionar `backend/motores/miip/logs/` e os scripts de build de `scripts/` (exceções no `.gitignore` ou `git add -f`), e incluí-los num novo backup.
8. **Scripts de homologação** (10.6): mantém-se a decisão 3 da seção 9, agora com os riscos documentados.
9. **Arquivos soltos no pacote** (risco 16): excluir `out.txt`, `tmp-rc833.txt` e `.vscode/` do `build.files` numa sprint própria.
10. **Pacote instalado de origem desconhecida** (10.5 e seção 1): registrar que a próxima instalação deve partir de um build com manifesto, e guardar o hash do `app.asar` instalado.

**Comandos executados na Sprint 4.1:**
- **Leitura do Git:** `git status`, `diff`, `ls-files`, `check-ignore`, `show HEAD:<arquivo>`.
- **Testes:** `node --test` via executor, no worktree do HEAD e na árvore.
- **Inspeção:** `node -e` comparando a normalização de unidades no HEAD e na árvore; leitura do cabeçalho dos `app.asar` sem extrair; `Get-FileHash`.
- **Arquivos:** cópia dos 4 módulos `miip/logs` para o worktree de controle; arquivos auxiliares em `%TEMP%\cds-s41\`.
- **Não executado:**
  - nenhum `git add`, commit, `restore`, `reset`, `clean`, `stash` ou `apply` na árvore principal;
  - nenhuma abertura de banco real ou de cópia;
  - nenhum Electron, script de reidentificação, `npm install` ou build.

**Sprint 4.1 encerrada. Aguardando autorização para qualquer alteração de teste, commit, alteração de `.gitignore`, descarte de artefatos, homologação no Electron ou execução de scripts.**

---

## 11. Sprint 4.2 — Homologação isolada e proteção do build

**Resultado geral:** a homologação foi **interrompida (BLOCKED)**. O isolamento de **arquivos** se confirmou, mas o de **rede**, não: ao abrir a Central, a cópia fez uma consulta real à SEFAZ em produção. A afirmação "É possível isolar? Sim" da seção 10.5 **estava errada para chamadas de rede**.

### 11.1 Verificações antes de executar

| Verificação | Resultado |
|---|---|
| Scripts de `%TEMP%\cds-s41\electron\` lidos antes de executar | OK |
| Cópia: `%TEMP%\cds-s41-electron\mercadao.db`, criada por `VACUUM INTO` a partir da cópia da Sprint 3.0, com marcador `COPIA_HOMOLOGACAO_SPRINT41.txt` | OK |
| `DB_DIR` = cópia; `PROGRAMDATA` = `<cópia>\programdata`; `FISCAL_DIR` removido (passa a ser `<cópia>\fiscal`); `userData` na cópia | OK |
| Porta 3096 (servidor) e 9333 (CDP, só `127.0.0.1`) livres; recusa de 3000/3001 | OK |
| `JWT_SECRET` aleatório, gravado só na cópia | OK |
| Serviços de rede **ao iniciar** desligados no wrapper (6 serviços, seção 10.5) | OK |
| Sincronização SEFAZ **disparada pelo frontend** ao abrir a Central | **Não coberta** (ver 11.3) |
| Configuração fiscal da cópia | **Ambiente 1 (produção)** e caminho do certificado apontando para o `.pfx` real em `C:\ProgramData\MercantilFiscal\dados\fiscal\certificados\` |

Execução: Electron da árvore de trabalho (`node_modules\electron\dist\electron.exe` + wrapper), iniciado às 14:31:22Z (11:31 local), operado por CDP com login por JWT local (usuário id 1). Nada foi instalado ou atualizado; o ERP em `C:\Program Files\CDS ERP` não foi usado.

### 11.2 Cenários

Evidências em `%TEMP%\cds-s41\electron\` (capturas `s42-00-login.png` a `s42-08-apos-revisao.png`) e no log `%TEMP%\cds-s41-electron\electron.out.log`.

| # | Cenário | Resultado | Evidência |
|---|---|---|---|
| 1 | Abertura da Central | **PASS** | `s42-02-central.png`: cabeçalho "ONLINE · SEFAZ Normal · Modo: ASSISTIDO"; sem "XML Legado" no menu; nenhum `alert-danger` |
| 2 | Estado dos itens e contadores | **PASS** | Filtro padrão "Em Revisão 228". Contadores Todos 285 / Em Revisão 228 / Importadas 49 / Canceladas 5 / Em Importação 3, iguais à consulta somente leitura da cópia; 20 cartões, "Página 1 de 12" (`s42-03-lista.png`) |
| 3 | Apresentação dos candidatos | **FAIL** (dado antigo conhecido) | Doc 264, POLPA MARACUJA 400G: "Ver detalhes" compara com **"Frango do Dia"** (código interno 1), Semelhança 70/100 Baixa, Descrição "Diferente" (`s42-06-polpa-detalhes.png`). A lista lateral mostra o selo "CONFIRMAÇÃO", inconsistente com "Precisam confirmação 0" |
| 4 | POLPA MARACUJA 400G × Frango do Dia, sem reidentificação | **PASS na decisão / FAIL na exibição** | Decisão: "Não encontramos este produto no seu cadastro", 6 itens, "Precisam cadastro 6" (`s42-04` e `s42-05`). O candidato Frango vem de `parse_json`/`miip_resumo_json` gravados **antes da Sprint 3.1** (candidatos com 70 pontos). Só a reidentificação dos docs 179/264 corrige, e ela não foi executada (proibida). O modal "Vincular" lista o cadastro em ordem alfabética, sem Frango (`s42-07-vincular.png`). Nada foi vinculado |
| 5 | Mensagens simplificadas e modo no cabeçalho | **PASS parcial** | Modo no cabeçalho: OK. Atividade: "Sincronização SEFAZ iniciada" / "Sincronização automática será retomada quando disponível" (simplificadas). Monitor: "AGUARDANDO COOLDOWN DA SEFAZ". Pendência: o painel lateral mostra o código cru `EM_REVISAO` ("Em que etapa está? EM_REVISAO · 64%"); o NSU só aparece em "Informações Técnicas" |
| 6 | Ausência de erros bloqueantes | **PASS** até a interrupção | Nenhum erro de página ou modal de erro. O `electron.err.log` tem só avisos de chave de desenvolvimento (`TEF_ENCRYPTION_KEY`, `LICENSE_MASTER_KEY`) e `ALTER` ignorados por coluna já existente (`FechamentoFiscal`); nenhuma exceção |
| — | Roteiro restante (Financeiro/Ranking/Entregas, NF-e com `CENTO`/`CT`, edição de produto `CT`) | **BLOCKED** | Não executado: homologação interrompida pela falha de isolamento de rede |

### 11.3 Incidente: consulta real à SEFAZ a partir da cópia

- **O que aconteceu:** ao abrir a Central, o frontend chama `sincronizarAoAbrirCentralSuave()` (`frontend/erp/js/central-entradas.js`), que chama a rota `POST /api/central-entradas/sincronizar-ao-abrir` (`backend/rotas/central-entradas.js`). Essa rota leva a `CentralEntradasOrchestrator.sincronizarAoAbrir()` e a `executarSincronizacao({ origem: 'abrir_central' })`. O wrapper só desligava os serviços **iniciados no boot**; esse caminho não foi bloqueado.
- **Chamada:** às 14:33:22–24Z (11:33 local), DistDFe em **produção** (ambiente 1), com o certificado real lido do ProgramData. O arquivo foi lido (último acesso 14:33:23Z), não alterado (data de gravação inalterada).
- **Resposta:** cStat **656 (Consumo Indevido)**. Nenhum documento baixado, NSU não avançou.
- **Registros**, todos **só na cópia**:
  - `dfe_auditoria` 1900–1902 (correlação `SYNC-20261010-113323-231`);
  - `central_entradas_eventos` 2801 (`SYNC_INICIADA`) e 2802 (`SYNC_ERRO`);
  - `central_entradas_nsu`: `ult_nsu` 810 preservado, `cooldown_ate` 15:33:24Z.
- **Segunda abertura:** o gate registrou ALLOW às 14:35:31Z, mas não há novo registro em `dfe_auditoria`. Não se encontrou evidência de segunda chamada.
- **Efeito possível no mundo real:** a SEFAZ conta consultas por CNPJ. A consulta pode ter **renovado o bloqueio de 1 hora** de DistDFe do CNPJ do cliente até cerca de 15:33Z (12:33 local). O banco real não sabe desse cooldown. Se o app do cliente consultar antes disso, pode receber 656 de novo.
- **Ação tomada:** o Electron foi encerrado (PID 2640); as portas 3096/9333 foram fechadas; não restou processo da homologação.
- **Dados sensíveis no log:** o `electron.out.log` da cópia contém o despejo da configuração fiscal, **inclusive a senha do certificado**. O arquivo está apenas em `%TEMP%\cds-s41-electron\`; recomenda-se apagá-lo após a revisão (exige autorização, pois é evidência).

### 11.4 Alteração de data do banco real (`C:\ProgramData\MercantilFiscal\dados\mercadao.db`)

- **Observado** pela listagem de arquivos, sem abrir o banco:
  - a data de gravação passou de 14:29:59Z para 14:32:46Z;
  - o `-wal` (gravado às 14:31:05Z, **antes** do início da homologação às 14:31:22Z) e o `-shm` desapareceram, o que indica o checkpoint de fechamento de uma conexão.
- **Causa identificada:** o `npm start` do usuário (terminal integrado), que usa o banco real, estava em execução: há logs `[Central Entradas][HEALTH]` e `RECUPERACAO_XML` até 14:30:13Z. Ele terminou com código 0 por volta de 14:32:46Z. O checkpoint do fechamento explica a mudança.
- **O Electron da homologação não abriu o banco real.** O `DB_DIR` estava na cópia; o `programdata\` da cópia está vazio, e o repositório não teve arquivos alterados pela execução.
- **Coincidência registrada:** a captura `s42-00-login.png` (com `Page.bringToFront`) foi gravada no mesmo segundo do encerramento do `npm start`. O código não tem trava de instância única nem rotina que encerre outros processos (`requestSingleInstanceLock`, `taskkill`: inexistentes), e a saída 0 indica um fechamento normal. O mais provável é um fechamento manual da janela; **confirmar com o usuário**.
- **Falha da pré-checagem:** o lançador conferia só as portas 3096/9333, e a seção 10.5 afirmava que o `npm start` não estava em execução (verdade na 4.1, falso na 4.2). Rodar a homologação em paralelo com o app no banco real não comprometeu o banco, mas deve ser verificado e bloqueado.

### 11.5 Correções necessárias antes de nova homologação (não aplicadas)

Todas no wrapper ou na cópia; nenhuma mexe no código funcional.
1. **Trava de rede no processo principal:** no wrapper, substituir `https.request`/`tls.connect` (e `http.request` para hosts externos) por uma recusa a qualquer host que não seja `127.0.0.1`/`localhost`. É a única garantia independente da rota usada (sincronizar ao abrir, botão "Sincronizar", busca por chave, manifestação, consulta de cadastro).
2. **Neutralizar a sincronização da Central:** substituir `CentralEntradasOrchestrator.prototype.executarSincronizacao` e `buscarPorChave` por funções que devolvam "ignorado (homologação)".
3. **Neutralizar a configuração fiscal da cópia:** ambiente 2 (homologação) e caminho do certificado vazio ou inexistente, **só na cópia**. Também deve suprimir o despejo da senha no log.
4. **Pré-checagem de processos:** recusar iniciar se houver `electron.exe`/`node.exe` com o repositório ou o ERP instalado em execução, ou se as portas 3000/3001 estiverem ocupadas.
5. **Prova de isolamento antes do roteiro:** com a trava ativa, abrir a Central e confirmar que nenhum registro novo surgiu em `dfe_auditoria` e que o log mostra a recusa da trava.

### 11.6 Inventário de arquivos ignorados necessários

Levantado por `%TEMP%\cds-s41\inventario-ignorados.js` (somente leitura: `package.json`, `git check-ignore`, `git ls-files`, backup 4.0 e worktree de controle `%TEMP%\cds-baseline-head`).

| Arquivo | Dependente | No backup 4.0 | Outra cópia | Origem | Recomendação |
|---|---|---|---|---|---|
| `backend/motores/miip/logs/MiipMotorLogService.js` | `require` em 9 arquivos do backend (`MiipTelemetryService` e motores MIIP) | Não | Worktree de controle | Manual (código-fonte) | **Versionar (P0)**: sem ele o MIIP não carrega num clone limpo; o `!logs/**` do build só exclui o `logs/` da raiz, então hoje ele entra no pacote só porque existe no disco |
| `backend/motores/miip/logs/MiipAprendizadoLogService.js` | `require` em 2 arquivos | Não | Worktree de controle | Manual | **Versionar (P0)** |
| `backend/motores/miip/logs/MiipIntegracaoLogService.js` | `require` em 2 arquivos | Não | Worktree de controle | Manual | **Versionar (P0)** |
| `backend/motores/miip/logs/README.md` | Documentação da pasta | Não | Worktree de controle | Manual | Versionar junto |
| `scripts/prebuild-electron.js` | `build`, `build:all` | Não | Nenhuma | Manual | **Versionar (P0)**: sem ele `npm run build` falha |
| `scripts/build-cds-ui-bundle.js` | `build:cds-ui` | Não | Nenhuma | Manual | Versionar (P1) |
| `scripts/criar-flag-modo-local.js` | `recuperar:local`, `start:recuperar` | Não | Nenhuma | Manual | Versionar (P1): recuperação operacional |
| `scripts/gerar-icones-branding.js` | `branding:icones` | Não | Nenhuma | Manual | Versionar (P2) |
| `scripts/seed-central-entradas-demo.js` | `seed:central-entradas` | Não | Nenhuma | Manual | Versionar (P2), revisando que só grava em banco de demonstração |
| `scripts/miip-benchmark-rc1.js` | `test:miip-benchmark-rc1` | Não | Nenhuma | Manual | Versionar (P2) |
| `scripts/miip-gerar-readiness-report.js` | `test:miip-readiness-full` | Não | Nenhuma | Manual (gera relatório) | Versionar (P2) |
| `scripts/miip-gerar-readiness-report-final.js` | `test:miip-readiness-final` | Não | Nenhuma | Manual (gera relatório) | Versionar (P2) |
| `scripts/tef/destaxa-07b/runner.js` | `tef:destaxa-07b:preflight`, `tef:destaxa-07b:real` | Não | Nenhuma | Manual | Versionar (P2), sem credenciais |
| `scripts/test-tef-fluxo-api.js` | `test:tef-fluxo-api`, `test:tef` | Não | Nenhuma | Manual | Versionar (P2) |
| `scripts/homologacao/sprint31-reidentificar-miip-documentos.js` | Nenhum comando; reidentificação dos docs 179/264 | **Sim** (hash conferido) | — | Manual | Decisão da seção 10.6 (não versionar sem decisão) |
| `scripts/homologacao/sprint26-mapeamentos-miip.js` | Nenhum comando; mapeamentos/reversão da Sprint 2.6 | **Sim** (hash conferido) | — | Manual | Decisão da seção 10.6 |

- **Outros scripts referenciados no `package.json`** (`build/electron/*.js`, `backend/motores/equipamentos/sdk/cli/create-driver.js`) estão **versionados**; os de `build/electron/` não dependem de `scripts/` nem de `miip/logs`.
- **`backend/scripts/`** (7 arquivos) não é chamado pelo `package.json` nem em tempo de execução, e está excluído do pacote.
- **Dependências do build ainda desprotegidas:** os 3 módulos de `miip/logs` (+ README) e os 10 scripts de `scripts/`. Nenhum está no backup 4.0. Os de `scripts/` não têm nenhuma outra cópia.
- **`npm run build` não foi executado.** Os artefatos gerados pendentes (`electron-build-manifest.json`, relatórios de certificação) seriam sobrescritos, e as dependências acima não estão protegidas.
- **Proteção imediata sugerida** (sem Git): copiar esses 14 arquivos para uma nova pasta de backup, com hash SHA-256. Depois, decidir entre exceções no `.gitignore` (`!backend/motores/miip/logs/`, `!scripts/prebuild-electron.js`, …) ou `git add -f`.

### 11.7 Testes e CENTO

- **Nenhum teste foi alterado.**
- **`central-nfe-produto-existente-novo`**: análise pendente, sem mudança.
  - HEAD: 11/0. Árvore atual: 9/2.
  - As 2 falhas esperam `PENDENCIAS_CONVERSAO` e recebem `LINHA_CENTRAL_NAO_IDENTIFICADA`, porque desde a Sprint 2.2 a identificação é validada antes da conversão.
  - Decisão humana pendente (10.7, item 1b): se a ordem nova for a regra, ajustar a expectativa; se não, corrigir o código.
- **CENTO:** preservado como está em `MotorUnidadesMedida.js`, **sem ampliar a interpretação de `CT`** no cadastro geral (risco 17 e decisão 10.7, item 2 mantidos). Não foi homologado no Electron (cenário bloqueado).

### 11.8 Documentação

- `docs/build/auditoria-integridade-idempotencia-e2e.md`, linha 174: a senha literal foi trocada por "senha padrão (valor omitido; definir via `ADMIN_SEED_PASSWORD`)". Nenhuma outra conclusão foi alterada.

### 11.9 Recomendação do próximo passo

1. **Imediato (operacional):** avisar que o CNPJ do cliente pode estar em cooldown de DistDFe até cerca de 12:33 (horário local) de 10/10; evitar sincronização manual antes disso. Confirmar se o fechamento do `npm start` às 11:32 foi manual.
2. **Proteger as 14 dependências de build** (11.6) com novo backup e hash, e depois decidir como versioná-las.
3. **Reforçar o wrapper** com os itens 1 a 5 de 11.5 e provar o isolamento de rede antes de qualquer nova homologação, que exige nova autorização.
4. Só então retomar os cenários bloqueados (Financeiro/Ranking/Entregas, `CENTO`/`CT`). A exibição do candidato Frango continua dependendo da reidentificação dos docs 179/264, que só deve ocorrer depois do pacote novo instalado (risco 12).

**Comandos executados na Sprint 4.2:**
- **Cópia:** criada com `criar-copia.js` (`VACUUM INTO` a partir da cópia da Sprint 3.0, que já era descartável).
- **Electron:** lançado duas vezes sobre a cópia, operado por CDP em `127.0.0.1:9333`.
- **Consultas:** somente leitura na cópia (`consultar-copia.js`, `frango-copia.js`, `auditoria-sefaz-copia.js`).
- **Verificações:** listagem de arquivos do ProgramData, sem abrir o banco real; leitura do terminal do `npm start`.
- **Documentos:** edição deste plano e da linha 174 da auditoria.
- **Não executado:**
  - nenhum `git add`, commit ou alteração de `.gitignore`;
  - nenhuma migration manual, backfill ou reidentificação. As migrations automáticas do boot (F12, MUC RC2, MIB `nome_busca`) rodaram **na cópia descartável**, como previsto na 10.5;
  - nenhum build, nenhuma alteração de código funcional ou de teste.

**Sprint 4.2 encerrada com a homologação BLOQUEADA por falha de isolamento de rede.**

---

## 12. Sprint 4.3A — Proteção dos arquivos e isolamento de rede

Sem homologação funcional: a Central não foi aberta e o app CDS não foi iniciado. Scripts e evidências ficam em `%TEMP%\cds-s43\` (evidências em `prova\`).

### 12.1 Backup dos 14 arquivos ignorados — PASS (14/14)

- **Destino:** `C:\Users\cicer\CDS-backups\sprint43a-arquivos-ignorados-20261010-160032\`, com os arquivos em `arquivos\` e o manifesto em `MANIFESTO.json` e `MANIFESTO.md`.
- **Conferência:** o SHA-256 foi calculado no original antes e depois da cópia e na cópia, e conferido de novo por `Get-FileHash`.
- **Backups anteriores:** o backup 4.0 está preservado.

| Arquivo | Bytes | SHA-256 |
|---|---|---|
| `backend/motores/miip/logs/MiipMotorLogService.js` | 2858 | `32EEF0735DD1DE9C06DB61326A80496B2FDE410B2336C47E0BB8FD704E0BD656` |
| `backend/motores/miip/logs/MiipAprendizadoLogService.js` | 3135 | `BA2E9E7ECF3F9259B1F22577297B1DC82673FDEEA730071CABDDCE9A65C1212A` |
| `backend/motores/miip/logs/MiipIntegracaoLogService.js` | 4692 | `89FBBC52091F0B925A873F02E07DB23E7564B169841BE3C73E260F0BA0C57F29` |
| `backend/motores/miip/logs/README.md` | 1240 | `07C0B294E6AE8C39C8ACF8E16C8E00F9CF4CF430E30076030593C3135068D440` |
| `scripts/prebuild-electron.js` | 389 | `A401234B1E1A7650F8A5D807324914C4A699BE216B547368BBCDF81F0D6B7615` |
| `scripts/build-cds-ui-bundle.js` | 752 | `1701ECA349C0C3A31FE5525D2BFA63FF5D669F08A05C0AA06BDDE35F2B9A5F26` |
| `scripts/criar-flag-modo-local.js` | 702 | `0E5DBA834C67223D551853A06CB1D34773E0A560419860AD3527EFC28F81913A` |
| `scripts/gerar-icones-branding.js` | 1706 | `DDC4A133B4A6E8D0846B2108502979C0AC24A0D136D224177475C6FCE8F4A7CE` |
| `scripts/seed-central-entradas-demo.js` | 4103 | `50F7A6D5FE4BE512BB26B2D20D1E5724885B48FDCC5C6100BD6A12C188DA8AA8` |
| `scripts/miip-benchmark-rc1.js` | 7767 | `A83A68B80C934B1FA900651D0F4CC9E4276EB19F64E5E2CD344395D4F6922801` |
| `scripts/miip-gerar-readiness-report.js` | 999 | `97758F607EB7CE781C8C299BD8343B623EFC15741DB118C47F6D1941A45BE595` |
| `scripts/miip-gerar-readiness-report-final.js` | 1326 | `D3137A35FAB82B3A3512611762CE7489032BE66A3BC72D5286D5F16390EB67AF` |
| `scripts/tef/destaxa-07b/runner.js` | 5034 | `BBAD317B02DD62E3A4F8E1BEB6672E711FA6175BD5CFC445F701E449A9BDF530` |
| `scripts/test-tef-fluxo-api.js` | 6919 | `BAB396657BBADAE1A97FA5602B8159BB0BD150E14A86D884B09504AB3023E0DE` |

### 12.2 Log com a senha do certificado — tratado

- **Original removido:** `%TEMP%\cds-s41-electron\electron.out.log` (SHA-256 `F698E90D…4A3E`).
- **Evidência preservada:** `electron.out.REDIGIDO.log` (SHA-256 `A83CCE2F…A27D`), com as mesmas 366 linhas.
- **O que foi redigido:** 6 valores distintos — a senha do certificado e o token CSC (duas linhas cada) e sequências numéricas com formato de CNPJ.
- **Conferência:** antes da remoção do original, confirmou-se que nenhum desses valores aparece na cópia redigida. Os CNPJs dos logs do gate SEFAZ já estavam mascarados pelo próprio app. O caminho do certificado não é segredo e foi mantido.

### 12.3 Mecanismo de bloqueio de rede

**Camada efetiva (sistema operacional): Windows Defender Firewall (WFP).**
- **Runtime dedicado:** cópia do Electron 22.3.27 em `%TEMP%\cds-s43\runtime\cds-homologacao-s43.exe` (SHA-256 `2ED95437…39CB`, igual ao `electron.exe` do repositório). Ele é distinto do `npm start` e do ERP instalado.
- **Regras:** grupo `CDS Homologacao S43A`, criado com elevação (UAC) às 16:07:58Z:
  - `Bloqueio SAIDA (runtime dedicado)`: saída, bloquear, todos os perfis, todos os protocolos;
  - `Bloqueio ENTRADA (runtime dedicado)`: entrada, idem.
- **Estado conferido:** perfis Domain, Private e Public ligados; serviço `MpsSvc` em execução; nenhuma regra com `OverrideBlockRules`.
- **Alcance:** cobre todos os processos desse executável — principal (backend Node), renderer, GPU, serviço de rede do Chromium, `utilityProcess`, e `fork`/`spawn` do próprio runtime (o TEF usa `fork`/`utilityProcess` com `process.execPath`).
- **Não cobre:**
  - executáveis diferentes (o app pode chamar `powershell`, `python`, `node`, `sc`, `route` e `tasklist`);
  - a resolução DNS, feita pelo serviço Dnscache do Windows;
  - o tráfego de loopback.

**Camada interna (defesa em profundidade)** — `guarda-isolamento.js`, carregado pelo wrapper antes do app:
- recusa `spawn`/`execFile` de qualquer executável que não seja o runtime, e `exec` via shell;
- recusa TCP, UDP e DNS fora do loopback;
- no Chromium, `host-resolver-rules` impede resolver nomes.

**Camada da aplicação** — `electron-main-s43.js`, preparado e não executado:
- desliga os 6 serviços de boot;
- neutraliza `CentralEntradasOrchestrator.executarSincronizacao` e `buscarPorChave`, que cobrem "sincronizar ao abrir", o botão Sincronizar e a busca por chave;
- marca a janela com `[HOMOLOGAÇÃO ISOLADA S43]`;
- recusa rodar fora do runtime dedicado.

### 12.4 Prova de bloqueio (sem SEFAZ, sem serviço externo)

- **Destinos:** só endereços reservados para documentação, `192.0.2.1` (RFC 5737) e `2001:db8::1` (RFC 3849), por IP literal (sem DNS).
- **Ordem:** pré-checagem `BLOQUEADO` sem regras (`prechecagem-…130536.json`), depois criação das regras, depois pré-checagem `APTO` (`…130828.json`), e só então as provas.

| Prova | Processos | Resultado | Evidência |
|---|---|---|---|
| TCP IPv4/IPv6 em modo Node | principal + `fork` + `spawn` (PIDs distintos, mesmo runtime) | `EACCES` em 1–4 ms nos 6 casos | `prova-node.json` |
| UDP 192.0.2.1:53 em modo Node | idem | a API devolve "enviado"; o firewall registrou `DROP UDP … SEND` nos 3 casos | `prova-node.json` + `evidencias-firewall-resumo.json` |
| Serviço de rede do Chromium (`net.request`) | `network.mojom.NetworkService` | `net::ERR_NETWORK_ACCESS_DENIED` | `prova-electron-sem-resolver.json` |
| Renderer (`fetch`) | renderer oculto | `net::ERR_NETWORK_ACCESS_DENIED` | idem |
| `utilityProcess` | `node.mojom.NodeService` | `EACCES` | idem e `prova-electron.json` |
| Resolução de nomes desligada no Chromium | serviço de rede | `ERR_NAME_NOT_RESOLVED` mesmo para IP literal | `prova-electron.json` |
| Guarda interna (9 casos) | modo Node | 9/9 PASS. A 1ª execução tinha um defeito (`net.connect` direto passava pela guarda) e o firewall bloqueou mesmo assim (`EACCES`); corrigido | `prova-guarda.json`, `prova-guarda-1-defeito.json` |

- **Log do firewall** (`LogBlocked` ligado só durante a prova e depois restaurado para `False`): 13 linhas `DROP … SEND` para os destinos de teste, coerentes com os horários das provas. Das 14 tentativas que chegaram ao sistema, só o `utilityProcess` da 1ª prova Electron (16:08:47Z) não deixou linha; ele também recebeu `EACCES`.
- **Por que isso prova que nada saiu:**
  - o `EACCES` e o `ERR_NETWORK_ACCESS_DENIED` chegam em milissegundos, que é a recusa local do WFP; uma conexão que saísse daria timeout;
  - o log mostra `DROP` no sentido `SEND`, ou seja, descarte no próprio host.
- **Auditoria do Windows (evento 5157):** não foi usada. O `auditpol` em português não traz a coluna numérica do estado, então o script não alterou a política, para não arriscar a restauração.
- **SEFAZ:** nenhuma consulta. As provas não carregam código do app e não contêm nenhum host da SEFAZ. A Central não foi aberta.

### 12.5 Proteção contra abertura simultânea — PASS (preparada e testada sem iniciar o app)

`iniciar-homologacao-s43.ps1` só faz a pré-checagem, a menos que se use `-Executar`. Ele **nunca encerra processos** e recusa iniciar se:
- houver `CDS ERP.exe`, `CDS PDV.exe` ou `electron.exe` abertos, `node` rodando `electron`/`npm start`/`nodemon`, ou outra instância do runtime;
- as portas 3000, 3001, 3096 ou 9333 estiverem ocupadas;
- a regra de saída ou a de entrada não estiver ativa para o caminho exato do runtime, se houver regra de permissão para ele, ou se algum perfil do firewall estiver desligado;
- o hash do runtime divergir do manifesto;
- a cópia estiver fora de `%TEMP%`, apontar para ProgramData ou não tiver o marcador.

A instância de teste se identifica pelo executável próprio, pelo `userData` na cópia e pelo título da janela.

### 12.6 Pendências e riscos

1. Subprocessos de **outros executáveis** são barrados só pela guarda interna, não pelo sistema operacional. Cobertura total pelo sistema exigiria um usuário Windows dedicado com regra por usuário, ou uma VM ou sandbox (o Windows Sandbox não está disponível: recurso ausente e virtualização desligada no firmware).
2. O **DNS** passa pelo serviço Dnscache: um nome pode ser resolvido, mas nenhuma conexão sai. Mitigado pela guarda e por `host-resolver-rules`.
3. O **loopback** não é filtrado pelo firewall: um serviço local poderia servir de ponte. Por isso a pré-checagem recusa iniciar com a porta 3000/3001 ocupada.
4. A **cópia de teste** ainda tem a configuração fiscal de produção e o caminho do certificado real; o arquivo é lido, mas a rede está bloqueada.
5. **As regras permanecem ativas** para a próxima etapa. Para remover (elevado): `Remove-NetFirewallRule -Group 'CDS Homologacao S43A'`.
6. Se o runtime for recriado ou atualizado, o hash muda e a pré-checagem recusa: as regras e o manifesto devem ser refeitos.

**Sprint 4.3A encerrada. A homologação funcional aguarda autorização.**

## 13. Sprint 4.3B — Correção definitiva da identificação de produtos

### 13.1 Causa comprovada (POLPA MARACUJA 400G × Frango do Dia, 70/100)

1. **Origem do candidato:** a busca antiga comparava o cProd do fornecedor (`1`) com o código interno do CDS (`produtos.codigo = 1`). Pontuação: 82 por `codigo_fornecedor` menos 12 por `unidade_diff`, total 70. Corrigido na Sprint 3.1: o cProd só identifica pelo mapeamento CNPJ + cProd. O PLU nunca é derivado do cProd. "SEM GTIN", vazio e zeros não identificam.
2. **Decisão incoerente:** com `acao = criar_novo`, o mapper ainda preenchia `produtoEncontrado`, `candidatoSelecionado`, `candidatos` e a pontuação a partir de `melhorCandidato` ou `candidatos[0]`. O resultado dizia "precisa cadastro" e, ao mesmo tempo, trazia o Frango com 70.
   - Na política V2, a pontuação exibida era a da decisão anterior do pipeline, mesmo quando a política escolhia outro candidato ou nenhum.
   - O código de barras de produto desativado contava como confirmação e cadastro ao mesmo tempo.
3. **Resultado congelado:** o resultado do doc 264 está gravado em três lugares:
   - `parse_json.miip_importacao.resultados`;
   - `item.miip_resultado` e `item.miip_sugestao`;
   - `miip_resumo_json`.
   
   Ele era servido sem revalidação por `payload-compra`, por `/processar` (que reaproveita o parse), pela sessão de revisão e por `obterParseDocumento`. A tela (lista, detalhes e o módulo comercial, via `resolverProdutoId`) lia esse `produtoEncontrado`.

### 13.2 Regra corrigida

- **Hierarquia (inalterada):** código de barras exato → mapeamento CNPJ + cProd confirmado → código interno explícito → nome com palavra descritiva em comum ou sinônimo (só sugere) → cadastrar produto novo.
- **Decisão canônica "cadastrar novo":**
  - `produtoEncontrado`, `candidatoSelecionado` e `motor` vazios, `candidatos = []` e pontuação 0;
  - `precisaConfirmacao = false` e `precisaCadastro = true`, sem sugestão para Compras;
  - única exceção: o produto desativado com o mesmo código de barras fica em `produtoEncontrado`, apenas para o aviso.
- **Pontuação:** com a política V2, é a do candidato apresentado.
- **Versão da regra:** cada resultado novo grava `regraIdentificacao = miip-v2-s43b`.
- **Na tela:** a etiqueta Cadastro/Confirmação e a ordenação seguem a decisão (`precisaCadastro` e `precisaConfirmacao`), e não a presença de um produto anexado.

### 13.3 Resultado legado

- **Revalidação na leitura, sem gravar:** todo resultado sem `regraIdentificacao` atual é revalidado por `MiipRevalidacaoResultadoPersistido` nos quatro pontos de leitura acima.
- **O que a revalidação aplica aos candidatos gravados:**
  - remove `codigo_fornecedor` que não veio do mapeamento;
  - recalcula "descrição" (palavra descritiva × só medida) e a pontuação da busca;
  - aplica a barreira de compatibilidade e a política V2, e remonta a decisão pelo mapper canônico.
- **Contadores e itens:** os contadores são recontados. `miip_resultado` e `miip_sugestao` dos itens são alinhados. Um vínculo automático antigo sem evidência válida perde o `produto_id` no payload, exceto se o operador já decidiu a linha na revisão.
- **Rastro:** cada resultado revalidado carrega `revalidacao` (origem, se mudou e o estado anterior).
- **Limite:** a revalidação só remove ou rebaixa candidatos. Um candidato novo, como um mapeamento criado depois, só aparece com reprocessamento.
- **Procedimento mínimo depois da homologação, com autorização:**
  1. Backup do banco.
  2. Reprocessar com `forcarReprocessamento` apenas os documentos ainda não importados, com o script da Sprint 3.1 (seção 21.4 da auditoria) em modo de simulação primeiro.
  3. Conferir a lista e os contadores na Central.
  
  Nesta sprint não houve reidentificação, migração, backfill nem alteração de histórico.

### 13.4 Arquivos

- **Novos:**
  - `backend/motores/miip/utils/MiipRevalidacaoResultadoPersistido.js`;
  - `backend/motores/miip/utils/evidenciaDescricao.js` (regra de descrição, compartilhada com o MUBC);
  - `tests/miip/sprint43b-identificacao-decisao-canonica.test.js`.
- **Alterados:**
  - `MiipResultadoImportacaoMapper` (decisão canônica e pontuação);
  - `MiipIdentificacaoV2Policy` (versão da regra);
  - `MiipImportacaoResultado` e `MiipImportacaoXmlService` (gravam a versão);
  - `MotorUniversalBuscaCandidatos` (usa `evidenciaDescricao` e `pontuarMotivos`, com os mesmos pesos);
  - `CentralComprasBridgeService`, `CentralProcessamentoService`, `CentralRevisaoPersistenteService` e `CentralEntradasOrchestrator` (revalidação na leitura);
  - `frontend/erp/js/miip-central-revisao.js` (etiqueta e ordenação pela decisão).

### 13.5 Testes

- **Teste novo:** 26/26.
- **Regressões, um processo por arquivo:** 34 arquivos com 30 PASS. As 4 falhas são as mesmas da linha de base (seção 21 da auditoria), com as mesmas contagens:
  - `miip-rc94-ux`;
  - `central-entradas-sprint2` (3);
  - `central-nfe-apresentacao-compra` (4);
  - `central-nfe-produto-existente-novo` (2).
- **Preservação:** os 14 arquivos protegidos conferem com o manifesto (14/14), e as regras de firewall S43A continuam ativas.
- **Isolamento:** nenhum aplicativo aberto, nenhuma consulta externa.

**Sprint 4.3B encerrada. A homologação aguarda autorização.**
