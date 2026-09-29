# Supabase setup for the Curio TV menu

The website uses the public project URL and publishable key. Keep the database password and `service_role` key out of the website and this repository.

## One-time database and storage setup

1. Open the Supabase project dashboard.
2. Go to **SQL Editor** and create a new query.
3. Paste the full contents of [`supabase/migrations/20260929_tv_menu.sql`](supabase/migrations/20260929_tv_menu.sql).
4. Click **Run**.

This creates the shared media tables, a public `tv-media` bucket, and Row Level Security policies. Anyone may view the TV slideshow; only authenticated staff users may add, reorder, edit, or remove media.

## Create the staff login

1. Go to **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Enter the restaurant staff email and a strong password.
4. Leave public self-signup disabled unless the restaurant deliberately wants anyone to create an account.

The staff member can then sign in from the TV Menu tab. Menu text remains local to the browser; offer media, slide timing/order, and the QR code are shared through Supabase across devices.
