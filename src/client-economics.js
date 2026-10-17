const finite=Number.isFinite;
const nonnegative=value=>finite(value)&&value>=0;
const money=value=>nonnegative(value)&&value<=1e6;

export function clientPriceChain(row){
 const volume=row?.volumeKg,price=row?.priceRubKg,cost=row?.reportedCostRubKg;
 const perKg=value=>finite(value)&&finite(volume)&&volume>0?value/volume:null;
 const logistics=perKg(row?.reportedLogisticsRub),margin=perKg(row?.marginRub);
 const reconciliation=finite(row?.reconciliationRub)?perKg(row.reconciliationRub):[price,cost,logistics,margin].every(finite)?price-cost-logistics-margin:null;
 const bars=[price,cost,logistics,margin,reconciliation].every(finite)?[
  {name:'Выручка',value:price,total:true},{name:'Затраты\nотчета',value:-cost},
  {name:'Учтенная\nлогистика',value:-logistics},{name:'Сверка',value:-reconciliation},
  {name:'Маржа\nотчета',value:margin,total:true}
 ]:null;
 return {price,cost,logistics,margin,reconciliation,bars};
}

export function negotiationInputPrice(value,basePrice){
 return value===null?basePrice:value.trim()===''?null:Number(value);
}

export function negotiatePrice({basePrice,volumeKg,price,cost,logistics,deductions,targetMargin}){
 const revenueChangeRub=[basePrice,price].every(money)&&nonnegative(volumeKg)&&volumeKg<=1e12?(price-basePrice)*volumeKg:null;
 const complete=[cost,logistics,deductions].every(money)&&nonnegative(targetMargin)&&targetMargin<=99.9;
 const thresholdPriceRubKg=complete?deductions+(cost+logistics)/(1-targetMargin/100):null;
 const discountHeadroomPct=complete&&money(price)&&price>0?(price-thresholdPriceRubKg)/price*100:null;
 return {revenueChangeRub:finite(revenueChangeRub)?revenueChangeRub:null,thresholdPriceRubKg:finite(thresholdPriceRubKg)?thresholdPriceRubKg:null,discountHeadroomPct:finite(discountHeadroomPct)?discountHeadroomPct:null};
}
