# ComissãoPro

Simulador profissional de comissões, financiamento e rentabilidade para stands de automóveis usados.

## Objetivo

Criar um modelo de remuneração variável transparente e progressivo que:
- premie volume de vendas;
- atribua maior comissão às operações com maior percentagem de capital financiado;
- mantenha uma comissão mínima nas vendas sem financiamento;
- permita controlar a rentabilidade do stand em cada operação e no mês;
- seja totalmente editável pelo gestor.

## Modelo inicial

| Vendas no mês | 0% financiado | 100% financiado |
|---|---:|---:|
| 2–3 | 120 € | 180 € |
| 4–5 | 160 € | 240 € |
| 6–7 | 220 € | 330 € |
| 8–9 | 300 € | 450 € |
| 10–11 | 400 € | 600 € |
| 12+ | 500 € | 750 € |

Entre 0% e 100% de financiamento, a comissão é calculada por interpolação linear.

## Funcionalidades

- Venda individual com cálculo instantâneo.
- Percentagem do PVP financiada.
- Receita gerada pela financeira.
- Resultado antes e depois da comissão.
- Indicador de peso da comissão na rentabilidade.
- Simulação mensal com múltiplas vendas.
- Escalões e valores totalmente editáveis.
- Persistência local no navegador.
- Exportação CSV.
- Interface responsiva para computador, tablet e telemóvel.

## Tecnologia

Aplicação estática em HTML, CSS e JavaScript, sem dependências de backend. Pode ser publicada diretamente em GitHub Pages, Vercel ou qualquer alojamento estático.

## Branch

Desenvolvimento inicial: `feature/simulador-comissoes`.
