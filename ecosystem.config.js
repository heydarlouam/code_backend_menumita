module.exports = {
  apps: [{
    name: "menumita-backend",
    script: "./server.js",
    instances: 1,
    exec_mode: "fork",
    env_file: ".env",
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    time: true
  }]
}