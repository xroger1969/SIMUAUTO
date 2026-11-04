const {appError}=require("./access");

// Billing failures need account action, not a network retry. Keep provider codes
// when available; the message fallback also handles jobs saved by older builds.
function providerError(error={},fallback="openai_market_error"){
  const code=String(error.code||error.type||"");
  const message=String(error.message||"Falha no serviço de IA.");
  if(["credit_balance_exhausted","ai_credits_exhausted"].includes(code)||/no credits remaining|credit balance.*exhaust|sem créditos na API/i.test(message)){
    return appError("A conta de IA está sem créditos na API OpenAI. Adiciona saldo na faturação da API e depois volta a avaliar.",402,"ai_credits_exhausted");
  }
  if(["insufficient_quota","organization_spend_limit_exceeded","project_spend_limit_exceeded","organization_usage_limit_exceeded","usage_limit_exceeded","ai_billing_limit"].includes(code)||/exceeded your current quota|spend limit.*exceeded|limite de utilização da API/i.test(message)){
    return appError("A conta de IA atingiu um limite de utilização da API. Verifica o saldo e os limites da conta OpenAI antes de voltar a avaliar.",402,"ai_billing_limit");
  }
  return appError(message,502,fallback);
}

module.exports={providerError};
