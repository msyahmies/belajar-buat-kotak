# Rekod Jualan Kedai

Web app ringkas untuk staff key in jualan harian kedai baju printing.

## Apa yang direkod

Setiap kali staff key in:
- **Tarikh**
- **Total lead masuk** dan **lead convert** (lead yang jadi order). **% lead convert** dikira automatik
- Satu atau lebih **baris jualan** (satu baris setiap order), setiap baris ada:
  - **Nama customer** dan **no telefon**
  - **Kategori**: Baju Pekerja / Baju Family Day / Baju Sukan / Baju Birthday
  - **Printing**: DTF / Sublimation
  - **Kuantiti** (pcs)
  - **Lead source** (WhatsApp, Facebook, Instagram, TikTok, Walk-in, Referral, Customer Lama, Lain-lain)
  - **Expected delivery** (tarikh siap/hantar)
  - **Total (RM)**, **deposit**, dan **baki** (dikira automatik)
  - **Notes**

## Apa yang dipaparkan (Dashboard)

- Sales, baju terjual, lead masuk, lead convert dan kadar convert (%) untuk hari dipilih
- Jumlah lead dan kadar convert untuk sebulan
- Target bulanan, sales bulan ini, **baki sales yang perlu untuk capai target**,
  dan berapa perlu dijual sehari untuk baki hari dalam bulan itu
- Deposit diterima dan baki belum bayar sebulan
- Pecahan ikut kategori baju, jenis printing dan lead source
- Tab **Sejarah**: senarai rekod sebulan, padam rekod yang salah, muat turun CSV (boleh buka dalam Excel)

## Cara guna

### Pilihan 1: Satu peranti sahaja (paling senang)
Buka `index.html` dalam browser (Chrome dsb.). Data disimpan dalam browser peranti itu.
Kalau ramai staff guna peranti/phone sendiri, data **tidak** akan berkongsi. Guna Pilihan 2.

### Pilihan 2: Kongsi data semua staff (Google Sheet, percuma)
1. Buat Google Sheet baru.
2. Klik **Extensions > Apps Script**, padam kod sedia ada, tampal isi `apps-script/Code.gs`, kemudian Save.
3. Klik **Deploy > New deployment**, pilih jenis **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Klik Deploy, beri kebenaran, kemudian salin **Web app URL** (berakhir dengan `/exec`).
5. Dalam app, pergi ke tab **Tetapan**, tampal URL itu, isi target bulanan, dan Simpan.
   Buat langkah ini sekali pada setiap phone/PC staff.

Semua rekod akan masuk ke sheet **Rekod** dalam Google Sheet itu (satu baris setiap key in,
dengan lajur pcs ikut kategori dan printing), jadi bos boleh semak terus dalam Google Sheet.
Target disimpan dalam sheet **Tetapan**.

> Sesiapa yang ada URL `/exec` itu boleh tambah atau padam rekod. Jangan kongsi URL itu di luar staff.

### Hosting supaya staff boleh buka dari phone
Paling mudah guna **GitHub Pages**: Settings > Pages > pilih branch, kemudian kongsi link itu
dengan staff. Mereka boleh "Add to Home Screen" supaya ia nampak macam app.

## Tukar kategori / jenis printing
Edit senarai `CATEGORIES`, `PRINTINGS` dan `SOURCES` di bahagian atas `app.js` **dan** `apps-script/Code.gs`
(kalau guna Google Sheet, deploy semula selepas edit).
