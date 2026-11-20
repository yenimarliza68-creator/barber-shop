# Garis Barber

Aplikasi booking statis memakai HTML, Tailwind CSS CDN, JavaScript module, dan Supabase (Postgres, Auth, Realtime). Booking tidak lagi disimpan di `localStorage`.

## Setup Supabase gratis

1. Buat proyek di [supabase.com](https://supabase.com/).
2. Buka **Project Settings → API** dan salin **Project URL** serta **anon/public key**. Tempel ke `supabaseUrl` dan `supabaseAnonKey` pada `config.js`. Jangan pernah memakai `service_role` key di kode browser.
3. Buka **SQL Editor → New query**, tempel seluruh isi `supabase-setup.sql`, lalu jalankan. Script membuat master kapster/harga, jadwal libur, role staf, booking dan pembayaran, fungsi database, RLS, serta publikasi Realtime.
4. Di **Authentication → Providers**, aktifkan Email/Password dan matikan pendaftaran pengguna publik. Buat akun staf secara manual melalui **Authentication → Users → Add user**.
5. Salin UUID akun staf di halaman Authentication → Users. Tetapkan satu role lewat SQL Editor:

   ```sql
   -- Kasir hanya dapat mengelola antrian, walk-in, dan pembayaran.
   insert into public.staff_roles (user_id, role)
   values ('UUID-AKUN-KASIR', 'cashier');

   -- Owner juga dapat mengelola master data dan melihat laporan.
   insert into public.staff_roles (user_id, role)
   values ('UUID-AKUN-OWNER', 'owner');
   ```

   Untuk mengganti role, gunakan `update public.staff_roles set role = 'owner' where user_id = 'UUID';`. Jangan beri role `owner` kepada akun kasir. Jika sebelumnya memakai tabel `barber_admins`, script setup memigrasikan akunnya menjadi `owner`.
6. (Opsional) Atur `barberWhatsAppNumber` pada `config.js` dalam format internasional tanpa tanda plus, misalnya `6281234567890`; atur pula URL Google Maps usaha.
7. Setelah setup SQL, harga awal dan kapster Andi, Bima, Raka ditambahkan bila belum ada. Login sebagai Owner untuk menyesuaikan master tersebut. Nilai layanan/harga awal pada script SQL hanyalah contoh.

## Hak akses

- **Kasir:** tab Kelola Antrian Harian, perubahan status, booking walk-in, konfirmasi pembayaran untuk antrian selesai, dan pengiriman pesan WhatsApp. Tidak mendapat tab Pengaturan & Laporan.
- **Admin/Owner:** seluruh akses kasir, tambah/nonaktifkan/aktifkan dan ubah kapster, tambah/nonaktifkan/aktifkan dan ubah harga layanan, jadwal libur kapster, serta laporan omzet lunas dan jumlah pelanggan per kapster.
- Otorisasi diterapkan di RLS dan fungsi database. Jangan mengganti kontrol ini dengan PIN yang disimpan di JavaScript/HTML—siapa pun dapat membaca PIN frontend. Gunakan akun Supabase Auth individual dengan password kuat dan aktifkan MFA untuk Owner bila tersedia.
- Kapster/layanan yang “dihapus” dinonaktifkan, bukan dihapus permanen, supaya riwayat booking tetap utuh.

## Menjalankan lokal dan hosting

Jalankan situs melalui HTTP (jangan membuka file dengan `file://`) karena aplikasi memakai JavaScript module:

```bash
python -m http.server 8000
```

Buka `http://localhost:8000`; atau pakai ekstensi VS Code Live Server.

Untuk deploy gratis, push `index.html`, `admin.html`, `app.js`, dan `config.js` ke repository GitHub, lalu import repository di Netlify atau Vercel sebagai static site dengan build command kosong dan output/publish directory `.`. GitHub Pages juga dapat dipakai melalui **Settings → Pages → Deploy from a branch**. Setelah deploy, daftarkan origin/domain situs pada Supabase **Authentication → URL Configuration** (Site URL dan Redirect URLs).

## Catatan keamanan dan operasi

- `config.js` berisi anon key publik, bukan secret; keamanan bergantung pada RLS, izin RPC, dan role database. Jangan commit `service_role` key.
- Data pelanggan pribadi hanya dapat dibaca staf yang terautentikasi; tampilan antrian publik memuat kode, nama, barber, waktu, dan status booking hari ini. Pencarian status hanya mengembalikan informasi booking yang diperlukan beserta jumlah pelanggan di depan.
- Database memvalidasi kapster, layanan, harga saat booking, jadwal libur, tanggal, nomor WA, status pembayaran, dan bentrok slot secara transaksional. Jangan melakukan insert/update booking langsung dari UI.
- Form booking publik belum memakai CAPTCHA atau rate limit berbasis IP. Sebelum dipromosikan secara luas, tambahkan proteksi anti-bot/rate limiting melalui Edge Function atau WAF dan pantau kuota Supabase.
- Verifikasi realtime dan role membutuhkan proyek Supabase aktif serta konfigurasi kredensial. Tailwind CDN praktis untuk awal; build CSS lokal lebih baik untuk performa dan stabilitas produksi.
