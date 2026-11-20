import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";

const TIMES = Array.from({ length: 12 }, (_, index) => `${String(index + 10).padStart(2, "0")}:00`);
const STATUS = {
  WAITING: "Menunggu",
  SERVING: "Sedang Dicukur",
  DONE: "Selesai",
  CANCELLED: "Batal"
};
const configReady = CONFIG.supabaseUrl.startsWith("https://") &&
  CONFIG.supabaseAnonKey.length > 20 &&
  !CONFIG.supabaseUrl.includes("PROJECT_REF") &&
  !CONFIG.supabaseAnonKey.includes("YOUR_SUPABASE");
const supabase = configReady
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
  : null;

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setDateBounds(input) {
  if (!input) return;
  const today = new Date();
  const latest = new Date(today);
  latest.setDate(latest.getDate() + 60);
  input.min = localDateString(today);
  input.max = localDateString(latest);
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(dateString) {
  if (!dateString) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(`${dateString}T00:00:00`));
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function statusClass(status) {
  if (status === STATUS.SERVING) return "border-sky-900 bg-sky-950/60 text-sky-300";
  if (status === STATUS.DONE) return "border-emerald-900 bg-emerald-950/50 text-emerald-300";
  if (status === STATUS.CANCELLED) return "border-red-900 bg-red-950/50 text-red-300";
  return "border-amber-900 bg-amber-950/50 text-amber-300";
}

function showMessage(element, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
}

function hideMessage(element) {
  if (!element) return;
  element.classList.add("hidden");
  element.textContent = "";
}

function errorMessage(error) {
  const message = error && error.message ? error.message : "Terjadi kesalahan yang tidak diketahui.";
  if (message.includes("SLOT_TAKEN")) return "Slot baru saja dipesan pelanggan lain. Silakan pilih slot yang masih tersedia.";
  if (message.includes("BARBER_DAY_OFF")) return "Kapster libur pada tanggal tersebut. Silakan pilih tanggal atau kapster lain.";
  if (message.includes("NOT_STAFF")) return "Akun ini tidak memiliki hak akses kasir.";
  if (message.includes("NOT_OWNER")) return "Fitur ini hanya dapat digunakan oleh Admin/Owner.";
  if (message.includes("INVALID_BOOKING")) return "Data booking tidak valid atau layanan/kapster sudah tidak aktif.";
  if (message.includes("INVALID_TRANSITION")) return "Perubahan status tidak valid. Muat ulang daftar dan coba kembali.";
  if (message.includes("PAYMENT_NOT_ALLOWED")) return "Pembayaran hanya dapat dikonfirmasi untuk booking yang sudah selesai.";
  if (message.includes("INVALID_MASTER")) return "Data pengaturan tidak valid.";
  if (message.includes("Invalid login credentials")) return "Email atau password salah.";
  if (message.includes("duplicate key")) return "Data dengan nama tersebut sudah ada.";
  return message;
}

function requireSupabase(errorElement) {
  if (supabase) return true;
  showMessage(errorElement, "Supabase belum dikonfigurasi. Isi URL dan anon key di config.js, jalankan supabase-setup.sql, lalu muat ulang.");
  return false;
}

function toWhatsAppNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function whatsappUrl(number, message) {
  const recipient = toWhatsAppNumber(number);
  const destination = recipient ? `/${recipient}` : "/";
  return `https://wa.me${destination}?text=${encodeURIComponent(message)}`;
}

function ticketMessage(booking) {
  return [
    "Halo Garis Barber, berikut tiket booking saya:",
    `Kode antrian: ${booking.code}`,
    `Layanan: ${booking.service}`,
    `Kapster: ${booking.barber}`,
    `Tanggal: ${formatDate(booking.date)}`,
    `Jam: ${booking.time}`,
    `Harga: ${formatRupiah(booking.price)}`
  ].join("\n");
}

async function getActiveMasters() {
  const [barbersResult, servicesResult] = await Promise.all([
    supabase.from("barbers").select("id,name,active").eq("active", true).order("name"),
    supabase.from("services").select("id,name,price,active").eq("active", true).order("name")
  ]);
  if (barbersResult.error) throw barbersResult.error;
  if (servicesResult.error) throw servicesResult.error;
  return { barbers: barbersResult.data || [], services: servicesResult.data || [] };
}

function initCustomerPage() {
  const form = document.getElementById("booking-form");
  const dateInput = document.getElementById("booking-date");
  const barberInput = document.getElementById("booking-barber");
  const serviceInput = form.elements.namedItem("service");
  const slotsContainer = document.getElementById("booking-slots");
  const slotHint = document.getElementById("slot-hint");
  const errorBox = document.getElementById("booking-error");
  const queueContainer = document.getElementById("customer-queue");
  const modal = document.getElementById("ticket-modal");
  const ticketContent = document.getElementById("ticket-content");
  const lookupForm = document.getElementById("status-lookup-form");
  const lookupInput = document.getElementById("status-lookup");
  const lookupResult = document.getElementById("status-lookup-result");
  const lookupError = document.getElementById("status-lookup-error");
  const priceCard = document.getElementById("service-prices");
  const publicPriceList = document.getElementById("service-prices-list");
  let masters = { barbers: [], services: [] };
  let daysOff = [];
  let slotRequest = 0;
  let queueRequest = 0;
  let realtimeChannels = [];

  if (!form || !dateInput || !barberInput || !slotsContainer) return;

  setDateBounds(dateInput);
  dateInput.value = localDateString(new Date());
  document.getElementById("current-year").textContent = String(new Date().getFullYear());
  const businessNumber = CONFIG.barberWhatsAppNumber || "";
  const mapFrame = document.getElementById("barber-map");
  if (mapFrame && CONFIG.googleMapsEmbedUrl) mapFrame.src = CONFIG.googleMapsEmbedUrl;

  function renderMasters() {
    const previousBarber = barberInput.value;
    const previousService = serviceInput.value;
    barberInput.innerHTML = '<option value="" disabled selected>Pilih barber</option>' +
      masters.barbers.map((barber) => `<option value="${escapeHtml(barber.name)}">${escapeHtml(barber.name)}</option>`).join("");
    serviceInput.innerHTML = '<option value="" disabled selected>Pilih layanan</option>' +
      masters.services.map((service) => `<option value="${escapeHtml(service.name)}" data-price="${Number(service.price)}">${escapeHtml(service.name)} · ${escapeHtml(formatRupiah(service.price))}</option>`).join("");
    if (masters.barbers.some((barber) => barber.name === previousBarber)) barberInput.value = previousBarber;
    if (masters.services.some((service) => service.name === previousService)) serviceInput.value = previousService;
    if (masters.barbers.length === 0 || masters.services.length === 0) {
      showMessage(errorBox, "Booking belum tersedia: Admin/Owner perlu menambahkan kapster dan layanan aktif.");
    }
    const priceContent = masters.services.map((service) => `<div class="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs"><span class="block text-zinc-400">${escapeHtml(service.name)}</span><strong class="mt-1 block text-amber-400">${escapeHtml(formatRupiah(service.price))}</strong></div>`).join("");
    priceCard.innerHTML = priceContent;
    publicPriceList.innerHTML = masters.services.map((service) => `<div class="flex justify-between gap-3"><span class="text-zinc-400">${escapeHtml(service.name)}</span><span class="font-semibold text-amber-400">${escapeHtml(formatRupiah(service.price))}</span></div>`).join("");
    renderSlots();
  }

  async function loadMasters() {
    const data = await getActiveMasters();
    const today = localDateString(new Date());
    const latest = new Date();
    latest.setDate(latest.getDate() + 60);
    const { data: holidays, error } = await supabase.from("barber_days_off")
      .select("id,barber_id,off_date,note,barbers(name)")
      .gte("off_date", today).lte("off_date", localDateString(latest));
    if (error) throw error;
    masters = data;
    daysOff = holidays || [];
    renderMasters();
  }

  function dateIsOff(barberName, date) {
    const barber = masters.barbers.find((item) => item.name === barberName);
    return Boolean(barber && daysOff.some((day) => day.barber_id === barber.id && day.off_date === date));
  }

  async function renderSlots() {
    const requestId = ++slotRequest;
    const date = dateInput.value;
    const barber = barberInput.value;
    slotsContainer.replaceChildren();
    form.querySelectorAll('input[name="time"]').forEach((input) => input.remove());
    if (!date || !barber) {
      slotHint.textContent = "Pilih tanggal dan barber untuk melihat slot yang tersedia.";
      return;
    }
    if (!requireSupabase(errorBox)) return;
    slotHint.textContent = "Memeriksa slot terbaru…";
    try {
      const { data, error } = await supabase.rpc("get_taken_slots", { p_date: date, p_barber: barber });
      if (error) throw error;
      if (requestId !== slotRequest) return;
      const unavailable = new Map((data || []).filter((row) => row.is_taken).map((row) => [row.time, row.reason]));
      slotHint.textContent = dateIsOff(barber, date) ? `${barber} libur pada tanggal ini.` : "Pilih salah satu slot yang masih tersedia.";
      TIMES.forEach((time, index) => {
        const id = `slot-${index}`;
        const input = document.createElement("input");
        input.className = "slot-option peer sr-only";
        input.type = "radio";
        input.name = "time";
        input.id = id;
        input.value = time;
        input.required = true;
        input.disabled = unavailable.has(time);
        const label = document.createElement("label");
        label.htmlFor = id;
        label.className = "cursor-pointer rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2.5 text-center text-sm font-semibold text-zinc-300 transition hover:border-amber-500 peer-checked:border-amber-500 peer-checked:bg-amber-500 peer-checked:text-zinc-950";
        label.textContent = input.disabled ? `${time} · ${unavailable.get(time) || "Penuh"}` : time;
        slotsContainer.append(input, label);
      });
    } catch (error) {
      console.error("Gagal memuat slot booking.", error);
      slotHint.textContent = "Slot tidak dapat dimuat. Periksa koneksi dan coba lagi.";
      showMessage(errorBox, errorMessage(error));
    }
  }

  function renderQueue(bookings) {
    const activeBookings = (bookings || []).filter((booking) => booking.status !== STATUS.CANCELLED)
      .sort((a, b) => a.time.localeCompare(b.time));
    if (activeBookings.length === 0) {
      queueContainer.innerHTML = '<div class="rounded-xl border border-dashed border-zinc-700 px-5 py-10 text-center"><p class="display text-xl font-semibold uppercase text-zinc-300">Belum ada antrian</p><p class="mt-2 text-sm text-zinc-500">Jadwal hari ini akan muncul di sini.</p></div>';
      return;
    }
    queueContainer.innerHTML = activeBookings.map((booking) => {
      const serving = booking.status === STATUS.SERVING;
      return `<article class="rounded-xl border ${serving ? "border-sky-800 bg-sky-950/30 ring-1 ring-sky-900" : "border-zinc-800 bg-zinc-950/60"} p-4">
        <div class="flex items-start justify-between gap-3"><div class="flex min-w-0 items-center gap-3">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl ${serving ? "bg-sky-400 text-zinc-950" : "bg-zinc-800 text-amber-400"} display text-lg font-bold">${escapeHtml(booking.code)}</span>
          <div class="min-w-0"><p class="truncate font-semibold text-zinc-100">${escapeHtml(booking.name)}</p><p class="mt-1 text-xs text-zinc-500">${escapeHtml(booking.time)} · ${escapeHtml(booking.barber)}</p></div>
        </div><span class="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span></div>
        ${serving ? '<p class="mt-3 text-xs font-semibold text-sky-300">● Sedang dilayani barber</p>' : ""}
      </article>`;
    }).join("");
  }

  async function loadQueue() {
    const requestId = ++queueRequest;
    const today = localDateString(new Date());
    document.getElementById("queue-date-label").textContent = formatDate(today);
    const { data, error } = await supabase.from("queue_public")
      .select("booking_id,code,name,barber,date,time,status")
      .eq("date", today).order("time", { ascending: true });
    if (error) throw error;
    if (requestId === queueRequest) renderQueue(data);
  }

  function subscribeToCustomerUpdates() {
    const today = localDateString(new Date());
    const queueChannel = supabase.channel(`public-queue-${today}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_public", filter: `date=eq.${today}` }, () => {
        loadQueue().catch((error) => {
          console.error("Gagal memperbarui antrian realtime.", error);
          showMessage(errorBox, errorMessage(error));
        });
        if (dateInput.value && barberInput.value) renderSlots();
      }).subscribe();
    const masterChannel = supabase.channel("public-master-data")
      .on("postgres_changes", { event: "*", schema: "public", table: "barbers" }, () => loadMasters().catch((error) => {
        console.error("Gagal memperbarui daftar kapster.", error);
        showMessage(errorBox, errorMessage(error));
      }))
      .on("postgres_changes", { event: "*", schema: "public", table: "services" }, () => loadMasters().catch((error) => {
        console.error("Gagal memperbarui daftar layanan.", error);
        showMessage(errorBox, errorMessage(error));
      }))
      .on("postgres_changes", { event: "*", schema: "public", table: "barber_days_off" }, () => loadMasters().catch((error) => {
        console.error("Gagal memperbarui jadwal libur.", error);
        showMessage(errorBox, errorMessage(error));
      })).subscribe();
    realtimeChannels = [queueChannel, masterChannel];
  }

  dateInput.addEventListener("change", renderSlots);
  barberInput.addEventListener("change", renderSlots);
  serviceInput.addEventListener("change", () => hideMessage(errorBox));
  form.addEventListener("change", (event) => {
    if (event.target.name === "time") hideMessage(errorBox);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(errorBox);
    if (!form.reportValidity() || !requireSupabase(errorBox)) return;
    const data = new FormData(form);
    const booking = {
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim(),
      service: String(data.get("service")),
      barber: String(data.get("barber")),
      date: String(data.get("date")),
      time: String(data.get("time"))
    };
    const digits = booking.phone.replace(/\D/g, "");
    if (!booking.name || !/^[+\d\s().-]{8,20}$/.test(booking.phone) || digits.length < 8 || digits.length > 15) {
      showMessage(errorBox, "Periksa kembali nama dan nomor WhatsApp (harus berisi 8–15 digit).");
      return;
    }
    if (!masters.services.some((item) => item.name === booking.service) || !masters.barbers.some((item) => item.name === booking.barber)) {
      showMessage(errorBox, "Layanan atau kapster sudah berubah. Pilih ulang sebelum membuat booking.");
      return;
    }
    if (booking.date < localDateString(new Date())) {
      showMessage(errorBox, "Tanggal booking tidak boleh sebelum hari ini.");
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Menyimpan booking…";
    try {
      const { data: created, error } = await supabase.rpc("create_booking", {
        p_name: booking.name,
        p_phone: booking.phone,
        p_service: booking.service,
        p_barber: booking.barber,
        p_date: booking.date,
        p_time: booking.time
      });
      if (error) throw error;
      const saved = { ...booking, id: created.id, code: created.code, price: created.price, status: STATUS.WAITING };
      ticketContent.innerHTML = `<div class="text-center"><p class="text-xs font-bold uppercase tracking-[.3em] text-amber-400">Garis Barber · Tiket digital</p><div class="mx-auto my-6 grid h-28 w-28 place-items-center rounded-3xl border border-amber-500/40 bg-amber-500/10"><span class="display text-5xl font-bold text-amber-400">${escapeHtml(saved.code)}</span></div><h2 class="display text-3xl font-bold uppercase">Booking berhasil</h2><p class="mt-2 text-sm text-zinc-400">Simpan tiket ini dan tunjukkan saat datang.</p></div>
      <div class="my-6 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
        <div class="flex justify-between gap-4"><span class="text-zinc-500">Layanan</span><span class="text-right font-semibold">${escapeHtml(saved.service)}</span></div>
        <div class="flex justify-between gap-4"><span class="text-zinc-500">Kapster</span><span class="text-right font-semibold">${escapeHtml(saved.barber)}</span></div>
        <div class="flex justify-between gap-4"><span class="text-zinc-500">Tanggal</span><span class="text-right font-semibold">${escapeHtml(formatDate(saved.date))}</span></div>
        <div class="flex justify-between gap-4"><span class="text-zinc-500">Jam</span><span class="text-right font-semibold">${escapeHtml(saved.time)}</span></div>
        <div class="flex justify-between gap-4"><span class="text-zinc-500">Harga</span><span class="text-right font-semibold text-amber-400">${escapeHtml(formatRupiah(saved.price))}</span></div>
      </div>
      <div class="space-y-3"><a class="block w-full rounded-xl bg-emerald-600 px-5 py-3 text-center font-bold text-white hover:bg-emerald-500" href="${escapeHtml(whatsappUrl(businessNumber, ticketMessage(saved)))}" target="_blank" rel="noopener noreferrer">Kirim Tiket ke WhatsApp</a><button id="close-ticket" class="w-full rounded-xl border border-zinc-700 px-5 py-3 font-semibold text-zinc-300" type="button">Selesai</button></div>`;
      modal.showModal();
      document.getElementById("close-ticket").addEventListener("click", () => modal.close());
      form.reset();
      dateInput.value = localDateString(new Date());
      await Promise.all([renderSlots(), loadQueue()]);
    } catch (error) {
      console.error("Booking gagal disimpan.", error);
      showMessage(errorBox, errorMessage(error));
      await renderSlots();
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Booking Sekarang <span aria-hidden="true">→</span>';
    }
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.close();
  });

  lookupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(lookupError);
    lookupResult.replaceChildren();
    if (!lookupForm.reportValidity() || !requireSupabase(lookupError)) return;
    const button = lookupForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { data, error } = await supabase.rpc("lookup_bookings", { p_query: lookupInput.value.trim() });
      if (error) throw error;
      if (!data || data.length === 0) {
        showMessage(lookupError, "Booking tidak ditemukan. Periksa kode antrian atau nomor WhatsApp.");
        return;
      }
      lookupResult.innerHTML = data.map((booking) => `<article class="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <div class="flex items-center justify-between gap-3"><span class="display text-2xl font-bold text-amber-400">${escapeHtml(booking.code)}</span><span class="rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span></div>
        <p class="mt-2 text-sm text-zinc-300">${escapeHtml(formatDate(booking.date))} · ${escapeHtml(booking.time)} · ${escapeHtml(booking.barber)}</p>
        <p class="mt-1 text-xs text-zinc-500">${escapeHtml(booking.service)} · ${Number(booking.people_ahead) === 0 ? "Tidak ada antrian sebelum Anda" : `${Number(booking.people_ahead)} pelanggan di depan Anda`}</p>
      </article>`).join("");
    } catch (error) {
      console.error("Pencarian status booking gagal.", error);
      showMessage(lookupError, errorMessage(error));
    } finally {
      button.disabled = false;
    }
  });

  if (!requireSupabase(errorBox)) {
    queueContainer.innerHTML = '<p class="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-400">Hubungkan Supabase untuk memuat antrian online.</p>';
    return;
  }
  Promise.all([loadMasters(), loadQueue()]).catch((error) => {
    console.error("Gagal memuat data booking publik.", error);
    showMessage(errorBox, errorMessage(error));
  });
  subscribeToCustomerUpdates();
  window.addEventListener("beforeunload", () => realtimeChannels.forEach((channel) => supabase.removeChannel(channel)));
}

function initAdminPage() {
  const loginPanel = document.getElementById("admin-login-panel");
  const dashboard = document.getElementById("admin-dashboard");
  const loginForm = document.getElementById("admin-login-form");
  const loginError = document.getElementById("admin-login-error");
  const loginNotice = document.getElementById("admin-login-notice");
  const logoutButton = document.getElementById("admin-logout");
  const tableBody = document.getElementById("admin-booking-list");
  const dateFilter = document.getElementById("admin-date-filter");
  const queuePanel = document.getElementById("queue-panel");
  const ownerPanel = document.getElementById("owner-panel");
  const walkinModal = document.getElementById("walkin-modal");
  const walkinForm = document.getElementById("walkin-form");
  const walkinDate = document.getElementById("walkin-date");
  const walkinBarber = document.getElementById("walkin-barber");
  const walkinService = document.getElementById("walkin-service");
  const walkinTime = document.getElementById("walkin-time");
  const walkinError = document.getElementById("walkin-error");
  const notice = document.getElementById("admin-notice");
  const roleLabel = document.getElementById("admin-role-label");
  let role = null;
  let masters = { barbers: [], services: [] };
  let channels = [];
  let requestToken = 0;

  if (!loginPanel || !dashboard || !loginForm || !tableBody || !dateFilter) return;
  const today = localDateString(new Date());
  dateFilter.value = today;
  walkinDate.value = today;
  setDateBounds(walkinDate);
  document.getElementById("report-date").value = today;
  setDateBounds(document.querySelector('#holiday-form input[name="date"]'));

  async function getRole() {
    const { data, error } = await supabase.rpc("current_barber_role");
    if (error) throw error;
    return data === "cashier" || data === "owner" ? data : null;
  }

  function setTab(tabName) {
    const isOwnerTab = tabName === "owner" && role === "owner";
    queuePanel.classList.toggle("hidden", isOwnerTab);
    ownerPanel.classList.toggle("hidden", !isOwnerTab);
    document.getElementById("tab-queue").className = isOwnerTab
      ? "rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-amber-500 hover:text-amber-400"
      : "rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950";
    document.getElementById("tab-owner").className = isOwnerTab
      ? "rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950"
      : "rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-amber-500 hover:text-amber-400";
  }

  function setAuthenticated(nextRole) {
    role = nextRole;
    const isStaff = role === "cashier" || role === "owner";
    loginPanel.classList.toggle("hidden", isStaff);
    dashboard.classList.toggle("hidden", !isStaff);
    document.getElementById("tab-owner").classList.toggle("hidden", role !== "owner");
    if (!isStaff) {
      channels.forEach((channel) => supabase.removeChannel(channel));
      channels = [];
      tableBody.replaceChildren();
      return;
    }
    roleLabel.textContent = role === "owner" ? "Admin / Owner" : "Akun Kasir";
    setTab("queue");
    loadBookings().catch((error) => {
      console.error("Gagal memuat booking.", error);
      showMessage(notice, errorMessage(error));
    });
    loadMasters().catch((error) => {
      console.error("Gagal memuat data master.", error);
      showMessage(notice, errorMessage(error));
    });
    subscribeToStaffUpdates();
    if (role === "owner") loadReport().catch((error) => {
      console.error("Gagal memuat laporan.", error);
      showMessage(document.getElementById("report-error"), errorMessage(error));
    });
  }

  async function loadBookings() {
    if (!role) return;
    const token = ++requestToken;
    const { data, error } = await supabase.from("bookings")
      .select("id,code,name,phone,service,barber,date,time,status,source,price,paid,created_at")
      .eq("date", dateFilter.value).order("time", { ascending: true });
    if (error) throw error;
    if (!role || token !== requestToken) return;
    renderBookings(data || []);
  }

  function renderBookings(bookings) {
    document.getElementById("stat-total").textContent = String(bookings.filter((booking) => booking.status !== STATUS.CANCELLED).length);
    document.getElementById("stat-waiting").textContent = String(bookings.filter((booking) => booking.status === STATUS.WAITING).length);
    document.getElementById("stat-serving").textContent = String(bookings.filter((booking) => booking.status === STATUS.SERVING).length);
    document.getElementById("stat-revenue").textContent = formatRupiah(bookings.filter((booking) => booking.paid).reduce((sum, booking) => sum + Number(booking.price), 0));
    document.getElementById("admin-empty").classList.toggle("hidden", bookings.length > 0);
    tableBody.innerHTML = bookings.map((booking) => {
      const canAdvance = booking.status === STATUS.WAITING || booking.status === STATUS.SERVING;
      const nextLabel = booking.status === STATUS.WAITING ? "Mulai cukur" : "Selesaikan";
      const nextStatus = booking.status === STATUS.WAITING ? STATUS.SERVING : STATUS.DONE;
      const phone = toWhatsAppNumber(booking.phone);
      const reminder = `Halo ${booking.name}, pengingat antrian Garis Barber: kode ${booking.code}, ${formatDate(booking.date)} pukul ${booking.time} dengan ${booking.barber}.`;
      const callLink = phone
        ? `<a href="${escapeHtml(whatsappUrl(phone, reminder))}" target="_blank" rel="noopener noreferrer" class="whitespace-nowrap rounded-lg border border-emerald-800 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/40">Panggil via WA</a>`
        : '<span class="whitespace-nowrap rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-600">Tanpa nomor WA</span>';
      const payButton = booking.paid
        ? '<span class="whitespace-nowrap rounded-full border border-emerald-900 bg-emerald-950/50 px-3 py-1.5 text-xs font-semibold text-emerald-300">Lunas</span>'
        : `<button type="button" data-action="pay" data-id="${escapeHtml(booking.id)}" ${booking.status !== STATUS.DONE ? "disabled" : ""} class="whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold ${booking.status === STATUS.DONE ? "border-emerald-800 text-emerald-300 hover:bg-emerald-950/50" : "cursor-not-allowed border-zinc-800 text-zinc-600"}">Konfirmasi bayar</button>`;
      return `<tr class="${booking.status === STATUS.SERVING ? "bg-sky-950/20" : ""}">
        <td class="whitespace-nowrap px-5 py-4"><span class="font-bold text-amber-400">${escapeHtml(booking.code)}</span><span class="mt-1 block text-xs text-zinc-500">${escapeHtml(booking.time)} · ${escapeHtml(booking.date)}</span></td>
        <td class="px-5 py-4"><span class="font-semibold">${escapeHtml(booking.name)}</span><span class="mt-1 block text-xs text-zinc-500">${escapeHtml(booking.phone || "Walk-in")}${booking.source === "Walk-in" ? " · Walk-in" : ""}</span></td>
        <td class="px-5 py-4"><span>${escapeHtml(booking.service)}</span><span class="mt-1 block text-xs text-zinc-500">${escapeHtml(booking.barber)}</span></td>
        <td class="whitespace-nowrap px-5 py-4 font-semibold text-zinc-200">${escapeHtml(formatRupiah(booking.price))}</td>
        <td class="px-5 py-4"><span class="whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span></td>
        <td class="px-5 py-4">${payButton}</td>
        <td class="px-5 py-4"><div class="flex items-center gap-2">
          <button type="button" data-action="advance" data-id="${escapeHtml(booking.id)}" data-next="${escapeHtml(nextStatus)}" ${canAdvance ? "" : "disabled"} class="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${canAdvance ? "bg-amber-500 text-zinc-950 hover:bg-amber-400" : "cursor-not-allowed bg-zinc-800 text-zinc-600"}">${nextLabel}</button>
          <button type="button" data-action="cancel" data-id="${escapeHtml(booking.id)}" ${booking.status === STATUS.CANCELLED || booking.status === STATUS.DONE ? "disabled" : ""} class="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold ${booking.status === STATUS.CANCELLED || booking.status === STATUS.DONE ? "cursor-not-allowed text-zinc-600" : "text-red-300 hover:border-red-800"}">Batal</button>
          ${callLink}
        </div></td>
      </tr>`;
    }).join("");
  }

  async function loadMasters() {
    if (!role) return;
    const [barbersResult, servicesResult, holidaysResult] = await Promise.all([
      supabase.from("barbers").select("id,name,active").order("name"),
      supabase.from("services").select("id,name,price,active").order("name"),
      supabase.from("barber_days_off").select("id,barber_id,off_date,note,barbers(name)").gte("off_date", localDateString(new Date())).order("off_date")
    ]);
    if (barbersResult.error) throw barbersResult.error;
    if (servicesResult.error) throw servicesResult.error;
    if (holidaysResult.error) throw holidaysResult.error;
    masters = { barbers: barbersResult.data || [], services: servicesResult.data || [] };
    renderWalkinMasters();
    if (role === "owner") renderOwnerMasters(holidaysResult.data || []);
    await renderWalkinSlots();
  }

  function renderWalkinMasters() {
    const activeBarbers = masters.barbers.filter((barber) => barber.active);
    const activeServices = masters.services.filter((service) => service.active);
    const oldBarber = walkinBarber.value;
    const oldService = walkinService.value;
    walkinBarber.innerHTML = '<option value="" disabled selected>Pilih kapster</option>' +
      activeBarbers.map((barber) => `<option value="${escapeHtml(barber.name)}">${escapeHtml(barber.name)}</option>`).join("");
    walkinService.innerHTML = '<option value="" disabled selected>Pilih layanan</option>' +
      activeServices.map((service) => `<option value="${escapeHtml(service.name)}">${escapeHtml(service.name)} · ${escapeHtml(formatRupiah(service.price))}</option>`).join("");
    if (activeBarbers.some((barber) => barber.name === oldBarber)) walkinBarber.value = oldBarber;
    if (activeServices.some((service) => service.name === oldService)) walkinService.value = oldService;
  }

  function renderOwnerMasters(holidays) {
    const activeBarberOptions = masters.barbers.filter((barber) => barber.active);
    const currentHolidayBarber = document.getElementById("holiday-barber").value;
    document.getElementById("holiday-barber").innerHTML = '<option value="" disabled selected>Pilih kapster</option>' +
      activeBarberOptions.map((barber) => `<option value="${escapeHtml(barber.id)}">${escapeHtml(barber.name)}</option>`).join("");
    if (activeBarberOptions.some((barber) => barber.id === currentHolidayBarber)) document.getElementById("holiday-barber").value = currentHolidayBarber;

    document.getElementById("barber-list").innerHTML = masters.barbers.map((barber) => `<li class="flex flex-wrap items-center justify-between gap-3 py-3">
      <span class="font-medium ${barber.active ? "text-zinc-200" : "text-zinc-500"}">${escapeHtml(barber.name)} ${barber.active ? "" : "(nonaktif)"}</span>
      <span class="flex gap-2"><button type="button" data-owner-action="edit-barber" data-id="${escapeHtml(barber.id)}" class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:border-amber-500">Ubah</button><button type="button" data-owner-action="toggle-barber" data-id="${escapeHtml(barber.id)}" data-active="${String(!barber.active)}" class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs ${barber.active ? "text-red-300" : "text-emerald-300"}">${barber.active ? "Nonaktifkan" : "Aktifkan"}</button></span>
    </li>`).join("");
    document.getElementById("service-list").innerHTML = masters.services.map((service) => `<li class="flex flex-wrap items-center justify-between gap-3 py-3">
      <span class="${service.active ? "text-zinc-200" : "text-zinc-500"}">${escapeHtml(service.name)} · <strong class="text-amber-400">${escapeHtml(formatRupiah(service.price))}</strong> ${service.active ? "" : "(nonaktif)"}</span>
      <span class="flex gap-2"><button type="button" data-owner-action="edit-service" data-id="${escapeHtml(service.id)}" class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:border-amber-500">Ubah</button><button type="button" data-owner-action="toggle-service" data-id="${escapeHtml(service.id)}" data-active="${String(!service.active)}" class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs ${service.active ? "text-red-300" : "text-emerald-300"}">${service.active ? "Nonaktifkan" : "Aktifkan"}</button></span>
    </li>`).join("");
    document.getElementById("holiday-list").innerHTML = holidays.map((day) => {
      const barberName = day.barbers && day.barbers.name ? day.barbers.name : "Kapster";
      return `<li class="flex items-center justify-between gap-3 py-3"><span>${escapeHtml(barberName)} · ${escapeHtml(formatDate(day.off_date))}</span><button type="button" data-owner-action="remove-holiday" data-id="${escapeHtml(day.id)}" class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-red-300">Hapus</button></li>`;
    }).join("") || '<li class="py-3 text-sm text-zinc-500">Belum ada jadwal libur.</li>';
  }

  async function renderWalkinSlots() {
    const date = walkinDate.value;
    const barber = walkinBarber.value;
    const previousTime = walkinTime.value;
    walkinTime.innerHTML = '<option value="" disabled selected>Pilih slot</option>';
    if (!date || !barber) return;
    const { data, error } = await supabase.rpc("get_taken_slots", { p_date: date, p_barber: barber });
    if (error) throw error;
    const unavailable = new Map((data || []).filter((row) => row.is_taken).map((row) => [row.time, row.reason]));
    TIMES.forEach((time) => {
      const option = document.createElement("option");
      option.value = time;
      option.disabled = unavailable.has(time);
      option.textContent = unavailable.has(time) ? `${time} · ${unavailable.get(time)}` : time;
      walkinTime.append(option);
    });
    if (previousTime && TIMES.includes(previousTime) && !unavailable.has(previousTime)) walkinTime.value = previousTime;
  }

  async function loadReport() {
    if (role !== "owner") return;
    hideMessage(document.getElementById("report-error"));
    const { data, error } = await supabase.rpc("owner_daily_report", { p_date: document.getElementById("report-date").value });
    if (error) throw error;
    document.getElementById("report-total").textContent = formatRupiah(data.total_revenue);
    document.getElementById("report-barbers").innerHTML = (data.per_barber || []).map((item) =>
      `<li class="flex justify-between gap-3 py-3"><span>${escapeHtml(item.barber)} <span class="text-xs text-zinc-500">· ${Number(item.customers)} pelanggan</span></span><strong class="text-emerald-400">${escapeHtml(formatRupiah(item.revenue))}</strong></li>`
    ).join("") || '<li class="py-3 text-sm text-zinc-500">Belum ada pembayaran untuk tanggal ini.</li>';
  }

  function subscribeToStaffUpdates() {
    channels.forEach((channel) => supabase.removeChannel(channel));
    const date = dateFilter.value;
    const bookingChannel = supabase.channel(`staff-bookings-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        loadBookings().catch((error) => {
          console.error("Gagal memperbarui antrian.", error);
          showMessage(notice, errorMessage(error));
        });
        if (role === "owner") loadReport().catch((error) => {
          console.error("Gagal memperbarui laporan.", error);
          showMessage(document.getElementById("report-error"), errorMessage(error));
        });
        renderWalkinSlots().catch((error) => console.error("Gagal memperbarui slot walk-in.", error));
      }).subscribe();
    channels = [bookingChannel];
    if (role === "owner") {
      const masterChannel = supabase.channel("owner-master-data")
        .on("postgres_changes", { event: "*", schema: "public", table: "barbers" }, () => loadMasters().catch((error) => showMessage(notice, errorMessage(error))))
        .on("postgres_changes", { event: "*", schema: "public", table: "services" }, () => loadMasters().catch((error) => showMessage(notice, errorMessage(error))))
        .on("postgres_changes", { event: "*", schema: "public", table: "barber_days_off" }, () => loadMasters().catch((error) => showMessage(notice, errorMessage(error))))
        .subscribe();
      channels.push(masterChannel);
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(loginError);
    if (!loginForm.reportValidity() || !requireSupabase(loginError)) return;
    const data = new FormData(loginForm);
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(data.get("email")).trim(),
        password: String(data.get("password"))
      });
      if (error) throw error;
      const staffRole = await getRole();
      if (!staffRole) {
        await supabase.auth.signOut();
        showMessage(loginError, "Akun belum diberi role kasir atau owner. Hubungi pemilik.");
        return;
      }
      loginForm.reset();
      setAuthenticated(staffRole);
    } catch (error) {
      console.error("Login staf gagal.", error);
      showMessage(loginError, errorMessage(error));
    } finally {
      button.disabled = false;
    }
  });

  logoutButton.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Logout gagal.", error);
      showMessage(notice, errorMessage(error));
      return;
    }
    setAuthenticated(null);
  });
  document.getElementById("tab-queue").addEventListener("click", () => setTab("queue"));
  document.getElementById("tab-owner").addEventListener("click", () => {
    if (role === "owner") setTab("owner");
  });
  dateFilter.addEventListener("change", () => {
    hideMessage(notice);
    loadBookings().catch((error) => showMessage(notice, errorMessage(error)));
    subscribeToStaffUpdates();
  });
  document.getElementById("report-date").addEventListener("change", () => loadReport().catch((error) => showMessage(document.getElementById("report-error"), errorMessage(error))));

  document.getElementById("open-walkin-modal").addEventListener("click", () => {
    hideMessage(walkinError);
    walkinForm.reset();
    walkinDate.value = dateFilter.value || today;
    renderWalkinSlots().catch((error) => showMessage(walkinError, errorMessage(error)));
    walkinModal.showModal();
  });
  document.getElementById("close-walkin-modal").addEventListener("click", () => walkinModal.close());
  document.getElementById("cancel-walkin").addEventListener("click", () => walkinModal.close());
  walkinModal.addEventListener("click", (event) => {
    if (event.target === walkinModal) walkinModal.close();
  });
  walkinDate.addEventListener("change", () => renderWalkinSlots().catch((error) => showMessage(walkinError, errorMessage(error))));
  walkinBarber.addEventListener("change", () => renderWalkinSlots().catch((error) => showMessage(walkinError, errorMessage(error))));

  walkinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(walkinError);
    if (!walkinForm.reportValidity()) return;
    const data = new FormData(walkinForm);
    const phone = String(data.get("phone")).trim();
    const phoneDigits = phone.replace(/\D/g, "");
    if (phone && (!/^[+\d\s().-]{8,20}$/.test(phone) || phoneDigits.length < 8 || phoneDigits.length > 15)) {
      showMessage(walkinError, "Format nomor WhatsApp tidak valid.");
      return;
    }
    const button = walkinForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await supabase.rpc("create_walkin", {
        p_name: String(data.get("name")).trim(),
        p_phone: phone || null,
        p_service: String(data.get("service")),
        p_barber: String(data.get("barber")),
        p_date: String(data.get("date")),
        p_time: String(data.get("time"))
      });
      if (error) throw error;
      dateFilter.value = String(data.get("date"));
      walkinModal.close();
      await loadBookings();
      subscribeToStaffUpdates();
    } catch (error) {
      console.error("Gagal membuat booking walk-in.", error);
      showMessage(walkinError, errorMessage(error));
    } finally {
      button.disabled = false;
    }
  });

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    hideMessage(notice);
    button.disabled = true;
    try {
      let error;
      if (button.dataset.action === "pay") {
        ({ error } = await supabase.rpc("mark_booking_paid", { p_booking_id: button.dataset.id }));
      } else {
        const nextStatus = button.dataset.action === "cancel" ? STATUS.CANCELLED : button.dataset.next;
        ({ error } = await supabase.rpc("transition_booking", {
          p_booking_id: button.dataset.id,
          p_next_status: nextStatus
        }));
      }
      if (error) throw error;
      await loadBookings();
    } catch (error) {
      console.error("Aksi antrian gagal.", error);
      showMessage(notice, errorMessage(error));
      await loadBookings().catch((loadError) => console.error("Gagal memuat ulang antrian.", loadError));
    }
  });

  document.getElementById("barber-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorElement = document.getElementById("barber-error");
    hideMessage(errorElement);
    try {
      const { error } = await supabase.rpc("owner_save_barber", { p_name: String(new FormData(form).get("name")).trim(), p_id: null });
      if (error) throw error;
      form.reset();
      await loadMasters();
    } catch (error) {
      console.error("Gagal menambah kapster.", error);
      showMessage(errorElement, errorMessage(error));
    }
  });
  document.getElementById("service-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const errorElement = document.getElementById("service-error");
    hideMessage(errorElement);
    try {
      const { error } = await supabase.rpc("owner_save_service", {
        p_name: String(data.get("name")).trim(), p_price: Number(data.get("price")), p_id: null
      });
      if (error) throw error;
      form.reset();
      await loadMasters();
    } catch (error) {
      console.error("Gagal menambah layanan.", error);
      showMessage(errorElement, errorMessage(error));
    }
  });
  document.getElementById("holiday-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const errorElement = document.getElementById("holiday-error");
    hideMessage(errorElement);
    try {
      const { error } = await supabase.rpc("owner_set_day_off", {
        p_barber_id: String(data.get("barber_id")),
        p_date: String(data.get("date")),
        p_note: ""
      });
      if (error) throw error;
      form.reset();
      await loadMasters();
    } catch (error) {
      console.error("Gagal mengatur hari libur.", error);
      showMessage(errorElement, errorMessage(error));
    }
  });

  document.getElementById("owner-panel").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-owner-action]");
    if (!button || role !== "owner") return;
    const itemId = button.dataset.id;
    const action = button.dataset.ownerAction;
    try {
      let result;
      if (action === "edit-barber") {
        const barber = masters.barbers.find((item) => item.id === itemId);
        if (!barber) return;
        const name = window.prompt("Nama kapster:", barber.name);
        if (name === null) return;
        result = await supabase.rpc("owner_save_barber", { p_name: name.trim(), p_id: itemId });
      } else if (action === "toggle-barber") {
        result = await supabase.rpc("owner_set_barber_active", { p_id: itemId, p_active: button.dataset.active === "true" });
      } else if (action === "edit-service") {
        const service = masters.services.find((item) => item.id === itemId);
        if (!service) return;
        const name = window.prompt("Nama layanan:", service.name);
        if (name === null) return;
        const priceInput = window.prompt("Harga layanan (angka Rupiah):", String(service.price));
        if (priceInput === null) return;
        const price = Number(priceInput);
        if (!Number.isSafeInteger(price) || price < 0) throw new Error("INVALID_MASTER");
        result = await supabase.rpc("owner_save_service", { p_name: name.trim(), p_price: price, p_id: itemId });
      } else if (action === "toggle-service") {
        result = await supabase.rpc("owner_set_service_active", { p_id: itemId, p_active: button.dataset.active === "true" });
      } else if (action === "remove-holiday") {
        result = await supabase.rpc("owner_remove_day_off", { p_id: itemId });
      } else {
        return;
      }
      if (result.error) throw result.error;
      await loadMasters();
      await loadReport();
    } catch (error) {
      console.error("Perubahan pengaturan gagal.", error);
      const target = action.includes("service") ? document.getElementById("service-error")
        : action.includes("barber") ? document.getElementById("barber-error")
          : document.getElementById("holiday-error");
      showMessage(target, errorMessage(error));
    }
  });

  if (!requireSupabase(loginError)) {
    loginForm.querySelectorAll("input,button").forEach((input) => { input.disabled = true; });
    showMessage(loginNotice, "Sebelum login, isi config.js dan jalankan supabase-setup.sql pada proyek Supabase.");
    return;
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      setAuthenticated(null);
      return;
    }
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
      setTimeout(async () => {
        try {
          const currentRole = await getRole();
          if (!currentRole) {
            await supabase.auth.signOut();
            showMessage(loginError, "Akun belum diberi role kasir atau owner.");
            return;
          }
          setAuthenticated(currentRole);
        } catch (error) {
          console.error("Gagal memeriksa role.", error);
          showMessage(loginError, errorMessage(error));
        }
      }, 0);
    }
  });
  supabase.auth.getSession().then(async ({ data, error }) => {
    if (error) throw error;
    if (!data.session) return;
    const currentRole = await getRole();
    if (!currentRole) {
      await supabase.auth.signOut();
      showMessage(loginError, "Akun belum diberi role kasir atau owner.");
      return;
    }
    setAuthenticated(currentRole);
  }).catch((error) => {
    console.error("Gagal memeriksa sesi staf.", error);
    showMessage(loginError, errorMessage(error));
  });
  window.addEventListener("beforeunload", () => channels.forEach((channel) => supabase.removeChannel(channel)));
}

if (document.body.dataset.page === "customer") initCustomerPage();
if (document.body.dataset.page === "admin") initAdminPage();
