# Shop Sales Tracker

A simple web app for staff to key in the daily sales of a shirt printing shop.

## What is recorded

**Sales / Orders** (Key In tab):
- **Order date** at the top (defaults to today, can be changed). Job age colours count from this date
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
- Orders and shirts sold for the day
- Deposits received and balance unpaid for the month
- Breakdown by shirt category and printing type
- **History** tab: monthly list of sales (orders only, no leads), delete wrong records, download CSV (opens in Excel)

## Leads (Leads tab)

Everything about leads lives in its own tab, before Settings:
- **Daily Leads** form: date, total leads in, leads converted; **% leads converted** is calculated automatically. One record per date; saving again for the same date replaces it
- Leads, converted and conversion rate for the selected day and for the month
- A list of each day's leads this month
- **Lead source of orders**: how many orders and how much RM came from WhatsApp, Facebook, TikTok, etc.

## Job Status (Jobs tab)

After staff save a key in, the app opens the **Jobs** tab.

- Every order row **with a deposit** becomes a job. Orders without a deposit wait under **Waiting deposit**; enter the deposit there when the customer pays and the job starts
- Each job has these steps:
  1. **Design**: Done / Needs Revision / Waiting Decision
  2. **Shirt Order**: Ordered / Not Ordered
  3. **Shirt Status**: Need to Order / Not Picked Up / Picked Up
  4. **Print DTF** (or Print Sublimation): Sent / Arrived
  5. **Heat Press**: Not Started / In Progress / Done
  6. **Packing**: Not Yet / Done
  7. **Post / Pickup**
  8. **Post Status**: Not Sent / Sent (or **Pickup Status**: Not Collected / Collected)
- A job is **complete** once it is sent by post (or collected)
- Top cards show active, overdue, completed and waiting-deposit jobs, plus how many jobs are at each step
- Jobs are sorted by expected delivery date, with **Due in X days** / **Overdue** badges
- Press **✏️ Edit** on a job to change its order details (customer, phone, category, printing, quantity, total, deposit, lead source, delivery date, notes). Sales figures update too
- Each open job is coloured by how long ago it came in: **green** for 0–3 days, **yellow** for 4–6 days, **red** for 7 days or more. Completed jobs turn **blue**

## Expenses & Profit/Loss (Expenses tab)

- Enter every expense: date, category, type, amount and notes
- **Operation costs** (Daily type): blank shirts, DTF sticker / film, sublimation paper & ink, ink, plastic / packaging, postage, ads, machine maintenance
- **Overheads** (Monthly type): shop rent, staff salary, electricity & water, internet & phone. The type is picked automatically from the category
- For daily profit, monthly overheads are spread evenly over every day of the month
- **Monthly profit/loss** = month's sales − all month's expenses (green = profit, red = loss)
- **Daily profit/loss** = day's sales − that day's daily expenses − (monthly overhead ÷ days in month)

## Overhead & Break-even (Overhead tab)

- Fill in your fixed monthly costs once: shop rent, staff salary, electricity, shop expenses, advertising, your own salary, plus any other costs. They apply to every month
- EPF (KWSP) 13% + SOCSO/EIS ~1.25% is added on top of staff salary automatically
- **Net profit/loss** = month's sales − operation costs (Daily expenses) − monthly overhead
- **Break-even sales** = monthly overhead ÷ profit margin. The margin is worked out from this month's sales and operation costs; before both exist, the estimated margin you enter is used
- **Sales still needed to cover overhead** = break-even sales − sales so far, and how much that is per day for the rest of the month
- Keep rent, salary and bills here instead of in Expenses, so they are not counted twice

## Owner PIN (Settings tab)

- Set a 4–8 digit PIN in **Settings → Owner PIN**. It is saved in Google Sheet, so every staff device picks it up on its next sync
- With a PIN set, **Expenses**, **Overhead**, **Settings** and the **Delete** buttons in History ask for the PIN. Staff can still use Dashboard, Key In, Jobs and History
- On your own phone or PC, tick **Keep unlocked on this device** so you don't have to type the PIN each time. Use the **🔓 Lock** button at the top to lock again
- The PIN keeps staff out of owner pages in normal use. It is not strong security: someone who knows how to read the page code or has the Google Sheet link can still get to the data
- Forgot the PIN? In the Google Sheet, open the **Settings** sheet, cell **B2**, delete the `"pinHash":"…"` part, then reload the app on your device

## Expenses from Telegram (receipt photos)

Send a receipt photo to your own Telegram bot and it is added to Expenses, with the photo saved in your Google Drive.

**Setup (once):**
1. In Telegram, open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`. Copy the **token** it gives you
2. In Google Sheet → **Extensions → Apps Script**, paste the latest `Code.gs` and save
3. Click ⚙️ **Project Settings** → **Script properties** → **Add script property**: name `TELEGRAM_TOKEN`, value = the token. Save
4. Back in the editor (**<>**), choose **setupTelegram** in the function list at the top and press **Run**. Allow the permissions it asks for (Drive and external requests)
5. **Deploy → Manage deployments → Edit → Version: New version → Deploy** (URL stays the same)
6. Open your bot in Telegram and send `/start`. The first chat to do this becomes the owner; anyone else is ignored

**Use:** send a photo with a caption like `DTF 150 supplier Ali`, `baju 400` or `plastik RM35.50`.
The amount is the number in the caption (or after "RM"); the category is picked from words like dtf, baju, plastik, poslaju, ink, iklan, mesin. No amount? The bot asks and you reply with it. Text without a photo (`poslaju 12`) works too.
New expenses show up in the app within about a minute, with a **View** link to the receipt.

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
   Open that URL in a new tab: it should show `"message":"Shop Sales Tracker is connected"`.
   If it shows *Script function not found: doGet*, the deployment runs old code: paste and save the latest
   `Code.gs`, then **Deploy > Manage deployments > Edit > Version: New version > Deploy** (the URL stays the same).
5. In the app, go to the **Settings** tab, paste that URL, fill in the monthly target, and Save.
   Do this once on every staff phone/PC.

All sales go to the **Sales** sheet in that Google Sheet (one row per key in, with pcs columns
by category and printing), so the owner can check them directly in Google Sheet. Expenses go to
the **Expenses** sheet, job progress to the **Jobs** sheet, and the target is kept in the **Settings** sheet.

> Anyone with the `/exec` URL can add or delete records. Don't share the URL outside your staff.

### Hosting so staff can open it on their phones
The easiest way is **GitHub Pages**: Settings > Pages > choose the branch, then share the link
with staff. They can use "Add to Home Screen" so it looks like an app.

## Changing categories / printing types / lead sources
Edit the `CATEGORIES`, `PRINTINGS`, `SOURCES`, `OPERATION_COSTS` and `OVERHEAD_COSTS` lists at the top of `app.js`.
`CATEGORIES` and `PRINTINGS` are also in `apps-script/Code.gs` (redeploy after editing if you use Google Sheet).
