const { createLogger, format, transports } = require("winston");

const logger = createLogger({
  level: "info",
  format: format.json(),
  defaultMeta: { service: "user-service" },
  transports: [new transports.Console()],
});
module.exports = logger;
