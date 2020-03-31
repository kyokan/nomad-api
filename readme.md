## Getting Started

**Nomad API** provides a RESTful interface for developers to query social contents from Nomad, a peer-to-peer, ownerless social network built on top of [Handshake](https://handshake.org/) and [DDRP](https://ddrp.network/).

## Install

`nomad-api` requires Node.js v11.14 or higher

## Step 1: Build from Repository

```
git clone https://github.com/kyokan/nomad-api.git
cd nomad-api
npm install
```

## Step 2: config.json

`nomad-api` uses `./config.json` as base configuration for DDRP. You can find the sample config at `./config.sample.json`.

**Copy default configuration**
```
cp ./config.sample.json ./config.json
```

## Step 3: Run HSD locally (if necessary)

If you are using a hosted Handshake RPC Host, you can skip this step.

**Run HSD locally**

```
npm install -g hsd
hsd --index-tx
```

*Please refer to [hsd](https://github.com/handshake-org/hsd) for more detail*

## Step 4: Run Nomad API

**Running in production**
`SERVICE_KEY` enables the `/services` endpoints for privileged remote access.
```
SERVICE_KEY=secret-key npm start
```

**Running in development**
```
npm run dev
// navigate to http://localhost:8082/dev for quick API samples
```






