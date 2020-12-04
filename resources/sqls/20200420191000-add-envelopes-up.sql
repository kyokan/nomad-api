CREATE TABLE envelopes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tld        VARCHAR     NOT NULL,
    subdomain  VARCHAR     NOT NULL,
    network_id VARCHAR,
    refhash    VARCHAR     NOT NULL,
    created_at bigint      NOT NULL,
    type       VARCHAR,
    subtype    VARCHAR,
    UNIQUE (tld, subdomain, refhash)
);

CREATE UNIQUE INDEX envelopes_tld_subdomain_refhash_key
ON envelopes(tld, subdomain, refhash);
