// Cálculos fiscais indicativos para revendedores de viaturas em Portugal, ano 2026.
// Regime especial da margem (DL 199/96); categoria B simplificada: art. 31.º CIRS;
// Segurança Social: vendas = 20% de rendimento relevante; IAS 2026 = 537,13 EUR;
// isenção por acumulação com trabalho por conta de outrem (art. 157.º CRCSPSS).
// O IRS efetivo não pode ser deduzido do valor de uma venda sem conhecer a situação anual.
// CIRS art. 68.º, Lei 73-A/2025; checked 2026-10-23 at Portal das Finanças.
export function annualProgressiveIRS(taxable){
  if(!Number.isFinite(taxable)||taxable<0)throw Error("Rendimento coletável inválido.");
  const brackets=[[8342,.125],[12587,.157],[17838,.212],[23089,.241],[29397,.311],[43090,.349],[46566,.431],[86634,.446],[Infinity,.48]];
  let total=0,previous=0;
  for(const [limit,rate] of brackets){total+=Math.max(0,Math.min(taxable,limit)-previous)*rate;previous=limit;if(taxable<=limit)break;}
  // CIRS art. 68.º-A: additional solidarity tax.
  total+=Math.max(0,Math.min(taxable,250000)-80000)*.025+Math.max(0,taxable-250000)*.05;
  return total;
}
export function calculateTaxSim({purchase,sale,costs=0,quarterlySales=1,irsRate=null,includeSocialSecurity=true,automaticIRS=false,annualSales=10,monthlyGrossSalary=730,salaryPayments=14}={}){
  const round=n=>Math.round(n*100+1e-7)/100;
  for(const [name,value] of Object.entries({purchase,sale,costs,quarterlySales})){
    if(typeof value!=="number"||!Number.isFinite(value))throw new Error("O campo "+name+" tem de ser numérico.");
  }
  if(purchase<0||sale<=0||costs<0||purchase>10000000||sale>10000000||costs>10000000)throw new Error("Introduz valores positivos válidos.");
  if(!Number.isInteger(quarterlySales)||quarterlySales<1||quarterlySales>30)throw new Error("O número de vendas do trimestre deve ser entre 1 e 30.");
  if(typeof includeSocialSecurity!=="boolean")throw new Error("A opção Segurança Social tem de ser booleana.");
  const validRate=irsRate===null||irsRate===""?null:Number(irsRate);
  if(validRate!==null&&(!Number.isFinite(validRate)||validRate<0||validRate>53))throw new Error("Indica uma taxa de IRS entre 0% e 53%, ou deixa o campo vazio.");
  const grossMargin=round(sale-purchase);
  const marginVat=round(Math.max(0,grossMargin)*23/123);
  const saleWithoutVat=round(sale-marginVat);
  const operatingBeforeContributions=round(grossMargin-marginVat-costs);
  const taxableIncome=round(saleWithoutVat*0.15);
  const IAS2026=537.13;
  const exemptLimit=round(IAS2026*4);
  const relevantMonthly=round((saleWithoutVat*quarterlySales*0.20)/3);
  const socialExcess=Math.max(0,relevantMonthly-exemptLimit);
  let socialMonthly=round(socialExcess*0.252);
  if(socialMonthly<=5)socialMonthly=0;
  else if(socialMonthly<20)socialMonthly=20;
  if(!includeSocialSecurity)socialMonthly=0;
  const socialQuarter=round(socialMonthly*3);
  const socialPerCar=round(socialQuarter/quarterlySales);
  const beforeIRS=round(operatingBeforeContributions-socialPerCar);
  if(automaticIRS&&(!Number.isInteger(annualSales)||annualSales<1||annualSales>120||!Number.isFinite(monthlyGrossSalary)||monthlyGrossSalary<0||monthlyGrossSalary>1000000||![12,14].includes(salaryPayments)))throw Error("Confirma o salário bruto e as vendas anuais.");
  // 8.54 IAS specific employment deduction (art.25); estimate before household deductions.
  const otherTaxable=automaticIRS?Math.max(0,monthlyGrossSalary*salaryPayments-Math.max(8.54*IAS2026,monthlyGrossSalary*salaryPayments*.11)):null;
  const incrementalAnnualIRS=automaticIRS?annualProgressiveIRS(otherTaxable+taxableIncome*annualSales)-annualProgressiveIRS(otherTaxable):null;
  const irsEstimate=validRate!==null?round(taxableIncome*validRate/100):automaticIRS?round(incrementalAnnualIRS/annualSales):null;
  const afterIRS=irsEstimate===null?null:round(beforeIRS-irsEstimate);
  const projectedAnnualVehicles=automaticIRS?annualSales:quarterlySales*4;
  const projectedAnnualRevenue=round(saleWithoutVat*projectedAnnualVehicles);
  const effectiveIRSRate=irsEstimate===null?null:round(irsEstimate/taxableIncome*100);
  return {grossMargin,marginVat,saleWithoutVat,costs,taxableIncome,relevantMonthly,exemptLimit,socialMonthly,socialQuarter,socialPerCar,beforeIRS,irsEstimate,afterIRS,effectiveIRSRate,otherTaxable,incrementalAnnualIRS,irsMethod:validRate!==null?"manual":automaticIRS?"progressive-estimate":"unset",projectedAnnualRevenue,projectedAnnualVehicles,requiresAnnualReview:projectedAnnualRevenue>200000,exceedsSimplifiedSingleYearThreshold:projectedAnnualRevenue>250000,inputs:{purchase,sale,costs,quarterlySales,irsRate:validRate,includeSocialSecurity,automaticIRS,annualSales,monthlyGrossSalary,salaryPayments}};
}

