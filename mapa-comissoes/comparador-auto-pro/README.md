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
- **Nível 1:** anúncios independentes suficientemente semelhantes (referência mais exigente).
- **Nível 2:** anúncios da mesma marca, modelo e combustível, com ano até ±3 e semelhança reduzida (confiança máxima 35%).
- **Nível 3:** anúncios reais do mesmo modelo e combustível, com ano até ±5, dentro dos limites de compatibilidade técnica, e semelhança a partir de 20% (confiança máxima 25%).
- **Nível 4:** sem anúncios independentes, mas com preço conhecido: dois cenários **estritamente financeiros** (compra sem/com reparações), sem revenda verificada e sem recomendação de compra. O preço pedido ou licitação nunca é considerado anúncio comparável nem preço de mercado.
- Sem anúncios nem preço conhecido, é impossível calcular um montante sério em euros; a aplicação pede que seja indicado um preço ou uma referência real, em vez de inventar valores.
- Se o país de uma viatura de leilão não estiver confirmado, os cenários incluem provisoriamente a reserva conservadora de 1 200 € até confirmar a localização. Nunca é emitida recomendação firme nesta condição.

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

## Correções da auditoria de 22/10/2026

- `commercial-identity.js` conserva a identidade bruta e normaliza a identidade comercial usada pelo servidor e pelo cálculo. Modelo e versão Tesla são separados; códigos técnicos numéricos não substituem versões comerciais. Combustível, tração, geração e bateria incompatíveis continuam excluídos.
- Uma única seleção determina a amostra de preço e a referência de quilometragem. Quilómetros inferidos não alteram a seleção ou os pesos da própria amostra. O valor central usa sempre mediana ponderada, com ajustamentos limitados para não ultrapassarem 25% do preço anunciado.
- Vendidos, referências estrangeiras e preços condicionados sem preço a pronto são excluídos. A deduplicação usa URL, matrícula/VIN ou identidade do vendedor e dados exatos, sem colapsar carros de vendedores diferentes apenas por semelhança.
- Divergências de potência em Tesla da mesma variante AWD são assinaladas e mantêm a avaliação provisória; não constituem confirmação da especificação técnica.
- A cache exige uma amostra utilizável, tem versão própria e inclui a identidade técnica. Zero anúncios aceites permite renovar a pesquisa. A recuperação procura a família normalizada por etapas limitadas e guarda tentativas e exclusões.
- Pesquisas interrompidas podem ser retomadas, incluindo a partir do histórico. O arranque da etapa seguinte tem posse temporária para evitar duplicação concorrente. Fotografias não são guardadas no contexto de recuperação e têm de ser reenviadas se o arranque inicial for interrompido.
- Alertas e ausência de evidência aparecem no ecrã. Uma falha ao guardar o histórico mantém o resultado calculado e disponibiliza nova tentativa de gravação. A migração `20261022_comparador_idempotent_save.sql` faz uma repetição do mesmo snapshot devolver a revisão já guardada, sem duplicar anúncios nem repor uma revisão antiga sobre uma mais recente.
- A importação explícita para o simulador fiscal usa preços estruturados, o teto quando falta preço atual, custos e reserva uma única vez. Uma nova avaliação não altera os campos fiscais antes dessa importação. O simulador de IVA da margem recusa importar uma avaliação configurada para IVA dedutível.

O snapshot anonimizado `tests/fixtures/al47ic-market.json` reproduz os oito anúncios da auditoria e permite verificar a correção sem nova consulta paga ou afirmar que os anúncios continuam ativos. As regressões cobrem a coerência entre API, seleção e motor, incluindo exclusão de anúncios incompatíveis.

Esta correção não mede precisão comercial. Continua pendente uma validação independente de 30–50 viaturas reais, com referências manuais e negócios documentados, antes de publicar uma margem de erro. A confiança apresentada continua a ser um índice de evidência e não uma probabilidade calibrada.

## Estado da viatura e custos de preparação (17/10/2026)

A primeira fase lê as fotografias/relatórios e conserva `condition_report` com
observações por componente, evidência, índice da imagem, inspeção, manutenção,
testes e SOH documentado. A segunda fase pesquisa preços de peças e serviços
em fontes portuguesas. Preserva os danos observados e acrescenta os preços;
não utiliza o estado dos comparáveis como se fosse o da viatura analisada.

