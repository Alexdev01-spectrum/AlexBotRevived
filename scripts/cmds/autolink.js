const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

module.exports = {
  config: {
    name: "alldl",
    version: "1.0",
    author: "Aminulsordar",
    role: 0,
    category: "Downloader",
    shortDescription: "Download YouTube, TikTok, Facebook & CapCut videos (Autolink style)",
    longDescription: "Detects YouTube, TikTok, Facebook, and CapCut links automatically and downloads the video.",
    guide: { en: "Send a video link or reply to a message with a supported link." }
  },

  onStart: async function({ api, event }) {
    // required by loader
  },

  onChat: async function({ api, event }) {
    const { threadID, messageID } = event;
    const text = (event.body || "").trim();
    const replyText = event.messageReply?.body?.trim() || "";
    const raw = text || replyText;
    const urlMatch = raw.match(/(https?:\/\/[^\s]+)/i);
    if (!urlMatch) return;

    const url = urlMatch[0];
    const send = (body, attachment) =>
      api.sendMessage(attachment ? { body, attachment } : { body }, threadID, messageID);

    let type = null;
    if (/youtube\.com|youtu\.be/i.test(url)) type = "youtube";
    else if (/tiktok\.com/i.test(url)) type = "tiktok";
    else if (/facebook\.com|fb\.watch/i.test(url)) type = "facebook";
    else if (/capcut\.com\/template-detail/i.test(url)) type = "capcut";
    else return;

    try { api.setMessageReaction("⏳", messageID, () => {}, true); } catch {}
    const MAX_BYTES = 150 * 1024 * 1024;
    let tempPath = null, thumbPath = null;

    const tmpDir = path.join(__dirname, "tmp");
    await fs.ensureDir(tmpDir);

    try {
      let API_URL = "";
      switch (type) {
        case "youtube": API_URL = `https://aminul-all-downloader.vercel.app/api/youtube/download?url=${encodeURIComponent(url)}`; break;
        case "tiktok": API_URL = `https://aminul-all-downloader.vercel.app/api/tiktok/download?url=${encodeURIComponent(url)}`; break;
        case "facebook": API_URL = `https://aminul-all-downloader.vercel.app//api/meta/download?url=${encodeURIComponent(url)}`; break;
        case "capcut": API_URL = `http://menu.panelaimbot.com:3010/api/capcut/download?url=${encodeURIComponent(url)}`; break;
      }

      const resp = await axios.get(API_URL, { timeout: 20000 }).catch(() => ({ data: null }));
      const body = resp.data;
      if (!body?.success || !body?.data) {
        try { api.setMessageReaction("⚠️", messageID, () => {}, true); } catch {}
        return send(`⚠️ ${type.toUpperCase()} ভিডিও পাওয়া যায়নি।`);
      }

      // Extract info per type
      let fileUrl, title, thumbnail, duration;
      if (type === "youtube") {
        const formats = body.data.formats || [];
        const selected = formats.find(f => f.type === "video_with_audio") ||
                         formats.find(f => f.type.includes("video")) || formats[0];
        fileUrl = selected?.url;
        title = body.data.title;
        thumbnail = body.data.thumbnail;
        duration = body.data.duration;
      } else if (type === "tiktok") {
        const data = body.data;
        const items = data.downloads || [];
        const item = items.find(it => it.text.toLowerCase().includes("mp4 hd")) || items[0];
        fileUrl = item?.url;
        title = data.title;
        thumbnail = data.thumbnail;
      } else if (type === "facebook") {
        const items = body.data.data || [];
        const item = items.find(it => it.resolution?.includes("720")) || items[0];
        fileUrl = item?.url || item?.download || item?.link;
        title = item?.title || "Facebook Video";
        thumbnail = item?.thumbnail;
      } else if (type === "capcut") {
        const data = body.data;
        const items = data.medias || [];
        const item = items.find(it => it.quality.toLowerCase().includes("hd no watermark")) ||
                     items.find(it => it.quality.toLowerCase().includes("no watermark")) ||
                     items[0];
        fileUrl = item?.url;
        title = data.title || "CapCut Template";
        thumbnail = data.thumbnail;
        duration = data.duration ? (data.duration / 1000).toFixed(1) + "s" : "";
      }

      if (!fileUrl) return send("❌ ডাউনলোড URL পাওয়া যায়নি।");

      // Download thumbnail
      if (thumbnail) {
        try {
          const tRes = await axios.get(thumbnail, { responseType: "arraybuffer", timeout: 10000 });
          thumbPath = path.join(tmpDir, `thumb_${Date.now()}.jpg`);
          await fs.writeFile(thumbPath, tRes.data);
        } catch { thumbPath = null; }
      }

      // File size check
      let contentLength = null;
      try {
        const head = await axios.head(fileUrl, { timeout: 10000 });
        if (head.headers?.["content-length"])
          contentLength = parseInt(head.headers["content-length"], 10);
      } catch {}

      if (contentLength && contentLength > MAX_BYTES) {
        const sizeMB = Math.round(contentLength / (1024*1024));
        const msg = `⚠️ ভিডিও সাইজ বড় (≈${sizeMB} MB)\nDirect link: ${fileUrl}`;
        if (thumbPath) await send(msg, fs.createReadStream(thumbPath));
        else await send(msg);
        if (thumbPath) fs.remove(thumbPath).catch(() => {});
        return;
      }

      // Download video
      const ext = path.extname(new URL(fileUrl).pathname) || ".mp4";
      tempPath = path.join(tmpDir, `${type}_${Date.now()}${ext}`);
      const writer = fs.createWriteStream(tempPath);
      const dlRes = await axios.get(fileUrl, { responseType: "stream", timeout: 120000 });
      dlRes.data.pipe(writer);
      await new Promise((res, rej) => { writer.on("finish", res); writer.on("error", rej); });

      const caption = `🎬 ${title || type.toUpperCase()} Video${duration ? `\n⏱️ Duration: ${duration}` : ""}\n📥 Sending video...`;

      if (thumbPath) await api.sendMessage({ body: caption, attachment: fs.createReadStream(thumbPath) }, threadID);
      await api.sendMessage({ body: caption, attachment: fs.createReadStream(tempPath) }, threadID, () => {
        fs.remove(tempPath).catch(() => {});
        if (thumbPath) fs.remove(thumbPath).catch(() => {});
      });

      try { api.setMessageReaction("✅", messageID, () => {}, true); } catch {}
    } catch (err) {
      console.error("alldl autolink error:", err);
      if (tempPath && fs.existsSync(tempPath)) fs.remove(tempPath).catch(() => {});
      if (thumbPath && fs.existsSync(thumbPath)) fs.remove(thumbPath).catch(() => {});
      try { api.setMessageReaction("❌", messageID, () => {}, true); } catch {}
      return send("❌ ডাউনলোডার API তে সমস্যা হয়েছে। পরে চেষ্টা করো।");
    }
  }
};
