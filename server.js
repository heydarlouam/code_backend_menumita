



/**
 * server.js — نسخه نهایی، تمیز، بدون خطا و کاملاً کارکردی
 * با CORS درست برای Express + Socket.IO + آپلود + ریل‌تایم
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const PocketBase = require('pocketbase/cjs');
const { createServer } = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const FormData = require('form-data');
const axios = require('axios');

// --- Polyfills برای Realtime در Node.js
globalThis.WebSocket = require('ws');
globalThis.EventSource = require('eventsource');

// ---------- متغیرهای محیط ----------
const PORT = Number(process.env.PORT || 5050);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const PUBLIC_PB_URL = process.env.PUBLIC_PB_URL || 'http://87.248.155.214:8090';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// ---------- لیست دامنه‌های مجاز برای CORS ----------

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

if (allowedOrigins.length === 0) {
  console.error('خطای بحرانی: CORS_ORIGINS تنظیم نشده است!');
  console.error('CORS_ORIGINS=https://frozencoffee.ir,https://www.frozencoffee.ir,https://admin.frozencoffee.ir');
  process.exit(1);
}

console.log('دامنه‌های مجاز CORS:', allowedOrigins);

// ---------- ساخت پوشه آپلود ----------
const ensureUploadDir = async () => {
  try {
    if (!fsSync.existsSync(UPLOAD_DIR)) {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      console.log('پوشه آپلود ساخته شد:', UPLOAD_DIR);
    }
  } catch (err) {
    console.error('خطا در ساخت پوشه آپلود:', err);
  }
};
ensureUploadDir();

// ---------- ساخت اپلیکیشن ----------
const app = express();
const httpServer = createServer(app);

// ---------- Socket.IO با CORS کاملاً درست ----------
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  path: '/socket.io/'
});

// ---------- اتصال به PocketBase ----------
const pb = new PocketBase(PB_URL);

// ---------- تنظیمات CORS برای Express (بعد از تعریف app!) ----------
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.log('CORS رد شد:', origin);
    return callback(new Error('دسترسی توسط CORS مسدود شد'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ---------- میدلوِرهای اصلی ----------
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- توابع کمکی ----------
const escPB = (v = '') => String(v).replace(/(["\\])/g, '\\$1');
const toNum = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;


// این تابع رو دقیقاً جایگزین تابع قبلی کن
const buildFileUrlSafe = (record, filename) => {
  if (!record || !filename) return null;
  
  const base = (process.env.PUBLIC_PB_URL || '').replace(/\/+$/, '');
  if (!base) {
    console.warn('PUBLIC_PB_URL تنظیم نشده! آدرس فایل ساخته نمیشه.');
    return null;
  }

  const file = String(filename).trim();
  if (!file) return null;

  // encodeURIComponent برای جلوگیری از مشکل کاراکترهای خاص
  const encodedFile = encodeURIComponent(file);
  
  return `${base}/api/files/${record.collectionId}/${record.id}/${encodedFile}`;
};
const deleteTempFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
    console.log('فایل موقت حذف شد:', filePath);
  } catch (_) {}
};

async function uploadToPocketBase(filePath, originalName) {
  try {
    const formData = new FormData();
    const fileStream = fsSync.createReadStream(filePath);

    formData.append('file', fileStream, {
      filename: originalName,
      contentType: 'image/jpeg'
    });
    formData.append('name', path.parse(originalName).name);

    const response = await axios.post(
      `${PUBLIC_PB_URL}/api/collections/images/records`,
      formData,
      {
        headers: { ...formData.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    console.log('آپلود موفق:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('خطا در آپلود:', error.response?.data || error.message);
    throw error;
  }
}

async function deleteImageFromPocketBase(imageId) {
  if (!imageId) return true;
  try {
    await pb.collection('images').delete(imageId);
    return true;
  } catch (error) {
    console.warn('خطا در حذف تصویر:', error.message);
    return false;
  }
}

// ---------- تنظیمات Multer ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!/jpeg|jpg|png|gif|webp/.test(ext)) {
      return cb(new Error('فقط فایل‌های تصویری مجاز هستند'));
    }
    const unique = `${Date.now()}_${Math.random().toString(36).substr(2)}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({ storage });

// ---------- اتصال Socket.IO ----------
io.on('connection', (socket) => {
  console.log('کلاینت متصل شد:', socket.id);

  socket.on('disconnect', (reason) => {
    console.log('کلاینت قطع شد:', socket.id, reason);
  });

  socket.on('error', (err) => {
    console.error('خطای سوکت:', err);
  });
});



// ========== COUPONS ==========
function sanitizeCouponFields(c) {
  return {
    ...c,
    applicableCategory: c.applicableCategory === "" ? null : c.applicableCategory,
    applicableSubCategory: c.applicableSubCategory === "" ? null : c.applicableSubCategory,
    applicableProduct: c.applicableProduct === "" ? null : c.applicableProduct,
  };
}

// PUT /api/coupons/:id
app.put('/api/coupons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      couponCode, discountType, discountAmount, minimumPurchaseAmount,
      endDate, status, applicableCategory, applicableSubCategory, applicableProduct
    } = req.body;

    const existing = await pb.collection('coupons').getOne(id);

    const updateData = {};
    if (couponCode !== undefined) updateData.couponCode = String(couponCode).trim();
    if (discountType !== undefined) updateData.discountType = discountType;
    if (discountAmount !== undefined) updateData.discountAmount = parseFloat(discountAmount);
    if (minimumPurchaseAmount !== undefined) updateData.minimumPurchaseAmount = parseFloat(minimumPurchaseAmount);
    if (endDate !== undefined) updateData.endDate = endDate;
    if (status !== undefined) updateData.status = status;
    if (applicableCategory !== undefined) updateData.applicableCategory = applicableCategory || "";
    if (applicableSubCategory !== undefined) updateData.applicableSubCategory = applicableSubCategory || "";
    if (applicableProduct !== undefined) updateData.applicableProduct = applicableProduct || "";

    if (couponCode && couponCode !== existing.couponCode) {
      try {
        await pb.collection('coupons').getFirstListItem(`couponCode = "${escPB(couponCode)}" && id != "${escPB(id)}"`);
        return res.status(400).json({ success: false, error: 'کد کوپن تکراری است.' });
      } catch (_) { /* not found → ok */ }
    }

    const updated = await pb.collection('coupons').update(id, updateData);
    return res.json({ success: true, message: 'کوپن با موفقیت بروزرسانی شد.', data: sanitizeCouponFields(updated) });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'کوپن یافت نشد.' });
    return res.status(400).json({ success: false, error: error.message });
  }
});

