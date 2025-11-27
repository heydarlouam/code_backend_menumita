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
