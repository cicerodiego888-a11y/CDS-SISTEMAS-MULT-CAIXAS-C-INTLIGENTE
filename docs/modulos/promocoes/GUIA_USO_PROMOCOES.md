# 📖 Guia de Uso - Módulo Promoções Inteligentes

## 🎯 O que é o Módulo de Promoções Inteligentes?

Um sistema automático que analisa seus produtos e sugere promoções inteligentes, especialmente para produtos próximos do vencimento. É como ter um assistente analisando seus estoques 24/7!

---

## 🚀 Onde Fico o Módulo?

Na página de **Produtos**, você verá 3 cards no topo:

```
┌─────────────────┬─────────────┬─────────────────┐
│ Alertas de      │ Vencimentos │ Promoções       │
│ Estoque         │             │ Inteligentes 🎯 │
└─────────────────┴─────────────┴─────────────────┘
                        ↑
                  Clique aqui!
```

---

## 📚 Passo a Passo: Criar sua Primeira Promoção

### Passo 1️⃣: Abrir o Modal

1. Acesse **Produtos** no menu lateral
2. Localize o card **"Promoções Inteligentes"** (com emoji 🎯)
3. Clique no botão **"Ver Sugestões"**

**Resultado**: Uma modal com 3 abas abrirá

---

### Passo 2️⃣: Gerar Sugestões Automáticas

1. Na modal, você verá a aba **"Sugestões"** aberta (primeira aba)
2. Clique no botão **"Gerar Sugestões"** (botão azul na base da modal)
3. Aguarde alguns segundos enquanto o sistema analisa seus produtos

**Resultado**: Uma mensagem de sucesso aparecerá com o número de sugestões geradas

---

### Passo 3️⃣: Revisar Sugestões

Após gerar, você verá uma tabela com as sugestões:

| Produto | Motivo | P. Atual | P. Sugerido | Desconto | Ações |
|---------|--------|----------|-------------|----------|-------|
| Leite   | Vence em 5 dias | R$ 3,50 | R$ 2,97 | 15% | ✓ Rejeitar |
| Pão     | Vence em 3 dias | R$ 2,50 | R$ 2,12 | 15% | ✓ Rejeitar |

**Informações exibidas:**
- **Produto**: Nome do item
- **Motivo**: Por que foi sugerido (ex: vencimento próximo)
- **P. Atual**: Preço atual do produto
- **P. Sugerido**: Preço com desconto
- **Desconto**: Percentual de redução

---

### Passo 4️⃣: Aceitar ou Rejeitar

#### ✅ Se aprova a promoção:
1. Clique em **"Aceitar"** (botão verde)
2. Mensagem de sucesso aparecerá
3. A promoção será criada automaticamente
4. A sugestão desaparecerá da lista

#### ❌ Se não aprova:
1. Clique em **"Rejeitar"** (botão vermelho)
2. Mensagem de confirmação aparecerá
3. A sugestão será descartada
4. O sistema aprenderá suas preferências

---

### Passo 5️⃣: Ver Promoções Ativas

1. Clique na aba **"Ativas"** (segunda aba)
2. Você verá todas as promoções em vigor

| Produto | P. Original | P. Promo | Desconto | Válida até | Status |
|---------|------------|----------|----------|------------|--------|
| Leite | R$ 3,50 | R$ 2,97 | 15% | 30/06/2026 | ✓ Ativa |

**O que você pode fazer:**
- **Visualizar**: Todas as promoções ativas
- **Encerrar**: Clique em "Encerrar" para parar uma promoção

---

### Passo 6️⃣: Consultar Histórico

1. Clique na aba **"Encerradas"** (terceira aba)
2. Você verá o histórico de todas as promoções finalizadas

**Útil para:**
- Analisar promoções passadas
- Verificar impacto das promoções
- Tomar decisões futuras baseado em histórico

---

## 💡 Dicas Práticas

### ✨ Dica 1: Use a Geração Automática Regularmente
```
Recomendação:
├── Segunda-feira: Gerar sugestões
├── Quinta-feira: Revisar resultados
└── A cada 2 semanas: Análise completa
```

### ✨ Dica 2: Personalize seus Descontos
O sistema usa desconto padrão de 15%, mas você pode:
- Aceitar algumas sugestões e rejeitar outras
- Sistema vai aprender suas preferências

### ✨ Dica 3: Combine com Alertas de Estoque
```
Situações:
├── Produto com estoque baixo + vence → Promoção urgente
├── Produto novo → Não gere sugestão
└── Produto popular → Cuidado com grandes descontos
```

### ✨ Dica 4: Monitore Regularmente
- Verifique diariamente a aba "Ativas"
- Encerre promoções que não estão gerando vendas
- Mantenha histórico atualizado

---

## 🎯 Cenários de Uso

