# Spread Arbitrage Service — Architecture Document

> **Version:** 1.0  
> **Stack:** Node.js/TypeScript · PostgreSQL/TimescaleDB · Redis · Next.js · TradingView  
> **Deployment:** Docker → GHCR → GitHub Actions → Flux → Kubernetes

---

## 1. Обзор системы

Монорепозиторий из трёх независимых арбитражных движков, общей базы данных, REST/WebSocket API, и единого React-фронтенда. Каждый движок является отдельным K8s Deployment, но все разделяют одну БД, Redis и API-gateway.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        spread-service monorepo                          │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  cex-futures │  │  spot-futures│  │  dex-futures │   ← Движки       │
│  │   engine     │  │   engine     │  │   engine     │     (workers)     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                  │                          │
│         └─────────────────┴──────────────────┘                         │
│                           │                                             │
│              ┌────────────▼────────────┐                               │
│              │      Redis Pub/Sub       │  ← Событийная шина            │
│              └────────────┬────────────┘                               │
│                           │                                             │
│         ┌─────────────────┼─────────────────┐                          │
│         ▼                 ▼                 ▼                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │  API Server │  │  Alert Svc  │  │  Order Svc  │   ← Сервисы         │
│  │  (REST/WS)  │  │             │  │             │                      │
│  └──────┬──────┘  └─────────────┘  └─────────────┘                     │
│         │                                                               │
│  ┌──────▼──────────────────────────┐                                    │
│  │   PostgreSQL + TimescaleDB      │  ← Персистентное хранилище         │
│  │   (5-day hypertable retention)  │                                    │
│  └─────────────────────────────────┘                                    │
│                                                                         │
│  ┌─────────────────────────────────┐                                    │
│  │      Next.js Frontend           │  ← UI                             │
│  │   TradingView Lightweight Charts│                                    │
│  └─────────────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Репозиторий — структура файлов

