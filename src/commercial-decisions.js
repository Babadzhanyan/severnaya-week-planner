const bounded=(value,max)=>Number.isFinite(value)&&value>=0&&value<=max;
export function discountDecision({volume,additional,price,newPrice,variableCost}){
 if(![volume,additional].every(value=>bounded(value,1000))||![price,newPrice,variableCost].every(value=>bounded(value,1e6)))return null;
 const quantity=volume+additional,baselineRevenue=volume*price*1000,baselineCost=volume*variableCost*1000;
 const base={quantity:volume,revenue:baselineRevenue,cost:baselineCost,contribution:baselineRevenue-baselineCost,delta:0};
 const incremental={quantity,revenue:baselineRevenue+additional*newPrice*1000,cost:quantity*variableCost*1000};
 incremental.contribution=incremental.revenue-incremental.cost;incremental.delta=incremental.contribution-base.contribution;
 const all={quantity,revenue:quantity*newPrice*1000,cost:quantity*variableCost*1000};
 all.contribution=all.revenue-all.cost;all.delta=all.contribution-base.contribution;
 return {base,incremental,all,ruleDifferenceRub:incremental.contribution-all.contribution};
}

export function freezingDecision({priceNow,futurePrice,freezeCost,probabilityPct}){
 if(![priceNow,futurePrice,freezeCost].every(value=>bounded(value,1e6))||!bounded(probabilityPct,100))return null;
 const thresholdProbability=futurePrice>0?(priceNow+freezeCost)/futurePrice:priceNow+freezeCost===0?0:null;
 const expectedNetRubKg=futurePrice*probabilityPct/100-freezeCost;
 return {thresholdProbability:Number.isFinite(thresholdProbability)?thresholdProbability:null,attainable:thresholdProbability!==null&&thresholdProbability<=1,
  expectedNetRubKg,deltaRubKg:expectedNetRubKg-priceNow};
}

export function stockScenarios(params,filletYield,demand){
 if(!params||!bounded(params.cut,1000)||!bounded(demand,1000)||!Number.isFinite(filletYield)||filletYield<=0||filletYield>1)return null;
 const late=JSON.parse(JSON.stringify(params));late.demand={...late.demand,fillet:demand};
 const early=JSON.parse(JSON.stringify(late));early.cut=Math.min(late.cut,demand/filletYield);
 return {early,late};
}
