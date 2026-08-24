# Construction Site Protocol — App

This app lets you take photos on your phone. Each photo gets a stamp with the
GPS location, address, and time. You can then create a PDF or Word report
from the photos — in the same style as your two example documents.

You don't need to know how to code. Just follow the steps below.

## What's in this folder

You don't need to open or understand these files. They're just listed here
so you know what's what.

```
index.html    The app itself
style.css     How it looks
app.js        How it works
model.js      How the data is organized
db.js         Saves your projects on the phone
drive.js      Connects to Google Drive (optional)
camera.js     Adds GPS + address + time to photos
export.js     Creates the PDF and Word files
manifest.json, sw.js, icons/   Lets you "install" the app on your phone
```

## Step 1: Try it on your computer first

This is just to see it work before putting it on your phone.

1. Open a terminal (Command Prompt / Terminal app) in this folder.
2. Type: `python3 -m http.server 8080` and press Enter.
3. Open your browser and go to: `http://localhost:8080`

Note: the camera and GPS features only work once the app is online with a
secure address (HTTPS) — that's Step 2 below.

## Step 2: Put the app online so you can use it on your phone

This app is just a set of files. You need somewhere to "host" them online.
The easiest free option is **GitHub Pages**:

1. Go to [github.com](https://github.com) and create a free account (if you
   don't have one).
2. Click "New repository". Give it a name, e.g. `baustellen-protokoll`.
3. Click "Add file" → "Upload files", and upload every file from this folder.
4. Go to the repository's "Settings" tab → "Pages" → choose the `main`
   branch → Save.
5. Wait about a minute. Your app is now live at:
   `https://YOUR-USERNAME.github.io/baustellen-protokoll/`

(Other free options that work the same way: Netlify or Vercel — just drag
and drop the folder onto their website.)

### Add it to your phone's home screen

- **Android (Chrome)**: open the link → tap the ⋮ menu → "Add to Home screen".
- **iPhone (Safari)**: open the link → tap the Share icon → "Add to Home Screen".

Now it opens like a normal app, with its own icon — no browser bar.

## Step 3 (optional): Connect Google Drive

Skip this if you're fine with photos and reports staying only on the phone
that took them. Do this if you want a team to share the same projects.

This requires setting up a free Google account for the app. It sounds
technical but it's just clicking through some screens once:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (name it anything, e.g. "Baustellen-Protokoll").
2. In the search bar, find **"Google Drive API"** and click **Enable**.
3. Go to "OAuth consent screen":
   - Choose "External".
   - Fill in an app name and your email. Save.
   - Under "Test users", add the Google email addresses of everyone who
     should use the app.
4. Go to "Credentials" → "Create Credentials" → "OAuth client ID":
   - Application type: "Web application".
   - Under "Authorized JavaScript origins", enter the web address from
     Step 2, e.g. `https://YOUR-USERNAME.github.io`
   - Click Create. You'll get a long code called a **Client ID** — copy it.
5. Open the file `config.js` in a text editor, and paste your Client ID
   here:
   ```js
   window.PDP_CONFIG = {
     GOOGLE_CLIENT_ID: "PASTE-YOUR-CLIENT-ID-HERE",
     DRIVE_ROOT_FOLDER_NAME: "Baustellen-Protokolle"
   };
   ```
6. Save the file and upload it again to GitHub (or wherever you're hosting).

Once this is set up, tapping "Connect" in the app will ask permission to
save files to Drive. It can only see the files it creates itself — nothing
else in your Google Drive.

## Step 4: How to use the app day-to-day

1. Tap **+ New project**, then choose a type:
   - **Abnahmeprotokoll** — the first inspection. Add each location with
     photos and a description.
   - **Mängelbeseitigung** — the follow-up fix. Link it to an existing
     Abnahmeprotokoll and all the locations are copied over automatically.
     You just add the "after the fix" photos and a short note per location.
   - **Custom protocol** — for anything else.
2. For each location, tap **Take photo**. The app opens your camera. After
   you take the photo, it automatically figures out where you are, looks up
   the address, and stamps all of that plus the time onto the photo.
3. Tap **Export PDF** or **Export Word** to get the finished report, in the
   same layout as your examples.
4. If you set up Google Drive, tap **Save to Drive** to upload the project
   so others can see it too.

## Things to know

- You need internet for: looking up addresses from GPS, saving to Drive,
  and the very first time you open the app. After that, the app itself
  still opens without internet — you just can't look up new addresses or
  sync until you're back online.
- If GPS doesn't work (e.g. deep inside a building), the photo is still
  saved — it just won't have a location stamped on it.
- If two people edit the *same* project on Google Drive at the same time,
  whoever saves last "wins" — the earlier save gets overwritten. This is
  fine if your team works through locations one at a time, but not built
  for true real-time co-editing.

## Ideas for later, if you want them

You (or anyone who knows a little JavaScript) can open these files in any
text editor and change them — no special software needed.

- **Add a company logo to the reports** — ask, and I can add this.
- **Add more protocol types** beyond the two you have now — easy to add.
- **See all your photos on a map** — the location data is already saved,
  just not shown on a map yet.
- **Turn this into a "real" app** in the App Store / Google Play — possible
  later using a tool called Capacitor, without rewriting the app.

## A few questions for you

To make the next version even better, let me know:
- Should each "Mängelbeseitigung" location allow several after-photos, or
  just one before/after pair?
- Should some people be allowed to delete things and others not?
- Do you want your company logo on the PDF/Word reports?
