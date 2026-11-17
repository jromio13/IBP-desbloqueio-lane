---
description: Use quando a pessoa pedir para bloquear, desbloquear ou consultar uma rota de transporte.
---

# Solicitação de bloqueio de lane

1. A justificativa é obrigatória. Sem ela, peça antes de continuar.
2. Consulte `consultar-linha` quando a origem e o destino já puderem existir na DRPZTLANEOBP.
3. Chame `preparar-solicitacao` com a ação, a justificativa e as rotas.
4. Mostre a prévia em tabela, a operação criar ou alterar, e os avisos. A justificativa aparece como observação.
5. Se `ready` for false, pergunte o que falta. Não chame `atender-solicitacao`.
6. Com a prévia pronta, peça para clicar em Approve e chame `atender-solicitacao` com os mesmos argumentos.
7. Se a aprovação for recusada, pare. O IBP não muda.
8. Se a gravação concluir, mostre a prévia gravada. Diga que a baseline só muda com o job da Cadeia de Pré-Inicialização Diária.
