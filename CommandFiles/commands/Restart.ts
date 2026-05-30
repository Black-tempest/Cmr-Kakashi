module.exports = {
  config: {
    name: "restart",
    author: "Ivdra Uchiwa",
    role: 2,
    category: "owner",
  },

  onStart: async function ({ message }) {
    await message.reply("🔄 Redémarrage du bot...");
    process.exit(1);
  },
};

