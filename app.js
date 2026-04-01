/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  app.js — Emerald Market Mini App                        ║
 * ║  Всё взаимодействие: каталог, корзина, профиль           ║
 * ╚══════════════════════════════════════════════════════════╝
 */

/* ════════════════════════════════════════════════════════════
   ИНИЦИАЛИЗАЦИЯ TELEGRAM WEBAPP
════════════════════════════════════════════════════════════ */
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Данные пользователя из Telegram
const TG_USER     = tg.initDataUnsafe?.user || {};
const INIT_DATA   = tg.initData || "";
const API_BASE    = "";  // Пустая строка = тот же домен (Flask отдаёт и API и статику)

/* ════════════════════════════════════════════════════════════
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
════════════════════════════════════════════════════════════ */
const state = {
  currentPage:     "catalog",
  currentCategory: null,
  productOffset:   0,
  selectedProduct: null,
  commission:      0,
  orders:          { bought: [], sold: [] },
  favorites:       [],
  profile:         null,
};

/* ════════════════════════════════════════════════════════════
   API — Вспомогательная функция
════════════════════════════════════════════════════════════ */
async function api(path, options = {}) {
  try {
    const res = await fetch(API_BASE + "/api" + path, {
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": INIT_DATA,
        ...options.headers,
      },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("API error:", path, err);
    return null;
  }
}

/* ════════════════════════════════════════════════════════════
   НАВИГАЦИЯ МЕЖДУ СТРАНИЦАМИ
════════════════════════════════════════════════════════════ */
function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-" + pageId)?.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.page === pageId);
  });

  state.currentPage = pageId;

  // Lazy load при переходе
  if (pageId === "orders")    loadOrders();
  if (pageId === "favorites") loadFavorites();
  if (pageId === "profile")   loadProfile();
}

/* ════════════════════════════════════════════════════════════
   TOAST УВЕДОМЛЕНИЯ
════════════════════════════════════════════════════════════ */
function showToast(text, duration = 2500) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

/* ════════════════════════════════════════════════════════════
   СКЕЛЕТОН
════════════════════════════════════════════════════════════ */
function showSkeletons(containerId, count = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array(count).fill('<div class="skeleton skeleton-card"></div>').join("");
}

/* ════════════════════════════════════════════════════════════
   РЕНДЕР КАРТОЧКИ ТОВАРА (компактная)
════════════════════════════════════════════════════════════ */
function renderProductCard(p) {
  const boostedClass = p.is_boosted ? " boosted" : "";
  return `
    <div class="product-card${boostedClass}" onclick="openProduct(${p.id})">
      <div class="product-title">${escHtml(p.title)}</div>
      <div class="product-desc">${escHtml(p.description || "")}</div>
      <div class="product-footer">
        <div>
          <div class="product-price">${formatPrice(p.price)}</div>
          <div class="product-seller">@${escHtml(p.username || "—")}</div>
        </div>
        <div class="product-rating">
          ${"⭐".repeat(Math.round(p.rating || 5))}
          <br><small>${(p.rating || 5).toFixed(1)}</small>
        </div>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   ГЛАВНАЯ — КАТЕГОРИИ
════════════════════════════════════════════════════════════ */
async function loadCategories() {
  const data = await api("/categories");
  if (!data) return;

  const grid = document.getElementById("categories-grid");
  grid.innerHTML = data.categories.map(c => `
    <div class="category-card" onclick="openCategory('${c.key}', '${escHtml(c.label)}')">
      <div class="category-icon">${c.label.split(" ")[0]}</div>
      <div class="category-name">${c.label.replace(/^.\s/, "")}</div>
    </div>`
  ).join("");
}

/* ════════════════════════════════════════════════════════════
   ГЛАВНАЯ — ПОПУЛЯРНЫЕ ТОВАРЫ
════════════════════════════════════════════════════════════ */
async function loadPopularProducts() {
  showSkeletons("products-popular", 3);
  const data = await api("/products?limit=6");
  if (!data) return;

  const grid = document.getElementById("products-popular");
  if (!data.products.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🛍</div>
      <div class="empty-title">Товаров пока нет</div>
      <div class="empty-desc">Будь первым продавцом!</div>
    </div>`;
    return;
  }
  grid.innerHTML = data.products.map(renderProductCard).join("");
}

/* ════════════════════════════════════════════════════════════
   КАТАЛОГ КАТЕГОРИИ
════════════════════════════════════════════════════════════ */
function openCategory(key, label) {
  state.currentCategory = key;
  state.productOffset   = 0;
  document.getElementById("category-title").textContent = label;

  const container = document.getElementById("products-category");
  showSkeletons("products-category", 4);

  showPage("category");
  loadCategoryProducts(key, 0, false);
}

