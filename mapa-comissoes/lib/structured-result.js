// Only completed structured responses may enter calculations or commercial memory.
function structuredResult(data) {
  if (data.status === "incomplete") throw new Error("A resposta da IA ficou incompleta. Tenta novamente.");
  if (data.status && data.status !== "completed") throw new Error("A IA não concluiu a resposta. Tenta novamente.");
  const parts = (data.output || []).filter(x => x.type === "message").flatMap(x => x.content || []);
  if (parts.some(x => x.type === "refusal")) throw new Error("A IA não conseguiu analisar este pedido.");
  const text = data.output_text || parts.filter(x => x.type === "output_text").map(x => x.text).join("");
  try { return JSON.parse(text); }
  catch { throw new Error("A IA devolveu uma resposta inválida. Tenta novamente; nenhum valor foi calculado."); }
}
module.exports = { structuredResult };
