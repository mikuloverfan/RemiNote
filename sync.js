const fs = require("fs");

// ⚠️ 改成你的 Obsidian 插件路径
const target =
  "D:/obdisian仓库/橘子笔记/.obsidian/plugins/RemiNote/";

function copy(file) {
  fs.copyFileSync(file, target + file.split("/").pop());
  console.log("copied:", file);
}

// 编译后的文件（所有模型已内嵌在 main.js 中，无需额外二进制文件）
copy("dist/main.js");

// 静态文件
copy("manifest.json");
copy("styles.css");

console.log("✅ sync done");

