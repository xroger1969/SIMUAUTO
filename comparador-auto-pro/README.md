# Comparador Auto Pro — Preview V1

Protótipo isolado dentro do projeto `SIMUAUTO`, sem alterar o Mapa Comercial atual.

## Fluxo
1. O utilizador cola um URL.
2. O endpoint `/api/comparador-analyze` tenta uma leitura pública direta e segura.
3. A análise fica registada no Supabase em tabelas `cap_*` protegidas por RLS.
4. O caso real AUTO1 `YX06990` serve como primeira calibração end-to-end.
5. O motor de valorização calcula mercado, venda provável, venda rápida, teto recomendado, teto absoluto, margem e confiança.
6. A caixa "Comprador IA" já guarda observações estruturadas como memória comercial. A ligação ao modelo de IA será feita no servidor, nunca expondo a chave no browser.

## Segurança
- Não existem chaves secretas no frontend.
- O leitor bloqueia localhost e redes privadas para reduzir risco de SSRF.
- O acesso à preview exige autenticação Supabase e perfil de administrador do Mapa Comercial.
- As novas tabelas Supabase têm RLS por utilizador.

## Próximas camadas
- normalizador de anúncio por IA;
- radar de comparáveis;
- adaptadores por fonte;
- leitor autenticado de fontes privadas sem navegador pago por análise;
- aprendizagem baseada em compras/vendas reais;
- notificações apenas quando houver uma necessidade clara (OneSignal/Resend ficam fora da V1 para não criar complexidade desnecessária).
