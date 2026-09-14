module.exports = {
  apps: [
    {
      name: "doochyweb",
      cwd: "/home/san/doochyweb",
      script: "dist/server/index.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
  ],
};