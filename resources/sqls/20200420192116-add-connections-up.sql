CREATE TABLE connections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    envelope_id     INTEGER NOT NULL REFERENCES envelopes(id),
    tld             VARCHAR NOT NULL,
    subdomain       VARCHAR,
    connection_type VARCHAR NOT NULL
);

CREATE INDEX connections_type
ON connections(connection_type);

CREATE INDEX connections_name
ON connections(tld, subdomain);
