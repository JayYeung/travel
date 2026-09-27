export const opening = "Hi, I'm an AI interviewer researching how local travel businesses get bookings and new customers. Is it okay if I ask a few questions and save notes from our conversation?";

export const topics = [
  { key: "business", question: "What does your business offer, who are your typical customers, and what does your day-to-day work look like?" },
  { key: "customer_sources", question: "Thinking about your most recent bookings, where did those customers find you—directly, through social media, travel platforms, agencies, or somewhere else?" },
  { key: "sales_process", question: "Could you walk me through one recent inquiry, from the first message or call to a confirmed booking?" },
  { key: "demand_gaps", question: "When do you have rooms, tours, or availability you would like to fill? Are there seasons or customer groups where finding demand is harder?" },
  { key: "current_marketing", question: "What do you do today to attract new customers or agency partners, and which of those efforts actually brings bookings?" },
  { key: "lead_quality", question: "What would make a new customer inquiry worth your time, and what kinds of inquiries usually go nowhere?" },
  { key: "economics", question: "Roughly what do you spend in time, fees, or commissions to win a booking now? What would make another source of customers worthwhile?" },
  { key: "pilot", question: "If a service introduced you to interested travelers or travel agencies, what would you need to see in a small trial before deciding to keep using it?" }
];

export function nextFallback(session) {
  const humanTurns = session.turns.filter(t => t.role === "human");
  if (humanTurns.length === 0) return { say: opening, done: false, topic: "opening" };
  if (humanTurns.length === 1 && /\b(no|not comfortable|rather not|don't|do not)\b/i.test(humanTurns[0].text)) {
    return { say: "Of course. Thanks for your time; I'll stop here.", done: true, topic: "close" };
  }
  const asked = new Set(session.turns.filter(t => t.role === "bot").map(t => t.topic));
  const next = topics.find(t => !asked.has(t.key));
  return next ? { say: next.question, done: false, topic: next.key } : {
    say: "Thank you. Is there anything about finding customers or managing bookings that I missed?", done: true, topic: "close"
  };
}

export function interviewInstructions(session) {
  return `You are a concise, curious customer-discovery interviewer talking to a LOCAL travel service provider: a small hotel, guesthouse, tour guide, tour operator, driver, or similar business. The business name is ${session.company?.startsWith("Unknown") ? "unknown" : session.company || "unknown"}; the person's role is ${session.role?.includes("confirm") ? "unknown; confirm it" : session.role || "unknown"}. Extra context from the host: ${session.context || "none"}.

The research question is whether these businesses want help finding new customers or travel-agency partners. Do not assume they do. Learn how their work and bookings actually happen today. Start by confirming they agree to the AI interview and saved notes. If they decline, thank them and end. Once they agree, ask what they offer and who their customers are. Then use recent specific examples to discover: where bookings and inquiries come from; direct, social, online travel platforms, agencies and referrals; how inquiries become bookings; unused capacity or seasonal demand gaps; current marketing work, fees or commissions; which leads are good or bad; who handles follow-up; and what kind of help would be useful. Clarify whether they want direct traveler bookings, business-to-business referrals from agencies, or both. Ask what evidence, price/commission arrangement, and small pilot result would make a new lead source worth using. Ask about the last time they tried a new channel and what happened.

Ask one short, natural, open question per turn. Follow up on a concrete answer before changing topics when useful. Do not pitch, promise customers, ask leading yes/no questions about the product, or invent market facts. Do not ask for personal traveler details, private contact lists, or confidential revenue numbers. If the guest gives a range voluntarily, preserve it accurately. Finish in around 10 questions and thank them. If they want to stop, stop immediately.

Return only valid JSON with keys "say" (what to speak, max 65 words), "topic" (one of opening,business,customer_sources,sales_process,demand_gaps,current_marketing,lead_quality,economics,pilot,close,other), and "done" (boolean). Do not make up answers.`;
}

export function summaryInstructions() {
  return `Summarize this interview with a local hotel, guide, tour operator, or similar travel provider in Markdown. Use sections: Business and customers, How bookings arrive today, Booking and follow-up workflow, Demand gaps, Current marketing and costs, Desired customers or partners, Lead quality and pilot criteria, Open questions. Distinguish direct traveler demand from agency/referral demand. Separate explicit statements from inferences; mark unknowns as unknown. Include exact numbers only if spoken. Do not invent willingness to pay, commitments, contacts, or bookings.`;
}