async function loadCategoryProducts(category, offset, append = false) {
  const data = await api(`/products?category=${category}&limit=10&offset=${offset}`);
  const container = document.getElementById("products-category");

  if (!data || !data.products.length) {
    if (!append) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Нет товаров</div>
        <div class="empty-desc">В этой категории пока пусто.</div>
      </div>`;
    }
    document.getElementById("btn-load-more").style.display = "none";
    return;
  }

  const html = data.products.map(renderProductCard).join("");
  if (append) container.insertAdjacentHTML("beforeend", html);
  else        container.innerHTML = html;

  document.getElementById("btn-load-more").style.display =
    data.products.length >= 10 ? "inline-block" : "none";
}

/* ════════════════════════════════════════════════════════════
   КАРТОЧКА ТОВАРА — детальный просмотр
════════════════════════════════════════════════════════════ */
async function openProduct(productId) {
  showPage("product");
  const detail = document.getElementById("product-detail");
  detail.innerHTML = `<div class="skeleton skeleton-card" style="height:200px;margin:16px"></div>`;

  const data = await api(`/products/${productId}`);
  if (!data || !data.product) {
    detail.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Товар не найден</div></div>`;
    return;
  }

  const p           = data.product;
  state.selectedProduct = p;
  const stars       = "⭐".repeat(Math.round(p.rating || 5));
  const isOwn       = TG_USER.id === p.seller_id;

  detail.innerHTML = `
    <div class="product-detail-wrap">
      <div class="product-detail-title">${escHtml(p.title)}</div>
      <div class="product-detail-price">${formatPrice(p.price)}</div>

      <div class="product-detail-section">
        <div class="detail-label">Описание</div>
        <div class="detail-value">${escHtml(p.description || "Нет описания")}</div>
      </div>

      <div class="product-detail-section">
        <div class="seller-block">
          <div class="seller-avatar">👤</div>
          <div>
            <div class="seller-name">@${escHtml(p.username || "—")}</div>
            <div class="seller-level">${escHtml(p.level || "🌱 Новичок")}</div>
          </div>
        </div>
        <div class="seller-stats">
          <div class="seller-stat">Рейтинг: <span>${stars} ${(p.rating||5).toFixed(1)}</span></div>
          <div class="seller-stat">Продаж: <span>${p.sales_count || 0}</span></div>
          <div class="seller-stat">Просмотров: <span>${p.views || 0}</span></div>
        </div>
      </div>

      <div class="product-actions">
        ${isOwn
          ? `<button class="btn btn-ghost" disabled>Это ваш товар</button>`
          : `<button class="btn btn-primary" onclick="startBuy(${p.id})">💳 Купить — ${formatPrice(p.price)}</button>
             <button class="btn btn-outline" onclick="addFavorite(${p.id})">⭐ В избранное</button>`
        }
        <button class="btn btn-ghost" onclick="reportProduct(${p.id})">🚩 Пожаловаться</button>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   ПОКУПКА
════════════════════════════════════════════════════════════ */
async function startBuy(productId) {
  const data = await api(`/products/${productId}`);
  if (!data) return;

  const p           = data.product;
  const commission  = state.commission;
  const com_amt     = p.price * commission;
  const total       = p.price + com_amt;

  document.getElementById("modal-buy-content").innerHTML = `
    <div class="modal-row">
      <span class="modal-row-label">Товар</span>
      <span class="modal-row-value">${escHtml(p.title)}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Продавец</span>
      <span class="modal-row-value">@${escHtml(p.username || "—")}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Цена</span>
      <span class="modal-row-value">${formatPrice(p.price)}</span>
    </div>
    ${commission > 0 ? `
    <div class="modal-row">
      <span class="modal-row-label">Комиссия (${(commission*100).toFixed(0)}%)</span>
      <span class="modal-row-value">${formatPrice(com_amt)}</span>
    </div>` : ""}
    <div class="modal-row">
      <span class="modal-row-label modal-total">Итого</span>
      <span class="modal-row-value modal-total">${formatPrice(total)}</span>
    </div>
    <p style="font-size:12px;color:var(--text-hint);margin-top:12px">
      ⚠️ Деньги будут заморожены до подтверждения получения.
    </p>`;

  document.getElementById("modal-btn-confirm").onclick = () => {
    closeBuyModal();
    // В Telegram Mini App оплата происходит через бот
    // Здесь открываем бот с командой покупки
    tg.sendData(JSON.stringify({ action: "buy", product_id: productId }));
    showToast("✅ Запрос на покупку отправлен в бот!");
  };

  document.getElementById("modal-overlay", "modal-buy").classList.add("open");
  document.getElementById("modal-buy").classList.add("open");
}

function closeBuyModal() {
  document.getElementById("modal-buy").classList.remove("open");
}

/* ════════════════════════════════════════════════════════════
   ИЗБРАННОЕ
════════════════════════════════════════════════════════════ */
async function addFavorite(productId) {
  if (!TG_USER.id) {
    showToast("❌ Авторизуйтесь через Telegram");
    return;
  }
  const data = await api(`/favorites/${productId}`, { method: "POST" });
  if (data?.added)    showToast("⭐ Добавлено в избранное!");
  else if (data)      showToast("Уже в избранном.");
  else                showToast("❌ Ошибка. Попробуйте снова.");
}

async function loadFavorites() {
  if (!TG_USER.id) {
    document.getElementById("favorites-list").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <div class="empty-title">Требуется авторизация</div>
        <div class="empty-desc">Открой Mini App через Telegram.</div>
      </div>`;
    return;
  }

  showSkeletons("favorites-list", 3);
  const data = await api("/favorites");
  const list = document.getElementById("favorites-list");

  if (!data || !data.favorites.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">⭐</div>
      <div class="empty-title">Избранное пусто</div>
      <div class="empty-desc">Нажимай ⭐ на понравившихся товарах.</div>
    </div>`;
    return;
  }

  list.innerHTML = data.favorites.map(renderProductCard).join("");
}

/* ════════════════════════════════════════════════════════════
   ЗАКАЗЫ
════════════════════════════════════════════════════════════ */
const STATUS_LABELS = {
  pending:   ["⏳ Ожидание",     "status-pending"],
  paid:      ["💳 Оплачен",      "status-paid"],
  done:      ["📦 Выполнен",     "status-done"],
  completed: ["✅ Завершён",     "status-completed"],
  cancelled: ["❌ Отменён",      "status-cancelled"],
  disputed:  ["⚠️ Спор",        "status-disputed"],
};

function renderOrderCard(o) {
  const [label, cls] = STATUS_LABELS[o.status] || ["❓ Unknown", "status-pending"];
  return `
    <div class="order-card">
      <div class="order-header">
        <span class="order-id">Заказ #${o.id} · ${o.created_at?.slice(0,10) || ""}</span>
        <span class="order-status ${cls}">${label}</span>
      </div>
      <div class="order-product">${escHtml(o.product_title || "Товар")}</div>
      <div class="order-amount">${formatPrice(o.amount)}</div>
    </div>`;
}

async function loadOrders() {
  if (!TG_USER.id) {
    document.getElementById("orders-list").innerHTML = `
      <div class="empty-state"><div class="empty-icon">🔒</div>
      <div class="empty-title">Требуется авторизация</div></div>`;
    return;
  }

  const data = await api("/orders");
  if (!data) return;

  state.orders = data;
  renderOrdersTab("bought");

  // Переключение вкладок
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      renderOrdersTab(t.dataset.tab);
    });
  });
}

function renderOrdersTab(tab) {
  const list   = document.getElementById("orders-list");
  const orders = state.orders[tab] || [];

  if (!orders.length) {
    const label = tab === "bought" ? "покупок" : "продаж";
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-title">Нет ${label}</div>
    </div>`;
    return;
  }
  list.innerHTML = orders.map(renderOrderCard).join("");
}

