# Project: TRADINGVIEW ADVANCED — Binary Tree Exhaustive Bug Elimination & HFT Optimization

## Architecture
- **Frontend Layer**: TradingView Charting Library (v28/standalone), `index.html`, `pine_editor_ide.js`, `pine_indicators.js`, `pine_editor.css`, `datafeeds/udf/dist/bundle.js`.
- **Backend API & HFT Streaming Layer**: FastAPI (`server.py`, port 8080 or 9000), `hft_engine.py`, `ticks.py`, `seconds.py`, `broker_time.py`, `mt5_bridge_server.py`.
- **Proxy & Dual-Port Service Layer**: Node.js (`frontend_server.js`, port 9000 & 9999).
- **Broker Interface Layer**: MetaTrader 5 Python client connecting to Orbex Global demo account (`#70257567`).

## Binary Tree Exploration Structure
```
                         [System Possibility Space]
                                     |
             +-----------------------+-----------------------+
             |                                               |
     [Left Subtree: UI & Controls]               [Right Subtree: Data & Streaming]
             |                                               |
     +-------+-------+                               +-------+-------+
     |               |                               |               |
[L1: Buttons &  [L2: Modals, Dialogs,           [R1: Resolutions & [R2: HFT Streaming,
 Interactive     Account Center,                 Tick Feeds (1S..1M, Latency <1ms, 24/7
 Controls]       Legend & Toolbars]              1T..100T, History]   BTCUSD, Zero-Drift Time]
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Resolution Switching | Seamless transitions across 1S, 5S, 10S, 15S, 30S, 1, 3, 5, 15, 30, 45, 1H, 2H, 3H, 4H, 1D, 1W, 1M, and tick resolutions (1T, 10T, 40T, 100T) without crash or cliff drop | M1 | ORIGINAL_REQUEST.md §R1 |
| 2 | R1.2 Interactive Controls & Buttons | All buttons (Account Center tabs, Symbol switcher, Chart types, Indicators, Legend controls, Floating toolbar, Pine Editor) respond cleanly with 0 console errors | M1 | ORIGINAL_REQUEST.md §R1 |
| 3 | R1.3 Error & Edge States | Graceful recovery on empty responses, closed markets, rapid clicks, network disconnects | M1 | ORIGINAL_REQUEST.md §R1 |
| 4 | R2.1 Weekend 24/7 BTCUSD Micro-Ticks | Automatic synthetic micro-tick engine (preserving bid/ask spread and millisecond timestamps) when MT5 market is closed | M2 | ORIGINAL_REQUEST.md §R2 |
| 5 | R2.2 Ultra-Low Latency Pipeline (<1ms) | Ingestion-to-broadcast latency <1ms using contiguous ring buffers and zero-copy JSON | M2 | ORIGINAL_REQUEST.md §R2 |
| 6 | R2.3 Real-Time Chart Movement | Chart line, seconds countdowns, and 1T tick plots continuously advance without freezing | M2 | ORIGINAL_REQUEST.md §R2 |
| 7 | R3.1 Zero-Drift Server Time | Exact UTC server time across MT5, FastAPI (`/time`), Node.js proxy (`/time`), and frontend `ServerTimeSyncEngine` | M3 | ORIGINAL_REQUEST.md §R3 |
| 8 | R3.2 Accurate Axis & Clock Alignment | Elimination of 5-hour offset or cliff drops; TradingView bottom-right UTC clock matches bars | M3 | ORIGINAL_REQUEST.md §R3 |
| 9 | R4.1 Tri-Service Dual-Port Integration | Ports 9000 (Website), 9999 (Proxy), and 8080 (Python Backend) operate concurrently and stably | M4 | ORIGINAL_REQUEST.md §R4 |
| 10 | R4.2 Automated CDP Verification | Playwright / Chrome DevTools Protocol test suite proving live chart movement, Account Center health, and UI responsiveness | M4 | ORIGINAL_REQUEST.md §R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Binary Tree Bug Elimination (UI & Resolutions) | All UI buttons, controls, resolution switches (1S..1M, 1T..100T), error states | None | IN_PROGRESS |
| M2 | Ultra-Low Latency Streaming & Weekend BTCUSD | <1ms streaming pipeline, 24/7 BTCUSD micro-ticks, ring buffer optimizations | None | IN_PROGRESS |
| M3 | Zero-Drift Server Time & UTC Alignment | Deterministic broker timezone offset, `/time` synchronization, timescale clock | None | IN_PROGRESS |
| M4 | Tri-Service Dual-Port Integration & CDP Suite | Ports 9000, 9999, 8080 integration and automated CDP browser verification | M1, M2, M3 | PLANNED |
| M5 | Final Adversarial Hardening & Forensic Audit | 100% test pass rate, adversarial stress verification, forensic integrity audit | M4 | PLANNED |

## Code Layout & Exclusive Write Boundaries
- `index.html`: Owned by Worker Frontend (`dev_ui_resolutions` / `dev_time_tri_service`)
- `pine_editor_ide.js`, `pine_indicators.js`, `pine_editor.css`: Owned by Worker Frontend
- `server.py`, `seconds.py`, `ticks.py`, `broker_time.py`: Owned by Worker Backend (`dev_hft_streaming` / `dev_time_tri_service`)
- `hft_engine.py`, `mt5_bridge_server.py`: Owned by Worker Backend (`dev_hft_streaming`)
- `frontend_server.js`: Owned by Worker Proxy (`dev_time_tri_service`)
- `tests/*`, `scripts/*`, `scratch/*`: Owned by Test Writer (`test_writer_infra_16`)
