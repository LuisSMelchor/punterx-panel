export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const site = process.env.URL || process.env.DEPLOY_URL || "https://punterx-panel-vip.netlify.app";
  const auth = process.env.AUTH_CODE || "";
  const url  = `${site}/.netlify/functions/autopick-vip-run2?manual=1&debug=1`;

  const res  = await fetch(url, { headers: { "x-auth-code": auth } });
  const text = await res.text();
  try {
    console.log("[cron-run2] status", res.status, "json", JSON.stringify(JSON.parse(text)));
  } catch {
    console.log("[cron-run2] status", res.status, "body", text.slice(0,300));
  }
};