/* ════════════════════════════════════════════════════════════
   ПРОФИЛЬ
════════════════════════════════════════════════════════════ */
async function loadProfile() {
  if (!TG_USER.id) {
    document.getElementById("profile-content").innerHTML = `
      <div class="empty-state"><div class="empty-icon">🔒</div>
      <div class="empty-title">Открой Mini App через Telegram</div></div>`;
    return;
  }

  const data = await api("/profile");
  if (!data || !data.user) return;

  const u      = data.user;
  const stars  = "⭐".repeat(Math.round(u.rating || 5));
  const name   = TG_USER.first_name || u.full_name || "Пользователь";

  document.getElementById("profile-content").innerHTML = `
    <div class="profile-hero">
      <div class="profile-avatar">👤</div>
      <div class="profile-name">${escHtml(name)}</div>
      <div class="profile-level">${escHtml(u.level || "🌱 Новичок")}</div>
      <div class="profile-rating">${stars} ${(u.rating||5).toFixed(1)}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${u.sales || 0}</div>
        <div class="stat-label">Продаж</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${u.active_products || 0}</div>
        <div class="stat-label">Товаров</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatPriceShort(u.income || 0)}</div>
        <div class="stat-label">Доход</div>
      </div>
    </div>

    <div style="padding:0 16px">
      <div class="product-detail-section">
        <div class="detail-label">Аккаунт</div>
        <div class="detail-value">@${escHtml(u.username || "—")}</div>
      </div>
      <div class="product-detail-section">
        <div class="detail-label">На платформе с</div>
        <div class="detail-value">${u.joined_at?.slice(0,10) || "—"}</div>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   ПОИСК
════════════════════════════════════════════════════════════ */
let searchTimeout = null;

document.getElementById("btn-search").addEventListener("click", () => {
  document.getElementById("search-bar").classList.add("visible");
  document.getElementById("search-input").focus();
});

document.getElementById("btn-search-close").addEventListener("click", () => {
  document.getElementById("search-bar").classList.remove("visible");
  document.getElementById("search-input").value = "";
});

document.getElementById("search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) return;

  searchTimeout = setTimeout(async () => {
    showPage("category");
    document.getElementById("category-title").textContent = `🔍 "${q}"`;
    showSkeletons("products-category", 3);

    const data = await api(`/products?search=${encodeURIComponent(q)}&limit=20`);
    const container = document.getElementById("products-category");

    if (!data || !data.products.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Ничего не найдено</div>
        <div class="empty-desc">Попробуй другой запрос.</div>
      </div>`;
      return;
    }
    container.innerHTML = data.products.map(renderProductCard).join("");
    document.getElementById("btn-load-more").style.display = "none";
  }, 400);
});