```
spread-service/
│
├── packages/                          # Shared код (monorepo)
│   ├── shared/
│   │   ├── types/                     # TypeScript интерфейсы
│   │   │   ├── spread.types.ts
│   │   │   ├── order.types.ts
│   │   │   ├── exchange.types.ts
│   │   │   └── alert.types.ts
│   │   ├── utils/
│   │   │   ├── spread-calc.ts         # Формулы расчёта спреда
│   │   │   ├── fee-calculator.ts      # Расчёт комиссий
│   │   │   └── funding-calc.ts        # Расчёт фандинга
│   │   └── constants/
│   │       └── exchanges.ts
│   │
│   ├── db/                            # Database layer
│   │   ├── schema/
│   │   │   ├── prices.sql             # TimescaleDB hypertable
│   │   │   ├── spreads.sql
│   │   │   ├── positions.sql
│   │   │   ├── orders.sql
│   │   │   └── alerts.sql
│   │   ├── migrations/
│   │   └── queries/
│   │       ├── spreads.queries.ts
│   │       └── positions.queries.ts
│   │
│   └── exchange-adapters/             # Адаптеры бирж
│       ├── base.adapter.ts            # Абстрактный класс
│       ├── cex/
│       │   ├── mexc.adapter.ts
│       │   ├── binance.adapter.ts
│       │   ├── bybit.adapter.ts
│       │   └── okx.adapter.ts
│       └── dex/
│           ├── dexscreener.adapter.ts
│           └── uniswap.adapter.ts
│
├── services/
│   │
│   ├── cex-futures-engine/            # Движок #1: CEX Futures ↔ CEX Futures
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── scanner.ts             # Сканирование пар
│   │   │   ├── spread-tracker.ts      # Трекинг в реальном времени
│   │   │   └── signal-scorer.ts       # Скоринг сигналов
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── spot-futures-engine/           # Движок #2: CEX Spot ↔ CEX Futures
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── funding-monitor.ts     # Мониторинг фандинга
│   │   │   ├── basis-calculator.ts    # Расчёт basis/premium
│   │   │   └── signal-scorer.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── dex-futures-engine/            # Движок #3: DEX ↔ CEX Futures
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── dex-scanner.ts         # DexScreener / on-chain данные
│   │   │   ├── liquidity-checker.ts   # Проверка ликвидности пула
│   │   │   └── signal-scorer.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── api-server/                    # REST + WebSocket API
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── routes/
│   │   │   │   ├── spreads.routes.ts
│   │   │   │   ├── positions.routes.ts
│   │   │   │   ├── orders.routes.ts
│   │   │   │   ├── alerts.routes.ts
│   │   │   │   └── coins.routes.ts
│   │   │   ├── websocket/
│   │   │   │   ├── ws-server.ts
│   │   │   │   └── channels.ts
│   │   │   └── middleware/
│   │   │       ├── auth.ts
│   │   │       └── rate-limit.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── alert-service/                 # Алерты
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── evaluator.ts           # Оценка триггеров
│   │   │   ├── channels/
│   │   │   │   ├── telegram.ts
│   │   │   │   └── webhook.ts
│   │   │   └── throttle.ts            # Антифлуд
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── order-service/                 # Исполнение ордеров
│       ├── src/
│       │   ├── main.ts
│       │   ├── executor.ts            # Размещение ордеров на биржах
│       │   ├── risk-manager.ts        # Контроль рисков
│       │   └── position-tracker.ts   # Трекинг открытых позиций
│       ├── Dockerfile
│       └── package.json
│
├── frontend/                          # Next.js приложение
│   ├── src/
│   │   ├── app/                       # Next.js App Router
│   │   ├── components/
│   │   │   ├── charts/
│   │   │   │   ├── SpreadChart.tsx    # TradingView chart
│   │   │   │   └── PriceChart.tsx
│   │   │   ├── arbitrage/
│   │   │   │   ├── OpportunityCard.tsx
│   │   │   │   └── OpportunityTable.tsx
│   │   │   ├── positions/
│   │   │   ├── alerts/
│   │   │   └── orders/
│   │   └── lib/
│   │       ├── ws-client.ts           # WebSocket клиент
│   │       └── api.ts
│   ├── Dockerfile
│   └── package.json
│
├── k8s/
│   ├── dev/
│   │   ├── kustomization.yaml
│   │   ├── cex-futures-engine.yaml
│   │   ├── spot-futures-engine.yaml
│   │   ├── dex-futures-engine.yaml
│   │   ├── api-server.yaml
│   │   ├── alert-service.yaml
│   │   ├── order-service.yaml
│   │   ├── frontend.yaml
│   │   ├── postgres.yaml
│   │   └── redis.yaml
│   └── prod/
│       └── ...                        # Аналогично, но с большими ресурсами
│
├── .github/
│   └── workflows/
│       └── ci.yaml                    # Матричная сборка всех сервисов
│
├── docker-compose.yml                 # Локальная разработка
├── turbo.json                         # Turborepo конфиг
└── package.json                       # Workspace root

---

## 3. Арбитражные движки — логика работы

### 3.1 CEX Futures ↔ CEX Futures Engine

**Цель:** Найти одну и ту же пару на двух разных биржах фьючерсов с разными ценами.

```
Пример: BTC/USDT PERP на MEXC = $95,100
        BTC/USDT PERP на Bybit = $95,350
        Спред = +$250 (0.26%)

Стратегия: LONG на MEXC, SHORT на Bybit → ждём конвергенции
```

**Цикл работы (каждые 5 сек):**
```
1. Fetch WebSocket тикеры со всех CEX одновременно
2. Для каждой пары: рассчитать спред между всеми парами бирж
3. Применить scoring:
   - Исторический Z-score спреда (5 дней)
   - Ликвидность (объём, bid-ask spread)
   - Фандинг-ставка на обеих биржах
   - Время до следующего фандинга
4. Записать в TimescaleDB
5. Публикация в Redis channel "cex-futures:opportunities"
```

**Scoring формула:**
```typescript
score = (
  spreadPct * 30          // Размер спреда
  + zScore * 25           // Насколько аномален исторически
  + fundingEdge * 20      // Выгода от фандинга (если оба направления совпадают)
  + liquidityScore * 15   // Глубина стакана
  - executionCost * 10    // Комиссии + slippage
) / 100
```

---

### 3.2 CEX Spot ↔ CEX Futures Engine (Basis / Cash-and-Carry)

**Цель:** Arbitrage между спотом и бессрочным фьючерсом (funding rate arbitrage).

```
Пример: ETH спот на Binance = $3,200
        ETH PERP Futures    = $3,230 (premium +0.94%)
        Funding rate        = +0.08% каждые 8h = ~8.76% годовых

