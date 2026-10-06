# Auditoria de 6 de outubro de 2026

Origem: xroger1969/SIMUAUTO, main, 8e83f1b82899d2ce8f5842397e7816471dbe8a79.
Vercel: mapa-comercial, prj_MvjOHkr5CmP9pOdYzNDapxENkHca.
HTML de produção e mapa-comissoes/comparador-auto-pro/index.html com SHA-256 idêntico.

## Arquitetura e causas observadas

Frontend HTML/JavaScript sem framework; app-v2.js é a entrada ativa. APIs CommonJS no Vercel. Supabase autovalorpt, tabelas cap_* com políticas por utilizador. OpenAI Responses interpreta imagens/texto e pesquisa web; valuation.js calcula no browser. Leitor público com DNS fixado e proteção SSRF. Cache de matrícula separado dos jobs. AUTO1 dispõe de conector autenticado opcional.

1. Cache de 24 h podia devolver toda a identificação e mercado de outra avaliação. Removidos os caminhos de reutilização entre avaliações; a idempotência do mesmo request_key e a retoma do mesmo job continuam.
2. URL devolvido pela pesquisa era considerado prova de preço, versão, IVA e disponibilidade. Agora exige corroboração independente por dados estruturados da página. Bloqueios, ausência de dados ou divergências mantêm evidência provisória.
3. Preços de base/localização/disponibilidade incerta podiam contaminar uma amostra com anúncios verificados. São excluídos.
4. Ordem dos duplicados alterava a seleção. Ordenação determinística antes da deduplicação; vendedor e especificação detetam réplicas com preços diferentes.
5. Confiança de amostras elegíveis ignorava o limite do tamanho da amostra. Corrigido.
6. Data corrente fazia parte implícita da verificação de antiguidade. Agora a data é explícita, guardada com todos os inputs e ajustes.
7. A IA podia alterar a reserva em euros. Sugestões não confirmadas pelo utilizador deixam de entrar automaticamente no cálculo.
8. Histórico não abria a avaliação completa e fotografias não constavam do snapshot. Adicionados abertura e inputs, incluindo fotografias comprimidas.
9. Campos parciais e discrepâncias não tinham registo uniforme de origem. Adicionada fusão com evidência por campo e conflitos explícitos.
10. UI referia calcBox, mas o elemento não existia no HTML. Criado “Como foi calculado?”, com mediana, percentis, ajustes, fórmula, custos e margem.
11. Number(null) podia interpretar valores históricos indisponíveis como zero. Corrigidas verificações nos resultados e partilha.

## Teste real antes das alterações

Tesla Model 3 Long Range 2021, 82 000 km, nacional, automático, sem danos conhecidos: 23 335 EUR de compra, 28 780 EUR mercado, 83% confiança, 5 comparáveis, 4 ditos verificados. A própria descrição de um comparável indicava contradição na tração e outra disponibilidade a confirmar. Esta observação motivou a verificação independente e o limite de confiança.

## Método

Seleção por marca/modelo, exclusões técnicas, semelhança ponderada, ajustes fixos explícitos de ano/km, deduplicação, exclusão IQR para amostras >=5, mediana ponderada. Revenda desconta negociação, venda rápida aplica desconto adicional. Compra ideal = revenda económica - custos - reserva - margem pretendida, com fator IVA quando aplicável. Teto máximo usa margem mínima. Parâmetros são premissas comerciais, não coeficientes empiricamente calibrados.

## Limitações ainda materiais

- Cálculo e gravação continuam no cliente; snapshots não são certificados pelo servidor. RLS isola utilizadores mas o proprietário pode alterar o seu histórico. Não chamar a isto um livro imutável.
- Extração visual e interpretação de texto continuam probabilísticas. Registo de origem comunicado pela IA não prova por si a exatidão da leitura.
- Sites sem JSON-LD completo ou com bloqueios podem impedir a confirmação dos comparáveis. Não existe API contratada dos portais.
- Não há calibração com preços reais de transação, fiscalidade de margem de bens usados ou custos de garantia por modelo.
- Frases explícitas de margem e cenário de compra são recalculadas na mesma avaliação sem nova pesquisa. Custos e formulações ambíguas ainda exigem premissas/identificação; as preferências permanentes só mudam por ação explícita.
- A deduplicação não utiliza hashes visuais; variações de vendedor e quilometragem podem escapar.
- Testes automáticos usam fixtures; não equivalem a 36 jornadas reais com fotos e todos os serviços externos.
- Proveniência por campo dos snapshots antigos não pode ser reconstruída retroativamente.
- Falhas durante market_pending podem exigir recuperação operacional; não foi implementada fila externa.

Não classificar a versão como pronta para decisões comerciais sem a validação completa descrita no pedido.
