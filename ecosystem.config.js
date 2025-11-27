


// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "menumita-backend",
      script: "./server.js",

      // فقط یک اینستنس، چون WebSocket و Realtime داریم
      instances: 1,
      exec_mode: "fork",

      // همه‌ی متغیرها (PORT, PB_URL, PUBLIC_PB_URL, CORS_ORIGINS, …)
      // رو از این فایل می‌خونیم
      env_file: ".env",

      // حالت پیش‌فرض (وقتی --env نزنی) → توسعه
      env: {
        NODE_ENV: "development",
      },

      // حالت production (وقتی --env production بزنی)
      env_production: {
        NODE_ENV: "production",
      },

      // لاگ‌ها
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      time: true,

      // برای کرش کردن‌های پشت‌سرهم
      max_restarts: 10,
      restart_delay: 3000, // ۳ ثانیه مکث بین ری‌استارت‌ها
    },
  ],
};