Стратегия: BUY спот + SHORT фьючерс → получаем фандинг пока спред существует
```

**Дополнительные данные для этого движка:**
```
- Ставка фандинга (текущая + прогноз следующей)
- Время до следующего фандинга (8h, 4h, 1h в зависимости от биржи)
- Стоимость удержания позиции (borrowing rate на спот если маржинальный)
- Break-even: минимальный фандинг для покрытия комиссий
- Projected annual yield (APY)
```

**Уникальные алерты:**
- Фандинг > X% (настраиваемый порог)
- Фандинг меняет знак (short-squeeze риск)
- Premium/Discount пересекает исторический Z-score ±2σ

---

### 3.3 DEX ↔ CEX Futures Engine

**Цель:** Arbitrage между DEX (Uniswap, PancakeSwap) и CEX фьючерсами.

```
Пример: TOKEN/USDC на Uniswap V3 = $0.0523
        TOKEN/USDT PERP на MEXC  = $0.0541
        Спред = +3.4%

Риски специфичные для DEX:
  - Gas cost (особенно ETH mainnet)
  - Price impact при большом объёме
  - Slippage в пуле
  - MEV/sandwich attack риск
  - Bridge time если разные сети
```

**Дополнительные данные:**
```
- TVL пула (Total Value Locked)
- 24h Volume пула
- Fee tier пула (0.05%, 0.3%, 1%)
- Price impact для заданного размера позиции
- Gas estimate (Gwei × gas limit × ETH price)
- Net spread after gas = gross spread - gas cost - pool fee - CEX fee
```

---

## 4. Базы данных — схема

### 4.1 TimescaleDB Hypertables (5-дневный retention)

```sql
-- Котировки цен (основная таблица)
CREATE TABLE price_ticks (
    time            TIMESTAMPTZ NOT NULL,
    symbol          VARCHAR(30)  NOT NULL,
    exchange        VARCHAR(20)  NOT NULL,
    market_type     VARCHAR(10)  NOT NULL,  -- 'spot' | 'futures' | 'dex'
    price           DECIMAL(20,8) NOT NULL,
    bid             DECIMAL(20,8),
    ask             DECIMAL(20,8),
    volume_24h      DECIMAL(30,2),
    open_interest   DECIMAL(30,2),
    funding_rate    DECIMAL(12,8),
    next_funding_at TIMESTAMPTZ
);
-- TimescaleDB
SELECT create_hypertable('price_ticks', 'time');
SELECT add_retention_policy('price_ticks', INTERVAL '5 days');

-- Спреды между парами
CREATE TABLE spread_snapshots (
    time            TIMESTAMPTZ NOT NULL,
    engine_type     VARCHAR(20)  NOT NULL,  -- 'cex-futures' | 'spot-futures' | 'dex-futures'
    symbol          VARCHAR(30)  NOT NULL,
    exchange_long   VARCHAR(20)  NOT NULL,
    exchange_short  VARCHAR(20)  NOT NULL,
    price_long      DECIMAL(20,8) NOT NULL,
    price_short     DECIMAL(20,8) NOT NULL,
    spread_abs      DECIMAL(20,8) NOT NULL,
    spread_pct      DECIMAL(10,6) NOT NULL,
    spread_net_pct  DECIMAL(10,6),           -- после вычета комиссий
    z_score         DECIMAL(8,4),
    score           DECIMAL(6,2),            -- итоговый скоринг 0-100
    is_opportunity  BOOLEAN DEFAULT FALSE
);
SELECT create_hypertable('spread_snapshots', 'time');
SELECT add_retention_policy('spread_snapshots', INTERVAL '5 days');

-- Непрерывные агрегаты для быстрых запросов
CREATE MATERIALIZED VIEW spread_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    engine_type, symbol, exchange_long, exchange_short,
    AVG(spread_pct)  AS spread_avg,
    MAX(spread_pct)  AS spread_high,
    MIN(spread_pct)  AS spread_low,
    LAST(spread_pct, time) AS spread_close,
    AVG(z_score)     AS z_score_avg
