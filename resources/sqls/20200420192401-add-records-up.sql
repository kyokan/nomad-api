CREATE TABLE records (
    id              SERIAL PRIMARY KEY,
    tld             VARCHAR     NOT NULL,
    subdomain       VARCHAR     NOT NULL,
    public_key      VARCHAR     NOT NULL,
    import_height   bigint      NOT NULL,
    UNIQUE (tld)
);
