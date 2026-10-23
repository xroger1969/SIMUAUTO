# Aprendizagem supervisionada e margem — 23/10/2026

O cálculo usa os anúncios independentes como base de revenda. As observações do comerciante ficam em `cap_memory_rules`, com `effect.mode = supervised` e versão 1, isoladas por utilizador pelas políticas já existentes. Não há alteração do modelo de IA nem treino dos seus pesos.

## Registos e aplicação

- Estimativa pessoal de revenda: peso reduzido, separado de uma venda concluída.
- Venda concluída: calibra a relação entre preço efetivo e a estimativa original, antes de qualquer aprendizagem. O ajuste é reduzido quando há poucos exemplos e limitado a ±5%; nunca ultrapassa a mediana ajustada dos anúncios.
- Licitação: fica como observação. As avaliações de leilão capturam automaticamente o valor conhecido com esta classificação.
- Adjudicação/compra concluída: três viaturas distintas com base de preço confirmada podem limitar o teto de compra pelo rácio de aquisição/revenda observado. Nunca aumentam o teto calculado pela margem e pelos custos.
- Margem escolhida: três exemplos semelhantes permitem calibrar a política, entre 80% e 130% da margem automática, com mínimo de 3.500 €. O valor manual por viatura tem precedência.

Marca/modelo/combustível têm de corresponder, assim como versão/geração/tração conhecidas. Limites: um ano, 30.000 km e 5 kWh. Elétricos exigem bateria conhecida. Não se transfere aprendizagem com quilómetros estimados/desconhecidos. As observações expiram para o cálculo ao fim de 120 dias. Uma matrícula só conta uma vez por categoria; sem matrícula usa-se uma impressão conservadora de modelo/ano/quilómetros, mesmo em anúncios diferentes.

O identificador determinístico por utilizador/avaliação/tipo permite repetir ou corrigir uma gravação sem multiplicar exemplos. A interface recupera, substitui e desativa o registo escolhido. A avaliação que originou o registo não se usa como evidência de aprendizagem para si própria. Os identificadores usados e os ajustes ficam no resultado guardado. A percentagem de evidência de mercado não aumenta por haver feedback pessoal.

## Margem automática

Margem comercial antes de impostos pessoais: 3.500 € até 15.000 € de revenda; 4.500 € aos 20.000 €; 5.000 € aos 25.000 €; depois aumenta 10% da diferença de preço. Arredondamento a 50 €. O cálculo parte da revenda e subtrai custos, reserva e margem. A antiga preferência fixa de 3.500 € é migrada para automático; outras preferências explícitas mantêm-se.

## Simulador fiscal

IRS automático individual: coleta progressiva de 2026 sobre salário coletável mais 15% das vendas sem IVA, menos a coleta apenas do salário, dividida pelas vendas anuais previstas. Inclui a taxa adicional de solidariedade. É um cenário antes de deduções do agregado, não uma liquidação fiscal. Defaults editáveis: 730 € brutos/mês × 14 (aproximação aos 650 € líquidos referidos), dez carros/ano. Não se infere um salário bruto exato a partir do líquido. Uma taxa manual substitui o automático. SS mantém a opção persistente anterior, desligada por defeito; o ecrã avisa se o cenário ultrapassa 4 IAS. O trimestre pode diferir da média anual.

Fontes oficiais consultadas em 23/10/2026:

- [CIRS art. 25.º](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs25.aspx): dedução específica de 8,54 IAS.
- [CIRS art. 31.º](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs31.aspx): coeficiente de vendas de 0,15 e englobamento.
- [CIRS art. 68.º](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68.aspx): escalões de 2026.
- [CIRS art. 68.º-A](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68a.aspx): taxa adicional de solidariedade.

O simulador mantém os avisos de faturação anual de 200.000 € e 250.000 €, que podem exigir revisão do regime simplificado. A margem comercial da avaliação não deve ser apresentada como lucro líquido fiscal.

## Validação

Regressões do motor, regras de semelhança/validade/deduplicação, prioridade manual, aprendizagem de preços e margens, limites de leilão, escalões fiscais e substituição manual. Ensaio com DOM real e serviço de persistência simulado: guardar, repetir, recuperar ao recarregar, usar noutra avaliação e desativar. Os testes não provam uma margem de erro comercial nem substituem a validação com compras/vendas reais.
