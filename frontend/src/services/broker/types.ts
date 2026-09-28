export type OrderStatus = 1 | 2 | 3 | 4 | 5 | 6;
export const OrderStatusValue = {
  Canceled: 1,
  Filled: 2,
  Inactive: 3,
  Margin: 4,
  Rejected: 5,
  Working: 6
} as const;

export type Side = 1 | -1;
export const SideValue = {
  Buy: 1 as Side,
  Sell: -1 as Side
} as const;

export interface Position {
  id: string;
  symbol: string;
  qty: number;
  side: Side;
  avgPrice: number;
  price: number;
  profit: number;
  stopLoss?: number;
  takeProfit?: number;
  canBeClosed?: boolean;
}

export interface Order {
  id: string;
  symbol: string;
  qty: number;
  side: Side;
  type: string;
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: OrderStatus;
}
