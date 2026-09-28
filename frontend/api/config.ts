import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions } from './_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  res.status(200).json({
    "supported_resolutions": ["1T","3T","10T","1S","3S","5S","10S","15S","30S","1","2","3","4","5","10","15","30","45","60","120","180","240","D","1D","W","1W","M","1M"],
    "supports_group_request": false,
    "supports_marks": true,
    "supports_search": true,
    "supports_timescale_marks": true,
    "supports_time": true,
    "has_intraday": true,
    "has_seconds": true,
    "has_ticks": true,
    "ticks_multipliers": ["1"],
    "seconds_multipliers": ["1","5","10","15","30"],
    "intraday_multipliers": ["1","5","15","30","60","240"],
    "daily_multipliers": ["1"],
    "weekly_multipliers": ["1"],
    "monthly_multipliers": ["1"],
    "default_symbol": "XAUUSD"
  });
}
