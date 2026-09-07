import { exactMoneyToCents, type ExactMoney } from './exact-money';

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export function moneySeriesIsChartSafe(values: ExactMoney[]) {
  return values.every((value) => {
    const cents = exactMoneyToCents(value);
    return cents <= MAX_SAFE_CENTS && cents >= -MAX_SAFE_CENTS;
  });
}

/** Approximation only for chart geometry. Labels must use the original exact string. */
export function approximateMoneyForChart(value: ExactMoney) {
  return parseInt(exactMoneyToCents(value).toString(), 10) / 100;
}
