# Modelo de IA do Comparador Auto Pro

Política revista em 2026-11-01: `gpt-6-astra`, conforme a [documentação oficial](https://developers.openai.com/api/docs/models/gpt-6-astra).

Conversa, identificação por fotografias e pesquisa de mercado usam a mesma configuração em `lib/model-config.js`. O valor explícito de `OPENAI_MODEL` prevalece; sem valor, o servidor usa Astra. A API Responses mantém raciocínio `medium`, saídas estruturadas e pesquisa web nas etapas de mercado. Não existe substituição automática por modelos mais baratos. A transcrição mantém o modelo de áudio especializado.

## Diagnóstico

- `GET /api/comparador-ai`: configuração efetiva do servidor, referência aprovada, data de revisão e indicador de divergência.
- `GET /api/comparador-ai?check_model=1`: acrescenta uma consulta de catálogo à OpenAI com a credencial do servidor. A consulta usa `/v1/models/{model}`; não gera texto nem faz uma avaliação. Cache e agregação de pedidos por instância durante 15 minutos limitam consultas repetidas. O HTTP é 503 se a configuração divergir ou a consulta não confirmar disponibilidade.
- `model_check.inference_verified` fica `false`: acesso ao catálogo não confirma saldo, limites ou uma inferência completa. Respostas reais da conversa e avaliações devolvem o `model` informado pelo fornecedor. Quando esse campo falta, fica `null`, sem inventar a confirmação.

O diagnóstico não devolve credenciais, dados de clientes nem mensagens internas do fornecedor. Os endpoints de conversa, avaliações e gravação mantêm a autenticação e as quotas existentes.

## Revisão periódica

A rotina diária deve consultar o diagnóstico em produção, verificar o deployment/commit e comparar a referência com o catálogo e as notas oficiais atuais da OpenAI. Deve alertar para divergência, indisponibilidade, retirada anunciada ou um novo modelo principal relevante; nunca tratar a data de revisão estática como prova de atualidade.

Uma mudança futura exige confirmar suporte a imagens, Responses, pesquisa web, JSON estruturado, raciocínio, custo e latência. Validar testes e acesso da conta antes de publicar; conservar separadamente o modelo realmente devolvido e o modelo configurado. Não alterar automaticamente para um identificador apenas por ser mais recente.
