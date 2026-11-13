// Constant-product market maker; virtual currency is represented in cents.
export const INITIAL_CASH = 2300000;
export const INITIAL_UNITS = 10000;
export const INITIAL_RESERVE = 100000000;
export const FEE = 0.003;
export function quote(market, side, quantity) {
  if (!['BUY','SELL'].includes(side) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) throw Error('Množství musí být celé číslo 1–1000.');
  const {units, reserve} = market;
  if (side === 'BUY' && quantity >= units) throw Error('Nedostatek likvidity.');
  const nextUnits = side === 'BUY' ? units - quantity : units + quantity;
  const raw = reserve * quantity / nextUnits;
  const total = side === 'BUY' ? Math.ceil(raw / (1-FEE)) : Math.floor(raw * (1-FEE));
  if (!Number.isSafeInteger(total) || total < 1) throw Error('Neplatná cena.');
  return {total, units:nextUnits, reserve:reserve + (side === 'BUY' ? total : -total)};
}
export function execute(market, player, side, quantity, limit) {
  const q = quote(market, side, quantity);
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Neplatný cenový limit.');
  if (side === 'BUY' && q.total > limit || side === 'SELL' && q.total < limit) throw Error('Cena se změnila. Zkontroluj nový odhad a opakuj obchod.');
  if (side === 'BUY' && player.cash < q.total) throw Error('Nedostatek virtuálních peněz.');
  if (side === 'SELL' && player.units < quantity) throw Error('Nemáš dost SHLD.');
  return {market:{units:q.units,reserve:q.reserve},player:{cash:player.cash+(side==='BUY'?-q.total:q.total),units:player.units+(side==='BUY'?quantity:-quantity)},total:q.total};
}