FROM spread_snapshots
GROUP BY bucket, engine_type, symbol, exchange_long, exchange_short;
```

### 4.2 PostgreSQL (постоянные данные)

```sql
-- Инструменты и метаданные монет
CREATE TABLE coins (
    symbol              VARCHAR(30) PRIMARY KEY,
    name                VARCHAR(100),
    coingecko_id        VARCHAR(100),
    -- Limity позиций (обновляются раз в час)
    max_position_mexc   DECIMAL(30,2),
    max_position_bybit  DECIMAL(30,2),
    max_position_binance DECIMAL(30,2),
    -- Маржинальные параметры
    max_leverage        INT,
    maintenance_margin  DECIMAL(8,4),
    -- Рыночные характеристики
    avg_daily_volume    DECIMAL(30,2),
    avg_spread_bps      DECIMAL(8,2),    -- средний bid-ask в базисных пунктах
    is_active           BOOLEAN DEFAULT TRUE,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Активные и закрытые позиции
CREATE TABLE positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engine_type     VARCHAR(20) NOT NULL,
    symbol          VARCHAR(30) NOT NULL,
    status          VARCHAR(20) DEFAULT 'open',  -- open | closed | partial
    -- Параметры входа
    opened_at       TIMESTAMPTZ NOT NULL,
    exchange_long   VARCHAR(20) NOT NULL,
    exchange_short  VARCHAR(20) NOT NULL,
    entry_spread    DECIMAL(10,6),
    size_usd        DECIMAL(20,2),
    leverage        INT DEFAULT 1,
    -- Текущее состояние
    unrealized_pnl  DECIMAL(20,8),
    realized_pnl    DECIMAL(20,8),
    funding_earned  DECIMAL(20,8),
    fees_paid       DECIMAL(20,8),
    -- Закрытие
    closed_at       TIMESTAMPTZ,
    exit_spread     DECIMAL(10,6),
    close_reason    VARCHAR(50)     -- 'manual' | 'stop-loss' | 'take-profit' | 'funding-flip'
);

-- Ордера
CREATE TABLE orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id     UUID REFERENCES positions(id),
    exchange        VARCHAR(20) NOT NULL,
    exchange_order_id VARCHAR(100),
    symbol          VARCHAR(30) NOT NULL,
    side            VARCHAR(10) NOT NULL,   -- 'buy' | 'sell'
    order_type      VARCHAR(20) NOT NULL,  -- 'market' | 'limit' | 'post-only'
    quantity        DECIMAL(20,8),
    price           DECIMAL(20,8),
    status          VARCHAR(20),           -- 'pending' | 'filled' | 'cancelled'
    filled_qty      DECIMAL(20,8),
    avg_fill_price  DECIMAL(20,8),
    fee             DECIMAL(20,8),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Алерты
CREATE TABLE alert_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    engine_type     VARCHAR(20),           -- NULL = все движки
    symbol          VARCHAR(30),           -- NULL = все пары
    condition_type  VARCHAR(50) NOT NULL,  -- 'spread_gt' | 'z_score_gt' | 'funding_gt' | ...
    threshold       DECIMAL(20,8),
    channel         VARCHAR(20) NOT NULL,  -- 'telegram' | 'webhook'
    channel_config  JSONB,
    cooldown_min    INT DEFAULT 15,        -- антифлуд: мин между повторными алертами
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE TABLE alert_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_config_id UUID REFERENCES alert_configs(id),
    triggered_at    TIMESTAMPTZ DEFAULT NOW(),
    symbol          VARCHAR(30),
    value           DECIMAL(20,8),
    message         TEXT
);
```

---

## 5. API — эндпоинты

### REST API (`/api/v1`)

```
Spreads & Opportunities
  GET  /spreads/opportunities          → Топ возможностей сейчас (все движки)
  GET  /spreads/opportunities/:engine  → Возможности конкретного движка
  GET  /spreads/history/:symbol        → История спреда (для TradingView)
  GET  /spreads/stats/:symbol          → Z-score, mean, std за 5 дней

Coins & Instruments
  GET  /coins                          → Список монет с метаданными
  GET  /coins/:symbol                  → Детали монеты
  GET  /coins/:symbol/funding          → История фандинга
  GET  /coins/:symbol/limits           → Лимиты позиций по биржам

Positions
  GET  /positions                      → Все открытые позиции
  GET  /positions/:id                  → Детали позиции
  POST /positions                      → Открыть позицию
  PUT  /positions/:id/close            → Закрыть позицию
  GET  /positions/history              → Закрытые позиции + PnL

