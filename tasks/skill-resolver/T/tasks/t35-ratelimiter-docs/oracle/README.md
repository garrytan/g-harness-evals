# relay-gateway

HTTP gateway in front of the relay workers.

## Running

```
npm ci
npm start
```

Configuration lives in `config/gateway.yaml`.

## Documentation

- [Rate limiter reference](docs/reference-rate-limiter.md): API, options and defaults
- [Why the rate limiter works this way](docs/explanation-rate-limiter.md): design and trade-offs
