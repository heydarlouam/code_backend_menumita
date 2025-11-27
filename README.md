# Menumita Backend – Auto Setup

این رپو شامل بک‌اند منومیتا + اسکریپت نصب خودکار روی سرور است.

---

## 0) پیش‌نیازها

قبل از اجرای اسکریپت:

- سرور Ubuntu (مثل 20.04 / 22.04)
- دسترسی `root` (یا اجرای دستورات با `sudo`)
- دامین اصلی (مثال: `frozencoffee.ir`)
- تنظیم رکورد DNS برای:
  - `backend.<دامین>` → آی‌پی سرور بک‌اند
  - (ترجیحاً) `pb.<دامین>` → آی‌پی سرور PocketBase

> مثال: برای `frozencoffee.ir` باید `backend.frozencoffee.ir` و `pb.frozencoffee.ir` در Cloudflare یا DNSت ساخته شده باشند.

---

## 1) کلون پروژه

روی سرور:

```bash
cd /root

git clone https://github.com/heydarlouam/code_backend_menumita.git

cd code_backend_menumita






2) اجرای اسکریپت نصب بک‌اند
2.1. دسترسی اجرا به اسکریپت
chmod +x setup_backend.sh

2.2. اجرای اسکریپت
./setup_backend.sh


در حین اجرا:

از شما دامنه اصلی را می‌پرسد، مثلاً:

frozencoffee.ir


بر اساس آن، این مقدارها را می‌سازد:

بک‌اند:
backend.<دامین> → مثال: backend.frozencoffee.ir

آدرس پابلیک PocketBase:
pb.<دامین> → مثال: pb.frozencoffee.ir

.env و server.js و Nginx را بر اساس همین دامین تنظیم می‌کند.

2.3. اسکریپت دقیقاً چه کارهایی انجام می‌دهد؟

به ترتیب این کارها انجام می‌شود:

1️⃣ نصب / آپدیت پکیج‌های ضروری

nginx

nodejs (نسخه ۱۸ اگر نصب نباشد)

npm

pm2 (گلوبال)

certbot + پلاگین python3-certbot-nginx

2️⃣ ساخت / خالی کردن پوشه‌ی بک‌اند

مسیر نهایی پروژه روی سرور:

/root/backend


اگر /root/backend وجود داشته باشد و خالی نباشد:

ازت می‌پرسد که آیا پاک شود یا نه.

اگر تأیید کنی، پوشه خالی می‌شود و سورس جدید کپی خواهد شد.

3️⃣ کپی سورس‌کد پروژه به /root/backend

محتویات همین رپو (که در /root/code_backend_menumita کلون شده) را به /root/backend منتقل می‌کند.

پوشه‌هایی مثل .git و node_modules دوباره‌سازی می‌شوند (npm install دوباره انجام می‌شود).

4️⃣ حذف رپوی کلون‌شده (برای خالی کردن فضا)

بعد از اتمام کپی، دایرکتوری اولیه‌ی پروژه مثلاً:

/root/code_backend_menumita


حذف می‌شود.

از این به بعد، سورس اصلی فقط در /root/backend نگه‌داری می‌شود.

5️⃣ نصب وابستگی‌های Node.js

داخل /root/backend:

cd /root/backend
npm install


(این مرحله را اسکریپت خودش انجام می‌دهد.)

6️⃣ چک و آپدیت فایل .env

فرض بر این است که .env از رپو همراه پروژه آمده و وجود دارد.

اسکریپت:

فایل .env را باز می‌کند.

فقط مقادیر زیر را (در صورت نیاز) آپدیت می‌کند:

PUBLIC_PB_URL

CORS_ORIGINS

شکل نهایی (با فرض دامین frozencoffee.ir):

PORT=5050

PB_URL=http://127.0.0.1:8090
PUBLIC_PB_URL=https://pb.frozencoffee.ir

UPLOAD_DIR=./uploads

CORS_ORIGINS=https://frozencoffee.ir,https://www.frozencoffee.ir,https://admin.frozencoffee.ir,https://backend.frozencoffee.ir


اگر دامین دیگری وارد کنی، این خط‌ها با آن دامین ست می‌شوند:

PUBLIC_PB_URL=https://pb.<دامین>

CORS_ORIGINS=https://<دامین>,https://www.<دامین>,https://admin.<دامین>,https://backend.<دامین>


نکته:

اسکریپت دیگر .env.bak نمی‌سازد تا فایل اضافه تولید نشود.

فقط همان .env موجود را ویرایش می‌کند.

7️⃣ به‌روزرسانی مقادیر مربوط به PUBLIC_PB_URL در server.js

داخل server.js:

const PUBLIC_PB_URL = process.env.PUBLIC_PB_URL || 'https://pb.frozencoffee.ir';


اسکریپت مقدار fallback را بر اساس دامین واردشده اصلاح می‌کند:

const PUBLIC_PB_URL = process.env.PUBLIC_PB_URL || 'https://pb.<دامین>';


همچنین پیام نمونه‌ی CORS در حالت خطا را هم با دامین جدید هماهنگ می‌کند، مثلاً:

console.error('CORS_ORIGINS=https://frozencoffee.ir,https://www.frozencoffee.ir,https://admin.frozencoffee.ir,https://backend.frozencoffee.ir');


→ تبدیل می‌شود به:

CORS_ORIGINS=https://<دامین>,https://www.<دامین>,https://admin.<دامین>,https://backend.<دامین>


8️⃣ تنظیم کانفیگ Nginx برای بک‌اند

اسکریپت یک فایل کانفیگ شبیه این می‌سازد (مثال: /etc/nginx/sites-available/backend.conf):

server {
    listen 80;
    server_name backend.<دامین>;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name backend.<دامین>;

    ssl_certificate     /etc/letsencrypt/live/backend.<دامین>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/backend.<دامین>/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    location /socket.io/ {
        proxy_pass http://localhost:5050;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 86400s;
    }

    location /api/ {
        proxy_pass http://localhost:5050;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://localhost:5050;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}


و سپس لینک‌سیمبل می‌سازد در:

/etc/nginx/sites-enabled/backend.conf


9️⃣ تست و ری‌لود Nginx

اسکریپت خودش اجرا می‌کند:

nginx -t
systemctl reload nginx


🔟 گرفتن SSL از Let’s Encrypt (Certbot)

ایمیل استفاده‌شده برای certbot:

phone.sync.heydarloo@gmail.com


دامنه:

backend.<دامین>


ریدایرکت خودکار HTTP → HTTPS فعال می‌شود.

1️⃣1️⃣ استارت بک‌اند با PM2 در حالت production

داخل /root/backend:

اگر قبلاً پروسه‌ی menumita-backend وجود داشته باشد:

pm2 restart menumita-backend --env production --update-env


اگر اولین‌بار است:

pm2 start ecosystem.config.js --env production --name menumita-backend
pm2 save

2.4. نتیجه‌ی نهایی

بعد از اجرای موفق اسکریپت:

بک‌اند از این URL بالا می‌آید:

https://backend.<دامین>


API:

https://backend.<دامین>/api/...


سورس کد نهایی روی سرور در این مسیر است:

/root/backend


رپوی اولیه‌ی کلون‌شده (/root/code_backend_menumita) حذف شده است.

3) چک کردن وضعیت Nginx

وضعیت سرویس:

systemctl status nginx


اگر active (running) بود → اوکی ✅

3.1. لاگ‌های Nginx

ارورها:

tail -n 100 /var/log/nginx/error.log


ریکوئست‌ها:

tail -n 100 /var/log/nginx/access.log

4) چک کردن وضعیت بک‌اند (PM2)
4.1. لیست پروسه‌ها
pm2 list

4.2. جزئیات کامل پروسه
pm2 show menumita-backend

4.3. لاگ‌ها
pm2 logs menumita-backend
# یا:
pm2 logs menumita-backend --lines 200

4.4. استاپ / استارت / ری‌استارت / حذف از PM2
pm2 stop menumita-backend
pm2 restart menumita-backend
pm2 delete menumita-backend   # حذف کامل از PM2

5) سوییچ بین development و production

در ecosystem.config.js این تنظیم‌ها هستند:

env: {
  NODE_ENV: "development",
},
env_production: {
  NODE_ENV: "production",
},
env_file: ".env",


یعنی:

env → وقتی بدون --env استارت کنی → NODE_ENV=development

env_production → وقتی با --env production استارت کنی → NODE_ENV=production

5.1. رفتن به حالت development

(وقتی می‌خوای از لوکال، Postman، یا فرانت محلی به سرور بزنی و CORS آزاد باشه)

cd /root/backend
pm2 restart menumita-backend --env development --update-env


در این حالت (development):

CORS داخل Express و Socket.IO برای هر Origin آزاد است ✅

5.2. برگشت به حالت production

(وقتی می‌خوای فقط دامین‌های اصلی خودت اجازه داشته باشند)

cd /root/backend
pm2 restart menumita-backend --env production --update-env


در این حالت (production):

فقط دامین‌هایی که در .env ست شده‌اند اجازه دارند:

CORS_ORIGINS=https://<دامین>,https://www.<دامین>,https://admin.<دامین>,https://backend.<دامین>

5.3. چک کردن NODE_ENV فعلی
pm2 show menumita-backend | grep "node env"


اگر production بود → CORS سخت‌گیر
اگر development بود → CORS آزاد

6) ساختار نهایی پوشه‌ها روی سرور

خلاصهٔ مهم‌ترین مسیرها:

/root/backend                # پوشه‌ی اصلی بک‌اند (سورس نهایی)

/etc/nginx/sites-available/backend.conf
/etc/nginx/sites-enabled/backend.conf

/var/log/nginx/access.log    # لاگ درخواست‌ها
/var/log/nginx/error.log     # لاگ خطاها

7) نکات برای آپدیت در آینده

اگر بعداً کد بک‌اند را در GitHub آپدیت کردی و خواستی روی سرور هم آپدیت شود، دو روش پیشنهادی:

روش ساده (پاک و نصب دوباره):

از روی سرور:

cd /root
git clone https://github.com/heydarlouam/code_backend_menumita.git
cd code_backend_menumita
chmod +x setup_backend.sh
./setup_backend.sh


اسکریپت خودکار /root/backend را آپدیت می‌کند و دوباره PM2 و Nginx را ست می‌کند.

روش دستی (برای حرفه‌ای‌ترها)
اگر ترجیح می‌دهی خودت دستی Pull و Deploy کنی، می‌توانی از فایل‌های همین پروژه و دستورهای PM2/Nginx بالا استفاده کنی.
