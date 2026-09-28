# 🚀 ZAMI-MD — Free Deploy Guide

## 📁 Kaunsi files upload karni hain

### ✅ YE UPLOAD KARO (5 files)
```
index.html        ← pair code page
deploy.html       ← deploy panel
server.js         ← backend
deploy.js         ← deploy engine
package.json      ← dependencies
```

### ➕ Ye bhi (optional, madad karti hain)
```
Dockerfile        ← Koyeb/Fly ke liye
.gitignore        ← zaroori
test.js           ← checker
```

### ❌ YE KABHI UPLOAD MAT KARO
```
node_modules/     ← bahut bada, host khud banata hai
sessions/         ← temporary
deployments/      ← bots ka data
bot_session/      ← PRIVATE! session leak ho jayegi
bots.json
*.log
.env
package-lock.json
```
> `.gitignore` already bana diya hai — ye khud rok dega ✅

---

# 🥇 OPTION 1 — RENDER (sabse aasan, free)

## Step 1: GitHub pe files daalo

Mobile se bhi ho sakta hai:
1. **github.com** kholo → Sign up / Login
2. **New repository** → naam: `zami-md-pair` → **Public** → Create
3. **Add file → Upload files**
4. Upar wali **5 files** select karke upload
5. **Commit changes**

## Step 2: Render pe deploy
1. **render.com** → **Get Started** → GitHub se login
2. **New +** → **Web Service**
3. Apni repo `zami-md-pair` select karo → **Connect**
4. Settings bharo:

| Field | Value |
|---|---|
| Name | `zami-md` |
| Region | Singapore (ya nazdeek) |
| Branch | `main` |
| Runtime | **Node** |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Instance Type | **Free** |

5. **Create Web Service** → 3-5 min wait

## Step 3: Link mil gaya!
```
https://zami-md.onrender.com
https://zami-md.onrender.com/deploy.html
```

> ⚠️ Render free tier **15 min inactivity** ke baad sota hai.
> Pehla request 30-50 sec leta hai. Fix neeche 👇

---

# 🥈 OPTION 2 — KOYEB (sota nahi, free)

1. **koyeb.com** → GitHub se sign up
2. **Create Web Service** → **GitHub**
3. Repo select karo
4. Builder: **Dockerfile** (already bana diya hai ✅)
5. Instance: **Free (nano)**
6. Port: **3000**
7. **Deploy**

Link: `https://zami-md-xxxx.koyeb.app`

✅ **Sleep nahi hota** — Render se behtar

---

# 🥉 OPTION 3 — RAILWAY ($5 free credit)

1. **railway.app** → Login with GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Repo select karo — bas, khud detect kar lega
4. **Settings → Networking → Generate Domain**

Link: `https://zami-md.up.railway.app`

---

# 🔧 ZAROORI SETTING (deploy ke baad)

Sab jagah **Environment Variable** add karo:

| Key | Value |
|---|---|
| `NODE_VERSION` | `20` |
| `BOT_REPO` | `https://github.com/APNA-NAAM/ZAMI-MD` |

**Render:** Dashboard → Environment → Add
**Koyeb:** Service → Settings → Environment variables
**Railway:** Variables tab

---

# 💤 Render ko sone se rokna (free trick)

1. **uptimerobot.com** → free account
2. **Add New Monitor**
   - Type: **HTTP(s)**
   - URL: `https://zami-md.onrender.com/api/health`
   - Interval: **5 minutes**
3. Save ✅

Ab hamesha jaaga rahega.

---

# ⚠️ Deploy panel ke baare me sach

`deploy.html` ka bot-deploy feature **free hosting pe kaam nahi karega** kyunki:
- Free plans par `git clone` + `npm install` ki disk nahi hoti
- Background processes allowed nahi
- RAM bahut kam (512MB)

## Kya chalega kahan

| Feature | Render/Koyeb Free | VPS |
|---|---|---|
| Pair Code page | ✅ | ✅ |
| Session ID generate | ✅ | ✅ |
| WhatsApp connect | ✅ | ✅ |
| Deploy panel UI | ✅ | ✅ |
| **Bot actually deploy** | ❌ | ✅ |

**Bot deploy karne ke liye VPS chahiye** (₹300-500/month) —
Contabo, Hostinger, ya Oracle Cloud **Always Free** (4GB RAM, bilkul muft!)

---

# 🖥️ VPS pe (bot deploy ke saath, full power)

```bash
# Ubuntu VPS pe
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git ffmpeg

git clone https://github.com/APNA-NAAM/zami-md-pair.git
cd zami-md-pair
npm install

sudo npm i -g pm2
pm2 start server.js --name zami-md
pm2 save
pm2 startup
```

Link: `http://YOUR-VPS-IP:3000`

### Oracle Cloud Always Free (muft VPS)
👉 **oracle.com/cloud/free** — 4 CPU, 24GB RAM, hamesha free
Card verify karna padta hai par charge nahi hota.

---

# 🆘 Errors

| Error | Fix |
|---|---|
| Build failed: node version | Env var `NODE_VERSION=20` |
| Cannot find module | `package.json` upload nahi hui |
| Application error | Logs dekho: Render → Logs tab |
| Port error | `process.env.PORT` already handled ✅ |
| Slow first load | Render sleep — UptimeRobot laga do |
| `git: not found` | Dockerfile use karo (git included) |

---

# ✅ Recommended

**Sirf pair code chahiye** → **Koyeb** (free, sleep nahi)
**Bot deploy bhi chahiye** → **Oracle Cloud VPS** (free, full power)
