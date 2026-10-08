function registerAttribution(app, pool) {
  app.post("/api/attribution", async (req, res) => {
    try {
      const { visitor_id, gclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_page, referrer, traffic_source } = req.body;
      const result = await pool.query(`
        INSERT INTO attributions (visitor_id,gclid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,landing_page,referrer,traffic_source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id, created_at
      `, [visitor_id || null,gclid || null,utm_source || null,utm_medium || null,utm_campaign || null,utm_term || null,utm_content || null,landing_page || null,referrer || null,traffic_source || null]);
      res.status(201).json({ success: true, attribution_id: result.rows[0].id, created_at: result.rows[0].created_at });
    } catch (error) {
      console.error("Attribution error:", error);
      res.status(500).json({ success: false, error: "Could not save attribution" });
    }
  });
}

module.exports = { registerAttribution };
