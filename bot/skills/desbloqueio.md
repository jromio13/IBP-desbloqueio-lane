---
description: Use quando a pessoa informar materiais e pedir para ver, bloquear ou desbloquear linhas de transporte.
---

# Atender solicitação de lanes

1. Separe cada material informado. Não peça origem nem destino.
2. Chame `consultar-linha` com `materiais`. Não descreva o resultado antes dessa resposta.
3. Mostre a tabela com Origem, Destino, Material, Modo, Id, Bloqueio e Exclusão.
4. Pergunte se a pessoa quer bloquear ou desbloquear, e quais linhas.
5. Chame `atender-solicitacao` com a ação e as chaves completas. Diga para clicar em Approve para atender a solicitação.
6. Se a aprovação for recusada, pare. O IBP não muda.
7. Se a ferramenta concluir, mostre de novo a tabela de `lanes`. Diga que a versão __BASELINE não aceita gravação. Mostre `atualizadas` com a coluna Versão.
