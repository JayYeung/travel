# Markout Travel Agency: local travel business interviews

An OpenAI-powered interview companion for local hotels, guides, tour operators, and similar businesses. It asks how they get bookings and whether they want help finding new customers or agency referrals, then saves a transcript and research summary.

## Run locally

Requires Node 20+, Chrome for the voice companion, and `OPENAI_API_KEY` in the local server environment. The API key stays on the server. This app binds to `127.0.0.1` and needs no public tunnel.

```sh
cd travel
export OPENAI_API_KEY=your_key
npm start
```

Open `http://localhost:3000`. The form has demo defaults, including the Meet link from this project session. **Rehearse with text** runs the interview without audio; no credentials need to be pasted into the page.

Your own Meet link can be kept in `local-config.json` as `{ "meetingUrl": "https://meet.google.com/..." }`. This file and `sessions/` are ignored by Git. The checked-in app uses a blank Meet field if the local config file is absent.

For a voice demo during a Meet call:

1. Join Meet in Chrome, then open Markout Travel Agency in another tab.
2. Click **Start voice companion**. In Chrome's picker, choose the **Meet tab** and enable **Share tab audio**. This lets Markout Travel Agency hear the guest.
3. In Meet, use **Present now** to share the **Markout Travel Agency tab**, again enabling tab audio. This lets the guest hear the interviewer's voice.
4. Back in Markout Travel Agency, click **Begin interview**. The companion asks for consent, listens for the guest's answer, and continues automatically after pauses.

The companion is a shared tab, not a separate Meet participant. It never joins the call on its own. A separate local session token protects the API and is bootstrapped into this browser tab; it is not the OpenAI key. Sessions are saved as JSON in `sessions/` and excluded from Git. The OpenAI API key is read only on the server and is never sent in browser HTML or JavaScript. Interview audio is sent to the local server, then to OpenAI for transcription.

This is a localhost prototype. Do not expose it through a public tunnel or deploy it as a public service without adding proper user authentication and access controls.

## What the interview asks

- The business, its customers, and how a recent booking happened.
- Where customer inquiries arrive today: direct, social, platforms, agencies, or referrals.
- When the business has unused availability or seasonal demand gaps.
- Current marketing efforts, fees, commissions, and follow-up work.
- What makes a customer or agency lead useful or a waste of time.
- What a small trial of a new lead source would need to prove.

The interviewer asks one question per turn and follows up on concrete answers. It avoids pitching the product or inventing evidence. The dashboard has notes, a summary button, Markdown download, and an end control.

## Current limits

- Chrome requires you to select the Meet tab for capture and share the Markout Travel Agency tab into Meet. A single OpenAI API key cannot create a separate Google Meet participant.
- The browser listens for pauses in meeting audio. Background noise, overlapping speakers, and short pauses can cause missed or split turns; use **Stop listening** if it misbehaves.
- The voice path requires a real browser and Meet tab, so automated tests cover only the server flow. The OpenAI text and speech endpoints were checked with the configured key; the two-tab audio routing still needs an in-call check.

## Sources

- [OpenAI Responses quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
- [OpenAI speech and transcription endpoints](https://platform.openai.com/docs/api-reference/audio/voice-consent-list?lang=curl)
- [OpenAI API key guidance](https://platform.openai.com/docs/api-reference/introduction?lang=node.js)