- Pintura simples: preços publicados de oficinas pesquisados por defeito. A
  referência de **80–100 €/painel com IVA** é apenas uma hipótese provisória
  quando falta preço aplicável; pode ser substituída por orçamento do utilizador.
  Promoções e preços «desde» não são tratados como tabela normal nem teto garantido.
  Chapa, substituição e polimento requerem orçamento próprio.
- Peças e mão de obra são discriminadas; um preço sem mão de obra continua
  parcial. Só são utilizados preços pesquisados com URL presente nas fontes da
  ferramenta web e base de IVA conhecida. Uma referência não é uma média nacional
  nem garante compatibilidade; a nota de aplicação e a fonte ficam visíveis.
- O limite de compra usa o extremo superior da estimativa e o **maior** entre
  esse orçamento e a reserva mínima de preparação. Não soma a preparação duas
  vezes. No modo com IVA dedutível, os custos com IVA são convertidos uma vez
  para a base económica já utilizada pelo motor.
- Os custos totais por componente podem ser corrigidos no ecrã. Estes valores
  pertencem à avaliação, não se tornam preços globais de outras viaturas. Cada
  recálculo guarda relatório, fontes, alterações e resultado no histórico.
- Nos relatórios AUTO1, triângulos amarelos assinalam danos identificados pelo
  técnico (`technician_marked=true`). Nas zonas exteriores é considerado pelo
  menos um trabalho de reparação/pintura por zona, com custo pesquisado, mantendo
  os painéis exatos por confirmar. O detalhe por painel substitui a zona para
  evitar duplicação. Danos de interior usam serviço próprio, nunca pintura de chapa.
  N/A e espessuras isoladas não são danos; um teste sem anomalias não comprova
  ausência de avarias nem SOH. Custos pendentes mantêm a avaliação provisória.
- A cache de comparáveis não transporta danos/localização de fotografias
  anteriores. Quando existem novos danos, os comparáveis fixados podem ser
  conservados enquanto os novos custos são pesquisados. A cache exata das mesmas
  entradas foi versionada para não reutilizar resultados anteriores sem relatório.

Não é necessária alteração do esquema Supabase: os detalhes são guardados nos
campos JSON de definições, resultados e revisões existentes. O tipo de revisão
`condition_costs` identifica uma correção manual de custos.

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


## Parecer comercial de compra profissional (21/10/2026)

A análise mostra primeiro a **revenda realista** suportada pelos anúncios profissionais,
não confunde preços anunciados com vendas concluídas, e calcula o **teto de
compra de trás para a frente**: revenda económica - margem objetivo (3 500 €
por defeito) - custos - reserva de risco. Mantém a separação entre compra
**sem reparações** e **com reparações**.

O novo cartão de parecer mostra revenda, compra máxima, custos totais
(incluindo preparação), margem no preço/licitação atual, margem objetivo e
diferença a negociar. O intervalo de revenda ajustado só existe com pelo
menos dois comparáveis independentes. A compra é marcada como provisória
quando os anúncios ou o estado não permitem segurança comercial.

A conclusão tem prioridade para falta de mercado, localização/custos de
importação não confirmados, excesso face à margem mínima, excesso face à
margem-alvo e riscos por confirmar. Em elétricos, **SOH não documentado**
é mostrado como alerta de decisão: nunca é inferido a partir de autonomia
apresentada ou de um teste dinâmico sem anomalias; a interface não mostra
sinal verde enquanto faltar esse dado.

Em leilões é obrigatória a verificação do preço total, comissão, IVA que
for efetivamente aplicável, transporte, preparação e garantia. A comissão
não é somada em duplicado quando estiver incorporada na licitação.
O programa não inventa a taxa de leilão nem IVA adicionais se o relatório
não fornecer essa informação. O módulo é determinístico, auditável e
recalculado quando o comerciante muda as premissas.

## Nova avaliação e quilometragem opcional (22/10/2026)

O formulário inclui quilómetros opcionais e um botão «Nova avaliação»,
disponível após resultados e erros. O reinício limpa fotografias, quilómetros,
resultado e contexto da viatura sem terminar a sessão nem apagar o histórico.
Os cartões e campos usam superfícies claras com texto escuro; a fotografia
de fundo e a sua camada de apresentação permanecem inalteradas.