/* ════════════════════════════════════════════════════════════
   ЖАЛОБА
════════════════════════════════════════════════════════════ */
function reportProduct(productId) {
  tg.showConfirm(
    "Вы уверены, что хотите пожаловаться на этот товар?",
    (confirmed) => {
      if (confirmed) showToast("🚩 Жалоба отправлена.");
    }
  );
}

/* ════════════════════════════════════════════════════════════
   НИЖНЯЯ НАВИГАЦИЯ
════════════════════════════════════════════════════════════ */
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

/* ════════════════════════════════════════════════════════════
   КНОПКИ "НАЗАД"
════════════════════════════════════════════════════════════ */
document.getElementById("btn-back-catalog").addEventListener("click", () => {
  showPage("catalog");
});
document.getElementById("btn-back-products").addEventListener("click", () => {
  // Вернуться на предыдущую страницу (категория или каталог)
  if (state.currentCategory) showPage("category");
  else showPage("catalog");
});
document.getElementById("btn-see-all").addEventListener("click", () => {
  openCategory("", "🔥 Все товары");
});
document.getElementById("btn-load-more").addEventListener("click", () => {
  state.productOffset += 10;
  loadCategoryProducts(state.currentCategory, state.productOffset, true);
});

/* ════════════════════════════════════════════════════════════
   МОДАЛКА — закрыть по оверлею
════════════════════════════════════════════════════════════ */
document.getElementById("modal-buy").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeBuyModal();
});
document.getElementById("modal-btn-cancel").addEventListener("click", closeBuyModal);

/* ════════════════════════════════════════════════════════════
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
════════════════════════════════════════════════════════════ */
function formatPrice(p) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 0
  }).format(p);
}

function formatPriceShort(p) {
  if (p >= 1000) return (p / 1000).toFixed(1) + "k₽";
  return p.toFixed(0) + "₽";
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ════════════════════════════════════════════════════════════
   TELEGRAM WEBAPP — ТЕМА
════════════════════════════════════════════════════════════ */
function applyTgTheme() {
  const theme = tg.colorScheme;
  // Наша тема всегда тёмная, но можно адаптировать
  document.documentElement.setAttribute("data-theme", theme);
}
applyTgTheme();
tg.onEvent("themeChanged", applyTgTheme);

/* ════════════════════════════════════════════════════════════
   ЗАПУСК
════════════════════════════════════════════════════════════ */
async function init() {
  // Загрузить комиссию
  const comData = await api("/commission");
  if (comData) state.commission = comData.commission;

  // Загрузить каталог
  await Promise.all([loadCategories(), loadPopularProducts()]);

  // Кнопка "Назад" в Telegram
  tg.BackButton.onClick(() => {
    const pages = ["product", "category", "orders", "favorites", "profile"];
    const i     = pages.indexOf(state.currentPage);
    if (i >= 0) showPage("catalog");
    else        tg.close();
  });
}

init().catch(console.error);
