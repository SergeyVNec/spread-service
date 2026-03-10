-- =============================================================================
-- TimescaleDB schema for spread-service
-- Run once: psql -d $DATABASE_URL -f schema.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- 1. Price ticks — сырые тикеры от бирж
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_ticks (
    time              TIMESTAMPTZ      NOT NULL,
    symbol            VARCHAR(30)      NOT NULL,
    exchange          VARCHAR(20)      NOT NULL,
    market_type       VARCHAR(10)      NOT NULL,
    price             NUMERIC(24, 8)   NOT NULL,
    bid               NUMERIC(24, 8),
    ask               NUMERIC(24, 8),
    volume_24h        NUMERIC(32, 2),
    open_interest     NUMERIC(32, 2),
    funding_rate      NUMERIC(14, 8),
    next_funding_at   TIMESTAMPTZ,
    mark_price        NUMERIC(24, 8),
    index_price       NUMERIC(24, 8)
);

SELECT create_hypertable('price_ticks', 'time', if_not_exists => TRUE);
SELECT add_retention_policy('price_ticks', INTERVAL '5 days', if_not_exists => TRUE);

-- Индексы для быстрых запросов по паре+бирже
CREATE INDEX IF NOT EXISTS idx_price_ticks_symbol_exchange
    ON price_ticks (symbol, exchange, time DESC);

-- ---------------------------------------------------------------------------
-- 2. Spread snapshots — рассчитанные спреды
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spread_snapshots (
    time              TIMESTAMPTZ      NOT NULL,
    engine_type       VARCHAR(20)      NOT NULL,
    symbol            VARCHAR(30)      NOT NULL,
    exchange_long     VARCHAR(20)      NOT NULL,
    exchange_short    VARCHAR(20)      NOT NULL,
    price_long        NUMERIC(24, 8)   NOT NULL,
    price_short       NUMERIC(24, 8)   NOT NULL,
    spread_abs        NUMERIC(24, 8)   NOT NULL,
    spread_pct        NUMERIC(12, 6)   NOT NULL,
    spread_net_pct    NUMERIC(12, 6),
    funding_rate_long  NUMERIC(14, 8),
    funding_rate_short NUMERIC(14, 8),
    funding_edge_pct  NUMERIC(10, 4),
    z_score           NUMERIC(10, 4),
    score             NUMERIC(6, 2),
    is_opportunity    BOOLEAN          NOT NULL DEFAULT FALSE
);

SELECT create_hypertable('spread_snapshots', 'time', if_not_exists => TRUE);
SELECT add_retention_policy('spread_snapshots', INTERVAL '5 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_spread_snapshots_symbol
    ON spread_snapshots (symbol, exchange_long, exchange_short, time DESC);

CREATE INDEX IF NOT EXISTS idx_spread_snapshots_opportunity
    ON spread_snapshots (is_opportunity, time DESC)
    WHERE is_opportunity = TRUE;

-- ---------------------------------------------------------------------------
-- 3. Continuous Aggregates — предагрегированные OHLC по 1 минуте (для TradingView)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS spread_ohlc_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time)   AS bucket,
    engine_type,
    symbol,
    exchange_long,
    exchange_short,
    first(spread_pct, time)         AS open,
    max(spread_pct)                 AS high,
    min(spread_pct)                 AS low,
    last(spread_pct, time)          AS close,
    avg(spread_pct)                 AS avg,
    avg(z_score)                    AS z_score_avg,
    max(score)                      AS score_max,
    count(*)                        AS ticks
FROM spread_snapshots
GROUP BY bucket, engine_type, symbol, exchange_long, exchange_short
WITH NO DATA;

SELECT add_continuous_aggregate_policy('spread_ohlc_1min',
    start_offset => INTERVAL '6 days',
    end_offset   => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);

-- ---------------------------------------------------------------------------
-- 4. Постоянные таблицы (не TimescaleDB, стандартный PostgreSQL)
-- ---------------------------------------------------------------------------

-- Монеты и их параметры (обновляются раз в час)
CREATE TABLE IF NOT EXISTS coins (
    symbol                  VARCHAR(30)     PRIMARY KEY,
    name                    VARCHAR(100),
    coingecko_id            VARCHAR(100),
    -- Лимиты позиций (USD) по каждой бирже
    max_position_mexc       NUMERIC(20, 2),
    max_position_binance    NUMERIC(20, 2),
    max_position_bybit      NUMERIC(20, 2),
    max_position_okx        NUMERIC(20, 2),
    max_position_gate       NUMERIC(20, 2),
    max_position_bitget     NUMERIC(20, 2),
    -- Маржинальные параметры
    max_leverage            INT,
    maintenance_margin_rate NUMERIC(8, 4),
    -- Усреднённые рыночные метрики
    avg_daily_volume_usd    NUMERIC(32, 2),
    avg_spread_bps          NUMERIC(8, 2),
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Открытые и закрытые позиции
CREATE TABLE IF NOT EXISTS positions (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    engine_type       VARCHAR(20)     NOT NULL,
    symbol            VARCHAR(30)     NOT NULL,
    status            VARCHAR(20)     NOT NULL DEFAULT 'open',
    opened_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    exchange_long     VARCHAR(20)     NOT NULL,
    exchange_short    VARCHAR(20)     NOT NULL,
    entry_spread_pct  NUMERIC(12, 6),
    size_usd          NUMERIC(20, 2),
    leverage          INT             NOT NULL DEFAULT 1,
    unrealized_pnl    NUMERIC(20, 8)  NOT NULL DEFAULT 0,
    realized_pnl      NUMERIC(20, 8)  NOT NULL DEFAULT 0,
    funding_earned    NUMERIC(20, 8)  NOT NULL DEFAULT 0,
    fees_paid         NUMERIC(20, 8)  NOT NULL DEFAULT 0,
    closed_at         TIMESTAMPTZ,
    exit_spread_pct   NUMERIC(12, 6),
    close_reason      VARCHAR(50),
    notes             TEXT
);

-- Ордера
CREATE TABLE IF NOT EXISTS orders (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id       UUID            REFERENCES positions(id),
    exchange          VARCHAR(20)     NOT NULL,
    exchange_order_id VARCHAR(100),
    symbol            VARCHAR(30)     NOT NULL,
    side              VARCHAR(10)     NOT NULL,
    order_type        VARCHAR(20)     NOT NULL,
    quantity          NUMERIC(24, 8),
    price             NUMERIC(24, 8),
    status            VARCHAR(20)     NOT NULL DEFAULT 'pending',
    filled_qty        NUMERIC(24, 8)  NOT NULL DEFAULT 0,
    avg_fill_price    NUMERIC(24, 8),
    fee               NUMERIC(20, 8),
    fee_currency      VARCHAR(10),
    raw_response      JSONB,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Конфиги алертов
CREATE TABLE IF NOT EXISTS alert_configs (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(100)    NOT NULL,
    engine_type       VARCHAR(20),
    symbol            VARCHAR(30),
    condition_type    VARCHAR(50)     NOT NULL,
    threshold         NUMERIC(20, 8),
    channel           VARCHAR(20)     NOT NULL DEFAULT 'telegram',
    channel_config    JSONB,
    cooldown_min      INT             NOT NULL DEFAULT 15,
    is_active         BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- История сработавших алертов
CREATE TABLE IF NOT EXISTS alert_events (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_config_id   UUID            REFERENCES alert_configs(id),
    triggered_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    symbol            VARCHAR(30),
    value             NUMERIC(20, 8),
    message           TEXT
);
