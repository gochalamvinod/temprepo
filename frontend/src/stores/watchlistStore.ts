import { create } from 'zustand';

interface WatchlistState {
  lists: Array<{ id: string; name: string; symbols: string[] }>;
  activeListId: string | null;
  
  createList: (name: string) => void;
  deleteList: (id: string) => void;
  addSymbol: (listId: string, symbol: string) => void;
  removeSymbol: (listId: string, symbol: string) => void;
  setActiveList: (id: string) => void;
}

export const useWatchlistStore = create<WatchlistState>((set) => ({
  lists: [{ id: 'default', name: 'Watchlist', symbols: ['EURUSD', 'BTCUSD', 'AAPL'] }],
  activeListId: 'default',

  createList: (name) => set(state => {
    const id = Date.now().toString();
    return { lists: [...state.lists, { id, name, symbols: [] }], activeListId: id };
  }),
  deleteList: (id) => set(state => ({
    lists: state.lists.filter(l => l.id !== id),
    activeListId: state.activeListId === id ? (state.lists[0]?.id || null) : state.activeListId
  })),
  addSymbol: (listId, symbol) => set(state => ({
    lists: state.lists.map(l => l.id === listId && !l.symbols.includes(symbol) ? { ...l, symbols: [...l.symbols, symbol] } : l)
  })),
  removeSymbol: (listId, symbol) => set(state => ({
    lists: state.lists.map(l => l.id === listId ? { ...l, symbols: l.symbols.filter(s => s !== symbol) } : l)
  })),
  setActiveList: (id) => set({ activeListId: id })
}));
