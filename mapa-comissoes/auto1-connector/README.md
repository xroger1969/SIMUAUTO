# Ligação AUTO1 para Chrome

1. Descarrega o ZIP no Comparador e extrai a pasta.
2. Abre chrome://extensions e ativa **Modo de programador**.
3. Carrega em **Carregar sem compactação** e seleciona a pasta que contém manifest.json.
4. Inicia sessão normalmente em www.auto1.com.
5. Recarrega o Comparador no endereço indicado e carrega em **Verificar ligação**.
6. Cola o link AUTO1 e carrega em **Analisar compra**. A extensão abre a ficha na tua sessão e devolve os dados ao Comparador.

A extensão só funciona nos endereços autorizados no manifest. Não funciona em telemóveis. Não lê cookies, palavras-passe, tokens ou valores de formulários. Não licita nem compra viaturas. Lê texto da ficha renderizada e dados JSON-LD publicados nela; estes dados entram na análise de mercado e no histórico do Comparador. Não consulta dados ocultos de aplicações ou chamadas internas. Se a sessão expirar, inicia sessão na AUTO1 e repete a análise. Os campos só podem ser extraídos quando estiverem visíveis na página. Permite até 70 segundos para carregar a ficha.

A ligação tem testes de mensagens e captura com páginas simuladas. A validação com uma sessão real AUTO1 exige instalação no Chrome do comerciante.