Orders
  GET  /orders/:positionId             → Ордера позиции
  POST /orders                         → Разместить ордер вручную
  DELETE /orders/:id                   → Отменить ордер

Alerts
  GET  /alerts                         → Список конфигов алертов
  POST /alerts                         → Создать алерт
  PUT  /alerts/:id                     → Обновить алерт
  DELETE /alerts/:id                   → Удалить алерт
  GET  /alerts/history                 → История сработавших алертов

Analytics (дополнительно)
  GET  /analytics/pnl                  → PnL summary (daily/weekly/monthly)
  GET  /analytics/best-pairs           → Топ пар по историческому спреду
  GET  /analytics/correlation          → Корреляция спредов
```

### WebSocket каналы (`/ws`)

```typescript
// Клиент подписывается на каналы:

// Реальное время — все возможности
ws.subscribe('opportunities')
// → { engine, symbol, spreadPct, spreadNet, zScore, score, ... }

// Спред конкретной пары (для графика)
ws.subscribe('spread:BTC/USDT:mexc:bybit')
// → { time, spreadPct, priceLong, priceShort }

// Обновления позиций
ws.subscribe('positions')
// → { positionId, unrealizedPnl, fundingEarned, currentSpread }

// Алерты
ws.subscribe('alerts')
// → { alertId, symbol, message, value, severity }
```


---

## 6. Фронтенд — страницы и компоненты

### Страницы

```
/                     → Dashboard: сводка возможностей всех движков
/opportunities        → Таблица всех возможностей с фильтрами
/opportunities/:id    → Детальная страница пары: графики + метрики + форма открытия
/positions            → Открытые позиции + история
/positions/:id        → Детали позиции, ордера, PnL-график
/analytics            → Аналитика: PnL, лучшие пары, статистика
/alerts               → Управление алертами
/settings             → Ключи API бирж, параметры риск-менеджмента
```

### Ключевые компоненты

**SpreadChart** (TradingView Lightweight Charts)
```
На странице /opportunities/:id два chart'а:
┌─────────────────────────────────────────────┐
│  Price Chart                                │
│  ┄┄ Price Long (Exchange A)  ━━━━━━━━━━━━━  │
│  ┄┄ Price Short (Exchange B) ━━━━━━━━━━━━━  │
│  Свечи + линии                              │
│  Timeframes: 1m 5m 15m 1h 4h               │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│  Spread Chart (%)                           │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  — — Mean (5d avg)                          │
│  · · · +2σ / -2σ bands                     │
│  Цветовое выделение: > threshold = зелёный  │
└─────────────────────────────────────────────┘
```

**OpportunityTable** — главная таблица
```
Колонки:
Symbol | Engine | Exchange L→S | Spread% | Net% | Z-Score | Score | Funding | Volume | Action
```

**Coin Detail Panel** — при клике на монету
```
├── Max Position Size (по каждой бирже)
├── Current Funding Rate + Next Funding Time
├── Open Interest (Long/Short ratio)
├── Bid-Ask Spread (в bps)
├── 24h Volume
├── Liquidation levels
├── Historical funding rate chart (7d)
└── Correlated pairs
```

**OrderForm** — форма открытия позиции
```
├── Size ($) / Leverage
├── Order type: Market | Limit | Post-only
├── Risk check: max drawdown, position size % of capital
├── Fee estimate (entry + exit)
├── Break-even spread
├── Expected APY (для spot-futures)
└── [Open Long on A] [Open Short on B] кнопки
```

---

## 7. Технологический стек

### Backend

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| Runtime | Node.js 20 LTS | Уже в стеке, отличный для IO-bound |
| Language | TypeScript 5 | Типобезопасность для финансовых данных |
| HTTP Framework | Fastify | В 2x быстрее Express, JSON schema validation |
| WebSocket | ws + Fastify-ws | Нативный WS без overhead |
| Build System | Turborepo | Монорепо + параллельная сборка |
| ORM / Query | Kysely | Type-safe SQL query builder, без ORM overhead |
| Migrations | node-pg-migrate | Простые SQL-миграции |
| Message Bus | Redis (ioredis) | Pub/Sub между движками |
| Cache | Redis | Последние тикеры, лимиты позиций |
| Validation | Zod | Schema validation + TypeScript inference |
| Exchange SDK | ccxt | Универсальный адаптер для 100+ CEX |
| DEX | viem + DexScreener API | On-chain данные |
| Logging | Pino | Structured JSON logging (интеграция с Loki) |
| Metrics | prom-client | Prometheus метрики |
| Testing | Vitest | Быстрый unit/integration test runner |

### Frontend

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| Framework | Next.js 14 (App Router) | SSR + RSC + отличная DX |
| Language | TypeScript | Общие типы с backend (из packages/shared) |
| Charts | TradingView Lightweight Charts | Требование, профессиональные финансовые графики |
| UI Kit | shadcn/ui + Tailwind | Кастомизируемые компоненты |
| State | Zustand | Легковесный, для глобального состояния |
| Server State | TanStack Query | Кеш, фоновое обновление, optimistic updates |
| WebSocket | @tanstack/react-query + native WS | Реалтайм данные |
| Tables | TanStack Table | Мощные финансовые таблицы с сортировкой |
| Forms | React Hook Form + Zod | Валидация форм ордеров |

### Infrastructure

| Компонент | Технология |
|-----------|-----------|
| Database | PostgreSQL 16 + TimescaleDB 2 |
| Cache / Bus | Redis 7 |
| Container | Docker |
| Registry | GitHub Container Registry (GHCR) |
| Orchestration | Kubernetes (K3s на VPS) |
| GitOps | Flux v2 |
| CI/CD | GitHub Actions (matrix build) |
| Monitoring | Prometheus + Grafana + Loki |
| Ingress | Nginx Ingress Controller |
| TLS | cert-manager + Let's Encrypt |

---

## 8. Kubernetes — развёртывание

### Deployments в namespace `spread-service`

```
spread-service namespace
├── cex-futures-engine     (1 replica dev / 1 prod)   — stateless worker
├── spot-futures-engine    (1 replica dev / 1 prod)   — stateless worker
├── dex-futures-engine     (1 replica dev / 1 prod)   — stateless worker
├── api-server             (1 replica dev / 2 prod)   — REST + WS
├── alert-service          (1 replica dev / 1 prod)   — stateless
├── order-service          (1 replica dev / 1 prod)   — stateful (осторожно!)
├── frontend               (1 replica dev / 2 prod)   — Next.js
├── postgres               (1 replica)                — StatefulSet + PVC
└── redis                  (1 replica)                — StatefulSet + PVC
```

### Resources (prod)

```yaml
# Движки — лёгкие, IO-bound
resources:
  requests: { memory: 128Mi, cpu: 100m }
  limits:   { memory: 256Mi, cpu: 300m }