Os quilómetros introduzidos seguem num campo estruturado, prevalecem sobre
a leitura automática e não são apagados pela consulta da matrícula/Spottd.
O valor faz parte da assinatura da pesquisa: fotografias iguais com
quilometragens diferentes não reutilizam o mesmo resultado integral.

Sem quilómetros conhecidos, a pesquisa continua. O servidor calcula média,
mínimo, máximo, tamanho da amostra e URLs dos anúncios portugueses compatíveis,
com preferência por profissionais e sem duplicar a mesma referência.
Não se limita ao Standvirtual. A referência fica explicitamente identificada
como quilometragem média dos anúncios, nunca como quilometragem real da viatura.
Uma cache de mercado reutiliza anúncios, sem copiar os quilómetros reais de
uma avaliação anterior para uma nova consulta com quilometragem desconhecida.

Neste cenário, o preço de referência é a média dos preços ajustados dos
comparáveis aceites pelo motor; a revenda continua sujeita ao desconto de
negociação, e a compra subtrai custos, reservas e margem objetivo. A cotação
é provisória e a confiança fica limitada a 45%. Sem anúncios, não são
inventadas médias nem exigidos quilómetros para prosseguir.

Validação: regressões do motor/API e quatro fluxos de integração DOM com
serviços simulados (foto + km, reinício após sucesso/erro, média e intervalo,
sem comparáveis). Não foram feitas consultas reais à Spottd nesta alteração.

## Simulador de lucro fiscal ENI — Portugal, 2026

Módulo autenticado no mesmo Avaliador Auto Pro, aberto no botão **Lucro ENI**. Não muda o motor de avaliação ou os custos do parecer comercial. Quatro campos principais: preço de compra, venda, despesas finais e número de viaturas vendidas no trimestre. A partir de uma avaliação concluída, **Usar preços desta avaliação** copia preço de compra atual e revenda realista se ambos existirem; nunca fabrica referências. Despesas ficam editáveis, para evitar importar uma estimativa de mercado como uma despesa comprovada.

Cálculos são isolados e determinísticos em `tax-simulator-calc.mjs`, com testes em `tax-simulator-calc.test.mjs`:

- IVA margem (Portugal continental): `max(0,venda-compra) × 23/123`, aplicado por viatura. Despesas não reduzem a base do IVA da margem; IVA das despesas dedutível exige apuramento separado.
- Receita sem IVA: `venda - IVA da margem`. ENI/IRS simplificado: rendimento coletável da categoria B em venda de mercadorias = `0,15 × receita sem IVA`, não 15% do lucro.
- SS para ENI que acumula emprego e satisfaz os requisitos de isenção: pressupõe que as `n` viaturas vendidas no trimestre têm o mesmo preço; rendimento relevante mensal `= 0,20 × receita sem IVA × n / 3`. Até 4 IAS de 2026 (`2 148,52 €`), isenção; acima, 25,2% sobre o excesso mensal, atribuído proporcionalmente aos automóveis. Estimativa e não liquidação; base contributiva efetiva e demais requisitos dependem da Segurança Social. Aplicam-se as regras de limiar de 5 € e contribuição mínima de 20 € quando o excesso gera pagamento.
- IRS anual do agregado e do salário **não é inferível** de um salário *líquido* de 650 €; sem taxa marginal indicada a aplicação mostra saldo antes do IRS e não cria um lucro líquido fictício. Taxa marginal ilustrativa opcional, configurável e explicitamente não definitiva.
- Aviso projetivo se vender volume anual semelhante acima de 200.000 €/250.000 €, com recomendação de revisão do regime de contabilidade.

O módulo não recolhe dados fiscais sensíveis, não grava uma declaração e não altera o histórico de avaliações. Taxas/regras de 2026 precisam de revisão anual. Os valores com IVA são finais para efeitos do campo de despesas; deduções de IVA das despesas e fiscalidade de vendas fora do RETBSM não estão incluídos.

Fontes: DL n.º 199/96 (regime da margem), artigo 31.º CIRS, artigo 157.º do código contributivo, IAS 2026 e documentação oficial da Segurança Social.
