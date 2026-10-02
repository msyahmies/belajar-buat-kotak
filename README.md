# Shop Sales Tracker

A simple web app for staff to key in the daily sales of a shirt printing shop.

## What is recorded

Each time staff key in:
- **Date**
- **Total leads in** and **leads converted** (leads that became orders). **% leads converted** is calculated automatically
- One or more **sales rows** (one row per order), each with:
  - **Customer name** and **phone no.**
  - **Category**: Work Shirt / Family Day Shirt / Sports Shirt / Birthday Shirt
  - **Printing**: DTF / Sublimation
  - **Quantity** (pcs)
  - **Total (RM)**, **deposit**, and **balance** (calculated automatically)
  - **Lead source** (WhatsApp, Facebook, Instagram, TikTok, Walk-in, Referral, Returning Customer, Others)
  - **Expected delivery** date
  - **Notes**

## What the Dashboard shows

- **Today's sales** (large green card)
- **Daily sales target** (yellow): remaining monthly target ÷ days left in the month
- **Sales still needed today**: red below 2/3 of the daily target, yellow from 2/3, green once reached
- **Sales still needed this month** (red)
- Shirts sold, leads in, leads converted and conversion rate for the day and the month
- Deposits received and balance unpaid for the month
- Breakdown by shirt category, printing type and lead source
- **History** tab: monthly list of records, delete wrong records, download CSV (opens in Excel)

## Expenses & Profit/Loss (Expenses tab)

- Enter every expense: date, category, type, amount and notes
- **Operation costs** (Daily type): blank shirts, DTF sticker / film, sublimation paper & ink, ink, plastic / packaging, postage, ads, machine maintenance
- **Overheads** (Monthly type): shop rent, staff salary, electricity & water, internet & phone. The type is picked automatically from the category
- For daily profit, monthly overheads are spread evenly over every day of the month
- **Monthly profit/loss** = month's sales − all month's expenses (green = profit, red = loss)
- **Daily profit/loss** = day's sales − that day's daily expenses − (monthly overhead ÷ days in month)

## How to use

### Option 1: One device only (easiest)
Open `index.html` in a browser (Chrome etc.). Data is saved in that device's browser.
If several staff use their own phones, the data will **not** be shared. Use Option 2.

### Option 2: Share data between all staff (Google Sheet, free)
1. Create a new Google Sheet.
2. Click **Extensions > Apps Script**, delete the existing code, paste the contents of `apps-script/Code.gs`, then Save.
3. Click **Deploy > New deployment**, choose type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click Deploy, grant permission, then copy the **Web app URL** (ends with `/exec`).
5. In the app, go to the **Settings** tab, paste that URL, fill in the monthly target, and Save.
   Do this once on every staff phone/PC.

All sales go to the **Sales** sheet in that Google Sheet (one row per key in, with pcs columns
by category and printing), so the owner can check them directly in Google Sheet. Expenses go to
the **Expenses** sheet, and the target is kept in the **Settings** sheet.

> Anyone with the `/exec` URL can add or delete records. Don't share the URL outside your staff.

### Hosting so staff can open it on their phones
The easiest way is **GitHub Pages**: Settings > Pages > choose the branch, then share the link
with staff. They can use "Add to Home Screen" so it looks like an app.

## Changing categories / printing types / lead sources
Edit the `CATEGORIES`, `PRINTINGS`, `SOURCES`, `OPERATION_COSTS` and `OVERHEAD_COSTS` lists at the top of `app.js`.
`CATEGORIES` and `PRINTINGS` are also in `apps-script/Code.gs` (redeploy after editing if you use Google Sheet).
