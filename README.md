
# Live Recruiting KPI Dashboard 🚀

I’m always fiddling with new tools and building small systems, so I built this lightweight recruiting KPI dashboard to demonstrate how I think about operational visibility in a lean environment.

## The Idea

Early-stage startups often find hires through multiple channels — events, LinkedIn, referrals, cold outreach — but visibility into performance across those channels can be fragmented.

This project simulates a lightweight recruiting analytics pipeline using:

- **Google Sheets** as a structured single source of truth  
- **Zapier** to trigger webhook events  
- **Node.js + Express** backend  
- **SQLite** database  
- **Server-Sent Events (SSE)** for live updates  

When candidate data changes, the system updates the database and recalculates key KPIs in real time:

- Event → Interview conversion  
- Channel performance  
- Hire rate  
- Average & median touchpoints to hire  

For demo purposes, webhook events can also be simulated via `curl` to demonstrate instant updates. Zapier has a bit of a lag

## Why I Built This

I wanted to show hiring teams and/or founders that I'm not spending my days sitting around (although rest is important). I'm actively upskilling and learning new tools during my transition period so I can hit the ground running when I get my next, amazing opportunity!


---

## Tech Stack

- Node.js  
- Express  
- SQLite  
- Zapier Webhooks  
- Google Sheets  
- Server-Sent Events  

---

## Run Locally

```bash
npm install
node server.js
