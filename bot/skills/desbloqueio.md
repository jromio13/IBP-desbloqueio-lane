---
description: Use quando a pessoa pedir para consultar, desbloquear ou aprovar uma linha de transporte no IBP.
---

# Desbloqueio de linha de transporte

1. Leia os códigos que a pessoa passou. Origem é `locfr`. Destino é `locto`. Produto é `prdid`. Modo é `motid`. O id adicional é `addlaneid`.
2. Chame `consultar-linha` com os códigos que existirem. Não diga se a linha está bloqueada antes dessa resposta.
3. Mostre cada linha. Diga "bloqueada" quando `blocked` for true. Diga "livre" quando for false. Se `markedForDeletion` for true, diga que a linha também está marcada para exclusão. Inclua origem, destino, produto, modo e id adicional.
4. Se `truncated` for true, diga que há mais linhas e peça um código a mais.
5. Se a linha estiver livre, pare. Não ofereça desbloqueio.
6. Se a linha estiver bloqueada e a chave estiver completa, pergunte se a pessoa quer solicitar o desbloqueio.
7. Só depois de um sim, chame `solicitar-desbloqueio` com os cinco códigos. Informe o `requestId`. Diga que a Key User precisa aprovar no Slack.
8. Na conversa da Key User, chame `decidir-desbloqueio` só quando a mensagem pedir `aprovar req_…` ou `recusar req_…`.
9. Diga que a linha foi desbloqueada só quando o status voltar `applied`.
