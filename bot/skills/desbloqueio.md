---
description: Use quando a pessoa informar materiais e pedir para ver, bloquear ou desbloquear linhas de transporte.
---

# Simulação de lanes

1. Separe cada material informado. Um código ou uma lista. Não peça origem nem destino.
2. Chame `consultar-linha` com `materiais`. Não descreva o resultado antes dessa resposta.
3. Mostre a tabela com Origem, Destino, Material, Modo, Id, Bloqueio e Exclusão. Sim ou Não.
4. Pergunte se a pessoa quer bloquear ou desbloquear, e quais linhas da tabela.
5. Chame `propor-simulacao` com a ação e as chaves completas dessas linhas.
6. Mostre a mensagem de aprovação. Diga que é simulação e que os dois campos mudam juntos. Espere aprovar ou cancelar.
7. Se a pessoa aprovar, chame `confirmar-simulacao` com o `proposalId`. Mostre a tabela atualizada e diga que o IBP não mudou.
8. Se a pessoa cancelar, pare. Não chame `confirmar-simulacao`.
