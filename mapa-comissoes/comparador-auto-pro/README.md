# Comparador Auto Pro

Esta é a implementação canónica do Comparador Auto Pro. O código antigo da raiz e o antigo `app.js` foram removidos para impedir testes ou publicações sobre versões erradas.

## Fluxo ativo

1. O utilizador cola um link, indica uma matrícula, descreve a viatura ou anexa até 6 fotografias.
2. `/api/comparador-analyze` lê páginas públicas com autenticação, quota, validação de destino e proteção SSRF.
3. `/api/comparador-market` cria um job persistente associado ao utilizador e à análise.
4. As orientações relevantes do comerciante são enviadas para a pesquisa como hipóteses a testar, nunca como factos.
5. A pesquisa web devolve comparáveis e respetiva proveniência.
6. `valuation.js` decide deterministicamente se existe evidência suficiente para emitir um teto de compra.
7. Cada conclusão é guardada com snapshot, revisão, comparáveis usados/excluídos, fontes, modelo, parâmetros e versão do motor.

## Regra de confiança

A avaliação é feita por **comparação ponderada** e não exige três carros iguais.

- **1 anúncio compatível:** calcula valor de mercado, revenda e teto **provisório**, com confiança limitada.
- **2 anúncios profissionais verificados:** podem fundamentar um teto recomendado se os dados da viatura estiverem completos e os preços forem consistentes.
- **3 ou mais:** reforçam a robustez, mas não são necessários para obter uma cotação.
- Anos, quilómetros, versões e equipamento próximos são ponderados com ajustamentos explícitos; combustível incompatível, duplicados e preços inválidos são excluídos.
- A pesquisa abre gradualmente do mesmo acabamento para a mesma família de modelo/combustível, podendo incluir particulares identificados como tal.
- Sem qualquer preço real comparável, a aplicação explica a falta de dados em vez de inventar uma cotação.

A percentagem é um **índice heurístico de confiança da evidência**, não uma probabilidade estatística comprovada de acertar no preço. O cálculo e os custos continuam determinísticos e cada revisão guarda a versão do motor.

## Regra de custos de importação

- Viatura de leilão localizada fora de Portugal/importada: acrescenta 1 200 € aos custos da compra.
- Viatura de leilão já localizada em Portugal: não acrescenta os 1 200 €.
- Standvirtual: nunca acrescenta os 1 200 €, porque é tratado como retalho em Portugal e não como leilão.
- Se a oportunidade for de leilão mas a localização física da viatura não estiver confirmada, o cálculo pede confirmação ao utilizador antes de aplicar ou excluir os 1 200 €.

## Dados e histórico

As tabelas `cap_*` usam RLS por utilizador. As pesquisas usam `cap_jobs` com chave idempotente e podem ser retomadas. As revisões são guardadas em `cap_revisions` e os anúncios que sustentam cada cálculo em `cap_comparables`.

As premissas de margem e custos são editáveis em `cap_preferences` e podem recalcular a análise sem confundir preço de venda com margem económica.

## Segurança

- Segredos permanecem no servidor.
- APIs do Comparador exigem sessão administrativa válida.
- Existem quotas para pesquisa de mercado, leitura pública, chat e voz.
- O leitor público fixa a ligação ao IP já validado e volta a validar cada redirecionamento.
- O `response_id` da pesquisa nunca é consultado diretamente pelo browser; o browser usa um `job_id` protegido por RLS.
- O cliente Supabase está fixado numa versão exata.
- O áudio de `MediaRecorder` aceita parâmetros de codec sem alargar os tipos permitidos.

## Interface

A entrada principal continua simples. No resultado existem secções discretas para:

- qualidade da evidência;
- todos os comparáveis usados;
- anúncios excluídos e motivo;
- premissas editáveis da compra;
- refinamento com IA.

O diálogo aceita Escape e devolve o foco ao controlo anterior. Durante uma análise, ações incompatíveis ficam bloqueadas.

## Integrações

Supabase, GitHub e Vercel fazem parte do fluxo técnico ativo. Resend e OneSignal permanecem deliberadamente fora do caminho crítico do Comparador: não são necessários para calcular uma compra e só deverão ser ligados quando existir um caso concreto de notificação.

## Verificação

O workflow `.github/workflows/comparador-auto-pro-check.yml` testa exclusivamente esta árvore ativa, incluindo sintaxe, motor de valorização, memória, inputs, segurança, voz e hooks críticos da interface.

## Spottd — integração preparada (aguarda credenciais)

A consulta Spottd é prioritária em **novas consultas sem cache** apenas quando as duas
variáveis de ambiente privadas estiverem configuradas na Vercel:

- `SPOTTD_API_BASE_URL`: **origem HTTPS** do fornecedor (ex.: `https://servidor.fornecedor.pt`), sem caminho; aguardar hostname real na documentação oficial.
- `SPOTTD_API_KEY`: chave gerada no dashboard Spottd.

O servidor chama uma única vez `GET /api/v1/registrations/{plate}` com cabeçalho
`X-API-Key`. Nunca colocar a chave no código, nas páginas, nos pedidos do browser ou
no repositório. A resposta converte potência de kW para CV, preservando kW, e
identifica `provider: spottd`. Campos em falta continuam desconhecidos.

Se não houver chave/URL, a Spottd devolver erro ou a ficha estiver incorreta,
a consulta usa as fontes já existentes (MyCarPlate/RegCheck), sem bloquear a
análise de mercado. A cache Supabase por utilizador impede consultas repetidas
para a mesma matrícula durante a sua validade; cache antiga continua válida.
A identificação por matrícula nunca substitui quilómetros, preço ou versão
já confirmados pelo anúncio/cliente.

Para ativar: validar URL e cabeçalhos reais com a documentação da Spottd, guardar
as duas variáveis **apenas nos segredos de servidor**, publicar e testar com
créditos gratuitos; confirmar no dashboard o consumo de 1 crédito por pedido
com resultado. Não se fizeram chamadas reais à Spottd nesta implementação.
