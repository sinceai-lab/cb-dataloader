import { config } from "./config.js";
import { debug } from "./log.js";

const headers = {
  "Content-Type": "application/json",
  Link: `<${config.contextUrl}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`,
};
const url = `${config.coraineUrl}/ngsi-ld/v1/subscriptions`;

// Recreated on every start so the notification URL always matches this run.
export async function subscribe() {
  for (;;) {
    try {
      await fetch(`${url}/${encodeURIComponent(config.subscriptionId)}`, {
        method: "DELETE",
        headers,
      });
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: config.subscriptionId,
          type: "Subscription",
          entities: [{ type: "WeatherObserved" }],
          notification: {
            format: "normalized",
            endpoint: { uri: config.notifyUrl, accept: "application/json" },
          },
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      debug("subscription created", {
        id: config.subscriptionId,
        notifyUrl: config.notifyUrl,
      });
      return;
    } catch (err) {
      debug(`subscription failed, retrying in 5s: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
