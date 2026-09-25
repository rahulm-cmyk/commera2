const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const message = process.argv.slice(2).join(" ").trim();

if (!webhookUrl) {
  console.error("Missing DISCORD_WEBHOOK_URL.");
  process.exit(1);
}

if (!message) {
  console.error("Usage: npm run discord:send -- \"message\"");
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(webhookUrl);
} catch {
  console.error("DISCORD_WEBHOOK_URL is not a valid URL.");
  process.exit(1);
}

if (
  parsedUrl.protocol !== "https:" ||
  parsedUrl.hostname !== "discord.com" ||
  !parsedUrl.pathname.startsWith("/api/webhooks/")
) {
  console.error("DISCORD_WEBHOOK_URL must be a Discord webhook URL.");
  process.exit(1);
}

const response = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    content: message,
    allowed_mentions: { parse: [] },
  }),
});

if (!response.ok) {
  const responseText = await response.text();
  console.error(`Discord webhook failed with HTTP ${response.status}: ${responseText}`);
  process.exit(1);
}

console.log("Discord webhook message sent.");
