# MRT-50.39 — Homologação da inicialização operacional ERP/PDV

## Resultado

**BLOQUEADA — ERP e PDV não foram iniciados.** A inspeção estática da cadeia de inicialização comprovou migrações/seeds automáticos no banco e uma sincronização financeira automática pós-listen que altera `financeiro` e `contas_receber`. Como a sprint proíbe essas operações sem autorização específica, iniciar o backend violaria o escopo. Não foi tentado contornar ou desativar os hooks.

Esta entrega não reabre a recuperação criptográfica aprovada no MRT-50.38 e não homologa o startup completo.

## Integridade RC3.16.6

Foi executada a validação read-only `validarIntegridadePacoteLocal` de `electron-integrity.js` sobre o worktree atual, nos modos `erp` e `pdv`. Não foram escritos nem regenerados manifestos.

| Checagem | ERP | PDV |
|---|---:|---:|
| Módulo declarado em `electron-manifest.json` | Manifesto declara `pdv`; incompatível | Compatível |
| Erros reportados no worktree atual | 14 | 12 |
| Hashes de arquivos divergentes | 12 | 12 |
| Divergência do `package.json` efetivo | Sim: manifesto PDV comparado ao pacote ERP | Não |
| Erros estruturais internos do manifesto | 0 | 0 |

O manifesto atual informa módulo `pdv`, commit `ecbcdf0`, branch `fix/p0-lentidao-cancelamento-nfce`, build `2026-11-06T15:34:35.403Z` e 1.949 arquivos.

Os 12 arquivos com hash divergente são:

- `backend/database.js`
- `backend/rotas/fiscal.js`
- `backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js`
- `backend/services/fechamento-fiscal/NfceCstat539ReconciliacaoService.js`
- `backend/services/fechamento-fiscal/NfceHistoricoOficialService.js`
- `backend/services/fiscal/emissor.js`
- `backend/services/fiscal/exportarContabilidadeService.js`
- `backend/services/tef/tefSigningKeyProvisioner.js`
- `electron-common.js`
- `electron-pdv.js`
- `frontend/erp/js/central-contabil.js`
- `frontend/shared/js/vendasHistoricoUi.js`

No ERP soma-se a incompatibilidade de módulo e a divergência do `package.json` efetivo. O SHA-256 do `package.json` no repositório é `289f42d8dbfb2da38f65518e3bbf00f7d78793d4e05f83e1828368428465f90a`; o hash registrado no manifesto é `c3c491dd5d010f25fd2ac363e049a65d06892c749ecab7255e3158202c4d23f0`, que corresponde ao `package.json` efetivo do PDV. O pacote efetivo ERP tem hash `ff5d4f86bbb406a75f151033ed110be3e2795a1aeb4a03bebffd708c623a2e12`.

**Efeito no startup:** em desenvolvimento, `garantirIntegridadeOuAbortar()` registra a inconsistência como aviso e retorna `ok: true`; portanto, esta divergência, isoladamente, não impede o startup normal de desenvolvimento. Em execução empacotada em ASAR, o mesmo erro de integridade faz o gate retornar `ok: false` e aborta a inicialização. O relatório anterior de nove divergências não descreve mais o estado atual: a checagem read-only encontrou 12 hashes de arquivo divergentes.

## Avaliação dos efeitos de inicialização

Antes do listen, `backend/database.js` abre `C:\ProgramData\MercantilFiscal\dados\mercadao.db`; no sucesso da conexão, chama `inicializarBanco()` automaticamente. A rotina executa, entre outros:

- `criarTabelas()` e `criarTabelasMiip()`;
- `aplicarAlteracoesPosCriacao()` com vários `ALTER TABLE` e criação de índices;
- migração de dados de sessão de caixa;
- inserção de configurações padrão e seeds de catálogo/usuário;
- migração de URLs fiscais;
- garantias/normalizações de dados de caixa, financeiro, compras e produtos.

Isso é escrita e migração de schema sem um gate de consentimento observado nesta cadeia.

Depois que o servidor começa a escutar, o callback agenda `iniciarServicosBackgroundGrupoB()` por `setImmediate`. O primeiro passo é `financeiro-sync`, que chama `sincronizarFinanceiroVendasCanceladas()`. Para vendas canceladas, esse serviço executa `UPDATE` em `financeiro` e `contas_receber`, incluindo alteração de status, saldo e observação. Esse hook conflita diretamente com a proibição de alterar esses registros.

O mesmo grupo inicia monitoramento/integração de equipamentos, sincronização da Central de Entradas, health checks e retomada de consultas fiscais pendentes; esta última garante schema operacional e retoma consultas. Não há opção de startup já comprovada nesta tarefa que mantenha esses hooks inativos. Como o primeiro hook financeiro é agendado assim que o servidor escuta, não há uma janela segura para iniciar o servidor e encerrá-lo antes da sincronização.

O backend também importa `backend/rotas/tef.js`, que importa `backend/services/tef`; esta fachada instancia `TefManager`. O construtor configura o cliente NativeHost e agenda `garantirRecuperacao()` em `setImmediate`. Não foi observado um caminho de inicialização que carregue o backend sem esse conjunto de imports.

## Resultado ERP e PDV

| Etapa | ERP | PDV |
|---|---|---|
| Seleção do perfil | MRT-50.38 aprovado; não reexecutado | MRT-50.38 aprovado; não reexecutado |
| Contexto/chave/fingerprint | MRT-50.38 aprovado; sem nova recuperação nesta sprint | MRT-50.38 aprovado; sem nova recuperação nesta sprint |
| Backend e servidor local | **BLOQUEADO — não iniciados** | **BLOQUEADO — não iniciados** |
| Logs atuais de recuperação da chave | Nenhum novo log; referência é a prova no MRT-50.38 | Nenhum novo log; referência é a prova no MRT-50.38 |
| Resultado runtime do TefManager | **NÃO COMPROVADO — backend não carregado** | **NÃO COMPROVADO — backend não carregado** |
| Tela de login/operacional | **NÃO COMPROVADO — aplicativo não iniciado** | **NÃO COMPROVADO — aplicativo não iniciado** |

## Preservação e próximos passos

Nenhum processo Electron/backend foi iniciado e nenhum banco foi aberto nesta sprint. Não foram executadas migrações, seeds, sincronizações, consultas fiscais, operações TEF ou operações financeiras. Assim, nenhum registro financeiro foi alterado por esta execução; não foi feita comparação direta dos registros do banco.

**Bloqueio remanescente:** obter autorização específica para as migrações/seeds automáticos e para a sincronização financeira, ou aprovar previamente uma alteração de startup que isole esses hooks sem contorno silencioso. Essa alteração está fora desta sprint e não foi feita.

Enquanto o bloqueio não for resolvido, os critérios de inicialização operacional não passam e a fase não deve avançar para validação física Destaxa.
