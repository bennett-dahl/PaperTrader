// eslint-disable-next-line @typescript-eslint/no-require-imports
const finnhub = require("finnhub");

// Singleton Finnhub client — initialized once per process
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFinnhubClient(): any {
  if (!_client) {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) throw new Error("FINNHUB_API_KEY is not set");
    _client = new finnhub.DefaultApi(apiKey);
  }
  return _client;
}

export interface QuoteData {
  c: number; // current price
  d: number; // change
  dp: number; // change percent
}

export interface SymbolResult {
  symbol: string;
  description: string;
  type: string;
}

/** Fetch a single quote. Returns null if unavailable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fetchQuote(client: any, ticker: string): Promise<QuoteData | null> {
  return new Promise((resolve) => {
    client.quote(ticker, (error: unknown, data: QuoteData | null) => {
      if (error || !data || !data.c) {
        resolve(null);
      } else {
        resolve(data);
      }
    });
  });
}

/** Search symbols. Returns up to `limit` results (default 8). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function searchSymbols(client: any, query: string, limit = 8): Promise<SymbolResult[]> {
  return new Promise((resolve) => {
    client.symbolSearch(
      query,
      {},
      (error: unknown, data: { result?: SymbolResult[] } | null) => {
        if (error || !data?.result) {
          resolve([]);
        } else {
          resolve(data.result.slice(0, limit));
        }
      }
    );
  });
}
