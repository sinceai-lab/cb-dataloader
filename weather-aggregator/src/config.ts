export const config = {
  port: Number(process.env.PORT ?? 3200),
  coraineUrl: process.env.CORAINE_URL ?? "http://localhost:1026",
  contextUrl: process.env.CONTEXT_URL ?? "http://context/user-context.jsonld",
  notifyUrl: process.env.NOTIFY_URL ?? "http://weather-aggregator:3200/notify",
  logFile: process.env.LOG_FILE ?? "logs/debug.log",
  subscriptionId: "urn:ngsi-ld:Subscription:weather-aggregator",
};
