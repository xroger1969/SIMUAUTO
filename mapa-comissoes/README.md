# Mapa Comercial — V1

Aplicação open source para gestão de performance comercial de um stand de viaturas usadas.

## Objetivo

Dar à gestão e a cada vendedor uma leitura mensal clara de:

- número de viaturas vendidas;
- PVP total;
- margem real por viatura;
- capital financiado;
- percentagem do PVP financiada;
- receita gerada pelas financeiras;
- comissão do vendedor;
- resultado da operação depois da comissão;
- resultado consolidado do mês.

A aplicação foi desenhada para uma equipa até 5 vendedores, cada um com o seu próprio mapa mensal.

## Lógica inicial de comissão

A V1 parte do modelo discutido:

| Vendas/mês | Sem financiamento | 100% financiado |
| --- | ---: | ---: |
| 2–3 | 120 € | 180 € |
| 4–5 | 160 € | 240 € |
| 6–7 | 220 € | 330 € |
| 8–9 | 300 € | 450 € |
| 10–11 | 400 € | 600 € |
| 12+ | 500 € | 750 € |

Entre 0% e 100% do PVP financiado, a comissão é interpolada.

A comissão é ainda ajustada por um fator de margem da viatura. Todos os valores e fatores são editáveis no Backoffice.

## Proteção do histórico

As regras têm versões.

Quando uma operação passa a **Fechada**, a comissão é congelada num snapshot com:
- valor da comissão;
- versão das regras;
- posição da venda no mês;
- percentagem financiada;
- margem da viatura;
- escalão de volume;
- escalão de margem.

Assim, uma alteração posterior no Backoffice não altera comissões já fechadas.

## Áreas

### Visão geral
Dashboard consolidado da empresa e cartões individuais de vendedor.

### Vendedores
Mapa mensal individual com todas as operações do vendedor.

### Operações
Tabela transversal das operações do mês.

### Simulador
Teste de cenários sem gravar uma venda.

### Backoffice
Edição de:
- nome do projeto/empresa;
- limite máximo de comissão;
- limite de financiamento considerado;
- escalões de volume;
- comissão sem financiamento;
- comissão com 100% financiado;
- fatores de margem;
- equipa comercial.

## Ficha de cada viatura

Cada operação guarda:
- vendedor;
- data;
- estado;
- número de stock;
- matrícula;
- marca/modelo/versão;
- PVP;
- custo de aquisição;
- preparação/recondicionamento;
- garantia;
- outros custos diretos;
- capital financiado;
- financeira;
- remuneração da financeira;
- notas.

A margem é calculada automaticamente:

```
Margem da viatura =
PVP
- custo de aquisição
- preparação
- garantia
- outros custos diretos
```

O resultado da operação é:

```
Resultado =
margem da viatura
+ receita financeira
- comissão do vendedor
```

## Estado desta versão

A V1 funciona sem backend e guarda dados no `localStorage` do navegador. Isto permite validar todo o modelo de negócio e a experiência de utilização antes de introduzir infraestrutura.

## Próxima fase — versão operacional Vercel + Supabase

Para utilização real por várias pessoas/dispositivos:

- Next.js / Vercel;
- Supabase Postgres;
- autenticação;
- perfis Admin e Vendedor;
- Row Level Security;
- dados centralizados;
- histórico e auditoria;
- anexos/fotos em Supabase Storage;
- exportações mensais;
- backup;
- regras de comissão versionadas em base de dados.

A camada de cálculo já está isolada em `engine.js`, para poder ser reutilizada nessa migração.