# API Server — умеренная нагрузка
resources:
  requests: { memory: 256Mi, cpu: 200m }
  limits:   { memory: 512Mi, cpu: 500m }

# Frontend (Next.js SSR)
resources:
  requests: { memory: 256Mi, cpu: 150m }
  limits:   { memory: 512Mi, cpu: 400m }

# PostgreSQL + TimescaleDB
resources:
  requests: { memory: 512Mi, cpu: 300m }
  limits:   { memory: 1Gi, cpu: 1000m }
storage: 20Gi (PVC)

# Redis
resources:
  requests: { memory: 128Mi, cpu: 50m }
  limits:   { memory: 256Mi, cpu: 200m }
storage: 2Gi (PVC)
```

### CI — матричная сборка

```yaml
# .github/workflows/ci.yaml
strategy:
  matrix:
    service:
      - cex-futures-engine
      - spot-futures-engine
      - dex-futures-engine
      - api-server
      - alert-service
      - order-service
      - frontend
```

> Каждый сервис собирается параллельно. Бампается только тот image, у которого изменились файлы (через `paths:` фильтр в GitHub Actions).

---

## 9. Алерты — типы и каналы

### Типы триггеров

```
Spread алерты:
  spread_gt              Спред > X%
  spread_net_gt          Чистый спред (после комиссий) > X%
  z_score_gt             Z-score > 2 (аномальный спред)
  spread_convergence     Спред сошёлся (для выхода из позиции)

Funding алерты:
  funding_gt             Ставка фандинга > X% (годовых)
  funding_flip           Фандинг сменил знак
  funding_extreme        Фандинг > 0.3% за сессию (экстремальный)
  next_funding_soon      До следующего фандинга < 30 мин

