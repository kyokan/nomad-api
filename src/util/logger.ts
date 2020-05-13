// @ts-ignore
import winston from "winston";
const loggerPath = process.env.LOGGER_PATH;

const transports = [];

if (loggerPath) {
  transports.push(new winston.transports.File({
    filename: `${loggerPath}/error.log`,
    level: 'error',
    maxsize: 2e+6,
    maxFiles: 1,
  }));

  transports.push(new winston.transports.File({
    filename: `${loggerPath}/combined.log`,
    maxsize: 2e+6,
    maxFiles: 1,
  }));
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'nomad-ui.indexer-api' },
  transports: transports,
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

export default logger;