### Cenário 1: Produto Próximo do Vencimento
```
Situação:
├── Leite vence em 3 dias
├── Estoque: 45 unidades
└── Preço: R$ 3,50

Ação:
├── Sistema sugere: 15% de desconto → R$ 2,97
├── Você aceita
└── Resultado: Venda rápida antes do vencimento ✓

Benefício:
└── Evita perda de estoque + aumenta caixa
```

### Cenário 2: Rejeitar Sugestão
```
Situação:
├── Pão vence em 25 dias
├── Estoque: 10 unidades
└── Demanda: Alta

Ação:
├── Sistema sugere promoção
├── Você rejeita (demanda alta)
└── Sistema aprende

Benefício:
└── Mantém preço normal + vende normalmente
```

### Cenário 3: Encerrar Promoção Cedo
```
Situação:
├── Promoção de queijo em vigência
├── Vencimento: 15/06/2026
└── Estoque: Zerou (vendeu tudo!)

Ação:
├── Você clica "Encerrar" na aba "Ativas"
└── Promoção é finalizada

Benefício:
└── Registra sucesso + libera espaço em estoque
```

---

## 🔧 Personalizações Possíveis

### Para seu Gerente/Administrador:

#### 🎛️ Alterar Desconto Padrão
**Localização**: Configurações avançadas (entre em contato com suporte)
```
Atual: 15%
Pode ser alterado para: 10%, 20%, 25%, etc.
```

#### 📅 Alterar Período de Alerta
**Por Produto**: Ao editar um produto
```
Campo: "Alertar com quantos dias?"
Padrão: 30 dias
Personalizável: Sim (por produto)
```

---

## ❓ Perguntas Frequentes

### P: Onde vejo quantas sugestões tenho?
**R**: No card de "Promoções Inteligentes" no topo da página.
Exemplo: "5 sugestões | 3 ativas"

### P: As sugestões são criadas automaticamente?
**R**: Não. O sistema **sugere**, mas você **aprova**. Você tem total controle!

### P: Posso rejeitar todas as sugestões?
**R**: Sim! Você pode aceitar algumas e rejeitar outras. O sistema se adapta.

### P: Quanto tempo leva para gerar sugestões?
**R**: Menos de 1 segundo. Se demorar, verifique sua conexão.

### P: As promoções são criadas com a data de hoje?
**R**: Sim. Data de início = hoje. Você pode especificar a data de fim.

### P: Posso encerrar uma promoção antes da data fim?
**R**: Sim! Clique em "Encerrar" na aba "Ativas".

### P: Aonde vejo promoções antigas?
**R**: Na aba "Encerradas" do modal de promoções.

### P: Sistema gera sugestões automaticamente à noite?
**R**: Não (v1.0). Você deve clicar em "Gerar Sugestões" manualmente.
(Futuro: agendamento automático)

---

## 🛟 Resolução de Problemas

### Problema: Card não aparece na página de Produtos
**Solução:**
1. Recarregue a página (F5)
2. Limpe cache (Ctrl+Shift+Delete)
3. Entre em contato com suporte

### Problema: Botão "Gerar Sugestões" não funciona
**Solução:**
1. Verifique sua conexão com internet
2. Recarregue a página
3. Verifique console do navegador (F12)

### Problema: Sugestões não aparecem
**Solução:**
1. Verifique se há produtos com validade próxima
2. Ative "Controlar validade" no produto
3. Gere sugestões novamente

### Problema: Modal não abre
**Solução:**
1. Recarregue a página
2. Tente novamente após 5 segundos
3. Verifique se JavaScript está ativado

---

## 📊 Dicas de Análise

### Como Acompanhar Resultado das Promoções?

1. **Semanalmente**: Abra "Ativas" e note quantidades
2. **Mensalmente**: Verifique "Encerradas" para padrões
3. **Trimestralmente**: Analise impacto nas vendas

### Métricas para Observar:
- Quantidade de sugestões aceitas vs rejeitadas
- Tempo médio de promoção até venda
- Desconto médio aplicado
- Impacto nas vendas totais

---

## 🎓 Aprenda Mais

Para informações técnicas, consulte:
- `MODULO_PROMOCOES_INTELIGENTES.md` - Documentação completa
- `RESUMO_IMPLEMENTACAO.md` - Resumo técnico

---

## 📞 Precisa de Ajuda?

**Encontrou um bug?** Entre em contato com o suporte técnico  
**Tem uma sugestão?** Envie feedback para melhorias  
**Dúvida de uso?** Consulte este guia novamente

---

## ✅ Checklist para Começar

- [ ] Abri a página de Produtos
- [ ] Localizei o card de Promoções Inteligentes
- [ ] Cliquei em "Ver Sugestões"
- [ ] Cliquei em "Gerar Sugestões"
- [ ] Vi as sugestões na tabela
- [ ] Aceitei uma sugestão
- [ ] Verifiquei na aba "Ativas"
- [ ] Pronto para usar! 🎉

---

**Bem-vindo ao módulo de Promoções Inteligentes!**

Agora você tem um assistente analisando seus produtos 24/7.

**Aproveite! 🚀**
