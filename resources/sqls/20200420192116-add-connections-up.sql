CREATE TABLE connections (
    id              SERIAL PRIMARY KEY,
    envelope_id     INTEGER NOT NULL REFERENCES envelopes(id),
    tld             VARCHAR NOT NULL,
    subdomain       VARCHAR,
    connection_type VARCHAR NOT NULL
);
