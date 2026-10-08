/* ===== MENING MAGAZINIM — dastur mantig‘i ===== */
(() => {
  'use strict';

  /* ---------- Yordamchi funksiyalar ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const KEY_DATA = 'mening-magazinim:data:v1';       // mahsulotlar, sotuvlar, pul
  const KEY_ACCOUNTS = 'mening-magazinim:accounts:v1'; // telefon -> parol xeshi
  const KEY_SESSION = 'mening-magazinim:session';    // joriy sessiya (sessionStorage)

  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const som = (n) => `${fmt(n)} so'm`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fmtDate = (t) => new Date(t).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function toast(text, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function hashPassword(pw) {
    const text = 'mm:' + pw;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; // zaxira usul (juda eski brauzerlar uchun)
    for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
    return 'x' + h;
  }

  /* ---------- Ma'lumotlar ---------- */
  function seedState() {
    const now = Date.now();
    const mk = (name, price, cost, qty) => ({ id: uid(), name, image: '', price, cost, qty, addedAt: now });
    return {
      startMoney: 5000000,
      products: [
        mk('Coca-Cola 1.5 L', 14000, 10500, 24),
        mk('Non (tandir)', 4000, 2800, 40),
        mk('Sut 1 L', 11000, 8500, 18),
        mk('Shakar 1 kg', 13000, 10500, 30),
        mk('Choy 100 g', 18000, 14000, 12),
        mk('Guruch 1 kg', 16000, 12500, 25),
      ],
      sales: [],
      removed: [],
    };
  }

  function loadState() {
    const saved = readJSON(KEY_DATA, null);
    if (saved && Array.isArray(saved.products)) {
      return { startMoney: 0, sales: [], removed: [], ...saved };
    }
    return seedState();
  }

  let state = loadState();

  function save() {
    try {
      localStorage.setItem(KEY_DATA, JSON.stringify(state));
      return true;
    } catch (_) {
      toast("Brauzer xotirasi to'ldi. Rasmni kichikroq tanlang yoki keraksiz mahsulotlarni o'chiring.", 'error');
      return false;
    }
  }

  const salesMoney = () => state.sales.reduce((sum, s) => sum + s.price, 0);
  const totalMoney = () => state.startMoney + salesMoney();
  const findProduct = (id) => state.products.find((p) => p.id === id);

  /* ---------- Rasm ---------- */
  function placeholder(name) {
    const colors = ['#0B8A6F', '#B86E00', '#2F5D9E', '#8A4FA3', '#B4452F', '#3C7A89'];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const ch = esc((name.trim()[0] || '?').toUpperCase());
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>` +
      `<rect width='200' height='200' fill='${colors[h % colors.length]}'/>` +
      `<text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' ` +
      `font-family='sans-serif' font-size='96' font-weight='700' fill='white'>${ch}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  const imgOf = (p) => p.image || placeholder(p.name);

  // Rasmni kichraytirib, xotirada joy tejash uchun JPEG ga o'tkazadi
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Rasmni o'qib bo'lmadi"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Bu fayl rasm emas"));
        img.onload = () => {
          const max = 480;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* =====================================================
     1. KIRISH + SMS TASDIQLASH
     ===================================================== */
  const authEl = $('#auth');
  const appEl = $('#app');
  const loginForm = $('#loginForm');
  const smsForm = $('#smsForm');
  const phoneInput = $('#phone');
  const passwordInput = $('#password');
  const loginError = $('#loginError');
  const smsError = $('#smsError');
  const codeRow = $('#codeRow');
  const resendBtn = $('#resendBtn');

  let pending = { phone: '', hash: '', code: '', expires: 0 };
  let resendTimer = null;

  // 6 ta kod katakchasini yaratish
  const codeInputs = Array.from({ length: 6 }, (_, i) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 1;
    input.autocomplete = i === 0 ? 'one-time-code' : 'off';
    input.setAttribute('aria-label', `${i + 1}-raqam`);
    codeRow.appendChild(input);
    return input;
  });

  const enteredCode = () => codeInputs.map((i) => i.value).join('');

  codeInputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && i < 5) codeInputs[i + 1].focus();
      if (enteredCode().length === 6) smsForm.requestSubmit();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) codeInputs[i - 1].focus();
    });
    input.addEventListener('paste', (e) => {
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      e.preventDefault();
      digits.split('').forEach((d, k) => { codeInputs[k].value = d; });
      codeInputs[Math.min(digits.length, 5)].focus();
      if (digits.length === 6) smsForm.requestSubmit();
    });
  });

  // Telefon raqamini "90 123 45 67" ko'rinishida yozish
  phoneInput.addEventListener('input', () => {
    const d = phoneInput.value.replace(/\D/g, '').slice(0, 9);
    phoneInput.value = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)]
      .filter(Boolean).join(' ');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const digits = phoneInput.value.replace(/\D/g, '');
    const password = passwordInput.value;

    if (digits.length !== 9) {
      loginError.textContent = "Telefon raqami 9 ta raqamdan iborat bo'lishi kerak (masalan: 90 123 45 67).";
      return;
    }
    if (password.length < 4) {
      loginError.textContent = "Parol kamida 4 ta belgidan iborat bo'lsin.";
      return;
    }

    const phone = '+998' + digits;
    const hash = await hashPassword(password);
    const accounts = readJSON(KEY_ACCOUNTS, {});

    if (accounts[phone] && accounts[phone] !== hash) {
      loginError.textContent = "Parol noto'g'ri.";
      return;
    }

    pending = { phone, hash, code: '', expires: 0 };
    sendCode();
    loginForm.hidden = true;
    smsForm.hidden = false;
    codeInputs[0].focus();
  });

  function sendCode() {
    // DEMO: haqiqiy SMS yuborish uchun server va SMS xizmati kerak (README ga qarang)
    pending.code = String(Math.floor(100000 + Math.random() * 900000));
    pending.expires = Date.now() + 2 * 60 * 1000;
    $('#smsInfo').textContent = `${pending.phone} raqamiga 6 xonali tasdiqlash kodi yuborildi. Kod 2 daqiqa amal qiladi.`;
    $('#demoCode').textContent = `Demo rejim: SMS haqiqatda yuborilmaydi. Kod: ${pending.code}`;
    smsError.textContent = '';
    codeInputs.forEach((i) => { i.value = ''; });
    startResendCooldown(30);
  }

  function startResendCooldown(seconds) {
    clearInterval(resendTimer);
    let left = seconds;
    resendBtn.disabled = true;
    resendBtn.textContent = `Kodni qayta yuborish (${left})`;
    resendTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(resendTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Kodni qayta yuborish';
      } else {
        resendBtn.textContent = `Kodni qayta yuborish (${left})`;
      }
    }, 1000);
  }

  resendBtn.addEventListener('click', () => { sendCode(); codeInputs[0].focus(); });

  $('#backBtn').addEventListener('click', () => {
    clearInterval(resendTimer);
    smsForm.hidden = true;
    loginForm.hidden = false;
    passwordInput.value = '';
  });

  smsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    smsError.textContent = '';
    const code = enteredCode();
    if (code.length !== 6) { smsError.textContent = "6 xonali kodni to'liq kiriting."; return; }
    if (Date.now() > pending.expires) { smsError.textContent = 'Kod muddati tugadi. Qayta yuboring.'; return; }
    if (code !== pending.code) { smsError.textContent = "Kod noto'g'ri."; return; }

    const accounts = readJSON(KEY_ACCOUNTS, {});
    if (!accounts[pending.phone]) {
      accounts[pending.phone] = pending.hash; // birinchi kirish: hisob yaratiladi
      try { localStorage.setItem(KEY_ACCOUNTS, JSON.stringify(accounts)); } catch (_) { /* e'tiborsiz */ }
    }
    sessionStorage.setItem(KEY_SESSION, pending.phone);
    clearInterval(resendTimer);
    enterApp(pending.phone);
  });

  function enterApp(phone) {
    authEl.hidden = true;
    appEl.hidden = false;
    $('#userPhone').textContent = phone;
    renderAll();
  }

  $('#logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(KEY_SESSION);
    location.reload();
  });

  /* =====================================================
     2. RENDER (ekranga chiqarish)
     ===================================================== */
  let activeTab = 'stock';

  function renderAll() {
    renderMoney();
    renderStats();
    renderTabs();
    renderSearch();
  }

  // --- Umumiy pul ---
  function renderMoney() {
    $('#moneyValue').textContent = som(totalMoney());
    $('#startMoneyText').textContent = som(state.startMoney);
    $('#salesMoneyText').textContent = som(salesMoney());
  }

  $('#editMoney').addEventListener('click', () => {
    const v = prompt("Boshlang'ich pul miqdorini kiriting (so'm):", state.startMoney);
    if (v === null) return;
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) { toast("Noto'g'ri son kiritildi", 'error'); return; }
    state.startMoney = n;
    save();
    renderMoney();
    toast('Boshlang\'ich pul yangilandi', 'ok');
  });

  // --- Qidiruv ---
  const searchInput = $('#searchInput');
  const resultsEl = $('#searchResults');
  searchInput.addEventListener('input', renderSearch);

  function resultCard(p) {
    const profit = p.price - p.cost;
    const sold = state.sales.filter((s) => s.productId === p.id).length;
    const out = p.qty <= 0;
    return `
      <article class="result ${out ? 'is-out' : ''}">
        <img class="thumb" src="${imgOf(p)}" alt="${esc(p.name)}">
        <div class="r-body">
          <h3>${esc(p.name)}</h3>
          <div class="prices">
            <div><span>Sotuv narxi</span><b>${som(p.price)}</b></div>
            <div><span>Asosiy narxi</span><b class="muted">${som(p.cost)}</b></div>
          </div>
          <ul class="facts">
            <li>Omborda: <b>${p.qty} dona</b></li>
            <li>Foyda: <b class="${profit < 0 ? 'neg' : 'pos'}">${profit >= 0 ? '+' : ''}${som(profit)}</b> / dona</li>
            <li>Sotilgan: <b>${sold} dona</b></li>
            <li>Qo'shilgan: ${fmtDate(p.addedAt)}</li>
          </ul>
        </div>
        <div class="r-actions">
          <button class="btn sell" type="button" data-act="sell" data-id="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Tugagan' : 'Sotish'}</button>
          <button class="btn ghost danger" type="button" data-act="delete" data-id="${p.id}">O'chirish</button>
        </div>
      </article>`;
  }

  function renderSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      const n = state.products.filter((p) => p.qty > 0).length;
      resultsEl.innerHTML = `<p class="empty">Mahsulot nomini yozing — natijalar shu yerda chiqadi.<br>Omborda hozir <b>${n} xil</b> mahsulot bor.</p>`;
      return;
    }
    const found = state.products.filter((p) => p.name.toLowerCase().includes(q));
    if (!found.length) {
      resultsEl.innerHTML = `<p class="empty"><b>“${esc(searchInput.value.trim())}”</b> bo'yicha mahsulot topilmadi.<br>Pastdagi panel orqali yangi mahsulot qo'shing.</p>`;
      return;
    }
    resultsEl.innerHTML =
      `<p class="results-count">${found.length} ta natija</p>` + found.map(resultCard).join('');
  }

  // --- Hamma narsa ---
  function renderStats() {
    const inStock = state.products.filter((p) => p.qty > 0);
    const pieces = inStock.reduce((s, p) => s + p.qty, 0);
    const stockValue = inStock.reduce((s, p) => s + p.qty * p.cost, 0);
    const profit = state.sales.reduce((s, x) => s + (x.price - x.cost), 0);
    const items = [
      ['Mahsulot turi', inStock.length],
      ['Jami dona', fmt(pieces)],
      ['Ombor qiymati', som(stockValue)],
      ['Sotilgan dona', state.sales.length],
      ['Sof foyda', som(profit)],
    ];
    $('#stats').innerHTML = items.map(([l, v]) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`).join('');
  }

  function renderTabs() {
    const inStock = state.products.filter((p) => p.qty > 0);
    const gone = state.products.filter((p) => p.qty <= 0).length + state.removed.length;
    const labels = {
      stock: `Mavjud (${inStock.length})`,
      sold: `Sotilgan (${state.sales.length})`,
      gone: `Tugagan va o'chirilgan (${gone})`,
    };
    $$('.tab').forEach((t) => {
      t.textContent = labels[t.dataset.tab];
      const on = t.dataset.tab === activeTab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on);
    });
    renderList();
  }

  function renderList() {
    const el = $('#tabList');
    let html = '';

    if (activeTab === 'stock') {
      const list = state.products.filter((p) => p.qty > 0);
      html = list.map((p) => `
        <div class="row">
          <img src="${imgOf(p)}" alt="">
          <div>
            <div class="row-name">${esc(p.name)}</div>
            <div class="row-sub">${p.qty} dona · asosiy narxi ${som(p.cost)}</div>
          </div>
          <div class="row-end">
            <div class="row-price">${som(p.price)}<small>sotuv narxi</small></div>
            <button class="btn small sell" type="button" data-act="sell" data-id="${p.id}">Sotish</button>
            <button class="btn small ghost danger" type="button" data-act="delete" data-id="${p.id}">O'chirish</button>
          </div>
        </div>`).join('');
      if (!html) html = `<p class="empty">Omborda mahsulot yo'q. O'ng tomondagi panel orqali mahsulot qo'shing.</p>`;

    } else if (activeTab === 'sold') {
      const list = [...state.sales].reverse().slice(0, 300);
      html = list.map((s) => {
        const p = findProduct(s.productId);
        const profit = s.price - s.cost;
        return `
        <div class="row">
          <img src="${p ? imgOf(p) : placeholder(s.name)}" alt="">
          <div>
            <div class="row-name">${esc(s.name)}</div>
            <div class="row-sub">${fmtDate(s.at)} · foyda ${profit >= 0 ? '+' : ''}${som(profit)}</div>
          </div>
          <div class="row-end"><div class="row-price">+${som(s.price)}<small>1 dona</small></div></div>
        </div>`;
      }).join('');
      if (!html) html = `<p class="empty">Hali hech narsa sotilmagan. Qidiruvdan mahsulotni topib “Sotish” tugmasini bosing.</p>`;

    } else {
      const outOfStock = state.products.filter((p) => p.qty <= 0).map((p) => `
        <div class="row">
          <img src="${imgOf(p)}" alt="">
          <div>
            <div class="row-name">${esc(p.name)}<span class="tag out">Tugagan</span></div>
            <div class="row-sub">Hammasi sotilgan · ${som(p.price)}</div>
          </div>
          <div class="row-end">
            <button class="btn small ghost danger" type="button" data-act="delete" data-id="${p.id}">O'chirish</button>
          </div>
        </div>`);
      const removed = [...state.removed].reverse().map((r) => `
        <div class="row">
          <img src="${r.image || placeholder(r.name)}" alt="">
          <div>
            <div class="row-name">${esc(r.name)}<span class="tag del">O'chirilgan</span></div>
            <div class="row-sub">${fmtDate(r.at)} · ${r.qty} dona qolgan edi</div>
          </div>
          <div class="row-end"></div>
        </div>`);
      html = outOfStock.concat(removed).join('');
      if (!html) html = `<p class="empty">Tugagan yoki o'chirilgan mahsulot yo'q.</p>`;
    }
    el.innerHTML = html;
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    activeTab = t.dataset.tab;
    renderTabs();
  }));

  /* =====================================================
     3. AMALLAR: sotish, o'chirish
     ===================================================== */
  function sell(id) {
    const p = findProduct(id);
    if (!p || p.qty <= 0) return;
    p.qty -= 1;
    state.sales.push({
      id: uid(), productId: p.id, name: p.name,
      price: p.price, cost: p.cost, at: Date.now(),
    });
    save();
    renderAll();
    toast(`${p.name} sotildi: +${som(p.price)}`, 'ok');
  }

  function removeProduct(id) {
    const p = findProduct(id);
    if (!p) return;
    if (!confirm(`“${p.name}” mahsulotini o'chirishni xohlaysizmi?`)) return;
    state.products = state.products.filter((x) => x.id !== id);
    state.removed.push({ id: p.id, name: p.name, image: p.image, qty: p.qty, at: Date.now() });
    if (state.removed.length > 50) state.removed.shift();
    save();
    renderAll();
    toast(`${p.name} o'chirildi`);
  }

  // Qidiruv natijalari va ro'yxatlardagi tugmalar
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'sell') sell(btn.dataset.id);
    if (btn.dataset.act === 'delete') removeProduct(btn.dataset.id);
  });

  $('#resetAll').addEventListener('click', () => {
    if (!confirm("Barcha mahsulotlar, sotuvlar va pul hisobi o'chiriladi. Davom etasizmi?")) return;
    state = { startMoney: 0, products: [], sales: [], removed: [] };
    save();
    renderAll();
    toast("Barcha ma'lumotlar tozalandi");
  });

  /* =====================================================
     4. MAHSULOT QO'SHISH
     ===================================================== */
  const addForm = $('#addForm');
  const pName = $('#pName');
  const pPrice = $('#pPrice');
  const pCost = $('#pCost');
  const pQty = $('#pQty');
  const pImage = $('#pImage');
  const imgPreview = $('#imgPreview');
  const imgClear = $('#imgClear');
  const addError = $('#addError');
  const profitPreview = $('#profitPreview');

  let pendingImage = '';
  let imageBusy = false;

  function clearImage() {
    pendingImage = '';
    pImage.value = '';
    imgPreview.hidden = true;
    imgPreview.removeAttribute('src');
    imgClear.hidden = true;
  }

  pImage.addEventListener('change', async () => {
    const file = pImage.files[0];
    if (!file) return;
    imageBusy = true;
    try {
      pendingImage = await readImage(file);
      imgPreview.src = pendingImage;
      imgPreview.hidden = false;
      imgClear.hidden = false;
    } catch (err) {
      clearImage();
      toast(err.message, 'error');
    } finally {
      imageBusy = false;
    }
  });
  imgClear.addEventListener('click', clearImage);

  function updateProfitPreview() {
    const price = parseFloat(pPrice.value);
    const cost = parseFloat(pCost.value);
    profitPreview.className = 'profit-preview';
    if (!Number.isFinite(price) || !Number.isFinite(cost)) { profitPreview.textContent = ''; return; }
    const diff = price - cost;
    profitPreview.textContent = diff >= 0
      ? `Bitta donadan foyda: ${som(diff)}`
      : `Diqqat: sotuv narxi asosiy narxdan past (zarar: ${som(-diff)})`;
    profitPreview.classList.add(diff >= 0 ? 'pos' : 'neg');
  }
  pPrice.addEventListener('input', updateProfitPreview);
  pCost.addEventListener('input', updateProfitPreview);

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addError.textContent = '';

    const name = pName.value.trim();
    const price = parseFloat(pPrice.value);
    const cost = parseFloat(pCost.value);
    const qty = parseInt(pQty.value, 10);

    if (!name) { addError.textContent = 'Mahsulot nomini kiriting.'; pName.focus(); return; }
    if (!Number.isFinite(price) || price < 0) { addError.textContent = "Sotuv narxini to'g'ri kiriting."; pPrice.focus(); return; }
    if (!Number.isFinite(cost) || cost < 0) { addError.textContent = "Asosiy narxni to'g'ri kiriting."; pCost.focus(); return; }
    if (!Number.isInteger(qty) || qty < 1) { addError.textContent = "Mahsulot soni kamida 1 bo'lsin."; pQty.focus(); return; }
    if (imageBusy) { addError.textContent = 'Rasm yuklanmoqda, bir soniya kuting.'; return; }

    const product = { id: uid(), name, image: pendingImage, price, cost, qty, addedAt: Date.now() };
    state.products.push(product);
    if (!save()) { state.products.pop(); return; }

    addForm.reset();
    clearImage();
    updateProfitPreview();
    renderAll();
    toast(`${name} qo'shildi (${qty} dona)`, 'ok');
    pName.focus();
  });

  /* =====================================================
     5. BOSHLASH
     ===================================================== */
  const session = sessionStorage.getItem(KEY_SESSION);
  if (session) {
    enterApp(session);       // sahifa yangilansa, shu sessiyada qayta kirish shart emas
  } else {
    authEl.hidden = false;   // sayt ochilganda birinchi bo'lib login oynasi chiqadi
  }
})();