Позиции:
  position_pnl_gt        Unrealized PnL > X$
  position_pnl_lt        Unrealized PnL < -X$ (стоп-лосс алерт)
  spread_vs_entry        Спред расширился vs entry на X% (риск)

Liquidity:
  volume_drop            Объём упал > 50% от среднего
  oi_spike               Open Interest вырос > 20% за час (манипуляция)
```

### Каналы

```
Telegram Bot   → форматированные сообщения с эмодзи и ссылками
Webhook        → POST JSON на произвольный URL (интеграция с любой системой)
```

---

## 10. Дополнительные функции (рекомендации)

### 10.1 Автоматический скринер монет
Раз в 1 час сканировать DexScreener / CoinGecko на новые листинги с фьючерсами — автоматически добавлять в мониторинг. Новые листинги часто имеют максимальный спред.

### 10.2 Correlation Matrix
Таблица корреляции спредов между монетами. Если BTC-спред вырос, ETH-спред обычно следует — это помогает предсказать движение.

### 10.3 PnL Dashboard
- Реализованный и нереализованный PnL
- Breakdown: тело позиции vs фандинг-доход vs комиссии
- Equity curve график
- Sharpe ratio, Max Drawdown

### 10.4 Risk Manager (автоматический)
- Максимальный размер позиции (% от капитала)
- Максимальная суммарная экспозиция
- Auto-close если спред расширяется > X% от входа
- Auto-close за N минут до экспирации (для dated futures)

### 10.5 Backtester
Исторические данные за 5 дней позволяют прогонять стратегию:
"Если бы я открыл позицию при спреде > 0.3% и закрыл при < 0.05%, какой был бы PnL за последние 5 дней?"

### 10.6 Watchlist & Favourites
Пользователь помечает пары, они всегда в топе таблицы независимо от score.

### 10.7 Exchange Health Monitor
Ping бирж и DEX каждые 30 сек. Если биржа недоступна — помечать все её пары как неактивные, алерт. Не открывать позиции на недоступных биржах.

### 10.8 Multi-account поддержка
Разные API ключи для разных субаккаунтов. Позволяет разделять capital between движками.

### 10.9 Telegram Mini App
Лёгкая версия фронтенда прямо в Telegram боте — смотреть топ возможностей и открывать позиции не заходя в браузер.

### 10.10 Export & Reports
- CSV экспорт истории сделок (для налогового учёта)
- Daily report в Telegram в 00:00 UTC

---

## 11. Переменные окружения (Secret)

```bash
# Общие
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...

# API ключи бирж (по одному на биржу)
MEXC_API_KEY=...
MEXC_API_SECRET=...
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
OKX_API_KEY=...
OKX_API_SECRET=...
OKX_PASSPHRASE=...

# DEX
ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/...  # опционально
DEXSCREENER_API_KEY=...  # если есть premium

# Алерты
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

---

## 12. Roadmap развёртывания

```
Фаза 1 — Core Infrastructure (1-2 недели)
  ✦ PostgreSQL + TimescaleDB + Redis в K8s
  ✦ API Server skeleton (Fastify + WS)
  ✦ Shared пакеты: types, db, exchange-adapters
  ✦ CI матричная сборка работает

Фаза 2 — Первый движок: spot-futures (1 неделя)
  ✦ CEX Spot ↔ CEX Futures (самый понятный арбитраж)
  ✦ Фандинг мониторинг
  ✦ Базовый фронтенд: таблица + простой график

Фаза 3 — Второй движок: cex-futures (1 неделя)
  ✦ CEX Futures ↔ CEX Futures
  ✦ Z-score по 5-дневной истории
  ✦ TradingView spread chart

Фаза 4 — Алерты + Позиции (1 неделя)
  ✦ Alert Service (Telegram)
  ✦ Order Service (ручное открытие)
  ✦ Positions tracking

Фаза 5 — DEX движок (1-2 недели)
  ✦ DexScreener интеграция
  ✦ Gas cost calculator
  ✦ DEX ↔ CEX Futures engine

Фаза 6 — Analytics & Extras
  ✦ PnL Dashboard
  ✦ Backtester
  ✦ Risk Manager
  ✦ Correlation Matrix
```
