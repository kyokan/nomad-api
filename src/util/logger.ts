// @ts-ignore
import winston from "winston";

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'nomad-ui.indexer-api' },
  transports: [
    //
    // - Write all logs with level `error` and below to `error.log`
    // - Write all logs with level `info` and below to `combined.log`
    //
    new winston.transports.File({
      filename: `./build/error.log`,
      level: 'error',
      maxsize: 2e+6,
      maxFiles: 1,
    }),

    new winston.transports.File({
      filename: `./build/combined.log`,
      maxsize: 2e+6,
      maxFiles: 1,
    })
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

export default logger;
