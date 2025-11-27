cd /root

# 1) کلون پروژه
git clone https://github.com/heydarlouam/code_backend_menumita.git

cd code_backend_menumita

# 2) دسترسی اجرا به اسکریپت
chmod +x setup_backend.sh

# 3) اجرای اسکریپت
./setup_backend.sh



2.1. چک کردن وضعیت Nginx
systemctl status nginx


اگر active (running) باشد ✔️

لاگ‌های Nginx:

# ارور
tail -n 100 /var/log/nginx/error.log

# درخواست‌ها
tail -n 100 /var/log/nginx/access.log

2.2. چک کردن وضعیت بک‌اند (PM2)

لیست پروسه‌ها:

pm2 list


جزئیات کامل:

pm2 show menumita-backend


لاگ‌ها:

pm2 logs menumita-backend
pm2 logs menumita-backend --lines 200


استاپ / استارت / ری‌استارت:

pm2 stop menumita-backend
pm2 restart menumita-backend
pm2 delete menumita-backend   # حذف از pm2

3️⃣ سوییچ بین development و production

در ecosystem.config.js این تنظیم هست:

env: {
  NODE_ENV: "development",
},
env_production: {
  NODE_ENV: "production",
},
env_file: ".env",


یعنی:

env → وقتی بدون --env استارت کنی → NODE_ENV=development

env_production → وقتی --env production بدی → NODE_ENV=production

3.1. رفتن به حالت development

(برای وقتی که می‌خوای از لوکال‌هات به سرور درخواست بزنی، CORS آزاد باشه)

cd /root/backend
pm2 restart menumita-backend --env development --update-env


الان CORS تو سرور:

برای Express و Socket.IO → هر Originی مجاز ✅

3.2. برگشت به حالت production

(برای وقتی که فقط دامین‌های اصلی خودت اجازه داشته باشن)

cd /root/backend
pm2 restart menumita-backend --env production --update-env


الان CORS فقط این‌ها رو قبول می‌کنه (با دامین خودت):

CORS_ORIGINS=https://<دامین>,https://www.<دامین>,https://admin.<دامین>,https://backend.<دامین>

3.3. چک کردن NODE_ENV فعلی
pm2 show menumita-backend | grep "node env"
