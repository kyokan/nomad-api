CREATE TABLE records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tld             VARCHAR     NOT NULL,
    subdomain       VARCHAR     NOT NULL,
    public_key      VARCHAR     NOT NULL,
    import_height   bigint      NOT NULL,
    UNIQUE (tld)
);

CREATE UNIQUE INDEX records_name
ON records(tld, subdomain);
