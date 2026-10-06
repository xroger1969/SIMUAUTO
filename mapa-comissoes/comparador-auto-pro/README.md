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

Um teto de compra só pode ser emitido quando existem, no mínimo:

- 3 viaturas profissionais distintas e verificadas;
- marca, modelo, versão, ano, quilómetros e combustível confirmados na viatura analisada;
- URLs/evidência de pesquisa válidas;
- preços em Portugal numa base comparável;
- dispersão de mercado dentro do limite de segurança.

Sem estas condições, a aplicação apresenta apenas uma **referência provisória**, limita a confiança e bloqueia o teto recomendado.

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

## Auditoria atual

Consultar `AUDIT.md`. Novas avaliações pesquisam novamente o mercado. Só a retoma do mesmo job é idempotente. A confiança distingue URLs encontrados de campos corroborados no anúncio. Snapshots incluem inputs e data para reprodução; as permissões existentes não tornam o histórico imutável.
