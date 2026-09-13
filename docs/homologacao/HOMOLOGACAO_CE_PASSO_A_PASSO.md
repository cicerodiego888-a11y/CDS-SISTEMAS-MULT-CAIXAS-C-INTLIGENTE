# Homologação NFC-e CE - ajustes aplicados

## O que foi ajustado no código

### 1. fiscalService.js
- chave de acesso agora é gerada com DV real por módulo 11
- XML passou a sair em estrutura mais próxima da NFC-e 4.00
- incluído `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">`
- incluído lote síncrono (`idLote` + `indSinc`)
- incluídos grupos `ide`, `emit`, `det`, `total`, `transp` e `pag`
- incluída validação mais rígida de NCM, CFOP, CSC, município IBGE e certificado
- grava QR Code URL no banco

### 2. sefazService.js
- removida simulação fake de autorização
- adicionada chamada SOAP 1.2 para autorização NFC-e 4.00
- adicionada consulta de recibo quando retorno vier como 103/105
- adicionada leitura do XML oficial de retorno
- adicionada geração de QR Code por URL base do CE

## O que você ainda precisa conferir antes do teste

1. Empresa credenciada para NFC-e CE em homologação
2. CSC e CSC ID válidos de homologação
3. Código do município IBGE correto de Juazeiro do Norte: 2307304
4. Produtos com:
   - NCM com 8 dígitos
   - CFOP com 4 dígitos
   - CSOSN coerente com o CRT
   - unidade preenchida
5. Certificado A1 válido e com senha certa

## Passo prático para testar

1. Abra a configuração fiscal
2. Deixe ambiente = homologação
3. Salve:
   - UF = CE
   - código_municipio = 2307304
   - série = 1
   - próximo número = 1 ou próximo livre
   - CSC / CSC_ID de homologação
4. Cadastre um produto de teste simples
5. Faça uma venda simples de 1 item
6. Emita a NFC-e
7. Veja o retorno:
   - 100 = autorizado
   - 103/105 = lote recebido / em processamento
   - qualquer outro = rejeição

## Rejeições esperadas nas primeiras tentativas
- CSC inválido
- município IBGE incorreto
- XML fora do schema
- CSOSN incompatível
- certificado/cadeia inválidos
- contribuinte não credenciado

## Importante
Este ajuste deixa o projeto bem mais próximo da homologação real, mas a primeira transmissão real ainda precisa de teste no seu ambiente com:
- credenciamento ativo
- CSC real de homologação
- certificado correto
- venda e produto válidos

Sem isso, o código até envia, mas a SEFAZ vai rejeitar.
