const JOBBER_API = "https://api.getjobber.com/api/graphql";
const JOBBER_GRAPHQL_VERSION = "2025-04-16";

function registerJobberConnection(app, getJobberAccessToken) {
  app.get("/jobber/test", async (req, res) => {
    try {
      const accessToken = await getJobberAccessToken();

      const response = await fetch(JOBBER_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-JOBBER-GRAPHQL-VERSION": JOBBER_GRAPHQL_VERSION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: `
            query GetAccount {
              account {
                id
                name
              }
            }
          `
        })
      });

      const data = await response.json();

      if (!response.ok || data.errors) {
        console.error("Jobber API test failed:", data);

        return res.status(500).json({
          success: false,
          error: data.errors || data
        });
      }

      res.json({
        success: true,
        jobber_account: data.data.account
      });
    } catch (error) {
      console.error("Jobber test error:", error);

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
}

module.exports = {
  registerJobberConnection
};