// GET /api/coupons
app.get('/api/coupons', async (req, res) => {
  try {
    const {
      expand = 'applicableCategory,applicableSubCategory,applicableProduct',
      phone_number_code, filter, perPage = 200
    } = req.query;

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const sort = '-created,-id';

    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';

      const effFilter =
        baseFilter && cursor ? `(${baseFilter}) && (${cursor})`
        : baseFilter ? `(${baseFilter})`
        : cursor ? `(${cursor})`
        : '';

      const page = await pb.collection('coupons').getList(1, limit, {
        sort, filter: effFilter, expand, skipTotal: true
      });

      if (!page.items.length) break;

      for (const it of page.items) data.push(sanitizeCouponFields(it));
      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/coupons
app.post('/api/coupons', async (req, res) => {
  try {
    const {
      couponCode, discountType, discountAmount, minimumPurchaseAmount,
      endDate, status, applicableCategory, applicableSubCategory, applicableProduct,
      phone_number_code = ''
    } = req.body;

    if (!couponCode?.trim()) return res.status(400).json({ success: false, error: 'کد کوپن الزامی است.' });
    if (!['fixed', 'percentage'].includes(String(discountType))) {
      return res.status(400).json({ success: false, error: 'نوع تخفیف باید fixed یا percentage باشد.' });
    }
    if (!discountAmount || discountAmount <= 0) {
      return res.status(400).json({ success: false, error: 'مقدار تخفیف باید بزرگ‌تر از صفر باشد.' });
    }
    if (!endDate) return res.status(400).json({ success: false, error: 'تاریخ انقضا الزامی است.' });
    if (!['active', 'inactive'].includes(String(status))) {
      return res.status(400).json({ success: false, error: 'وضعیت باید active یا inactive باشد.' });
    }

    try {
      await pb.collection('coupons').getFirstListItem(`couponCode = "${escPB(couponCode)}"`);
      return res.status(400).json({ success: false, error: 'کد کوپن تکراری است.' });
    } catch (_) {}

    const coupon = await pb.collection('coupons').create({
      couponCode: String(couponCode).trim(),
      discountType,
      discountAmount: parseFloat(discountAmount),
      minimumPurchaseAmount: minimumPurchaseAmount ? parseFloat(minimumPurchaseAmount) : 0,
      endDate, status,
      applicableCategory: applicableCategory || "",
      applicableSubCategory: applicableSubCategory || "",
      applicableProduct: applicableProduct || "",
      phone_number_code: String(phone_number_code).trim()
    });

    res.status(201).json({ success: true, message: 'کوپن با موفقیت ایجاد شد.', data: sanitizeCouponFields(coupon) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /api/coupons/check
app.post('/api/coupons/check', async (req, res) => {
  try {
    const { couponCode, purchaseAmount = 0, productIds = [] } = req.body;
    const phone_number_code_raw = (req.query.phone_number_code ?? req.body.phone_number_code ?? '').toString().trim();

    if (!couponCode) return res.status(400).json({ success: false, message: 'کد تخفیف وارد نشده است.' });
    if (!phone_number_code_raw) return res.status(400).json({ success: false, message: 'شناسه فروشگاه (phone_number_code) ارسال نشده است.' });

    const phone_number_code = escPB(phone_number_code_raw);
    const coupon_code = escPB(couponCode);

    const coupon = await pb.collection('coupons').getFirstListItem(
      `couponCode = "${coupon_code}" && phone_number_code = "${phone_number_code}"`,
      { expand: 'applicableCategory,applicableSubCategory,applicableProduct' }
    );

    if (!coupon) return res.status(404).json({ success: false, message: 'هیچ کوپنی با این کد برای این فروشگاه یافت نشد.' });

    const now = new Date();
    const endDate = new Date(coupon.endDate);
    if (endDate < now) return res.status(400).json({ success: false, message: 'تاریخ اعتبار این کوپن به پایان رسیده است.' });
    if (coupon.status !== 'active') return res.status(400).json({ success: false, message: 'این کوپن در حال حاضر غیرفعال است.' });
    if (coupon.minimumPurchaseAmount && purchaseAmount < coupon.minimumPurchaseAmount) {
      return res.status(400).json({ success: false, message: `حداقل مبلغ خرید برای استفاده از این کوپن ${coupon.minimumPurchaseAmount} تومان است.` });
    }

    const hasRestrictions =
      coupon.applicableCategory !== "" ||
      coupon.applicableSubCategory !== "" ||
      coupon.applicableProduct !== "";

    if (!hasRestrictions) {
      return res.json({ success: true, message: 'کوپن با موفقیت اعمال شد (بدون محدودیت دسته یا محصول).', data: sanitizeCouponFields(coupon) });
    }

    if (Array.isArray(productIds) && productIds.length > 0) {
      const idOr = productIds.filter(Boolean).map(id => `id = "${escPB(id)}"`).join(' || ');
      const products = await pb.collection('products').getFullList({
        filter: `(${idOr}) && phone_number_code = "${phone_number_code}"`,
      });

      const isValid = products.every((p) => {
        if (coupon.applicableCategory && coupon.applicableCategory !== "" && coupon.applicableCategory !== p.categoryId) return false;
        if (coupon.applicableSubCategory && coupon.applicableSubCategory !== "" && coupon.applicableSubCategory !== p.subcategoryId) return false;
        if (coupon.applicableProduct && coupon.applicableProduct !== "" && p.id !== coupon.applicableProduct) return false;
        return true;
      });

      if (!isValid) return res.status(400).json({ success: false, message: 'این کوپن برای محصولات انتخاب‌شده قابل استفاده نیست.' });

      return res.json({ success: true, message: 'کوپن با موفقیت برای محصولات انتخاب‌شده اعمال شد.', data: sanitizeCouponFields(coupon) });
    }

    return res.status(400).json({ success: false, message: 'کوپن محدودیت دارد، اما هیچ محصولی ارسال نشده است.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, message: 'کوپن یافت نشد.' });
    return res.status(500).json({ success: false, message: 'خطای سرور در بررسی کوپن. لطفاً دوباره تلاش کنید.' });
  }
});

// DELETE /api/coupons/:id
app.delete('/api/coupons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const record = await pb.collection('coupons').getOne(id);
    await pb.collection('coupons').delete(id);
    res.json({ success: true, message: 'کوپن با موفقیت حذف شد.', data: sanitizeCouponFields(record) });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'کوپن یافت نشد.' });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== POSTERS ==========
app.get('/api/posters', async (req, res) => {
  try {
    const {
      expand = 'image',
      fields = 'id,collectionId,collectionName,created,updated,poster_name,image,expand.image.id,expand.image.collectionId,expand.image.file',
      phone_number_code, filter, perPage = 200
    } = req.query;

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const sort = '-created,-id';
    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = baseFilter && cursor ? `(${baseFilter}) && (${cursor})`
               : baseFilter ? `(${baseFilter})`
               : cursor ? `(${cursor})` : '';

      const page = await pb.collection('posters').getList(1, limit, {
        sort, filter: eff, expand, fields, skipTotal: true
      });
      if (!page.items.length) break;

      for (const poster of page.items) {
        const out = {
          id: poster.id,
          collectionId: poster.collectionId,
          collectionName: poster.collectionName,
          created: poster.created,
          updated: poster.updated,
          poster_name: poster.poster_name ?? null,
          imageId: poster.image ?? null,
          imageUrl: null
        };
        const img = poster?.expand?.image;
        if (img?.file) out.imageUrl = buildFileUrlSafe(img, img.file);
        data.push(out);
      }

      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/posters', upload.single('image'), async (req, res) => {
  let tempFilePath = null;
  try {
    const { poster_name, phone_number_code = '' } = req.body;
    if (!poster_name?.trim()) return res.status(400).json({ success: false, error: 'نام پوستر الزامی است.' });

    let imageId = null;
    if (req.file) {
      tempFilePath = req.file.path;
      const img = await uploadToPocketBase(tempFilePath, req.file.originalname);
      imageId = img.id;
      await deleteTempFile(tempFilePath);
      tempFilePath = null;
    }

    const poster = await pb.collection('posters').create({
      poster_name: String(poster_name).trim(),
      phone_number_code: String(phone_number_code).trim(),
      ...(imageId && { image: imageId })
    });

    res.status(201).json({ success: true, message: 'پوستر با موفقیت ایجاد شد.', data: poster });
  } catch (error) {
    if (tempFilePath) await deleteTempFile(tempFilePath);
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/posters/:id', upload.single('image'), async (req, res) => {
  let tempFilePath = null;
  let oldImageId = null;
  try {
    const { id } = req.params;
    const { poster_name } = req.body;

    const existing = await pb.collection('posters').getOne(id);
    oldImageId = existing.image;

    const updateData = {};
    if (poster_name !== undefined) updateData.poster_name = String(poster_name).trim();

    if (req.file) {
      tempFilePath = req.file.path;
      const img = await uploadToPocketBase(tempFilePath, req.file.originalname);
      updateData.image = img.id;
      await deleteTempFile(tempFilePath);
      tempFilePath = null;

      if (oldImageId) await deleteImageFromPocketBase(oldImageId);
    }

    const updated = await pb.collection('posters').update(id, updateData);
    res.json({ success: true, message: 'پوستر با موفقیت بروزرسانی شد.', data: updated });
  } catch (error) {
    if (tempFilePath) await deleteTempFile(tempFilePath);
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'پوستر یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/posters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const poster = await pb.collection('posters').getOne(id);
    const imageId = poster.image;
    await pb.collection('posters').delete(id);
    if (imageId) await deleteImageFromPocketBase(imageId);
    res.json({ success: true, message: 'پوستر و تصویر مرتبط حذف شدند.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'پوستر یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

// ========== BRANDS ==========
app.get('/api/brands', async (req, res) => {
  try {
    const {
      expand = 'subcategory',
      fields = 'id,collectionId,collectionName,created,updated,name,subcategory,phone_number_code,expand.subcategory.id,expand.subcategory.name',
      filter, perPage = 200, sort = '-created,-id', phone_number_code
    } = req.query;

    if (!phone_number_code || !String(phone_number_code).trim()) {
      return res.status(400).json({ success: false, error: 'phone_number_code الزامی است.' });
    }

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const codeFilter = `phone_number_code = "${escPB(String(phone_number_code).trim())}"`;
    const baseFilter = filter?.trim() ? `(${codeFilter}) && (${filter})` : codeFilter;

    const all = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = cursor ? `(${baseFilter}) && (${cursor})` : baseFilter;

      const page = await pb.collection('brands').getList(1, limit, { sort, filter: eff, expand, fields, skipTotal: true });
      if (!page.items.length) break;

      for (const brand of page.items) {
        all.push({
          id: brand.id,
          collectionId: brand.collectionId,
          collectionName: brand.collectionName,
          created: brand.created,
          updated: brand.updated,
          name: brand.name,
          subcategory: brand.subcategory ?? null,
          phone_number_code: brand.phone_number_code ?? null,
          expand: brand.expand ?? null
        });
      }

      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

    res.json({ success: true, data: all });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/brands', async (req, res) => {
  try {
    const { name, subcategory, phone_number_code = '' } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'نام برند الزامی است.' });
    if (!subcategory) return res.status(400).json({ success: false, error: 'شناسهٔ زیر‌دسته الزامی است.' });

    const brand = await pb.collection('brands').create({
      name: String(name).trim(),
      subcategory,
      phone_number_code: String(phone_number_code).trim()
    });

    res.status(201).json({ success: true, message: 'برند با موفقیت ایجاد شد.', data: brand });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/brands/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, subcategory } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    const updated = await pb.collection('brands').update(id, updateData);
    res.json({ success: true, message: 'برند با موفقیت بروزرسانی شد.', data: updated });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'برند یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/brands/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pb.collection('brands').delete(id);
    res.json({ success: true, message: 'برند با موفقیت حذف شد.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'برند یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

// ========== CATEGORIES ==========


app.get('/api/categories', async (req, res) => {
  try {
    const { phone_number_code, perPage = 200 } = req.query;

    if (!phone_number_code) {
      return res.status(400).json({ success: false, error: 'phone_number_code الزامی است.' });
    }

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);

    // فیلتر مستقیم روی phone_number_code
    const list = await pb.collection('categories').getList(1, limit, {
      filter: `phone_number_code = "${phone_number_code.trim()}"`,
      sort: 'name',
    });

    const categories = list.items.map(cat => {
      const imageFile = cat.image; // این مستقیم نام فایل هست (مثل: pms8qoq5026x7nc)

      return {
        id: cat.id,
        name: cat.name,
        image: imageFile || null,
        phone_number_code: cat.phone_number_code,
        created: cat.created,
        updated: cat.updated,
        // ساخت آدرس عکس با PUBLIC_PB_URL
        imageUrl: imageFile
          ? `${process.env.PUBLIC_PB_URL.replace(/\/+$/, '')}/api/files/${cat.collectionId}/${cat.id}/${encodeURIComponent(imageFile)}`
          : null
      };
    });

    return res.json({
      success: true,
      categories
    });

  } catch (error) {
    console.error('خطا در /api/categories:', error.message);
    return res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

app.post('/api/categories', upload.single('image'), async (req, res) => {
  let tempFilePath = null;
  try {
    const { name, description = '', phone_number_code = '' } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'نام دسته‌بندی الزامی است.' });

    let imageId = null;
    if (req.file) {
      tempFilePath = req.file.path;
      const img = await uploadToPocketBase(tempFilePath, req.file.originalname);
      imageId = img.id;
      await deleteTempFile(tempFilePath);
      tempFilePath = null;
    }

    const category = await pb.collection('categories').create({
      name: String(name).trim(),
      description: String(description).trim(),
      phone_number_code: String(phone_number_code).trim(),
      ...(imageId && { image: imageId })
    });

    res.status(201).json({ success: true, message: 'دسته‌بندی با موفقیت ایجاد شد.', data: category });
  } catch (error) {
    if (tempFilePath) await deleteTempFile(tempFilePath);
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/categories/:id', upload.single('image'), async (req, res) => {
  let tempFilePath = null;
  let oldImageId = null;
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const existing = await pb.collection('categories').getOne(id);
    oldImageId = existing.image;

    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (description !== undefined) updateData.description = String(description).trim();

    if (req.file) {
      tempFilePath = req.file.path;
      const img = await uploadToPocketBase(tempFilePath, req.file.originalname);
      updateData.image = img.id;
      await deleteTempFile(tempFilePath);
      tempFilePath = null;
      if (oldImageId) await deleteImageFromPocketBase(oldImageId);
    }

    const updated = await pb.collection('categories').update(id, updateData);
    res.json({ success: true, message: 'دسته‌بندی با موفقیت بروزرسانی شد.', data: updated });
  } catch (error) {
    if (tempFilePath) await deleteTempFile(tempFilePath);
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'دسته‌بندی یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cat = await pb.collection('categories').getOne(id);
    const imageId = cat.image;
    await pb.collection('categories').delete(id);
    if (imageId) await deleteImageFromPocketBase(imageId);
    res.json({ success: true, message: 'دسته‌بندی و تصویر مرتبط حذف شدند.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'دسته‌بندی یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

// ========== SUBCATEGORIES ==========
app.get('/api/subcategories', async (req, res) => {
  try {
    const {
      expand = 'category',
      fields = 'id,collectionId,collectionName,created,updated,name,category,phone_number_code,expand.category.id,expand.category.name,expand.category.description,expand.category.collectionId,expand.category.image,expand.category.file',
      phone_number_code, filter, perPage = 200
    } = req.query;

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const sort = '-created,-id';
    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = baseFilter && cursor ? `(${baseFilter}) && (${cursor})`
               : baseFilter ? `(${baseFilter})`
               : cursor ? `(${cursor})` : '';

      const page = await pb.collection('subcategories').getList(1, limit, {
        sort, filter: eff, expand, fields, skipTotal: true
      });
      if (!page.items.length) break;

      for (const sc of page.items) {
        const out = {
          id: sc.id,
          collectionId: sc.collectionId,
          collectionName: sc.collectionName,
          created: sc.created,
          updated: sc.updated,
          name: sc.name ?? '',
          categoryId: sc.category ?? null
        };
        const cat = sc?.expand?.category;
        if (cat) {
          let imageUrl = null;
          if (cat.file) imageUrl = buildFileUrlSafe(cat, cat.file);
          out.category = {
            id: cat.id,
            name: cat.name ?? '',
            description: cat.description ?? '',
            imageUrl
          };
        }
        data.push(out);
      }

      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/subcategories', async (req, res) => {
  try {
    const { name, category, phone_number_code = '' } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'نام زیر‌دسته الزامی است.' });
    if (!category) return res.status(400).json({ success: false, error: 'شناسهٔ دسته‌بندی الزامی است.' });

    try { await pb.collection('categories').getOne(category); }
    catch { return res.status(404).json({ success: false, error: 'دسته‌بندی یافت نشد.' }); }

    const sc = await pb.collection('subcategories').create({
      name: String(name).trim(),
      category,
      phone_number_code: String(phone_number_code).trim()
    });

    res.status(201).json({ success: true, message: 'زیر‌دسته با موفقیت ایجاد شد.', data: sc });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (category !== undefined) {
      try { await pb.collection('categories').getOne(category); }
      catch { return res.status(404).json({ success: false, error: 'دسته‌بندی یافت نشد.' }); }
      updateData.category = category;
    }
    const updated = await pb.collection('subcategories').update(id, updateData);
    res.json({ success: true, message: 'زیر‌دسته با موفقیت بروزرسانی شد.', data: updated });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'زیر‌دسته یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pb.collection('subcategories').delete(id);
    res.json({ success: true, message: 'زیر‌دسته با موفقیت حذف شد.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'زیر‌دسته یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

// ========== VARIANT TYPES ==========
app.get('/api/variant-types', async (req, res) => {
  try {
    const { fields = '', phone_number_code, filter, perPage = 200 } = req.query;
    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const sort = '-created,-id';
    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = baseFilter && cursor ? `(${baseFilter}) && (${cursor})`
               : baseFilter ? `(${baseFilter})`
               : cursor ? `(${cursor})` : '';

      const page = await pb.collection('variant_types').getList(1, limit, {
        sort, filter: eff, fields, skipTotal: true
      });
      if (!page.items.length) break;
      for (const it of page.items) data.push(it);

      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/variant-types', async (req, res) => {
  try {
    const { name, type, phone_number_code = '' } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'نام نوعِ واریانت الزامی است.' });
    if (!type?.trim()) return res.status(400).json({ success: false, error: 'فیلد type الزامی است.' });

    const vt = await pb.collection('variant_types').create({
      name: String(name).trim(),
      type: String(type).trim(),
      phone_number_code: String(phone_number_code).trim()
    });

    res.status(201).json({ success: true, message: 'نوعِ واریانت با موفقیت ایجاد شد.', data: vt });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/variant-types/:id', async (req, res) => {
  try {
    const { id } = req.params; const { name, type } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (type !== undefined) updateData.type = String(type).trim();
    const updated = await pb.collection('variant_types').update(id, updateData);
    res.json({ success: true, message: 'نوعِ واریانت با موفقیت بروزرسانی شد.', data: updated });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'نوعِ واریانت یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/variant-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pb.collection('variant_types').delete(id);
    res.json({ success: true, message: 'نوعِ واریانت با موفقیت حذف شد.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'نوعِ واریانت یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

// ========== VARIANTS ==========
app.get('/api/variants', async (req, res) => {
  try {
    const {
      expand = 'variant_type',
      fields = 'id,collectionId,collectionName,created,updated,name,variant_type,phone_number_code,expand.variant_type.id,expand.variant_type.name,expand.variant_type.type',
      phone_number_code, filter, perPage = 200
    } = req.query;

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const sort = '-created,-id';
    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = baseFilter && cursor ? `(${baseFilter}) && (${cursor})`
               : baseFilter ? `(${baseFilter})`
               : cursor ? `(${cursor})` : '';

      const page = await pb.collection('variants').getList(1, limit, {
        sort, filter: eff, expand, fields, skipTotal: true
      });
      if (!page.items.length) break;

      for (const v of page.items) {
        const out = {
          id: v.id,
          collectionId: v.collectionId,
          collectionName: v.collectionName,
          created: v.created,
          updated: v.updated,
          name: v.name ?? '',
          variantTypeId: v.variant_type ?? null
        };
        const vt = v?.expand?.variant_type;
        if (vt) out.variant_type = { id: vt.id, name: vt.name ?? '', type: vt.type ?? null };
        data.push(out);
      }

      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/variants', async (req, res) => {
  try {
    const { name, variant_type, phone_number_code = '' } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'نام واریانت الزامی است.' });
    if (!variant_type) return res.status(400).json({ success: false, error: 'شناسهٔ نوعِ واریانت الزامی است.' });

    try { await pb.collection('variant_types').getOne(variant_type); }
    catch { return res.status(404).json({ success: false, error: 'نوعِ واریانت یافت نشد.' }); }

    const variant = await pb.collection('variants').create({
      name: String(name).trim(),
      variant_type,
      phone_number_code: String(phone_number_code).trim()
    });

    res.status(201).json({ success: true, message: 'واریانت با موفقیت ایجاد شد.', data: variant });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/variants/:id', async (req, res) => {
  try {
    const { id } = req.params; const { name, variant_type } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (variant_type !== undefined) {
      try { await pb.collection('variant_types').getOne(variant_type); }
      catch { return res.status(404).json({ success: false, error: 'نوعِ واریانت یافت نشد.' }); }
      updateData.variant_type = variant_type;
    }
    const updated = await pb.collection('variants').update(id, updateData);
    res.json({ success: true, message: 'واریانت با موفقیت بروزرسانی شد.', data: updated });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'واریانت یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/variants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pb.collection('variants').delete(id);
    res.json({ success: true, message: 'واریانت با موفقیت حذف شد.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'واریانت یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});

// ========== PRODUCTS ==========
app.get('/api/products', async (req, res) => {
  try {
    const {
      expand = 'category,subcategory,brand,variant_type,variants,images',
      fields = [
        'id','collectionId','collectionName','created','updated',
        'name','description','quantity','price','offer_price',
        'category','subcategory','brand','variant_type','variants','images',
        'phone_number_code',
        'expand.category.id','expand.category.name','expand.category.image',
        'expand.subcategory.id','expand.subcategory.name',
        'expand.brand.id','expand.brand.name',
        'expand.variant_type.id','expand.variant_type.name','expand.variant_type.type',
        'expand.variants.id','expand.variants.name',
        'expand.images.id','expand.images.collectionId','expand.images.file','expand.images.name'
      ].join(','),
      phone_number_code, filter, perPage = 200
    } = req.query;

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const sort = '-created,-id';
    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = baseFilter && cursor ? `(${baseFilter}) && (${cursor})`
               : baseFilter ? `(${baseFilter})`
               : cursor ? `(${cursor})` : '';

      const page = await pb.collection('products').getList(1, limit, {
        sort, filter: eff, expand, fields, skipTotal: true
      });
      if (!page.items.length) break;

      for (const product of page.items) {
        const out = {
          id: product.id,
          collectionId: product.collectionId,
          collectionName: product.collectionName,
          created: product.created,
          updated: product.updated,
          name: product.name ?? '',
          description: product.description ?? '',
          quantity: product.quantity ?? 0,
          price: product.price ?? 0,
          offer_price: product.offer_price ?? 0,
          categoryId: product.category ?? null,
          subcategoryId: product.subcategory ?? null,
          brandId: product.brand ?? null,
          variantTypeId: product.variant_type ?? null,
          variantsIds: Array.isArray(product.variants) ? product.variants : [],
          imagesIds: Array.isArray(product.images) ? product.images : [],
        };

        const ex = product.expand || {};
        if (ex.category) out.category = { id: ex.category.id, name: ex.category.name ?? null };
        if (ex.subcategory) out.subcategory = { id: ex.subcategory.id, name: ex.subcategory.name ?? null };
        if (ex.brand) out.brand = { id: ex.brand.id, name: ex.brand.name ?? null };
        if (ex.variant_type) out.variant_type = {
          id: ex.variant_type.id, name: ex.variant_type.name ?? null, type: ex.variant_type.type ?? null
        };
        if (Array.isArray(ex.variants)) {
          out.variants = ex.variants.map(v => ({ id: v.id, name: v.name ?? null }));
        }
        if (Array.isArray(ex.images)) {
          out.images = ex.images.map(img => ({
            id: img.id,
            name: img.name ?? null,
            url: img?.file ? buildFileUrlSafe(img, img.file) : null
          }));
        }

        data.push(out);
      }

      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/products', upload.array('images', 10), async (req, res) => {
  const tempFilePaths = [];
  try {
    const {
      name, description = '', quantity = 0, price = 0, offer_price = 0,
      category, subcategory, brand, variant_type, variants = '[]', phone_number_code = ''
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ success: false, error: 'نام محصول الزامی است.' });
    if (!category) return res.status(400).json({ success: false, error: 'شناسهٔ دسته‌بندی الزامی است.' });

    try { await pb.collection('categories').getOne(category); }
    catch { return res.status(404).json({ success: false, error: 'دسته‌بندی یافت نشد.' }); }

    let imageIds = [];

    if (req.files?.length) {
      for (const f of req.files) {
        try {
          tempFilePaths.push(f.path);
          const img = await uploadToPocketBase(f.path, f.originalname);
          imageIds.push(img.id);
          await deleteTempFile(f.path);
          const at = tempFilePaths.indexOf(f.path);
          if (at > -1) tempFilePaths.splice(at, 1);
        } catch (e) {
          console.error('❌ خطا در آپلود تصویر:', f.originalname, e?.message || e);
        }
      }
    }

    let variantsArray = [];
    try { variantsArray = JSON.parse(variants); } catch { variantsArray = []; }

    const product = await pb.collection('products').create({
      name: String(name).trim(),
      description: String(description).trim(),
      quantity: parseInt(quantity) || 0,
      price: parseFloat(price) || 0,
      offer_price: parseFloat(offer_price) || 0,
      category,
      subcategory: subcategory || null,
      brand: brand || null,
      variant_type: variant_type || null,
      variants: variantsArray,
      images: imageIds,
      phone_number_code: String(phone_number_code).trim()
    });

    res.status(201).json({ success: true, message: 'محصول با موفقیت ایجاد شد.', data: product });
  } catch (error) {
    for (const p of tempFilePaths) { try { await deleteTempFile(p); } catch (_) {} }
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/products/:id', upload.array('images', 10), async (req, res) => {
  const tempFilePaths = [];
  try {
    const { id } = req.params;
    const {
      name, description, quantity, price, offer_price,
      category, subcategory, brand, variant_type, variants, phone_number_code,
      image_slots, remove_image_indexes,
    } = req.body;

    const existing = await pb.collection('products').getOne(id);
    const oldImageIds = Array.isArray(existing.images) ? [...existing.images] : [];

    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (description !== undefined) updateData.description = String(description).trim();
    if (quantity !== undefined) updateData.quantity = parseInt(quantity) || 0;
    if (price !== undefined) updateData.price = parseFloat(price) || 0;
    if (offer_price !== undefined) updateData.offer_price = parseFloat(offer_price) || 0;

    if (category !== undefined) {
      try { await pb.collection('categories').getOne(category); }
      catch { return res.status(404).json({ success: false, error: 'دسته‌بندی یافت نشد.' }); }
      updateData.category = category;
    }
    if (subcategory !== undefined) updateData.subcategory = subcategory || null;
    if (brand !== undefined) updateData.brand = brand || null;
    if (variant_type !== undefined) updateData.variant_type = variant_type || null;

    if (variants !== undefined) {
      try { updateData.variants = JSON.parse(variants); }
      catch { return res.status(400).json({ success: false, error: 'فرمت فیلد variants نامعتبر است.' }); }
    }

    if (phone_number_code !== undefined) updateData.phone_number_code = String(phone_number_code).trim();

    // parse indices helper
    const parseIndexList = (val) => {
      if (val === undefined || val === null) return [];
      if (Array.isArray(val)) return val.map((x) => parseInt(x)).filter((n) => Number.isInteger(n) && n > 0);
      try {
        const j = JSON.parse(val);
        if (Array.isArray(j)) return j.map((x) => parseInt(x)).filter((n) => Number.isInteger(n) && n > 0);
      } catch (_) {}
      const n = parseInt(val);
      return Number.isInteger(n) && n > 0 ? [n] : [];
    };

    const removeIndexes = parseIndexList(remove_image_indexes);
    let slots = [];
    if (image_slots !== undefined) {
      slots = Array.isArray(image_slots)
        ? image_slots.map((x) => parseInt(x)).filter((n) => Number.isInteger(n) && n > 0)
        : parseIndexList(image_slots);
    }

    let newImages = [...oldImageIds];
    const imagesToDelete = [];

    if (removeIndexes.length > 0) {
      for (const s of removeIndexes) {
        const idx = s - 1;
        if (idx >= 0 && idx < newImages.length && newImages[idx]) {
          imagesToDelete.push(newImages[idx]);
          newImages[idx] = null;
        }
      }
    }

    if (req.files?.length) {
      const useSlots = slots.length > 0;
      for (let i = 0; i < req.files.length; i++) {
        const f = req.files[i];
        try {
          tempFilePaths.push(f.path);
          const img = await uploadToPocketBase(f.path, f.originalname);
          const newId = img.id;

          if (useSlots) {
            const s = slots[Math.min(i, slots.length - 1)];
            const idx = s - 1;
            if (idx >= 0) {
              while (idx >= newImages.length) newImages.push(null);
              if (newImages[idx]) imagesToDelete.push(newImages[idx]);
              newImages[idx] = newId;
            }
          } else {
            newImages.push(newId);
          }

          await deleteTempFile(f.path);
          const at = tempFilePaths.indexOf(f.path);
          if (at > -1) tempFilePaths.splice(at, 1);
        } catch (e) {
          console.error('❌ خطا در آپلود تصویر (PUT):', f.originalname, e?.message || e);
        }
      }
    }

    newImages = newImages.filter(Boolean);
    if (removeIndexes.length > 0 || (req.files && req.files.length > 0)) {
      updateData.images = newImages;
    }

    const updated = await pb.collection('products').update(id, updateData);

    if (imagesToDelete.length > 0) {
      for (const imgId of imagesToDelete) {
        try { await deleteImageFromPocketBase(imgId); }
        catch (e) { console.warn('⚠️ حذف تصویر قدیمی ناموفق:', imgId, e?.message); }
      }
    }

    return res.json({ success: true, message: 'محصول با موفقیت بروزرسانی شد.', data: updated });
  } catch (error) {
    for (const p of tempFilePaths) { try { await deleteTempFile(p); } catch (_) {} }
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'محصول یافت نشد.' });
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const product = await pb.collection('products').getOne(id);
    const imageIds = product.images || [];
    await pb.collection('products').delete(id);
    for (const imgId of imageIds) { await deleteImageFromPocketBase(imgId); }
    res.json({ success: true, message: 'محصول و تصاویر مرتبط حذف شدند.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'محصول یافت نشد.' });
    res.status(400).json({ success: false, error: error.message });
  }
});






// ---------- Realtime: Orders Bridge ----------
const ALLOWED_STATUSES = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

const EXPAND_ORD = 'userID,couponCode';

const FIELDS_ORD = [
  'id','collectionId','collectionName','created','updated','orderStatus','items','totalPrice',
  'shippingAddress','paymentMethod','orderTotal','trackingUrl','orderDate','userID','couponCode','phone_number_code',
  'orderMode','tableNumber',
  'expand.userID.id','expand.userID.uuid','expand.userID.name','expand.userID.phone_number','expand.userID.address',
  'expand.couponCode.id','expand.couponCode.couponCode','expand.couponCode.discountType','expand.couponCode.discountAmount'
].join(',');


function mapOrderOut(order) {
  // 🔽 استفاده از normalizeOrderTotal
  const norm = normalizeOrderTotal(order);
  const out = {
    id: order.id,
    collectionId: order.collectionId,
    collectionName: order.collectionName,
    created: order.created,
    updated: order.updated,
    orderStatus: order.orderStatus ?? null,
    items: order.items ?? [],
    totalPrice: norm.total, // 🔽 استفاده از norm.total
    shippingAddress: order.shippingAddress ?? null,
    paymentMethod: order.paymentMethod ?? null,
    orderMode: order.orderMode ?? null,
    tableNumber: order.tableNumber ?? 0,
    orderTotal: { subTotal: norm.subTotal, discount: norm.discount, total: norm.total }, // 🔽 ساختار کامل
    trackingUrl: order.trackingUrl ?? null,
    orderDate: order.orderDate ?? null,
    userID: order.userID ?? null,
    phone_number_code: order.phone_number_code ?? null,
  };

  const exUser = order?.expand?.userID;
  if (exUser) {
    out.user = {
      id: exUser.id,
      uuid: exUser.uuid ?? null,
      name: exUser.name ?? null,
      phone_number: exUser.phone_number ?? null,
      address: exUser.address ?? null,
    };
  }
  const exCoupon = order?.expand?.couponCode;
  if (exCoupon) {
    // 🔽 استفاده از منطق مشابه روت بالایی برای کوپن
    const first = Array.isArray(exCoupon) ? exCoupon[0] : exCoupon;
    if (first) {
      out.coupon = {
        id: first.id,
        couponCode: first.couponCode ?? null,
        discountType: first.discountType ?? null,
        discountAmount: toNum(first.discountAmount), // 🔽 استفاده از toNum
      };
    }
  }
  return out;
}

async function fetchFullOrder(id) {
  return await pb.collection('orders').getOne(id, { expand: EXPAND_ORD, fields: FIELDS_ORD });
}

function emitOrdersChange({ action, record }) {
  io.emit('orders_change', {
    action,           // create | update | delete
    record,
    timestamp: Date.now(),
  });
}

async function setupRealtimeOrders() {
  try {
    console.log('📡 Subscribing PocketBase collection: orders');

    await pb.collection('orders').subscribe('*', async (e) => {
      const rawStatus = (e?.record?.orderStatus || '').toString();
      if (!ALLOWED_STATUSES.includes(rawStatus)) return;

      if (e.action === 'create' || e.action === 'update') {
        try {
          const full = await fetchFullOrder(e.record.id);
          emitOrdersChange({ action: e.action, record: mapOrderOut(full) });
        } catch (err) {
          console.error('❌ دریافت رکورد کامل سفارش ناموفق:', err?.message || err);
        }
      } else if (e.action === 'delete') {
        const id = e.record?.id;
        if (!id) return;
        emitOrdersChange({
          action: 'delete',
          record: {
            id,
            orderStatus: e.record?.orderStatus ?? null,
            phone_number_code: e.record?.phone_number_code ?? null,
          },
        });
      }
    });

    console.log('✅ پل ریل‌تایم آماده است: "orders_change" پخش می‌شود.');
  } catch (err) {
    console.error('❌ راه‌اندازی ریل‌تایم ناموفق بود، تلاش مجدد ۳ ثانیه دیگر:', err?.message || err);
    setTimeout(setupRealtimeOrders, 3000);
  }
}

// ========== ORDERS (REST) ==========

function calcCouponByExpand(subTotal, expandCoupon) {
  if (!expandCoupon) return null;
  const list = Array.isArray(expandCoupon) ? expandCoupon : [expandCoupon];
  let best = null;
  for (const c of list) {
    const t = String(c?.discountType || '').toLowerCase();
    const amt = toNum(c?.discountAmount);
    if (amt <= 0 || subTotal <= 0) continue;
    let discount = 0;
    if (t === 'percentage') discount = Math.floor((subTotal * amt) / 100);
    else if (t === 'fixed') discount = Math.min(subTotal, amt);
    else continue;
    const total = Math.max(0, subTotal - discount);
    const cand = {
      subTotal, discount, total, source: 'coupon',
      couponSnapshot: {
        id: c?.id ?? null,
        couponCode: c?.couponCode ?? null,
        discountType: c?.discountType ?? null,
        discountAmount: toNum(c?.discountAmount),
      },
    };
    if (!best || cand.total < best.total) best = cand;
  }
  return best;
}

function normalizeOrderTotal(order) {
  let rawSub = 0, rawDisc = 0, rawTotal = 0;

  if (order?.orderTotal && typeof order.orderTotal === 'object') {
    rawSub   = toNum(order.orderTotal.subTotal);
    rawDisc  = toNum(order.orderTotal.discount);
    rawTotal = toNum(order.orderTotal.total);
  } else if (typeof order?.orderTotal === 'number' || typeof order?.orderTotal === 'string') {
    rawTotal = toNum(order.orderTotal);
    rawSub   = toNum(order.totalPrice ?? rawTotal);
    rawDisc  = 0;
  } else {
    rawSub   = toNum(order?.totalPrice);
    rawTotal = rawSub;
    rawDisc  = 0;
  }
  if (rawTotal <= 0) rawTotal = rawSub;

  const couponProp = calcCouponByExpand(rawSub, order?.expand?.couponCode);
  const diffDisc = Math.max(0, rawSub - rawTotal);
  const diffProp = { subTotal: rawSub, discount: diffDisc, total: Math.max(0, rawSub - diffDisc), source: 'numbers' };
  const EPS = 1;
  if (couponProp) {
    const consistent = Math.abs(couponProp.discount - diffProp.discount) <= EPS ||
                       Math.abs(couponProp.total    - diffProp.total)    <= EPS;
    return consistent
      ? { subTotal: couponProp.subTotal, discount: couponProp.discount, total: couponProp.total, source: 'coupon', couponSnapshot: couponProp.couponSnapshot }
      : { subTotal: diffProp.subTotal,  discount: diffProp.discount,  total: diffProp.total,  source: 'numbers' };
  }
  return diffProp;
}

// GET /api/ordersalls
app.get('/api/ordersalls', async (req, res) => {
  try {
    const {
      expand = 'userID,couponCode',
      fields = FIELDS_ORD,
      phone_number_code, filter, perPage = 200
    } = req.query;

    const limit = Math.min(Math.max(parseInt(perPage, 10) || 200, 1), 500);
    const sort = '-created,-id';
    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const statusFilter = '(' + ALLOWED_STATUSES.map(s => `orderStatus = "${s}"`).join(' || ') + ')';
    const baseFilterWithStatus = baseFilter ? `(${baseFilter}) && ${statusFilter}` : statusFilter;

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = baseFilterWithStatus && cursor ? `(${baseFilterWithStatus}) && (${cursor})`
               : baseFilterWithStatus ? `(${baseFilterWithStatus})`
               : cursor ? `(${cursor})` : '';

      const page = await pb.collection('orders').getList(1, limit, {
        sort, filter: eff, expand, fields, skipTotal: true
      });
      if (!page.items.length) break;

      for (const order of page.items) {
         const norm = normalizeOrderTotal(order);
        const out = {
          id: order.id,
          collectionId: order.collectionId,
          collectionName: order.collectionName,
          created: order.created,
          updated: order.updated,
          orderStatus: order.orderStatus ?? null,
          items: order.items ?? [],
          // totalPrice: order.totalPrice ?? 0,
            totalPrice: norm.total, // 🔽 استفاده از norm.total
          shippingAddress: order.shippingAddress ?? null,
          paymentMethod: order.paymentMethod ?? null,
            orderMode: order.orderMode ?? null,        // اضافه شود
  tableNumber: order.tableNumber ?? 0,  
          // orderTotal: order.orderTotal ?? 0,
               orderTotal: { subTotal: norm.subTotal, discount: norm.discount, total: norm.total }, // 🔽 ساختار کامل
          trackingUrl: order.trackingUrl ?? null,
          orderDate: order.orderDate ?? null,
          userID: order.userID ?? null,
          phone_number_code: order.phone_number_code ?? null
        };

        const exUser = order?.expand?.userID;
        if (exUser) {
          out.user = {
            id: exUser.id,
            uuid: exUser.uuid ?? null,
            name: exUser.name ?? null,
            phone_number: exUser.phone_number ?? null,
            address: exUser.address ?? null
          };
        }
        // const exCoupon = order?.expand?.couponCode;
        // if (exCoupon) {
        //   out.coupon = {
        //     id: exCoupon.id,
        //     couponCode: exCoupon.couponCode ?? null,
        //     discountType: exCoupon.discountType ?? null,
        //     discountAmount: exCoupon.discountAmount ?? null
        //   };
        // }
          const exCoupon = order?.expand?.couponCode;
        if (exCoupon) {
          // 🔽 استفاده از منطق مشابه روت بالایی برای کوپن
          const first = Array.isArray(exCoupon) ? exCoupon[0] : exCoupon;
          if (first) {
            out.coupon = {
              id: first.id,
              couponCode: first.couponCode ?? null,
              discountType: first.discountType ?? null,
              discountAmount: toNum(first.discountAmount), // 🔽 استفاده از toNum
            };
          }
        }
        data.push(out);
      }

      const last = page.items[page.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (page.items.length < limit) break;
    }

//     return res.json({ success: true, data });
//   } catch (error) {
//     return res.status(500).json({ success: false, error: error.message });
//   }
// });
   // 🔽 اضافه کردن count و message مثل روت بالایی
    return res.json({ 
      success: true, 
      message: 'تمام سفارش‌ها دریافت شد.', 
      count: data.length, 
      data 
    });
  } catch (error) {
    // 🔽 استفاده از پیام فارسی مثل روت بالایی
    return res.status(500).json({ 
      success: false, 
      message: 'خطای سرور در دریافت سفارش‌ها.', 
      error: error?.message || String(error) 
    });
  }
});
// GET /api/orders  (Paid-only صفحه‌ای)
app.get('/api/orders', async (req, res) => {
  try {
    const {
      expand = 'userID,couponCode',
      fields = FIELDS_ORD,
      phone_number_code, filter, perPage, page = '1'
    } = req.query;

    const limitDefault = 50;
    const limitParsed = parseInt(perPage, 10);
    const limit = Math.min(Math.max(Number.isFinite(limitParsed) ? limitParsed : limitDefault, 1), 500);
    const sort = '-created,-id';

    const baseFilter = phone_number_code
      ? `phone_number_code = "${escPB(String(phone_number_code).trim())}"`
      : (filter || '');

    const baseFilterWithStatus = baseFilter
      ? `(${baseFilter}) && (orderStatus = "Paid")`
      : `orderStatus = "Paid"`;

    const targetPage = Math.max(parseInt(page, 10) || 1, 1);

    const data = [];
    let lastCreated = null, lastId = null;
    let currentPage = 0;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = baseFilterWithStatus && cursor ? `(${baseFilterWithStatus}) && (${cursor})`
               : baseFilterWithStatus ? `(${baseFilterWithStatus})`
               : cursor ? `(${cursor})` : '';

      const pageRes = await pb.collection('orders').getList(1, limit, {
        sort, filter: eff, expand, fields, skipTotal: true
      });
      if (!pageRes.items.length) break;

      currentPage += 1;

//       const last = pageRes.items[pageRes.items.length - 1];
//       lastCreated = last.created; lastId = last.id;

//       if (currentPage < targetPage) continue;

//       for (const order of pageRes.items) {
//         const out = {
//           id: order.id,
//           collectionId: order.collectionId,
//           collectionName: order.collectionName,
//           created: order.created,
//           updated: order.updated,
//           orderStatus: order.orderStatus ?? null,
//           items: order.items ?? [],
//           totalPrice: order.totalPrice ?? 0,
//           shippingAddress: order.shippingAddress ?? null,
//           paymentMethod: order.paymentMethod ?? null,
//            orderMode: order.orderMode ?? null,        // اضافه شود
//   tableNumber: order.tableNumber ?? 0,    
//           orderTotal: order.orderTotal ?? 0,
//           trackingUrl: order.trackingUrl ?? null,
//           orderDate: order.orderDate ?? null,
//           userID: order.userID ?? null,
//           phone_number_code: order.phone_number_code ?? null
//         };

//         const exUser = order?.expand?.userID;
//         if (exUser) {
//           out.user = {
//             id: exUser.id,
//             uuid: exUser.uuid ?? null,
//             name: exUser.name ?? null,
//             phone_number: exUser.phone_number ?? null,
//             address: exUser.address ?? null
//           };
//         }
//         const exCoupon = order?.expand?.couponCode;
//         if (exCoupon) {
//           out.coupon = {
//             id: exCoupon.id,
//             couponCode: exCoupon.couponCode ?? null,
//             discountType: exCoupon.discountType ?? null,
//             discountAmount: exCoupon.discountAmount ?? null
//           };
//         }
//         data.push(out);
//       }
//       break;
//     }

//     return res.json({ success: true, data });
//   } catch (error) {
//     return res.status(500).json({ success: false, error: error.message });
//   }
// });

      const last = pageRes.items[pageRes.items.length - 1];
      lastCreated = last.created; lastId = last.id;

      if (currentPage < targetPage) continue;

      for (const order of pageRes.items) {
        // 🔽 استفاده از normalizeOrderTotal مثل روت بالایی
        const norm = normalizeOrderTotal(order);
        const out = {
          id: order.id,
          collectionId: order.collectionId,
          collectionName: order.collectionName,
          created: order.created,
          updated: order.updated,
          orderStatus: order.orderStatus ?? null,
          items: order.items ?? [],
          totalPrice: norm.total, // 🔽 استفاده از norm.total
          shippingAddress: order.shippingAddress ?? null,
          paymentMethod: order.paymentMethod ?? null,
          orderMode: order.orderMode ?? null,
          tableNumber: order.tableNumber ?? 0,
          orderTotal: { subTotal: norm.subTotal, discount: norm.discount, total: norm.total }, // 🔽 ساختار کامل
          trackingUrl: order.trackingUrl ?? null,
          orderDate: order.orderDate ?? null,
          userID: order.userID ?? null,
          phone_number_code: order.phone_number_code ?? null
        };

        const exUser = order?.expand?.userID;
        if (exUser) {
          out.user = {
            id: exUser.id,
            uuid: exUser.uuid ?? null,
            name: exUser.name ?? null,
            phone_number: exUser.phone_number ?? null,
            address: exUser.address ?? null
          };
        }
        const exCoupon = order?.expand?.couponCode;
        if (exCoupon) {
          // 🔽 استفاده از منطق مشابه روت بالایی برای کوپن
          const first = Array.isArray(exCoupon) ? exCoupon[0] : exCoupon;
          if (first) {
            out.coupon = {
              id: first.id,
              couponCode: first.couponCode ?? null,
              discountType: first.discountType ?? null,
              discountAmount: toNum(first.discountAmount), // 🔽 استفاده از toNum
            };
          }
        }
        data.push(out);
      }
      break;
    }

    // 🔽 اضافه کردن count و message مثل روت بالایی
    return res.json({ 
      success: true, 
      message: 'سفارش‌های Paid دریافت شد.', 
      count: data.length, 
      data 
    });
  } catch (error) {
    // 🔽 استفاده از پیام فارسی مثل روت بالایی
    return res.status(500).json({ 
      success: false, 
      message: 'خطای سرور در دریافت سفارش‌ها.', 
      error: error?.message || String(error) 
    });
  }
});

// GET /api/orders/orderByUserId/:userId
app.get('/api/orders/orderByUserId/:userId', async (req, res) => {
  try {
    const rawUserId = (req.params.userId ?? '').toString().trim();
    if (!rawUserId) return res.status(400).json({ success: false, message: 'شناسه کاربر ارسال نشده است.' });
    const phoneCodeRaw = (req.query.phone_number_code ?? req.body?.phone_number_code ?? '').toString().trim();
    if (!phoneCodeRaw) return res.status(400).json({ success: false, message: 'phone_number_code اجباری است.' });

    const {
      expand = 'userID,couponCode',
      fields = [
        'id','collectionId','collectionName','created','updated',
        'orderStatus','items','totalPrice','shippingAddress','orderMode','tableNumber',
        'orderTotal','trackingUrl','orderDate','userID','couponCode','phone_number_code',
        'expand.userID.id','expand.userID.uuid','expand.userID.name','expand.userID.phone_number','expand.userID.address',
        'expand.couponCode.id','expand.couponCode.couponCode','expand.couponCode.discountType','expand.couponCode.discountAmount',
      ].join(','),
      perPage,
    } = req.query;

    const limitDefault = 100;
    const limitParsed  = parseInt(perPage, 10);
    const limit = Math.min(Math.max(Number.isFinite(limitParsed) ? limitParsed : limitDefault, 1), 500);

    const sort = '-created,-id';
    const userId = escPB(rawUserId);
    const phoneCode = escPB(phoneCodeRaw);
    const baseFilter = `(userID = "${userId}") && (phone_number_code = "${phoneCode}")`;

    const data = [];
    let lastCreated = null, lastId = null;

    while (true) {
      const cursor = (lastCreated && lastId)
        ? `(created < "${escPB(lastCreated)}") || (created = "${escPB(lastCreated)}" && id < "${escPB(lastId)}")`
        : '';
      const eff = cursor ? `(${baseFilter}) && (${cursor})` : baseFilter;

      const pageRes = await pb.collection('orders').getList(1, limit, {
        sort, filter: eff, expand, fields, skipTotal: true,
      });
      if (!pageRes.items.length) break;

      for (const order of pageRes.items) {
        const norm = normalizeOrderTotal(order);
        const out = {
          id: order.id,
          collectionId: order.collectionId,
          collectionName: order.collectionName,
          created: order.created,
          updated: order.updated,
          orderStatus: order.orderStatus ?? null,
          items: order.items ?? [],
          totalPrice: norm.total,
          shippingAddress: order.shippingAddress ?? null,
          orderMode: order.orderMode ?? null,
          tableNumber: order.tableNumber ?? 0,
          orderTotal: { subTotal: norm.subTotal, discount: norm.discount, total: norm.total },
          trackingUrl: order.trackingUrl ?? null,
          orderDate: order.orderDate ?? null,
          userID: order.userID ?? null,
          phone_number_code: order.phone_number_code ?? null,
        };

        const exUser = order?.expand?.userID;
        if (exUser) {
          out.user = {
            id: exUser.id,
            uuid: exUser.uuid ?? null,
            name: exUser.name ?? null,
            phone_number: exUser.phone_number ?? null,
            address: exUser.address ?? null,
          };
        }
        const exCoupon = order?.expand?.couponCode;
        if (exCoupon) {
          const first = Array.isArray(exCoupon) ? exCoupon[0] : exCoupon;
          if (first) {
            out.coupon = {
              id: first.id,
              couponCode: first.couponCode ?? null,
              discountType: first.discountType ?? null,
              discountAmount: toNum(first.discountAmount),
            };
          }
        }
        data.push(out);
      }

      const last = pageRes.items[pageRes.items.length - 1];
      lastCreated = last.created; lastId = last.id;
      if (pageRes.items.length < limit) break;
    }

    return res.json({ success: true, message: 'تمام سفارش‌های کاربر دریافت شد.', count: data.length, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'خطای سرور در دریافت سفارش‌ها.', error: error?.message || String(error) });
  }
});

// POST /api/orders
app.post('/api/orders', async (req, res) => {
  try {
    const {
      userID, orderStatus = 'Pending', items, totalPrice,
      shippingAddress, couponCode, orderTotal, trackingUrl,
      phone_number_code, orderMode, tableNumber
    } = req.body;

    if (!userID || !items || totalPrice == null || !shippingAddress || orderTotal == null) {
      return res.status(400).json({ success: false, message: 'فیلدهای userID, items, totalPrice, shippingAddress و orderTotal الزامی‌اند.' });
    }

    let _orderMode = (orderMode || '').toString().toLowerCase();
    if (!['online', 'in_person'].includes(_orderMode)) _orderMode = 'online';
    if (_orderMode === 'in_person') {
      const tn = (tableNumber || '').toString().trim();
      if (!tn) return res.status(400).json({ success: false, message: 'در حالت in_person فیلد tableNumber اجباری است.' });
    }

    try { await pb.collection('user_shop').getOne(userID); }
    catch { return res.status(404).json({ success: false, message: 'کاربر در مجموعهٔ user_shop یافت نشد.' }); }

    if (couponCode) {
      try { await pb.collection('coupons').getOne(couponCode); }
      catch { return res.status(404).json({ success: false, message: 'کوپن یافت نشد.' }); }
    }

    const order = {
      userID,
      orderStatus,
      items,
      totalPrice,
      shippingAddress,
      couponCode: couponCode || null,
      orderTotal,
      trackingUrl: trackingUrl || '',
      phone_number_code: phone_number_code ? escPB(String(phone_number_code).trim()) : null,
      orderDate: new Date().toISOString(),
      orderMode: _orderMode,
      ...(_orderMode === 'in_person' ? { tableNumber: escPB(String(tableNumber || '').trim()) } : {})
    };

    await pb.collection('orders').create(order);
    res.status(201).json({ success: true, message: 'سفارش با موفقیت ثبت شد.', data: null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/orders/:id
app.put('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params; const { orderStatus, trackingUrl } = req.body;
    if (!orderStatus) return res.status(400).json({ success: false, message: 'فیلد orderStatus الزامی است.' });

    await pb.collection('orders').getOne(id);

    const updateData = { orderStatus };
    if (trackingUrl !== undefined) updateData.trackingUrl = trackingUrl;

    await pb.collection('orders').update(id, updateData);
    res.json({ success: true, message: 'سفارش با موفقیت بروزرسانی شد.', data: null });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, message: 'سفارش یافت نشد.' });
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/orders/:id
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pb.collection('orders').getOne(id);
    await pb.collection('orders').delete(id);
    res.json({ success: true, message: 'سفارش با موفقیت حذف شد.' });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, message: 'سفارش یافت نشد.' });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== USER SHOP & AUTH ==========
app.post('/api/user/check-or-create', async (req, res) => {
  try {
    const { uuid } = req.body;
    if (!uuid?.trim()) return res.status(400).json({ success: false, error: 'فیلد UUID الزامی است.' });
    const uid = String(uuid).trim();

    try {
      const existing = await pb.collection('user_shop').getFirstListItem(`uuid="${escPB(uid)}"`);
      return res.json({ success: true, user: existing, isNew: false });
    } catch (err) {
      if (err?.status !== 404) throw err;
      const newUser = await pb.collection('user_shop').create({
        uuid: uid, name: '', phone_number: '', birthday: '', address: '', lati: '', long: ''
      });
      return res.status(201).json({ success: true, user: { id: newUser.id, uuid: newUser.uuid }, isNew: true });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/user/update', async (req, res) => {
  try {
    const { id, uuid, name, phone_number, address, lati, long, birthday, phone_number_code } = req.body;
    if (!id || !uuid) return res.status(400).json({ success: false, error: 'فیلدهای ID و UUID الزامی هستند.' });

    const existing = await pb.collection('user_shop').getOne(id);
    if (existing.uuid !== uuid) {
      return res.status(403).json({ success: false, error: 'UUID با رکورد ارسالی تطابق ندارد.' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone_number !== undefined) updateData.phone_number = phone_number;
    if (address !== undefined) updateData.address = address;
    if (phone_number_code !== undefined) updateData.phone_number_code = phone_number_code;
    if (birthday !== undefined) updateData.birthday = birthday;
    if (lati !== undefined) updateData.lati = lati;
    if (long !== undefined) updateData.long = long;

    const updated = await pb.collection('user_shop').update(id, updateData);
    res.json({ success: true, user: updated });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ success: false, error: 'کاربر یافت نشد.' });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auth (سادهٔ تستی)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body || {};
    if (!phone_number || !password) {
      return res.status(400).json({ success: false, message: 'شماره تماس و رمز عبور الزامی هستند.' });
    }
    const phone = escPB(String(phone_number).trim());
    const pass  = String(password);

    let user;
    try {
      user = await pb.collection('user_bizi').getFirstListItem(`phone_number="${phone}"`, { requestKey: 'login_phone' });
    } catch (_) {
      return res.status(404).json({ success: false, message: 'ابتدا ثبت‌نام کنید.' });
    }
    if ((user?.password ?? '') !== pass) {
      return res.status(401).json({ success: false, message: 'رمز عبور نادرست است.' });
    }

    const record = { ...(user?.toJSON?.() ?? user) };
    if (record && typeof record === 'object') delete record.password;

    const fileOrNull = (f) => (f && String(f).trim() !== '' ? f : null);
    const iconLogoName = fileOrNull(record.icon_logo);
    const iconLocationName = fileOrNull(record.icon_location);

    record.icon_logo_url = iconLogoName ? buildFileUrlSafe(user, iconLogoName) : null;
    record.icon_location_url = iconLocationName ? buildFileUrlSafe(user, iconLocationName) : null;

    return res.status(200).json({ success: true, message: 'ورود موفق.', data: record });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'خطای داخلی سرور' });
  }
});

// manifest بر اساس دامنه یا شماره
const normalizeHost = (input = '') => {
  try {
    let raw = String(input).trim().toLowerCase();
    const hasProto = /^https?:\/\//i.test(raw);
    const url = new URL(hasProto ? raw : `https://${raw}`);
    let host = url.hostname.toLowerCase();
    host = host.replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
    return host;
  } catch {
    let host = String(input).trim().toLowerCase();
    return host.replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  }
};
const escapeFilterValue = (v = '') => String(v).replace(/(["\\])/g, '\\$1');



s
app.get('/app-manifest/:raw', async (req, res) => {
  try {
    const raw = (req.params.raw || '').trim();
    if (!raw) {
      return res.status(400).json({ success: false, error: 'پارامتر اجباری است.' });
    }

    // تشخیص اینکه ورودی دامنه است یا شماره تلفن
    const looksLikeHost = raw.includes('.');

    let filter;
    if (looksLikeHost) {
      const host = normalizeHost(raw);
      filter = `addr_host="${escapeFilterValue(host)}"`;
    } else {
      filter = `phone_number="${escapeFilterValue(raw)}"`;
    }

    let record = null;
    try {
      record = await pb.collection('user_bizi').getFirstListItem(filter);
    } catch (_) { /* نادیده بگیر */ }

    // اگر با www یا بدون www پیدا نشد، برعکسش رو هم امتحان کن
    if (!record && looksLikeHost) {
      const host = normalizeHost(raw);
      const alternateHost = host.startsWith('www.') 
        ? host.replace(/^www\./, '') 
        : `www.${host}`;
      try {
        record = await pb.collection('user_bizi').getFirstListItem(
          `addr_host="${escapeFilterValue(alternateHost)}"`
        );
      } catch (_) { /* نادیده بگیر */ }
    }

    if (!record) {
      return res.status(404).json({ success: false, error: 'تنظیمات اپ یافت نشد.' });
    }

    // ساخت آدرس آیکون‌ها با PUBLIC_PB_URL امن و encode شده
    const baseUrl = (process.env.PUBLIC_PB_URL || '').replace(/\/+$/, '');
    if (!baseUrl) {
      console.error('PUBLIC_PB_URL در .env تنظیم نشده است!');
    }

    const iconLogo = (record.icon_logo || '').toString().trim();
    const iconLocation = (record.icon_location || '').toString().trim();

    const appIconUrl = iconLogo
      ? `${baseUrl}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(iconLogo)}`
      : null;

    const appIconLocationUrl = iconLocation
      ? `${baseUrl}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(iconLocation)}`
      : null;

    // پاک کردن فیلدهای حساس و اضافه کردن آدرس آیکون‌ها
    const data = { ...record }; // کپی سطحی کافیه چون رکورد ساده است
    delete data.password; // امنیت!

    data.app_icon_url = appIconUrl;
    data.app_icon_location_url = appIconLocationUrl;

    return res.json({
      success: true,
      manifest: data
    });

  } catch (error) {
    console.error('خطا در /app-manifest:', error);
    return res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

setupRealtimeOrders();

// ---------- Start Server ----------
httpServer.listen(PORT, () => {
  console.log(`🚀 Unified API server running on http://localhost:${PORT}`);
  console.log('📡 Socket.IO در همان پورت در دسترس است.');
  console.log('💡 PocketBase URL:', PB_URL);
  console.log('🌱 Environment:', NODE_ENV);
  console.log('\n🏷️ Endpoints:');
  console.log('  • /api/brands');
  console.log('  • /api/categories');
  console.log('  • /api/subcategories');
  console.log('  • /api/variant-types');
  console.log('  • /api/variants');
  console.log('  • /api/products');
  console.log('  • /api/posters');
  console.log('  • /api/coupons');
  console.log('  • /api/orders');
  console.log('  • /api/auth/login');
  console.log('  • /app-manifest/:raw\n');
});
