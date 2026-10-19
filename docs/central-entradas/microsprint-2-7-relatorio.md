# Microsprint 2.7 — relatório parcial de auditoria

**Data:** 17/10/2026  
**Status:** parcial; critérios de conclusão não atendidos  
**Escopo deste relatório:** somente evidências já coletadas. Nenhum teste adicional foi executado para elaborá-lo.

## Segurança e limite da validação

Foi executado `tests/central-entradas/rc74-xml-wait-scheduler.test.js` sem definir `DB_DIR`. A saída confirmou a inicialização de `backend/database.js`, criação/verificação de tabelas e aplicação de alterações de schema. Como `backend/database.js` recorre ao diretório padrão do aplicativo quando `DB_DIR` não está definido e não há isolamento de teste ativo, **não é possível comprovar que essa execução ficou isolada**. A origem e o alcance de eventuais alterações de schema não foram verificados. Não foram feitas consultas para investigar esse evento.

A execução parou em `testSemProcContinuaComBackoff`, com `0 !== 1`. Ela é registrada apenas como evidência de execução insegura/inconclusiva, não como resultado válido de regressão. Não voltar a executar testes ou abrir o banco sem isolamento explicitamente verificado.

Nas demais execuções descritas abaixo, cada comando recebeu `DB_DIR` apontando para um diretório temporário novo. Nenhum teste foi configurado para chamar a SEFAZ; não foi iniciado o CDS normal.

## Estado do repositório observado

- Branch: `fix/p0-lentidao-cancelamento-nfce`
- HEAD: `6271dca46561b7f89805e8602a8a5547a08b11c6`
- Worktree observado: 91 arquivos rastreados modificados e 27 arquivos não rastreados.
- Nenhum arquivo sob `backend/motores/central-entradas`, `tests/central-entradas` ou `docs/central-entradas` estava modificado antes da criação deste relatório.
- Não foi encontrado `docs/central-entradas/microsprint-2-6-recuperacao-processamento-relatorio.md` no worktree ou no HEAD consultado; tampouco correspondência no histórico pesquisado.
- O diff do HEAD em `CentralProcessamentoService.js` e `CentralEntradasOrchestrator.js` inclui revalidação de parse/MIIP persistidos e mudanças de revisão. Não foi possível atribuir essas alterações à Microsprint 2.6 sem o relatório ou referência correspondente.

## Evidência funcional relacionada à recuperação

O código de `CentralDocumentosRepository.listarPendentesProcessamento()` seleciona documentos `SINCRONIZADA` sem `parse_json`. Em `CentralProcessamentoService.processar()`, um documento com `parseJson` existente retorna como `reutilizado` antes de avaliar ou avançar o status. Um ensaio com doubles, sem banco, confirmou essa consequência para um documento sintético em `EM_PROCESSAMENTO` com parse e resumo MIIP persistidos: o resultado foi sucesso/reutilizado, o status permaneceu `EM_PROCESSAMENTO`, e não houve chamada de transição nem atualização.

Isso demonstra um caminho possível para status obsoleto, mas **não comprova que seja a falha CE-05/06 ou 05.74**, nem que corresponda à correção 2.6. A implementação específica de recuperação solicitada não foi localizada nos símbolos pesquisados.

## Resultados das suítes executadas com DB_DIR temporário

| Comando/teste | Resultado observado | Classificação |
|---|---:|---|
| `node tests/central-entradas/rc1-consolidacao.test.js` | 10 aprovados, 0 falhas | Aprovado |
| `node tests/central-entradas/maquina-estados.test.js` | 11 aprovados, 0 falhas | Aprovado |
| `node tests/central-entradas/central-entradas-sprint8.test.js` | 7 aprovados, 1 falha: `mutex impede sync simultânea` | Falha reproduzida; fixture manipula `_executando`, enquanto o serviço atual consulta o lock DistDfe |
| `node tests/central-entradas/rc2-diagnostico.test.js` | 9 aprovados, 0 falhas | Aprovado; contexto/certificado sintético ausente e nenhuma operação de conexão SEFAZ chamada pelo teste |
| `node tests/central-entradas/central-entradas-sprint2.test.js` | 5 aprovados, 3 falhas | Falhas: transição manual esperava `XML_COMPLETO`, mas leu `null`; status inválido não lançou erro; filtro encontrou 0 em vez de 1 |
| `node tests/central-entradas/central-entradas-sprint4.test.js` | 5 aprovados, 0 falhas | Aprovado |
| `node tests/central-entradas/central-entradas-sprint5.test.js` | 7 aprovados, 0 falhas | Aprovado |
| `node tests/central-entradas/central-entradas-sprint7.test.js` | 10 aprovados, 1 falha | Falha: `score documento GRAVADA com MIIP alto`, `scoreGeral >= 90` |
| `node tests/central-entradas/central-entradas-sprint9.test.js` | 6 aprovados, 1 falha | Falha: esperava `sincronizando`, obteve `offline` |
| `node tests/central-entradas/central-entradas-sprint10.test.js` | 7 aprovados, 0 falhas | Aprovado |
| `npm run test:central-entradas` | Interrompido em `central-entradas-sprint2.test.js` | Script usa `&&`; os passos seguintes não foram executados nessa chamada |
| `node tests/central-entradas/rc74-xml-wait-scheduler.test.js` | `testSemProcContinuaComBackoff`: `0 !== 1` | **Não confiável para regressão**: executado sem `DB_DIR`; consultar a ressalva de segurança acima |

Os erros de setup do schema fiscal informando colunas duplicadas foram registrados como ignorados pelo próprio setup nos testes isolados; não foram tratados como falhas de asserção.

## CE-05/06, 05.74 e empresa

As referências `CE-05`, `CE-06`, `05.74` e `EMPRESA_CENTRAL_AUSENTE` não foram encontradas nos caminhos pesquisados do código, testes e documentação disponíveis. Sem os arquivos/testes que reproduzem esses identificadores e sem o relatório 2.6, não é possível confirmar:

- se `EMPRESA_CENTRAL_AUSENTE` vem do fixture, do contexto requerido ou de defeito funcional;
- o estado persistido esperado para cada caso;
- se as falhas observadas são preexistentes à Microsprint 2.6.

Nenhum fallback global de empresa foi adicionado e nenhuma validação de `empresaId` foi removida.

## Arquivos alterados nesta entrega parcial

- `docs/central-entradas/microsprint-2-7-relatorio.md` — criado como relatório parcial.

Nenhum código de Central de Entradas foi alterado durante esta auditoria. Os outros arquivos locais preexistentes foram preservados.

## Pendências para conclusão

1. O operador deve avaliar a execução RC7.4 feita sem `DB_DIR` e confirmar o estado do ambiente. Não investigar nem modificar o banco padrão durante esta etapa.
2. Fornecer ou restaurar a documentação 2.6, os testes CE-05/06 e 05.74, ou seus identificadores reproduzíveis.
3. Executar a suíte completa apenas em harness que valide `DB_DIR` e o caminho efetivo antes de abrir SQLite, e com integrações externas desabilitadas/mocadas.
4. Classificar as falhas de Sprint 2, 7, 8 e 9 antes de qualquer correção; ainda não há prova suficiente para mudar o código ou as expectativas desses testes.

**Conclusão:** não há base para declarar a recuperação validada nem para classificar as falhas específicas de CE-05/06 e 05.74. Este documento registra evidências parciais e a limitação de segurança; não certifica a entrega.
