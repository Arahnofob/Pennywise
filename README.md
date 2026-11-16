# Pennywise

A private money tracker for two. It is a web app that installs to the home screen on iPhone and Android, works offline, and keeps your data on your phone. Currency is CAD.

## What it does

- **Expenses and income** with category, date, note and (optionally) who paid.
- **Overview** per month: balance, spending by category, spending by person, six-month trend.
- **Budgets**: a monthly limit per category, with what is left or how far over you are.
- **Savings goals** with a target, progress and how much to put aside each month to hit a date.
- **Year in review**: saved, savings rate, average month, most and least expensive months, where the money went.
- **Recurring payments**: rent, subscriptions, salary; added automatically each month.
- **Monefy import**: reads the CSV exported from Monefy. Importing the same file twice never creates duplicates.
- **English and Ukrainian** interface, chosen per phone (More → Language).
- **App lock** with a 4-digit PIN (More → App lock). It is a privacy screen, set per phone; the data itself is not encrypted.
- **Backup / restore** to a single file, and CSV export.
- **Optional sync between two phones** through your own free Supabase project.

## Put it on your phones

1. On GitHub open this repository's **Settings → Pages**. Under **Source** keep **Deploy from a branch**, pick the branch and the **/ (root)** folder, and press **Save**. (Free GitHub accounts need the repository to be public for Pages. The code contains no personal data.)
2. After a minute or two the same page shows the address, `https://<your-user>.github.io/Pennywise/`. Every later push updates it automatically.
3. On each iPhone open that address in **Safari**, tap **Share → Add to Home Screen**. On Android use Chrome's **Install app**.
4. Open Pennywise from the home screen and choose **Import my Monefy history** (first phone) or **Join my partner's Pennywise** (second phone, once sync is set up).

Always open it from the home-screen icon: on iPhone the installed app and the Safari tab keep separate data.

## Turn on sync (free, about 5 minutes, done once)

1. Create a free account at [supabase.com](https://supabase.com) and a new project (any name, a region near you).
2. In the project open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and press **Run**.
3. In **Project Settings → API** copy the **Project URL** and the **anon / publishable** key.
4. On the first phone: **More → Sync between phones → Set up first phone**, paste both values, **Connect**. It uploads everything.
5. The same screen now shows a **pairing code**. Send it to the second phone and paste it under **More → Sync between phones → I have a pairing code**.

From then on changes travel between the phones within about a minute, and immediately when the app is opened. If both of you edit the same entry, the later edit wins. The app keeps working offline and catches up later.

Good to know:

- The pairing code is the password to your data. Share it only with each other.
- Supabase pauses free projects after about a week with no activity. Using the app keeps it awake; if it does get paused, press **Restore** in the Supabase dashboard. Nothing is lost, because each phone holds a full copy.
- **More → Save a backup** now and then is still a good habit.

## Development

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765`.

| File | Purpose |
| --- | --- |
| `js/app.js` | Screens, forms and actions |
| `js/store.js`, `js/db.js` | Records in memory and IndexedDB |
| `js/csv.js` | Monefy import, CSV export |
| `js/sync.js` | Cloud sync client |
| `js/charts.js` | Category bars and trend chart |
| `js/i18n.js` | English / Ukrainian texts |
| `js/lock.js` | PIN lock screen |
| `sw.js` | Offline cache (bump `CACHE` when you change files) |
| `supabase/schema.sql` | Database table and functions for sync |
