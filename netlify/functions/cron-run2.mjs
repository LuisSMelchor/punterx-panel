export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const site = process.env.URL || process.env.DEPLOY_PRIME_URL || "https://punterx-panel-vip.netlify.app";
  const auth = process.env.AUTH_CODE || "";
  const url  = `${site}/.netlify/functions/autopick-vip-run2?manual=1&debug=1`;

  const res  = await fetch(url, { headers: { "x-auth-code": auth } });
  const txt  = await res.text();
  console.log("[cron-run2] called run2", { status: res.status, bytes: txt.length });
};
