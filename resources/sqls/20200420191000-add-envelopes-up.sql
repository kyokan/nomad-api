CREATE TABLE envelopes (
    id         SERIAL PRIMARY KEY,
    tld        VARCHAR     NOT NULL,
    subdomain  VARCHAR     NOT NULL,
    network_id VARCHAR,
    refhash    VARCHAR     NOT NULL,
    created_at bigint      NOT NULL,
    type       VARCHAR,
    subtype    VARCHAR,
    UNIQUE (tld, subdomain, refhash)
);
