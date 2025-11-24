// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'menumita-backend',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false
  }]
};