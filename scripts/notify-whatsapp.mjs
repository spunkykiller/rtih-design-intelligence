import fs from "node:fs/promises";

const event = process.argv[2] ?? "update";
const message = process.argv.slice(3).join(" ").trim() || "RTIH design intelligence update.";

const endpoint = process.env.WHATSAPP_WEBHOOK_URL;
const token = process.env.WHATSAPP_WEBHOOK_TOKEN;
const recipient = process.env.WHATSAPP_TO;

const payload = {
  event,
  message,
  recipient,
  repository: "spunkykiller/rtih-design-intelligence",
  timestamp: new Date().toISOString(),
};

async function appendLocalLog(status, detail) {
  await fs.mkdir("research/logs", { recursive: true });
  await fs.appendFile(
    "research/logs/whatsapp-notifications.jsonl",
    JSON.stringify({ ...payload, status, detail }) + "\n",
  );
}

if (!endpoint || !recipient) {
  await appendLocalLog("not_sent", "Missing WHATSAPP_WEBHOOK_URL or WHATSAPP_TO.");
  console.log("WhatsApp notification not sent: missing WHATSAPP_WEBHOOK_URL or WHATSAPP_TO.");
  process.exit(0);
}

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const response = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const body = await response.text().catch(() => "");
  await appendLocalLog("failed", `${response.status} ${body.slice(0, 300)}`);
  throw new Error(`WhatsApp webhook failed with ${response.status}`);
}

await appendLocalLog("sent", "Webhook accepted.");
console.log("WhatsApp notification sent.");
