import "dotenv/config";

const API_BASE_URL = "https://api.twitch.tv/helix";

let rateLimitRemaining = null;
let rateLimitResetAfter = null;
let sendRetries = 0;
let editRetries = 0;

// https://discord.com/developers/docs/resources/webhook#execute-webhook
async function webhookSend(options) {
  let res = await fetch(`${process.env.DISCORD_WEBHOOK_URL}?wait=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options),
  });
  const json =
    res.headers.get("content-type") &&
    res.headers.get("content-type").startsWith("application/json");
  rateLimitRemaining = Number(res.headers.get("x-ratelimit-remaining"));
  rateLimitResetAfter = Number(res.headers.get("x-ratelimit-reset-after"));
  if (rateLimitRemaining > 0 && res.ok) {
    if (json) return await res.json();
    return await res.buffer();
  }
  if (sendRetries > 2) {
    // Retry Count exceeded
    sendRetries = 0;
    return null;
  }
  await new Promise((resolve) =>
    setTimeout(resolve, (rateLimitResetAfter + 1) /*Safety precaution*/ * 1000),
  );
  sendRetries++;
  return webhookSend(options);
}

// https://discord.com/developers/docs/resources/webhook#edit-webhook-message
async function webhookEdit(msgId, options) {
  let res = await fetch(
    `${process.env.DISCORD_WEBHOOK_URL}/messages/${msgId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    },
  );
  const json =
    res.headers.get("content-type") &&
    res.headers.get("content-type").startsWith("application/json");
  rateLimitRemaining = Number(res.headers.get("x-ratelimit-remaining"));
  rateLimitResetAfter = Number(res.headers.get("x-ratelimit-reset-after"));
  if (rateLimitRemaining > 0 && res.ok) {
    if (json) return await res.json();
    return await res.buffer();
  }
  if (editRetries > 2) {
    // Retry Count exceeded
    editRetries = 0;
    return null;
  }
  await new Promise((resolve) =>
    setTimeout(resolve, (rateLimitResetAfter + 1) /*Safety precaution*/ * 1000),
  );
  editRetries++;
  return webhookEdit(msgId, options);
}

async function getToken() {
  return await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    {
      method: "POST",
    },
  ).then(async (res) => {
    let result = await res.json();
    result.expires_at = new Date(Date.now() + result.expires_in * 1000);
    return result;
  });
}

let token = await getToken();
const broadcaster = await fetch(
  `${API_BASE_URL}/users?login=${process.env.BROADCASTER_LOGIN}`,
  {
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token.access_token}`,
    },
  },
).then((res) => res.json());
if (!broadcaster.data) {
  console.error(
    `Error retrieving broadcaster info. Response from Twitch: ${JSON.stringify(
      broadcaster,
    )}`,
  );
  //process.exit(77); // EX_NOPERM
  process.exit(78); // EX_CONFIG
}
const broadcasterId = broadcaster.data[0].id;
const broadcasterDisplayName = broadcaster.data[0].display_name;
let alreadyPostedIds = [];
let messageClipMapping = {};
console.log(
  "Running setInterval - Clips should now be checked every 5 minutes",
);
setInterval(async () => {
  try {
    if (token.expires_at < new Date()) token = await getToken();
    let date = new Date(Math.floor(Date.now() / 1000) * 1000 - 5 * 60000);
    let clips = await fetch(
      `${API_BASE_URL}/clips?broadcaster_id=${broadcasterId}&first=100&started_at=${date.toISOString()}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token.access_token}`,
        },
      },
    ).then((res) => {
      //console.log(Date.now());
      //console.log(`Limit: ${res.headers.get('ratelimit-limit')}; Remaining: ${res.headers.get('ratelimit-remaining')}; Reset: ${res.headers.get('ratelimit-reset')}`);
      return res.json();
    });
    clips = clips.data;
    let creatorIds = [];
    let videoIds = [];
    if (clips.length < 1) return; // No clips to post
    console.log(`${date.toISOString()} - ${JSON.stringify(clips)}`);
    for (let i = 0; i < clips.length; i++) {
      creatorIds.push(clips[i].creator_id);
      if (clips[i].video_id.length > 0) {
        videoIds.push(clips[i].video_id);
      }
    }
    creatorIds = [...new Set(creatorIds)]; // Remove duplicate entries
    let usersQuery;
    let profileImageUrls = [];
    if (creatorIds.length > 0 && creatorIds.length <= 100) {
      usersQuery = "?id=" + creatorIds.join("&id=");
      profileImageUrls = (
        await fetch(`${API_BASE_URL}/users${usersQuery}`, {
          headers: {
            "Client-ID": process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token.access_token}`,
          },
        }).then((res) => res.json())
      ).data.map((x) => {
        return {
          id: x.id,
          profileImageUrl: x.profile_image_url,
        };
      });
    } else if (creatorIds.length > 100) {
      console.error("More than 100 users to look up");
    }
    let videosQuery;
    let videoTitles = [];
    if (videoIds.length > 0 && videoIds.length <= 100) {
      videosQuery = "?id=" + videoIds.join("&id=");
      videoTitles = (
        await fetch(`${API_BASE_URL}/videos${videosQuery}`, {
          headers: {
            "Client-ID": process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token.access_token}`,
          },
        })
          .then((res) => res.json())
          .catch((err) => console.error(err))
      ).data.map((x) => {
        return {
          id: x.id,
          title: x.title,
        };
      });
    } else if (videoIds.length > 100) {
      console.error("More than 100 videos to look up");
    }
    for (let i = 0; i < clips.length; i++) {
      if (process.env.SUPPRESS_UNTITLED == "true") {
        let video = videoTitles.find((x) => x.id == clips[i].video_id);
        if (video && video.title == clips[i].title) continue;
      }
      let content = `\`\`${clips[i].title.trim()}\`\`: ${clips[i].url}`;
      if (process.env.SHOW_CREATED_DATE == "true") {
        let time = new Date(clips[i].created_at).getTime() / 1000;
        content += ` (Created at: <t:${time}:F> - <t:${time}:R>)`;
      }
      if (alreadyPostedIds.includes(clips[i].id)) {
        // Don't post clips that were already posted. Edit them, because the Clip will get returned even if no title was set yet.
        if (clips[i].id in messageClipMapping) {
          if (messageClipMapping[clips[i].id].content != content) {
            let editedMessage = await webhookEdit(
              messageClipMapping[clips[i].id].id,
              {
                content,
              },
            );
            messageClipMapping[clips[i].id] = editedMessage;
          }
        }
        continue;
      }
      let webhookMessage = await webhookSend({
        username: clips[i].creator_name.trim(),
        avatar_url: profileImageUrls.find((x) => x.id == clips[i].creator_id)
          ?.profileImageUrl,
        content,
      }).catch((err) => console.error);
      alreadyPostedIds.push(clips[i].id);
      messageClipMapping[clips[i].id] = webhookMessage;
    }
  } catch (err) {
    // console.log(err.stack); // Don't exit on unhandled errors! Just print trace!
    console.trace(err); // Don't exit on unhandled errors! Just print trace!
  }
}, 5 * 60000);
