const fs = require("fs");
const path = require("path");
const axios = require("axios");

module.exports = {
  config: {
    name: "gem",
    author: "Kay",
    version: "3.0",
    cooldowns: 5,
    role: 0,
    shortDescription: "Génère des images artistiques via AI",
    longDescription: "Génère ou édite des images AI. Utilise --nw pour le mode artistique. Supporte les ratios 16:9, 9:16, 1:1, etc.",
    category: "𝗔𝗜",
    guide: "{pn} <prompt> [--r X:Y] [--nw] [--again] [--style <style>] [--clearstyle]"
  },

  onStart: async function ({ message, args, api, event }) {
    if (!args[0]) return message.reply(
      "🎨 | Utilisation :\n" +
      "• gem <prompt> → génère une image\n" +
      "• gem <prompt> --r 16:9 → ratio personnalisé\n" +
      "• gem <prompt> --nw → mode artistique\n" +
      "• gem --again → refait le dernier prompt\n" +
      "• gem --style <style> → applique un style par défaut\n" +
      "• gem --clearstyle → supprime le style par défaut"
    );

    const cacheFolder = path.join(__dirname, "tmp");
    const memoryFile = path.join(__dirname, "tmp", "gem_memory.json");

    if (!fs.existsSync(cacheFolder)) fs.mkdirSync(cacheFolder, { recursive: true });

    // Charger la mémoire
    let memory = {};
    if (fs.existsSync(memoryFile)) {
      try { memory = JSON.parse(fs.readFileSync(memoryFile, "utf8")); } catch { memory = {}; }
    }

    const userID = event.senderID;
    if (!memory[userID]) memory[userID] = { lastPrompt: null, lastRatio: "1:1", style: null };

    const saveMemory = () => fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));

    const VALID_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
    const ENDPOINT_BASE = "https://gem-tw6a.onrender.com";

    // Commande --clearstyle
    if (args[0] === "--clearstyle") {
      memory[userID].style = null;
      saveMemory();
      return message.reply("🧹 | Style par défaut supprimé.");
    }

    // Commande --style <style>
    if (args[0] === "--style") {
      const style = args.slice(1).join(" ").trim();
      if (!style) return message.reply("❌ | Indique un style. Ex: gem --style cyberpunk");
      memory[userID].style = style;
      saveMemory();
      return message.reply(`✅ | Style par défaut enregistré : "${style}"\nIl sera automatiquement ajouté à tes prochains prompts.`);
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
          return message.reply(`❌ | Ratio invalide. Ratios supportés : ${VALID_RATIOS.join(", ")}`);
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

    // Mode --again : réutilise le dernier prompt
    let userPrompt;
    if (againMode) {
      if (!memory[userID].lastPrompt) return message.reply("❌ | Aucun prompt mémorisé pour toi.");
      userPrompt = memory[userID].lastPrompt;
      ratioArg = memory[userID].lastRatio || "1:1";
      message.reply(`🔁 | Regénération de : "${userPrompt}"`);
    } else {
      userPrompt = promptParts.join(" ").trim();
      if (!userPrompt) return message.reply("🎨 | Veuillez fournir un prompt.");
    }

    // Appliquer le style mémorisé si présent
    let finalPrompt = userPrompt;
    if (memory[userID].style) {
      finalPrompt = `${userPrompt}, style: ${memory[userID].style}`;
    }
    if (unfilteredMode) {
      finalPrompt = `Sophisticated fine art photography, classical figure study, artistic lighting, gallery quality: ${finalPrompt}`;
    }

    // Sauvegarder le prompt et le ratio dans la mémoire
    memory[userID].lastPrompt = userPrompt;
    memory[userID].lastRatio = ratioArg;
    saveMemory();

    api.setMessageReaction("🎨", event.messageID, () => {}, true);

    const imgPath = path.join(cacheFolder, `gem_${Date.now()}.jpg`);

    try {
      const isEditMode = event.messageReply?.attachments?.[0]?.type === "photo";

      if (isEditMode) {
        const imgUrl = event.messageReply.attachments[0].url;
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

      api.setMessageReaction("✅", event.messageID, () => {}, true);

      const styleInfo = memory[userID].style ? ` | Style: ${memory[userID].style}` : "";

      await message.reply({
        body: `🎨✨ | Image créée !${unfilteredMode ? " [Mode Artistique]" : ""}${isEditMode ? " [Mode Édition]" : ""}${againMode ? " [Regénéré]" : ""}${styleInfo}`,
        attachment: fs.createReadStream(imgPath)
      });

    } catch (error) {
      api.setMessageReaction("❌", event.messageID, () => {}, true);
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
};
