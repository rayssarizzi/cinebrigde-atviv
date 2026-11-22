# Cinebridge — Atividade IV

A ATV IV usa o recomendador da ATV III e roda quatro microsserviços. Cada um tem seu próprio banco PostgreSQL. O RabbitMQ transporta consultas de profissionais, comandos de projetos e eventos de notificação.

| Serviço | Porta local | Rotas principais |
| --- | --- | --- |
| Recomendação | 3000 | `POST /projetos/recomendacoes`, `GET /recomendacoes/:id`, `POST /convites/:id/resposta` |
| Profissionais | 3001 | `GET /profissionais`, `POST /profissionais`, `GET /profissionais/:id`, `PUT /profissionais/:id` |
| Projetos | 3002 | `POST /projetos`, `GET /projetos/:id`, `PUT /projetos/:id`, `POST /projetos/:id/finalizar` |
| Notificações | 3003 | `GET /notificacoes` |

## Executar

Com Docker Desktop em modo Linux no Windows, ou Docker Engine com Compose no Ubuntu, rode estes comandos na raiz do repositório.

```sh
docker compose -f atv4/docker-compose.yml up -d --build --wait
docker compose -f atv4/docker-compose.yml ps
docker compose -f atv4/docker-compose.yml logs --tail 50
```

Cada microsserviço responde em `/health`. O painel do RabbitMQ fica em [localhost:15672](http://localhost:15672), com usuário `cinebridge` e senha local `cinebridge_local`. As consultas passam pela fila `consulta-profissionais`, os eventos de projeto por `eventos-projetos` e as recomendações e respostas de convite por `eventos-recomendacao`.

O serviço de notificações grava os alertas no feed interno. Para também enviar ao destino de demonstração por SMTP, forneça `SMTP_URL`, `EMAIL_REMETENTE` e `EMAIL_DESTINO` no ambiente do Compose. O mesmo ambiente aceita `DB_PASSWORD`, `MQ_USER` e `MQ_PASSWORD` para substituir as credenciais locais. Use valores compatíveis com URL nas credenciais de conexão.

Para parar os containers e preservar os dados, execute `docker compose -f atv4/docker-compose.yml down`.
