const crypto = require("crypto");

function verifyJobberWebhook(rawBody, hmacHeader) {
  if (!hmacHeader) {
    return false;
  }

  const digest = crypto
    .createHmac(
      "sha256",
      process.env.JOBBER_CLIENT_SECRET
    )
    .update(rawBody)
    .digest("base64");

  const expected = Buffer.from(digest);
  const received = Buffer.from(hmacHeader);

  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expected,
    received
  );
}

function registerJobberWebhook(app, pool) {
  app.post("/webhooks/jobber", async (req, res) => {
    const rawBody = req.body;
    const hmacHeader =
      req.get("X-Jobber-Hmac-SHA256");

    if (
      !Buffer.isBuffer(rawBody) ||
      !verifyJobberWebhook(rawBody, hmacHeader)
    ) {
      console.warn(
        "Rejected invalid Jobber webhook"
      );

      return res.status(401).json({
        success: false,
        error: "Invalid webhook signature"
      });
    }

    let payload;

    try {
      payload = JSON.parse(
        rawBody.toString("utf8")
      );
    } catch (error) {
      console.error(
        "Invalid Jobber webhook JSON:",
        error
      );

      return res.status(400).json({
        success: false,
        error: "Invalid JSON"
      });
    }

    const event =
      payload?.data?.webHookEvent;

    if (!event) {
      return res.status(400).json({
        success: false,
        error: "Missing webhook event"
      });
    }

    // Acknowledge Jobber immediately.
    res.status(200).json({
      success: true
    });

    // Process after acknowledging the webhook.
    try {
      await pool.query(
        `
        INSERT INTO jobber_webhook_events (
          topic,
          account_id,
          item_id,
          occurred_at,
          payload
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          event.topic || null,
          event.accountId || null,
          event.itemId || null,
          event.occurredAt || null,
          payload
        ]
      );

      console.log(
        "Jobber webhook received:",
        {
          topic: event.topic,
          accountId: event.accountId,
          itemId: event.itemId,
          occurredAt: event.occurredAt
        }
      );
    } catch (error) {
      console.error(
        "Jobber webhook processing error:",
        error
      );
    }
  });
}

module.exports = {
  registerJobberWebhook
};
