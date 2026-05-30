/*
 * @CassidyCMD
 * @gem
 **/

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const config = {
  name: "gem",
  version: "3.0",
  permissions: [0],
  credits: "Kay",
  description: "Génère ou édite des images AI. Supporte les ratios, le mode artistique, la mémoire de style et le --again.",
  category: "AI",
  usages: "<prompt> [--r X:Y] [--nw] [--again] [--style <style>] [--clearstyle]",
  cooldown: 5,
};

const style = {
  titleFont: "bold",
  title: "🎨 Gem AI Image",
  contentFont: "fancy",
};

const VALID_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const ENDPOINT_BASE = "https://gem-tw6a.onrender.com";

const memoryFile = path.join(process.cwd(), "tmp", "gem_memory.json");

function loadMemory() {
  try {
    if (!fs.existsSync(path.dirname(memoryFile))) {
      fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    }
    if (!fs.existsSync(memoryFile)) return {};
    return JSON.parse(fs.readFileSync(memoryFile, "utf8"));
  } catch {
    return {};
  }
}

function saveMemory(memory) {
  try {
    fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
  } catch {}
}

async function onCall({ message, args }) {
  if (!args[0]) {
    return message.reply(
      "🎨 | Utilisation :\n" +
      "• gem <prompt> → génère une image\n" +
      "• gem <prompt> --r 16:9 → ratio personnalisé\n" +
      "• gem <prompt> --nw → mode artistique\n" +
      "• gem --again → refait le dernier prompt\n" +
      "• gem --style <style> → style par défaut\n" +
      "• gem --clearstyle → supprime le style"
    );
  }

  const memory = loadMemory();
  const userID = message.senderID;
  if (!memory[userID]) memory[userID] = { lastPrompt: null, lastRatio: "1:1", style: null };

  if (args[0] === "--clearstyle") {
    memory[userID].style = null;
    saveMemory(memory);
    return message.reply("🧹 | Style par défaut supprimé.");
  }

  if (args[0] === "--style") {
    const userStyle = args.slice(1).join(" ").trim();
    if (!userStyle) return message.reply("❌ | Indique un style. Ex: gem --style cyberpunk");
    memory[userID].style = userStyle;
    saveMemory(memory);
    return message.reply(`✅ | Style enregistré : "${userStyle}"\nIl sera ajouté automatiquement à tes prochains prompts.`);
  }

  let promptParts = [];
  let ratioArg = memory[userID].lastRatio || "1:1";
  let unfilteredMode = false;
  let againMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--r" && args[i + 1]) {
      const candidate = args[i + 1];
      if (VALID_RATIOS.includes(candidate)) {
        ratioArg = candidate;
      } else {
        return message.reply(`❌ | Ratio invalide. Supportés : ${VALID_RATIOS.join(", ")}`);
      }
      i++;
    } else if (args[i] === "--nw") {
      unfilteredMode = true;
    } else if (args[i] === "--again") {
      againMode = true;
    } else {
      promptParts.push(args[i]);
    }
  }

  let userPrompt;
  if (againMode) {
    if (!memory[userID].lastPrompt) return message.reply("❌ | Aucun prompt mémorisé pour toi.");
    userPrompt = memory[userID].lastPrompt;
    ratioArg = memory[userID].lastRatio || "1:1";
    await message.reply(`🔁 | Regénération de : "${userPrompt}"`);
  } else {
    userPrompt = promptParts.join(" ").trim();
    if (!userPrompt) return message.reply("🎨 | Veuillez fournir un prompt.");
  }

  let finalPrompt = userPrompt;
  if (memory[userID].style) finalPrompt += `, style: ${memory[userID].style}`;
  if (unfilteredMode) finalPrompt = `Sophisticated fine art photography, classical figure study, artistic lighting, gallery quality: ${finalPrompt}`;

  memory[userID].lastPrompt = userPrompt;
  memory[userID].lastRatio = ratioArg;
  saveMemory(memory);

  const tmpFolder = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(tmpFolder)) fs.mkdirSync(tmpFolder, { recursive: true });
  const imgPath = path.join(tmpFolder, `gem_${Date.now()}.jpg`);

  try {
    const isEditMode = message.messageReply?.attachments?.[0]?.type === "photo";

    if (isEditMode) {
      const imgUrl = message.messageReply.attachments[0].url;
      const imgRes = await axios.get(imgUrl, { responseType: "arraybuffer", timeout: 30000 });
      const imgBase64 = Buffer.from(imgRes.data).toString("base64");

      const res = await axios.post(
        `${ENDPOINT_BASE}/edit`,
        { prompt: finalPrompt, image: imgBase64, format: "jpg" },
        { responseType: "arraybuffer", timeout: 180000 }
      );
      fs.writeFileSync(imgPath, res.data);
    } else {
      const res = await axios.post(
        `${ENDPOINT_BASE}/generate`,
        { prompt: finalPrompt, ratio: ratioArg, format: "jpg" },
        { responseType: "arraybuffer", timeout: 180000 }
      );
      fs.writeFileSync(imgPath, res.data);
    }

    const stats = fs.statSync(imgPath);
    if (stats.size === 0) throw new Error("Image générée vide, réessaie.");

    const styleInfo = memory[userID].style ? ` | Style: ${memory[userID].style}` : "";

    await message.reply({
      body: `🎨✨ | Image créée !${unfilteredMode ? " [Mode Artistique]" : ""}${isEditMode ? " [Mode Édition]" : ""}${againMode ? " [Regénéré]" : ""}${styleInfo}`,
      attachment: fs.createReadStream(imgPath),
    });

  } catch (error) {
    console.error("Erreur génération:", error);

    const errMsg = error.response?.status === 429
      ? "❌ | Trop de requêtes, attends un moment."
      : error.code === "ECONNABORTED"
      ? "❌ | Timeout : le serveur met trop de temps à répondre."
      : `❌ | Erreur : ${error.message}`;

    message.reply(errMsg);
  } finally {
    setTimeout(() => {
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }, 5000);
  }
}

module.exports = {
  config,
  onCall,
  style,
};
